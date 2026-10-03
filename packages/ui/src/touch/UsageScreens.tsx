import { useEffect } from 'react'
import type { ContextUsage, Usage } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { accountName } from './accounts.tsx'
import { useScreen, useTouch } from './context.tsx'
import { durationLabel, modelShortName, resetLabel, tokenLabel, usdLabel } from './model.ts'
import { IconButton, Title, useQuery } from './parts.tsx'

// Shades of the accent for the categories that fill the context window, in order (then the last one again).
const SHADES = 5
type Category = ContextUsage['categories'][number]

// Share of the window, as a percentage with no decimals ("24%").
const share = (tokens: number, max: number) => `${Math.round((tokens / Math.max(1, max)) * 100)}%`

// The bar of the window: one segment per category that fills it, the compaction reserve striped, the rest empty.
function WindowBar({ usage }: { usage: ContextUsage }) {
  const used = usage.categories.filter((row) => row.kind === 'used' && row.tokens > 0)
  const buffer = usage.categories.find((row) => row.kind === 'buffer')
  return (
    <svg className="ctx-bar" viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true">
      {(() => {
        let x = 0
        const width = (tokens: number) => (tokens / Math.max(1, usage.maxTokens)) * 1000
        const parts = used.map((row, index) => {
          const part = <rect key={row.name} className={`shade${Math.min(index, SHADES - 1)}`} x={x} y="0" width={width(row.tokens)} height="12" />
          x += width(row.tokens)
          return part
        })
        if (buffer?.tokens) parts.push(<rect key="buffer" className="reserve" x={1000 - width(buffer.tokens)} y="0" width={width(buffer.tokens)} height="12" />)
        return parts
      })()}
    </svg>
  )
}

// A row of the window's categories: its shade, name, tokens and share.
function CategoryRow({ row, shade, max }: { row: Category; shade?: number; max: number }) {
  return (
    <li className="row ctx-row">
      <span className={`ctx-swatch ${row.kind === 'used' ? `shade${Math.min(shade ?? 0, SHADES - 1)}` : row.kind}`} aria-hidden="true" />
      <span className="row-main">
        <span className="row-title plain">{row.name}</span>
      </span>
      <span className="ctx-num">
        {tokenLabel(row.tokens)} <span className="muted">{share(row.tokens, max)}</span>
      </span>
    </li>
  )
}

