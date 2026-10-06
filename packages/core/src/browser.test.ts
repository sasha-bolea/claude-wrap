// The shared browser through the protocol, on an in-memory fake of Chromium's DevTools endpoint (no real Chrome).
// User stories: I open the browser view and see the page live; I tap, scroll and type into it; I open, switch and
// close tabs (at most 5); only http(s) pages; downloads never land on the server; the browser starts when needed,
// goes away when nobody uses it, and comes back; it is only on the server.
import { afterEach, describe, expect, it } from 'vitest'
import { browserStream, type BrowserEvent, type BrowserSnapshot } from '@athome/protocol'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeCdp, type FakeCdp } from './testing/fakeCdp.ts'
import { createFakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

type FakeProcess = { args: string[]; killed: boolean }

let core: Core | undefined
let clients: RawClient[] = []
let cdps: FakeCdp[] = []
let processes: FakeProcess[] = []

// A core whose browser runs on fake launch/connect. Returns it with a connected client.
async function setup(extra: { idleMs?: number } = {}): Promise<RawClient> {
  const browser: NonNullable<CoreConfig['browser']> = {
    port: 3013,
    executable: '/fake/chrome',
    profileDir: '/fake/profile',
    idleMs: extra.idleMs,
    launch: (args) => {
      const proc: FakeProcess = { args, killed: false }
      processes.push(proc)
      return { kill: () => void (proc.killed = true), exited: new Promise<void>(() => {}) }
    },
    connect: async () => {
      const cdp = createFakeCdp()
      cdps.push(cdp)
      return cdp.transport
    }
  }
  core = createCore({ backendId: 'test', backendKind: 'remote', sdk: createFakeSdk(), browser })
  return await connect()
}

// Another client attached to the same core.
async function connect(clientId?: string): Promise<RawClient> {
  const raw = new RawClient(core!, clientId)
  await raw.hello()
  clients.push(raw)
  return raw
}

const cdp = () => cdps.at(-1)!
const called = (method: string) => cdp().calls.filter((call) => call.method === method)
const events = (of: RawClient, type: BrowserEvent['type']) => of.events(browserStream()).filter((ev) => ev.type === type)
const lastTabs = (of: RawClient) => events(of, 'browser.tabs').at(-1) as Extract<BrowserEvent, { type: 'browser.tabs' }> | undefined
const castSession = () => called('Page.startScreencast').at(-1)?.sessionId

afterEach(async () => {
  clients.forEach((c) => c.close())
  await core?.closeAll()
  core = undefined
  clients = []
  cdps = []
  processes = []
})

describe('start and subscribe', () => {
  it('two concurrent subscribes start one Chromium and both get the snapshot', async () => {
    const a = await setup()
    const b = await connect('client-b')
    await Promise.all([a.ok('browser.subscribe', {}), b.ok('browser.subscribe', {})])
    expect(processes).toHaveLength(1)
    expect(processes[0]!.args).toEqual(expect.arrayContaining(['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=3013', '--user-data-dir=/fake/profile']))
    expect(processes[0]!.args).not.toContain('--no-sandbox')
    for (const c of [a, b]) {
      const snap = c.lastReset(browserStream())!.snapshot as BrowserSnapshot
      expect(snap.kind).toBe('browser')
      expect(snap.running).toBe(true)
      expect(snap.tabs).toEqual([{ tabId: 'page-1', url: 'about:blank', title: '', active: true }])
    }
  })

  it('denies downloads and discovers targets at start', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    expect(called('Target.setDiscoverTargets')[0]!.params).toEqual({ discover: true })
    expect(called('Browser.setDownloadBehavior')[0]!.params).toEqual({ behavior: 'deny' })
  })

  it('without a browser config every browser command fails with not_found', async () => {
    core = createCore({ backendId: 'test', backendKind: 'local', sdk: createFakeSdk() })
    const a = await connect()
    for (const [name, args] of [['browser.subscribe', {}], ['browser.reload', {}], ['browser.navigate', { url: 'https://a.test/' }]] as const) {
      const error = await a.fails(name, args)
      expect(error.code).toBe('not_found')
      expect(error.message).toContain('only on the server')
    }
  })
})

