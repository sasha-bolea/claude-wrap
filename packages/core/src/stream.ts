import { randomUUID } from 'node:crypto'
import type { CoreFrame, EvFrame, ResetFrame, StreamPosition, TabEvent, TabSnapshot, TerminalEvent, TerminalSnapshot, WorkspaceEvent, WorkspaceSnapshot } from '@athome/protocol'

export type Send = (frame: CoreFrame) => void
export type StreamEvent = TabEvent | WorkspaceEvent | TerminalEvent
export type StreamSnapshot = TabSnapshot | WorkspaceSnapshot | TerminalSnapshot
export type RingLimits = { events: number; bytes: number }

export const DEFAULT_RING: RingLimits = { events: 2000, bytes: 4 * 1024 * 1024 }

type Entry = { seq: number; ev: StreamEvent; bytes: number }

// One numbered event stream (workspace, tab:<id> or terminal:<id>) with its epoch, a bounded ring of recent events for
// replay, and its live subscribers. Events must never be mutated after emit: the ring keeps references.
export class Stream {
  epoch = randomUUID()
  seq = 0
  private ring: Entry[] = []
  private ringBytes = 0
  private readonly subscribers = new Set<Send>()
  readonly name: string
  private readonly snapshot: () => StreamSnapshot
  private readonly limits: RingLimits

  // name: stream name; snapshot: current full state (may emit pending events first); limits: ring bounds.
  constructor(name: string, snapshot: () => StreamSnapshot, limits: RingLimits = DEFAULT_RING) {
    this.name = name
    this.snapshot = snapshot
    this.limits = limits
  }

  // Numbers an event, keeps it in the ring and sends it to every subscriber.
  emit(ev: StreamEvent): void {
    this.seq++
    const entry = { seq: this.seq, ev, bytes: JSON.stringify(ev).length }
    this.ring.push(entry)
    this.ringBytes += entry.bytes
    while (this.ring.length > this.limits.events || this.ringBytes > this.limits.bytes) this.ringBytes -= this.ring.shift()!.bytes
    const frame = this.evFrame(entry)
    for (const send of this.subscribers) send(frame)
  }

  // Adds a subscriber: replays what it missed when possible, otherwise sends a reset. position: where it was.
  attach(send: Send, position?: StreamPosition): void {
    const replay = position && this.replayAfter(position)
    if (replay) replay.forEach(send)
    else send(this.resetFrame())
    this.subscribers.add(send)
  }

  detach(send: Send): void {
    this.subscribers.delete(send)
  }

  // The state was rebuilt: new epoch, empty ring, reset pushed to live subscribers (seq keeps increasing).
  rebuild(): void {
    this.epoch = randomUUID()
    this.ring = []
    this.ringBytes = 0
    const frame = this.resetFrame()
    for (const send of this.subscribers) send(frame)
  }

  // Events after position, or undefined when they cannot all be replayed (other epoch, ahead, out of the ring).
  private replayAfter({ epoch, lastSeq }: StreamPosition): EvFrame[] | undefined {
    if (epoch !== this.epoch || lastSeq > this.seq) return undefined
    const missed = this.ring.filter((entry) => entry.seq > lastSeq)
    if (missed.length !== this.seq - lastSeq) return undefined
    return missed.map((entry) => this.evFrame(entry))
  }

  private evFrame(entry: Entry): EvFrame {
    return { t: 'ev', stream: this.name, epoch: this.epoch, seq: entry.seq, ev: entry.ev }
  }

  // The snapshot is taken first: taking it may emit pending events, and the reset must carry the seq after them.
  private resetFrame(): ResetFrame {
    const snapshot = this.snapshot()
    return { t: 'reset', stream: this.name, epoch: this.epoch, seq: this.seq, snapshot }
  }
}
