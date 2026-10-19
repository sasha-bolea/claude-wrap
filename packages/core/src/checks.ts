import type { Checks } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// The ticks of every session (key: the CLI session id) in <stateDir>/checks.json; memory only without a state folder.
// Keyed by session, not tab: a session closed and opened again keeps them, a fork (a new session) starts without.
export class CheckStore {
  private readonly file?: JsonFile<Record<string, Checks>>
  private data?: Promise<Record<string, Checks>>

  constructor(file?: string) {
    this.file = file ? new JsonFile(file) : undefined
  }

  // The ticks of a session (a copy).
  async list(sessionId: string): Promise<Checks> {
    return structuredClone((await this.load())[sessionId] ?? {})
  }

  // Ticks (checked true) or unticks a box: index is its place among the boxes of the item's text. An item id that
  // names a property every object has (`__proto__`, `constructor`…) is no message: refused, it would reach the prototype.
  async set(sessionId: string, itemId: string, index: number, checked: boolean): Promise<void> {
    if (itemId in {}) throw new CoreError('not_found', 'no such message')
    const data = await this.load()
    const item = ((data[sessionId] ??= {})[itemId] ??= {})
    item[index] = checked
    await this.file?.save(data)
  }

  // A stored session was deleted: its ticks go with it.
  async drop(sessionId: string): Promise<void> {
    const data = await this.load()
    if (!(sessionId in data)) return
    delete data[sessionId]
    await this.file?.save(data)
  }

  // Reads the file once.
  private load(): Promise<Record<string, Checks>> {
    this.data ??= this.file ? this.file.read().then((read) => read ?? {}) : Promise.resolve({})
    return this.data
  }
}
