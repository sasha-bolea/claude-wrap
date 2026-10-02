import { describe, expect, it } from 'vitest'
import type { TabMeta } from '@claude-wrap/protocol'
import { Store } from './store.ts'

const tab = (tabId: string): TabMeta => ({ tabId, title: tabId, cwd: 'C:/x', status: 'dormant', mode: 'default', queue: [], pendingRequests: 0 })

describe('Store', () => {
  it('applies tab.moved to the workspace order', () => {
    const store = new Store()
    store.applyWorkspaceReset({ kind: 'workspace', tabs: [tab('a'), tab('b'), tab('c')] })
    store.applyWorkspaceEvent({ type: 'tab.moved', tabId: 'c', index: 0 })
    expect(store.getSnapshot().tabs?.map((entry) => entry.tabId)).toEqual(['c', 'a', 'b'])
  })
})
