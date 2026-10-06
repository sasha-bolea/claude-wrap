import { describe, expect, it } from 'vitest'
import { browserWsUrl, CdpClient, connectCdp } from './cdp.ts'
import { createFakeCdp } from './testing/fakeCdp.ts'

// A client over the fake, with no default answers needed: tests install their own.
function setup(timeoutMs?: number) {
  const fake = createFakeCdp()
  return { fake, client: new CdpClient(fake.transport, { timeoutMs }) }
}

describe('CdpClient', () => {
  it('matches responses to requests by id, whatever the order', async () => {
    const { fake, client } = setup()
    fake.answer('A', async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { n: 1 }
    })
    fake.answer('B', () => ({ n: 2 }))
    const [a, b] = await Promise.all([client.send('A'), client.send('B')])
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 2 })
    expect(fake.calls.map((c) => c.method)).toEqual(['A', 'B'])
  })

  it('passes params and sessionId through', async () => {
    const { fake, client } = setup()
    await client.send('Page.navigate', { url: 'http://x' }, 'S1')
    expect(fake.calls[0]).toEqual({ method: 'Page.navigate', params: { url: 'http://x' }, sessionId: 'S1' })
  })

  it('rejects with the message of a CDP error', async () => {
    const { fake, client } = setup()
    fake.answer('Bad', () => {
      throw new Error('no such thing')
    })
    await expect(client.send('Bad')).rejects.toThrow('no such thing')
  })

  it('dispatches events with their sessionId; unsubscribe stops them', () => {
    const { fake, client } = setup()
    const seen: unknown[] = []
    const off = client.on('Page.loadEventFired', (params, sessionId) => seen.push([params, sessionId]))
    fake.emit('Page.loadEventFired', { timestamp: 1 }, 'S9')
    off()
    fake.emit('Page.loadEventFired', { timestamp: 2 }, 'S9')
    expect(seen).toEqual([[{ timestamp: 1 }, 'S9']])
  })

  it('rejects every pending call when the connection closes, and flags closed', async () => {
    const { fake, client } = setup()
    fake.answer('Hang', () => new Promise(() => {}))
    const p1 = client.send('Hang')
    const p2 = client.send('Hang')
    fake.closeFromBrowser()
    await expect(p1).rejects.toThrow(/closed/)
    await expect(p2).rejects.toThrow(/closed/)
    await client.closedPromise
    expect(client.closed).toBe(true)
    await expect(client.send('After')).rejects.toThrow(/closed/)
  })

  it('ignores malformed frames without throwing', async () => {
    const { fake, client } = setup()
    const t = fake.transport as unknown as { deliver(text: string): void }
    for (const junk of ['not json', '42', 'null', '{"id":"x"}', '{"id":999,"result":1}', '{"method":5}']) expect(() => t.deliver(junk)).not.toThrow()
    await expect(client.send('Still.works')).resolves.toEqual({})
  })

  it('rejects a call that gets no answer in time', async () => {
    const { fake, client } = setup(20)
    fake.answer('Hang', () => new Promise(() => {}))
    await expect(client.send('Hang')).rejects.toThrow(/timed out/)
  })

  it('close() closes the transport and rejects pending calls', async () => {
    const { fake, client } = setup()
    fake.answer('Hang', () => new Promise(() => {}))
    const p = client.send('Hang')
    client.close()
    await expect(p).rejects.toThrow(/closed/)
    expect(client.closed).toBe(true)
  })
})

describe('browserWsUrl', () => {
  const ok = (url: string) => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: url }) }) as Response

  it('retries while the browser starts, then returns the url', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls < 3) throw new Error('ECONNREFUSED')
      return ok('ws://127.0.0.1:9222/devtools/browser/abc')
    }) as unknown as typeof fetch
    await expect(browserWsUrl(9222, fetchImpl, { delayMs: 1 })).resolves.toBe('ws://127.0.0.1:9222/devtools/browser/abc')
    expect(calls).toBe(3)
  })

  it('gives up after the deadline', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(browserWsUrl(9222, fetchImpl, { delayMs: 5, totalMs: 30 })).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('connectCdp', () => {
  it('rejects on a bad URL (the happy path is left to the real-browser smoke)', async () => {
    await expect(connectCdp('not a url')).rejects.toThrow()
  })
})
