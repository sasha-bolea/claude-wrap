import type { Notice } from '@claude-wrap/core'

// Notices of a remote backend, read from the workspace stream passing through the desktop's socket bridge (the
// server's own notices go to Web Push, which the desktop does not use). Same kinds as the local core's: a tab that
// starts waiting for an answer, a finished turn, a process that stopped.

type Frame = { t?: string; stream?: string; snapshot?: { kind?: string; tabs?: TabLike[] }; ev?: { type?: string; tab?: TabLike; tabId?: string } }
type TabLike = { tabId: string; title: string; status: string }

export class RemoteNotices {
  private readonly tabs = new Map<string, TabLike>()

  // Notices raised by one frame from the server (most frames raise none).
  feed(frame: unknown): Notice[] {
    const { t, stream, snapshot, ev } = (frame ?? {}) as Frame
    if (stream !== 'workspace') return []
    if (t === 'reset' && snapshot?.kind === 'workspace') {
      this.tabs.clear()
      for (const tab of snapshot.tabs ?? []) this.tabs.set(tab.tabId, tab)
      return []
    }
    if (t !== 'ev' || !ev) return []
    if (ev.type === 'turn.finished' && ev.tabId) return [{ kind: 'turnFinished', tabId: ev.tabId, title: this.tabs.get(ev.tabId)?.title ?? '' }]
    if (ev.type === 'tab.removed' && ev.tabId) this.tabs.delete(ev.tabId)
    if ((ev.type !== 'tab.updated' && ev.type !== 'tab.added') || !ev.tab) return []
    const before = this.tabs.get(ev.tab.tabId)?.status
    this.tabs.set(ev.tab.tabId, ev.tab)
    const { tabId, title, status } = ev.tab
    if (status === 'requires_action' && before !== 'requires_action') return [{ kind: 'request', tabId, title }]
    if (status === 'error' && before !== 'error') return [{ kind: 'error', tabId, title }]
    return []
  }
}
