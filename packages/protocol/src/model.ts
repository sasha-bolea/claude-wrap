import { z } from 'zod'

// Data shared by core and clients: transcript items, tab metadata, requests, stream events and snapshots.

export const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const
export const permissionModeSchema = z.enum(PERMISSION_MODES)

export const TAB_STATUSES = ['dormant', 'starting', 'idle', 'running', 'requires_action', 'closing', 'needs_trust', 'error'] as const

// Reasoning effort levels of the CLI (/effort); each model offers some of them (ModelInfo.supportedEffortLevels).
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const effortSchema = z.enum(EFFORT_LEVELS)

// ---- Transcript items (normalized in core: clients never see SDK messages) ----

const itemBase = { itemId: z.string(), sourceUuid: z.string().optional() }

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
// An image of a user message, by reference: the bytes stay in the tab's blob store (`blob.get`).
export const imageRefSchema = z.object({ imageId: z.string(), mediaType: z.enum(IMAGE_TYPES) })

export const itemSchema = z.discriminatedUnion('kind', [
  // pending: sent while Claude works, not read yet (the CLI reads it at its next step).
  z.object({ ...itemBase, kind: z.literal('user'), text: z.string(), images: z.array(imageRefSchema).optional(), from: z.string().optional(), pending: z.boolean().optional() }),
  z.object({ ...itemBase, kind: z.literal('assistantText'), text: z.string() }),
  z.object({ ...itemBase, kind: z.literal('thinking'), text: z.string() }),
  // itemId is the tool_use id.
  z.object({ ...itemBase, kind: z.literal('toolCall'), name: z.string(), input: z.unknown(), result: z.string().optional(), isError: z.boolean().optional() }),
  z.object({
    ...itemBase,
    kind: z.literal('turnEnd'),
    costUsd: z.number().optional(),
    durationMs: z.number().optional(),
    interrupted: z.boolean().optional(),
    error: z.string().optional()
  }),
  z.object({ ...itemBase, kind: z.literal('notice'), level: z.enum(['info', 'warning', 'error']), text: z.string() }),
  z.object({ ...itemBase, kind: z.literal('compactBoundary') }),
  z.object({ ...itemBase, kind: z.literal('localCommandOutput'), text: z.string() }),
  // A `!` shell command run by core in the tab's folder; exitCode undefined while it runs.
  z.object({ ...itemBase, kind: z.literal('shell'), command: z.string(), output: z.string(), exitCode: z.number().optional() })
])

// ---- Requests from Claude that wait for an answer (permission, question, plan approval) ----

export const requestSchema = z.object({
  requestId: z.string(),
  kind: z.enum(['permission', 'question', 'plan']),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  toolUseId: z.string(),
  // True when the CLI offered "don't ask again" rules for this request.
  canAllowAlways: z.boolean(),
  title: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  decisionReason: z.string().optional(),
  blockedPath: z.string().optional(),
  defaultToNo: z.boolean().optional(),
  agentId: z.string().optional()
})

// ---- Tabs (workspace stream) ----

// A message of the tab's queue (queue mode of the composer). images: how many it carries (the bytes stay in core).
export const queuedMessageSchema = z.object({ queueId: z.string(), text: z.string(), images: z.number().int().optional(), from: z.string().optional() })
// Why the queue waits: paused by hand (⏸), after Stop, or by a usage limit until `until` (ms).
export const queuePauseSchema = z.object({ reason: z.enum(['user', 'stop', 'limit']), until: z.number().optional() })

// A plan usage window: percentage used (0-100) and when it resets (ISO 8601), each null when unknown.
export const limitWindowSchema = z.object({ utilization: z.number().nullable(), resetsAt: z.string().nullable() })

export const tabMetaSchema = z.object({
  tabId: z.string(),
  title: z.string(),
  cwd: z.string(),
  sessionId: z.string().optional(),
  status: z.enum(TAB_STATUSES),
  // model: last requested (may be an alias, passed at spawn); activeModel: what the CLI reports it is using.
  model: z.string().optional(),
  activeModel: z.string().optional(),
  // undefined = the model's default effort.
  effort: effortSchema.optional(),
  mode: permissionModeSchema,
  queue: z.array(queuedMessageSchema),
  queuePause: queuePauseSchema.optional(),
  pendingRequests: z.number().int().nonnegative(),
  error: z.string().optional(),
  // The Claude account the session runs with (an accountId); undefined = Claude Code's own login of the backend.
  account: z.string().optional(),
  // That account reached its usage limit, until this time (ms).
  limitedUntil: z.number().optional(),
  // Claude was stopped in the middle of its work by a usage limit or by an account switch: once the account is free
  // (no limitedUntil) the chat offers "Continua", which resumes every session stopped this way.
  interrupted: z.enum(['limit', 'switch']).optional(),
  // Gauges for the composer, kept by core without starting a process: the context window after the last turn, and
  // the plan windows of the session's account (5 hours, week) as last read.
  context: z.object({ percentage: z.number(), totalTokens: z.number(), maxTokens: z.number() }).optional(),
  // The next queued message goes at `until` (ms) unless stopped: a countdown shown while someone looks at the chat.
  queueCountdown: z.object({ queueId: z.string(), until: z.number() }).optional(),
  planLimits: z.object({ fiveHour: limitWindowSchema.optional(), sevenDay: limitWindowSchema.optional() }).optional()
})