// The session's context window, as /context: tokens in use over the window, the bar, the categories, when it
// compacts by itself (and "Compatta ora", written into the composer), memory files and MCP servers. Asked again each
// time the screen comes back on top.
export function ContextScreen({ tabId }: { tabId: string }) {
  const { connection, back, backTo, insertInComposer } = useTouch()
  const { top } = useScreen()
  const { data, reload } = useQuery(() => connection.request('tab.context', { tabId }), [connection, tabId])
  useEffect(() => void (top && data && reload()), [top])
  const compact = () => {
    insertInComposer(tabId, { text: '/compact', replace: true })
    backTo((screen) => screen.name === 'chat' && screen.tabId === tabId)
  }
  const used = data?.categories.filter((row) => row.kind === 'used' && row.tokens > 0) ?? []
  const others = data?.categories.filter((row) => row.kind !== 'used' && row.tokens > 0) ?? []
  return (
    <section className="screen" aria-label={t('later_context')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('later_context')} sub={data ? modelShortName(data.model) : t('loading')} />
      </header>
      <div className="scroll">
        {data ? (
          <div className="pad">
            <div className="card">
              <p className="ctx-total">
                <strong>{tokenLabel(data.totalTokens)}</strong> / {tokenLabel(data.maxTokens)} {t('tokens')}
                <span className="ctx-percent">{data.percentage}%</span>
              </p>
              <WindowBar usage={data} />
              <p className="muted flat">{data.autoCompact ? (data.autoCompactThreshold ? t('autoCompactAt', { tokens: tokenLabel(data.autoCompactThreshold), share: share(data.autoCompactThreshold, data.maxTokens) }) : t('autoCompactOn')) : t('autoCompactOff')}</p>
              <button className="button block" onClick={compact}>
                {t('compactNow')}
              </button>
            </div>
            <div className="group">
              <p className="label">{t('contextCategories')}</p>
              <ul className="list">
                {used.map((row, index) => (
                  <CategoryRow key={row.name} row={row} shade={index} max={data.maxTokens} />
                ))}
                {others.map((row) => (
                  <CategoryRow key={row.name} row={row} max={data.maxTokens} />
                ))}
              </ul>
            </div>
            {data.memoryFiles.length > 0 && (
              <div className="group">
                <p className="label">{t('memoryFiles')}</p>
                <ul className="list">
                  {data.memoryFiles.map((file) => (
                    <li key={file.path} className="row ctx-row">
                      <span className="row-main">
                        <span className="row-title plain mono-line">{file.path}</span>
                        <span className="row-sub">{file.type}</span>
                      </span>
                      <span className="ctx-num">{tokenLabel(file.tokens)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.mcpServers.length > 0 && (
              <div className="group">
                <p className="label">{t('mcpServersTitle')}</p>
                <ul className="list">
                  {data.mcpServers.map((server) => (
                    <li key={server.name} className="row ctx-row">
                      <span className="row-main">
                        <span className="row-title plain">{server.name}</span>
                        <span className="row-sub">{t(server.tools === 1 ? 'oneTool' : 'toolsCount', { count: String(server.tools) })}</span>
                      </span>
                      <span className="ctx-num">{tokenLabel(server.tokens)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="empty-line" role="status">
            {t('askingClaude')}
          </p>
        )}
      </div>
    </section>
  )
}

type Limits = NonNullable<Usage['limits']>
type LimitWindow = NonNullable<Limits['fiveHour']>

// One plan window: its name, how much is used (a meter) and when it resets.
function LimitRow({ name, window }: { name: string; window: LimitWindow }) {
  const used = window.utilization ?? 0
  return (
    <li className="row usage-row">
      <span className="row-main">
        <span className="usage-head">
          <span className="row-title plain">{name}</span>
          <span className="ctx-num">{window.utilization === null ? '–' : `${Math.round(used)}%`}</span>
        </span>
        <meter className={`usage-meter${used >= 90 ? ' high' : ''}`} min={0} max={100} value={used} aria-label={name} />
        {window.resetsAt && <span className="row-sub">{t('resetsAt', { when: resetLabel(window.resetsAt) })}</span>}
      </span>
    </li>
  )
}

// A line of the session's figures: what it is and its value.
function FigureRow({ name, value }: { name: string; value: string }) {
  return (
    <li className="row ctx-row">
      <span className="row-main">
        <span className="row-title plain">{name}</span>
      </span>
      <span className="ctx-num">{value}</span>
    </li>
  )
}

// Cost and plan limits, as /usage: the account's windows (5 hours, week, per model, extra usage) with when they
// reset, then the session's cost, time, lines and tokens per model. Asked again each time it comes back on top.
export function UsageScreen({ tabId }: { tabId: string }) {
  const { connection, state, back } = useTouch()
  const { top } = useScreen()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const { data, reload } = useQuery(() => connection.request('tab.usage', { tabId }), [connection, tabId])
  useEffect(() => void (top && data && reload()), [top])
  const limits = data?.limits
  const windows: [string, LimitWindow | undefined][] = limits
    ? [
        [t('limitFiveHour'), limits.fiveHour],
        [t('limitWeek'), limits.sevenDay],
        [t('limitWeekModel', { model: 'Opus' }), limits.sevenDayOpus],
        [t('limitWeekModel', { model: 'Sonnet' }), limits.sevenDaySonnet],
        ...limits.models.map((window): [string, LimitWindow] => [t('limitWeekModel', { model: window.name }), window])
      ]
    : []
  const account = meta ? accountName(state, meta.account) : ''
  const plan = data?.subscription ? `${data.subscription[0]!.toUpperCase()}${data.subscription.slice(1)}` : undefined
  const session = data?.session
  return (
    <section className="screen" aria-label={t('later_usage')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('later_usage')} sub={plan ? `${account} · ${plan}` : account} />
      </header>
      <div className="scroll">
        {data && session ? (
          <div className="pad">
            <div className="group">
              <p className="label">{t('planLimits')}</p>
              {limits ? (
                <ul className="list">
                  {windows.map(([name, window]) => window && <LimitRow key={name} name={name} window={window} />)}
                  {limits.extra?.enabled && (
                    <FigureRow
                      name={t('extraUsage')}
                      value={limits.extra.usedCredits === null ? '–' : `${limits.extra.usedCredits.toLocaleString(undefined, { style: 'currency', currency: limits.extra.currency ?? 'USD' })}${limits.extra.monthlyLimit === null ? '' : ` / ${limits.extra.monthlyLimit.toLocaleString(undefined, { style: 'currency', currency: limits.extra.currency ?? 'USD' })}`}`}
                    />
                  )}
                </ul>
              ) : (
                <p className="muted flat">{t('noPlanLimits')}</p>
              )}
            </div>
            <div className="group">
              <p className="label">{t('thisSession')}</p>
              <ul className="list">
                <FigureRow name={t('sessionCost')} value={usdLabel(session.costUsd)} />
                <FigureRow name={t('sessionTime')} value={t('timeWithApi', { total: durationLabel(session.durationMs), api: durationLabel(session.apiDurationMs) })} />
                <FigureRow name={t('linesChanged')} value={`+${session.linesAdded} −${session.linesRemoved}`} />
              </ul>
              {data.subscription && <p className="muted flat">{t('costIsEstimate')}</p>}
            </div>
            {session.models.length > 0 && (
              <div className="group">
                <p className="label">{t('tokensByModel')}</p>
                <ul className="list">
                  {session.models.map((model) => (
                    <li key={model.model} className="row ctx-row">
                      <span className="row-main">
                        <span className="row-title plain">{modelShortName(model.model)}</span>
                        <span className="row-sub">{t('tokensInOut', { input: tokenLabel(model.inputTokens), output: tokenLabel(model.outputTokens), cache: tokenLabel(model.cacheReadTokens + model.cacheWriteTokens) })}</span>
                      </span>
                      <span className="ctx-num">{usdLabel(model.costUsd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="empty-line" role="status">
            {t('askingClaude')}
          </p>
        )}
      </div>
    </section>
  )
}
