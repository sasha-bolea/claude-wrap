import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { revokeCascade } from '@athome/protocol'

// Paired devices of the server (devices.json, written only by the server) and one-time pairing codes
// (pairing/<sha256(code)>.json, written by the `claude-wrap pair` CLI or by devices.pairStart, consumed once).
// A device proves itself with a 32-byte random token; only its SHA-256 is stored. The token itself never
// appears in a QR code or link: those carry the short-lived code.

const CODE_TTL_MS = 10 * 60_000
const FILE_MODE = 0o600
const DIR_MODE = 0o700

// The browser's PushSubscription of a device (Web Push endpoint and keys).
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }
export type Device = { deviceId: string; name: string; tokenHash: string; createdBy?: string; createdAt: number; lastSeenAt?: number; push?: PushTarget }
type Pairing = { name: string; createdBy?: string; expiresAt: number }

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const randomToken = () => randomBytes(32).toString('base64url')

// Writes a file atomically (temp file + rename), readable by the owner only.
async function writeAtomic(file: string, data: string): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, data, { mode: FILE_MODE })
  await rename(temp, file)
}

// Creates a one-time pairing code for a new device called name (createdBy: the device that asked, if any).
// The file is created exclusively, so a code is never written twice. Returns the code and its expiry.
export async function createPairingCode(stateDir: string, name: string, createdBy?: string): Promise<{ code: string; expiresAt: number }> {
  const dir = join(stateDir, 'pairing')
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  const code = randomBytes(16).toString('base64url')
  const pairing: Pairing = { name, createdBy, expiresAt: Date.now() + CODE_TTL_MS }
  await writeFile(join(dir, `${sha256(code)}.json`), JSON.stringify(pairing), { flag: 'wx', mode: FILE_MODE })
  return { code, expiresAt: pairing.expiresAt }
}

export class DeviceStore {
  private readonly stateDir: string
  private devices: Device[]
  private saving: Promise<unknown> = Promise.resolve()

  private constructor(stateDir: string, devices: Device[]) {
    this.stateDir = stateDir
    this.devices = devices
  }

  // Loads devices.json (missing → no devices yet).
  static async load(stateDir: string): Promise<DeviceStore> {
    await mkdir(stateDir, { recursive: true, mode: DIR_MODE })
    const text = await readFile(join(stateDir, 'devices.json'), 'utf8').catch(() => '{"devices":[]}')
    return new DeviceStore(stateDir, (JSON.parse(text) as { devices: Device[] }).devices)
  }

  list(): Device[] {
    return [...this.devices]
  }

  // The device a token belongs to, or undefined. Compared in constant time against every stored hash.
  authenticate(token: string): Device | undefined {
    const hash = Buffer.from(sha256(token), 'hex')
    const device = this.devices.find((candidate) => timingSafeEqual(Buffer.from(candidate.tokenHash, 'hex'), hash))
    if (device) {
      device.lastSeenAt = Date.now()
      void this.save()
    }
    return device
  }

  createPairing(name: string, createdBy?: string): Promise<{ code: string; expiresAt: number }> {
    return createPairingCode(this.stateDir, name, createdBy)
  }

  // When a pairing code expires, without using it; undefined for an unknown, used or expired code.
  async pairingExpiry(code: string): Promise<number | undefined> {
    const text = await readFile(join(this.stateDir, 'pairing', `${sha256(code)}.json`), 'utf8').catch(() => undefined)
    const pairing = text ? (JSON.parse(text) as Pairing) : undefined
    return pairing && pairing.expiresAt >= Date.now() ? pairing.expiresAt : undefined
  }

  // Consumes a pairing code: the file is removed whatever happens next. Returns the new device's id and token,
  // or undefined for an unknown or expired code.
  async completePairing(code: string): Promise<{ deviceId: string; token: string } | undefined> {
    const file = join(this.stateDir, 'pairing', `${sha256(code)}.json`)
    const text = await readFile(file, 'utf8').catch(() => undefined)
    // Whoever removes the file owns the code: two uses at the same time pair one device only.
    if (!text || !(await unlink(file).then(() => true, () => false))) return undefined
    const pairing = JSON.parse(text) as Pairing
    if (pairing.expiresAt < Date.now()) return undefined
    const token = randomToken()
    const device: Device = { deviceId: randomUUID(), name: pairing.name, tokenHash: sha256(token), createdBy: pairing.createdBy, createdAt: Date.now() }
    this.devices.push(device)
    await this.save()
    return { deviceId: device.deviceId, token }
  }

  // Stores (or, with undefined, removes) the push subscription of a device.
  async setPush(deviceId: string, push: PushTarget | undefined): Promise<void> {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId)
    if (!device) return
    device.push = push
    await this.save()
  }

  // Revokes a device and, recursively, the devices and pending codes it created (revokeCascade), except the device
  // asking (requesterId) and what it created; the asker loses createdBy when its creator is removed. Returns the
  // revoked ids (empty when the device does not exist).
  async revoke(deviceId: string, requesterId?: string): Promise<string[]> {
    if (!this.devices.some((device) => device.deviceId === deviceId)) return []
    const revoked = revokeCascade(this.devices, deviceId, requesterId)
    this.devices = this.devices.filter((device) => !revoked.has(device.deviceId))
    for (const device of this.devices) if (device.createdBy && revoked.has(device.createdBy)) device.createdBy = undefined
    await Promise.all([this.save(), this.dropCodesOf(revoked)])
    return [...revoked]
  }

  // Deletes pending pairing codes created by revoked devices.
  private async dropCodesOf(revoked: Set<string>): Promise<void> {
    const dir = join(this.stateDir, 'pairing')
    for (const name of await readdir(dir).catch(() => [])) {
      const pairing = JSON.parse(await readFile(join(dir, name), 'utf8').catch(() => '{}')) as Partial<Pairing>
      if (pairing.createdBy && revoked.has(pairing.createdBy)) await unlink(join(dir, name)).catch(() => undefined)
    }
  }

  // Saves devices.json; saves are serialized so an older state never overwrites a newer one.
  private save(): Promise<unknown> {
    const data = JSON.stringify({ devices: this.devices }, null, 2)
    this.saving = this.saving.then(() => writeAtomic(join(this.stateDir, 'devices.json'), data)).catch(() => undefined)
    return this.saving
  }
}
