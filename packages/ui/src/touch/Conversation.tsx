import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TabView } from '@athome/client'
import type { Image, ImageRef, Item, Request, TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { dataUrl } from '../images.ts'
import { Markdown, type FencedBlock } from '../Markdown.tsx'
import type { Answer } from '../chatHooks.ts'
import { ContinueCard, LimitCard } from './accounts.tsx'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { WidgetBlock } from './WidgetBlock.tsx'
import { widgetSpec } from './widget.ts'
import { useWidgetActions } from './widgetActions.ts'
import { answeredQuestions, durationLabel } from './model.ts'

type LoadImage = (imageId: string) => Promise<Image>
type ToolCall = Extract<Item, { kind: 'toolCall' }>
type TurnEnd = Extract<Item, { kind: 'turnEnd' }>
type UserItem = Extract<Item, { kind: 'user' }>
type PeerItem = Extract<Item, { kind: 'peerMessage' }>
type Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string; preview?: string }[] }

// Cards shown in a stack of tool calls: the last one in front, up to three behind it.
const STACK_SHOWN = 4
// Duration of the stack opening or closing (ms).
const STACK_MS = 280

// The tool through which Claude asks multiple-choice questions.
const QUESTION_TOOL = 'AskUserQuestion'

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
function UserMessage({ item, readAt, loadImage, onActions, onSendNow, onUnsend }: { item: UserItem; readAt?: number; loadImage: LoadImage; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown>; onUnsend: (item: UserItem) => Promise<unknown> }) {
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
      <button className="unsend" aria-label={t('unsendPending')} title={t('unsendPending')} disabled={sending} onClick={() => (setSending(true), void onUnsend(item).finally(() => setSending(false)))}>
        <Icon name="unsend" />
      </button>
      <button className="send-now" aria-label={t('sendPendingNow')} title={t('sendPendingNow')} disabled={sending} onClick={() => (setSending(true), void onSendNow(item).finally(() => setSending(false)))}>
        <Icon name="send" />
      </button>
      {bubble}
    </div>
  )
}

// State word of a tool call.
function toolState(item: ToolCall): string {
  return item.result === undefined ? t('toolRunning') : item.isError ? t('toolFailed') : t('toolDone')
}

// Name, summary and state of a tool call: the closed card's line.
function ToolLine({ item }: { item: ToolCall }) {
  return (
    <>
      <span className="tool-name">{item.name}</span>
      <span className="tool-sum">{toolSummary(item.input)}</span>
      <span className={`tool-state${item.result === undefined ? '' : item.isError ? ' bad' : ' ok'}`}>{toolState(item)}</span>
    </>
  )
}

// A form of questions Claude asked, once answered or skipped: each question with the answer given (the request
// card held it while it waited). A call whose input has no questions stays a plain tool card.
function AnsweredCard({ item }: { item: ToolCall }) {
  const answered = answeredQuestions(item.input, item.result ?? '')
  if (!answered.length) return <ToolCard item={item} />
  return (
    <section className="answered" aria-label={t('yourAnswers')}>
      <span className="answered-title">{t('yourAnswers')}</span>
      {answered.map((entry) => (
        <div key={entry.question}>
          <p className="answered-q">
            <span className="chip">{entry.header}</span> {entry.question}
          </p>
          <p className={`answered-a${entry.answer ? '' : ' none'}`}>{entry.answer || t('notAnswered')}</p>
        </div>
      ))}
    </section>
  )
}

// A tool call: closed shows name, summary and state; open shows input and result.
function ToolCard({ item }: { item: ToolCall }) {
  return (
    <details className="tool" data-tool={item.itemId}>
      <summary>
        <ToolLine item={item} />
      </summary>
      <div className="tool-body">
        <pre>{JSON.stringify(item.input, null, 2)}</pre>
        {item.result !== undefined && <pre>{item.result}</pre>}
      </div>
    </details>
  )
}

