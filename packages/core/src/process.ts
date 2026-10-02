// Spawning the sessions' claude processes and cleaning up after them (port of the first attempt's processi.ts).
// On Windows, when claude exits, the stdio MCP servers it started (npx + node) stay alive: an orphan keeps the
// dead parent's PID, so after the exit they are found and killed with their whole tree.
// On Linux claude and `!` commands start in their own process group, so killTree reaches the whole tree.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { LivePid } from './state.ts'

const run = promisify(execFile)

// Bytes of stderr kept per process for the tab error (e.g. shell_tool_missing).
export const STDERR_TAIL_BYTES = 64 * 1024
// Windows creation time and our Date.now() at spawn differ by a little: margins used when matching them.
const START_MARGIN_MS = 1000
const SAME_PROCESS_TOLERANCE_MS = 5000

type ProcessInfo = { pid: number; ppid: number; created: number }

// Cleanups in progress: quitting must wait for them, or the orphans would survive.
const cleanups = new Set<Promise<void>>()

// PIDs of the direct children of an exited process, created after it started (a PID reused by Windows is older).
// Grandchildren are not needed: taskkill /T kills each child's tree.
export function orphanChildren(processes: ProcessInfo[], parentPid: number, parentStart: number): number[] {
  return processes.filter((info) => info.ppid === parentPid && info.created >= parentStart).map((info) => info.pid)
}

// What to kill for processes recorded as live by a core that died: a recorded claude still running (same PID and
// start time, so not a reused PID) is killed with its tree; for one already gone, its orphaned children are.
export function sweepTargets(processes: ProcessInfo[], recorded: LivePid[]): number[] {
  return recorded.flatMap(({ pid, startedAt }) => {
    const alive = processes.some((info) => info.pid === pid && Math.abs(info.created - startedAt) < SAME_PROCESS_TOLERANCE_MS)
    return alive ? [pid] : orphanChildren(processes, pid, startedAt - START_MARGIN_MS)
  })
}

// Startup sweep (Windows): kills what a dead core left running. On Linux the systemd cgroup already guarantees it,
// and a sweep after a reboot could hit unrelated processes. Returns the PIDs killed.
export async function sweepOrphans(recorded: LivePid[]): Promise<number[]> {
  if (process.platform !== 'win32' || !recorded.length) return []
  const targets = sweepTargets(await listProcesses().catch(() => []), recorded)
  await Promise.all(targets.map(killTree))
  return targets
}

// System processes with parent and creation time (Windows only).
async function listProcesses(): Promise<ProcessInfo[]> {
  const command = "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString('o') }"
  const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, ppid, created] = line.trim().split(' ')
      return { pid: Number(pid), ppid: Number(ppid), created: Date.parse(created ?? '') }
    })
}

// Kills a process tree (Linux: its process group). Errors are ignored: the process may already be gone.
export async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') return void (await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined))
  for (const target of [-pid, pid]) {
    try {
      return void process.kill(target, 'SIGKILL')
    } catch {
      // no such group (not a group leader) or already gone: try the next target
    }
  }
}

// Own process group on Linux (see killTree); on Windows a detached child would get its own console.
const OWN_GROUP = process.platform !== 'win32'

// Kills the trees of the children left behind by an exited claude.
async function killOrphans(parentPid: number, parentStart: number): Promise<void> {
  const orphans = orphanChildren(await listProcesses().catch(() => []), parentPid, parentStart)
  await Promise.all(orphans.map(killTree))
}

// Spawns claude for the SDK (spawnClaudeCodeProcess option); on Windows its orphans are killed when it exits.
// onStderr: receives stderr chunks (the session keeps a tail).
export function spawnClaude({ command, args, cwd, env, signal }: SpawnOptions, onStderr: (chunk: string) => void): ChildProcess {
  const started = Date.now() - START_MARGIN_MS
  const child = spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP })
  child.stderr?.setEncoding('utf8').on('data', onStderr)
  child.on('exit', () => {
    if (process.platform !== 'win32' || !child.pid) return
    const cleanup = killOrphans(child.pid, started).finally(() => cleanups.delete(cleanup))
    cleanups.add(cleanup)
  })
  return child
}

// Resolves when the cleanups in progress are done (quit).
export async function waitForCleanups(): Promise<void> {
  await Promise.all([...cleanups])
}

// `!` commands: a bash like the CLI's (Git Bash on Windows, found as the CLI finds it), else the system shell.
const SHELL_TIMEOUT_MS = 120_000
const SHELL_OUTPUT_CHARS = 30_000
const GIT_BASH = 'C:\Program Files\Git\bin\bash.exe'

export type ShellResult = { stdout: string; stderr: string; exitCode: number }

// Executable and arguments that run one command line.
function shellCommand(command: string): [string, string[]] {
  if (process.platform !== 'win32') return [existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', command]]
  const bash = [process.env.CLAUDE_CODE_GIT_BASH_PATH, GIT_BASH].find((path) => path && existsSync(path))
  return bash ? [bash, ['-c', command]] : [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command]]
}

// Output cut to SHELL_OUTPUT_CHARS (the CLI's limit for its Bash tool).
const capped = (text: string) => (text.length > SHELL_OUTPUT_CHARS ? `${text.slice(0, SHELL_OUTPUT_CHARS)}\n[output truncated]` : text)

// Runs a command line in a folder. The abort signal and a 2-minute timeout kill its whole tree.
export function runShell(command: string, cwd: string, signal: AbortSignal): Promise<ShellResult> {
  const [file, args] = shellCommand(command)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP })
    const stop = () => void (child.pid && killTree(child.pid))
    const timer = setTimeout(stop, SHELL_TIMEOUT_MS)
    signal.addEventListener('abort', stop)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout = stdout.length > SHELL_OUTPUT_CHARS ? stdout : stdout + chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = stderr.length > SHELL_OUTPUT_CHARS ? stderr : stderr + chunk))
    const done = (exitCode: number) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      resolve({ stdout: capped(stdout), stderr: capped(stderr), exitCode })
    }
    child.on('error', (error) => ((stderr += error.message), done(127)))
    child.on('close', (code) => done(code ?? 1))
  })
}
