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
export const readRecentFolder = (backendId: string) => read(key(backendId, 'recentFolder'))
export const writeRecentFolder = (backendId: string, folder: string) => write(key(backendId, 'recentFolder'), folder)
