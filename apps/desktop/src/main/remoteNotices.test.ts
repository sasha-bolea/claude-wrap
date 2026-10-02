// Notices of a remote backend on the desktop: a session of the server that starts waiting, finishes or stops
// raises one system notification, like a local one.
import { describe, expect, it } from 'vitest'
import { RemoteNotices } from './remoteNotices.ts'

const tab = (status: string) => ({ tabId: 't1', title: 'Pagination', status })
const updated = (status: string) => ({ t: 'ev', stream: 'workspace', epoch: 'e', seq: 1, ev: { type: 'tab.updated', tab: tab(status) } })

describe('remote notices', () => {
  it('raises request, turn finished and error once per transition', () => {
    const notices = new RemoteNotices()
    expect(notices.feed({ t: 'reset', stream: 'workspace', snapshot: { kind: 'workspace', tabs: [tab('requires_action')] } })).toEqual([])
    expect(notices.feed(updated('requires_action'))).toEqual([])
    expect(notices.feed(updated('running'))).toEqual([])
    expect(notices.feed(updated('requires_action'))).toEqual([{ kind: 'request', tabId: 't1', title: 'Pagination' }])
    expect(notices.feed({ t: 'ev', stream: 'workspace', ev: { type: 'turn.finished', tabId: 't1' } })).toEqual([{ kind: 'turnFinished', tabId: 't1', title: 'Pagination' }])
    expect(notices.feed(updated('error'))).toEqual([{ kind: 'error', tabId: 't1', title: 'Pagination' }])
    expect(notices.feed({ t: 'ev', stream: 'tab:t1', ev: { type: 'item.added' } })).toEqual([])
  })
})
