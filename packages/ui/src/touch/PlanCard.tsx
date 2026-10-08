import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { planHeading, stepParts } from './plans.ts'
import type { Plan } from '@athome/protocol'

// A caller's plan (Petra's, through the athome command) on the Home: its summary as the caller wrote it, then the
// steps in the app's own words (plans.ts) — what the core will let it do, in that order — with Approve / Reject;
// once approved, the current step and Cancel. The summary is the caller's text: React text only.

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
  const answer = (decision: 'approve' | 'reject') => connection.request('plans.answer', { planId: plan.planId, decision }).then(() => toast(t(decision === 'approve' ? 'planApproved' : 'planRejected')), fail)
  const cancel = () => connection.request('plans.cancel', { planId: plan.planId }).then(() => toast(t('planCancelled')), fail)
  return (
    <section className="card plan-card" aria-label={t('planFrom', { caller: plan.caller })}>
      <h2>{planHeading(plan)}</h2>
      <p className="plan-summary">{plan.summary}</p>
      <span className="muted">{t('planWillAllow')}</span>
      <ol className="plan-steps">
        {plan.steps.map((step, index) => (
          <li key={index} className={index < plan.cursor ? 'muted' : undefined}>
            {stepParts(step, state.tabs).map((part, at) =>
              part.kind === 'text' ? <span key={at}>{part.text}</span> : <span key={at} className={part.kind === 'free' ? 'chip free' : 'chip accent'}>{part.kind === 'existing' ? `${part.text} · ${t('planExisting')}` : part.text}</span>
            )}
          </li>
        ))}
      </ol>
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
