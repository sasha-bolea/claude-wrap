import { useState } from 'react'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'

// The desktop's backends as the touch app sees them (from DesktopShell): This PC and the paired servers, the one shown,
// where a session waits for you, and adding or removing a server.
export type BackendChoice = { id: string; name: string; kind: 'local' | 'remote'; waiting: boolean }
export type BackendsCapability = {
  list: BackendChoice[]
  selected: string
  choose(id: string): void
  // Pairs a server from a pasted link (rejects with an error code: invalid_link, unreachable, pair_failed…).
  add(link: string, name: string): Promise<void>
  remove(id: string): Promise<void>
}

// Error codes of add → their message.
const ADD_ERRORS: Record<string, Parameters<typeof t>[0]> = {
  invalid_link: 'addServerInvalid',
  unreachable: 'pairUnreachable',
  pair_failed: 'pairFailed',
  no_encryption: 'addServerNoEncryption'
}

// On top of the Home (desktop): This PC | the servers as a segmented switch, a dot where a session waits, and
// "Server…" to add or remove one. Each backend keeps its own screens.
export function BackendSwitch() {
  const { capabilities, openSheet } = useTouch()
  const backends = capabilities.backends
  if (!backends) return null
  return (
    <div className="backend-switch">
      <div className="segmented backend-choices" role="radiogroup" aria-label={t('backendsLabel')}>
        {backends.list.map((backend) => (
          <label key={backend.id}>
            <input type="radio" name="backend" checked={backend.id === backends.selected} onChange={() => backends.choose(backend.id)} />
            <span>
              {backend.kind === 'local' ? t('thisComputer') : backend.name}
              {backend.waiting && backend.id !== backends.selected && <span className="switch-dot" role="img" aria-label={t('badgeWaiting')} />}
            </span>
          </label>
        ))}
      </div>
      <button className="icon-btn" aria-label={t('manageServers')} onClick={() => openSheet({ title: t('serversTitle'), body: <ServersSheet /> })}>
        <Icon name="more" />
      </button>
    </div>
  )
}

// The paired servers (remove, asked first) and a new one from a pairing link (`claude-wrap pair` on the server, or
// Settings → Add device on another device).
function ServersSheet() {
  const { capabilities, closeSheet, toast } = useTouch()
  const backends = capabilities.backends!
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string>()
  const servers = backends.list.filter((backend) => backend.kind === 'remote')
  const add = () => {
    setBusy(true)
    setError(undefined)
    backends
      .add(link.trim(), name.trim())
      .then(
        () => (closeSheet(), toast(t('serverAdded', { name: name.trim() || link.trim() }))),
        (failure: unknown) => setError(t(ADD_ERRORS[failure instanceof Error ? failure.message.replace(/^.*Error: /, '') : ''] ?? 'pairFailed'))
      )
      .finally(() => setBusy(false))
  }
  return (
    <>
      {servers.length > 0 && (
        <ul className="list">
          {servers.map((server) => (
            <li key={server.id} className="row end-pad">
              <span className="row-main">
                <span className="row-title">{server.name}</span>
              </span>
              <button className="button quiet danger" onClick={() => (confirming === server.id ? void backends.remove(server.id) : setConfirming(server.id))}>
                {confirming === server.id ? t('confirmRemoveServer') : t('removeServer')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted flat">{t('addServerHint')}</p>
      <label className="label" htmlFor="server-link">
        {t('pairField')}
      </label>
      <input className="field mono" id="server-link" autoComplete="off" placeholder="https://server…:8443/#pair=…" value={link} onChange={(event) => setLink(event.target.value)} />
      <label className="label" htmlFor="server-name">
        {t('serverName')}
      </label>
      <input className="field" id="server-name" autoComplete="off" placeholder={t('serverName')} value={name} onChange={(event) => setName(event.target.value)} />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button className="button primary block" disabled={busy || !link.trim()} onClick={add}>
        {t('addServer')}
      </button>
    </>
  )
}
