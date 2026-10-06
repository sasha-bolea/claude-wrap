import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { Connection, openWebSocket } from '@athome/client'
import { createCore, type Core } from '@athome/core'
import { createScriptedSdk } from '@athome/core/testing'
import { DeviceStore, createPairingCode, deviceCommands, startServer, type RunningServer } from '@athome/server'

// A remote backend for desktop e2e: the real server in the test process (scripted fake SDK), accepting the
// desktop's Origin. root holds a `project` folder.

export type TestServer = { url: string; root: string; core: Core; server: RunningServer; pairingLink(name?: string): Promise<string>; client(name: string): Promise<Connection>; stop(): Promise<void> }

export async function startTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), 'cw-desk-root-'))
  mkdirSync(join(root, 'project'))
  const stateDir = mkdtempSync(join(tmpdir(), 'cw-desk-server-'))
  const devices = await DeviceStore.load(stateDir)
  let server: RunningServer | undefined
  const core = createCore({ backendId: 'server', backendKind: 'remote', sdk: createScriptedSdk({ wordDelayMs: 20 }), stateDir, allowedRoots: [root], hostCommands: deviceCommands(devices, (ids) => server?.disconnect(ids), 'KEY') })
  const hosts: string[] = []
  server = await startServer({ attach: core.attach, devices, port: 0, allowedHosts: hosts, allowedOrigins: ['app://claude-wrap'], log: () => undefined })
  const url = `http://127.0.0.1:${server.port}`
  hosts.push(`127.0.0.1:${server.port}`)
  const connections: Connection[] = []
  return {
    url,
    root,
    core,
    server,
    // A pasted pairing link, as `claude-wrap pair` prints it.
    pairingLink: async (name = 'pc') => `${url}/#pair=${(await createPairingCode(stateDir, name)).code}`,
    // Another paired device, connected from the test (to act on the server while the desktop looks elsewhere).
    client: async (name) => {
      const { code } = await createPairingCode(stateDir, name)
      const { token } = (await devices.completePairing(code))!
      const connection = new Connection({
        openChannel: () => openWebSocket(`ws://127.0.0.1:${server!.port}/ws`, (target) => new WebSocket(target, { headers: { Origin: 'app://claude-wrap' } })),
        clientId: name,
        token
      })
      connections.push(connection)
      connection.start()
      return connection
    },
    stop: async () => {
      connections.forEach((connection) => connection.close())
      await core.closeAll()
      await server!.close()
    }
  }
}
