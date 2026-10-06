import { join } from 'node:path'
import { createCore, type CoreConfig } from '@athome/core'
import { allowedPeers, readConfig } from './config.ts'
import { deviceCommands } from './deviceCommands.ts'
import { DeviceStore } from './devices.ts'
import { PushService } from './push.ts'
import { startServer, type RunningServer } from './server.ts'
import { loadStaticFiles } from './staticFiles.ts'

// Entry of the remote server (`npm run dev:server`, systemd unit in Phase 3d): one core confined to the root,
// served over HTTP + WebSocket. SIGTERM closes every session first (the unit gives it 15 s).

async function main(): Promise<void> {
  const config = readConfig()
  const devices = await DeviceStore.load(config.stateDir)
  const push = await PushService.load(config.stateDir, config.publicUrl.origin, devices)
  let server: RunningServer | undefined
  const sdk: CoreConfig['sdk'] = config.fakeSdk ? (await import('@athome/core/testing')).createScriptedSdk() : undefined
  const core = createCore({
    backendId: 'server',
    backendKind: 'remote',
    sdk,
    stateDir: config.stateDir,
    activityFile: join(config.stateDir, 'activity.json'),
    allowedRoots: [config.root],
    hostCommands: deviceCommands(devices, (deviceIds) => server?.disconnect(deviceIds), push.publicKey),
    notifier: (notice) => void push.notify(notice).catch((error: unknown) => console.log(`push failed: ${String(error)}`))
  })
  await core.ready
  const { origins, hosts } = allowedPeers(config)
  server = await startServer({
    attach: core.attach,
    devices,
    port: config.port,
    host: config.host,
    allowedOrigins: origins,
    allowedHosts: hosts,
    tailscaleLogin: config.tailscaleLogin,
    files: await loadStaticFiles(config.staticDir),
    socketOrigin: `wss://${config.publicUrl.host}`
  })
  console.log(`AtHome server on ${config.host}:${server.port}, root ${config.root}, ${devices.list().length} paired devices`)

  const stop = async () => {
    await core.closeAll()
    await server?.close()
    process.exit(0)
  }
  process.once('SIGTERM', () => void stop())
  process.once('SIGINT', () => void stop())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
