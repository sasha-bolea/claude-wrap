import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Prompt } from '@claude-wrap/protocol'

// Prompts offered by Up/Down and Ctrl+R: the app's own (its history.jsonl in the state folder) and the terminal
// CLI's (~/.claude/history.jsonl, read only: SDK sessions do not write it). Both use the CLI's line format.

const MAX_PROMPTS = 200

// One line of a history.jsonl. Long pastes are stored as "[Pasted text #1 +N lines]" with the text in pastedContents.
type Entry = { display: string; pastedContents?: Record<string, { content?: string }>; timestamp: number; project: string; sessionId?: string }

// The prompt as typed, with the CLI's paste placeholders expanded when their text was stored.
function expand({ display, pastedContents = {} }: Entry): string {
  return display.replace(/\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g, (placeholder, id: string) => pastedContents[id]?.content ?? placeholder)
}

// Entries of a history.jsonl; a missing file or a broken line is skipped.
async function readEntries(file: string): Promise<Entry[]> {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line) as Entry
      return typeof entry.display === 'string' && typeof entry.timestamp === 'number' ? [entry] : []
    } catch {
      return []
    }
  })
}

export class PromptHistory {
  private readonly appFile?: string
  private readonly cliFile: string
  // Without a state folder (tests) the app's prompts stay in memory.
  private readonly memory: Entry[] = []
  private writing: Promise<unknown> = Promise.resolve()

  // appFile: the app's history.jsonl (absent → memory only); cliFile: the terminal CLI's history.jsonl.
  constructor(appFile: string | undefined, cliFile: string) {
    this.appFile = appFile
    this.cliFile = cliFile
  }

  // Remembers a prompt sent in a folder. Best effort: a failed write only loses that history entry.
  add(text: string, project: string, sessionId?: string): void {
    const entry: Entry = { display: text, pastedContents: {}, timestamp: Date.now(), project, sessionId }
    const file = this.appFile
    if (!file) return void this.memory.push(entry)
    this.writing = this.writing.then(() => mkdir(dirname(file), { recursive: true }).then(() => appendFile(file, JSON.stringify(entry) + '\n'))).catch(() => undefined)
  }

  // Prompts of a folder, newest first, each text once.
  // ponytail: reads both files whole on every call (~2 MB today); read the tail only if they grow much.
  async list(project: string): Promise<Prompt[]> {
    await this.writing
    const [app, cli] = await Promise.all([this.appFile ? readEntries(this.appFile) : this.memory, readEntries(this.cliFile)])
    const seen = new Set<string>()
    return [...app, ...cli]
      .filter((entry) => entry.project === project)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((entry) => ({ text: expand(entry), timestamp: entry.timestamp }))
      .filter((prompt) => prompt.text.trim() && !seen.has(prompt.text) && seen.add(prompt.text))
      .slice(0, MAX_PROMPTS)
  }
}
