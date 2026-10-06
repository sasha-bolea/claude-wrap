import { z } from 'zod'
import { COMMANDS } from './commands.ts'
import { tabEventSchema, tabSnapshotSchema, terminalEventSchema, terminalSnapshotSchema, workspaceEventSchema, workspaceSnapshotSchema } from './model.ts'

export * from './model.ts'
export * from './commands.ts'
export * from './presets.ts'

// Major version of the client↔core protocol: a different value on the two sides is incompatible.
export const PROTOCOL_VERSION = 1

// Size limits shared by every transport (architettura.md §3).
export const LIMITS = {
  sendTotalBytes: 30 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  images: 20,
  // File explorer: what a preview shows at most, and the largest file uploaded or downloaded.
  previewBytes: 2 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024
} as const

// Liveness: the client pings every PING_INTERVAL_MS; after PING_MISSES unanswered pings it reconnects.
export const PING_INTERVAL_MS = 15_000
export const PING_MISSES = 2

export const ERROR_CODES = [
  'invalid_args',
  'too_large',
  'not_found',
  'untrusted_folder',
  'needs_trust',
  'session_busy',
  'outside_root',
  'limit_reached',
  'request_resolved',
  'unauthorized',
  'incompatible_protocol',
  'sdk_error',
  'internal'
] as const

export const errorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional()
})

// Last event seen by the client on one stream, used to resume after a reconnect.
export const streamPositionSchema = z.object({ epoch: z.string(), lastSeq: z.number().int().nonnegative() })

// ---- client → core ----

export const helloSchema = z.object({
  t: z.literal('hello'),
  protocolVersion: z.number().int(),
  clientId: z.string().min(1),
  token: z.string().optional(),
  visible: z.boolean(),
  // Streams to resume (workspace + subscribed tabs): each gets a replay, a reset or `gone`.
  resume: z.record(z.string(), streamPositionSchema)
})

const commandName = z.enum(Object.keys(COMMANDS) as [keyof typeof COMMANDS, ...(keyof typeof COMMANDS)[]])
// Args are validated against COMMANDS[name].args by the receiver.
// id: a client UUID; for tab.send it becomes the SDK user-message uuid.
export const cmdSchema = z.object({ t: z.literal('cmd'), id: z.uuid(), name: commandName, args: z.unknown() })
export const pingSchema = z.object({ t: z.literal('ping'), n: z.number().int() })

// ---- core → client ----

export const welcomeSchema = z.object({
  t: z.literal('welcome'),
  protocolVersion: z.number().int(),
  backendId: z.string(),
  coreVersion: z.string(),
  sdkVersion: z.string(),
  cliVersion: z.string(),
  backendKind: z.enum(['local', 'remote']),
  limits: z.object({ sendTotalBytes: z.number(), imageBytes: z.number(), images: z.number(), previewBytes: z.number(), fileBytes: z.number() })
})

export const replySchema = z.discriminatedUnion('ok', [
  z.object({ t: z.literal('reply'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ t: z.literal('reply'), id: z.string(), ok: z.literal(false), error: errorSchema })
])
export const evSchema = z.object({
  t: z.literal('ev'),
  stream: z.string(),
  epoch: z.string(),
  seq: z.number().int(),
  ev: z.union([workspaceEventSchema, tabEventSchema, terminalEventSchema])
})
// Full state of a stream; may arrive at any time, also on a live stream.
export const resetSchema = z.object({
  t: z.literal('reset'),
  stream: z.string(),
  epoch: z.string(),
  seq: z.number().int(),
  snapshot: z.union([workspaceSnapshotSchema, tabSnapshotSchema, terminalSnapshotSchema])
})
// The stream no longer exists (e.g. its tab was closed while the client was away).
export const goneSchema = z.object({ t: z.literal('gone'), stream: z.string() })
export const pongSchema = z.object({ t: z.literal('pong'), n: z.number().int() })
// Sent by core right before it closes a connection it refuses (bad first frame, version mismatch).
export const fatalSchema = z.object({ t: z.literal('fatal'), error: errorSchema })

export const clientFrameSchema = z.discriminatedUnion('t', [helloSchema, cmdSchema, pingSchema])
export const coreFrameSchema = z.union([welcomeSchema, replySchema, evSchema, resetSchema, goneSchema, pongSchema, fatalSchema])

export type ErrorCode = (typeof ERROR_CODES)[number]
export type ProtocolError = z.infer<typeof errorSchema>
export type StreamPosition = z.infer<typeof streamPositionSchema>
export type Hello = z.infer<typeof helloSchema>
export type Cmd = z.infer<typeof cmdSchema>
export type Welcome = z.infer<typeof welcomeSchema>
export type Reply = z.infer<typeof replySchema>
export type EvFrame = z.infer<typeof evSchema>
export type ResetFrame = z.infer<typeof resetSchema>
export type BackendKind = Welcome['backendKind']
export type ClientFrame = z.infer<typeof clientFrameSchema>
export type CoreFrame = z.infer<typeof coreFrameSchema>

// One bidirectional, message-oriented link between a client and core (MessagePort, WebSocket, in-memory).
// Frames are plain objects; the receiver always validates them with the schemas above.
export interface Channel {
  send(frame: unknown): void
  onMessage(listener: (frame: unknown) => void): void
  onClose(listener: () => void): void
  close(): void
}

export { createChannelPair } from './channelPair.ts'
