import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

// The backends of the desktop: the local core, plus the remote servers this computer is paired with
// (backends.json in userData). A server's device token is encrypted with safeStorage (DPAPI on Windows) and
// never leaves main: the renderer only knows ids and names.

export const APP_ORIGIN = 'app://claude-wrap'

type Stored = { id: string; name: string; url: string; token: string }
export type BackendInfo = { id: string; name: string; kind: 'local' | 'remote' }

// POSTs JSON with the app's Origin (pairing). Returns the status and the parsed body (or undefined).
function postJson(url: URL, body: unknown): Promise<{ status: number; body?: unknown }> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: APP_ORIGIN } }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk: string) => (text += chunk))
      res.on('end', () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(data)
  })
}

// The server address and the code of a pasted pairing link ("https://host:8443/#pair=CODE").
export function parsePairingLink(link: string): { url: string; code: string } | undefined {
  if (!URL.canParse(link.trim())) return undefined
  const parsed = new URL(link.trim())
  const code = /^#pair=([\w-]+)$/.exec(parsed.hash)?.[1]
  if (!code || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return undefined
  return { url: parsed.origin, code }
}

export class BackendStore {
  private readonly file: string
  private servers: Stored[]

  constructor(file: string) {
    this.file = file
    try {
      this.servers = (JSON.parse(readFileSync(file, 'utf8')) as { servers: Stored[] }).servers
    } catch {
      this.servers = []
    }
  }

  list(): BackendInfo[] {
    return [{ id: 'local', name: '', kind: 'local' }, ...this.servers.map(({ id, name }) => ({ id, name, kind: 'remote' as const }))]
  }

  // Address and token of a server (undefined for unknown ids).
  connection(id: string): { url: string; token: string } | undefined {
    const server = this.servers.find((entry) => entry.id === id)
    return server && { url: server.url, token: safeStorage.decryptString(Buffer.from(server.token, 'base64')) }
  }

  // Pairs with a server from a pasted link. Throws 'invalid_link', 'unreachable', 'pair_failed' or 'no_encryption'.
  async add(link: string, name: string): Promise<BackendInfo> {
    const target = parsePairingLink(link)
    if (!target) throw new Error('invalid_link')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('no_encryption')
    const response = await postJson(new URL('/pair', target.url), { code: target.code }).catch(() => undefined)
    if (!response) throw new Error('unreachable')
    const token = (response.body as { token?: unknown } | undefined)?.token
    if (response.status !== 200 || typeof token !== 'string') throw new Error('pair_failed')
    const server: Stored = { id: randomUUID(), name: name.trim() || new URL(target.url).hostname, url: target.url, token: safeStorage.encryptString(token).toString('base64') }
    this.servers.push(server)
    await this.save()
    return { id: server.id, name: server.name, kind: 'remote' }
  }

  // Forgets a server (its token too). The device stays listed on the server until revoked there.
  async remove(id: string): Promise<void> {
    this.servers = this.servers.filter((entry) => entry.id !== id)
    await this.save()
  }

  private async save(): Promise<void> {
    const temp = `${this.file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify({ servers: this.servers }, null, 2), { mode: 0o600 })
    await rename(temp, this.file)
  }
}
