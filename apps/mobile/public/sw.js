// Service worker of the PWA: shows Web Push notifications and opens their session when tapped.
// The push payload carries only {kind, title, tabId} (push services see it); the words come from here.
// No offline cache: the app is useless without the server, and a stale shell would only mislead.

const TEXT = {
  en: { request: 'Claude is waiting for your answer', turnFinished: 'Claude finished', error: 'Claude stopped with an error' },
  it: { request: 'Claude aspetta una tua risposta', turnFinished: 'Claude ha finito', error: 'Claude si è fermato con un errore' }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// One notification per session (same tag): a newer event replaces the older one.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const language = (self.navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en'
  event.waitUntil(
    self.registration.showNotification(data.title || 'claude-wrap', {
      body: TEXT[language][data.kind] || '',
      tag: data.tabId || 'claude-wrap',
      icon: '/icon-192.png',
      data: { tabId: data.tabId }
    })
  )
})

// Tap: focus the open app and tell it which session to show, or open the app on that session.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const tabId = event.notification.data && event.notification.data.tabId
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.length) {
        windows[0].postMessage({ type: 'open-tab', tabId })
        return windows[0].focus()
      }
      return self.clients.openWindow(tabId ? `/#tab-${tabId}` : '/')
    })()
  )
})
