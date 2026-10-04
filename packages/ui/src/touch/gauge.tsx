import { useEffect } from 'react'
import type { LimitWindow, TabMeta } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { resetLabel, tokenLabel } from './model.ts'

// Ring radius and circumference of the gauge (SVG units, a 24×24 box).
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
// From this share on, the gauge and its bars turn to --danger.
const HIGH = 90

// A plan window whose reset time has passed: its last share no longer holds (it starts again from 0).
const isReset = (window: LimitWindow | undefined) => Boolean(window?.resetsAt && Date.parse(window.resetsAt) <= Date.now())

// The three shares the gauge watches (0-100, absent when unknown): context window, 5-hour and weekly plan windows.
function shares(meta: TabMeta): { context?: number; fiveHour?: number; week?: number } {
  const plan = (window: LimitWindow | undefined) => (isReset(window) ? 0 : window?.utilization === null || window?.utilization === undefined ? undefined : window.utilization)
  return { context: meta.context?.percentage, fiveHour: plan(meta.planLimits?.fiveHour), week: plan(meta.planLimits?.sevenDay) }
}

// The composer's gauge, right of the model: a ring filled to the highest of the three shares (the number only for
// screen readers and in the sheet); nothing until core has read one. A tap opens the sheet with the three bars.
export function GaugeButton({ meta }: { meta: TabMeta }) {
  const { openSheet } = useTouch()
  const known = Object.values(shares(meta)).filter((share): share is number => share !== undefined)
  if (!known.length) return null
  const top = Math.round(Math.max(...known))
  return (
    <button className={`gauge-btn${top >= HIGH ? ' high' : ''}`} aria-label={t('gaugeLabel', { share: String(top) })} onClick={() => openSheet({ title: t('gaugeTitle'), body: <GaugeSheet tabId={meta.tabId} /> })}>
      <svg className="gauge-ring" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="gauge-track" cx="12" cy="12" r={RADIUS} />
        <circle className="gauge-fill" cx="12" cy="12" r={RADIUS} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, top) / 100)} />
      </svg>
    </button>
  )
}

// One bar of the sheet: its name, the meter, and the share with what it measures under it.
function GaugeBar({ name, share, detail }: { name: string; share: number; detail: string }) {
  return (
    <div className="gauge-bar">
      <span className="row-title plain">{name}</span>
      <meter className={`usage-meter${share >= HIGH ? ' high' : ''}`} min={0} max={100} value={share} aria-label={name} />
      <span className="row-sub">
        <strong>{Math.round(share)}%</strong> · {detail}
      </span>
    </div>
  )
}

// The gauge's sheet: context window (tokens used / window), 5-hour and weekly plan windows (with when they reset;
// the plan reports shares only, no token counts) and "Compatta ora", which sends /compact at once (not while Claude
// works). Opening it asks core to read the gauges again from the live process.
function GaugeSheet({ tabId }: { tabId: string }) {
  const { state, connection, closeSheet, toast, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  useEffect(() => void connection.request('tab.refreshGauges', { tabId }).catch(() => undefined), [connection, tabId])
  if (!meta) return null
  const { context, fiveHour, week } = shares(meta)
  const busy = meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action'
  const compact = () => {
    closeSheet()
    connection.request('tab.send', { tabId, text: '/compact' }).then(() => toast(t('compactStarted')), fail)
  }
  const reset = (window: LimitWindow | undefined) => (isReset(window) ? t('resetDone') : window?.resetsAt ? t('resetsAt', { when: resetLabel(window.resetsAt) }) : t('resetUnknown'))
  return (
    <>
      {context !== undefined && meta.context && <GaugeBar name={t('later_context')} share={context} detail={`${tokenLabel(meta.context.totalTokens)} / ${tokenLabel(meta.context.maxTokens)} ${t('tokens')}`} />}
      {fiveHour !== undefined && <GaugeBar name={t('limitFiveHour')} share={fiveHour} detail={reset(meta.planLimits?.fiveHour)} />}
      {week !== undefined && <GaugeBar name={t('limitWeek')} share={week} detail={reset(meta.planLimits?.sevenDay)} />}
      {(fiveHour !== undefined || week !== undefined) && <p className="muted flat">{t('planSharesOnly')}</p>}
      <button className="button primary block" disabled={busy} onClick={compact}>
        {busy ? t('compactAfterTurn') : t('compactNow')}
      </button>
    </>
  )
}
