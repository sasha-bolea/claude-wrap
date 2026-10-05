// Service worker of the PWA: shows Web Push as one notification for every chat and opens what it is about when
// tapped. The push payload carries only {kind, title, tabId, waiting, finished} (push services see it); the words
// come from notice.js. No offline cache: the app is useless without the server, and a stale shell would only mislead.

importScripts('/notice.js')
const TAG = 'claude-wrap'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Always one notification: a newer event replaces it with the new counts (the old ones closed, see showOnly).
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const language = (self.navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en'
  const view = self.noticeView(data, language)
  event.waitUntil(
    self.showOnly(self.registration, view.title, { body: view.body, tag: TAG, icon: '/icon-192.png', data: { tabId: view.tabId } })
  )
})

// Tap: focus the open app and tell it which session to show (none: the open sessions), or open the app there.
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
      return self.clients.openWindow(tabId ? `/#tab-${tabId}` : '/#sessions')
    })()
  )
})