// A Claude account of the backend added with a token made by `claude setup-token` (the token never leaves core).
export const accountSchema = z.object({ accountId: z.string(), name: z.string(), addedAt: z.number() })

// Home of the backend: the folder sessions live under (remote server), or the folders added on this PC.
export const homeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('root'), path: z.string() }),
  z.object({ kind: z.literal('added'), folders: z.array(z.string()) })
])

// A terminal of the backend: a shell in a folder (a session's, tabId, or one of the Home), shared by every client.
// cols/rows: its size (the last client that resized it wins); exitCode: the shell ended (it stays until closed).
export const terminalMetaSchema = z.object({
  terminalId: z.string(),
  cwd: z.string(),
  title: z.string(),
  tabId: z.string().optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  createdAt: z.number(),
  exitCode: z.number().int().optional()
})

// ---- Stream events and snapshots ----

// Bounds of Claude Code's auto-compact window (tokens), as /autocompact and --autocompact accept it.
export const AUTO_COMPACT_WINDOW = { min: 100_000, max: 1_000_000 } as const

export const workspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tab.added'), tab: tabMetaSchema }),
  z.object({ type: z.literal('tab.updated'), tab: tabMetaSchema }),
  z.object({ type: z.literal('tab.removed'), tabId: z.string() }),
  z.object({ type: z.literal('tab.moved'), tabId: z.string(), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal('turn.finished'), tabId: z.string() }),
  // The home or the project folders changed (any client may have changed them).
  z.object({ type: z.literal('folders.updated'), home: homeSchema, projects: z.array(z.string()) }),
  // The notes of a folder changed: clients showing them read them again.
  z.object({ type: z.literal('notes.changed'), cwd: z.string() }),
  // The accounts or the default one changed (defaultAccount undefined = Claude Code's own login).
  z.object({ type: z.literal('accounts.updated'), accounts: z.array(accountSchema), defaultAccount: z.string().optional() }),
  // Backend settings for every session changed (autoCompactWindow undefined = Claude Code's own setting).
  z.object({ type: z.literal('settings.updated'), autoCompactWindow: z.number().int().optional() }),
  z.object({ type: z.literal('terminal.added'), terminal: terminalMetaSchema }),
  z.object({ type: z.literal('terminal.updated'), terminal: terminalMetaSchema }),
  z.object({ type: z.literal('terminal.removed'), terminalId: z.string() })
])

export const tabEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item.added'), item: itemSchema }),
  z.object({ type: z.literal('item.updated'), item: itemSchema }),
  // Streaming text appended to an assistantText / thinking item.
  z.object({ type: z.literal('item.text'), itemId: z.string(), append: z.string() }),
  z.object({ type: z.literal('request.opened'), request: requestSchema }),
  z.object({ type: z.literal('request.resolved'), requestId: z.string(), by: z.string(), outcome: z.enum(['allow', 'allowAlways', 'deny']) }),
  z.object({ type: z.literal('request.cancelled'), requestId: z.string() })
])

// A terminal's stream: what the shell writes (raw, escape sequences included) and its end.
export const terminalEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('terminal.output'), data: z.string() }),
  z.object({ type: z.literal('terminal.exit'), exitCode: z.number().int() })
])

export const workspaceSnapshotSchema = z.object({
  kind: z.literal('workspace'),
  tabs: z.array(tabMetaSchema),
  home: homeSchema,
  projects: z.array(z.string()),
  accounts: z.array(accountSchema),
  defaultAccount: z.string().optional(),
  // Claude Code's auto-compact window set for every session (tokens); undefined = Claude Code's own setting.
  autoCompactWindow: z.number().int().optional(),
  // Absent from an older backend: none.
  terminals: z.array(terminalMetaSchema).default([])
})
// screen: the recent output (bounded), written again into the client's terminal from a clean line.
export const terminalSnapshotSchema = z.object({ kind: z.literal('terminal'), terminal: terminalMetaSchema, screen: z.string() })
export const tabSnapshotSchema = z.object({ kind: z.literal('tab'), items: z.array(itemSchema), hasMore: z.boolean(), requests: z.array(requestSchema) })

