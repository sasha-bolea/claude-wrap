import type { Options, SDKSessionInfo, SessionMessage, query } from '@anthropic-ai/claude-agent-sdk'
import type { BackendKind } from '@claude-wrap/protocol'
import type { HostCommands } from './commands.ts'
import type { RingLimits } from './stream.ts'

type Dir = { dir: string }

// The SDK entry points core uses: the real SDK by default, the FakeQuery store in tests and e2e.
export type SdkApi = {
  query: typeof query
  getSessionMessages(sessionId: string, options: Dir): Promise<SessionMessage[]>
  getSessionInfo(sessionId: string, options: Dir): Promise<SDKSessionInfo | undefined>
  // dir absent: the sessions of every folder.
  listSessions(options: { dir?: string; limit?: number }): Promise<SDKSessionInfo[]>
  renameSession(sessionId: string, title: string, options: Dir): Promise<void>
  deleteSession(sessionId: string, options: Dir): Promise<void>
  forkSession(sessionId: string, options: Dir & { title?: string; upToMessageId?: string }): Promise<{ sessionId: string }>
}

// Something the user may want to hear about while not looking: the host turns it into a system notification
// (desktop: Electron Notification when the window is not focused; server: Web Push in Phase 3).
// visibleDevices: paired devices with a client on screen right now (the server skips their push).
export type Notice = { kind: 'request' | 'turnFinished' | 'error'; tabId: string; title: string; detail?: string; visibleDevices?: string[] }

export interface CoreConfig {
  backendId: string
  backendKind: BackendKind
  sdk?: Partial<SdkApi>
  // Host-specific SDK options (e.g. pathToClaudeCodeExecutable in the packaged app).
  sdkOptions?: Options
  // Folder of state.json and the app's prompt history; absent → nothing is persisted (tests).
  stateDir?: string
  // The CLI's config folder, for its prompt history (default: CLAUDE_CONFIG_DIR, else ~/.claude).
  claudeConfigDir?: string
  // Folders sessions may run in ('any' on the desktop; the server confines to its root in Phase 3).
  allowedRoots?: 'any' | string[]
  notifier?: (notice: Notice) => void
  // Commands the host answers itself (remote server: devices.*).
  hostCommands?: HostCommands
  // File kept up to date with the number of sessions at work (remote server: its automatic update waits for 0).
  activityFile?: string
  // Moves a file or folder to the system trash (desktop: Electron's shell.trashItem, in main). Absent: the app's own
  // trash in <stateDir>/trash, 7 days (remote server).
  trashItem?: (path: string) => Promise<void>
  maxLiveSessions?: number
  coalesceMs?: number
  snapshotItems?: number
  ring?: RingLimits
  closeTimeoutMs?: number
  // How long the next queued message waits while its chat is on screen (ms; default 5000).
  queueCountdownMs?: number
  // Whether a client shows that tab's chat on screen right now (set by createCore from client.watch/visibility).
  watching?: (tabId: string) => boolean
}
