#!/usr/bin/env node
import { readConfig } from './config.ts'
import { createPairingCode } from './devices.ts'

// Server command line. `claude-wrap pair --name <device>` prints a one-time code (valid 10 minutes) and the link
// that pairs a new device: open it on the phone (or paste it in the app). Same environment as the server.

const USAGE = 'usage: claude-wrap pair --name <device name>'

async function main(argv: string[]): Promise<void> {
  const [command, flag, name] = argv
  if (command !== 'pair' || flag !== '--name' || !name?.trim()) throw new Error(USAGE)
  const config = readConfig()
  const { code, expiresAt } = await createPairingCode(config.stateDir, name.trim())
  console.log(`Pairing code for "${name.trim()}" (valid until ${new Date(expiresAt).toLocaleTimeString()}):`)
  console.log(`  ${code}`)
  console.log(`  ${new URL(`/#pair=${code}`, config.publicUrl)}`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
