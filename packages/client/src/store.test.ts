import { describe, expect, it } from 'vitest'
import type { TabMeta } from '@claude-wrap/protocol'
import { Store } from './store.ts'

const tab = (tabId: string): TabMeta => ({ tabId, title: tabId, cwd: 'C:/x', status: 'dormant', mode: 'default', queue: [], pendingRequests: 0 })

describe('Store', () => {
  it('applies tab.moved to the workspace order', () => {
    const store = new Store()
    store.applyWorkspaceReset({ kind: 'workspace', tabs: [tab('a'), tab('b'), tab('c')], home: { kind: 'root', path: '/srv' }, projects: [], accounts: [], terminals: [] })
    store.applyWorkspaceEvent({ type: 'tab.moved', tabId: 'c', index: 0 })
    expect(store.getSnapshot().tabs?.map((entry) => entry.tabId)).toEqual(['c', 'a', 'b'])
  })

  // Sub-phase B: the Home and the project marks follow the workspace; a notes change bumps that folder's version so
  // a screen showing its notes reads them again.
  it('keeps the Home, the project marks and a version of each folder notes', () => {
    const store = new Store()
    store.applyWorkspaceReset({ kind: 'workspace', tabs: [], home: { kind: 'root', path: '/srv' }, projects: [], accounts: [], terminals: [] })
    store.applyWorkspaceEvent({ type: 'folders.updated', home: { kind: 'root', path: '/srv' }, projects: ['/srv/a'] })
    store.applyWorkspaceEvent({ type: 'notes.changed', cwd: '/srv/a' })
    store.applyWorkspaceEvent({ type: 'notes.changed', cwd: '/srv/a' })
    expect(store.getSnapshot()).toMatchObject({ home: { kind: 'root', path: '/srv' }, projects: ['/srv/a'], notesVersion: { '/srv/a': 2 } })
  })

  it('keeps the Claude accounts and the default one', () => {
    const store = new Store()
    store.applyWorkspaceReset({ kind: 'workspace', tabs: [], home: { kind: 'root', path: '/srv' }, projects: [], accounts: [], terminals: [] })
    store.applyWorkspaceEvent({ type: 'accounts.updated', accounts: [{ accountId: 'a1', name: 'Second', addedAt: 1 }], defaultAccount: 'a1' })
    expect(store.getSnapshot()).toMatchObject({ accounts: [{ accountId: 'a1', name: 'Second' }], defaultAccount: 'a1' })
  })
})
