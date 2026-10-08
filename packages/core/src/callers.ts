import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// The callers of the terminal socket that have a key (Petra): a key names its caller, and a caller acts only inside
// its approved plans (plans.ts). Keys are made and revoked by a person at a terminal (the athome command, interactive);
// only their hashes are kept, in <stateDir>/callers.json.

type Caller = { name: string; keyHash: string; createdAt: number }
type Saved = { callers: Caller[] }

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex')

export class CallerStore {
  private callers: Caller[] = []
  private readonly file?: JsonFile<Saved>
  readonly loaded: Promise<void>

  // file: where the callers are saved (absent: memory only, tests).
  constructor(file?: string) {
    this.file = file ? new JsonFile<Saved>(file, 0o600) : undefined
    this.loaded = (this.file?.read() ?? Promise.resolve(undefined)).then((saved) => void (this.callers = saved?.callers ?? []))
  }

  // Makes a caller's key (shown once). invalid_args when the name is taken.
  async create(name: string): Promise<string> {
    if (this.callers.some((caller) => caller.name === name)) throw new CoreError('invalid_args', `a caller named ${name} exists: revoke it first`)
    const key = randomBytes(32).toString('base64url')
    this.callers.push({ name, keyHash: hashOf(key), createdAt: Date.now() })
    await this.save()
    return key
  }

  list(): { name: string; createdAt: number }[] {
    return this.callers.map(({ name, createdAt }) => ({ name, createdAt }))
  }

  // Takes a caller's key back. not_found when there is no such caller.
  async revoke(name: string): Promise<void> {
    if (!this.callers.some((caller) => caller.name === name)) throw new CoreError('not_found', `no caller named ${name}`)
    this.callers = this.callers.filter((caller) => caller.name !== name)
    await this.save()
  }

  // The caller a key belongs to; undefined for an unknown or revoked key.
  authenticate(key: string): string | undefined {
    const given = Buffer.from(hashOf(key))
    return this.callers.find((caller) => timingSafeEqual(given, Buffer.from(caller.keyHash)))?.name
  }

  private save(): Promise<void> {
    return this.file?.save({ callers: this.callers }) ?? Promise.resolve()
  }
}
