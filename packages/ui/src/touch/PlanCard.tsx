import { useMemo } from 'react'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { logParts, planHeading, planRows, type StepPart } from './plans.ts'
import type { Plan, PlanLogEntry } from '@athome/protocol'

// A caller's plan (Petra's, through the athome command) on the Home: its summary as the caller wrote it, then the
// steps in the app's own words (plans.ts) — what the core will let it do, in that order, with its choices, groups and
// optional steps indented — with Approve / Reject; once approved, what ran, what may run next, what is out, the
// caller's commands live (newest first: running, done, refused or failed, with why), and Cancel. The summary, the
// conditions and the logged values are the caller's text: React text only.

export function PlanCards() {
  const { state } = useTouch()
  if (!state.plans.length) return null
  return (
    <>
      {state.plans.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} />
      ))}
    </>
  )
}

function PlanCard({ plan }: { plan: Plan }) {
  const { state, connection, toast, fail } = useTouch()
  const rows = useMemo(() => planRows(plan, state.tabs), [plan, state.tabs])
  const answer = (decision: 'approve' | 'reject') => connection.request('plans.answer', { planId: plan.planId, decision }).then(() => toast(t(decision === 'approve' ? 'planApproved' : 'planRejected')), fail)
  const cancel = () => connection.request('plans.cancel', { planId: plan.planId }).then(() => toast(t('planCancelled')), fail)
  return (
    <section className="card plan-card" aria-label={t('planFrom', { caller: plan.caller })}>
      <h2>{planHeading(plan)}</h2>
      <p className="plan-summary">{plan.summary}</p>
      <span className="muted">{t('planWillAllow')}</span>
      <ul className="plan-steps">
        {rows.map((row, index) =>
          row.kind === 'step' ? (
            <li key={index} className={`plan-row depth-${row.depth} plan-${row.state}`}>
              <span className="plan-number">{row.number}.</span>
              <span>
                <Parts parts={row.parts} />
                {row.note && <span className="plan-note"> · {row.note}</span>}
              </span>
            </li>
          ) : (
            <li key={index} className={`plan-row depth-${row.depth} plan-${row.kind}`}>
              {row.text}
            </li>
          )
        )}
      </ul>
      {plan.log?.length ? <PlanLog log={plan.log} /> : null}
      <div className="card-actions">
        {plan.status === 'proposed' ? (
          <>
            <button className="button primary" onClick={() => void answer('approve')}>
              {t('planApprove')}
            </button>
            <button className="button danger" onClick={() => void answer('reject')}>
              {t('planReject')}
            </button>
          </>
        ) : (
          <button className="button quiet" onClick={() => void cancel()}>
            {t('planCancel')}
          </button>
        )}
      </div>
    </section>
  )
}

// A step's sentence: plain words, free text (a dashed chip), an existing target (an accent chip saying so).
function Parts({ parts }: { parts: StepPart[] }) {
  return (
    <>
      {parts.map((part, at) =>
        part.kind === 'text' ? <span key={at}>{part.text}</span> : <span key={at} className={part.kind === 'free' ? 'chip free' : 'chip accent'}>{part.kind === 'existing' ? `${part.text} · ${t('planExisting')}` : part.text}</span>
      )}
    </>
  )
}

const OUTCOME_CHIP = { running: 'chip accent', done: 'chip', refused: 'chip bad', failed: 'chip bad' } as const

// The caller's commands under the plan, newest first: time, outcome, step, what it did in the app's words, and why
// it was refused or failed.
function PlanLog({ log }: { log: PlanLogEntry[] }) {
  const { state } = useTouch()
  return (
    <section className="plan-log" aria-label={t('planLog')}>
      <span className="muted">{t('planLog')}</span>
      <ul>
        {[...log].reverse().map((entry, index) => (
          <li key={log.length - index} className={`plan-log-entry plan-log-${entry.outcome}`}>
            <span className="plan-time">{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={OUTCOME_CHIP[entry.outcome]}>{t(`planOutcome_${entry.outcome}`)}</span>
            <span>
              {entry.step ? <span className="muted">{t('planLogStep', { step: String(entry.step) })} · </span> : null}
              <Parts parts={logParts(entry, state.tabs)} />
              {entry.reason ? <span className="plan-reason">{entry.reason}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
