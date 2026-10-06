import { randomUUID } from 'node:crypto'
import type { Image, Item, Request, TabEvent, TabSnapshot } from '@athome/protocol'
import type { TranscriptWriter } from './normalize.ts'
import { Stream, type RingLimits } from './stream.ts'

export type TranscriptOptions = { coalesceMs: number; snapshotItems: number; ring: RingLimits }

// Items of one tab plus its `tab:<id>` stream. The delta coalescer is the only writer of streamed text:
// deltas wait in `pending` and reach the items only when their item.text event gets a seq, and every other
// event or snapshot flushes them first, so a snapshot and its seq are always consistent.
// Items are replaced, never mutated (the stream ring keeps references to emitted items).
// Image bytes live in a blob store next to the items, which only carry references (`blob.get`).
export class Transcript implements TranscriptWriter {
  readonly stream: Stream
  private items: Item[] = []
  private readonly index = new Map<string, number>()
  private readonly pending = new Map<string, string>()
  private readonly blobs = new Map<string, Image>()
  private timer?: ReturnType<typeof setTimeout>
  private silent = false
  private readonly options: TranscriptOptions
  private readonly requests: () => Request[]

  // name: stream name; requests: the tab's open requests (part of the snapshot); options: timings and bounds.
  constructor(name: string, requests: () => Request[], options: TranscriptOptions) {
    this.options = options
    this.requests = requests
    this.stream = new Stream(name, () => this.snapshot(), options.ring)
  }

  get(itemId: string): Item | undefined {
    const position = this.index.get(itemId)
    return position === undefined ? undefined : this.items[position]
  }

  has(itemId: string): boolean {
    return this.index.has(itemId)
  }

  // Adds an item (an existing id becomes an update).
  add(item: Item): void {
    if (this.index.has(item.itemId)) return this.update(item)
    this.index.set(item.itemId, this.items.length)
    this.items.push(item)
    this.emit({ type: 'item.added', item })
  }

  // Replaces an item; its pending deltas are flushed first so the update is the last word.
  update(item: Item): void {
    const position = this.index.get(item.itemId)
    if (position === undefined) return this.add(item)
    this.flush()
    this.items[position] = item
    this.emit({ type: 'item.updated', item })
  }

  // Stores an image; returns its id for the item's image reference.
  addBlob(image: Image): string {
    const imageId = randomUUID()
    this.blobs.set(imageId, image)
    return imageId
  }

  blob(imageId: string): Image | undefined {
    return this.blobs.get(imageId)
  }

  // Queues streamed text for an item; it is applied and sent at the next flush (every coalesceMs).
  appendText(itemId: string, text: string): void {
    if (!text || !this.index.has(itemId)) return
    this.pending.set(itemId, (this.pending.get(itemId) ?? '') + text)
    this.timer ??= setTimeout(() => this.flush(), this.options.coalesceMs)
  }

  // Sends a tab event after flushing pending text (keeps order between text and everything else).
  emit(ev: TabEvent): void {
    if (this.silent) return
    if (ev.type !== 'item.text') this.flush()
    this.stream.emit(ev)
  }

  // Applies pending deltas to the items and sends them as item.text events.
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    for (const [itemId, append] of this.pending) {
      const position = this.index.get(itemId)!
      const item = this.items[position]!
      if ('text' in item) this.items[position] = { ...item, text: item.text + append }
      this.emit({ type: 'item.text', itemId, append })
    }
    this.pending.clear()
  }

  // Runs writes without sending events (history load), then publishes the result as a new epoch.
  rebuildWith(write: () => void): void {
    this.silent = true
    try {
      write()
    } finally {
      this.silent = false
    }
    this.stream.rebuild()
  }

  // Replaces every item with what write() produces (history load), published as a new epoch.
  rebuildFrom(write: () => void): void {
    this.rebuildWith(() => {
      this.pending.clear()
      this.blobs.clear()
      this.items = []
      this.index.clear()
      write()
    })
  }

  // Empties the transcript (conversation_reset, restart): new epoch, empty snapshot pushed.
  clear(): void {
    this.rebuildFrom(() => undefined)
  }

  // Items before beforeItemId, at most limit of them. Returns them and whether even older ones exist.
  history(beforeItemId: string, limit: number): { items: Item[]; hasMore: boolean } {
    const end = this.index.get(beforeItemId) ?? 0
    const start = Math.max(0, end - limit)
    return { items: this.items.slice(start, end), hasMore: start > 0 }
  }

  dispose(): void {
    clearTimeout(this.timer)
  }

  // Last snapshotItems items + open requests, after flushing pending text.
  private snapshot(): TabSnapshot {
    this.flush()
    const { snapshotItems } = this.options
    return { kind: 'tab', items: this.items.slice(-snapshotItems), hasMore: this.items.length > snapshotItems, requests: this.requests() }
  }
}