// Tool calls in a row, as a stack like the queue's: the last one in front, the ones before it peeking out above.
// A tap spreads them out into their cards, one under the other; "Raggruppa" stacks them again. Each card slides
// between its two places (positions measured before and after the change).
// Parameters: the tool calls, two or more, oldest first.
function ToolStack({ items }: { items: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const before = useRef<Map<string, DOMRect> | undefined>(undefined)
  const toggle = (next: boolean) => {
    before.current = new Map([...(box.current?.querySelectorAll<HTMLElement>('[data-tool]') ?? [])].map((card) => [card.dataset.tool!, card.getBoundingClientRect()]))
    setOpen(next)
  }
  useLayoutEffect(() => {
    const first = before.current
    before.current = undefined
    if (!first || !box.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const card of box.current.querySelectorAll<HTMLElement>('[data-tool]')) {
      const from = first.get(card.dataset.tool!)
      const to = card.getBoundingClientRect()
      const frames = from ? [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }]
      card.animate(frames, { duration: STACK_MS, easing: 'cubic-bezier(.25, .8, .25, 1)' })
    }
  }, [open])
  const last = items[items.length - 1]!
  if (open) {
    return (
      <div className="tool-group" ref={box}>
        <button className="tool-collapse" aria-expanded="true" onClick={() => toggle(false)}>
          <Icon name="up" />
          {t('toolStackClose', { count: String(items.length) })}
        </button>
        {items.map((item) => (
          <ToolCard key={item.itemId} item={item} />
        ))}
      </div>
    )
  }
  const shown = items.slice(-STACK_SHOWN)
  const m = shown.length - 1
  return (
    <div className="tool-group" ref={box}>
      <button className={`tool-stack m${m}`} aria-expanded="false" aria-label={t('toolStackLabel', { count: String(items.length), name: last.name, summary: toolSummary(last.input), state: toolState(last) })} onClick={() => toggle(true)}>
        {shown.map((item, index) => (
          <span key={item.itemId} className={`tool-card k${m - index} m${m}`} data-tool={item.itemId} aria-hidden="true">
            {index === m && (
              <>
                <ToolLine item={item} />
                <span className="tool-count">{items.length}</span>
              </>
            )}
          </span>
        ))}
      </button>
    </div>
  )
}

// The transcript's items with tool calls in a row gathered: one item, or a run of two or more tool calls. Claude's
// questions are not a command: they stay out of the runs.
type Entry = { item: Item } | { tools: ToolCall[] }
function entries(items: Item[]): Entry[] {
  const out: Entry[] = []
  for (const item of items) {
    const previous = out[out.length - 1]
    if (item.kind !== 'toolCall' || item.name === QUESTION_TOOL) out.push({ item })
    else if (previous && 'tools' in previous) previous.tools.push(item)
    else out.push({ tools: [item] })
  }
  return out
}

// A reply of Claude: markdown, with its widget blocks shown as widgets acting on this chat.
function AssistantText({ tabId, text }: { tabId: string; text: string }) {
  const { capabilities } = useTouch()
  const onAction = useWidgetActions(tabId)
  const renderBlock = useCallback(({ className, body, closed }: FencedBlock) => {
    const spec = widgetSpec(className, body)
    return spec && <WidgetBlock spec={spec} closed={closed} onAction={onAction} />
  }, [onAction])
  return (
    <div className="msg-ai">
      <Markdown text={text} openExternal={capabilities.openExternal} renderBlock={renderBlock} />
    </div>
  )
}

// A message another Claude session sent here: its sender on top ("Da un'altra sessione" when it gave no name), its
// text as markdown like Claude's (never as HTML).
function PeerMessage({ item }: { item: PeerItem }) {
  const { capabilities } = useTouch()
  return (
    <div className="msg-peer">
      <span className="from">
        <Icon name="chats" />
        {item.from ? t('peerFrom', { name: item.from }) : t('peerFromSession')}
      </span>
      <Markdown text={item.text} openExternal={capabilities.openExternal} />
    </div>
  )
}

// One transcript item, as the prototype shows it.
function ItemView({ tabId, item, readAt, loadImage, onActions, onSendNow, onUnsend }: { tabId: string; item: Item; readAt?: number; loadImage: LoadImage; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown>; onUnsend: (item: UserItem) => Promise<unknown> }) {
  const { capabilities } = useTouch()
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} readAt={readAt} loadImage={loadImage} onActions={onActions} onSendNow={onSendNow} onUnsend={onUnsend} />
    case 'assistantText':
      return <AssistantText tabId={tabId} text={item.text} />
    case 'thinking':
      return (
        <details className="think">
          <summary>{t('thinkingSummary')}</summary>
          <p>{item.text}</p>
        </details>
      )
    case 'toolCall':
      if (item.name === QUESTION_TOOL) return item.result === undefined ? null : <AnsweredCard item={item} />
      return <ToolCard item={item} />
    case 'turnEnd':
      return <div className={`turn-end${item.error ? ' bad' : ''}`}>{turnEndText(item)}</div>
    case 'notice':
      return item.level === 'info' ? <p className="notice-line">{item.text}</p> : <div className={`warn${item.level === 'error' ? ' bad' : ''}`}>{item.text}</div>
    case 'peerMessage':
      return <PeerMessage item={item} />
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

