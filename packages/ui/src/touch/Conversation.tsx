import { useEffect, useRef, useState } from 'react'
import type { TabView } from '@claude-wrap/client'
import type { Image, ImageRef, Item, Request, TabMeta } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { dataUrl } from '../images.ts'
import { Markdown } from '../Markdown.tsx'
import type { Answer } from '../RequestPanel.tsx'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'

type LoadImage = (imageId: string) => Promise<Image>
type ToolCall = Extract<Item, { kind: 'toolCall' }>
type TurnEnd = Extract<Item, { kind: 'turnEnd' }>
type UserItem = Extract<Item, { kind: 'user' }>
type Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string; preview?: string }[] }

// How long "letto" stays under a message Claude has just read.
const READ_NOTE_MS = 2500

// One-line summary of a tool call: the most telling field of its input.
function toolSummary(input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>
  const value = fields.command ?? fields.file_path ?? fields.pattern ?? fields.url ?? fields.query ?? fields.description ?? fields.prompt
  return typeof value === 'string' ? value : ''
}

// End of a turn: interruption, error, or duration and cost.
function turnEndText(item: TurnEnd): string {
  if (item.interrupted) return t('interrupted')
  if (item.error) return t('turnError', { error: item.error })
  return t('turnStats', { seconds: ((item.durationMs ?? 0) / 1000).toFixed(1), cost: (item.costUsd ?? 0).toFixed(4) })
}

// A photo sent with a message, fetched from core when shown; a tap opens it full screen.
function Thumb({ image, n, loadImage }: { image: ImageRef; n: number; loadImage: LoadImage }) {
  const { viewImage } = useTouch()
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let shown = true
    loadImage(image.imageId).then((loaded) => shown && setSrc(dataUrl(loaded)), () => undefined)
    return () => void (shown = false)
  }, [image.imageId, loadImage])
  const alt = t('imageAlt', { n: String(n) })
  if (!src) return <span className="chip">{alt}</span>
  return (
    <button className="thumb-btn" aria-label={t('openPhoto', { n: String(n) })} onClick={() => viewImage(src)}>
      <img className="thumb" src={src} alt={alt} />
    </button>
  )
}

// Your message: photos, text, and while Claude has not read it "in attesa" (then "letto" for a moment) with "Invia
// ora" beside it (the CLI's own send-now: Claude reads it now). Long press (or right click) opens its actions.
function UserMessage({ item, readAt, loadImage, onActions, onSendNow }: { item: UserItem; readAt?: number; loadImage: LoadImage; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown> }) {
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [pressed, setPressed] = useState(false)
  const [sending, setSending] = useState(false)
  const start = () => {
    press.current = setTimeout(() => {
      setPressed(true)
      navigator.vibrate?.(10)
      onActions(item)
      setTimeout(() => setPressed(false), 300)
    }, 500)
  }
  const cancel = () => clearTimeout(press.current)
  const justRead = readAt !== undefined && Date.now() - readAt < READ_NOTE_MS
  const bubble = (
    <div
      className={`msg-user${item.pending ? ' pending' : ''}${pressed ? ' pressed' : ''}`}
      data-msg={item.itemId}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchMove={cancel}
      onTouchCancel={cancel}
      onContextMenu={(event) => (event.preventDefault(), onActions(item))}
    >
      {item.images && (
        <div className="thumbs">
          {item.images.map((image, index) => (
            <Thumb key={image.imageId} image={image} n={index + 1} loadImage={loadImage} />
          ))}
        </div>
      )}
      {item.text}
      {item.pending && <span className="pending-note">{t('waitingToBeRead')}</span>}
      {!item.pending && justRead && <span className="pending-note">{t('readByClaude')}</span>}
    </div>
  )
  if (!item.pending) return bubble
  return (
    <div className="msg-user-row">
      <button className="send-now" aria-label={t('sendPendingNow')} title={t('sendPendingNow')} disabled={sending} onClick={() => (setSending(true), void onSendNow(item).finally(() => setSending(false)))}>
        <Icon name="send" />
      </button>
      {bubble}
    </div>
  )
}

// A tool call: closed shows name, summary and state; open shows input and result.
function ToolCard({ item }: { item: ToolCall }) {
  const state = item.result === undefined ? t('toolRunning') : item.isError ? t('toolFailed') : t('toolDone')
  return (
    <details className="tool">
      <summary>
        <span className="tool-name">{item.name}</span>
        <span className="tool-sum">{toolSummary(item.input)}</span>
        <span className={`tool-state${item.result === undefined ? '' : item.isError ? ' bad' : ' ok'}`}>{state}</span>
      </summary>
      <div className="tool-body">
        <pre>{JSON.stringify(item.input, null, 2)}</pre>
        {item.result !== undefined && <pre>{item.result}</pre>}
      </div>
    </details>
  )
}

