import { z } from 'zod'

// Data shared by core and clients: transcript items, tab metadata, requests, stream events and snapshots.

export const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const
export const permissionModeSchema = z.enum(PERMISSION_MODES)

export const TAB_STATUSES = ['dormant', 'starting', 'idle', 'running', 'requires_action', 'closing', 'needs_trust', 'error'] as const

// ---- Transcript items (normalized in core: clients never see SDK messages) ----

const itemBase = { itemId: z.string(), sourceUuid: z.string().optional() }

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
// An image of a user message, by reference: the bytes stay in the tab's blob store (`blob.get`).
export const imageRefSchema = z.object({ imageId: z.string(), mediaType: z.enum(IMAGE_TYPES) })

export const itemSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemBase, kind: z.literal('user'), text: z.string(), images: z.array(imageRefSchema).optional(), from: z.string().optional() }),
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

// images: how many images the message carries (the bytes stay in core).
export const queuedMessageSchema = z.object({ queueId: z.string(), text: z.string(), images: z.number().int().optional(), from: z.string().optional() })

export const tabMetaSchema = z.object({
  tabId: z.string(),
  title: z.string(),
  cwd: z.string(),
  sessionId: z.string().optional(),
  status: z.enum(TAB_STATUSES),
  // model: last requested (may be an alias, passed at spawn); activeModel: what the CLI reports it is using.
  model: z.string().optional(),
  activeModel: z.string().optional(),
  mode: permissionModeSchema,
  queue: z.array(queuedMessageSchema),
  pendingRequests: z.number().int().nonnegative(),
  error: z.string().optional()
})

// ---- Stream events and snapshots ----

export const workspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tab.added'), tab: tabMetaSchema }),
  z.object({ type: z.literal('tab.updated'), tab: tabMetaSchema }),
  z.object({ type: z.literal('tab.removed'), tabId: z.string() }),
  z.object({ type: z.literal('tab.moved'), tabId: z.string(), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal('turn.finished'), tabId: z.string() })
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

export const workspaceSnapshotSchema = z.object({ kind: z.literal('workspace'), tabs: z.array(tabMetaSchema) })
export const tabSnapshotSchema = z.object({ kind: z.literal('tab'), items: z.array(itemSchema), hasMore: z.boolean(), requests: z.array(requestSchema) })

// ---- Stored sessions and folder trust ----

export const sessionInfoSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  lastModified: z.number(),
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
export const tabStream = (tabId: string) => `tab:${tabId}`

export type PermissionMode = z.infer<typeof permissionModeSchema>
export type TabStatus = (typeof TAB_STATUSES)[number]
export type Item = z.infer<typeof itemSchema>
export type ImageRef = z.infer<typeof imageRefSchema>
export type ImageType = (typeof IMAGE_TYPES)[number]
export type Request = z.infer<typeof requestSchema>
export type QueuedMessage = z.infer<typeof queuedMessageSchema>
export type TabMeta = z.infer<typeof tabMetaSchema>
export type WorkspaceEvent = z.infer<typeof workspaceEventSchema>
export type TabEvent = z.infer<typeof tabEventSchema>
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>
export type TabSnapshot = z.infer<typeof tabSnapshotSchema>
export type SessionInfo = z.infer<typeof sessionInfoSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>
