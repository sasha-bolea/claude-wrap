import type { MessagePortMain } from 'electron'
import WebSocket from 'ws'
import { APP_ORIGIN } from './backends.ts'

// Joins a renderer's MessagePort to a WebSocket on a remote server, owned by main: the page's CSP allows no
// network, and the device token is added to the hello here, so it never reaches the renderer. Frames pass through
// unchanged (core and client validate them); onFrame sees each server frame (notifications).

// The hello with the device token; any other frame unchanged.
function withToken(frame: unknown, token: string): unknown {
  return (frame as { t?: unknown } | undefined)?.t === 'hello' ? { ...(frame as object), token } : frame
}

export function bridgeRemote(port: MessagePortMain, server: { url: string; token: string }, onFrame: (frame: unknown) => void): void {
  const url = new URL('/ws', server.url)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url, { headers: { Origin: APP_ORIGIN } })
  const early: string[] = []
  port.on('message', ({ data }) => {
    const text = JSON.stringify(withToken(data, server.token))
    if (socket.readyState === WebSocket.OPEN) socket.send(text)
    else early.push(text)
  })
  socket.on('open', () => early.splice(0).forEach((text) => socket.send(text)))
  socket.on('message', (raw) => {
    let frame: unknown
    try {
      frame = JSON.parse(raw.toString())
    } catch {
      return
    }
    port.postMessage(frame)
    onFrame(frame)
  })
  // Either side closing closes the other: the renderer's connection then reconnects with its backoff.
  socket.on('close', () => port.close())
  socket.on('error', () => undefined)
  port.on('close', () => socket.close())
  port.start()
}