// One transcript item, as the prototype shows it.
function ItemView({ item, readAt, loadImage, onActions, onSendNow }: { item: Item; readAt?: number; loadImage: LoadImage; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown> }) {
  const { capabilities } = useTouch()
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} readAt={readAt} loadImage={loadImage} onActions={onActions} onSendNow={onSendNow} />
    case 'assistantText':
      return (
        <div className="msg-ai">
          <Markdown text={item.text} openExternal={capabilities.openExternal} />
        </div>
      )
    case 'thinking':
      return (
        <details className="think">
          <summary>{t('thinkingSummary')}</summary>
          <p>{item.text}</p>
        </details>
      )
    case 'toolCall':
      return <ToolCard item={item} />
    case 'turnEnd':
      return <div className={`turn-end${item.error ? ' bad' : ''}`}>{turnEndText(item)}</div>
    case 'notice':
      return item.level === 'info' ? <p className="notice-line">{item.text}</p> : <div className={`warn${item.level === 'error' ? ' bad' : ''}`}>{item.text}</div>
    case 'compactBoundary':
      return <p className="compacted">{t('compacted')}</p>
    case 'localCommandOutput':
      return <pre className="local-output">{item.text}</pre>
    case 'shell':
      return (
        <div className="shell">
          <span className="cmd">$ {item.command}</span>
          {item.output && <pre>{item.output}</pre>}
          <span className={`exit${item.exitCode ? ' bad' : ''}`}>{item.exitCode === undefined ? t('toolRunning') : t('shellExitCode', { code: String(item.exitCode) })}</span>
        </div>
      )
  }
}

