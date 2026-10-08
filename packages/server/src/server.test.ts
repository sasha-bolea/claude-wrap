// Remote server, Phase 3a. User stories: only my paired devices reach the backend, only through the expected
// address and origin; a one-time code pairs a new device; revoking a device cuts it off at once (with the devices
// it added); the PWA files are served safely; nothing outside the root opens.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { WebSocket } from 'ws'
import { Connection, openWebSocket, type StoreState } from '@athome/client'
import { createCore, type Core } from '@athome/core'
import { createFakeSdk } from '@athome/core/testing'
import { PROTOCOL_VERSION } from '@athome/protocol'
import { deviceCommands } from './deviceCommands.ts'
import { DeviceStore, createPairingCode } from './devices.ts'
import { MAX_PAYLOAD, startServer, type RunningServer } from './server.ts'
import { loadStaticFiles } from './staticFiles.ts'

const ORIGIN = 'https://server.example.ts.net:8443'
const ROOT = mkdtempSync(join(tmpdir(), 'cw-server-root-'))
mkdirSync(join(ROOT, 'project'))

let stateDir: string
let devices: DeviceStore
let core: Core
let server: RunningServer
let url: string
let connections: Connection[] = []

// Starts core + server on an ephemeral port. login: Tailscale login to require.
async function start(login?: string): Promise<void> {
  const web = mkdtempSync(join(tmpdir(), 'cw-web-'))
  mkdirSync(join(web, 'assets'))
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>app</title>')
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(web, 'widget-frame.html'), '<!doctype html><title>frame</title>')
  stateDir = mkdtempSync(join(tmpdir(), 'cw-server-state-'))
  devices = await DeviceStore.load(stateDir)
  core = createCore({
    backendId: 'server',
    backendKind: 'remote',
    sdk: createFakeSdk(),
    allowedRoots: [ROOT],
    hostCommands: deviceCommands(devices, (ids) => server.disconnect(ids), 'test-public-key')
  })
  server = await startServer({
    attach: core.attach,
    devices,
    port: 0,
    allowedOrigins: [ORIGIN],
    allowedHosts: ['server.example.ts.net:8443'],
    tailscaleLogin: login,
    files: await loadStaticFiles(web),
    palettes: () => core.palettes(),
    socketOrigin: 'wss://server.example.ts.net:8443',
    log: () => undefined
  })
  url = `ws://127.0.0.1:${server.port}/ws`
}

// Headers a request through Tailscale Serve would carry.
const PROXY_HEADERS = { Host: 'server.example.ts.net:8443', Origin: ORIGIN }

// A raw HTTP request to the server. Returns status, headers and body.
function http(method: string, path: string, headers: Record<string, string> = PROXY_HEADERS, body?: string) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk: string) => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Pairs a device through POST /pair with a code from the CLI. Returns its token.
async function pairDevice(name = 'phone'): Promise<string> {
  const { code } = await createPairingCode(stateDir, name)
  const response = await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))
  return (JSON.parse(response.body) as { token: string }).token
}

// Opens a raw WebSocket with given headers; resolves with the HTTP status of a refused upgrade, or the socket.
function rawSocket(headers: Record<string, string> = PROXY_HEADERS): Promise<{ status?: number; socket?: WebSocket }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers })
    socket.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }))
    socket.on('open', () => resolve({ socket }))
    socket.on('error', () => resolve({ status: -1 }))
  })
}

// Frames received by a raw socket and the close code, after sending a hello with the given token.
async function helloWith(token: string | undefined): Promise<{ frames: { t: string; error?: { code: string } }[]; closeCode: number }> {
  const { socket } = await rawSocket()
  const frames: { t: string }[] = []
  socket!.on('message', (data) => frames.push(JSON.parse(data.toString())))
  const closed = new Promise<number>((resolve) => socket!.on('close', resolve))
  socket!.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'raw', token, visible: true, resume: {} }))
  const result = await Promise.race([closed, new Promise<number>((resolve) => setTimeout(() => resolve(0), 300))])
  socket!.close()
  return { frames, closeCode: result }
}

// A client Connection over the real WebSocket, with a device token.
function connect(token: string): Connection {
  const connection = new Connection({
    openChannel: () => openWebSocket(url, (target) => new WebSocket(target, { headers: PROXY_HEADERS })),
    clientId: `client-${connections.length}`,
    token,
    retry: { initialMs: 5, maxMs: 20 }
  })
  connections.push(connection)
  connection.start()
  return connection
}

// Resolves when a connection's store satisfies predicate.
async function until(connection: Connection, predicate: (state: StoreState) => boolean, timeoutMs = 2000): Promise<StoreState> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(connection.store.getSnapshot())) {
    if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(connection.store.getSnapshot()).slice(0, 300)}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return connection.store.getSnapshot()
}

beforeEach(() => start())
afterEach(async () => {
  connections.forEach((connection) => connection.close())
  connections = []
  await core.closeAll()
  await server.close()
})

