import { useCallback, useEffect, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { Device, Welcome } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { Icon } from './Icon.tsx'
import { Sheet } from './Sheet.tsx'

// Web Push of the host (the PWA's service worker): permission state, subscribe with the server's key, unsubscribe.
export type PushCapability = {
  permission(): NotificationPermission | 'unsupported'
  // Must run from a tap: iOS asks the permission only after a user gesture.
  subscribe(publicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }>
  unsubscribe(): Promise<void>
}

type SettingsScreenProps = {
  connection: Connection
  welcome: Welcome
  push?: PushCapability
  // Link that pairs a new device with a one-time code.
  pairLink: (code: string) => string
  onLogout?: () => void
  onBack: () => void
}

const time = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '—')

// Paired devices: list, add (one-time code and link), revoke with a confirmation step.
function Devices({ connection, pairLink, onError }: { connection: Connection; pairLink: (code: string) => string; onError: (failure: unknown) => void }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [confirming, setConfirming] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState<{ code: string; expiresAt: number }>()
  const load = useCallback(() => connection.request('devices.list', {}).then(({ devices: list }) => setDevices(list), onError), [connection, onError])
  useEffect(() => void load(), [load])
  const revoke = (deviceId: string) => {
    setConfirming(undefined)
    connection.request('devices.revoke', { deviceId }).then(load, onError)
  }
  const start = () => connection.request('devices.pairStart', { name: name.trim() }).then(setCode, onError)
  const closeAdd = () => (setAdding(false), setCode(undefined), setName(''))
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined)

  return (
    <section className="settings-section" aria-label={t('devicesTitle')}>
      <h2 className="label">{t('devicesTitle')}</h2>
      <ul className="m-list">
        {devices.map((device) => (
          <li key={device.deviceId} className="m-row">
            <div className="m-row-main">
              <span className="m-row-title">
                {device.name} {device.current && <span className="chip">{t('thisDevice')}</span>}
              </span>
              <span className="m-row-sub">{t('lastSeen', { when: time(device.lastSeenAt) })}</span>
            </div>
            {!device.current &&
              (confirming === device.deviceId ? (
                <button className="button danger" onClick={() => revoke(device.deviceId)}>{t('confirmRevoke')}</button>
              ) : (
                <button className="button danger" onClick={() => setConfirming(device.deviceId)}>{t('revoke')}</button>
              ))}
          </li>
        ))}
      </ul>
      {confirming && <p className="muted">{t('revokeHint')}</p>}
      <button className="button" onClick={() => setAdding(true)}>
        <Icon name="plus" />
        {t('addDevice')}
      </button>
      {adding && (
        <Sheet label={t('addDevice')} onClose={closeAdd}>
          {code ? (
            <>
              <p className="muted">{t('pairCodeHint', { until: new Date(code.expiresAt).toLocaleTimeString() })}</p>
              <p className="pair-code">{code.code}</p>
              <p className="pair-link">{pairLink(code.code)}</p>
              <button className="button" onClick={() => copy(pairLink(code.code))}>{t('copyLink')}</button>
              <button className="button primary" onClick={closeAdd}>{t('done')}</button>
            </>
          ) : (
            <>
              <input className="field" id="device-name" aria-label={t('deviceName')} placeholder={t('deviceName')} value={name} onChange={(event) => setName(event.target.value)} />
              <button className="button primary" disabled={!name.trim()} onClick={() => void start()}>{t('createCode')}</button>
            </>
          )}
        </Sheet>
      )}
    </section>
  )
}

// Push notifications of this device: on/off, with the system permission state.
function Notifications({ connection, push, onError }: { connection: Connection; push?: PushCapability; onError: (failure: unknown) => void }) {
  const [subscribed, setSubscribed] = useState<boolean>()
  const permission = push?.permission() ?? 'unsupported'
  useEffect(() => void connection.request('push.config', {}).then(({ subscribed: on }) => setSubscribed(on), onError), [connection, onError])
  const toggle = async (on: boolean) => {
    if (!push) return
    if (on) {
      const { publicKey } = await connection.request('push.config', {})
      await connection.request('push.subscribe', await push.subscribe(publicKey))
    } else {
      await push.unsubscribe()
      await connection.request('push.unsubscribe', {})
    }
    setSubscribed(on)
  }
  const state = permission === 'unsupported' ? t('pushUnsupported') : permission === 'denied' ? t('pushDenied') : subscribed ? t('pushOn') : t('pushOff')
  return (
    <section className="settings-section" aria-label={t('notificationsTitle')}>
      <h2 className="label">{t('notificationsTitle')}</h2>
      <label className="m-row toggle-row" htmlFor="push-toggle">
        <span className="m-row-main">
          <span className="m-row-title">{t('pushTitle')}</span>
          <span className="m-row-sub">{state}</span>
        </span>
        <input type="checkbox" id="push-toggle" className="toggle" checked={Boolean(subscribed)} disabled={permission === 'unsupported' || permission === 'denied' || subscribed === undefined} onChange={(event) => void toggle(event.target.checked).catch(onError)} />
      </label>
      <p className="muted">{t('pushHint')}</p>
    </section>
  )
}

// Settings of the phone: devices, notifications, server, unpair this device.
export function SettingsScreen({ connection, welcome, push, pairLink, onLogout, onBack }: SettingsScreenProps) {
  const [error, setError] = useState<string>()
  const onError = useCallback((failure: unknown) => setError(t('actionFailed', { message: failure instanceof Error ? failure.message : String(failure) })), [])
  const [leaving, setLeaving] = useState(false)
  return (
    <div className="page">
      <header className="m-topbar">
        <button className="icon-button" aria-label={t('back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1 className="m-title">{t('settings')}</h1>
      </header>
      <div className="m-scroll">
        <Devices connection={connection} pairLink={pairLink} onError={onError} />
        <Notifications connection={connection} push={push} onError={onError} />
        <section className="settings-section" aria-label={t('serverTitle')}>
          <h2 className="label">{t('serverTitle')}</h2>
          <p className="version-line">{t('versions', { core: welcome.coreVersion, sdk: welcome.sdkVersion, cli: welcome.cliVersion })}</p>
        </section>
        {error && <p className="item notice error" role="alert">{error}</p>}
        {onLogout && (leaving ? (
          <button className="button danger" onClick={onLogout}>{t('confirmUnpair')}</button>
        ) : (
          <button className="button danger" onClick={() => setLeaving(true)}>{t('unpair')}</button>
        ))}
      </div>
    </div>
  )
}
