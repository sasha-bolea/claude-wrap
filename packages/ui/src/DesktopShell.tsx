import { useEffect, useRef, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import { App, type Capabilities } from './App.tsx'
import { t } from './i18n.ts'
import { badgeOf } from './TabBar.tsx'

// One backend of the desktop: the local core or a paired server, each with its own connection and host abilities.
export type BackendEntry = { id: string; name: string; kind: 'local' | 'remote'; connection: Connection; capabilities: Capabilities }

type DesktopShellProps = {
  backends: BackendEntry[]
  // Pairs a server from a pasted link (rejects with an error code: invalid_link, unreachable, pair_failed…).
  onAdd: (link: string, name: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  // A notification was clicked: show that backend and tab. Returns the unsubscribe function.
  onActivate?: (listener: (tabId: string, backendId: string) => void) => () => void
}

const SELECTED_KEY = 'claude-wrap:backend'
const ADD_ERRORS: Record<string, Parameters<typeof t>[0]> = {
  invalid_link: 'addServerInvalid',
  unreachable: 'pairUnreachable',
  pair_failed: 'pairFailed',
  no_encryption: 'addServerNoEncryption'
}

function readSelected(): string | undefined {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? undefined
  } catch {
    return undefined
  }
}

// Backends with a tab waiting for an answer (dot on the switcher). Follows every connection's store.
function useWaiting(backends: BackendEntry[]): Set<string> {
  const [waiting, setWaiting] = useState(new Set<string>())
  useEffect(() => {
    const compute = () =>
      setWaiting(new Set(backends.filter((backend) => backend.connection.store.getSnapshot().tabs?.some((tab) => badgeOf(tab) === 'waiting')).map((backend) => backend.id)))
    compute()
    const stops = backends.map((backend) => backend.connection.store.subscribe(compute))
    return () => stops.forEach((stop) => stop())
  }, [backends])
  return waiting
}

// Adding and removing servers: paste a pairing link (from `claude-wrap pair` or another device's Add device).
function ManageServers({ backends, onAdd, onRemove, onClose }: { backends: BackendEntry[]; onAdd: DesktopShellProps['onAdd']; onRemove: DesktopShellProps['onRemove']; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string>()
  const add = () => {
    setBusy(true)
    setError(undefined)
    onAdd(link, name).then(
      () => (setLink(''), setName('')),
      (failure: unknown) => setError(t(ADD_ERRORS[failure instanceof Error ? failure.message.replace(/^.*Error: /, '') : ''] ?? 'pairFailed'))
    ).finally(() => setBusy(false))
  }
  return (
    <section className="request-panel servers-panel" aria-label={t('serversTitle')}>
      <h3>{t('serversTitle')}</h3>
      <ul className="session-list">
        {backends.filter((backend) => backend.kind === 'remote').map((backend) => (
          <li key={backend.id} className="actions">
            <span>{backend.name}</span>
            {confirming === backend.id ? (
              <button className="button danger" onClick={() => void onRemove(backend.id)}>{t('confirmRemoveServer')}</button>
            ) : (
              <button className="button danger" onClick={() => setConfirming(backend.id)}>{t('removeServer')}</button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted">{t('addServerHint')}</p>
      <input className="field" id="server-link" aria-label={t('pairField')} placeholder="https://server…:8443/#pair=…" value={link} onChange={(event) => setLink(event.target.value)} />
      <input className="field" id="server-name" aria-label={t('serverName')} placeholder={t('serverName')} value={name} onChange={(event) => setName(event.target.value)} />
      {error && <p className="item notice error" role="alert">{error}</p>}
      <div className="actions">
        <button className="button primary" disabled={busy || !link.trim()} onClick={add}>{t('addServer')}</button>
        <button className="button" onClick={onClose}>{t('close')}</button>
      </div>
    </section>
  )
}

// The desktop with several backends: a thin switcher above the tabs (This PC, the servers, a dot where something
// waits) and the shown backend's app. Every connection stays open, so hidden backends still notify and badge.
export function DesktopShell({ backends, onAdd, onRemove, onActivate }: DesktopShellProps) {
  const [selected, setSelected] = useState(() => readSelected() ?? 'local')
  const [managing, setManaging] = useState(false)
  const waiting = useWaiting(backends)
  // Notification taps for a backend whose app is not mounted yet wait here until it registers.
  const listeners = useRef(new Map<string, (tabId: string) => void>())
  const pending = useRef<{ backendId: string; tabId: string } | undefined>(undefined)
  const shown = backends.find((backend) => backend.id === selected) ?? backends[0]!

  const choose = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(SELECTED_KEY, id)
    } catch {
      // the choice is a convenience
    }
  }
  useEffect(() => backends.forEach((backend) => backend.connection.start()), [backends])
  useEffect(
    () =>
      onActivate?.((tabId, backendId) => {
        choose(backendId)
        const listener = listeners.current.get(backendId)
        if (listener) listener(tabId)
        else pending.current = { backendId, tabId }
      }),
    [onActivate]
  )
  const capabilities: Capabilities = {
    ...shown.capabilities,
    onActivateTab: (listener) => {
      listeners.current.set(shown.id, listener)
      if (pending.current?.backendId === shown.id) listener(pending.current.tabId)
      pending.current = undefined
      return () => void listeners.current.delete(shown.id)
    }
  }

  return (
    <div className="shell">
      <nav className="backend-bar" aria-label={t('backendsLabel')}>
        {backends.map((backend) => (
          <button key={backend.id} className="backend" aria-pressed={backend.id === shown.id} onClick={() => choose(backend.id)}>
            {backend.kind === 'local' ? t('thisComputer') : backend.name}
            {waiting.has(backend.id) && backend.id !== shown.id && <span className="badge waiting" role="img" aria-label={t('badgeWaiting')} />}
          </button>
        ))}
        <button className="backend add" aria-expanded={managing} onClick={() => setManaging(!managing)}>
          {t('manageServers')}
        </button>
      </nav>
      {managing && (
        <ManageServers
          backends={backends}
          onAdd={(link, name) => onAdd(link, name).then(() => setManaging(false))}
          onRemove={(id) => onRemove(id).then(() => void (id === shown.id && choose('local')))}
          onClose={() => setManaging(false)}
        />
      )}
      <App key={shown.id} connection={shown.connection} capabilities={capabilities} />
    </div>
  )
}
