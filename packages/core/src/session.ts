import type { ChildProcess } from 'node:child_process'
import type { Options, Query, SDKMessage, SDKUserMessage, SpawnedProcess, query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import { STDERR_TAIL_BYTES, killTree, spawnClaude } from './process.ts'

// User messages as an AsyncIterable: the "streaming input" that keeps the CLI session alive and its
// control methods usable. Port of the first attempt's CodaInput.
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void
  private ended = false

  // Adds a message; a waiting CLI receives it at once.
  push(message: SDKUserMessage): void {
    if (this.waiting) {
      this.waiting({ value: message, done: false })
      this.waiting = undefined
    } else this.items.push(message)
  }

  // Ends the input: the CLI sees end of input.
  end(): void {
    this.ended = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = undefined
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      }
    }
  }
}

export interface SessionHandlers {
  message(message: SDKMessage): void
  // A handler bug while applying a message: reported, the session keeps reading.
  handlerError(error: unknown): void
  // The claude process started / exited (recorded so a dead core's processes can be swept at the next start).
  processStarted(pid: number, startedAt: number): void
  processExited(pid: number): void
}

// Resolves after ms (the timer does not keep the process alive).
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.())

// One live CLI process of a started tab: its query, streaming input, read loop and stderr tail.
export class Session {
  readonly input = new InputQueue()
  readonly query: Query
  // Resolves when the process has exited: undefined on a clean end, the error otherwise.
  readonly exited: Promise<Error | undefined>
  private child?: ChildProcess
  private stderr = ''

  // start: the SDK query function; options: session options (cwd, resume, canUseTool…); handlers: message sink.
  constructor(start: typeof sdkQuery, options: Options, handlers: SessionHandlers) {
    const spawnClaudeCodeProcess: Options['spawnClaudeCodeProcess'] = (spawnOptions) => {
      const child = spawnClaude(spawnOptions, (chunk) => (this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL_BYTES)))
      this.child = child
      const pid = child.pid
      if (pid) {
        handlers.processStarted(pid, Date.now())
        child.once('exit', () => handlers.processExited(pid))
      }
      // stdio is ['pipe','pipe','pipe']: stdin and stdout are always there.
      return child as SpawnedProcess
    }
    this.query = start({ prompt: this.input, options: { spawnClaudeCodeProcess, ...options } })
    this.exited = this.read(handlers)
  }

  // Last stderr output of the process.
  get stderrTail(): string {
    return this.stderr.trim()
  }

  push(message: SDKUserMessage): void {
    this.input.push(message)
  }

  // Close order: interrupt (or the CLI would finish the turn, allowed tools included) → end input → close() →
  // wait up to timeoutMs for the exit → kill the process tree (Windows: still parented, so MCP servers go too).
  async close(timeoutMs: number): Promise<void> {
    void this.query.interrupt().catch(() => undefined)
    this.input.end()
    this.query.close()
    const exitedInTime = await Promise.race([this.exited.then(() => true), sleep(timeoutMs).then(() => false)])
    if (exitedInTime || !this.child?.pid) return
    await killTree(this.child.pid)
    await this.exited
  }

  // Consumes the messages until the process exits.
  private async read(handlers: SessionHandlers): Promise<Error | undefined> {
    try {
      for await (const message of this.query) {
        try {
          handlers.message(message)
        } catch (error) {
          handlers.handlerError(error)
        }
      }
      return undefined
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }
}
