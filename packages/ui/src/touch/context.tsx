import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { Connection, StoreState } from '@athome/client'
import type { Home, TabMeta, Welcome } from '@athome/protocol'
import type { Capabilities } from '../App.tsx'

// The 🔜 panels and settings pages (a placeholder that says what they will show and the / command to use meanwhile).
export type LaterKey = 'context' | 'usage' | 'tasks' | 'todo' | 'diff' | 'mcp' | 'hooks' | 'status' | 'config' | 'permissions' | 'memory' | 'skills' | 'agents' | 'styles' | 'plugins' | 'rewind'

// Screens of the touch layout, one at a time; the stack keeps them mounted, so going back finds them as they were.
export type Screen =
  // view: open on that view of the Home (a notification about several chats opens the sessions).
  | { name: 'home'; view?: 'sessions' }
  | { name: 'folderSessions'; path: string }
  | { name: 'trash'; under?: string }
  | { name: 'chat'; tabId: string }
  // File explorer of a session's folder (tabId) or of a folder of the Home (folder): exactly one.
  | { name: 'files'; tabId?: string; folder?: string }
  | { name: 'file'; tabId?: string; folder?: string; path: string; modified?: number }
  | { name: 'notes'; tabId?: string; folder?: string }
  | { name: 'terminal'; terminalId: string }
  | { name: 'note'; tabId?: string; folder?: string; noteId?: string }
  | { name: 'settings' }
  | { name: 'palettes' }
  | { name: 'palette'; paletteId?: string }
  | { name: 'later'; key: LaterKey; tabId?: string }
  | { name: 'context'; tabId: string }
  | { name: 'usage'; tabId: string }

// A bottom sheet: its title, an optional mono line under it (a path), and its body — a component that reads live
// state. field: the sheet is for typing (the cursor goes to its first field; otherwise the focus goes to the title,
// never to a button).
export type SheetSpec = { title: ReactNode; path?: string; body: ReactNode; field?: boolean }

// The store once connected: welcome, tabs and home are there.
export type LiveState = StoreState & { welcome: Welcome; tabs: TabMeta[]; home: Home; projects: string[] }

// Text (and the note it comes from) waiting to go into a chat's composer.
export type ComposerInsert = { text: string; noteId?: string; replace?: boolean }

export type Touch = {
  connection: Connection
  state: LiveState
  capabilities: Capabilities
  backendId: string
  go(screen: Screen): void
  back(): void
  // Back down the stack to the nearest screen that matches (e.g. the chat, after Menziona in chat).
  backTo(match: (screen: Screen) => boolean): void
  // A new stack (e.g. Home then a chat, after a notification tap).
  reset(screens: Screen[]): void
  openSheet(sheet: SheetSpec): void
  // Closes the top sheet; a sheet opened from another one goes back to it.
  closeSheet(): void
  closeSheets(): void
  toast(text: string): void
  // A message with Ripristina (undo) for a few seconds.
  snack(text: string, undo?: () => void): void
  announce(text: string): void
  // Shows a failed action (toast with the reason).
  fail(error: unknown): void
  viewImage(src: string): void
  // Puts text in a chat's composer (Menziona in chat, Usa nel messaggio): the chat takes it when shown.
  insertInComposer(tabId: string, insert: ComposerInsert): void
  clearInsert(tabId: string): void
  inserts: Record<string, ComposerInsert>
  // The wide arrangement (a window ≥ 1024 px): the Home in a left column, the chat in the middle, File, Note and the
  // panels in a right panel, Settings in a window; no back arrow on the chat.
  wide: boolean
  // Wide: the chat in the middle and the right panel's first screen (undefined when closed).
  chatTabId?: string
  panel?: Screen
  // Wide: opens that panel on the right, or closes it when it is the one open.
  togglePanel(screen: Screen): void
}

export const TouchContext = createContext<Touch | null>(null)

export function useTouch(): Touch {
  const touch = useContext(TouchContext)
  if (!touch) throw new Error('useTouch outside TouchApp')
  return touch
}

// The screen a component belongs to: its entry in the stack and whether it is on top.
type ScreenInfo = { entryId: number; top: boolean; registerBack(entryId: number, handler: BackHandler | undefined): void }
// A screen that goes back inside itself first (up one folder): active says whether it will, run does it.
export type BackHandler = { active: boolean; run(): void }
export const ScreenContext = createContext<ScreenInfo | null>(null)

export function useScreen(): ScreenInfo {
  const screen = useContext(ScreenContext)
  if (!screen) throw new Error('useScreen outside a screen')
  return screen
}

// Lets the screen handle Back (and the edge swipe) itself while active: e.g. up one folder in Home and File.
export function useBackHandler(active: boolean, run: () => void): void {
  const { entryId, registerBack } = useScreen()
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    registerBack(entryId, { active, run: () => latest.current() })
    return () => registerBack(entryId, undefined)
  }, [entryId, active, registerBack])
}
