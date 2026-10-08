import { useEffect, useState, useSyncExternalStore } from 'react'
import { EFFORT_LEVELS, revokeCascade, type Device, type Effort, type PermissionMode } from '@athome/protocol'
import { t } from '../i18n.ts'
import { modeLabel } from '../modes.ts'
import { useAvailableUpdate } from '../appUpdate.ts'
import { activePaletteId, subscribeActivePalette } from '../palette.ts'
import { AccountsGroup } from './accounts.tsx'
import { useTouch, type LaterKey, type Touch } from './context.tsx'
import { Icon } from './icons.tsx'
import { SessionPickSheet } from './inspect.tsx'
import { tokenLabel } from './model.ts'
import { ModeMenu, effortLabel } from './modelSheets.tsx'
import { IconButton, Title } from './parts.tsx'
import { when } from './sessions.tsx'

// Web Push of the host (the PWA's service worker): permission state, subscribe with the server's key, unsubscribe.
export type PushCapability = {
  permission(): NotificationPermission | 'unsupported'
  // Must run from a tap: iOS asks the permission only after a user gesture.
  subscribe(publicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }>
  unsubscribe(): Promise<void>
}

// The settings pages of Claude Code to come (🔜), in the prototype's order.
const CONFIG_LATER: LaterKey[] = ['memory', 'skills', 'agents', 'styles', 'plugins']

// Subscribes this device to the server's push notifications (from a tap: iOS asks the permission then).
async function subscribePush(connection: Touch['connection'], push: PushCapability): Promise<void> {
  const { publicKey } = await connection.request('push.config', {})
  await connection.request('push.subscribe', await push.subscribe(publicKey))
}

// Just paired: notifications when Claude asks something or finishes a job? (Shown once, at the first start.)
export function EnablePushSheet() {
  const { connection, capabilities, closeSheets, toast, fail } = useTouch()
  const enable = () =>
    subscribePush(connection, capabilities.push!).then(() => {
      closeSheets()
      toast(t('pushOn'))
    }, fail)
  return (
    <>
      <p className="muted flat">{t('pairedPushHint')}</p>
      <button className="button primary block" onClick={() => void enable()}>
        {t('enablePush')}
      </button>
      <button className="button block" onClick={closeSheets}>
        {t('notNow')}
      </button>
    </>
  )
}

