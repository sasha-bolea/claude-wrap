import { useEffect, useState } from 'react'
import type { McpServer } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useScreen, useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { InspectBody, InspectTop, errorText, useInspect, useReloadOnTop, useSessionSub, type Inspect } from './inspect.tsx'

type Status = McpServer['status']

// Colour of a server's status chip: connected plain, waiting for you accent, failed in the danger colour, off muted.
const STATUS_CHIP: Record<Status, string> = { connected: '', pending: ' accent', 'needs-auth': ' accent', failed: ' bad', disabled: '' }
// How often the list is read again while a server is still connecting.
const PENDING_POLL_MS = 2000

// Keeps the list fresh: every 2 s while a server is pending, and when the app comes back to the foreground (after
// signing in in the browser).
function useMcpFreshness(inspect: Inspect<{ servers: McpServer[] }>): void {
  const { top } = useScreen()
  const pending = inspect.data?.servers.some((server) => server.status === 'pending') ?? false
  useEffect(() => {
    if (!top || !pending) return
    const timer = setInterval(inspect.reload, PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [top, pending, inspect.reload])
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && top && inspect.reload()
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [top, inspect.reload])
}

// Opens a page outside the app: the system browser on the desktop, a new tab in the PWA. Only http(s) addresses.
function useOpenPage(): (url: string) => void {
  const { capabilities } = useTouch()
  return (url) => {
    if (!/^https?:\/\//i.test(url)) return
    if (capabilities.openExternal) capabilities.openExternal(url)
    else window.open(url, '_blank', 'noopener')
  }
}

// One server's row: name, status chip, where it comes from and how many tools, the error under it; a tap opens its actions.
function ServerRow({ server, onOpen }: { server: McpServer; onOpen: () => void }) {
  const origin = [server.scope ?? server.source, server.status === 'connected' || server.tools ? t(server.tools === 1 ? 'oneTool' : 'toolsCount', { count: String(server.tools) }) : undefined].filter(Boolean).join(' · ')
  return (
    <li className="row">
      <button className="row-main" onClick={onOpen}>
        <span className="row-title plain">{server.name}</span>
        {origin && <span className="row-sub">{origin}</span>}
        {server.error && <span className="row-sub clamp">{server.error}</span>}
      </button>
      <span className={`chip${STATUS_CHIP[server.status]}`}>{t(`mcpStatus_${server.status}`)}</span>
      <Icon name="chevron" className="chevron" />
    </li>
  )
}

// The session's MCP servers, as /mcp: one row per server with its state; a tap opens Reconnect, Disable or Enable
// and the sign-in. Read again every 2 s while one is connecting.
export function McpScreen({ tabId }: { tabId: string }) {
  const { connection, openSheet } = useTouch()
  const inspect = useInspect(() => connection.request('tab.mcp', { tabId }), [connection, tabId])
  useReloadOnTop(inspect)
  useMcpFreshness(inspect)
  return (
    <section className="screen" aria-label={t('later_mcp')}>
      <InspectTop title={t('later_mcp')} sub={useSessionSub(tabId)} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {(data) =>
          data.servers.length ? (
            <ul className="list">
              {data.servers.map((server) => (
                <ServerRow key={server.name} server={server} onOpen={() => openSheet({ title: server.name, body: <ServerSheet tabId={tabId} server={server} reload={inspect.reload} /> })} />
              ))}
            </ul>
          ) : (
            <p className="empty-line">{t('mcpNone')}</p>
          )
        }
      </InspectBody>
    </section>
  )
}

// Runs one action of a sheet: busy while it runs, its failure kept as text, then reads the list again and `done`.
function useSheetAction(reload: () => void) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<unknown>, done: () => void) => {
    setBusy(true)
    setError(undefined)
    action().then(
      () => {
        reload()
        done()
      },
      (failure: unknown) => setError(errorText(failure))
    ).finally(() => setBusy(false))
  }
  return { error, busy, run }
}

// A server's actions: Reconnect, Disable or Enable (with what it covers), Sign in when it needs it, Sign out for
// servers with an address. A failure stays in the sheet.
function ServerSheet({ tabId, server, reload }: { tabId: string; server: McpServer; reload: () => void }) {
  const { connection, closeSheet, openSheet } = useTouch()
  const { error, busy, run } = useSheetAction(reload)
  const { name } = server
  const enabled = server.status !== 'disabled'
  const signIn = () =>
    run(
      () => connection.request('tab.mcpAuth', { tabId, name }).then((auth) => openSheet({ title: t('mcpSignInTitle', { name }), field: auth.callbackExpected, body: <SignInSheet tabId={tabId} name={name} auth={auth} reload={reload} /> })),
      () => {}
    )
  return (
    <>
      <ul className="menu">
        {enabled && (
          <li>
            <button disabled={busy} onClick={() => run(() => connection.request('tab.mcpReconnect', { tabId, name }), closeSheet)}>
              {t('mcpReconnect')}
            </button>
          </li>
        )}
        {server.status === 'needs-auth' && (
          <li>
            <button disabled={busy} onClick={signIn}>
              {t('mcpSignIn')}
            </button>
          </li>
        )}
        {server.url && enabled && server.status !== 'needs-auth' && (
          <li>
            <button disabled={busy} onClick={() => run(() => connection.request('tab.mcpClearAuth', { tabId, name }), closeSheet)}>
              {t('mcpSignOut')}
            </button>
          </li>
        )}
        <li>
          <button className="two-lines" disabled={busy} onClick={() => run(() => connection.request('tab.mcpToggle', { tabId, name, enabled: !enabled }), closeSheet)}>
            {enabled ? t('mcpDisable') : t('mcpEnable')}
            <span className="row-sub">{t('mcpToggleHint')}</span>
          </button>
        </li>
      </ul>
      {error && (
        <p className="error-text selectable" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

// Signing in from the phone: step 1 opens the sign-in page; step 2 (when core cannot receive the redirect itself)
// takes the address of the page that fails to load afterwards, and sends it to core.
function SignInSheet({ tabId, name, auth, reload }: { tabId: string; name: string; auth: { authUrl: string; callbackExpected: boolean }; reload: () => void }) {
  const { connection, closeSheets } = useTouch()
  const open = useOpenPage()
  const [address, setAddress] = useState('')
  const { error, busy, run } = useSheetAction(reload)
  const send = () => run(() => connection.request('tab.mcpAuthCallback', { tabId, name, url: address.trim() }), closeSheets)
  return (
    <>
      <ol className="steps">
        <li>
          <button className="button block" onClick={() => open(auth.authUrl)}>
            {t('mcpOpenSignIn')}
          </button>
        </li>
        {auth.callbackExpected && (
          <li>
            <p className="muted flat">{t('mcpPasteHint')}</p>
            <input className="field mono" aria-label={t('mcpPasteLabel')} placeholder="http://localhost:…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={address} onChange={(event) => setAddress(event.target.value)} />
            <button className="button primary block" disabled={busy || !address.trim()} onClick={send}>
              {t('send')}
            </button>
          </li>
        )}
      </ol>
      {!auth.callbackExpected && (
        <button className="button block" onClick={() => (reload(), closeSheets())}>
          {t('mcpCheckAgain')}
        </button>
      )}
      {error && (
        <p className="error-text selectable" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
