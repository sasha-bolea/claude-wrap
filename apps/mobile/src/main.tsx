import { createRoot } from 'react-dom/client'
import { Connection, openWebSocket } from '@athome/client'
import type { Palette } from '@athome/protocol'
import { App, PairScreen, SetupScreen, addressWithPalette, applyPalette, paletteFromAddress, pointIcons, setActivePalette, t, type AppCapability, type PushCapability } from '@athome/ui'
import '@athome/ui/touch.css'

// The PWA host: pairing (one-time code → device token), the WebSocket connection to the server it was loaded
// from, page visibility (push goes only to devices that are not looking), Web Push through the service worker,
// notification taps that open a session, no zoom, and newer builds of the app on the server.

const TOKEN_KEY = 'claude-wrap:token'
const CLIENT_KEY = 'claude-wrap:clientId'

// Storage may be unavailable (private mode): the app then pairs again next time.
function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
function write(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // nothing to do: see read()
  }
}

// Stable id of this install (core recognises retried commands by it).
function clientId(): string {
  const stored = read(CLIENT_KEY)
  if (stored) return stored
  const created = crypto.randomUUID()
  write(CLIENT_KEY, created)
  return created
}

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const root = createRoot(document.getElementById('root')!)

// What a notification tap opens: a session (cold start: #tab-<id>), or the open sessions when it was about several
// chats (cold start: #sessions); with the app open, a message from the service worker.
let pendingTab = /^#tab-(.+)$/.exec(location.hash)?.[1]
let pendingSessions = location.hash === '#sessions'
const tabListeners = new Set<(tabId: string) => void>()
const sessionsListeners = new Set<() => void>()
navigator.serviceWorker?.register('/sw.js').catch(() => undefined)
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<{ type?: string; tabId?: string }>) => {
  if (event.data?.type !== 'open-tab') return
  if (event.data.tabId) tabListeners.forEach((listener) => listener(event.data.tabId!))
  else sessionsListeners.forEach((listener) => listener())
})

// The app on screen: the notification has been seen, it goes away.
async function clearNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration()
  for (const notification of (await registration?.getNotifications()) ?? []) notification.close()
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void clearNotifications().catch(() => undefined))
void clearNotifications().catch(() => undefined)

// iOS ignores the viewport's maximum-scale when pinching: its gesture events are cancelled instead.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (event) => event.preventDefault(), { passive: false })

// A newer build on the server (an update restarts the server): /version.json is compared with this build at every
// connection, back on screen and every 15 minutes; the UI offers it (update bar, Settings).
const VERSION_CHECK_MS = 15 * 60_000
const updateListeners = new Set<(version: string) => void>()
let newerVersion: string | undefined
async function checkVersion(): Promise<void> {
  const response = await fetch('/version.json', { cache: 'no-store' }).catch(() => undefined)
  const latest = (response?.ok ? await response.json().catch(() => ({})) : {}) as { build?: string; version?: string }
  if (!latest.build || latest.build === __APP_BUILD__) return
  newerVersion = latest.version ?? latest.build
  updateListeners.forEach((listener) => listener(newerVersion!))
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkVersion())
setInterval(() => void checkVersion(), VERSION_CHECK_MS)
const app: AppCapability = {
  version: __APP_VERSION__,
  onUpdate: (listener) => {
    updateListeners.add(listener)
    if (newerVersion) listener(newerVersion)
    return () => void updateListeners.delete(listener)
  },
  reload: () => location.reload()
}

// The server's VAPID key as the bytes PushManager wants.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

const push: PushCapability = {
  permission: () => ('Notification' in window && 'PushManager' in window && navigator.serviceWorker ? Notification.permission : 'unsupported'),
  subscribe: async (publicKey) => {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('pushDenied'))
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
    const { endpoint, keys } = subscription.toJSON()
    return { endpoint: endpoint!, keys: { p256dh: keys!.p256dh!, auth: keys!.auth! } }
  },
  unsubscribe: async () => {
    const registration = await navigator.serviceWorker.ready
    await (await registration.pushManager.getSubscription())?.unsubscribe()
  }
}

