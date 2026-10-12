// The phone's single notification (public/notice.js, loaded by the service worker): one chat → its title and what
// happened, tapping opens it; more chats → how many wait for an answer and how many finished, tapping opens the
// open sessions.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

type View = { title: string; body: string; tabId?: string }
type Data = { kind?: string; title?: string; tabId?: string; waiting?: number; finished?: number }
type Shown = { title: string; options: { tag: string; body: string } }
type Registration = { getNotifications: () => Promise<{ close: () => void }[]>; showNotification: (title: string, options: Shown['options']) => Promise<void> }

const scope: { noticeView?: (data: Data, language: string) => View; showOnly?: (registration: Registration, title: string, options: Shown['options']) => Promise<void> } = {}
runInNewContext(readFileSync(new URL('../public/notice.js', import.meta.url), 'utf8'), { self: scope })
const view = (data: Data, language = 'it') => scope.noticeView!(data, language)

describe('the single notification', () => {
  it('one chat: its title, what happened, and its tab', () => {
    expect(view({ kind: 'request', title: 'Pagination', tabId: 't1', waiting: 1, finished: 0 })).toEqual({ title: 'Pagination', body: 'Claude aspetta una tua risposta', tabId: 't1' })
    expect(view({ kind: 'turnFinished', title: 'Pagination', tabId: 't1', waiting: 0, finished: 1 }, 'en')).toEqual({ title: 'Pagination', body: 'Claude finished', tabId: 't1' })
  })

  it('more chats: the counts, singular and plural, and no tab', () => {
    expect(view({ kind: 'turnFinished', title: 'x', tabId: 't2', waiting: 2, finished: 1 })).toEqual({ title: 'AtHome', body: '2 chat aspettano te · 1 chat ha finito' })
    expect(view({ kind: 'request', title: 'x', tabId: 't2', waiting: 1, finished: 3 })).toEqual({ title: 'AtHome', body: '1 chat aspetta te · 3 chat hanno finito' })
    expect(view({ kind: 'error', title: 'x', tabId: 't2', waiting: 0, finished: 2 }, 'en')).toEqual({ title: 'AtHome', body: '2 chats finished' })
    expect(view({ kind: 'request', title: 'x', tabId: 't2', waiting: 2, finished: 0 }, 'en')).toEqual({ title: 'AtHome', body: '2 chats are waiting for you' })
  })

  it('a payload without counts (older server) still names its chat', () => {
    expect(view({ kind: 'error', title: 'Old', tabId: 't9' }, 'en')).toEqual({ title: 'Old', body: 'Claude stopped with an error', tabId: 't9' })
  })

  it('every notification on screen is closed before the new one: iOS does not replace one with the same tag', async () => {
    const log: string[] = []
    const registration: Registration = {
      getNotifications: async () => ['a', 'b'].map((name) => ({ close: () => void log.push(`close ${name}`) })),
      showNotification: async (title) => void log.push(`show ${title}`)
    }
    await scope.showOnly!(registration, 'AtHome', { tag: 'claude-wrap', body: '2 chat aspettano te' })
    expect(log).toEqual(['close a', 'close b', 'show AtHome'])
  })
})
