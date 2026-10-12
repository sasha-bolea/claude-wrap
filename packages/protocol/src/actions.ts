import { z } from 'zod'

// The action API: a small, stable vocabulary for using the app from outside the UI's own controls (today: chat widgets).
// Core runs the actions that change shared state (`actions.run`); the client runs the ones about its own screen.
// Heavy actions open a confirmation in the chat first (a request of kind 'action') and run only when the user allows it.

// A folder name to create: no separators or characters Windows forbids, not `.` or `..`.
export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\\/:*?"<>|]+$/)
  .refine((name) => name !== '.' && name !== '..', 'invalid folder name')

// Longest text an action carries (a prompt, the composer's text).
export const ACTION_TEXT_MAX = 20_000
// Screens a widget may open in its chat's session.
export const ACTION_SCREENS = ['files', 'notes', 'settings', 'context', 'usage', 'status', 'mcp', 'hooks', 'permissions', 'memory'] as const

// Who asked for an action: a chat widget (an app client, for its chat) or the athome command (the server's terminal
// socket; core checks the connection really is that socket).
export const actionSourceSchema = z.enum(['widget', 'terminal'])

// Actions core runs, with their arguments. request.answer answers the chat's first open request (allow, with the
// answers of a question, or deny).
export const CORE_ACTIONS = {
  'prompt.send': z.object({ text: z.string().trim().min(1).max(ACTION_TEXT_MAX) }),
  'request.answer': z.object({ decision: z.enum(['allow', 'deny']), answers: z.record(z.string(), z.string()).optional() }),
  'project.create': z.object({ name: folderNameSchema, parent: z.string().min(1).optional() }),
  'session.start': z.object({ folder: z.string().min(1), prompt: z.string().trim().min(1).max(ACTION_TEXT_MAX).optional() })
} as const

// Actions the client runs on its own screen.
export const CLIENT_ACTIONS = {
  'composer.insert': z.object({ text: z.string().max(ACTION_TEXT_MAX), replace: z.boolean().optional() }),
  'open.file': z.object({ path: z.string().min(1).max(4096) }),
  'open.screen': z.object({ name: z.enum(ACTION_SCREENS) })
} as const

export type CoreActionName = keyof typeof CORE_ACTIONS
export type ClientActionName = keyof typeof CLIENT_ACTIONS
export type CoreActionArgs<Name extends CoreActionName> = z.infer<(typeof CORE_ACTIONS)[Name]>
export type ClientActionArgs<Name extends ClientActionName> = z.infer<(typeof CLIENT_ACTIONS)[Name]>
export const coreActionNameSchema = z.enum(Object.keys(CORE_ACTIONS) as [CoreActionName, ...CoreActionName[]])

// What a confirmation request (kind 'action') carries as its input: the action, its arguments, who asked, and for
// request.answer the request it would answer.
export const actionConfirmationSchema = z.object({
  action: coreActionNameSchema,
  args: z.record(z.string(), z.unknown()),
  source: actionSourceSchema,
  about: z.object({ toolName: z.string(), title: z.string().optional() }).optional()
})
export type ActionConfirmation = z.infer<typeof actionConfirmationSchema>
