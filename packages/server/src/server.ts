import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { Identity } from '@athome/core'
import type { Channel } from '@athome/protocol'
import type { DeviceStore } from './devices.ts'
import { findStatic, type StaticFiles } from './staticFiles.ts'

// The remote host: HTTP for the PWA files and pairing, WebSocket `/ws` for the protocol. Behind Tailscale Serve
// (TLS) on 127.0.0.1. Every request must name an allowed Host (and, when configured, carry the owner's
// Tailscale login); WebSockets must also come from an allowed Origin. The device token in `hello` is the real
// authentication: the checks before it only narrow who can try.

export const MAX_PAYLOAD = 32 * 1024 * 1024
const HELLO_DEADLINE_MS = 5000
const MAX_UNAUTHENTICATED = 4
const MAX_PAIR_BODY = 4096
// A socket whose send buffer stays above the limit this many seconds in a row is dropped (a reset or replay
// burst drains in far less).
const BACKPRESSURE_BYTES = 8 * 1024 * 1024
const BACKPRESSURE_SECONDS = 10
const CLOSE_UNAUTHORIZED = 4401

export type ServerOptions = {
  // Hands an authenticated connection to core.
  attach(channel: Channel, identity: Identity): void
  devices: DeviceStore
  port: number
  host?: string
  allowedOrigins: string[]
  allowedHosts: string[]
  // Owner's login as set by Tailscale Serve in Tailscale-User-Login; absent → not checked (dev).
  tailscaleLogin?: string
  files?: StaticFiles
  // wss:// origin the PWA connects to, for the CSP.
  socketOrigin?: string
  // Wraps every channel before core sees it (tests: lose frames on purpose).
  wrapChannel?: (channel: Channel) => Channel
  log?: (line: string) => void
}

export type RunningServer = { port: number; disconnect(deviceIds: string[]): void; close(): Promise<void> }

// Security headers of every HTTP answer; the CSP matches the desktop's, plus the WebSocket origin. Inline styles are
// allowed for the terminal (xterm.js writes its measures and colours in <style> elements); scripts stay 'self' only,
// and images, fonts and connections stay on this server, so an injected style could not carry anything out.
function securityHeaders(socketOrigin?: string): Record<string, string> {
  const connect = ["'self'", socketOrigin].filter(Boolean).join(' ')
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache'
  }
}

// Reads a small request body; undefined when it is larger than max.
function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > max) {
        resolve(undefined)
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(undefined))
  })
}

// A WebSocket as a protocol Channel; deliver() hands core a frame read before it attached (the hello).
function socketChannel(socket: WebSocket): { channel: Channel; deliver(frame: unknown): void } {
  const listeners: ((frame: unknown) => void)[] = []
  const deliver = (frame: unknown) => listeners.forEach((listener) => listener(frame))
  socket.on('message', (data: RawData) => deliver(parseFrame(data)))
  const channel: Channel = {
    send: (frame) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(frame)),
    onMessage: (listener) => listeners.push(listener),
    onClose: (listener) => socket.on('close', listener),
    close: () => socket.close()
  }
  return { channel, deliver }
}

// JSON of a text frame; anything else becomes undefined (core rejects it).
function parseFrame(data: RawData): unknown {
  try {
    return JSON.parse(data.toString())
  } catch {
    return undefined
  }
}

