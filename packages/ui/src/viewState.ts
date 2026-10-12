// Per-client view state kept in localStorage (survives reloads and restarts): active tab and drafts,
// keyed by backend. Storage can be missing or full: every access is best effort.

const key = (backendId: string, name: string) => `claude-wrap:${backendId}:${name}`

function read(name: string): string | undefined {
  try {
    return localStorage.getItem(name) ?? undefined
  } catch {
    return undefined
  }
}

function write(name: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(name, value)
    else localStorage.removeItem(name)
  } catch {
    // storage unavailable: the view state is a convenience
  }
}

// Layout of this device, whatever the backend: the right panel's width (wide window), in px.
export const readPanelWidth = () => Number(read('claude-wrap:panelWidth')) || undefined
export const writePanelWidth = (width: number | undefined) => write('claude-wrap:panelWidth', width ? String(Math.round(width)) : undefined)
// Whether the notes show as cards under the composer (its Notes toggle), on this device.
export const readNotesOpen = () => read('claude-wrap:notesOpen') === '1'
export const writeNotesOpen = (open: boolean) => write('claude-wrap:notesOpen', open ? '1' : undefined)
// Whether the queue shows as a column of cards (opened from its stack) instead of the stack, on this device.
export const readQueueOpen = () => read('claude-wrap:queueOpen') === '1'
export const writeQueueOpen = (open: boolean) => write('claude-wrap:queueOpen', open ? '1' : undefined)
// The terminal's share of the height beside its chat (phone), between 0 and 1.
export const readTerminalShare = () => Number(read('claude-wrap:terminalShare')) || undefined
export const writeTerminalShare = (share: number) => write('claude-wrap:terminalShare', share.toFixed(3))

export const readDraft = (backendId: string, tabId: string) => read(key(backendId, `draft:${tabId}`)) ?? ''
export const writeDraft = (backendId: string, tabId: string, text: string) => write(key(backendId, `draft:${tabId}`), text)
// Long pastes of a draft, by placeholder number (the draft text holds their placeholders).
export function readPastes(backendId: string, tabId: string): Record<number, string> {
  try {
    return JSON.parse(read(key(backendId, `pastes:${tabId}`)) ?? '{}') as Record<number, string>
  } catch {
    return {}
  }
}
export const writePastes = (backendId: string, tabId: string, pastes: Record<number, string>) =>
  write(key(backendId, `pastes:${tabId}`), Object.keys(pastes).length ? JSON.stringify(pastes) : undefined)
// The note a draft uses ("Usa nel messaggio"): kept with the draft, so the link survives a reload.
export type LinkedNote = { noteId: string; text: string }
export function readLinkedNote(backendId: string, tabId: string): LinkedNote | undefined {
  try {
    return (JSON.parse(read(key(backendId, `note:${tabId}`)) ?? 'null') as LinkedNote | null) ?? undefined
  } catch {
    return undefined
  }
}
export const writeLinkedNote = (backendId: string, tabId: string, note: LinkedNote | undefined) => write(key(backendId, `note:${tabId}`), note ? JSON.stringify(note) : undefined)
