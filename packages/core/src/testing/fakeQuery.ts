import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountInfo, CanUseTool, McpServerStatus, ModelInfo, Options, PermissionResult, Query, RewindFilesResult, SDKControlGetContextUsageResponse, SDKControlGetUsageResponse, SDKMessage, SDKSessionInfo, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

// Scriptable stand-in for the SDK's query(): messages are pushed by hand with emit(), control methods are
// recorded. Plain code (no vitest) so the hosts can also drive it for deterministic e2e runs.

export type ControlCall = { method: string; args: unknown[] }
type NonNull<T> = Exclude<T, undefined>
export type RewindCall = { userMessageId: string; dryRun?: boolean }

// A /context answer: 48.5k of a 200k window, two MCP tools of one server, one memory file.
const FAKE_CONTEXT = {
  categories: [
    { name: 'System prompt', tokens: 3100, color: 'gray', kind: 'used' },
    { name: 'System tools', tokens: 11800, color: 'gray', kind: 'used' },
    { name: 'MCP tools', tokens: 2600, color: 'cyan', kind: 'used' },
    { name: 'Memory files', tokens: 1500, color: 'orange', kind: 'used' },
    { name: 'Messages', tokens: 29500, color: 'purple', kind: 'used' },
    { name: 'Free space', tokens: 106500, color: 'gray', kind: 'free' },
    { name: 'Autocompact buffer', tokens: 45000, color: 'gray', kind: 'buffer' }
  ],
  totalTokens: 48500,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  percentage: 24,
  gridRows: [],
  model: 'fake-model',
  memoryFiles: [{ path: '/home/user/.claude/CLAUDE.md', type: 'User', tokens: 1500 }],
  mcpTools: [
    { name: 'mcp__docs__search', serverName: 'docs', tokens: 1600 },
    { name: 'mcp__docs__read', serverName: 'docs', tokens: 1000 }
  ],
  agents: [],
  autoCompactThreshold: 155000,
  isAutoCompactEnabled: true,
  apiUsage: null
} as SDKControlGetContextUsageResponse

// A /usage answer on a Max plan: $0.42 spent with one model, 5-hour window at 37 %, weekly at 12 % (resets far ahead, so
// the windows never count as already reset).
const FAKE_USAGE = {
  session: {
    total_cost_usd: 0.42,
    total_api_duration_ms: 21000,
    total_duration_ms: 95000,
    total_lines_added: 12,
    total_lines_removed: 3,
    model_usage: { 'fake-model': { inputTokens: 1200, outputTokens: 3400, cacheReadInputTokens: 52000, cacheCreationInputTokens: 8000, webSearchRequests: 0, costUSD: 0.42, contextWindow: 200000, maxOutputTokens: 32000 } }
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 37, resets_at: '2099-10-03T22:00:00.000000+00:00' },
    seven_day: { utilization: 12, resets_at: '2099-10-08T09:00:00Z' },
    seven_day_opus: null,
    model_scoped: [{ display_name: 'Fable', utilization: 5, resets_at: '2099-10-08T09:00:00Z' }]
  },
  behaviors: null
} as SDKControlGetUsageResponse

