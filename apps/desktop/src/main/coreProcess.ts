import { app, shell, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Notice } from '@athome/core'

// Crash policy: restart with backoff, at most MAX_RESTARTS within RESTART_WINDOW_MS, then give up.
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000
const BACKOFF_MS = [250, 1000, 3000]
// Upper bound for the core to close every session on quit.
const QUIT_TIMEOUT_MS = 10_000

export interface CoreProcessEvents {
  notify(notice: Notice): void
  // The core crashed too often: the UI shows an error screen.
  failed(): void
}

// Path of the claude binary in the packaged app: inside app.asar it cannot run, electron-builder unpacks it to
// app.asar.unpacked (asarUnpack in package.json). In development the SDK finds it by itself.
function packagedClaudePath(): string | undefined {
  if (!app.isPackaged) return undefined
  const binary = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`
  return createRequire(import.meta.url).resolve(binary).replace('app.asar', 'app.asar.unpacked')
}

// The local core in a utilityProcess: crash isolation, restart with backoff, ports queued while it (re)starts.
export class CoreProcess {
  private child?: UtilityProcess
  private alive = false
  private quitting = false
  private crashes: number[] = []
  private readonly waiting: MessagePortMain[] = []
  private readonly events: CoreProcessEvents

  constructor(events: CoreProcessEvents) {
    this.events = events
  }

  start(): void {
    const env = { ...process.env, CLAUDE_WRAP_STATE_DIR: app.getPath('userData'), CLAUDE_WRAP_CLAUDE_PATH: packagedClaudePath() ?? '' }
    const child = utilityProcess.fork(join(import.meta.dirname, 'coreHost.js'), [], { serviceName: 'AtHome core', env })
    this.child = child
    child.on('spawn', () => {
      this.alive = true
      for (const port of this.waiting.splice(0)) child.postMessage({ type: 'attach' }, [port])
    })
    child.on('message', (message: { type?: string; notice?: Notice; id?: number; path?: string }) => {
      if (message.type === 'notify' && message.notice) this.events.notify(message.notice)
      // The core asks to move a file or folder (already checked against its Home) to the system trash.
      if (message.type === 'trash' && message.id !== undefined && message.path) {
        const { id, path } = message
        shell.trashItem(path).then(
          () => child.postMessage({ type: 'trashed', id }),
          (error: unknown) => child.postMessage({ type: 'trashed', id, error: String(error) })
        )
      }
    })
    child.on('exit', () => this.onExit(child))
  }

  // Hands one end of a client channel to the core (now, or when it is up again).
  attach(port: MessagePortMain): void {
    if (this.alive && this.child) this.child.postMessage({ type: 'attach' }, [port])
    else this.waiting.push(port)
  }

  // Asks the core to close every session, waits for its exit (capped).
  async quit(): Promise<void> {
    this.quitting = true
    const child = this.child
    if (!child || !this.alive) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.postMessage({ type: 'quit' })
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS))])
  }

  // The core died: restart with backoff (its startup sweep kills the claude processes it left), or give up.
  private onExit(child: UtilityProcess): void {
    if (child !== this.child) return
    this.alive = false
    if (this.quitting) return
    const now = Date.now()
    this.crashes = [...this.crashes.filter((at) => now - at < RESTART_WINDOW_MS), now]
    if (this.crashes.length > MAX_RESTARTS) return this.events.failed()
    setTimeout(() => this.start(), BACKOFF_MS[this.crashes.length - 1] ?? BACKOFF_MS.at(-1))
  }
}