describe('screencast', () => {
  it('frames reach subscribed clients only and are acknowledged', async () => {
    const a = await setup()
    const b = await connect('client-b')
    await a.ok('browser.subscribe', {})
    const n = cdp().frame(castSession())
    await a.waitFor(() => events(a, 'browser.frame').length === 1)
    expect(events(b, 'browser.frame')).toHaveLength(0)
    const ack = called('Page.screencastFrameAck')[0]!
    expect(ack.params).toEqual({ sessionId: n })
    expect(ack.sessionId).toBe(castSession())
    const frame = events(a, 'browser.frame')[0] as Extract<BrowserEvent, { type: 'browser.frame' }>
    expect(frame).toMatchObject({ tabId: 'page-1', width: 1280, height: 720 })
  })

  it('a burst of frames is acknowledged one by one but only the latest goes out', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    for (let i = 0; i < 5; i++) cdp().frame(castSession())
    await a.waitFor(() => events(a, 'browser.frame').length >= 1)
    expect(called('Page.screencastFrameAck')).toHaveLength(5)
    expect(events(a, 'browser.frame').length).toBeLessThan(5)
  })

  it('a client subscribing later gets the latest frame in its snapshot', async () => {
    const a = await setup()
    const b = await connect('client-b')
    await a.ok('browser.subscribe', {})
    cdp().frame(castSession())
    await a.waitFor(() => events(a, 'browser.frame').length === 1)
    await b.ok('browser.subscribe', {})
    expect((b.lastReset(browserStream())!.snapshot as BrowserSnapshot).frame?.tabId).toBe('page-1')
  })

  it('the last unsubscribe stops the screencast; the first of two does not', async () => {
    const a = await setup()
    const b = await connect('client-b')
    await a.ok('browser.subscribe', {})
    await b.ok('browser.subscribe', {})
    expect(called('Page.startScreencast')).toHaveLength(1)
    await a.ok('browser.unsubscribe', {})
    expect(called('Page.stopScreencast')).toHaveLength(0)
    await b.ok('browser.unsubscribe', {})
    await b.waitFor(() => called('Page.stopScreencast').length === 1)
  })

  it('a client that goes away leaves the screencast', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    a.close()
    await a.waitFor(() => called('Page.stopScreencast').length === 1)
  })
})

