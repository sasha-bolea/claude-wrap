import type { MessagePortMain } from 'electron'
import { createCore, type Core } from '@claude-wrap/core'
import type { Channel } from '@claude-wrap/protocol'

// Entry of the utilityProcess that hosts the local core. Main sends one MessagePort per client connection,
// and {type:'quit'} when the app quits (the core closes every session before this process exits).
// Environment set by main: CLAUDE_WRAP_STATE_DIR (state.json folder), CLAUDE_WRAP_CLAUDE_PATH (packaged
// claude binary), CLAUDE_WRAP_FAKE_SDK=1 (scripted fake SDK for deterministic e2e, zero quota).

async function startCore(): Promise<Core> {
  const sdk = process.env.CLAUDE_WRAP_FAKE_SDK ? (await import('@claude-wrap/core/testing')).createScriptedSdk() : undefined
  const claudePath = process.env.CLAUDE_WRAP_CLAUDE_PATH
  return createCore({
    backendId: 'local',
    backendKind: 'local',
    sdk,
    stateDir: process.env.CLAUDE_WRAP_STATE_DIR,
    sdkOptions: claudePath ? { pathToClaudeCodeExecutable: claudePath } : undefined,
    // Main decides whether to show it (window focus) and how (Electron Notification).
    notifier: (notice) => process.parentPort.postMessage({ type: 'notify', notice })
  })
}

// Wraps an Electron MessagePortMain as a protocol Channel. Returns the channel.
function channelFromPort(port: MessagePortMain): Channel {
  port.start()
  return {
    send: (frame) => port.postMessage(frame),
    onMessage: (listener) => port.on('message', (event) => listener(event.data)),
    onClose: (listener) => port.on('close', listener),
    close: () => port.close()
  }
}

const core = startCore()

// Registered right away, so no message from main is lost while the core starts.
process.parentPort.on('message', (event) => {
  const [port] = event.ports
  if (port) return void core.then((started) => started.attach(channelFromPort(port)))
  if ((event.data as { type?: string } | undefined)?.type === 'quit') void core.then((started) => started.closeAll()).finally(() => process.exit(0))
})
