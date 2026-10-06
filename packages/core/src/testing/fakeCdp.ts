import type { CdpTransport } from '../cdp.ts'

// In-memory stand-in for a Chromium DevTools endpoint: it implements the CdpTransport seam, records every call and
// answers the few Target/Page methods a browser host needs. Plain code (no vitest) so the hosts can also use it in e2e.

export type FakeCdpCall = { method: string; params: unknown; sessionId?: string }
type Handler = (params: unknown, sessionId?: string) => unknown | Promise<unknown>
type Json = Record<string, unknown>
type FakeTarget = { targetId: string; type: string; title: string; url: string; attached: boolean }

export type FakeCdp = {
  transport: CdpTransport
  calls: FakeCdpCall[]
  // Replaces the answer of a method; a throw becomes a CDP error response carrying the error message.
  answer(method: string, handler: Handler): void
  // Pushes an event from the "browser".
  emit(method: string, params: unknown, sessionId?: string): void
  // Emits a Page.screencastFrame (tiny image, fixed metadata, incrementing ack sessionId); returns that number.
  frame(sessionId?: string): number
  // Simulates the browser going away.
  closeFromBrowser(): void
}

// Builds a fake CDP endpoint with default answers (see the handlers below).
export function createFakeCdp(): FakeCdp {
  const calls: FakeCdpCall[] = []
  const handlers = new Map<string, Handler>()
  const messageListeners: Array<(text: string) => void> = []
  const closeListeners: Array<() => void> = []
  const targets = new Map<string, FakeTarget>([['page-1', { targetId: 'page-1', type: 'page', title: '', url: 'about:blank', attached: false }]])
  let closed = false
  let nextTarget = 2
  let nextSession = 1
  let screencastNumber = 0

  const deliver = (text: string): void => {
    for (const l of messageListeners) l(text)
  }
  const emit = (method: string, params: unknown, sessionId?: string): void => {
    deliver(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }))
  }
  const targetInfo = (t: FakeTarget): Json => ({ targetId: t.targetId, type: t.type, title: t.title, url: t.url, attached: t.attached })

  handlers.set('Target.getTargets', () => ({ targetInfos: [...targets.values()].map(targetInfo) }))
  handlers.set('Target.createTarget', (params) => {
    const url = (params as Json | undefined)?.url
    const t: FakeTarget = { targetId: `page-${nextTarget++}`, type: 'page', title: '', url: typeof url === 'string' ? url : 'about:blank', attached: false }
    targets.set(t.targetId, t)
    queueMicrotask(() => emit('Target.targetCreated', { targetInfo: targetInfo(t) }))
    return { targetId: t.targetId }
  })
  handlers.set('Target.attachToTarget', (params) => {
    const t = targets.get(String((params as Json | undefined)?.targetId))
    if (!t) throw new Error('No target with given id found')
    t.attached = true
    return { sessionId: `session-${nextSession++}` }
  })
  handlers.set('Target.closeTarget', (params) => {
    const id = String((params as Json | undefined)?.targetId)
    const t = targets.get(id)
    if (!t) throw new Error('No target with given id found')
    targets.delete(id)
    queueMicrotask(() => emit('Target.targetDestroyed', { targetId: id }))
    return { success: true }
  })
  handlers.set('Page.navigate', (params) => {
    const url = String((params as Json | undefined)?.url ?? '')
    const t = [...targets.values()][0]
    if (t) {
      t.url = url
      queueMicrotask(() => emit('Target.targetInfoChanged', { targetInfo: targetInfo(t) }))
    }
    return { frameId: 'frame-1', loaderId: 'loader-1' }
  })

  const respond = async (id: number, method: string, params: unknown, sessionId?: string): Promise<void> => {
    let reply: Json
    try {
      const result = handlers.has(method) ? await handlers.get(method)!(params, sessionId) : {}
      reply = { id, result: result ?? {} }
    } catch (error) {
      reply = { id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }
    }
    if (!closed) deliver(JSON.stringify({ ...reply, ...(sessionId ? { sessionId } : {}) }))
  }

  const transport: CdpTransport & { deliver(text: string): void } = {
    send(text) {
      const msg = JSON.parse(text) as { id: number; method: string; params?: unknown; sessionId?: string }
      calls.push({ method: msg.method, params: msg.params, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) })
      void respond(msg.id, msg.method, msg.params, msg.sessionId)
    },
    onMessage: (l) => void messageListeners.push(l),
    onClose: (l) => void closeListeners.push(l),
    close() {
      closeFromBrowser()
    },
    deliver
  }

  function closeFromBrowser(): void {
    if (closed) return
    closed = true
    for (const l of closeListeners) l()
  }

  return {
    transport,
    calls,
    answer: (method, handler) => void handlers.set(method, handler),
    emit,
    frame(sessionId) {
      const n = ++screencastNumber
      emit('Page.screencastFrame', { data: 'iVBORw0KGgo=', metadata: { deviceWidth: 1280, deviceHeight: 720, offsetTop: 0, pageScaleFactor: 1, scrollOffsetX: 0, scrollOffsetY: 0 }, sessionId: n }, sessionId)
      return n
    },
    closeFromBrowser
  }
}