// ---- Stored sessions and folder trust ----

export const sessionInfoSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  lastModified: z.number(),
  // Folder of the session (in the list of every folder's sessions).
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  // The tab that has this session open, if any.
  tabId: z.string().optional()
})

// What opening a session in a folder would load and run (shown in the trust dialog).
export const projectConfigSchema = z.object({
  hooks: z.array(z.string()),
  mcp: z.array(z.string()),
  permissions: z.array(z.string()),
  risks: z.array(z.string()),
  files: z.array(z.string())
})

export const WORKSPACE_STREAM = 'workspace'
// Name of the transcript stream of one tab.
// Context window of a session, as /context shows it: tokens in use over the window, rows by category ('used' fill
// the window, 'free' is what is left, 'buffer' the compaction reserve, 'deferred' tool schemas outside it), and the
// memory files and MCP servers that weigh on it.
export const contextUsageSchema = z.object({
  model: z.string(),
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  categories: z.array(z.object({ name: z.string(), tokens: z.number(), kind: z.enum(['used', 'free', 'buffer', 'deferred']) })),
  autoCompact: z.boolean(),
  autoCompactThreshold: z.number().optional(),
  memoryFiles: z.array(z.object({ path: z.string(), type: z.string(), tokens: z.number() })),
  mcpServers: z.array(z.object({ name: z.string(), tools: z.number(), tokens: z.number() }))
})

// Cost and usage of a session, and the plan's usage limits of its account, as /usage shows them. limits is null
// where plan limits do not apply (API key) or could not be read.
export const usageSchema = z.object({
  session: z.object({
    costUsd: z.number(),
    durationMs: z.number(),
    apiDurationMs: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    models: z.array(z.object({ model: z.string(), inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheWriteTokens: z.number(), costUsd: z.number() }))
  }),
  subscription: z.string().nullable(),
  limits: z
    .object({
      fiveHour: limitWindowSchema.optional(),
      sevenDay: limitWindowSchema.optional(),
      sevenDayOpus: limitWindowSchema.optional(),
      sevenDaySonnet: limitWindowSchema.optional(),
      models: z.array(limitWindowSchema.extend({ name: z.string() })),
      extra: z.object({ enabled: z.boolean(), utilization: z.number().nullable(), usedCredits: z.number().nullable(), monthlyLimit: z.number().nullable(), currency: z.string().nullable() }).optional()
    })
    .nullable()
})

export const tabStream = (tabId: string) => `tab:${tabId}`
// Name of the output stream of one terminal.
export const terminalStream = (terminalId: string) => `terminal:${terminalId}`

export type PermissionMode = z.infer<typeof permissionModeSchema>
export type TabStatus = (typeof TAB_STATUSES)[number]
export type Item = z.infer<typeof itemSchema>
export type ImageRef = z.infer<typeof imageRefSchema>
export type ImageType = (typeof IMAGE_TYPES)[number]
export type Request = z.infer<typeof requestSchema>
export type QueuedMessage = z.infer<typeof queuedMessageSchema>
export type QueuePause = z.infer<typeof queuePauseSchema>
export type Effort = z.infer<typeof effortSchema>
export type Home = z.infer<typeof homeSchema>
export type TabMeta = z.infer<typeof tabMetaSchema>
export type Account = z.infer<typeof accountSchema>
export type WorkspaceEvent = z.infer<typeof workspaceEventSchema>
export type TabEvent = z.infer<typeof tabEventSchema>
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>
export type TabSnapshot = z.infer<typeof tabSnapshotSchema>
export type TerminalMeta = z.infer<typeof terminalMetaSchema>
export type TerminalEvent = z.infer<typeof terminalEventSchema>
export type TerminalSnapshot = z.infer<typeof terminalSnapshotSchema>
export type SessionInfo = z.infer<typeof sessionInfoSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>
export type ContextUsage = z.infer<typeof contextUsageSchema>
export type Usage = z.infer<typeof usageSchema>
export type LimitWindow = z.infer<typeof limitWindowSchema>
export type ContextGauge = NonNullable<TabMeta['context']>
export type PlanLimits = NonNullable<TabMeta['planLimits']>
