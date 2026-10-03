import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Effort, ModelInfo, PermissionMode, QueuePause, SlashCommand } from '@claude-wrap/protocol'
import type { Outgoing } from './tab.ts'

// What a tab keeps across restarts (it comes back dormant). Transcripts are not here: the CLI JSONL is the truth.
// ponytail: queued images stay inline (base64) in state.json; move them to files if queues of many photos get common.
export type PersistedTab = {
  tabId: string
  title: string
  cwd: string
  sessionId?: string
  model?: string
  effort?: Effort
  mode: PermissionMode
  cachedModels?: ModelInfo[]
  cachedCommands?: SlashCommand[]
  queue?: Outgoing[]
  queuePause?: QueuePause
}

// A claude process started by this core, recorded to kill it if the core dies without closing it.
export type LivePid = { pid: number; startedAt: number }

// projects: folders marked as projects (canonical paths). addedFolders: the Home of this PC (desktop); undefined until
// the first start with a Home, which fills it with the folders of the saved tabs.
export type PersistedState = { version: 1; trustedFolders: string[]; tabs: PersistedTab[]; livePids: LivePid[]; projects: string[]; addedFolders?: string[] }

const EMPTY: PersistedState = { version: 1, trustedFolders: [], tabs: [], livePids: [], projects: [] }
// Numbers temp files across every store of this process.
let writeCounter = 0

// The core's state on disk (<stateDir>/state.json), or in memory only when there is no file (tests).
// Writes are atomic (temp file + rename: a crash never leaves half a JSON) and queued (two quick saves never
// fight over the temp file).
export class StateStore {
  readonly data: PersistedState
  private readonly file?: string
  private writes: Promise<void> = Promise.resolve()

  private constructor(data: PersistedState, file?: string) {
    this.data = data
    this.file = file
  }

  // Loads the state; a missing or unreadable file means an empty state. file: undefined → memory only.
  static async load(file?: string): Promise<StateStore> {
    if (!file) return new StateStore(structuredClone(EMPTY))
    try {
      const read = JSON.parse(await readFile(file, 'utf8')) as Partial<PersistedState>
      return new StateStore({ ...structuredClone(EMPTY), ...read, version: 1 }, file)
    } catch {
      return new StateStore(structuredClone(EMPTY), file)
    }
  }

  // Applies a change and saves. Returns when this version is on disk (rejects if the write failed: every save
  // writes the whole state, so the next one repairs a failed one).
  update(change: (data: PersistedState) => void): Promise<void> {
    change(this.data)
    if (!this.file) return Promise.resolve()
    const file = this.file
    const content = JSON.stringify(this.data, null, 2)
    // Unique temp name: another process on the same folder (e.g. a restarted core) never shares it.
    const temp = `${file}.${process.pid}.${++writeCounter}.tmp`
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(temp, content)
        await rename(temp, file)
      })
    return this.writes
  }

  // Resolves when every queued write has finished (quit).
  flush(): Promise<void> {
    return this.writes.catch(() => undefined)
  }
}
