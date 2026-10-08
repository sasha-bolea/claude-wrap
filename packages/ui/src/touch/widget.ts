import { WIDGET_LANGUAGE, WIDGET_LIMITS, WIDGET_NAME } from '@athome/protocol'
import { t } from '../i18n.ts'

// Chat widgets in a reply (pure parts): which code block is a widget, when it is complete, and the messages its frame
// may send. The frame page and its runtime are packages/ui/widget-frame.html; the component is WidgetBlock.tsx.

// A widget code block: inline HTML, a library widget by name with its JSON data, or one the chat cannot show.
export type WidgetSpec = { kind: 'inline'; html: string } | { kind: 'library'; name: string; data: unknown } | { kind: 'error'; reason: 'data' | 'name' }

// What a frame may send: it is ready for its widget, its content's height, an action the widget asks for.
export type FrameMessage = { type: 'athome.ready' } | { type: 'athome.height'; height: number } | { type: 'athome.action'; id: number; action: string; args: Record<string, unknown> }

// Tallest a widget grows (px); beyond, it scrolls inside its frame.
export const MAX_WIDGET_HEIGHT = 4000

// The widget a code block holds, from its class ("language-widget" or "language-widget:<name>") and its text.
// Returns undefined for any other code block.
export function widgetSpec(className: string | undefined, body: string): WidgetSpec | undefined {
  const language = className?.split(' ').find((name) => name.startsWith('language-'))?.slice('language-'.length)
  if (language === WIDGET_LANGUAGE) return { kind: 'inline', html: body }
  if (!language?.startsWith(`${WIDGET_LANGUAGE}:`)) return undefined
  const name = language.slice(WIDGET_LANGUAGE.length + 1)
  if (!WIDGET_NAME.test(name) || name.length > WIDGET_LIMITS.name) return { kind: 'error', reason: 'name' }
  try {
    return { kind: 'library', name, data: body.trim() ? (JSON.parse(body) as unknown) : undefined }
  } catch {
    return { kind: 'error', reason: 'data' }
  }
}

// Whether a fenced block's source (from its opening fence to where it ends now) already has its closing fence: while
// a reply streams, an unclosed block runs to the end of the text.
export function fenceClosed(source: string): boolean {
  const lines = source.trimEnd().split('\n')
  const fence = /^\s*(`{3,}|~{3,})/.exec(lines[0] ?? '')?.[1]
  return Boolean(fence && lines.length > 1 && lines.at(-1)!.trim().startsWith(fence) && /^(`+|~+)$/.test(lines.at(-1)!.trim()))
}

// A message from a widget frame, checked and typed; undefined for anything else.
export function frameMessage(data: unknown): FrameMessage | undefined {
  if (!data || typeof data !== 'object') return undefined
  const message = data as Record<string, unknown>
  if (message.type === 'athome.ready') return { type: 'athome.ready' }
  if (message.type === 'athome.height' && typeof message.height === 'number' && Number.isFinite(message.height))
    return { type: 'athome.height', height: Math.min(MAX_WIDGET_HEIGHT, Math.max(0, Math.ceil(message.height))) }
  const { id, action, args } = message
  if (message.type === 'athome.action' && Number.isInteger(id) && typeof action === 'string' && args && typeof args === 'object' && !Array.isArray(args))
    return { type: 'athome.action', id: id as number, action, args: args as Record<string, unknown> }
  return undefined
}

// A confirmation's action in plain words: a title (what would happen) and an optional detail (the prompt it sends).
// input: the request's input (an ActionConfirmation, from a widget: shown as text only).
export function actionWords(input: Record<string, unknown>): { title: string; detail?: string } {
  const args = (input.args && typeof input.args === 'object' ? input.args : {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const about = (input.about && typeof input.about === 'object' ? input.about : {}) as Record<string, unknown>
  switch (input.action) {
    case 'project.create':
      return { title: t('actionProject', { name: text(args.name), parent: text(args.parent) }) }
    case 'session.start':
      return { title: t('actionSession', { folder: text(args.folder) }), ...(args.prompt ? { detail: text(args.prompt) } : {}) }
    case 'request.answer':
      return { title: t('actionAllow', { tool: text(about.title) || text(about.toolName) }) }
    default:
      return { title: t('actionOther', { action: text(input.action) }) }
  }
}
