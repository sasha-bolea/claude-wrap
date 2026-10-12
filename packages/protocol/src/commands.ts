import { z } from 'zod'
import { AUTO_COMPACT_WINDOW, EFFORT_LEVELS, IMAGE_TYPES, contextUsageSchema, effortSchema, itemSchema, paletteColorsSchema, paletteSchema, permissionModeSchema, projectConfigSchema, sessionInfoSchema, usageSchema } from './model.ts'
import { actionSourceSchema, coreActionNameSchema, folderNameSchema } from './actions.ts'
import { widgetInfoSchema, widgetNameSchema } from './widgets.ts'

// Commands a client can send (`{t:'cmd', id, name, args}`), with the schema of their args and result.

const tabId = z.string().min(1)
const empty = z.object({})
// Columns or rows of a terminal.
const terminalSize = z.number().int().min(2).max(1000)
// A path inside the session's folder, relative to it ('' = the folder itself).
const relativePath = z.string()

// Inspection panels (/status, /mcp, /hooks). Strings come from the CLI or from configuration files (untrusted): core
// caps their length, the caps are part of the contract.
export const INSPECT_LIMITS = { text: 2000, name: 200, output: 4000, url: 4096, hooks: 50 } as const
const shortText = z.string().max(INSPECT_LIMITS.text)
const serverName = z.string().min(1).max(INSPECT_LIMITS.name)
export const statusSchema = z.object({
  sections: z.array(z.object({ title: z.string().max(INSPECT_LIMITS.name), rows: z.array(z.object({ label: z.string().max(INSPECT_LIMITS.name), value: shortText })) })),
  settingsFiles: z.array(z.object({ source: z.string().max(INSPECT_LIMITS.name), path: shortText }))
})
export const mcpServerSchema = z.object({
  name: serverName,
  status: z.enum(['connected', 'failed', 'needs-auth', 'pending', 'disabled']),
  error: shortText.optional(),
  scope: z.string().max(INSPECT_LIMITS.name).optional(),
  source: z.string().max(INSPECT_LIMITS.name).optional(),
  tools: z.number(),
  url: shortText.optional()
})
export const hookEntrySchema = z.object({
  event: z.string().max(INSPECT_LIMITS.name),
  matcher: shortText.optional(),
  source: z.string().max(INSPECT_LIMITS.name),
  sourceLabel: shortText.optional(),
  type: z.string().max(INSPECT_LIMITS.name),
  commandText: shortText.optional(),
  timeout: z.number().optional(),
  disabled: z.boolean().optional()
})
export const hookRunSchema = z.object({
  at: z.number(),
  event: z.string().max(INSPECT_LIMITS.name),
  name: z.string().max(INSPECT_LIMITS.text),
  outcome: z.enum(['success', 'error', 'cancelled']),
  exitCode: z.number().optional(),
  stdout: z.string().max(INSPECT_LIMITS.output).optional(),
  stderr: z.string().max(INSPECT_LIMITS.output).optional()
})
export const hooksSchema = z.object({
  listing: z.object({
    hooks: z.array(hookEntrySchema),
    policy: z.object({ allDisabled: z.boolean(), managedOnly: z.boolean(), disabledByPolicy: z.boolean(), pluginOnly: z.boolean() }).optional(),
    safeMode: z.object({ exitHint: shortText.optional() }).optional()
  }),
  runs: z.array(hookRunSchema)
})
// /permissions: the session's live rules (settings files, session approvals, flags, policy) with their source and the
// CLI's plain-language reading, plus the extra working folders. editable: persistent = saved in a settings file (core
// can remove it), session = in memory for this session only, readonly = policy or flag.
export const PERMISSION_BEHAVIORS = ['allow', 'ask', 'deny'] as const
export const SETTINGS_DESTINATIONS = ['localSettings', 'projectSettings', 'userSettings'] as const
const permissionBehavior = z.enum(PERMISSION_BEHAVIORS)
const settingsDestination = z.enum(SETTINGS_DESTINATIONS)
export const permissionRuleSchema = z.object({
  behavior: permissionBehavior,
  source: z.string().max(INSPECT_LIMITS.name),
  rule: shortText,
  description: z.object({ prefix: shortText, emphasis: shortText.optional(), suffix: shortText.optional() }).optional(),
  editable: z.enum(['persistent', 'session', 'readonly']),
  notInEffect: z.boolean().optional()
})
export const permissionsSchema = z.object({
  rules: z.array(permissionRuleSchema),
  directories: z.array(z.object({ path: shortText, source: z.string().max(INSPECT_LIMITS.name) })),
  cwd: shortText,
  managedOnly: z.boolean()
})
// /config: the Claude Code settings that change Claude in AtHome too, under their /config names, as saved in the user's
// settings file (absent = Claude Code's default). Not here: the permission mode and effort (AtHome has its own defaults
// for new sessions), checkpoints (rewind needs them), the output style (per folder), keys kept in ~/.claude.json and
// terminal-only ones.
export const CLAUDE_MODELS = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'] as const
export const claudeSettingsSchema = z.object({
  model: z.enum(CLAUDE_MODELS),
  thinking: z.boolean(),
  language: z.string().max(100),
  autoCompact: z.boolean(),
  useAutoModeDuringPlan: z.boolean(),
  workflows: z.boolean(),
  workflowKeywordTriggerEnabled: z.boolean(),
  worktreeBaseRef: z.enum(['fresh', 'head'])
})
// One change: a key and its new value ('' language = Claude Code's default).
export const claudeSettingChangeSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('model'), value: z.enum(CLAUDE_MODELS) }),
  z.object({ key: z.literal('language'), value: z.string().trim().max(100).regex(/^[^\u0000-\u001f\u007f]*$/) }),
  z.object({ key: z.literal('worktreeBaseRef'), value: z.enum(['fresh', 'head']) }),
  ...(['thinking', 'autoCompact', 'useAutoModeDuringPlan', 'workflows', 'workflowKeywordTriggerEnabled'] as const).map((key) => z.object({ key: z.literal(key), value: z.boolean() }))
])
// /memory: the instruction files the session loads (CLAUDE.md and the files they import, including ones not created
// yet), the auto-memory folder and its saved memories, and whether auto memory is on. Only paths the CLI lists can be
// read; instruction files can be written, memories deleted (MEMORY.md, their index, cannot).
export const MEMORY_LIMITS = { textBytes: 512 * 1024 } as const
export const memorySchema = z.object({
  files: z.array(z.object({ kind: z.string().max(INSPECT_LIMITS.name), path: shortText, label: shortText, description: shortText, exists: z.boolean() })),
  folder: shortText.optional(),
  memories: z.array(z.object({ name: shortText, path: shortText, description: shortText, type: z.string().max(INSPECT_LIMITS.name).optional(), modifiedAt: z.number().optional() })),
  autoMemory: z.boolean()
})
export type Status = z.infer<typeof statusSchema>
export type McpServer = z.infer<typeof mcpServerSchema>
export type HookEntry = z.infer<typeof hookEntrySchema>
export type HookRun = z.infer<typeof hookRunSchema>
export type Hooks = z.infer<typeof hooksSchema>
export type ClaudeSettings = z.infer<typeof claudeSettingsSchema>
export type ClaudeSettingChange = z.infer<typeof claudeSettingChangeSchema>
export type Memory = z.infer<typeof memorySchema>
export type PermissionRule = z.infer<typeof permissionRuleSchema>
export type Permissions = z.infer<typeof permissionsSchema>
export type PermissionBehavior = (typeof PERMISSION_BEHAVIORS)[number]
export type SettingsDestination = (typeof SETTINGS_DESTINATIONS)[number]

