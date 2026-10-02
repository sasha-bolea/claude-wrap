import { useEffect, useRef, useState } from 'react'
import type { CommandArgs, Request } from '@claude-wrap/protocol'
import { isFocusFree } from './focus.ts'
import { t } from './i18n.ts'
import { Markdown } from './Markdown.tsx'

export type Answer = Omit<CommandArgs<'request.answer'>, 'tabId' | 'requestId'>
type DialogProps = { request: Request; onAnswer: (answer: Answer) => void; openExternal?: (url: string) => void }
type Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string; preview?: string }[] }

// Panel for the open request, with the dialog matching its kind. It appeared by itself, so it takes the focus
// only if the focus is free, and on the container (tabIndex -1), never on a button: Enter or Space cannot grant
// anything by mistake. Otherwise the request is announced through the chat's aria-live region.
export function RequestPanel(props: DialogProps) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (isFocusFree()) panel.current?.focus()
  }, [])
  const { kind } = props.request
  const label = kind === 'question' ? t('questionRegion') : kind === 'plan' ? t('planRegion') : t('permissionRegion')
  return (
    <section ref={panel} className="request-panel" tabIndex={-1} aria-label={label}>
      {kind === 'question' ? <QuestionDialog {...props} /> : kind === 'plan' ? <PlanDialog {...props} /> : <PermissionDialog {...props} />}
    </section>
  )
}

// Tool permission: yes once / yes and don't ask again (rule suggested by the CLI) / no with a reason.
function PermissionDialog({ request, onAnswer }: DialogProps) {
  const [reason, setReason] = useState('')
  return (
    <>
      <h3>{request.title ?? t('permissionTitle', { tool: request.displayName ?? request.toolName })}</h3>
      {request.description && <p className="muted">{request.description}</p>}
      {request.decisionReason && <p className="muted">{request.decisionReason}</p>}
      <pre className="preview">{JSON.stringify(request.input, null, 2)}</pre>
      <input className="field" aria-label={t('denyReason')} placeholder={t('denyReason')} value={reason} onChange={(event) => setReason(event.target.value)} />
      <div className="actions">
        <button className="button primary" onClick={() => onAnswer({ decision: 'allow' })}>
          {t('yes')}
        </button>
        {request.canAllowAlways && (
          <button className="button" onClick={() => onAnswer({ decision: 'allowAlways' })}>
            {t('yesAlways')}
          </button>
        )}
        <button className="button danger" onClick={() => onAnswer({ decision: 'deny', reason })}>
          {t('no')}
        </button>
      </div>
    </>
  )
}

// AskUserQuestion: one or more choices per question, plus a free "Other" answer.
function QuestionDialog({ request, onAnswer }: DialogProps) {
  const questions = (Array.isArray(request.input.questions) ? request.input.questions : []) as Question[]
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  // Toggles an option; in single choice it replaces the previous one.
  const choose = (question: Question, label: string) =>
    setChosen((current) => {
      const selected = current[question.question] ?? []
      if (!question.multiSelect) return { ...current, [question.question]: [label] }
      return { ...current, [question.question]: selected.includes(label) ? selected.filter((entry) => entry !== label) : [...selected, label] }
    })
  // Answers in the tool's format: { question text: labels joined by ", " }.
  const answers = () => Object.fromEntries(questions.map((q) => [q.question, [...(chosen[q.question] ?? []), other[q.question]].filter(Boolean).join(', ')]))
  const complete = questions.every((q) => chosen[q.question]?.length || other[q.question])

  return (
    <>
      {questions.map((question) => (
        <fieldset key={question.question} className="question">
          <legend>
            <span className="chip">{question.header}</span> <strong>{question.question}</strong>
          </legend>
          {question.options.map((option) => (
            <label key={option.label} className="option">
              <input
                type={question.multiSelect ? 'checkbox' : 'radio'}
                name={question.question}
                checked={chosen[question.question]?.includes(option.label) ?? false}
                onChange={() => choose(question, option.label)}
              />
              <span>{option.label}</span>
              <span className="option-description">{option.description}</span>
              {option.preview && chosen[question.question]?.includes(option.label) && <pre className="preview option-description">{option.preview}</pre>}
            </label>
          ))}
          <input
            className="field"
            aria-label={t('otherAnswer')}
            placeholder={t('otherAnswer')}
            value={other[question.question] ?? ''}
            onChange={(event) => setOther((current) => ({ ...current, [question.question]: event.target.value }))}
          />
        </fieldset>
      ))}
      <div className="actions">
        <button className="button primary" disabled={!complete} onClick={() => onAnswer({ decision: 'allow', answers: answers() })}>
          {t('answer')}
        </button>
        <button className="button" onClick={() => onAnswer({ decision: 'deny' })}>
          {t('skip')}
        </button>
      </div>
    </>
  )
}

// ExitPlanMode: as in the CLI, approving also picks the mode to continue with.
function PlanDialog({ request, onAnswer, openExternal }: DialogProps) {
  const [feedback, setFeedback] = useState('')
  const plan = typeof request.input.plan === 'string' ? request.input.plan : ''
  return (
    <>
      <h3>{t('planTitle')}</h3>
      <div className="preview">{plan ? <Markdown text={plan} openExternal={openExternal} /> : <pre>{JSON.stringify(request.input, null, 2)}</pre>}</div>
      <input className="field" aria-label={t('planFeedback')} placeholder={t('planFeedback')} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
      <div className="actions">
        <button className="button primary" onClick={() => onAnswer({ decision: 'allow', planNextMode: 'acceptEdits' })}>
          {t('planAutoAccept')}
        </button>
        <button className="button" onClick={() => onAnswer({ decision: 'allow', planNextMode: 'default' })}>
          {t('planApproveEach')}
        </button>
        <button className="button" onClick={() => onAnswer({ decision: 'deny', reason: feedback })}>
          {t('planKeepPlanning')}
        </button>
      </div>
    </>
  )
}
