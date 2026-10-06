import { describe, expect, it } from 'vitest'
import type { CoreFrame, TabEvent, TabSnapshot } from '@athome/protocol'
import { Stream } from './stream.ts'

const event = (n: number): TabEvent => ({ type: 'item.text', itemId: 'x', append: String(n) })
const snapshot = (): TabSnapshot => ({ kind: 'tab', items: [], hasMore: false, requests: [] })

// Subscriber that records the frames it receives.
function collector() {
  const frames: CoreFrame[] = []
  return { frames, send: (frame: CoreFrame) => frames.push(frame), kinds: () => frames.map((frame) => frame.t) }
}

describe('Stream', () => {
  it('numbers events and delivers them to subscribers', () => {
    const stream = new Stream('tab:a', snapshot)
    const subscriber = collector()
    stream.attach(subscriber.send)
    stream.emit(event(1))
    stream.emit(event(2))
    expect(subscriber.frames).toEqual([
      { t: 'reset', stream: 'tab:a', epoch: stream.epoch, seq: 0, snapshot: snapshot() },
      { t: 'ev', stream: 'tab:a', epoch: stream.epoch, seq: 1, ev: event(1) },
      { t: 'ev', stream: 'tab:a', epoch: stream.epoch, seq: 2, ev: event(2) }
    ])
  })

  it('replays only the missed events when epoch and seq are still in the ring', () => {
    const stream = new Stream('tab:a', snapshot)
    for (let n = 1; n <= 5; n++) stream.emit(event(n))
    const subscriber = collector()
    stream.attach(subscriber.send, { epoch: stream.epoch, lastSeq: 3 })
    expect(subscriber.frames.map((frame) => (frame.t === 'ev' ? frame.seq : frame.t))).toEqual([4, 5])
  })

  it('resets when the epoch differs, or the client is ahead of the stream', () => {
    const stream = new Stream('tab:a', snapshot)
    stream.emit(event(1))
    const stale = collector()
    stream.attach(stale.send, { epoch: 'another-epoch', lastSeq: 1 })
    const ahead = collector()
    stream.attach(ahead.send, { epoch: stream.epoch, lastSeq: 7 })
    expect(stale.kinds()).toEqual(['reset'])
    expect(ahead.kinds()).toEqual(['reset'])
  })

  it('resets when the missed events fell out of the ring (count or bytes)', () => {
    const byCount = new Stream('tab:a', snapshot, { events: 3, bytes: 1_000_000 })
    for (let n = 1; n <= 6; n++) byCount.emit(event(n))
    const late = collector()
    byCount.attach(late.send, { epoch: byCount.epoch, lastSeq: 1 })
    expect(late.kinds()).toEqual(['reset'])

    const byBytes = new Stream('tab:b', snapshot, { events: 1000, bytes: 200 })
    for (let n = 1; n <= 20; n++) byBytes.emit(event(n))
    const lateToo = collector()
    byBytes.attach(lateToo.send, { epoch: byBytes.epoch, lastSeq: 2 })
    expect(lateToo.kinds()).toEqual(['reset'])
  })

  it('rebuild mints a new epoch and pushes a reset to live subscribers, seq keeps increasing', () => {
    const stream = new Stream('tab:a', snapshot)
    const subscriber = collector()
    stream.attach(subscriber.send)
    stream.emit(event(1))
    const oldEpoch = stream.epoch
    stream.rebuild()
    stream.emit(event(2))
    expect(stream.epoch).not.toBe(oldEpoch)
    expect(subscriber.frames.slice(2)).toEqual([
      expect.objectContaining({ t: 'reset', epoch: stream.epoch, seq: 1 }),
      expect.objectContaining({ t: 'ev', epoch: stream.epoch, seq: 2 })
    ])
  })

  it('stops delivering after detach', () => {
    const stream = new Stream('tab:a', snapshot)
    const subscriber = collector()
    stream.attach(subscriber.send)
    stream.detach(subscriber.send)
    stream.emit(event(1))
    expect(subscriber.kinds()).toEqual(['reset'])
  })
})
