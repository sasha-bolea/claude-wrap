import { memo, useEffect, useRef, useState } from 'react'
import { WIDGET_FRAME_PATH } from '@athome/protocol'
import { t } from '../i18n.ts'
import { subscribeActivePalette } from '../palette.ts'
import { useTouch } from './context.tsx'
import { frameMessage, type FrameMessage, type WidgetSpec } from './widget.ts'

// A chat widget in a reply: a ```widget block (its HTML) or a ```widget:<name> block (a library widget, with JSON
// data), shown once complete in widget-frame.html — an iframe sandboxed without allow-same-origin, so the widget
// cannot reach the app, its storage or its connection; it only talks through postMessage (widget.ts).

// The app's design tokens a widget gets as CSS variables.
const THEME_TOKENS = ['--background', '--surface', '--surface-2', '--border', '--text', '--text-muted', '--accent', '--accent-text', '--danger', '--success', '--radius', '--space', '--font', '--font-mono']

// Answers a widget's action request: resolves with the action's value, rejects with the reason it was refused.
export type WidgetActionHandler = (action: string, args: Record<string, unknown>) => Promise<unknown>

// The app's current tokens and light/dark scheme, as the frame applies them.
function currentTheme(): { theme: Record<string, string>; scheme: string } {
  const style = getComputedStyle(document.documentElement)
  const theme = Object.fromEntries(THEME_TOKENS.map((token) => [token, style.getPropertyValue(token).trim()]))
  return { theme, scheme: style.colorScheme.includes('dark') ? 'dark' : 'light' }
}

// A widget block of a reply. spec: what the block holds; closed: its closing fence arrived (until then, a placeholder);
// onAction: runs the actions the widget asks for.
export function WidgetBlock({ spec, closed, onAction }: { spec: WidgetSpec; closed: boolean; onAction: WidgetActionHandler }) {
  if (!closed) return <div className="widget-pending">{t('widgetLoading')}</div>
  if (spec.kind === 'error') return <p className="widget-error">{t(spec.reason === 'name' ? 'widgetBadName' : 'widgetBadData')}</p>
  if (spec.kind === 'inline') return <WidgetFrame html={spec.html} data={undefined} onAction={onAction} />
  return <LibraryWidget name={spec.name} data={spec.data} onAction={onAction} />
}

// A widget of the library: its HTML read from the backend, then shown with the block's data.
function LibraryWidget({ name, data, onAction }: { name: string; data: unknown; onAction: WidgetActionHandler }) {
  const { connection } = useTouch()
  const [html, setHtml] = useState<string>()
  const [missing, setMissing] = useState(false)
  useEffect(() => void connection.request('widgets.read', { name }).then(({ html: read }) => setHtml(read), () => setMissing(true)), [connection, name])
  if (missing) return <p className="widget-error">{t('widgetMissing', { name })}</p>
  if (html === undefined) return <div className="widget-pending">{t('widgetLoading')}</div>
  return <WidgetFrame html={html} data={data} onAction={onAction} />
}

type FrameProps = { html: string; data: unknown; onAction: WidgetActionHandler }

// The widget's frame: hands it the widget when it is ready, follows its height and the palette, runs the actions it
// asks for one at a time (a refused or failed one also shows as a toast, unless the user denied it). Everything is
// plain window messages checked against the frame's own window (a private MessagePort stayed silent on iOS Safari);
// the frame asks only after a tap inside it, and the handler checks the tap again here.
// Memoised on the widget's content: a reply still streaming after the block never reloads it.
const WidgetFrame = memo(
  function WidgetFrame({ html, data, onAction }: FrameProps) {
    const { toast } = useTouch()
    const frame = useRef<HTMLIFrameElement>(null)
    const latest = useRef({ html, data, onAction, toast })
    latest.current = { html, data, onAction, toast }
    useEffect(() => {
      const element = frame.current!
      const send = (message: object) => element.contentWindow?.postMessage(message, '*')
      const act = actionsOn(send, latest)
      const onMessage = (event: MessageEvent) => {
        if (event.source !== element.contentWindow || !element.contentWindow) return
        const message = frameMessage(event.data)
        if (!message) return
        if (message.type === 'athome.height') element.style.setProperty('--widget-height', `${message.height}px`)
        else if (message.type === 'athome.ready') {
          const { html: widget, data: widgetData } = latest.current
          send({ type: 'athome.render', html: widget, data: widgetData, ...currentTheme(), lang: document.documentElement.lang })
        } else act(message)
      }
      window.addEventListener('message', onMessage)
      const stop = subscribeActivePalette(() => requestAnimationFrame(() => send({ type: 'athome.theme', ...currentTheme() })))
      return () => {
        window.removeEventListener('message', onMessage)
        stop()
      }
    }, [])

    return <iframe ref={frame} className="widget-frame" src={WIDGET_FRAME_PATH} sandbox="allow-scripts" title={t('widgetTitle')} />
  },
  (before, after) => before.html === after.html && before.onAction === after.onAction && JSON.stringify(before.data) === JSON.stringify(after.data)
)

type Latest = { current: { onAction: WidgetActionHandler; toast: (text: string) => void } }
type ActionMessage = Extract<FrameMessage, { type: 'athome.action' }>

// The actions of one frame: runs them one at a time and answers each one through send.
function actionsOn(send: (message: object) => void, latest: Latest): (message: ActionMessage) => void {
  let busy = false
  const reply = (id: number, result: { ok: true; value: unknown } | { ok: false; error: string }) => send({ type: 'athome.result', id, ...result })
  return (message) => {
    if (busy) return reply(message.id, { ok: false, error: t('widgetBusy') })
    busy = true
    latest.current
      .onAction(message.action, message.args)
      .then(
        (value) => reply(message.id, { ok: true, value }),
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          if ((error as { code?: string }).code !== 'action_denied') latest.current.toast(reason)
          reply(message.id, { ok: false, error: reason })
        }
      )
      .finally(() => (busy = false))
  }
}
