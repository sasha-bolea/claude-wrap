import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ActionConfirmation, CoreActionName } from '@athome/protocol'

// The log of the action API: every action asked for, by whom, from where and how it ended. Kept in memory (the last
// MAX_ENTRIES) and appended to <stateDir>/actions.jsonl when there is a state folder.

export type ActionOutcome = 'done' | 'denied' | 'refused' | 'failed'
// One action: when (ms), what, its arguments, who asked (source, the client's name), the chat, the plan it ran under,
// how it ended.
export type ActionLogEntry = { at: number; action: CoreActionName; args: Record<string, unknown>; source: ActionConfirmation['source']; by: string; tabId?: string; plan?: string; outcome: ActionOutcome }

const MAX_ENTRIES = 500

export class ActionLog {
  private readonly entries: ActionLogEntry[] = []
  private readonly file?: string
  private writes: Promise<void> = Promise.resolve()

  // file: where to append the entries (absent: memory only).
  constructor(file?: string) {
    this.file = file
  }

  // Records one action (a failed write of the file is ignored: the log never blocks an action).
  add(entry: ActionLogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    const file = this.file
    if (file) this.writes = this.writes.then(() => mkdir(dirname(file), { recursive: true }).then(() => appendFile(file, `${JSON.stringify(entry)}\n`))).catch(() => undefined)
  }

  // The entries in memory, oldest first.
  list(): ActionLogEntry[] {
    return [...this.entries]
  }

  // How many actions matching the filter ended done since `since` (ms).
  countDone(since: number, match: (entry: ActionLogEntry) => boolean): number {
    return this.entries.filter((entry) => entry.at >= since && entry.outcome === 'done' && match(entry)).length
  }
}
