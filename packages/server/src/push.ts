import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import webPush from 'web-push'
import type { Notice } from '@claude-wrap/core'
import type { DeviceStore, PushTarget } from './devices.ts'

// Web Push to paired devices (iOS: only to the installed PWA, 16.4+). The VAPID keypair is created at the first
// start (vapid.json, owner-only). A notice goes to every device with a subscription and no client on screen.
// The payload carries only the session title, the kind of event, the tab and the counts of chats waiting / finished:
// push services (Apple, Google) see it, so never message text, tool input or errors. The service worker turns it into
// words, in one notification for every chat.

type Vapid = { publicKey: string; privateKey: string }
// Delivers one payload; gone = the subscription no longer exists (expired, app removed) and must be forgotten.
export type PushSender = (target: PushTarget, payload: string, vapid: Vapid & { subject: string }) => Promise<{ gone: boolean }>

const TTL_SECONDS = 3600

// Sends through the browser vendor's push service. 404/410 mean the subscription is gone.
const sendWebPush: PushSender = async (target, payload, { subject, publicKey, privateKey }) => {
  try {
    await webPush.sendNotification(target, payload, { vapidDetails: { subject, publicKey, privateKey }, TTL: TTL_SECONDS })
    return { gone: false }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    return { gone: status === 404 || status === 410 }
  }
}

// Loads the VAPID keypair, creating and saving it on the first start.
async function loadVapid(stateDir: string): Promise<Vapid> {
  const file = join(stateDir, 'vapid.json')
  const saved = await readFile(file, 'utf8').catch(() => undefined)
  if (saved) return JSON.parse(saved) as Vapid
  const keys = webPush.generateVAPIDKeys()
  await writeFile(`${file}.tmp`, JSON.stringify(keys), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
  return keys
}

export class PushService {
  readonly publicKey: string
  private readonly vapid: Vapid & { subject: string }
  private readonly devices: DeviceStore
  private readonly send: PushSender
  private readonly log: (line: string) => void

  private constructor(vapid: Vapid, subject: string, devices: DeviceStore, send: PushSender, log: (line: string) => void) {
    this.publicKey = vapid.publicKey
    this.vapid = { ...vapid, subject }
    this.devices = devices
    this.send = send
    this.log = log
  }

  // subject: the server's https URL (VAPID contact). send: replaced in tests.
  static async load(stateDir: string, subject: string, devices: DeviceStore, send: PushSender = sendWebPush, log = (line: string) => console.log(line)): Promise<PushService> {
    return new PushService(await loadVapid(stateDir), subject, devices, send, log)
  }

  // Pushes a notice to the devices that are not looking; forgets subscriptions the push service reports gone.
  async notify(notice: Notice): Promise<void> {
    const payload = JSON.stringify({ kind: notice.kind, title: notice.title, tabId: notice.tabId, waiting: notice.waiting, finished: notice.finished })
    const visible = new Set(notice.visibleDevices ?? [])
    const targets = this.devices.list().filter((device) => device.push && !visible.has(device.deviceId))
    await Promise.all(
      targets.map(async (device) => {
        const { gone } = await this.send(device.push!, payload, this.vapid)
        if (!gone) return
        this.log(`push subscription gone: ${device.name}`)
        await this.devices.setPush(device.deviceId, undefined)
      })
    )
  }
}