// The turn's work time, from core's workingSince (it survives reopening the app and leaves out the time Claude waited
// for an answer), re-read every second. The one source of the working line and of its mini label.
// Parameters: TabMeta.workingSince, undefined while Claude starts. Returns the full text ("Claude is working · 12 s")
// and the elapsed time alone ("" while starting).
function useWorkingText(since?: number) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const time = since === undefined ? '' : durationLabel(Math.max(0, Date.now() - since))
  return { time, text: since === undefined ? t('startingClaude') : t('workingFor', { time }) }
}

// "Claude is working · 12 s", at the end of the text (it scrolls with it).
// Parameters: since (see useWorkingText), the element's ref (the chat watches whether it is in view).
function WorkingLine({ since, lineRef }: { since?: number; lineRef?: React.Ref<HTMLDivElement> }) {
  const { text } = useWorkingText(since)
  return (
    <div className="working-line" ref={lineRef}>
      <span className="badge working" />
      <span>{text}</span>
    </div>
  )
}

// The working line's mini label while the line is out of view: only the dot and the time, the words for screen readers.
// show: the line is out of view during a turn; when it turns false the label stays a moment (.leaving) to slide back
// under the box, with its last time, then unmounts. since: when the turn started. Returns null once gone.
export function WorkingMini({ show, since }: { show: boolean; since?: number }) {
  const [shown, setShown] = useState(show)
  const [lastSince, setLastSince] = useState(since)
  if (show && !shown) setShown(true)
  if (show && since !== undefined && since !== lastSince) setLastSince(since)
  useEffect(() => {
    if (show || !shown) return
    const timer = setTimeout(() => setShown(false), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [show, shown])
  return shown ? <MiniLabel since={lastSince} leaving={!show} /> : null
}

// How long the mini label takes to slide back under the box (as mini-in in touch.css).
const LEAVE_MS = 220

// The mini label itself. since: when the turn started; leaving: it is sliding back under the box.
function MiniLabel({ since, leaving }: { since?: number; leaving: boolean }) {
  const { time, text } = useWorkingText(since)
  return (
    <div className={leaving ? 'working-mini leaving' : 'working-mini'} role="img" aria-label={text}>
      <span className="badge working" />
      {time && <span aria-hidden="true">{time}</span>}
    </div>
  )
}

type ConversationProps = { meta: TabMeta; view?: TabView; loadImage: LoadImage; onAnswer: (requestId: string, answer: Answer) => void; onRestart: () => void; onTrust: () => void; onActions: (item: UserItem) => void; onSendNow: (item: UserItem) => Promise<unknown>; onUnsend: (item: UserItem) => Promise<unknown>; workingRef?: React.Ref<HTMLDivElement> }

// The conversation: items, the working line, then Claude's request (part of the chat, it scrolls with it) and the cards of
// a stopped process or an untrusted folder.
export function Conversation({ meta, view, loadImage, onAnswer, onRestart, onTrust, onActions, onSendNow, onUnsend, workingRef }: ConversationProps) {
  const items = view?.items ?? []
  const readAt = useReadTimes(items)
  const request = view?.requests[0]
  return (
    <>
      {entries(items).map((entry) =>
        'item' in entry ? (
          <ItemView key={entry.item.itemId} tabId={meta.tabId} item={entry.item} readAt={readAt[entry.item.itemId]} loadImage={loadImage} onActions={onActions} onSendNow={onSendNow} onUnsend={onUnsend} />
        ) : entry.tools.length === 1 ? (
          <ToolCard key={entry.tools[0]!.itemId} item={entry.tools[0]!} />
        ) : (
          <ToolStack key={entry.tools[0]!.itemId} items={entry.tools} />
        )
      )}
      {(meta.status === 'running' || meta.status === 'starting') && <WorkingLine since={meta.status === 'running' ? meta.workingSince : undefined} lineRef={workingRef} />}
      <LimitCard meta={meta} />
      <ContinueCard meta={meta} />
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

const OTHER = '\u0000other'

// Claude's multiple-choice questions, one at a time like the CLI: with more than one, a row of steps (one per
// header, tap = go to it) sits on top; choosing an answer of a single-choice question moves on to the next one.
// Answer, on the last step, sends them all once each has an answer; Skip declines the whole form.
function QuestionCard({ request, onAnswer }: { request: Request; onAnswer: (answer: Answer) => void }) {
  const questions = (Array.isArray(request.input.questions) ? request.input.questions : []) as Question[]
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const last = step >= questions.length - 1
  const choose = (question: Question, label: string) => {
    setChosen((current) => {
      const selected = current[question.question] ?? []
      if (!question.multiSelect) return { ...current, [question.question]: [label] }
      return { ...current, [question.question]: selected.includes(label) ? selected.filter((entry) => entry !== label) : [...selected, label] }
    })
    if (!question.multiSelect && label !== OTHER && !last) setStep(step + 1)
  }
  const answerOf = (question: Question) => (chosen[question.question] ?? []).map((label) => (label === OTHER ? (other[question.question] ?? '') : label)).filter(Boolean).join(', ')
  const complete = questions.every((question) => answerOf(question))
  const question = questions[step]
  return (
    <>
      {questions.length > 1 && <QuestionSteps questions={questions} step={step} answered={(entry) => Boolean(answerOf(entry))} onStep={setStep} />}
      {question && (
        <QuestionFields
          key={question.question}
          question={question}
          label={questions.length > 1 ? t('questionStep', { header: question.header, n: String(step + 1), total: String(questions.length) }) : undefined}
          chosen={chosen[question.question] ?? []}
          other={other[question.question] ?? ''}
          onChoose={(label) => choose(question, label)}
          onOther={(text) => setOther((current) => ({ ...current, [question.question]: text }))}
        />
      )}
      <div className="grant-row">
        {last ? (
          <button className="button primary" disabled={!complete} onClick={() => onAnswer({ decision: 'allow', answers: Object.fromEntries(questions.map((entry) => [entry.question, answerOf(entry)])) })}>
            {t('answer')}
          </button>
        ) : (
          <button className="button primary" disabled={!question || !answerOf(question)} onClick={() => setStep(step + 1)}>
            {t('nextQuestion')}
          </button>
        )}
        <button className="button" onClick={() => onAnswer({ decision: 'deny' })}>
          {t('skip')}
        </button>
      </div>
    </>
  )
}

// The steps of a form with several questions: one button per header, the current one marked, the answered ones
// filled. Params: the questions, the current step, whether a question has an answer, the callback to change step.
function QuestionSteps({ questions, step, answered, onStep }: { questions: Question[]; step: number; answered: (question: Question) => boolean; onStep: (step: number) => void }) {
  return (
    <nav className="question-steps" aria-label={t('questionSteps')}>
      {questions.map((question, index) => (
        <button key={question.question} className={`question-step${answered(question) ? ' done' : ''}`} aria-current={index === step ? 'step' : undefined} onClick={() => onStep(index)}>
          {question.header}
        </button>
      ))}
    </nav>
  )
}

// One question with its options, plus "Other…" and its field once chosen. Params: the question, the group's label
// (the step, when the form has several), the chosen labels, the "Other" text and the callbacks that change them.
function QuestionFields({ question, label, chosen, other, onChoose, onOther }: { question: Question; label?: string; chosen: string[]; other: string; onChoose: (label: string) => void; onOther: (text: string) => void }) {
  return (
    <fieldset className="question" aria-label={label}>
      <legend>
        <span className="chip">{question.header}</span> {question.question}
      </legend>
      {[...question.options, { label: OTHER, description: t('otherHint') }].map((option) => (
        <label key={option.label} className="option">
          <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.question} checked={chosen.includes(option.label)} onChange={() => onChoose(option.label)} />
          <span>
            {option.label === OTHER ? t('otherEllipsis') : option.label}
            <small>{option.description}</small>
          </span>
        </label>
      ))}
      {chosen.includes(OTHER) && (
        <div className="reveal">
          <input className="field" aria-label={t('yourAnswer')} placeholder={t('yourAnswer')} autoFocus value={other} onChange={(event) => onOther(event.target.value)} />
        </div>
      )}
    </fieldset>
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