// When each of your messages stopped being pending (Claude read it): "letto" shows under it for a moment.
function useReadTimes(items: Item[]): Record<string, number> {
  const pending = useRef(new Set<string>())
  const [readAt, setReadAt] = useState<Record<string, number>>({})
  useEffect(() => {
    const now = Date.now()
    const read: Record<string, number> = {}
    for (const item of items) {
      if (item.kind !== 'user') continue
      if (item.pending) pending.current.add(item.itemId)
      else if (pending.current.delete(item.itemId)) read[item.itemId] = now
    }
    if (Object.keys(read).length) setReadAt((current) => ({ ...current, ...read }))
  }, [items])
  // Once the last "letto" has expired they all go (a render that removes them).
  useEffect(() => {
    const latest = Math.max(0, ...Object.values(readAt))
    if (!latest) return
    const timer = setTimeout(() => setReadAt({}), Math.max(0, latest + READ_NOTE_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [readAt])
  return readAt
}

// "Claude sta lavorando… 12 s", counted from when the turn started.
function WorkingLine({ starting }: { starting: boolean }) {
  const since = useRef(Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="working-line">
      <span className="badge working" />
      <span>{starting ? t('startingClaude') : t('workingSeconds', { seconds: String(Math.round((Date.now() - since.current) / 1000)) })}</span>
    </div>
  )
}

type ConversationProps = { meta: TabMeta; view?: TabView; loadImage: LoadImage; onAnswer: (requestId: string, answer: Answer) => void; onRestart: () => void; onTrust: () => void; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown> }

// The conversation: items, then Claude's request (part of the chat, it scrolls with it), the working line and the
// cards of a stopped process or an untrusted folder.
export function Conversation({ meta, view, loadImage, onAnswer, onRestart, onTrust, onActions, onSendNow }: ConversationProps) {
  const items = view?.items ?? []
  const readAt = useReadTimes(items)
  const request = view?.requests[0]
  return (
    <>
      {items.map((item) => (
        <ItemView key={item.itemId} item={item} readAt={readAt[item.itemId]} loadImage={loadImage} onActions={onActions} onSendNow={onSendNow} />
      ))}
      {(meta.status === 'running' || meta.status === 'starting') && <WorkingLine key={meta.status} starting={meta.status === 'starting'} />}
      {request && <RequestCard key={request.requestId} request={request} onAnswer={(answer) => onAnswer(request.requestId, answer)} />}
      {meta.status === 'error' && (
        <div className="card bad" role="alert">
          <span>{t('processStopped', { error: meta.error ?? '' })}</span>
          <button className="button" onClick={onRestart}>
            {t('restart')}
          </button>
        </div>
      )}
      {meta.status === 'needs_trust' && (
        <div className="card">
          <span>{t('folderNotTrusted')}</span>
          <button className="button" onClick={onTrust}>
            {t('decideTrust')}
          </button>
        </div>
      )}
    </>
  )
}

// Claude's request inside the conversation. The optional text (reason for No, "Altro…", what to change in the
// plan) shows only after choosing that answer; the card never takes the focus itself, so no tap grants by mistake.
function RequestCard({ request, onAnswer }: { request: Request; onAnswer: (answer: Answer) => void }) {
  const label = request.kind === 'question' ? t('questionRegion') : request.kind === 'plan' ? t('planRegion') : t('permissionRegion')
  return (
    <section className="request" aria-label={label} tabIndex={-1}>
      {request.kind === 'question' ? <QuestionCard request={request} onAnswer={onAnswer} /> : request.kind === 'plan' ? <PlanCard request={request} onAnswer={onAnswer} /> : <PermissionCard request={request} onAnswer={onAnswer} />}
    </section>
  )
}

// A field that appears after choosing the answer that needs it, with the button that sends it.
function Reveal({ label, placeholder, action, danger, onSend }: { label: string; placeholder: string; action: string; danger?: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="reveal">
      <label className="label">
        {label}
        <input className="field" placeholder={placeholder} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      </label>
      <button className={`button${danger ? ' danger' : ''}`} onClick={() => onSend(text)}>
        {action}
      </button>
    </div>
  )
}

function PermissionCard({ request, onAnswer }: { request: Request; onAnswer: (answer: Answer) => void }) {
  const [denying, setDenying] = useState(false)
  const preview = toolSummary(request.input) || JSON.stringify(request.input, null, 2)
  return (
    <>
      <h2>{request.title ?? t('allowTool', { tool: request.displayName ?? request.toolName })}</h2>
      <pre className="preview">{preview}</pre>
      {request.description && <span className="muted">{request.description}</span>}
      {request.decisionReason && <span className="muted">{request.decisionReason}</span>}
      <div className="grant-row">
        <button className="button primary" onClick={() => onAnswer({ decision: 'allow' })}>
          {t('yes')}
        </button>
        <button className="button danger" aria-expanded={denying} onClick={() => setDenying(true)}>
          {t('noEllipsis')}
        </button>
        {request.canAllowAlways && (
          <button className="button wide" onClick={() => onAnswer({ decision: 'allowAlways' })}>
            {t('yesAlways')}
          </button>
        )}
      </div>
      {denying && <Reveal label={t('denyReasonLabel')} placeholder={t('denyReasonPlaceholder')} action={t('answerNo')} danger onSend={(reason) => onAnswer({ decision: 'deny', reason })} />}
    </>
  )
}

function QuestionCard({ request, onAnswer }: { request: Request; onAnswer: (answer: Answer) => void }) {
  const questions = (Array.isArray(request.input.questions) ? request.input.questions : []) as Question[]
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const OTHER = '\u0000other'
  const choose = (question: Question, label: string) =>
    setChosen((current) => {
      const selected = current[question.question] ?? []
      if (!question.multiSelect) return { ...current, [question.question]: [label] }
      return { ...current, [question.question]: selected.includes(label) ? selected.filter((entry) => entry !== label) : [...selected, label] }
    })
  const answerOf = (question: Question) => (chosen[question.question] ?? []).map((label) => (label === OTHER ? (other[question.question] ?? '') : label)).filter(Boolean).join(', ')
  const complete = questions.every((question) => answerOf(question))
  return (
    <>
      {questions.map((question) => (
        <fieldset key={question.question} className="question">
          <legend>
            <span className="chip">{question.header}</span> {question.question}
          </legend>
          {[...question.options, { label: OTHER, description: t('otherHint') }].map((option) => (
            <label key={option.label} className="option">
              <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.question} checked={chosen[question.question]?.includes(option.label) ?? false} onChange={() => choose(question, option.label)} />
              <span>
                {option.label === OTHER ? t('otherEllipsis') : option.label}
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          {chosen[question.question]?.includes(OTHER) && (
            <div className="reveal">
              <input className="field" aria-label={t('yourAnswer')} placeholder={t('yourAnswer')} autoFocus value={other[question.question] ?? ''} onChange={(event) => setOther((current) => ({ ...current, [question.question]: event.target.value }))} />
            </div>
          )}
        </fieldset>
      ))}
      <div className="grant-row">
        <button className="button primary" disabled={!complete} onClick={() => onAnswer({ decision: 'allow', answers: Object.fromEntries(questions.map((question) => [question.question, answerOf(question)])) })}>
          {t('answer')}
        </button>
        <button className="button" onClick={() => onAnswer({ decision: 'deny' })}>
          {t('skip')}
        </button>
      </div>
    </>
  )
}

function PlanCard({ request, onAnswer }: { request: Request; onAnswer: (answer: Answer) => void }) {
  const { capabilities } = useTouch()
  const [keepPlanning, setKeepPlanning] = useState(false)
  const plan = typeof request.input.plan === 'string' ? request.input.plan : JSON.stringify(request.input, null, 2)
  return (
    <>
      <h2>{t('planTitleTouch')}</h2>
      <div className="preview msg-ai">
        <Markdown text={plan} openExternal={capabilities.openExternal} />
      </div>
      <button className="button primary" onClick={() => onAnswer({ decision: 'allow', planNextMode: 'acceptEdits' })}>
        {t('planAutoAccept')}
      </button>
      <button className="button" onClick={() => onAnswer({ decision: 'allow', planNextMode: 'default' })}>
        {t('planApproveEach')}
      </button>
      <button className="button" aria-expanded={keepPlanning} onClick={() => setKeepPlanning(true)}>
        {t('planKeepPlanningEllipsis')}
      </button>
      {keepPlanning && <Reveal label={t('planFeedbackLabel')} placeholder={t('planFeedbackPlaceholder')} action={t('sendToClaude')} onSend={(reason) => onAnswer({ decision: 'deny', reason })} />}
    </>
  )
}
