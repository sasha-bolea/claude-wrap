// Minimal Chrome DevTools Protocol client for core: a transport seam (Node's global WebSocket in production, an
// in-memory fake in tests) and a request/response + event layer on top. Flat sessions: messages carry `sessionId`.

export type CdpTransport = {
  send(text: string): void
  onMessage(listener: (text: string) => void): void
  onClose(listener: () => void): void
  close(): void
}

export type CdpListener = (params: unknown, sessionId?: string) => void
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const CONNECT_TIMEOUT_MS = 5000
const CALL_TIMEOUT_MS = 15000

// Opens a WebSocket to a DevTools URL with the built-in global WebSocket.
// Parameters: wsUrl (ws://...). Returns the transport once open; rejects on error or after 5 s.
export function connectCdp(wsUrl: string): Promise<CdpTransport> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const messageListeners: Array<(text: string) => void> = []
    const closeListeners: Array<() => void> = []
    let opened = false
    const timer = setTimeout(() => {
      reject(new Error(`CDP connect timed out: ${wsUrl}`))
      ws.close()
    }, CONNECT_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      opened = true
      clearTimeout(timer)
      resolve({
        send: (text) => ws.send(text),
        onMessage: (l) => void messageListeners.push(l),
        onClose: (l) => void closeListeners.push(l),
        close: () => ws.close()
      })
    })
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') for (const l of messageListeners) l(event.data)
    })
    ws.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(timer)
        reject(new Error(`CDP connection failed: ${wsUrl}`))
      }
    })
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      if (!opened) reject(new Error(`CDP connection closed before opening: ${wsUrl}`))
      for (const l of closeListeners) l()
    })
  })
}

// Asks a starting Chrome for its browser-level WebSocket URL, retrying until it is up.
// Parameters: port (remote debugging port), fetchImpl (injectable), options (retry delay and total wait, default 250 ms / 10 s).
// Returns webSocketDebuggerUrl; rejects with the last error after the deadline.
export async function browserWsUrl(port: number, fetchImpl: typeof fetch = fetch, options: { delayMs?: number; totalMs?: number } = {}): Promise<string> {
  const delayMs = options.delayMs ?? 250
  const deadline = Date.now() + (options.totalMs ?? 10000)
  let last: unknown = new Error('no attempt made')
  for (;;) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/json/version`)
      if (!res.ok) throw new Error(`/json/version answered ${res.status}`)
      const url = ((await res.json()) as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl
      if (typeof url === 'string' && url) return url
      throw new Error('/json/version has no webSocketDebuggerUrl')
    } catch (error) {
      last = error
    }
    if (Date.now() + delayMs > deadline) throw last instanceof Error ? last : new Error(String(last))
    await new Promise((r) => setTimeout(r, delayMs))
  }
}

export class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<CdpListener>>()
  private readonly transport: CdpTransport
  private readonly timeoutMs: number
  private markClosed!: () => void
  closed = false
  readonly closedPromise: Promise<void> = new Promise((resolve) => {
    this.markClosed = resolve
  })

  // Builds a client on a transport. Options: timeoutMs = default per-call timeout (15 s).
  constructor(transport: CdpTransport, options: { timeoutMs?: number } = {}) {
    this.transport = transport
    this.timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS
    transport.onMessage((text) => this.handleMessage(text))
    transport.onClose(() => this.handleClose())
  }

  // Calls a CDP method. Parameters: method, params, sessionId (flat session), timeoutMs (overrides the default).
  // Returns the result; rejects on a CDP error, on timeout, or when the connection is closed.
  send<T = unknown>(method: string, params?: unknown, sessionId?: string, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.transport.send(JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}), ...(sessionId ? { sessionId } : {}) }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  // Subscribes to a CDP event by method name. Returns the unsubscribe function.
  on(method: string, listener: CdpListener): () => void {
    let set = this.listeners.get(method)
    if (!set) this.listeners.set(method, (set = new Set()))
    set.add(listener)
    return () => void set.delete(listener)
  }

  // Closes the connection; pending calls are rejected.
  close(): void {
    this.transport.close()
    this.handleClose()
  }

  // Routes one incoming frame to a pending call or to event listeners; malformed frames are ignored.
  private handleMessage(text: string): void {
    let msg: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      msg = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (typeof msg.id === 'number') this.settle(msg.id, msg)
    else if (typeof msg.method === 'string') this.dispatch(msg.method, msg.params, typeof msg.sessionId === 'string' ? msg.sessionId : undefined)
  }

  // Resolves or rejects the pending call a response belongs to.
  private settle(id: number, msg: Record<string, unknown>): void {
    const call = this.pending.get(id)
    if (!call) return
    this.pending.delete(id)
    clearTimeout(call.timer)
    const error = msg.error as { message?: unknown } | undefined
    if (error && typeof error === 'object') call.reject(new Error(typeof error.message === 'string' ? error.message : 'CDP error'))
    else call.resolve(msg.result ?? {})
  }

  // Calls the listeners of an event; a throwing listener never breaks the message handler.
  private dispatch(method: string, params: unknown, sessionId?: string): void {
    for (const l of [...(this.listeners.get(method) ?? [])]) {
      try {
        l(params, sessionId)
      } catch {
        // listener errors are the listener's business
      }
    }
  }

  // Marks the client closed and rejects every pending call (idempotent).
  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('CDP connection closed'))
    }
    this.pending.clear()
    this.markClosed()
  }
}