describe('remote server: who may connect', () => {
  it('refuses a WebSocket with a wrong Origin, a wrong Host or another path', async () => {
    expect((await rawSocket({ ...PROXY_HEADERS, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await rawSocket({ ...PROXY_HEADERS, Host: 'evil.example' })).status).toBe(403)
    expect((await rawSocket({ Host: PROXY_HEADERS.Host })).status).toBe(403)
  })

  it('with a Tailscale login configured, requests without it or with another login are refused', async () => {
    await server.close()
    await core.closeAll()
    await start('owner@example.com')
    expect((await rawSocket()).status).toBe(403)
    expect((await rawSocket({ ...PROXY_HEADERS, 'Tailscale-User-Login': 'someone@else.com' })).status).toBe(403)
    expect((await http('GET', '/')).status).toBe(403)
    expect((await rawSocket({ ...PROXY_HEADERS, 'Tailscale-User-Login': 'owner@example.com' })).socket).toBeDefined()
  })

  it('a hello without a token or with an unknown one gets fatal unauthorized and is closed', async () => {
    for (const token of [undefined, 'not-a-token']) {
      const { frames, closeCode } = await helloWith(token)
      expect(frames).toEqual([{ t: 'fatal', error: { code: 'unauthorized', message: expect.any(String) } }])
      expect(closeCode).toBe(4401)
    }
  })

  it('a socket that never says hello is closed after the deadline; at most 4 wait at a time', async () => {
    const waiting = await Promise.all([1, 2, 3, 4].map(() => rawSocket()))
    expect(waiting.every((entry) => entry.socket)).toBe(true)
    expect((await rawSocket()).status).toBe(503)
    const closed = await new Promise<number>((resolve) => waiting[0]!.socket!.on('close', resolve))
    expect(closed).toBe(4401)
    waiting.forEach((entry) => entry.socket!.close())
  }, 10_000)
})

describe('remote server: pairing and devices', () => {
  it('a one-time code pairs a device; the token connects; the code cannot be used twice', async () => {
    const { code } = await createPairingCode(stateDir, 'phone')
    const first = await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))
    expect(first.status).toBe(200)
    expect((await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))).status).toBe(401)
    const { token } = JSON.parse(first.body) as { token: string }
    const connection = connect(token)
    const state = await until(connection, (s) => s.status === 'connected')
    expect(state.welcome).toMatchObject({ backendId: 'server', backendKind: 'remote' })
    expect(readdirSync(join(stateDir, 'pairing'))).toEqual([])
  })

  it('pairing needs an allowed Origin and refuses unknown codes', async () => {
    const { code } = await createPairingCode(stateDir, 'phone')
    expect((await http('POST', '/pair', { Host: PROXY_HEADERS.Host }, JSON.stringify({ code }))).status).toBe(403)
    expect((await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code: 'guess' }))).status).toBe(401)
    expect((await http('POST', '/pair', PROXY_HEADERS, 'not json')).status).toBe(401)
  })

  it('devices.* list the devices, start a pairing, and revoke with a cascade that disconnects at once', async () => {
    const phone = connect(await pairDevice('phone'))
    await until(phone, (s) => s.status === 'connected')
    // The phone adds a tablet, which connects too.
    const { code } = await phone.request('devices.pairStart', { name: 'tablet' })
    const paired = JSON.parse((await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))).body) as { token: string }
    const tablet = connect(paired.token)
    await until(tablet, (s) => s.status === 'connected')
    const laptop = connect(await pairDevice('laptop'))
    const { devices: listed } = await laptop.request('devices.list', {})
    expect(listed.map((device) => [device.name, device.current])).toEqual([['phone', false], ['tablet', false], ['laptop', true]])
    // Revoking the phone also revokes the tablet it created: both are disconnected and stay out.
    await laptop.request('devices.revoke', { deviceId: listed[0]!.deviceId })
    await until(phone, (s) => s.status === 'unauthorized')
    await until(tablet, (s) => s.status === 'unauthorized')
    expect((await laptop.request('devices.list', {})).devices.map((device) => device.name)).toEqual(['laptop'])
  })

  it('devices.revoke never removes the asking device, nor what it created; it refuses to revoke itself', async () => {
    const phone = connect(await pairDevice('phone'))
    await until(phone, (s) => s.status === 'connected')
    // Pairs a device made by `by` and connects it.
    const addFrom = async (by: Connection, name: string) => {
      const { code } = await by.request('devices.pairStart', { name })
      const paired = JSON.parse((await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))).body) as { token: string }
      const client = connect(paired.token)
      await until(client, (s) => s.status === 'connected')
      return client
    }
    const tablet = await addFrom(phone, 'tablet')
    const laptop = await addFrom(phone, 'laptop')
    const watch = await addFrom(laptop, 'watch')
    const ids = Object.fromEntries((await laptop.request('devices.list', {})).devices.map((device) => [device.name, device.deviceId]))
    await expect(laptop.request('devices.revoke', { deviceId: ids.laptop! })).rejects.toThrow()
    // The laptop removes the phone, which created it: the tablet goes, the laptop and its watch stay.
    await laptop.request('devices.revoke', { deviceId: ids.phone! })
    await until(phone, (s) => s.status === 'unauthorized')
    await until(tablet, (s) => s.status === 'unauthorized')
    const left = (await laptop.request('devices.list', {})).devices
    expect(left.map((device) => [device.name, device.createdBy])).toEqual([['laptop', undefined], ['watch', ids.laptop]])
    expect(laptop.store.getSnapshot().status).toBe('connected')
    expect(watch.store.getSnapshot().status).toBe('connected')
  })

  it('the device name is what other devices see on its messages', async () => {
    const phone = connect(await pairDevice('phone'))
    await phone.request('trust.grant', { cwd: join(ROOT, 'project') })
    await phone.request('tab.create', { tabId: 't1', cwd: join(ROOT, 'project') })
    await phone.request('tab.send', { tabId: 't1', text: 'first' })
    await phone.request('tab.queueAdd', { tabId: 't1', text: 'queued' })
    const state = await until(phone, (s) => s.tabs?.[0]?.queue.length === 1)
    expect(state.tabs?.[0]?.queue[0]?.from).toBe('phone')
  })
})

