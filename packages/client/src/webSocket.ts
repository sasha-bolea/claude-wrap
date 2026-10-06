import type { Channel } from '@athome/protocol'

// What the WebSocket transport needs from a socket: the browser WebSocket, Node's, or the `ws` package's.
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number): void
  // The event types differ between implementations; only `data` of message events is read.
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void
}

const OPEN = 1

// Opens a WebSocket and wraps it as a protocol Channel (JSON text frames). Resolves once open, rejects if it
// closes first. create: builds the socket (default: the global WebSocket; tests and the desktop main pass one
// that sets headers).
export function openWebSocket(url: string, create: (url: string) => WebSocketLike = (target) => new WebSocket(target)): Promise<Channel> {
  return new Promise((resolve, reject) => {
    const socket = create(url)
    const messageListeners: ((frame: unknown) => void)[] = []
    const closeListeners: (() => void)[] = []
    let opened = false
    const channel: Channel = {
      send: (frame) => socket.readyState === OPEN && socket.send(JSON.stringify(frame)),
      onMessage: (listener) => messageListeners.push(listener),
      onClose: (listener) => closeListeners.push(listener),
      close: () => socket.close()
    }
    socket.addEventListener('open', () => {
      opened = true
      resolve(channel)
    })
    // A frame that is not JSON is passed on as undefined: the receiver's validation rejects it.
    socket.addEventListener('message', (event) => {
      let frame: unknown
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        frame = undefined
      }
      messageListeners.forEach((listener) => listener(frame))
    })
    socket.addEventListener('close', () => {
      if (!opened) reject(new Error(`cannot connect to ${url}`))
      closeListeners.splice(0).forEach((listener) => listener())
    })
  })
}