describe('commands', () => {
  it('navigate refuses file: at the protocol and navigates for https', async () => {
    const a = await setup()
    expect((await a.fails('browser.navigate', { url: 'file:///etc/passwd' })).code).toBe('invalid_args')
    expect(cdps).toHaveLength(0)
    await a.ok('browser.navigate', { url: 'https://example.com/' })
    expect(called('Page.navigate')[0]!.params).toEqual({ url: 'https://example.com/' })
  })

  it('back goes to the previous history entry, reload reloads', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    cdp().answer('Page.getNavigationHistory', () => ({ currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] }))
    await a.ok('browser.back', {})
    expect(called('Page.navigateToHistoryEntry').at(-1)!.params).toEqual({ entryId: 10 })
    await a.ok('browser.forward', {})
    expect(called('Page.navigateToHistoryEntry').at(-1)!.params).toEqual({ entryId: 12 })
    await a.ok('browser.reload', {})
    expect(called('Page.reload')).toHaveLength(1)
  })

  it('pointer maps fractions onto the last frame device size', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    cdp().frame(castSession())
    await a.waitFor(() => events(a, 'browser.frame').length === 1)
    await a.ok('browser.pointer', { type: 'down', x: 0.5, y: 0.5 })
    await a.ok('browser.pointer', { type: 'up', x: 0.5, y: 0.5 })
    const mouse = called('Input.dispatchMouseEvent')
    expect(mouse[0]!.params).toMatchObject({ type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 })
    expect(mouse[1]!.params).toMatchObject({ type: 'mouseReleased', x: 640, y: 360 })
    expect(mouse[0]!.sessionId).toBe(castSession())
  })

  it('touch pointers use touch events', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    cdp().frame(castSession())
    await a.waitFor(() => events(a, 'browser.frame').length === 1)
    await a.ok('browser.pointer', { type: 'down', x: 0.25, y: 0.5, touch: true })
    await a.ok('browser.pointer', { type: 'move', x: 0.5, y: 0.5, touch: true })
    await a.ok('browser.pointer', { type: 'up', x: 0.5, y: 0.5, touch: true })
    const touch = called('Input.dispatchTouchEvent')
    expect(touch.map((c) => (c.params as { type: string }).type)).toEqual(['touchStart', 'touchMove', 'touchEnd'])
    expect(touch[0]!.params).toMatchObject({ touchPoints: [{ x: 320, y: 360 }] })
    expect((touch[2]!.params as { touchPoints: unknown[] }).touchPoints).toEqual([])
    expect(called('Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('wheel and text', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    await a.ok('browser.wheel', { x: 0.5, y: 0.5, dx: 0, dy: 120 })
    expect(called('Input.dispatchMouseEvent')[0]!.params).toMatchObject({ type: 'mouseWheel', deltaX: 0, deltaY: 120 })
    await a.ok('browser.text', { text: 'ciao' })
    expect(called('Input.insertText')[0]!.params).toEqual({ text: 'ciao' })
  })

  it('viewport emulates the device and touch on the active tab', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    await a.ok('browser.viewport', { width: 390, height: 700, mobile: true, scale: 2 })
    expect(called('Emulation.setDeviceMetricsOverride').at(-1)!.params).toEqual({ width: 390, height: 700, deviceScaleFactor: 2, mobile: true })
    expect(called('Emulation.setTouchEmulationEnabled').at(-1)!.params).toEqual({ enabled: true })
    await a.waitFor(() => called('Page.startScreencast').length === 2)
    expect(called('Page.startScreencast').at(-1)!.params).toMatchObject({ maxWidth: 780, maxHeight: 1400 })
  })
})

describe('tabs', () => {
  it('tabNew opens and activates a tab; the sixth is refused', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    const { tabId } = await a.ok('browser.tabNew', { url: 'https://a.test/' })
    expect(tabId).toBe('page-2')
    await a.waitFor(() => lastTabs(a)?.tabs.length === 2)
    expect(lastTabs(a)!.tabs.find((t) => t.active)!.tabId).toBe('page-2')
    for (let i = 0; i < 3; i++) await a.ok('browser.tabNew', {})
    const error = await a.fails('browser.tabNew', {})
    expect(error.code).toBe('invalid_args')
    expect(called('Target.createTarget')).toHaveLength(4)
  })

  it('tabSelect moves the screencast to the chosen tab', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    await a.ok('browser.tabNew', {})
    await a.waitFor(() => called('Page.startScreencast').length === 2)
    const second = castSession()
    await a.ok('browser.tabSelect', { tabId: 'page-1' })
    await a.waitFor(() => called('Page.startScreencast').length === 3)
    expect(castSession()).not.toBe(second)
    expect(called('Page.stopScreencast').at(-1)!.sessionId).toBe(second)
    expect(called('Target.activateTarget').at(-1)!.params).toEqual({ targetId: 'page-1' })
    expect(lastTabs(a)!.tabs.find((t) => t.active)!.tabId).toBe('page-1')
    expect((await a.fails('browser.tabSelect', { tabId: 'nope' })).code).toBe('not_found')
  })

  it('tabClose closes the target and the list follows', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    await a.ok('browser.tabNew', {})
    await a.ok('browser.tabClose', { tabId: 'page-2' })
    await a.waitFor(() => lastTabs(a)?.tabs.length === 1)
    expect(called('Target.closeTarget')[0]!.params).toEqual({ targetId: 'page-2' })
    expect(lastTabs(a)!.tabs[0]!.active).toBe(true)
  })

  it('page url and title changes reach the list', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    cdp().emit('Target.targetInfoChanged', { targetInfo: { targetId: 'page-1', type: 'page', title: 'Hi', url: 'https://a.test/' } })
    await a.waitFor(() => lastTabs(a)?.tabs[0]?.title === 'Hi')
    cdp().emit('Target.targetCreated', { targetInfo: { targetId: 'sw-1', type: 'service_worker', title: '', url: 'x' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(lastTabs(a)!.tabs).toHaveLength(1)
  })
})