describe('remote server: files, limits, root', () => {
  it('serves the PWA with the security headers; client routes get index.html; traversal finds nothing', async () => {
    const index = await http('GET', '/')
    expect(index.status).toBe(200)
    expect(index.body).toContain('<title>app</title>')
    expect(index.headers['content-security-policy']).toContain("connect-src 'self' wss://server.example.ts.net:8443")
    expect(index.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(index.headers['x-content-type-options']).toBe('nosniff')
    expect((await http('GET', '/assets/app.js')).headers['content-type']).toContain('text/javascript')
    expect((await http('GET', '/sessions/123')).body).toContain('<title>app</title>')
    for (const path of ['/../package.json', '/assets/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/missing.js']) {
      expect((await http('GET', path)).status, path).toBe(404)
    }
    expect((await http('GET', '/', { Host: 'evil.example' })).status).toBe(403)
  })

  it("the chat widgets' page has its own policy: inline scripts, no network, framed only by the app", async () => {
    expect((await http('GET', '/')).headers['content-security-policy']).toContain("frame-src 'self'")
    const frame = await http('GET', '/widget-frame.html')
    expect(frame.body).toContain('<title>frame</title>')
    const policy = frame.headers['content-security-policy']
    expect(policy).toContain("script-src 'unsafe-inline'")
    expect(policy).toContain("frame-ancestors 'self'")
    expect(policy).not.toContain('connect-src')
    expect(policy).toContain("default-src 'none'")
  })

  it('the icons and the manifest come in the accent of a palette when asked; the fixed ones otherwise', async () => {
    const icon = await http('GET', '/icon-192.png?accent=1a2b3c')
    expect(icon.status).toBe(200)
    expect(icon.headers['content-type']).toBe('image/png')
    expect((await http('GET', '/icon-192.png')).status).toBe(404)
    expect((await http('GET', '/icon-192.png', { Host: 'evil.example' })).status).toBe(403)
  })

  it('the setup page of the installed app lists the palettes with a valid pairing code, which stays usable', async () => {
    const { code, expiresAt } = await createPairingCode(stateDir, 'phone')
    const setup = await http('GET', `/setup/palettes?code=${code}`)
    expect(setup.status).toBe(200)
    expect(setup.headers['content-type']).toBe('application/json')
    const body = JSON.parse(setup.body) as { palettes: { name: string }[]; expiresAt: number }
    expect(body.expiresAt).toBe(expiresAt)
    expect(body.palettes.map((palette) => palette.name)).toContain('Notte')
    for (const bad of ['', '?code=unknown-code-here']) expect((await http('GET', `/setup/palettes${bad}`)).status).toBe(404)
    expect((await http('POST', '/pair', PROXY_HEADERS, JSON.stringify({ code }))).status).toBe(200)
    expect((await http('GET', `/setup/palettes?code=${code}`)).status).toBe(404)
  })

  it('a frame over the size limit closes the socket', async () => {
    const token = await pairDevice()
    const { socket } = await rawSocket()
    socket!.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'big', token, visible: true, resume: {} }))
    const closed = new Promise<number>((resolve) => socket!.on('close', resolve))
    socket!.send('x'.repeat(MAX_PAYLOAD + 1))
    expect(await closed).toBe(1009)
  })

  it('a session outside the root does not start', async () => {
    const phone = connect(await pairDevice())
    await phone.request('tab.create', { tabId: 't1', cwd: tmpdir() })
    await expect(phone.request('tab.send', { tabId: 't1', text: 'hi' })).rejects.toMatchObject({ code: 'outside_root' })
    await expect(phone.request('folders.list', { path: tmpdir() })).rejects.toMatchObject({ code: 'outside_root' })
  })
})
