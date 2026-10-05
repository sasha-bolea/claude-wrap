import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { terminalStream, type TerminalMeta, type WorkspaceEvent } from '@claude-wrap/protocol'
import type { IPty } from 'node-pty'
import { CoreError } from './errors.ts'
import { Stream, type RingLimits, type Send } from './stream.ts'

// Terminals of the backend: real shells (node-pty) in a folder, shared by every client. Each has a stream
// (terminal:<id>) of its raw output, numbered like the others so a client back from a reconnection gets what it
// missed, and the recent screen for a client that subscribes later. They live as long as core (a restart ends them).

export const MAX_TERMINALS = 5
// Recent output kept for a new subscriber (cut back to a line start), and the output a stream can replay.
const SCREEN_CHARS = 256 * 1024
const RING: RingLimits = { events: 4000, bytes: 1024 * 1024 }
// Output is gathered for this long before it goes out as one event (a busy shell writes in tiny pieces).
const FLUSH_MS = 16

// The shell to run: the user's own, else bash; PowerShell on Windows.
export type ShellCommand = { file: string; args: string[] }
const defaultShell = (): ShellCommand => (process.platform === 'win32' ? { file: 'powershell.exe', args: ['-NoLogo'] } : { file: process.env.SHELL || '/bin/bash', args: [] })

type Terminal = { meta: TerminalMeta; pty?: IPty; stream: Stream; screen: string; pending: string; timer?: NodeJS.Timeout }

export class Terminals {
  private readonly terminals = new Map<string, Terminal>()
  private readonly emit: (ev: WorkspaceEvent) => void
  private readonly shell: ShellCommand

  // emit: workspace events (the list every client sees); shell: what to run (default: defaultShell()).
  constructor(emit: (ev: WorkspaceEvent) => void, shell?: ShellCommand) {
    this.emit = emit
    this.shell = shell ?? defaultShell()
  }

  list(): TerminalMeta[] {
    return [...this.terminals.values()].map((terminal) => terminal.meta)
  }

  // Starts a shell in cwd (already checked by the caller). tabId: the session it was opened from. Returns its id.
  async open(cwd: string, cols: number, rows: number, tabId?: string): Promise<string> {
    if (this.terminals.size >= MAX_TERMINALS) throw new CoreError('limit_reached', `at most ${MAX_TERMINALS} terminals`)
    const { spawn } = await import('node-pty')
    const terminalId = randomUUID()
    const meta: TerminalMeta = { terminalId, cwd, title: basename(cwd) || cwd, ...(tabId ? { tabId } : {}), cols, rows, createdAt: Date.now() }
    const terminal: Terminal = { meta, stream: new Stream(terminalStream(terminalId), () => this.snapshot(terminal), RING), screen: '', pending: '' }
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    terminal.pty = spawn(this.shell.file, this.shell.args, { name: 'xterm-256color', cols, rows, cwd, env })
    terminal.pty.onData((data) => this.output(terminal, data))
    terminal.pty.onExit(({ exitCode }) => this.exited(terminal, exitCode))
    this.terminals.set(terminalId, terminal)
    this.emit({ type: 'terminal.added', terminal: meta })
    return terminalId
  }

  // The terminal or not_found.
  private terminalOf(terminalId: string): Terminal {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new CoreError('not_found', `terminal ${terminalId} not found`)
    return terminal
  }

  // The terminal behind a `terminal:<id>` stream name, if it exists.
  streamOf(stream: string): Stream | undefined {
    return [...this.terminals.values()].find((terminal) => terminal.stream.name === stream)?.stream
  }

  subscribe(terminalId: string, send: Send): void {
    this.terminalOf(terminalId).stream.attach(send)
  }

  unsubscribe(terminalId: string, send: Send): void {
    this.terminals.get(terminalId)?.stream.detach(send)
  }

  // A client went away: it leaves every terminal stream.
  detachAll(send: Send): void {
    for (const terminal of this.terminals.values()) terminal.stream.detach(send)
  }

  // Keys typed in a client's terminal (an ended shell ignores them).
  input(terminalId: string, data: string): void {
    this.terminalOf(terminalId).pty?.write(data)
  }

  // A client's terminal changed size: the shell and every client follow it.
  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminalOf(terminalId)
    if (terminal.meta.cols === cols && terminal.meta.rows === rows) return
    terminal.pty?.resize(cols, rows)
    terminal.meta = { ...terminal.meta, cols, rows }
    this.emit({ type: 'terminal.updated', terminal: terminal.meta })
  }

  // Ends the shell (if still running) and removes the terminal for every client.
  close(terminalId: string): void {
    const terminal = this.terminalOf(terminalId)
    this.stop(terminal)
    this.terminals.delete(terminalId)
    this.emit({ type: 'terminal.removed', terminalId })
  }

  // Core is shutting down: every shell ends.
  closeAll(): void {
    for (const terminal of this.terminals.values()) this.stop(terminal)
    this.terminals.clear()
  }

  private stop(terminal: Terminal): void {
    clearTimeout(terminal.timer)
    const pty = terminal.pty
    terminal.pty = undefined
    try {
      pty?.kill()
    } catch {
      // already gone
    }
  }

  // Output of the shell: gathered for FLUSH_MS, then one event; the screen keeps the recent part.
  private output(terminal: Terminal, data: string): void {
    terminal.pending += data
    terminal.timer ??= setTimeout(() => this.flush(terminal), FLUSH_MS)
  }

  private flush(terminal: Terminal): void {
    terminal.timer = undefined
    const data = terminal.pending
    if (!data) return
    terminal.pending = ''
    terminal.screen += data
    if (terminal.screen.length > SCREEN_CHARS) {
      const cut = terminal.screen.slice(-SCREEN_CHARS)
      const line = cut.indexOf('\n')
      terminal.screen = line >= 0 ? cut.slice(line + 1) : cut
    }
    terminal.stream.emit({ type: 'terminal.output', data })
  }

  // The shell ended: what it wrote last goes out, then its end; the terminal stays listed until closed.
  private exited(terminal: Terminal, exitCode: number): void {
    if (!this.terminals.has(terminal.meta.terminalId) || !terminal.pty) return
    clearTimeout(terminal.timer)
    this.flush(terminal)
    terminal.pty = undefined
    terminal.meta = { ...terminal.meta, exitCode }
    terminal.stream.emit({ type: 'terminal.exit', exitCode })
    this.emit({ type: 'terminal.updated', terminal: terminal.meta })
  }

  // Taking the snapshot sends the output still gathered first, so the reset carries it.
  private snapshot(terminal: Terminal) {
    if (terminal.pending) {
      clearTimeout(terminal.timer)
      this.flush(terminal)
    }
    return { kind: 'terminal' as const, terminal: terminal.meta, screen: terminal.screen }
  }
}
