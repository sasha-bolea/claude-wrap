import { createRoot } from 'react-dom/client'
import { Connection, openWebSocket } from '@claude-wrap/client'
import { App, PairScreen, t, type AppCapability, type PushCapability } from '@claude-wrap/ui'
import '@claude-wrap/ui/touch.css'

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

// Session to open, from a notification tap (cold start: #tab-<id>; app open: a message from the service worker).
let pendingTab = /^#tab-(.+)$/.exec(location.hash)?.[1]
const tabListeners = new Set<(tabId: string) => void>()
navigator.serviceWorker?.register('/sw.js').catch(() => undefined)
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<{ type?: string; tabId?: string }>) => {
  if (event.data?.type === 'open-tab' && event.data.tabId) tabListeners.forEach((listener) => listener(event.data.tabId!))
})

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
  root.render(<PairScreen installed={standalone || !isIos} initialCode={code} notice={notice} onPair={pair} />)
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
    pairLink: (code: string) => `${location.origin}/#pair=${code}`,
    logout: () => logout(),
    onActivateTab: (listener: (tabId: string) => void) => {
      tabListeners.add(listener)
      if (pendingTab) listener(pendingTab)
      pendingTab = undefined
      return () => void tabListeners.delete(listener)
    }
  }
  root.render(<App connection={connection} capabilities={capabilities} />)
}

const token = read(TOKEN_KEY)
if (token) start(token)
else showPairing()
