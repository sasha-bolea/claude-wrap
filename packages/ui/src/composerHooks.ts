import { useRef, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { Prompt } from '@claude-wrap/protocol'
import { matchCommands, mention, triggerAt, type Trigger } from './composerText.ts'
import type { Option } from './Suggestions.tsx'

// The suggestion list above the composer: commands for `/`, files for `@`, previous messages for Ctrl+R.
export type Popup = { kind: 'command' | 'file' | 'history'; options: Option[]; active: number; trigger?: Trigger }

const HISTORY_OPTIONS = 50

// Previous messages containing the composer text (Ctrl+R search).
function historyPopup(prompts: Prompt[], text: string): Popup {
  const needle = text.toLowerCase()
  const options = prompts
    .filter((prompt) => prompt.text.toLowerCase().includes(needle))
    .slice(0, HISTORY_OPTIONS)
    .map((prompt, index) => ({ key: `${prompt.timestamp}-${index}`, label: prompt.text.split('\n')[0]!, value: prompt.text }))
  return { kind: 'history', options, active: 0 }
}

// Options for a trigger: matching commands (fetched from the CLI's list each time, so `commands_changed` shows up)
// or files of the tab's folder.
async function triggerOptions(connection: Connection, tabId: string, trigger: Trigger): Promise<Option[]> {
  if (trigger.kind === 'file') {
    const { paths } = await connection.request('tab.suggestFiles', { tabId, query: trigger.query })
    return paths.map((path) => ({ key: path, label: path, value: mention(path) }))
  }
  const { commands } = await connection.request('tab.commands', { tabId })
  return matchCommands(commands, trigger.query).map((command) => ({
    key: command.name,
    label: `/${command.name}`,
    detail: [command.argumentHint, command.description].filter(Boolean).join(' — '),
    value: `/${command.name}`
  }))
}

// State of the suggestion list. refresh() follows the text; answers to an older refresh are dropped.
export function useComposerPopup(connection: Connection, tabId: string, loadHistory: () => Promise<Prompt[]>) {
  const [popup, setPopup] = useState<Popup>()
  const latest = useRef(0)
  const historyOpen = useRef(false)

  // Recomputes the list for the text and caret (failures just hide it: suggestions are a convenience).
  const refresh = (text: string, caret: number) => {
    const request = ++latest.current
    const show = (next: Popup | undefined) => request === latest.current && setPopup(next)
    if (historyOpen.current) return void loadHistory().then((prompts) => show(historyPopup(prompts, text)))
    const trigger = triggerAt(text, caret)
    if (!trigger) return void show(undefined)
    triggerOptions(connection, tabId, trigger).then(
      (options) => show(options.length ? { kind: trigger.kind, options, active: 0, trigger } : undefined),
      () => show(undefined)
    )
  }
  const openHistory = (text: string) => {
    historyOpen.current = true
    refresh(text, text.length)
  }
  const close = () => {
    historyOpen.current = false
    latest.current++
    setPopup(undefined)
  }
  // Moves the active option by delta, wrapping around.
  const move = (delta: number) => setPopup((current) => current && { ...current, active: (current.active + delta + current.options.length) % current.options.length })
  return { popup, refresh, openHistory, close, move }
}

// Previous messages of the folder (loaded once, reloaded after a send) and Up/Down browsing through them.
export function usePromptHistory(connection: Connection, cwd: string) {
  const cache = useRef<Promise<Prompt[]> | undefined>(undefined)
  const index = useRef(-1)
  const draft = useRef('')
  const load = () => (cache.current ??= connection.request('prompts.history', { cwd }).then(({ prompts }) => prompts, () => []))

  // One step older (+1) or newer (-1) from the current text. Returns the text to show, or undefined at either end;
  // stepping back past the newest restores what was being typed.
  const step = async (direction: 1 | -1, current: string): Promise<string | undefined> => {
    const prompts = await load()
    if (index.current === -1) draft.current = current
    const next = Math.max(-1, Math.min(prompts.length - 1, index.current + direction))
    if (next === index.current) return undefined
    index.current = next
    return next === -1 ? draft.current : prompts[next]!.text
  }
  return {
    load,
    step,
    browsing: () => index.current >= 0,
    reset: () => (index.current = -1),
    invalidate: () => (cache.current = undefined)
  }
}
