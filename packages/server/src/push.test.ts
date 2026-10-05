// Web Push, Phase 3b. User stories: with the phone locked I get a push when Claude asks something or finishes;
// not on a device where the app is on screen; the push says what happened, never what was written; a phone that
// removed the app stops receiving them.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore } from '@claude-wrap/core'
import { createFakeSdk } from '@claude-wrap/core/testing'
import { PROTOCOL_VERSION, createChannelPair } from '@claude-wrap/protocol'
import { deviceCommands } from './deviceCommands.ts'
import { DeviceStore, createPairingCode, type PushTarget } from './devices.ts'
import { PushService, type PushSender } from './push.ts'

const target = (name: string): PushTarget => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'p', auth: 'a' } })

// A device store with paired devices, each optionally subscribed. Returns the store and the device ids by name.
async function storeWith(names: string[]) {
  const stateDir = mkdtempSync(join(tmpdir(), 'cw-push-'))
  const devices = await DeviceStore.load(stateDir)
  const ids: Record<string, string> = {}
  for (const name of names) {
    const { code } = await createPairingCode(stateDir, name)
    ids[name] = (await devices.completePairing(code))!.deviceId
  }
  return { stateDir, devices, ids }
}

describe('web push', () => {
  it('pushes to subscribed devices that are not looking, with title, kind, tab and the counts only', async () => {
    const { stateDir, devices, ids } = await storeWith(['phone', 'tablet', 'laptop'])
    await devices.setPush(ids.phone!, target('phone'))
    await devices.setPush(ids.tablet!, target('tablet'))
    const sent: { endpoint: string; payload: string }[] = []
    const sender: PushSender = async (to, payload) => (sent.push({ endpoint: to.endpoint, payload }), { gone: false })
    const push = await PushService.load(stateDir, 'https://server.example', devices, sender, () => undefined)
    await push.notify({ kind: 'request', tabId: 't1', title: 'Pagination', detail: 'Bash: rm -rf secret', waiting: 2, finished: 1, visibleDevices: [ids.tablet!] })
    expect(sent).toEqual([{ endpoint: 'https://push.example/phone', payload: JSON.stringify({ kind: 'request', title: 'Pagination', tabId: 't1', waiting: 2, finished: 1 }) }])
    expect(JSON.parse(readFileSync(join(stateDir, 'vapid.json'), 'utf8'))).toMatchObject({ publicKey: push.publicKey, privateKey: expect.any(String) })
  })

  it('forgets a subscription the push service reports gone', async () => {
    const { stateDir, devices, ids } = await storeWith(['phone'])
    await devices.setPush(ids.phone!, target('phone'))
    const push = await PushService.load(stateDir, 'https://server.example', devices, async () => ({ gone: true }), () => undefined)
    await push.notify({ kind: 'turnFinished', tabId: 't1', title: 'x', waiting: 0, finished: 1 })
    expect(devices.list()[0]?.push).toBeUndefined()
  })

  it('a device subscribes and unsubscribes through the protocol; push.config says whether it is subscribed', async () => {
    const { devices, ids } = await storeWith(['phone'])
    const core = createCore({ backendId: 'server', backendKind: 'remote', sdk: createFakeSdk(), hostCommands: deviceCommands(devices, () => undefined, 'PUBLIC') })
    // Attached as the paired device, the way the server does after checking the token.
    const [clientEnd, coreEnd] = createChannelPair()
    const replies: { id: string; result?: unknown }[] = []
    clientEnd.onMessage((frame) => (frame as { t: string }).t === 'reply' && replies.push(frame as { id: string; result?: unknown }))
    core.attach(coreEnd, { deviceId: ids.phone!, label: 'phone' })
    clientEnd.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'pwa', visible: true, resume: {} })
    // One command at a time, as a client does, each answer matched by its command id.
    const command = async (n: number, name: string, args: object) => {
      const id = `00000000-0000-4000-8000-00000000000${n}`
      clientEnd.send({ t: 'cmd', id, name, args })
      while (!replies.some((reply) => reply.id === id)) await new Promise((resolve) => setTimeout(resolve, 5))
      return replies.find((reply) => reply.id === id)!.result
    }
    expect(await command(1, 'push.subscribe', target('phone'))).toEqual({})
    expect(await command(2, 'push.config', {})).toEqual({ publicKey: 'PUBLIC', subscribed: true })
    expect(await command(3, 'push.unsubscribe', {})).toEqual({})
    expect(await command(4, 'push.config', {})).toEqual({ publicKey: 'PUBLIC', subscribed: false })
    await core.closeAll()
  })
})
