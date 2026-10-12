import { useState } from 'react'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'

// The desktop's backends as the touch app sees them (from DesktopShell): This PC and the paired servers, the one shown,
// where a session waits for you, and adding, renaming or removing a server.
export type BackendChoice = { id: string; name: string; kind: 'local' | 'remote'; waiting: boolean }
export type BackendsCapability = {
  list: BackendChoice[]
  selected: string
  choose(id: string): void
  // Pairs a server from a pasted link (rejects with an error code: invalid_link, unreachable, pair_failed…).
  add(link: string, name: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
}

// A backend's name as shown: "This PC" for the local one, the server's own name otherwise.
const backendName = (backend: BackendChoice) => (backend.kind === 'local' ? t('thisComputer') : backend.name)

// Error codes of add → their message.
const ADD_ERRORS: Record<string, Parameters<typeof t>[0]> = {
  invalid_link: 'addServerInvalid',
  unreachable: 'pairUnreachable',
  pair_failed: 'pairFailed',
  no_encryption: 'addServerNoEncryption'
}

// On top of the Home (desktop): the backend shown as a drop-down — its name and a chevron, a dot when a session waits
// on another one. It opens BackendMenu. Each backend keeps its own screens.
export function BackendSwitch() {
  const { capabilities, openSheet } = useTouch()
  const backends = capabilities.backends
  if (!backends) return null
  const shown = backends.list.find((backend) => backend.id === backends.selected) ?? backends.list[0]!
  const waitingElsewhere = backends.list.some((backend) => backend.waiting && backend.id !== backends.selected)
  return (
    <div className="backend-switch">
      <button className="backend-picker" aria-haspopup="dialog" aria-label={t('backendPickerLabel', { name: backendName(shown) })} onClick={() => openSheet({ title: t('backendsLabel'), body: <BackendMenu /> })}>
        <span className="backend-name">{backendName(shown)}</span>
        {waitingElsewhere && <span className="switch-dot" role="img" aria-label={t('badgeWaiting')} />}
        <Icon name="chevron" className="chevron down" />
      </button>
    </div>
  )
}

// The drop-down's menu: every backend (a tick on the shown one, a dot where a session waits; a tap shows it), then
// "Server…" to add, rename or remove one.
function BackendMenu() {
  const { capabilities, openSheet, closeSheet } = useTouch()
  const backends = capabilities.backends!
  return (
    <>
      <ul className="menu" role="radiogroup" aria-label={t('backendsLabel')}>
        {backends.list.map((backend) => (
          <li key={backend.id}>
            <button role="radio" aria-checked={backend.id === backends.selected} onClick={() => (closeSheet(), backends.choose(backend.id))}>
              {backendName(backend)}
              {backend.waiting && backend.id !== backends.selected && <span className="switch-dot" role="img" aria-label={t('badgeWaiting')} />}
            </button>
          </li>
        ))}
      </ul>
      <ul className="menu">
        <li>
          <button onClick={() => (closeSheet(), openSheet({ title: t('serversTitle'), field: true, body: <ServersSheet /> }))}>
            <Icon name="more" />
            {t('manageServers')}
          </button>
        </li>
      </ul>
    </>
  )
}

// A server's new name (1-60 characters): Save or Enter keeps it and closes the sheet.
function RenameServerSheet({ server }: { server: BackendChoice }) {
  const { capabilities, closeSheet, toast, fail } = useTouch()
  const [name, setName] = useState(server.name)
  const save = () => {
    const value = name.trim()
    if (!value) return
    capabilities.backends!.rename(server.id, value).then(() => (closeSheet(), toast(t('renamed'))), fail)
  }
  return (
    <>
      <input className="field" aria-label={t('newName')} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && save()} />
      <button className="button primary block" disabled={!name.trim()} onClick={save}>
        {t('save')}
      </button>
    </>
  )
}

// The paired servers (a tap renames one; remove, asked first) and a new one from a pairing link (`claude-wrap pair`
// on the server, or Settings → Add device on another device).
function ServersSheet() {
  const { capabilities, closeSheet, openSheet, toast } = useTouch()
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
              <button className="row-main" aria-label={t('renameServer', { name: server.name })} onClick={() => openSheet({ title: t('rename'), field: true, body: <RenameServerSheet server={server} /> })}>
                <span className="row-title">{server.name}</span>
              </button>
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
