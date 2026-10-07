import type { HookEntry, HookRun, Hooks } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { InspectBody, InspectTop, useInspect, useReloadOnTop, useSessionSub } from './inspect.tsx'
import { when } from './sessions.tsx'

// Colour of a run's outcome chip.
const OUTCOME_CHIP: Record<HookRun['outcome'], string> = { success: '', error: ' bad', cancelled: '' }
// Policies that switch hooks off, in the order they are told.
const POLICIES = ['allDisabled', 'managedOnly', 'disabledByPolicy', 'pluginOnly'] as const

// What limits the hooks (policy, safe mode) as notices at the top, none when nothing does.
function PolicyNotices({ listing }: { listing: Hooks['listing'] }) {
  const policy = listing.policy
  const lines = policy ? POLICIES.filter((key) => policy[key]).map((key) => t(`hooksPolicy_${key}`)) : []
  if (listing.safeMode) lines.push(listing.safeMode.exitHint ? `${t('hooksSafeMode')} ${listing.safeMode.exitHint}` : t('hooksSafeMode'))
  if (!lines.length) return null
  return (
    <div className="card compact" role="status">
      {lines.map((line) => (
        <span key={line} className="selectable">
          {line}
        </span>
      ))}
    </div>
  )
}

// The hooks grouped by event, in the order each event first appears.
function byEvent(hooks: HookEntry[]): [string, HookEntry[]][] {
  const groups = new Map<string, HookEntry[]>()
  for (const hook of hooks) groups.set(hook.event, [...(groups.get(hook.event) ?? []), hook])
  return [...groups]
}

// One configured hook: its matcher (or "all"), where it comes from, the command clamped in mono; dimmed when off.
function HookRow({ hook }: { hook: HookEntry }) {
  return (
    <li className={`row${hook.disabled ? ' dim' : ''}`}>
      <span className="row-main">
        <span className="row-title plain">{hook.matcher || t('hooksAll')}</span>
        <span className="row-sub">{[hook.sourceLabel ?? hook.source, hook.disabled ? t('hooksOff') : undefined].filter(Boolean).join(' · ')}</span>
        <span className="row-sub clamp mono-line">{hook.commandText ?? hook.type}</span>
      </span>
    </li>
  )
}

// The text of a run's output stream (plain text, never markup), or "No output".
function OutputBlock({ label, text }: { label: string; text?: string }) {
  return (
    <div className="group">
      <p className="label">{label}</p>
      {text ? <pre className="local-output tall selectable">{text}</pre> : <p className="muted flat">{t('hooksNoOutput')}</p>}
    </div>
  )
}

// The details of one run: its name, outcome, exit code and time, then what it printed.
function RunSheet({ run }: { run: HookRun }) {
  const facts = [t(`hookOutcome_${run.outcome}`), run.exitCode === undefined ? undefined : t('hookExit', { code: String(run.exitCode) }), when(run.at)].filter(Boolean).join(' · ')
  return (
    <>
      <p className="muted flat">{facts}</p>
      <p className="mono-line selectable">{run.name}</p>
      <OutputBlock label={t('hookStdout')} text={run.stdout} />
      <OutputBlock label={t('hookStderr')} text={run.stderr} />
    </>
  )
}

// One recorded run: event and name, outcome chip, exit code and time; a tap opens its output.
function RunRow({ run }: { run: HookRun }) {
  const { openSheet } = useTouch()
  return (
    <li className="row">
      <button className="row-main" onClick={() => openSheet({ title: run.event, body: <RunSheet run={run} /> })}>
        <span className="row-title plain">{run.event}</span>
        <span className="row-sub clamp mono-line">{run.name}</span>
        <span className="row-sub">{[run.exitCode === undefined ? undefined : t('hookExit', { code: String(run.exitCode) }), when(run.at)].filter(Boolean).join(' · ')}</span>
      </button>
      <span className={`chip${OUTCOME_CHIP[run.outcome]}`}>{t(`hookOutcome_${run.outcome}`)}</span>
      <Icon name="chevron" className="chevron" />
    </li>
  )
}

// The session's hooks, as /hooks (read only): what limits them, the configured ones by event, then the last runs of
// this session, newest first, each opening its output.
export function HooksScreen({ tabId }: { tabId: string }) {
  const { connection } = useTouch()
  const inspect = useInspect(() => connection.request('tab.hooks', { tabId }), [connection, tabId])
  useReloadOnTop(inspect)
  return (
    <section className="screen" aria-label={t('later_hooks')}>
      <InspectTop title={t('later_hooks')} sub={useSessionSub(tabId)} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {(data) => (
          <>
            <PolicyNotices listing={data.listing} />
            {data.listing.hooks.length ? (
              byEvent(data.listing.hooks).map(([event, hooks]) => (
                <div key={event} className="group">
                  <p className="label">{event}</p>
                  <ul className="list">
                    {hooks.map((hook, index) => (
                      <HookRow key={`${hook.matcher}${hook.source}${index}`} hook={hook} />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="empty-line">{t('hooksNone')}</p>
            )}
            <div className="group">
              <p className="label">{t('hooksRecent')}</p>
              {data.runs.length ? (
                <ul className="list">
                  {[...data.runs].reverse().map((run, index) => (
                    <RunRow key={`${run.at}${index}`} run={run} />
                  ))}
                </ul>
              ) : (
                <p className="muted flat">{t('hooksNoRuns')}</p>
              )}
            </div>
          </>
        )}
      </InspectBody>
    </section>
  )
}
