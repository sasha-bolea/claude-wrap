// Words of the phone's single notification and how it is shown, loaded by the service worker (sw.js) and unit-tested (src/notice.test.ts).
// The push payload carries {kind, title, tabId, waiting, finished}: the chats waiting for an answer and the ones
// finished since anyone looked at them. One chat → its title and what happened (a tap opens it); more → the counts.

const NOTICE_TEXT = {
  en: {
    request: 'Claude is waiting for your answer',
    turnFinished: 'Claude finished',
    error: 'Claude stopped with an error',
    waiting: (count) => (count === 1 ? '1 chat is waiting for you' : `${count} chats are waiting for you`),
    finished: (count) => (count === 1 ? '1 chat finished' : `${count} chats finished`)
  },
  it: {
    request: 'Claude aspetta una tua risposta',
    turnFinished: 'Claude ha finito',
    error: 'Claude si è fermato con un errore',
    waiting: (count) => (count === 1 ? '1 chat aspetta te' : `${count} chat aspettano te`),
    finished: (count) => (count === 1 ? '1 chat ha finito' : `${count} chat hanno finito`)
  }
}

// The notification for a push payload. data: the payload; language: 'it' or 'en'.
// Returns {title, body, tabId?}: tabId only when one chat is concerned (the tap opens it).
self.noticeView = (data, language) => {
  const text = NOTICE_TEXT[language] || NOTICE_TEXT.en
  const waiting = data.waiting || 0
  const finished = data.finished || 0
  if (waiting + finished <= 1) return { title: data.title || 'claude-wrap', body: text[data.kind] || '', tabId: data.tabId }
  const parts = [waiting ? text.waiting(waiting) : '', finished ? text.finished(finished) : ''].filter(Boolean)
  return { title: 'claude-wrap', body: parts.join(' · ') }
}

// Shows the notification as the only one: every notification on screen is closed first, since iOS does not replace
// one with the same tag (WebKit bug 258922). registration: the service worker's; title, options: the new one.
self.showOnly = async (registration, title, options) => {
  for (const old of await registration.getNotifications()) old.close()
  await registration.showNotification(title, options)
}
