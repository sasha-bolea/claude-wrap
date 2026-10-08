#!/usr/bin/env node
import { runCli } from './athomeCli.ts'
import { terminalSocketPath } from './config.ts'

// Entry of the athome command (installed as ~/.local/bin/athome by deploy/install.sh): see athomeCli.ts. A person types
// in this terminal when both stdin and stdout are one; CLAUDE_WRAP_TAB_ID is set by AtHome in its sessions.
const code = await runCli(process.argv.slice(2), {
  socket: terminalSocketPath(),
  cwd: process.cwd(),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  tabId: process.env.CLAUDE_WRAP_TAB_ID || undefined,
  out: (line) => console.log(line),
  err: (line) => console.error(line)
})
process.exit(code)
