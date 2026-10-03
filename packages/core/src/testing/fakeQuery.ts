import { randomUUID } from 'node:crypto'
import type { CanUseTool, ModelInfo, Options, PermissionResult, Query, SDKMessage, SDKSessionInfo, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

// Scriptable stand-in for the SDK's query(): messages are pushed by hand with emit(), control methods are
// recorded. Plain code (no vitest) so the hosts can also drive it for deterministic e2e runs.

export type ControlCall = { method: string; args: unknown[] }

// One fake CLI process, created by each query() call.
export class FakeSession {
  readonly received: SDKUserMessage[] = []
  readonly calls: ControlCall[] = []
  closed = false
  // Set to make the next setPermissionMode / setModel call reject.
  rejectNext?: Error
  // Set to hold setPermissionMode / setModel calls until the promise resolves (in-flight tests).
  gate?: Promise<void>
  models: ModelInfo[] = [{ value: 'default', displayName: 'Default', description: '' }, { value: 'haiku', displayName: 'Haiku', description: '' }]
  commands = [
    { name: 'compact', description: 'Compact', argumentHint: '' },
    { name: '__internal', description: '', argumentHint: '' }
  ]
  private pending: SDKMessage[] = []
  private wake?: () => void
  private finished = false
  private failure?: Error
  private receivedListeners: (() => void)[] = []
  private receiveHooks: ((message: SDKUserMessage) => void)[] = []
  private interruptListeners: (() => void)[] = []
  readonly options: Options

  // options: what core passed to query(); prompt: the streaming input, consumed in the background.
  constructor(options: Options, prompt: AsyncIterable<SDKUserMessage>) {
    this.options = options
    void (async () => {
      for await (const message of prompt) {
        this.received.push(message)
        this.receiveHooks.forEach((hook) => hook(message))
        this.receivedListeners.splice(0).forEach((listener) => listener())
      }
    })()
  }

  // Runs hook on every user message as it arrives (scenarios answer like the CLI: queued at once).
  onReceive(hook: (message: SDKUserMessage) => void): void {
    this.receiveHooks.push(hook)
  }

  // Queues SDK messages for core's read loop.
  emit(...messages: SDKMessage[]): void {
    this.pending.push(...messages)
    this.wakeUp()
  }

  // Ends the process: the read loop finishes (with an error if given).
  exit(error?: Error): void {
    this.failure = error
    this.finished = true
    this.wakeUp()
  }

  // Resolves once core has pushed at least `count` user messages into the input.
  async waitForInput(count: number): Promise<void> {
    while (this.received.length < count) await new Promise<void>((resolve) => this.receivedListeners.push(resolve))
  }

  // Calls core's canUseTool like the CLI does. Returns the pending result and a way to cancel the request.
  askPermission(toolName: string, input: Record<string, unknown>, extra: Partial<Parameters<CanUseTool>[2]> = {}) {
    const controller = new AbortController()
    const requestId = extra.requestId ?? `req-${Math.random().toString(36).slice(2)}`
    const result: Promise<PermissionResult | null> = this.options.canUseTool!(toolName, input, {
      signal: controller.signal,
      toolUseID: `tool-${requestId}`,
      ...extra,
      requestId
    })
    return { requestId, result, abort: () => controller.abort() }
  }

  // Registers a reaction to interrupt() (scenarios end the running turn as aborted).
  onInterrupt(listener: () => void): void {
    this.interruptListeners.push(listener)
  }

  // Number of recorded calls to a control method.
  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length
  }

  // The object handed to core as the Query.
  asQuery(): Query {
    const record = (method: string, args: unknown[]) => this.calls.push({ method, args })
    const maybeReject = async () => {
      await this.gate
      const error = this.rejectNext
      this.rejectNext = undefined
      if (error) throw error
    }
    const iterator = this.iterate()
    return Object.assign(iterator, {
      interrupt: async () => {
        record('interrupt', [])
        this.interruptListeners.forEach((listener) => listener())
      },
      setModel: async (model?: string) => (record('setModel', [model]), maybeReject()),
      setPermissionMode: async (mode: string) => (record('setPermissionMode', [mode]), maybeReject()),
      applyFlagSettings: async (settings: object) => (record('applyFlagSettings', [settings]), maybeReject()),
      supportedModels: async () => (record('supportedModels', []), this.models),
      supportedCommands: async () => (record('supportedCommands', []), this.commands),
      close: () => {
        record('close', [])
        this.closed = true
        this.exit()
      }
    }) as unknown as Query
  }

  private wakeUp(): void {
    this.wake?.()
    this.wake = undefined
  }

  private async *iterate(): AsyncGenerator<SDKMessage> {
    for (;;) {
      const next = this.pending.shift()
      if (next) yield next
      else if (this.failure) throw this.failure
      else if (this.finished) return
      else await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}

type StoredInfo = { cwd?: string; customTitle?: string; lastModified: number }

// Summary of a stored session like the CLI's: the first user text.
function summaryOf(history: SessionMessage[]): string {
  const first = history.find((message) => message.type === 'user')
  const content = (first?.message as { content?: unknown } | undefined)?.content
  return typeof content === 'string' ? content.slice(0, 80) : 'Session'
}

// A fake SDK: query() creates FakeSessions; the session functions work on an in-memory store of histories.
export function createFakeSdk() {
  const sessions: FakeSession[] = []
  const histories = new Map<string, SessionMessage[]>()
  const infos = new Map<string, StoredInfo>()
  const info = (sessionId: string): SDKSessionInfo | undefined => {
    const history = histories.get(sessionId)
    if (!history) return undefined
    const stored = infos.get(sessionId) ?? { lastModified: 0 }
    return { sessionId, summary: summaryOf(history), lastModified: stored.lastModified, customTitle: stored.customTitle, cwd: stored.cwd }
  }
  return {
    sessions,
    histories,
    infos,
    query: ((params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
      const session = new FakeSession(params.options ?? {}, params.prompt)
      sessions.push(session)
      return session.asQuery()
    }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
    getSessionMessages: async (sessionId: string) => histories.get(sessionId) ?? [],
    getSessionInfo: async (sessionId: string) => info(sessionId),
    // dir absent: the sessions of every folder (most recent first, like the SDK).
    listSessions: async ({ dir }: { dir?: string } = {}) =>
      [...histories.keys()]
        .filter((id) => dir === undefined || infos.get(id)?.cwd === dir)
        .map((id) => info(id)!)
        .sort((a, b) => b.lastModified - a.lastModified),
    renameSession: async (sessionId: string, title: string) => {
      infos.set(sessionId, { ...(infos.get(sessionId) ?? { lastModified: 0 }), customTitle: title })
    },
    deleteSession: async (sessionId: string) => {
      histories.delete(sessionId)
      infos.delete(sessionId)
    },
    forkSession: async (sessionId: string, options: { title?: string; upToMessageId?: string }) => {
      const history = histories.get(sessionId) ?? []
      const end = options.upToMessageId ? history.findIndex((message) => message.uuid === options.upToMessageId) + 1 : history.length
      const forked = randomUUID()
      histories.set(forked, history.slice(0, end || history.length))
      infos.set(forked, { cwd: infos.get(sessionId)?.cwd, customTitle: options.title, lastModified: Date.now() })
      return { sessionId: forked }
    },
    // Appends a message to a stored session (scenarios record their conversations, like the CLI's JSONL).
    record(sessionId: string, cwd: string | undefined, message: SessionMessage): void {
      histories.set(sessionId, [...(histories.get(sessionId) ?? []), message])
      infos.set(sessionId, { ...infos.get(sessionId), cwd, lastModified: Date.now() })
    },
    // The most recent fake process.
    last(): FakeSession {
      const session = sessions.at(-1)
      if (!session) throw new Error('no fake session started')
      return session
    }
  }
}

export type FakeSdk = ReturnType<typeof createFakeSdk>
