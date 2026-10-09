import { useMemo } from 'react'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { planHeading, planRows, type StepPart } from './plans.ts'
import type { Plan } from '@athome/protocol'

// A caller's plan (Petra's, through the athome command) on the Home: its summary as the caller wrote it, then the
// steps in the app's own words (plans.ts) — what the core will let it do, in that order, with its choices, groups and
// optional steps indented — with Approve / Reject; once approved, what ran, what may run next, what is out, and
// Cancel. The summary and the conditions are the caller's text: React text only.

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
