import { useCallback, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react'
import { t } from '../i18n.ts'
import { useScreen, useTouch, type Screen } from './context.tsx'
import { baseName, recentFirst } from './model.ts'
import { IconButton, Title } from './parts.tsx'
import { Icon } from './icons.tsx'

// Shared pieces of the native Status, MCP and Hooks panels: the query with its loading and error states, the top
// bar with Read again, and the "choose a session" sheet that Settings uses to open a per-session panel.

export type Inspect<T> = { data?: T; error?: string; reload: () => void }

// The text of a failed request.
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Loads a panel's data when deps change and again on reload(); the latest answer wins. A failure is kept as text (the
// panel shows it), the previous data stays while a reload fails.
// Parameters: the request and its dependencies. Returns the data, the error text and reload.
export function useInspect<T>(load: () => Promise<T>, deps: DependencyList): Inspect<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const latest = useRef(0)
  const run = useCallback(() => {
    const request = ++latest.current
    load().then(
      (value) => {
        if (request !== latest.current) return
        setData(value)
        setError(undefined)
      },
      (failure: unknown) => request === latest.current && setError(errorText(failure))
    )
    // load is a fresh function every render: deps decide when to ask again.
  }, deps)
  useEffect(run, [run])
  return { data, error, reload: run }
}

// Asks again each time the screen comes back on top (after a sheet or another screen), once it has data.
export function useReloadOnTop(inspect: Inspect<unknown>): void {
  const { top } = useScreen()
  useEffect(() => void (top && inspect.data && inspect.reload()), [top])
}

// Top bar of a panel: Back, the title with its sub line, and Read again at the right.
export function InspectTop({ title, sub, onRefresh }: { title: string; sub?: ReactNode; onRefresh: () => void }) {
  const { back } = useTouch()
  return (
    <header className="topbar">
      <IconButton icon="back" label={t('back')} onClick={back} />
      <Title text={title} sub={sub} />
      <IconButton icon="refresh" label={t('readAgain')} onClick={onRefresh} />
    </header>
  )
}

// The body of a panel: what to show once there is data, "Asking Claude Code…" while waiting, and the failure with
// Try again (above the data when a reload failed).
export function InspectBody<T>({ inspect, children }: { inspect: Inspect<T>; children: (data: T) => ReactNode }) {
  const { data, error, reload } = inspect
  return (
    <div className="scroll">
      {error && (
        <div className="pad">
          <div className="card bad" role="alert">
            <span className="selectable">{error}</span>
            <button className="button" onClick={reload}>
              {t('retry')}
            </button>
          </div>
        </div>
      )}
      {data ? (
        <div className="pad">{children(data)}</div>
      ) : (
        !error && (
          <p className="empty-line" role="status">
            {t('askingClaude')}
          </p>
        )
      )}
    </div>
  )
}

// The title of the session a panel is about: its name and folder, for the top bar's sub line.
export function useSessionSub(tabId: string): string {
  const { state } = useTouch()
  const tab = state.tabs.find((one) => one.tabId === tabId)
  return tab ? `${tab.title} · ${baseName(tab.cwd)}` : ''
}

// Settings → a per-session panel: the open sessions, most recently used first (title and folder); a tap opens the
// panel for that session. With none open, says how to start one.
// Parameters: the panel to open (without its tabId). Returns the sheet body.
export function SessionPickSheet({ panel }: { panel: 'mcp' | 'hooks' | 'status' }) {
  const { state, go } = useTouch()
  const tabs = recentFirst(state.tabs)
  if (!tabs.length) return <p className="muted flat">{t('pickNoSession')}</p>
  return (
    <>
      <p className="muted flat">{t('chooseSessionHint', { panel: t(`later_${panel}`) })}</p>
      <ul className="list">
        {tabs.map((tab) => (
          <li key={tab.tabId} className="row">
            <button className="row-main" onClick={() => go({ name: panel, tabId: tab.tabId } satisfies Screen)}>
              <span className="row-title plain">{tab.title}</span>
              <span className="row-sub mono-line">{baseName(tab.cwd)}</span>
            </button>
            <Icon name="chevron" className="chevron" />
          </li>
        ))}
      </ul>
    </>
  )
}
