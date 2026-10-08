import { CoreError, type Connection, type HostCommands } from '@athome/core'
import type { DeviceStore } from './devices.ts'

// The device behind a connection (every server connection is authenticated, so it has one).
function deviceOf(devices: DeviceStore, connection: Connection) {
  const device = devices.list().find((candidate) => candidate.deviceId === connection.deviceId)
  if (!device) throw new CoreError('unauthorized', 'unknown device')
  return device
}

// devices.* and push.* answered by the server for core (core forwards them through CoreConfig.hostCommands).
// disconnect: closes the sockets of revoked devices; publicKey: the server's VAPID public key.
export function deviceCommands(devices: DeviceStore, disconnect: (deviceIds: string[]) => void, publicKey: string): HostCommands {
  return {
    'push.config': (_args, connection) => ({ publicKey, subscribed: Boolean(deviceOf(devices, connection).push) }),
    'push.subscribe': async (subscription, connection) => (await devices.setPush(deviceOf(devices, connection).deviceId, subscription), {}),
    'push.unsubscribe': async (_args, connection) => (await devices.setPush(deviceOf(devices, connection).deviceId, undefined), {}),
    'devices.list': (_args, connection) => ({
      devices: devices.list().map(({ deviceId, name, createdAt, lastSeenAt, createdBy }) => ({ deviceId, name, createdAt, lastSeenAt, createdBy, current: deviceId === connection.deviceId }))
    }),
    'devices.pairStart': ({ name }, connection) => devices.createPairing(name, connection.deviceId),
    'devices.revoke': async ({ deviceId }, connection) => {
      if (deviceId === connection.deviceId) throw new CoreError('invalid_args', 'a device cannot revoke itself')
      const revoked = await devices.revoke(deviceId, connection.deviceId)
      if (!revoked.length) throw new CoreError('not_found', 'no such device')
      disconnect(revoked)
      return {}
    }
  }
}
