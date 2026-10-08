import { createServer } from 'node:http'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { WebSocketServer } from 'ws'
import type { Core } from '@athome/core'
import { MAX_PAYLOAD, socketChannel } from './server.ts'

// The terminal socket: how the athome command reaches the server's core. A Unix socket (WebSocket at /ws) in a folder
// only the server's user can open (0700, the socket 0600): the file system is the authentication, so no token. Core
// treats its connections as the terminal (identity terminal): the action API and the folder list only, under the
// terminal policy (core actions.ts).

export type TerminalSocket = { close(): Promise<void> }

// The identity of every connection of the socket.
const TERMINAL = { deviceId: 'terminal', label: 'terminal', terminal: true } as const

// Prepares the socket's folder (created 0700, tightened if it exists) and removes a socket file a dead server left.
// Throws when something other than a socket sits at path.
async function prepare(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700)
  const existing = await lstat(path).catch(() => undefined)
  if (!existing) return
  if (!existing.isSocket()) throw new Error(`${path} exists and is not a socket`)
  await unlink(path)
}

// Starts the terminal socket at path. attach: core's attach. Returns its close function.
export async function startTerminalSocket(path: string, attach: Core['attach']): Promise<TerminalSocket> {
  await prepare(path)
  const http = createServer((_req, res) => void res.writeHead(404).end())
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PAYLOAD })
  wss.on('connection', (socket) => {
    socket.on('error', () => socket.terminate())
    attach(socketChannel(socket).channel, TERMINAL)
  })
  await new Promise<void>((resolve, reject) => (http.once('error', reject), http.listen(path, resolve)))
  await chmod(path, 0o600)
  return {
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate()
        http.close(() => resolve())
      })
  }
}
