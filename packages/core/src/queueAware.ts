import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk'

// What Claude reads when the current message is the last of a queued series.
export const QUEUE_LAST =
  'AtHome queue: this is the last queued message. End with the full explanation and summary for the whole queue, the decisions you took on your own, and the questions you held back.'

// What Claude reads when n messages wait after the current one: the count, and what to do while they wait.
export function queueMore(n: number): string {
  const count = `${n} more ${n === 1 ? 'message from the user is' : 'messages from the user are'} waiting after this one`
  return `AtHome queue: ${count}. Don't ask the user anything now (no AskUserQuestion: it would stop the queue): pick the recommended option and say which, keep the reply short, and keep explanations and open questions for the last queued message.`
}

// Why AskUserQuestion is refused while queued messages wait.
export const QUEUE_NO_ASK =
  'AtHome queue: messages from the user are waiting, and a question would stop the queue. Pick the recommended option, say which, and ask your question at the end of the last queued message instead.'

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

  // AskUserQuestion may run: only while no queued message waits.
  askAllowed(): boolean {
    return this.waiting() === 0
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

  // The session's hooks: the notes for Claude (UserPromptSubmit and PostToolUse, additionalContext), and the refusal of
  // AskUserQuestion while messages wait (PreToolUse).
  hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const hook = (hookEventName: 'UserPromptSubmit' | 'PostToolUse', note: () => string | undefined): HookCallbackMatcher => ({
      hooks: [
        async () => {
          const additionalContext = note()
          return additionalContext ? { hookSpecificOutput: { hookEventName, additionalContext } } : {}
        }
      ]
    })
    const noAsk: HookCallbackMatcher = {
      matcher: 'AskUserQuestion',
      hooks: [async () => (this.askAllowed() ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: QUEUE_NO_ASK } })]
    }
    return { UserPromptSubmit: [hook('UserPromptSubmit', () => this.atPrompt())], PostToolUse: [hook('PostToolUse', () => this.afterTool())], PreToolUse: [noAsk] }
  }
}