// One fake CLI process, created by each query() call.
export class FakeSession {
  readonly received: SDKUserMessage[] = []
  readonly calls: ControlCall[] = []
  readonly rewindCalls: RewindCall[] = []
  // Subtypes of raw control requests this session refuses (a CLI without them).
  readonly refusedRequests = new Set<string>()
  closed = false
  // Set to make the next setPermissionMode / setModel call reject.
  rejectNext?: Error
  // Set to hold setPermissionMode / setModel calls until the promise resolves (in-flight tests).
  gate?: Promise<void>
  models: ModelInfo[] = [{ value: 'default', displayName: 'Default', description: '', supportedEffortLevels: ['low', 'medium', 'high'] }, { value: 'haiku', displayName: 'Haiku', description: '' }]
  commands = [
    { name: 'compact', description: 'Compact', argumentHint: '' },
    { name: '__internal', description: '', argumentHint: '' }
  ]
  // Answers of getContextUsage and of the /usage call (set to change them; a usage of undefined rejects).
  contextUsage: SDKControlGetContextUsageResponse = FAKE_CONTEXT
  usage: SDKControlGetUsageResponse | undefined = FAKE_USAGE
  // Answers of the inspection panels (set to change them). getStatus / getHooksListing / mcpAuthenticate are runtime-only
  // SDK methods: undefined = the CLI has no such request (a call rejects "not available"). mcpServers answers
  // mcpServerStatus.
  statusAnswer: unknown = {
    sections: [
      { title: 'Session', rows: [{ label: 'Version', value: '2.1.287' }, ['Model', 'fake-model'], 'Cwd: /work'] },
      { title: 'Empty', rows: [] }
    ]
  }
  hooksListing: unknown = {
    events: [{ name: 'PreToolUse', summary: '', supportsMatcher: true, hookCount: 1 }],
    hooks: [{ event: 'PreToolUse', matcher: 'Bash', source: 'userSettings', sourceLabel: 'User settings', type: 'command', displayText: 'lint', commandText: 'npm run lint', contentLabel: 'Command', timeout: 30 }],
    eventCatalog: [],
    policy: { disabledByPolicy: false, managedOnly: false, pluginOnly: false, allDisabled: false, policyHookCount: 0 }
  }
  authAnswer: unknown = { authUrl: 'https://auth.example/authorize?state=x', requiresUserAction: true, callbackExpected: true, redirectScheme: 'http', state: 'x' }
  mcpServers: McpServerStatus[] = [
    { name: 'docs', status: 'connected', scope: 'project', source: 'project', config: { type: 'http', url: 'https://docs.example/mcp' }, tools: [{ name: 'search' }, { name: 'read' }] },
    { name: 'broken', status: 'failed', error: 'spawn ENOENT' }
  ]
  // Methods that reject when called (name -> error), and the account accountInfo() answers.
  readonly rejectMethods = new Map<string, Error>()
  // Side effects of inspection calls (method -> function of the call's arguments; may throw): scenarios use them to make toggles and sign-ins change the fake's state.
  readonly inspectEffects = new Map<string, (args: unknown[]) => void>()
  account: AccountInfo = { email: 'me@example.com', subscriptionType: 'max' }
  // Answer of listPermissionRules (runtime-only SDK method). undefined: built from the settings files (see
  // readPermissionFiles), read at spawn and again at each applyFlagSettings, like the real CLI that does not watch them.
  permissionsAnswer: unknown
  // Folder of the userSettings file the fake reads (undefined: none).
  userSettingsDir?: string
  private filePermissions: unknown
  // Results of rewindFiles calls, keyed by userMessageId (default: no file checkpoint found).
  rewindResults = new Map<string, RewindFilesResult>()
  // The resumeSessionAt option received when this session was created.
  resumeSessionAt?: string
  // Uuids of messages withdrawn with cancel_async_message (scenarios skip them), and of those already read
  // (a command_lifecycle 'started' was emitted for them: too late to withdraw).
  readonly cancelled = new Set<string>()
  private readonly read = new Set<string>()
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
    this.resumeSessionAt = options.resumeSessionAt
    void (async () => {
      for await (const message of prompt) {
        this.received.push(message)
        this.receiveHooks.forEach((hook) => hook(message))
        this.receivedListeners.splice(0).forEach((listener) => listener())
      }
    })()
  }

  // The CLI's cancel_async_message: withdraws a message it received and has not read; false when it was read (or is unknown).
  private cancelUnread(uuid?: string): boolean {
    if (!uuid || this.read.has(uuid) || this.cancelled.has(uuid) || !this.received.some((message) => message.uuid === uuid)) return false
    this.cancelled.add(uuid)
    this.emit({ type: 'command_lifecycle', command_uuid: uuid, state: 'cancelled', uuid: randomUUID(), session_id: 's' } as unknown as SDKMessage)
    return true
  }

  // Runs hook on every user message as it arrives (scenarios answer like the CLI: queued at once).
  onReceive(hook: (message: SDKUserMessage) => void): void {
    this.receiveHooks.push(hook)
  }

  // Queues SDK messages for core's read loop.
  emit(...messages: SDKMessage[]): void {
    for (const message of messages) {
      const { type, state, command_uuid: uuid } = message as unknown as { type: string; state?: string; command_uuid?: string }
      if (type === 'command_lifecycle' && state === 'started' && uuid) this.read.add(uuid)
    }
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
      // The Query's raw control request: an interrupt with send_now ends the running turn here (as a CLI that moves
      // nothing to the background does), so the waiting messages run next.
      request: async (request: { subtype?: string; send_now?: boolean; message_uuid?: string }) => {
        record('request', [request])
        if (request.subtype && this.refusedRequests.has(request.subtype)) throw new Error(`unsupported control request: ${request.subtype}`)
        if (request.subtype === 'interrupt') this.interruptListeners.forEach((listener) => listener())
        if (request.subtype === 'cancel_async_message') return { response: { cancelled: this.cancelUnread(request.message_uuid) } }
        return { response: request.send_now ? { send_now: 'interrupting' } : {} }
      },
      setModel: async (model?: string) => (record('setModel', [model]), maybeReject()),
      setPermissionMode: async (mode: string) => (record('setPermissionMode', [mode]), maybeReject()),
      applyFlagSettings: async (settings: object) => {
        record('applyFlagSettings', [settings])
        await maybeReject()
        this.readPermissionFiles()
      },
      listPermissionRules: async () => this.inspect('listPermissionRules', [], () => this.runtimeAnswer('listPermissionRules', this.permissionsAnswer ?? this.filePermissions)),
      supportedModels: async () => (record('supportedModels', []), this.models),
      supportedCommands: async () => (record('supportedCommands', []), this.commands),
      getContextUsage: async (opts?: object) => (record('getContextUsage', opts ? [opts] : []), this.contextUsage),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (opts?: object) => {
        record('usage', [opts])
        if (!this.usage) throw new Error('usage unavailable')
        return this.usage
      },
      // Inspection panels: recorded, answered from the fields above, rejected when listed in rejectMethods.
      accountInfo: async () => this.inspect('accountInfo', [], () => this.account),
      mcpServerStatus: async () => this.inspect('mcpServerStatus', [], () => this.mcpServers),
      reconnectMcpServer: async (name: string) => this.inspect('reconnectMcpServer', [name], () => undefined),
      toggleMcpServer: async (name: string, enabled: boolean) => this.inspect('toggleMcpServer', [name, enabled], () => undefined),
      getStatus: async () => this.inspect('getStatus', [], () => this.runtimeAnswer('getStatus', this.statusAnswer)),
      getHooksListing: async () => this.inspect('getHooksListing', [], () => this.runtimeAnswer('getHooksListing', this.hooksListing)),
      mcpAuthenticate: async (name: string, redirectUri?: string) => this.inspect('mcpAuthenticate', [name, redirectUri], () => this.runtimeAnswer('mcpAuthenticate', this.authAnswer)),
      mcpSubmitOAuthCallbackUrl: async (name: string, url: string) => this.inspect('mcpSubmitOAuthCallbackUrl', [name, url], () => ({})),
      mcpClearAuth: async (name: string) => this.inspect('mcpClearAuth', [name], () => ({})),
      // Like the real CLI (smoke:rewind), only the dry run lists the files: the applied rewind reports none.
      rewindFiles: async (userMessageId: string, options?: { dryRun?: boolean }) => {
        this.rewindCalls.push({ userMessageId, dryRun: options?.dryRun })
        const result = this.rewindResults.get(userMessageId) ?? { canRewind: false, error: 'No file checkpoint found for this message.' }
        return options?.dryRun || !result.canRewind ? result : { ...result, filesChanged: [], insertions: 0, deletions: 0 }
      },
      close: () => {
        record('close', [])
        this.closed = true
        this.exit()
      }
    }) as unknown as Query
  }

  // Reads the permission rules and extra folders of the user, project and local settings files (absent or invalid
  // files count as empty) plus the allowedTools / additionalDirectories options, as list_permission_rules shows them.
  readPermissionFiles(): void {
    const cwd = this.options.cwd ?? ''
    const files = [
      ['userSettings', this.userSettingsDir && join(this.userSettingsDir, 'settings.json')],
      ['projectSettings', join(cwd, '.claude', 'settings.json')],
      ['localSettings', join(cwd, '.claude', 'settings.local.json')]
    ] as const
    const rules: object[] = (this.options.allowedTools ?? []).map((rule) => ({ behavior: 'allow', source: 'cliArg', rule, editability: 'session' }))
    const workspaceDirectories: object[] = (this.options.additionalDirectories ?? []).map((path) => ({ path, source: 'cliArg' }))
    for (const [source, file] of files) {
      let permissions: Record<string, unknown> = {}
      try {
        permissions = (file && JSON.parse(readFileSync(file, 'utf8')).permissions) || {}
      } catch {}
      for (const behavior of ['allow', 'ask', 'deny']) {
        for (const rule of (permissions[behavior] as string[] | undefined) ?? []) rules.push({ behavior, source, rule, editability: 'persistent' })
      }
      for (const path of (permissions.additionalDirectories as string[] | undefined) ?? []) workspaceDirectories.push({ path, source })
    }
    this.filePermissions = { state: { rules, workspaceDirectories, originalCwd: cwd, managedOnly: false } }
  }

  // An inspection call: recorded, rejected when its method is in rejectMethods, else answered by `answer`.
  private inspect<T>(method: string, args: unknown[], answer: () => T): T {
    this.calls.push({ method, args })
    const error = this.rejectMethods.get(method)
    if (error) throw error
    this.inspectEffects.get(method)?.(args)
    return answer()
  }

  // The answer of a runtime-only method, or the CLI's "not available" when the answer was set to undefined.
  private runtimeAnswer<T>(method: string, answer: T): NonNull<T> {
    if (answer === undefined) throw new Error(`${method} is not available`)
    return answer as NonNull<T>
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

// aiTitle: the title the CLI generates after the first prompt (getSessionInfo reports it as customTitle).
type StoredInfo = { cwd?: string; customTitle?: string; aiTitle?: string; lastModified: number }

// Summary of a stored session like the CLI's: the first user text.
function summaryOf(history: SessionMessage[]): string {
  const first = history.find((message) => message.type === 'user')
  const content = (first?.message as { content?: unknown } | undefined)?.content
  return typeof content === 'string' ? content.slice(0, 200) : 'Session'
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
    const customTitle = stored.customTitle ?? stored.aiTitle
    return { sessionId, summary: customTitle ?? summaryOf(history), lastModified: stored.lastModified, customTitle, firstPrompt: summaryOf(history), cwd: stored.cwd }
  }
  // Like the CLI resuming at a message: the stored chain keeps that message and drops what follows; new records are
  // appended after it. sessionId: the resumed session; uuid: the message to keep last (unknown uuid: no change).
  const truncateAt = (sessionId: string, uuid: string) => {
    const history = histories.get(sessionId)
    const index = history?.findIndex((message) => message.uuid === uuid) ?? -1
    if (history && index >= 0) history.splice(index + 1)
  }
  // Settings files in effect (set to change them): the user's and the project's.
  const settingsSources: { source: 'user' | 'project' | 'local' | 'managed' | 'flag'; path?: string }[] = [{ source: 'user', path: '/home/user/.claude/settings.json' }, { source: 'project', path: '/work/.claude/settings.json' }]
  // Results of rewindFiles for the sessions created from now on (see FakeSession.rewindResults).
  const rewindResults = new Map<string, RewindFilesResult>()
  // Folder of the userSettings file the sessions created from now on read (see FakeSession.userSettingsDir).
  const settings: { userDir?: string } = {}
  return {
    sessions,
    histories,
    rewindResults,
    settings,
    infos,
    query: ((params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
      const session = new FakeSession(params.options ?? {}, params.prompt)
      sessions.push(session)
      for (const [id, result] of rewindResults) session.rewindResults.set(id, result)
      session.userSettingsDir = settings.userDir
      session.readPermissionFiles()
      const { resume, resumeSessionAt } = params.options ?? {}
      if (resume && resumeSessionAt) truncateAt(resume, resumeSessionAt)
      return session.asQuery()
    }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
    getSessionMessages: async (sessionId: string) => histories.get(sessionId) ?? [],
    getSessionInfo: async (sessionId: string) => info(sessionId),
    settingsSources,
    resolveSettings: async () => ({ effective: {}, provenance: {}, sources: settingsSources.map((entry) => ({ ...entry, settings: {} })) }),
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
