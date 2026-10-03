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

export const readActiveTab = (backendId: string) => read(key(backendId, 'activeTab'))
export const writeActiveTab = (backendId: string, tabId: string | undefined) => write(key(backendId, 'activeTab'), tabId)
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
export const readRecentFolder = (backendId: string) => read(key(backendId, 'recentFolder'))
export const writeRecentFolder = (backendId: string, folder: string) => write(key(backendId, 'recentFolder'), folder)
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