// Drops a socket whose send buffer stays full (a client that stopped reading). Returns the stop function.
function watchBackpressure(socket: WebSocket, log: (line: string) => void): () => void {
  let seconds = 0
  const timer = setInterval(() => {
    seconds = socket.bufferedAmount > BACKPRESSURE_BYTES ? seconds + 1 : 0
    if (seconds < BACKPRESSURE_SECONDS) return
    log('ws dropped: send buffer full')
    socket.terminate()
  }, 1000)
  return () => clearInterval(timer)
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? ((line: string) => console.log(line))
  const headers = securityHeaders(options.socketOrigin)
  const sockets = new Map<string, Set<WebSocket>>() // deviceId → open sockets
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  let unauthenticated = 0

  // Host allowlist and, when configured, the owner's Tailscale login: checked on every request.
  const allowed = (req: IncomingMessage) =>
    options.allowedHosts.includes(req.headers.host ?? '') && (!options.tailscaleLogin || req.headers['tailscale-user-login'] === options.tailscaleLogin)
  const fromAllowedOrigin = (req: IncomingMessage) => options.allowedOrigins.includes(req.headers.origin ?? '')
  const answer = (res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void =>
    void res.writeHead(status, { ...headers, 'Content-Type': type }).end(body)

  // POST /pair {code} → {deviceId, token}: the only thing an unpaired client can do. No rate limit: codes are
  // 128 random bits and expire after 10 minutes, guessing one is not feasible.
  async function pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!fromAllowedOrigin(req)) return answer(res, 403, 'forbidden')
    const body = await readBody(req, MAX_PAIR_BODY)
    const code = body && (JSON.parse(body.trim().startsWith('{') ? body : '{}') as { code?: unknown }).code
    const paired = typeof code === 'string' ? await options.devices.completePairing(code) : undefined
    if (!paired) {
      log('pair refused: unknown or expired code')
      return answer(res, 401, JSON.stringify({ error: 'unknown or expired code' }), 'application/json')
    }
    log(`paired device ${paired.deviceId}`)
    answer(res, 200, JSON.stringify(paired), 'application/json')
  }

  function onRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!allowed(req)) return answer(res, 403, 'forbidden')
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === '/pair' && req.method === 'POST') return void pair(req, res).catch(() => answer(res, 400, 'bad request'))
    if (req.method !== 'GET' && req.method !== 'HEAD') return answer(res, 405, 'method not allowed')
    const file = options.files && findStatic(options.files, pathname)
    if (!file) return answer(res, 404, 'not found')
    res.writeHead(200, { ...headers, 'Content-Type': file.type, 'Content-Length': file.body.length })
    res.end(req.method === 'HEAD' ? undefined : file.body)
  }

  // The first frame must be a hello with a valid device token, within HELLO_DEADLINE_MS.
  function onSocket(socket: WebSocket): void {
    unauthenticated++
    let waiting = true
    const settle = () => waiting && ((waiting = false), unauthenticated--, clearTimeout(deadline))
    const deadline = setTimeout(() => socket.close(CLOSE_UNAUTHORIZED, 'hello expected'), HELLO_DEADLINE_MS)
    socket.on('close', settle)
    // Protocol errors (e.g. a frame over MAX_PAYLOAD) close the socket; unhandled, they would crash the server.
    socket.on('error', (error) => log(`ws error: ${error.message}`))
    socket.once('message', (data: RawData) => {
      settle()
      const hello = parseFrame(data) as { t?: unknown; token?: unknown } | undefined
      const device = hello?.t === 'hello' && typeof hello.token === 'string' ? options.devices.authenticate(hello.token) : undefined
      if (!device) {
        log('ws refused: unknown or revoked device')
        socket.send(JSON.stringify({ t: 'fatal', error: { code: 'unauthorized', message: 'unknown or revoked device: pair this device again' } }))
        return socket.close(CLOSE_UNAUTHORIZED, 'unauthorized')
      }
      const open = sockets.get(device.deviceId) ?? new Set()
      sockets.set(device.deviceId, open.add(socket))
      const stopWatch = watchBackpressure(socket, log)
      socket.on('close', () => (open.delete(socket), stopWatch()))
      log(`ws connected: ${device.name}`)
      const { channel, deliver } = socketChannel(socket)
      options.attach(options.wrapChannel?.(channel) ?? channel, { deviceId: device.deviceId, label: device.name })
      deliver(hello)
    })
  }

  // Origin, Host and login checks happen before the WebSocket handshake; failures get a plain 403.
  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const refuse = (status: string): void => void (socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`), socket.destroy())
    if (pathname !== '/ws' || !allowed(req) || !fromAllowedOrigin(req)) {
      log(`ws refused: host ${req.headers.host ?? '-'} origin ${req.headers.origin ?? '-'}`)
      return refuse('403 Forbidden')
    }
    if (unauthenticated >= MAX_UNAUTHENTICATED) return refuse('503 Service Unavailable')
    wss.handleUpgrade(req, socket, head, onSocket)
  }

  const http = createServer(onRequest)
  http.on('upgrade', onUpgrade)
  await new Promise<void>((resolve) => http.listen(options.port, options.host ?? '127.0.0.1', resolve))
  const address = http.address()
  return {
    port: typeof address === 'object' && address ? address.port : options.port,
    // Closes the sockets of revoked devices at once.
    disconnect: (deviceIds) => deviceIds.forEach((deviceId) => sockets.get(deviceId)?.forEach((socket) => socket.close(CLOSE_UNAUTHORIZED, 'revoked'))),
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate()
        http.close(() => resolve())
        http.closeAllConnections()
      })
  }
}
