import { readFile, rename, writeFile } from 'node:fs/promises'

// A JSON file saved whole, in order, atomically (temp file + rename): a reader never sees half of it.
export class JsonFile<T> {
  private readonly file: string
  private writes: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  // The saved data; undefined when the file is missing or unreadable.
  async read(): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as T
    } catch {
      return undefined
    }
  }

  // Saves data after the saves before it. Best effort: a failed save is repaired by the next one.
  save(data: T): Promise<void> {
    const temp = `${this.file}.tmp`
    const body = JSON.stringify(data)
    this.writes = this.writes.then(() => writeFile(temp, body)).then(() => rename(temp, this.file)).catch(() => undefined)
    return this.writes
  }
}