// supportedEffortLevels: the effort levels the model offers (none: no effort selector).
export const modelInfoSchema = z.looseObject({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  resolvedModel: z.string().optional(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(z.enum(EFFORT_LEVELS)).optional()
})
export const slashCommandSchema = z.looseObject({ name: z.string(), description: z.string(), argumentHint: z.string() })
// An image attached to a message: base64 bytes (size limits checked by core, LIMITS in index.ts).
export const imageSchema = z.object({ mediaType: z.enum(IMAGE_TYPES), data: z.string().min(1) })
export const promptSchema = z.object({ text: z.string(), timestamp: z.number() })
// A paired device of the remote server; current = the device asking.
export const deviceSchema = z.object({ deviceId: z.string(), name: z.string(), createdAt: z.number(), lastSeenAt: z.number().optional(), current: z.boolean(), createdBy: z.string().optional() })
// The devices a revoke of rootId removes: rootId and, recursively, the devices created by a removed one. The device
// asking (requesterId) is never removed and the walk does not pass through it, so its own devices stay too.
export function revokeCascade(devices: { deviceId: string; createdBy?: string }[], rootId: string, requesterId?: string): Set<string> {
  const removed = new Set([rootId])
  for (let grew = true; grew; ) {
    grew = false
    for (const device of devices) {
      if (device.createdBy && removed.has(device.createdBy) && !removed.has(device.deviceId) && device.deviceId !== requesterId) grew = Boolean(removed.add(device.deviceId))
    }
  }
  return removed
}
const folderName = folderNameSchema
// A subfolder in the Home: project = marked as a project (same mark on every device).
export const folderEntrySchema = z.object({ name: z.string(), path: z.string(), project: z.boolean() })
// An entry of the file explorer; modified in ms.
export const fileEntrySchema = z.object({ name: z.string(), kind: z.enum(['file', 'folder']), size: z.number(), modified: z.number() })
// Something deleted to the app's trash (remote server), restorable until expiresAt (ms).
export const trashItemSchema = z.object({ id: z.string(), path: z.string(), kind: z.enum(['file', 'folder']), deletedAt: z.number(), expiresAt: z.number() })
// A note of a folder; times in ms.
export const noteSchema = z.object({ noteId: z.string(), text: z.string(), createdAt: z.number(), updatedAt: z.number() })
// Args of a file command: its own fields plus where it works, a tab's folder or a folder of the Home (exactly one).
const place = z.object({ tabId: tabId.optional(), folder: z.string().min(1).optional() })
type Place = z.infer<typeof place>
const filePlace = <Shape extends z.ZodRawShape>(shape: Shape) =>
  place.extend(shape).refine((args) => ((args as Place).tabId === undefined) !== ((args as Place).folder === undefined), { message: 'one of tabId and folder' })
// What the queue or a send carries besides the text.
const message = { text: z.string(), images: z.array(imageSchema).optional(), pastes: z.array(z.string()).optional() }

export const COMMANDS = {
  'tab.create': {
    // tabId is generated by the client; a duplicate returns the existing tab, and so does a session another tab owns.
    args: z.object({
      tabId,
      cwd: z.string().min(1),
      resume: z.string().optional(),
      title: z.string().optional(),
      model: z.string().optional(),
      mode: permissionModeSchema.optional()
    }),
    result: z.object({ tabId: z.string() })
  },
  'tab.close': { args: z.object({ tabId }), result: empty },
  // Renames the tab and, when it has one, its stored session.
  'tab.rename': { args: z.object({ tabId, title: z.string().trim().min(1) }), result: empty },
  'tab.reorder': { args: z.object({ tabId, index: z.number().int().nonnegative() }), result: empty },
  // Copies the session (up to an item, if given) into a new tab; refused while the tab runs.
  'tab.fork': { args: z.object({ tabId, newTabId: tabId, upToItemId: z.string().optional() }), result: z.object({ tabId: z.string() }) },
  // Restarts a tab whose process died: the transcript is reloaded from the stored session (new epoch).
  'tab.restart': { args: z.object({ tabId }), result: empty },
  // The snapshot arrives as a `reset` frame on the tab stream, before this reply.
  'tab.subscribe': { args: z.object({ tabId }), result: empty },
  'tab.unsubscribe': { args: z.object({ tabId }), result: empty },
  'tab.history': {
    args: z.object({ tabId, beforeItemId: z.string(), limit: z.number().int().positive().max(1000).optional() }),
    result: z.object({ items: z.array(itemSchema), hasMore: z.boolean() })
  },
  // The cmd id becomes the SDK user-message uuid and the user item id. Sent while Claude works, it goes to the CLI
  // at once and is read at its next step (the item is `pending` until then), as in the terminal.
  // pastes: long pasted texts that are still inside `text` (the CLI may wrap them in <pasted_content>).
  'tab.send': {
    args: z.object({ tabId, ...message }).refine((args) => args.text.trim() || args.images?.length, 'empty message'),
    result: empty
  },
  // The tab's queue (queue mode of the composer); the cmd id is the queueId. Messages go one at a time when
  // Claude is free; added while it is free and the queue is not paused, the first goes at once.
  'tab.queueAdd': {
    args: z.object({ tabId, ...message }).refine((args) => args.text.trim() || args.images?.length, 'empty message'),
    result: empty
  },
  'tab.queueEdit': { args: z.object({ tabId, queueId: z.string(), text: z.string() }), result: empty },
  'tab.queueMove': { args: z.object({ tabId, queueId: z.string(), index: z.number().int().nonnegative() }), result: empty },
  'tab.unqueue': { args: z.object({ tabId, queueId: z.string() }), result: empty },
  // Stops the countdown of the next queued message: it leaves the queue and comes back (text, images) for the
  // composer; the rest of the queue waits (paused) until ▶.
  'tab.queueHold': { args: z.object({ tabId, queueId: z.string() }), result: z.object({ text: z.string(), images: z.array(imageSchema).optional() }) },
  // Takes a message out of the queue and sends it now (read at Claude's next step: nothing is interrupted).
  'tab.sendNow': { args: z.object({ tabId, queueId: z.string() }), result: empty },
  // ⏸ / ▶ of the queue (▶ also ends a pause after Stop or a usage limit).
  'tab.queuePause': { args: z.object({ tabId, paused: z.boolean() }), result: empty },
  // Runs a `!` command in the tab's folder; output becomes a shell item and context for Claude's next turn.
  'tab.shell': { args: z.object({ tabId, command: z.string().trim().min(1) }), result: z.object({ exitCode: z.number() }) },
  // Files and folders of the tab's folder matching a query, best first (`@` mentions).
  'tab.suggestFiles': { args: z.object({ tabId, query: z.string() }), result: z.object({ paths: z.array(z.string()) }) },
  'blob.get': { args: z.object({ tabId, imageId: z.string() }), result: imageSchema },
  'tab.interrupt': { args: z.object({ tabId }), result: empty },
  // "Send now" on a message sent while Claude works and not read yet (its user item is pending): the CLI's own
  // send-now, so that Claude reads it now instead of at its next step. Not a Stop: the queue is not paused.
  'tab.sendPendingNow': { args: z.object({ tabId, itemId: z.string().min(1) }), result: empty },
  // Withdraws a message the CLI has not read yet: it leaves the chat and its text (and images) come back for the composer.
  // Fails (invalid_args) when the message is not waiting or the CLI read it meanwhile.
  'tab.unsendPending': { args: z.object({ tabId, itemId: z.string().min(1) }), result: z.object({ text: z.string(), images: z.array(imageSchema).optional() }) },
  // The Claude account, picked in a session (undefined = Claude Code's own login): one for every session and the new
  // ones. Conversations stay: an idle process restarts at the next message on the same stored session; one at work
  // is stopped now and marked `interrupted: 'switch'` (see tabs.continue).
  'tab.setAccount': { args: z.object({ tabId, accountId: z.string().optional() }), result: empty },
  // model undefined = the default model. An effort level the new model does not offer moves to its highest one below.
  'tab.setModel': { args: z.object({ tabId, model: z.string().optional() }), result: empty },
  // Reasoning effort (as /effort); undefined = the model's default.
  'tab.setEffort': { args: z.object({ tabId, effort: effortSchema.optional() }), result: empty },
  'tab.setMode': { args: z.object({ tabId, mode: permissionModeSchema }), result: empty },
  'tab.models': { args: z.object({ tabId }), result: z.object({ models: z.array(modelInfoSchema) }) },
  'tab.commands': { args: z.object({ tabId }), result: z.object({ commands: z.array(slashCommandSchema) }) },
  // The session's context window (as /context) and its cost with the account's plan limits (as /usage); a dormant
  // tab starts its process to answer (no message is sent).
  'tab.context': { args: z.object({ tabId }), result: contextUsageSchema },
  'tab.usage': { args: z.object({ tabId }), result: usageSchema },
  // Native panels. tab.status: /status sections + the settings files in effect; tab.mcp: MCP servers and their state;
  // reconnect / toggle / auth act on one server by name; mcpAuth returns the http(s) page to open (the user signs in
  // there), mcpAuthCallback hands back the redirect URL when the callback cannot reach core; tab.hooks: configured
  // hooks and the last runs of this tab (newest last). Like tab.context, a dormant tab starts its process (no message).
  'tab.status': { args: z.object({ tabId }), result: statusSchema },
  'tab.mcp': { args: z.object({ tabId }), result: z.object({ servers: z.array(mcpServerSchema) }) },
  'tab.mcpReconnect': { args: z.object({ tabId, name: serverName }), result: empty },
  'tab.mcpToggle': { args: z.object({ tabId, name: serverName, enabled: z.boolean() }), result: empty },
  'tab.mcpAuth': { args: z.object({ tabId, name: serverName }), result: z.object({ authUrl: z.string().max(INSPECT_LIMITS.url), callbackExpected: z.boolean() }) },
  'tab.mcpAuthCallback': { args: z.object({ tabId, name: serverName, url: z.string().max(INSPECT_LIMITS.url) }), result: empty },
  'tab.mcpClearAuth': { args: z.object({ tabId, name: serverName }), result: empty },
  'tab.hooks': { args: z.object({ tabId }), result: hooksSchema },
  // /permissions. permissionRule / permissionDirectory add to or remove from one settings file (local = this folder,
  // only for you; project = this folder, checked in; user = every folder), then every live session takes the files
  // again. Removing looks for the exact stored text; adding something already there changes nothing.
  // /memory. memoryRead: a listed file's text and its version ('' and exists false for a file not created yet);
  // memoryWrite saves an instruction file when it is still at that version (invalid_args when it changed meanwhile) and
  // returns the new one; memoryDelete moves a saved memory to the trash and takes its line out of MEMORY.md;
  // setAutoMemory saves autoMemoryEnabled in the user's settings (as /memory does). Changes to instruction files reach
  // the sessions started afterwards.
  'tab.memory': { args: z.object({ tabId }), result: memorySchema },
  'tab.memoryRead': { args: z.object({ tabId, path: shortText.min(1) }), result: z.object({ text: z.string(), exists: z.boolean(), version: z.string() }) },
  'tab.memoryWrite': { args: z.object({ tabId, path: shortText.min(1), text: z.string().max(MEMORY_LIMITS.textBytes), version: z.string() }), result: z.object({ version: z.string() }) },
  'tab.memoryDelete': { args: z.object({ tabId, path: shortText.min(1) }), result: empty },
  'tab.setAutoMemory': { args: z.object({ tabId, enabled: z.boolean() }), result: empty },
  'tab.permissions': { args: z.object({ tabId }), result: permissionsSchema },
  'tab.permissionRule': { args: z.object({ tabId, op: z.enum(['add', 'remove']), behavior: permissionBehavior, rule: shortText.min(1), destination: settingsDestination }), result: empty },
  'tab.permissionDirectory': { args: z.object({ tabId, op: z.enum(['add', 'remove']), path: shortText.min(1), destination: settingsDestination }), result: empty },
  // Points where a conversation can be rewound to: a message and its text summary.
  'tab.rewindPoints': { args: z.object({ tabId }), result: z.object({ points: z.array(z.object({ itemId: z.string(), text: z.string(), images: z.number().optional() })) }) },
  // Preview of what a rewind would do: whether it's possible and what files would change.
  'tab.rewindPreview': { args: z.object({ tabId, itemId: z.string() }), result: z.object({ canRewind: z.boolean(), error: z.string().optional(), filesChanged: z.array(z.string()).optional(), insertions: z.number().optional(), deletions: z.number().optional() }) },
  // Rewind a conversation to a specific message: restores conversation, code, or both. newTabId: set when rewinding
  // the conversation to the first message opens a new empty session.
  'tab.rewind': { args: z.object({ tabId, itemId: z.string(), mode: z.enum(['both', 'conversation', 'code']) }), result: z.object({ text: z.string().optional(), images: z.array(imageSchema).optional(), filesChanged: z.array(z.string()).optional(), skippedLinks: z.number().optional(), newTabId: z.string().optional() }) },
  // Reads the composer's gauges again (TabMeta.context, planLimits) from the session's live process, or (dormant) the
  // plan windows through a live session of the same account; starts none.
  // Claude Code's auto-compact window for every session (as /autocompact; tokens, clamped by the CLI to the model's
  // window): passed at spawn and applied to live sessions. undefined = Claude Code's own setting applies.
  'settings.setAutoCompactWindow': { args: z.object({ tokens: z.number().int().min(AUTO_COMPACT_WINDOW.min).max(AUTO_COMPACT_WINDOW.max).optional() }), result: empty },
  // Effort and permission mode of the sessions created from now on (not forks: they keep their source's); a mode or
  // effort given at creation wins. undefined = the model's effort, the 'default' mode.
  'settings.setDefaultEffort': { args: z.object({ effort: effortSchema.optional() }), result: empty },
  'settings.setDefaultMode': { args: z.object({ mode: permissionModeSchema.optional() }), result: empty },
  // Chat widgets on or off: on, every session spawned from now on gets the widget guide appended to its system prompt
  // and /creawidget is installed in ~/.claude/commands (live sessions restart at the end of their turn).
  'settings.setWidgets': { args: z.object({ on: z.boolean() }), result: empty },
  // The widget library (~/.claude/widgets) by name, and the guide's approximate size in tokens (shown before turning
  // widgets on); a widget's HTML.
  'widgets.list': { args: empty, result: z.object({ widgets: z.array(widgetInfoSchema), guideTokens: z.number().int() }) },
  'widgets.read': { args: z.object({ name: widgetNameSchema }), result: z.object({ html: z.string() }) },
  // Runs an action of the action API (actions.ts). tabId: the chat it comes from (a widget's; the AtHome session that
  // ran the athome command); heavy actions wait for the user's answer to a confirmation opened there (action_denied
  // when refused or cancelled). interactive: the athome command runs in a terminal a person types in (see the terminal
  // policy in core actions.ts).
  'actions.run': { args: z.object({ tabId: tabId.optional(), action: coreActionNameSchema, args: z.record(z.string(), z.unknown()), source: actionSourceSchema, interactive: z.boolean().optional() }), result: z.object({ value: z.unknown().optional() }) },
  // Claude Code's own settings (/config) of the user's settings file; a change is saved there and every live session
  // takes it at once. file: the settings file shown to the user.
  'settings.claudeCode': { args: empty, result: z.object({ values: claudeSettingsSchema, file: z.string() }) },
  'settings.setClaudeCode': { args: z.object({ change: claudeSettingChangeSchema }), result: empty },
  'tab.refreshGauges': { args: z.object({ tabId }), result: empty },
  // Stored sessions of a folder, or (no cwd) of every folder inside the backend's roots, newest first.
  // rename/delete are refused with session_busy while a tab references the session.
  'sessions.list': { args: z.object({ cwd: z.string().min(1).optional() }), result: z.object({ sessions: z.array(sessionInfoSchema) }) },
  'sessions.rename': { args: z.object({ cwd: z.string().min(1), sessionId: z.string(), title: z.string().trim().min(1) }), result: empty },
  'sessions.delete': { args: z.object({ cwd: z.string().min(1), sessionId: z.string() }), result: empty },
  // Prompts sent in a folder, newest first: the app's own and the terminal CLI's (~/.claude/history.jsonl).
  'prompts.history': { args: z.object({ cwd: z.string().min(1) }), result: z.object({ prompts: z.array(promptSchema) }) },
  // Subfolders of a folder (hidden ones skipped), confined to the backend's roots. path absent = the first root
  // (desktop: the user's home folder); parent absent at the top.
  'folders.list': {
    args: z.object({ path: z.string().optional() }),
    result: z.object({ path: z.string(), parent: z.string().optional(), folders: z.array(folderEntrySchema), files: z.object({ count: z.number(), hidden: z.number() }) })
  },
  'folders.create': { args: z.object({ path: z.string().min(1), name: folderName, project: z.boolean().optional() }), result: z.object({ path: z.string() }) },
  // The project mark of a folder (any level), saved in core: the same on every device.
  'folders.setProject': { args: z.object({ path: z.string().min(1), project: z.boolean() }), result: empty },
  // The Home of this PC (desktop): a folder added to it, or taken off it (its files stay).
  'folders.add': { args: z.object({ path: z.string().min(1) }), result: z.object({ path: z.string() }) },
  'folders.remove': { args: z.object({ path: z.string().min(1) }), result: empty },
  // Deletes a folder inside the Home (never the Home's own folders): to the app's trash on the remote server, to the
  // system trash on the desktop. Refused while a session is open inside it, unless closeSessions: those are closed first
  // (their conversations stay among the saved sessions).
  'folders.delete': { args: z.object({ path: z.string().min(1), closeSessions: z.boolean().optional() }), result: empty },
  // File explorer, paths relative to its folder (`.git` hidden and protected): a tab's folder (trusted folders only) or
  // a folder of the Home without a session (inside the roots, like folders.*). Exactly one of tabId and folder.
  'files.list': { args: filePlace({ path: relativePath }), result: z.object({ entries: z.array(fileEntrySchema) }) },
  // Preview (text as utf8, images as base64, up to LIMITS.previewBytes, `truncated` beyond) or download (base64, the
  // whole file up to LIMITS.fileBytes).
  'files.read': {
    args: filePlace({ path: relativePath.min(1), download: z.boolean().optional() }),
    result: z.object({ mediaType: z.string(), encoding: z.enum(['utf8', 'base64']), data: z.string(), size: z.number(), truncated: z.boolean() })
  },
  // Upload (base64). attachment: path is just a file name, stored under allegati/ with a free name (excluded from git
  // locally); the result is the path to mention.
  'files.write': {
    args: filePlace({ path: relativePath.min(1), data: z.string(), overwrite: z.boolean().optional(), attachment: z.boolean().optional() }),
    result: z.object({ path: z.string() })
  },
  'files.mkdir': { args: filePlace({ path: relativePath.min(1) }), result: empty },
  // Rename or move inside the folder; refused when the target exists.
  'files.rename': { args: filePlace({ from: relativePath.min(1), to: relativePath.min(1) }), result: empty },
  'files.delete': { args: filePlace({ path: relativePath.min(1) }), result: empty },
  // The app's trash (remote server; empty on the desktop, which uses the system trash). under: only what was inside
  // that folder. Items expire after 7 days.
  'trash.list': { args: z.object({ under: z.string().optional() }), result: z.object({ items: z.array(trashItemSchema) }) },
  // Puts an item back where it was (refused if that place is taken now).
  'trash.restore': { args: z.object({ id: z.string() }), result: z.object({ path: z.string() }) },
  'trash.delete': { args: z.object({ id: z.string() }), result: empty },
  'trash.empty': { args: z.object({ under: z.string().optional() }), result: empty },
  // Notes of a folder, shared by every device; newest first.
  'notes.list': { args: z.object({ cwd: z.string().min(1) }), result: z.object({ notes: z.array(noteSchema) }) },
  // noteId absent: a new note.
  'notes.save': { args: z.object({ cwd: z.string().min(1), noteId: z.string().optional(), text: z.string().trim().min(1) }), result: z.object({ note: noteSchema }) },
  'notes.delete': { args: z.object({ cwd: z.string().min(1), noteId: z.string() }), result: empty },
  // Colour palettes of the app, shared by every device. paletteId absent: a new palette.
  'palettes.save': { args: z.object({ paletteId: z.string().optional(), name: z.string().trim().min(1).max(40), colors: paletteColorsSchema }), result: z.object({ palette: paletteSchema }) },
  'palettes.delete': { args: z.object({ paletteId: z.string() }), result: empty },
  // Claude accounts of the backend besides Claude Code's own login: a name and a token made with
  // `claude setup-token` (sk-ant-oat…), kept owner-only in core and never sent back. Removing one sends its sessions
  // back to the login. setDefault: the account of new sessions (undefined = the login).
  'accounts.add': { args: z.object({ name: z.string().trim().min(1).max(40), token: z.string().trim().min(1) }), result: z.object({ accountId: z.string() }) },
  'accounts.remove': { args: z.object({ accountId: z.string() }), result: empty },
  // A new name for an account (its token stays).
  'accounts.rename': { args: z.object({ accountId: z.string(), name: z.string().trim().min(1).max(40) }), result: empty },
  // The same switch made from Settings: the account of every session and of the new ones.
  'accounts.setDefault': { args: z.object({ accountId: z.string().optional() }), result: empty },
  // "Continua": every session stopped by a usage limit or an account switch whose account is free gets text as a
  // message of the user (its queue goes on after it). Without text the marks are only cleared.
  'tabs.continue': { args: z.object({ text: z.string().trim().min(1).optional() }), result: empty },
  // Paired devices (remote server only; other backends answer not_found). pairStart returns a one-time code
  // for a new device; revoke also removes the devices and codes the revoked one created, recursively (revokeCascade),
  // except the asking device and what it created; the asking device cannot revoke itself (invalid_args), and when its
  // creator goes it loses createdBy.
  'devices.list': { args: empty, result: z.object({ devices: z.array(deviceSchema) }) },
  'devices.pairStart': { args: z.object({ name: z.string().trim().min(1).max(60) }), result: z.object({ code: z.string(), expiresAt: z.number() }) },
  'devices.revoke': { args: z.object({ deviceId: z.string() }), result: empty },
  // Web Push of the asking device (remote server only): the server's public VAPID key and whether this device
  // has a subscription; subscribe stores the browser's PushSubscription for this device.
  'push.config': { args: empty, result: z.object({ publicKey: z.string(), subscribed: z.boolean() }) },
  'push.subscribe': { args: z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }), result: empty },
  'push.unsubscribe': { args: empty, result: empty },
  // The client's page is shown or hidden (push notifications skip devices with a visible client).
  // The chat this client shows on screen (none: tabId absent): while one is shown, its next queued message waits a
  // countdown there (TabMeta.queueCountdown) instead of going at once.
  'client.watch': { args: z.object({ tabId: z.string().optional() }), result: empty },
  'client.visibility': { args: z.object({ visible: z.boolean() }), result: empty },
  // Terminals: a shell in a session's folder (tabId) or a folder of the Home (folder), shared by every client; its
  // output on the terminal:<id> stream. input: keys as the terminal sends them; resize: the size every client sees.
  'terminal.open': { args: filePlace({ cols: terminalSize, rows: terminalSize }), result: z.object({ terminalId: z.string() }) },
  'terminal.subscribe': { args: z.object({ terminalId: z.string() }), result: empty },
  'terminal.unsubscribe': { args: z.object({ terminalId: z.string() }), result: empty },
  'terminal.input': { args: z.object({ terminalId: z.string(), data: z.string().max(64 * 1024) }), result: empty },
  'terminal.resize': { args: z.object({ terminalId: z.string(), cols: terminalSize, rows: terminalSize }), result: empty },
  'terminal.close': { args: z.object({ terminalId: z.string() }), result: empty },
  // Folder trust: what the folder would load and run, and where an accepted trust applies.
  'trust.check': {
    args: z.object({ cwd: z.string().min(1) }),
    result: z.object({ trusted: z.boolean(), config: projectConfigSchema, scope: z.object({ path: z.string(), sessionOnly: z.boolean() }) })
  },
  'trust.grant': { args: z.object({ cwd: z.string().min(1) }), result: empty },
  // Semantic answer: core builds the SDK PermissionResult from the stored request.
  'request.answer': {
    args: z.object({
      tabId,
      requestId: z.string(),
      decision: z.enum(['allow', 'allowAlways', 'deny']),
      reason: z.string().optional(),
      answers: z.record(z.string(), z.string()).optional(),
      planNextMode: permissionModeSchema.optional()
    }),
    result: empty
  }
} as const

export type CommandName = keyof typeof COMMANDS
export type CommandArgs<N extends CommandName> = z.infer<(typeof COMMANDS)[N]['args']>
export type CommandResult<N extends CommandName> = z.infer<(typeof COMMANDS)[N]['result']>
export type ModelInfo = z.infer<typeof modelInfoSchema>
export type SlashCommand = z.infer<typeof slashCommandSchema>
export type Image = z.infer<typeof imageSchema>
export type Prompt = z.infer<typeof promptSchema>
export type Device = z.infer<typeof deviceSchema>
export type FolderEntry = z.infer<typeof folderEntrySchema>
export type FileEntry = z.infer<typeof fileEntrySchema>
export type TrashItem = z.infer<typeof trashItemSchema>
export type Note = z.infer<typeof noteSchema>