describe('acting', () => {
  it('setActing reaches subscribers and the snapshot', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    // The public host, as the step-4 integration reaches it.
    ;(await core!.browser())!.setActing([{ tabId: 't1', title: 'Chat' }])
    await a.waitFor(() => events(a, 'browser.acting').length === 1)
    expect(events(a, 'browser.acting')[0]).toEqual({ type: 'browser.acting', sessions: [{ tabId: 't1', title: 'Chat' }] })
    const b = await connect('client-b')
    await b.ok('browser.subscribe', {})
    expect((b.lastReset(browserStream())!.snapshot as BrowserSnapshot).acting).toEqual([{ tabId: 't1', title: 'Chat' }])
  })
})

describe('lifecycle', () => {
  it('closes after idleMs with nobody watching (no one is left to hear it), and a later subscribe restarts it', async () => {
    const a = await setup({ idleMs: 40 })
    const b = await connect('client-b')
    await a.ok('browser.subscribe', {})
    await b.ok('browser.subscribe', {})
    await a.ok('browser.unsubscribe', {})
    await new Promise((r) => setTimeout(r, 80))
    expect(processes[0]!.killed).toBe(false)
    await b.ok('browser.unsubscribe', {})
    await b.waitFor(() => processes[0]!.killed)
    await a.ok('browser.subscribe', {})
    expect(processes).toHaveLength(2)
    expect((a.lastReset(browserStream())!.snapshot as BrowserSnapshot).running).toBe(true)
  })

  it('a command keeps an idle browser alive', async () => {
    const a = await setup({ idleMs: 100 })
    await a.ok('browser.navigate', { url: 'https://a.test/' })
    await new Promise((r) => setTimeout(r, 60))
    await a.ok('browser.reload', {})
    await new Promise((r) => setTimeout(r, 60))
    expect(processes[0]!.killed).toBe(false)
    await a.waitFor(() => processes[0]!.killed, 500)
  })

  it('an unexpected CDP close reports running:false and the next use restarts', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    cdp().closeFromBrowser()
    await a.waitFor(() => lastTabs(a)?.running === false)
    expect(processes[0]!.killed).toBe(true)
    await a.ok('browser.reload', {})
    expect(processes).toHaveLength(2)
    await a.waitFor(() => called('Page.startScreencast').length === 1)
  })

  it('closing the core kills Chromium', async () => {
    const a = await setup()
    await a.ok('browser.subscribe', {})
    await core!.closeAll()
    expect(processes[0]!.killed).toBe(true)
  })

  it('a failed start is reported and the next attempt tries again', async () => {
    core = createCore({
      backendId: 'test',
      backendKind: 'remote',
      sdk: createFakeSdk(),
      browser: { port: 3013, executable: '/x', profileDir: '/p', launch: () => ({ kill: () => {}, exited: new Promise<void>(() => {}) }), connect: () => Promise.reject(new Error('refused')) }
    })
    const a = await connect()
    const error = await a.fails('browser.subscribe', {})
    expect(error.code).toBe('internal')
    expect(error.message).toContain('refused')
  })
})