// Exchanges a pairing code for this device's token at POST /pair. Rejects with a message for the user.
async function pair(code: string): Promise<void> {
  const response = await fetch('/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => undefined)
  if (!response) throw new Error(t('pairUnreachable'))
  if (!response.ok) throw new Error(t('pairFailed'))
  const { token } = (await response.json()) as { token: string }
  write(TOKEN_KEY, token)
  history.replaceState(null, '', '/')
  void navigator.storage?.persist?.()
  start(token, true)
}

function showPairing(notice?: string): void {
  const code = /#pair=([\w-]+)/.exec(location.hash)?.[1]
  const forHomeScreen = new URLSearchParams(location.search).has('accent')
  root.render(<PairScreen installed={standalone || !isIos} initialCode={code} forHomeScreen={forHomeScreen} notice={notice} onPair={pair} />)
}

// Connects with the device token and shows the app; a revoked token leads back to pairing. justPaired: the app
// offers the notifications once.
function start(token: string, justPaired = false): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const visible = () => document.visibilityState === 'visible'
  const connection = new Connection({ openChannel: () => openWebSocket(`${scheme}://${location.host}/ws`), clientId: clientId(), token, visible })
  const logout = (notice?: string) => {
    write(TOKEN_KEY, undefined)
    connection.close()
    void push.unsubscribe().catch(() => undefined)
    showPairing(notice)
  }
  const stop = connection.store.subscribe(() => {
    if (connection.store.getSnapshot().status !== 'unauthorized') return
    stop()
    logout(t('pairRevoked'))
  })
  // Every (re)connection may follow a server update.
  let status = connection.store.getSnapshot().status
  connection.store.subscribe(() => {
    const next = connection.store.getSnapshot().status
    if (next === 'connected' && status !== 'connected') void checkVersion()
    status = next
  })
  // Back on screen or back online: tell core, and reconnect now instead of waiting for the next retry.
  const wake = () => {
    void connection.request('client.visibility', { visible: visible() }).catch(() => undefined)
    if (visible()) connection.reconnectNow()
  }
  document.addEventListener('visibilitychange', wake)
  addEventListener('online', wake)
  const capabilities = {
    layout: 'mobile' as const,
    justPaired,
    push,
    app,
    openExternal: (url: string) => void window.open(url, '_blank', 'noopener'),
    pairLinks: (code: string) => ({ browser: `${location.origin}/?browser=1#pair=${code}`, app: `${location.origin}/?pair=${code}` }),
    iconLink: (accent: string) => `${location.origin}/?accent=${accent.slice(1)}`,
    logout: () => logout(),
    onActivateTab: (listener: (tabId: string) => void) => {
      tabListeners.add(listener)
      if (pendingTab) listener(pendingTab)
      pendingTab = undefined
      return () => void tabListeners.delete(listener)
    },
    onShowSessions: (listener: () => void) => {
      sessionsListeners.add(listener)
      if (pendingSessions) listener()
      pendingSessions = false
      return () => void sessionsListeners.delete(listener)
    }
  }
  root.render(<App connection={connection} capabilities={capabilities} />)
}

// The setup page of the installed app, opened in the browser by the "install the app" link (?pair=code): the palette
// chosen goes into the address, which the manifest turns into the installed app's start address.
function showSetup(code: string): void {
  const carried = paletteFromAddress()
  if (carried) applyPalette(carried.colors)
  const load = async () => {
    const response = await fetch(`/setup/palettes?code=${encodeURIComponent(code)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(t('setupCodeGone'))
    return (await response.json()) as { palettes: Palette[]; expiresAt: number }
  }
  const pick = (palette: Palette) => {
    history.replaceState(null, '', addressWithPalette(code, palette))
    applyPalette(palette.colors)
  }
  root.render(<SetupScreen ios={isIos} initial={carried?.paletteId} load={load} onPick={pick} />)
}

// Pairs with a code from the address at once (the installed app's start address, or the "use it in the browser"
// link); a refused code leads to the pairing screen with the reason.
function pairNow(code: string): void {
  pair(code).catch((error: unknown) => showPairing(error instanceof Error ? error.message : String(error)))
}

// Start: what the address asks for (?pair= in the browser: setup; in the installed app: its first start), else the
// app with the saved token, else pairing ("use it in the browser" links pair at once).
const addressCode = new URLSearchParams(location.search).get('pair') ?? undefined
const token = read(TOKEN_KEY)
if (addressCode && !standalone) showSetup(addressCode)
else if (token) {
  if (addressCode) history.replaceState(null, '', '/')
  pointIcons()
  start(token)
} else if (addressCode) {
  const carried = paletteFromAddress()
  if (carried) setActivePalette(carried)
  pointIcons()
  pairNow(addressCode)
} else {
  // Opened from the link "Icon in this colour": the Home screen icon in its accent, before any pairing.
  pointIcons()
  const hashCode = /#pair=([\w-]+)/.exec(location.hash)?.[1]
  if (hashCode && new URLSearchParams(location.search).has('browser')) pairNow(hashCode)
  else showPairing()
}