// Settings: the app (version, reload, palette), Claude accounts, notifications, paired devices, the server, the pages to come, unpair.
export function SettingsScreen() {
  const { state, capabilities, back, go, openSheet } = useTouch()
  const welcome = state.welcome
  const root = state.home.kind === 'root' ? state.home.path : undefined
  return (
    <section className="screen" aria-label={t('settings')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('settings')} />
      </header>
      <div className="scroll">
        <div className="pad settings">
          <AppGroup />
          <AccountsGroup />
          <NewSessionsGroup />
          <AutoCompactGroup />
          {capabilities.push && <NotificationsGroup />}
          <DevicesGroup />
          <div className="group">
            <p className="label">{t('serverTitle')}</p>
            <div className="card compact">
              <span className="mono-line">{location.host}</span>
              <span className="muted mono-line">{t('versions', { core: welcome.coreVersion, sdk: welcome.sdkVersion, cli: welcome.cliVersion })}</span>
              <span className="muted">{state.status === 'connected' ? (root ? t('connectedFoldersIn', { path: root }) : t('serverConnected')) : t('serverConnecting')}</span>
            </div>
          </div>
          <div className="group">
            <p className="label">{t('claudeCode')}</p>
            <ul className="list">
              <li className="row">
                <button className="row-main" onClick={() => go({ name: 'claudeSettings' })}>
                  <span className="row-title plain">{t('later_config')}</span>
                </button>
                <Icon name="chevron" className="chevron" />
              </li>
              {(['mcp', 'hooks', 'permissions'] as const).map((panel) => (
                <li key={panel} className="row">
                  <button className="row-main" onClick={() => openSheet({ title: t('chooseSession'), body: <SessionPickSheet panel={panel} /> })}>
                    <span className="row-title plain">{t(`later_${panel}`)}</span>
                  </button>
                  <Icon name="chevron" className="chevron" />
                </li>
              ))}
              {CONFIG_LATER.map((key) => (
                <li key={key} className="row">
                  <button className="row-main" onClick={() => go({ name: 'later', key })}>
                    <span className="row-title plain">{t(`later_${key}`)}</span>
                  </button>
                  <span className="chip">{t('laterShort')}</span>
                  <Icon name="chevron" className="chevron" />
                </li>
              ))}
            </ul>
          </div>
          {capabilities.logout && (
            <button className="button danger block" onClick={() => openSheet({ title: t('unpairTitle'), body: <UnpairSheet /> })}>
              {t('unpair')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

// The installed app (its version, the newer one on the server: Aggiorna; a plain reload) and the colour palette on
// this device.
function AppGroup() {
  const { state, capabilities, go } = useTouch()
  const activeId = useSyncExternalStore(subscribeActivePalette, activePaletteId)
  const palette = state.palettes.find((one) => one.paletteId === activeId)?.name
  const app = capabilities.app
  const update = useAvailableUpdate(app)
  return (
    <div className="group">
      <p className="label">{t('appTitle')}</p>
      <ul className="list">
        {app && (
          <>
            <li className="row end-pad">
              <div className="row-main">
                <span className="row-title">{t('appVersion')}</span>
                <span className="row-sub">{`${app.version} · ${update ? t('updateReady', { version: update }) : t('upToDate')}`}</span>
              </div>
              {update && (
                <button className="button" onClick={() => app.reload()}>
                  {t('update')}
                </button>
              )}
            </li>
            <li className="row end-pad">
              <div className="row-main">
                <span className="row-title">{t('reloadApp')}</span>
              </div>
              <button className="button" onClick={() => app.reload()}>
                {t('reload')}
              </button>
            </li>
          </>
        )}
        <li className="row">
          <button className="row-main" onClick={() => go({ name: 'palettes' })}>
            <span className="row-title">{t('palettesRow')}</span>
            {palette && <span className="row-sub">{palette}</span>}
          </button>
          <Icon name="chevron" className="chevron" />
        </li>
      </ul>
    </div>
  )
}

// Settings → Nuove sessioni: the effort (the model's own, or a level) and the permission mode the sessions started
// from now on take; open ones keep theirs.
function NewSessionsGroup() {
  const { state, connection, openSheet, toast, fail } = useTouch()
  const mode = state.defaultMode ?? 'default'
  const pickEffort = (effort: Effort | undefined) =>
    connection.request('settings.setDefaultEffort', effort ? { effort } : {}).then(() => toast(t('defaultEffortSet', { effort: effort ? effortLabel(effort) : t('defaultEffortModel') })), fail)
  return (
    <div className="group">
      <p className="label">{t('newSessionsTitle')}</p>
      <ul className="list">
        <li className="row stacked">
          <span className="row-title" id="default-effort-label">
            {t('effort')}
          </span>
          <div className="segmented effort" role="radiogroup" aria-labelledby="default-effort-label">
            {[undefined, ...EFFORT_LEVELS].map((effort) => (
              <label key={effort ?? 'model'}>
                <input type="radio" name="default-effort" checked={state.defaultEffort === effort} onChange={() => void pickEffort(effort)} />
                <span>{effort ? effortLabel(effort) : t('defaultEffortModel')}</span>
              </label>
            ))}
          </div>
          <span className="row-sub wrap">{t('newSessionsHint')}</span>
        </li>
        <li className="row">
          <button className="row-main" onClick={() => openSheet({ title: t('modeTitle'), body: <DefaultModeSheet /> })}>
            <span className="row-title">{t('modeTitle')}</span>
            <span className="row-sub">{t(modeLabel(mode))}</span>
          </button>
          <Icon name="chevron" className="chevron" />
        </li>
      </ul>
    </div>
  )
}

// The permission mode of new sessions; picking one closes the sheet.
function DefaultModeSheet() {
  const { state, connection, closeSheet, toast, fail } = useTouch()
  const pick = (mode: PermissionMode) => {
    closeSheet()
    connection.request('settings.setDefaultMode', mode === 'default' ? {} : { mode }).then(() => toast(t('defaultModeSet', { mode: t(modeLabel(mode)) })), fail)
  }
  return <ModeMenu current={state.defaultMode ?? 'default'} onPick={pick} />
}

// Choices of the auto-compact window (tokens; undefined = Claude Code's own setting).
const AUTO_COMPACT_CHOICES = [undefined, 100_000, 200_000, 500_000, 1_000_000] as const

// Settings → Compattazione automatica: Claude Code's own auto-compact window (as /autocompact) for every session —
// "Come Claude Code" leaves its own setting; a size makes it compact once the conversation reaches it (never beyond
// the model's window).
function AutoCompactGroup() {
  const { state, connection, toast, fail } = useTouch()
  const pick = (tokens: number | undefined) =>
    connection.request('settings.setAutoCompactWindow', tokens ? { tokens } : {}).then(() => toast(tokens ? t('autoCompactSet', { tokens: tokenLabel(tokens) }) : t('autoCompactCli')), fail)
  return (
    <div className="group">
      <p className="label">{t('autoCompactTitle')}</p>
      <ul className="list">
        <li className="row stacked">
          <span className="row-title" id="autocompact-label">
            {t('autoCompactWindow')}
          </span>
          <div className="segmented cols-5" role="radiogroup" aria-labelledby="autocompact-label">
            {AUTO_COMPACT_CHOICES.map((tokens) => (
              <label key={tokens ?? 'cli'}>
                <input type="radio" name="autocompact" checked={state.autoCompactWindow === tokens} onChange={() => void pick(tokens)} />
                <span>{tokens ? tokenLabel(tokens) : t('autoCompactAuto')}</span>
              </label>
            ))}
          </div>
          <span className="row-sub wrap">{t('autoCompactHint')}</span>
        </li>
      </ul>
    </div>
  )
}

// Push notifications of this device: on/off, with the system's permission state.
function NotificationsGroup() {
  const { connection, capabilities, fail } = useTouch()
  const push = capabilities.push!
  const [subscribed, setSubscribed] = useState<boolean>()
  const permission = push.permission()
  useEffect(() => void connection.request('push.config', {}).then(({ subscribed: on }) => setSubscribed(on), fail), [connection])
  const toggle = async (on: boolean) => {
    if (on) await subscribePush(connection, push)
    else {
      await push.unsubscribe()
      await connection.request('push.unsubscribe', {})
    }
    setSubscribed(on)
  }
  const words = permission === 'unsupported' ? t('pushUnsupported') : permission === 'denied' ? t('pushDenied') : subscribed ? t('pushOn') : t('pushOff')
  return (
    <div className="group">
      <p className="label">{t('notificationsTitle')}</p>
      <div className="list">
        <label className="row" htmlFor="push-toggle">
          <span className="row-main">
            <span className="row-title">{t('pushTitle')}</span>
            <span className="row-sub">{words}</span>
          </span>
          <input type="checkbox" id="push-toggle" className="toggle-input" checked={Boolean(subscribed)} disabled={permission === 'unsupported' || permission === 'denied' || subscribed === undefined} onChange={(event) => void toggle(event.target.checked).catch(fail)} />
        </label>
      </div>
    </div>
  )
}

// Paired devices (the remote server only: other backends have none): last access, revoke, add one with a code.
function DevicesGroup() {
  const { connection, openSheet } = useTouch()
  const [devices, setDevices] = useState<Device[]>()
  const load = () => connection.request('devices.list', {}).then(({ devices: list }) => setDevices(list), () => setDevices(undefined))
  useEffect(() => void load(), [connection])
  if (!devices) return null
  return (
    <div className="group">
      <p className="label">{t('devicesTitle')}</p>
      <ul className="list">
        {devices.map((device) => (
          <li key={device.deviceId} className="row end-pad">
            <div className="row-main">
              <span className="row-title">
                {device.name} {device.current && <span className="chip">{t('thisDevice')}</span>}
              </span>
              <span className="row-sub">{t('lastSeen', { when: device.lastSeenAt ? when(device.lastSeenAt) : '—' })}</span>
            </div>
            {!device.current && (
              <button className="button danger" onClick={() => openSheet({ title: t('revokeTitle', { name: device.name }), body: <RevokeSheet device={device} devices={devices} onDone={load} /> })}>
                {t('revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button className="button block" onClick={() => openSheet({ title: t('addDevice'), field: true, body: <AddDeviceSheet onDone={load} /> })}>
        <Icon name="plus" />
        {t('addDevice')}
      </button>
    </div>
  )
}

// Confirms revoking a device; lists the other devices that go with it (never this one, nor what it created).
function RevokeSheet({ device, devices, onDone }: { device: Device; devices: Device[]; onDone: () => void }) {
  const { connection, closeSheet, closeSheets, toast, fail } = useTouch()
  const requester = devices.find((candidate) => candidate.current)?.deviceId
  const cascade = revokeCascade(devices, device.deviceId, requester)
  const also = devices.filter((candidate) => cascade.has(candidate.deviceId) && candidate.deviceId !== device.deviceId).map((candidate) => candidate.name)
  const revoke = () =>
    connection.request('devices.revoke', { deviceId: device.deviceId }).then(() => {
      closeSheets()
      onDone()
      toast(t('revoked'))
    }, fail)
  return (
    <>
      <p className="flat">{t('revokeHint')}</p>
      {also.length > 0 && <p className="flat">{t('revokeAlso', { names: also.join(', ') })}</p>}
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={() => void revoke()}>
          {t('revoke')}
        </button>
      </div>
    </>
  )
}

// A new device: its name, then the one-time code and the link to open on it.
function AddDeviceSheet({ onDone }: { onDone: () => void }) {
  const { connection, capabilities, closeSheets, toast, fail } = useTouch()
  const [name, setName] = useState('')
  const [code, setCode] = useState<{ code: string; expiresAt: number }>()
  const links = code && capabilities.pairLinks?.(code.code)
  const start = () => connection.request('devices.pairStart', { name: name.trim() }).then(setCode, fail)
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast(t('linkCopied')), () => toast(t('copyFailed')))
  if (code)
    return (
      <>
        <p className="muted flat">{t('pairCodeHint', { until: new Date(code.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
        <div className="code-box">{code.code}</div>
        {links ? (
          <>
            <button className="button block" onClick={() => void copy(links.browser)}>
              {t('copyBrowserLink')}
            </button>
            <button className="button block" onClick={() => void copy(links.app)}>
              {t('copyAppLink')}
            </button>
          </>
        ) : (
          <button className="button block" onClick={() => void copy(code.code)}>
            {t('copyLink')}
          </button>
        )}
        <button className="button block" onClick={() => (closeSheets(), onDone())}>
          {t('done')}
        </button>
      </>
    )
  return (
    <>
      <label className="label" htmlFor="device-name">
        {t('deviceName')}
      </label>
      <input className="field" id="device-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && name.trim() && void start()} />
      <button className="button primary block" disabled={!name.trim()} onClick={() => void start()}>
        {t('createCode')}
      </button>
    </>
  )
}

function UnpairSheet() {
  const { capabilities, closeSheet } = useTouch()
  return (
    <>
      <p className="flat">{t('unpairHint')}</p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={() => capabilities.logout?.()}>
          {t('unpairShort')}
        </button>
      </div>
    </>
  )
}
