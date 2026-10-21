import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk'

// What Claude reads when the current message is the last of a queued series.
export const QUEUE_LAST = 'AtHome queue: this is the last queued message. End with the full explanation and summary for the whole queue.'

// What Claude reads when n messages wait after the current one.
export function queueMore(n: number): string {
  return `AtHome queue: ${n} more ${n === 1 ? 'message from the user is' : 'messages from the user are'} waiting after this one.`
}

// What Claude is told about its tab's queue, as hidden context of its hooks: how many messages wait after the current
// one (at the start of a turn, and at a tool step when the number changed), and when the current one is the last of a
// queued series. A series is a run of turns with messages waiting after them; it ends with a turn that ends with none.
export class QueueAwareness {
  // waiting: how many messages will go after the current one (0 while the queue is paused).
  private readonly waiting: () => number
  private series = false
  // The number Claude was last told in this turn (undefined: told nothing).
  private told?: number

  constructor(waiting: () => number) {
    this.waiting = waiting
  }

  // The turn starting now was sent by the queue.
  startedFromQueue(): void {
    this.series = true
  }

  // A prompt starts a turn: the note for it, if any.
  atPrompt(): string | undefined {
    const n = this.waiting()
    if (n > 0) this.series = true
    this.told = n > 0 || this.series ? n : undefined
    return this.note(n)
  }

  // A tool step ended: a note only when the number changed since Claude was last told.
  afterTool(): string | undefined {
    const n = this.waiting()
    if (n === (this.told ?? 0)) return undefined
    if (n > 0) this.series = true
    this.told = n
    return this.note(n)
  }

  // The turn ended: the series ends with it when nothing waits.
  turnEnded(): void {
    if (this.waiting() === 0) this.series = false
    this.told = undefined
  }

  // The note for n waiting messages (undefined outside a series).
  private note(n: number): string | undefined {
    if (n > 0) return queueMore(n)
    return this.series ? QUEUE_LAST : undefined
  }

  // The session's hooks that hand the notes to Claude (UserPromptSubmit and PostToolUse, additionalContext).
  hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const hook = (hookEventName: 'UserPromptSubmit' | 'PostToolUse', note: () => string | undefined): HookCallbackMatcher => ({
      hooks: [
        async () => {
          const additionalContext = note()
          return additionalContext ? { hookSpecificOutput: { hookEventName, additionalContext } } : {}
        }
      ]
    })
    return { UserPromptSubmit: [hook('UserPromptSubmit', () => this.atPrompt())], PostToolUse: [hook('PostToolUse', () => this.afterTool())] }
  }
}
