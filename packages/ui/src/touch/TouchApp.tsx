import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { Capabilities } from '../App.tsx'
import { t } from '../i18n.ts'
import { ChatScreen } from './ChatScreen.tsx'
import { ScreenContext, TouchContext, type BackHandler, type ComposerInsert, type LiveState, type Screen, type SheetSpec, type Touch } from './context.tsx'
import { FilesScreen, FileScreen } from './FilesScreen.tsx'
import { FolderSessionsScreen, HomeScreen } from './HomeScreen.tsx'
import { Icon } from './icons.tsx'
import { useKeyboard } from './keyboard.ts'
import { LaterScreen } from './LaterScreen.tsx'
import { NoteScreen, NotesScreen } from './NotesScreen.tsx'
import { applyStoredTheme, EnablePushSheet, SettingsScreen } from './SettingsScreen.tsx'
import { SheetHost, type SheetEntry } from './SheetHost.tsx'
import { Splash } from './Splash.tsx'
import { TrashScreen } from './TrashScreen.tsx'

type Entry = { id: number; screen: Screen; returnSheet?: SheetSpec }

// Edge swipe: starts within this distance of the left edge, goes back past this distance.
const EDGE = 24
const SWIPE_BACK = 90
const TOAST_MS = 2200
const SNACK_MS = 5000

let nextId = 1

// The screen a stack entry shows.
function ScreenView({ screen }: { screen: Screen }): ReactNode {
  switch (screen.name) {
    case 'home':
      return <HomeScreen />
    case 'folderSessions':
      return <FolderSessionsScreen path={screen.path} />
    case 'trash':
      return <TrashScreen under={screen.under} />
    case 'chat':
      return <ChatScreen tabId={screen.tabId} />
    case 'files':
      return <FilesScreen tabId={screen.tabId} />
    case 'file':
      return <FileScreen tabId={screen.tabId} path={screen.path} modified={screen.modified} />
    case 'notes':
      return <NotesScreen tabId={screen.tabId} />
    case 'note':
      return <NoteScreen tabId={screen.tabId} noteId={screen.noteId} />
    case 'settings':
      return <SettingsScreen />
    case 'later':
      return <LaterScreen which={screen.key} tabId={screen.tabId} />
  }
}

// The tab a screen belongs to, if any.
const tabOf = (screen: Screen) => ('tabId' in screen ? screen.tabId : undefined)

// The touch layout (the PWA): one screen at a time from a stack, bottom sheets, the launch screen until the server
// answers, edge swipe to go back, toast and undo bar, a full-screen photo viewer. Prototype: NOTE-CONSEGNA §1, §3.
export function TouchApp({ connection, capabilities }: { connection: Connection; capabilities: Capabilities }) {
  const state = useSyncExternalStore(connection.store.subscribe, connection.store.getSnapshot)
  useEffect(() => connection.start(), [connection])
  useLayoutEffect(() => applyStoredTheme(), [])
  const device = useRef<HTMLDivElement>(null)
  useKeyboard(device)

  const [stack, setStack] = useState<Entry[]>(() => [{ id: nextId++, screen: { name: 'home' } }])
  const [sheets, setSheets] = useState<SheetEntry[]>([])
  const [instant, setInstant] = useState(false)
  const [toastText, setToastText] = useState<string>()
  const [snackState, setSnackState] = useState<{ text: string; undo?: () => void }>()
  const [announcement, setAnnouncement] = useState('')
  const [viewer, setViewer] = useState<string>()
  const [inserts, setInserts] = useState<Record<string, ComposerInsert>>({})
  const backHandlers = useRef(new Map<number, BackHandler>())
  const opener = useRef<HTMLElement | null>(null)
  const timers = useRef<{ toast?: ReturnType<typeof setTimeout>; snack?: ReturnType<typeof setTimeout> }>({})
  const stackRef = useRef(stack)
  stackRef.current = stack
  const sheetsRef = useRef(sheets)
  sheetsRef.current = sheets

  const registerBack = useCallback((entryId: number, handler: BackHandler | undefined) => {
    if (handler) backHandlers.current.set(entryId, handler)
    else backHandlers.current.delete(entryId)
  }, [])

  const closeSheets = useCallback(() => {
    setSheets([])
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
  }, [])
  const closeSheet = useCallback(() => {
    if (sheetsRef.current.length <= 1) return closeSheets()
    setInstant(true)
    setSheets((current) => current.slice(0, -1))
  }, [closeSheets])
  const openSheet = useCallback((sheet: SheetSpec) => {
    if (!sheetsRef.current.length) opener.current = document.activeElement as HTMLElement | null
    setInstant(false)
    setSheets((current) => [...current, { ...sheet, id: nextId++ }])
  }, [])

  const go = useCallback((screen: Screen) => {
    // Entered from a sheet (the session menu): coming back, that sheet is open again.
    const returnSheet = sheetsRef.current.at(-1)
    setSheets([])
    setStack((current) => [...current, { id: nextId++, screen, returnSheet }])
  }, [])
  const back = useCallback(() => {
    const current = stackRef.current
    const top = current.at(-1)!
    const handler = backHandlers.current.get(top.id)
    if (handler?.active) return handler.run()
    if (current.length < 2) return
    setStack(current.slice(0, -1))
    if (top.returnSheet) {
      setInstant(true)
      setSheets([{ ...top.returnSheet, id: nextId++ }])
    }
  }, [])
  const backTo = useCallback((match: (screen: Screen) => boolean) => {
    const current = stackRef.current
    const index = current.findLastIndex((entry) => match(entry.screen))
    if (index < 0) return
    setSheets([])
    setStack(current.slice(0, index + 1))
  }, [])
  const reset = useCallback((screens: Screen[]) => {
    setSheets([])
    setStack(screens.map((screen) => ({ id: nextId++, screen })))
  }, [])

  const toast = useCallback((text: string) => {
    setToastText(text)
    clearTimeout(timers.current.toast)
    timers.current.toast = setTimeout(() => setToastText(undefined), TOAST_MS)
  }, [])
  const snack = useCallback((text: string, undo?: () => void) => {
    setSnackState({ text, undo })
    clearTimeout(timers.current.snack)
    timers.current.snack = setTimeout(() => setSnackState(undefined), SNACK_MS)
  }, [])
  const fail = useCallback((error: unknown) => toast(t('actionFailed', { message: error instanceof Error ? error.message : String(error) })), [toast])
  const insertInComposer = useCallback((tabId: string, insert: ComposerInsert) => setInserts((current) => ({ ...current, [tabId]: insert })), [])
  const clearInsert = useCallback(
    (tabId: string) =>
      setInserts((current) => {
        const { [tabId]: _taken, ...rest } = current
        return rest
      }),
    []
  )

  // A notification tap: Home, then that session's chat.
  useEffect(() => capabilities.onActivateTab?.((tabId) => reset([{ name: 'home' }, { name: 'chat', tabId }])), [capabilities, reset])
  // A session closed elsewhere: its screens (and those above them) go.
  useEffect(() => {
    if (!state.tabs) return
    const open = new Set(state.tabs.map((tab) => tab.tabId))
    const gone = stack.findIndex((entry) => tabOf(entry.screen) && !open.has(tabOf(entry.screen)!))
    if (gone > 0) setStack(stack.slice(0, gone))
  }, [state.tabs, stack])

  // A session that starts waiting for you while its chat is not on screen is announced (VoiceOver).
  const statuses = useRef(new Map<string, string>())
  useEffect(() => {
    const shown = tabOf(stack.at(-1)!.screen)
    for (const tab of state.tabs ?? []) {
      if (tab.status === 'requires_action' && statuses.current.get(tab.tabId) !== 'requires_action' && tab.tabId !== shown) setAnnouncement(t('announceWaiting', { title: tab.title }))
      statuses.current.set(tab.tabId, tab.status)
    }
  }, [state.tabs])

  const swipe = useEdgeSwipe(device, stack, backHandlers, sheets.length > 0, back)
  // A screen entered forward slides in (the class goes after, or it would slide again when shown on the way back).
  const shown = useRef(stack.length)
  useEffect(() => {
    if (stack.length > shown.current) {
      const screen = device.current?.querySelector(`[data-entry="${stack.at(-1)!.id}"] > .screen`)
      screen?.classList.add('enter')
      screen?.addEventListener('animationend', () => screen.classList.remove('enter'), { once: true })
    }
    shown.current = stack.length
  }, [stack])

  const touch = useMemo<Touch | undefined>(() => {
    if (!state.welcome || !state.tabs || !state.home || !state.projects) return undefined
    return {
      connection,
      state: state as LiveState,
      capabilities,
      backendId: state.welcome.backendId,
      go,
      back,
      backTo,
      reset,
      openSheet,
      closeSheet,
      closeSheets,
      toast,
      snack,
      announce: setAnnouncement,
      fail,
      viewImage: setViewer,
      insertInComposer,
      clearInsert,
      inserts
    }
  }, [state, connection, capabilities, go, back, backTo, reset, openSheet, closeSheet, closeSheets, toast, snack, fail, insertInComposer, clearInsert, inserts])

  // Just paired: the notifications offered once, if iOS has not been asked yet.
  const pushOffered = useRef(false)
  useEffect(() => {
    if (!touch || pushOffered.current || !capabilities.justPaired || capabilities.push?.permission() !== 'default') return
    pushOffered.current = true
    openSheet({ title: t('pairedTitle'), body: <EnablePushSheet /> })
  }, [touch])

  return (
    <div className="device" ref={device}>
      {!touch ? (
        <Splash connection={connection} state={state} app={capabilities.app} />
      ) : (
        <TouchContext.Provider value={touch}>
          {stack.map((entry, index) => (
            <ScreenContext.Provider key={entry.id} value={{ entryId: entry.id, top: index === stack.length - 1, registerBack }}>
              <div className="screen-host" hidden={index < stack.length - (swipe.revealBelow ? 2 : 1)} data-entry={entry.id}>
                <ScreenView screen={entry.screen} />
              </div>
            </ScreenContext.Provider>
          ))}
          <SheetHost sheets={sheets} instant={instant} onClose={closeSheet} />
          {snackState && (
            <div className="snack" role="status">
              <span>{snackState.text}</span>
              {snackState.undo && (
                <button
                  onClick={() => {
                    setSnackState(undefined)
                    snackState.undo?.()
                  }}
                >
                  {t('restore')}
                </button>
              )}
            </div>
          )}
          {viewer && (
            <div className="viewer" role="dialog" aria-modal="true" aria-label={t('photo')}>
              <img src={viewer} alt="" />
              <button className="icon-btn" aria-label={t('closePhoto')} autoFocus onClick={() => setViewer(undefined)}>
                <Icon name="close" />
              </button>
            </div>
          )}
        </TouchContext.Provider>
      )}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}

// Back gesture: the installed app has no Safari swipe, so a swipe from the left edge goes back, as in iOS apps. The
// screen follows the finger, with the one below shown underneath (none when the screen goes up a folder instead).
function useEdgeSwipe(device: React.RefObject<HTMLDivElement | null>, stack: Entry[], handlers: React.RefObject<Map<number, BackHandler>>, sheetOpen: boolean, back: () => void) {
  const [revealBelow, setRevealBelow] = useState(false)
  useEffect(() => {
    const root = device.current
    if (!root) return
    let drag: { x: number; dx: number; screen: HTMLElement } | undefined
    const top = stack.at(-1)!
    const inside = () => handlers.current.get(top.id)?.active ?? false
    const start = (event: TouchEvent) => {
      const touch = event.touches[0]!
      const screen = root.querySelector<HTMLElement>(`[data-entry="${top.id}"] > .screen`)
      if (sheetOpen || !screen || touch.clientX - root.getBoundingClientRect().left > EDGE || (stack.length < 2 && !inside())) return
      drag = { x: touch.clientX, dx: 0, screen }
    }
    const move = (event: TouchEvent) => {
      if (!drag) return
      drag.dx = Math.max(0, event.touches[0]!.clientX - drag.x)
      if (drag.dx > 8) {
        drag.screen.classList.add('dragging')
        if (!inside()) setRevealBelow(true)
      }
      drag.screen.style.transform = `translateX(${drag.dx}px)`
    }
    const end = () => {
      if (!drag) return
      const { screen, dx } = drag
      drag = undefined
      screen.style.transform = ''
      screen.classList.remove('dragging')
      setRevealBelow(false)
      if (dx > SWIPE_BACK) back()
    }
    root.addEventListener('touchstart', start, { passive: true })
    root.addEventListener('touchmove', move, { passive: true })
    root.addEventListener('touchend', end)
    root.addEventListener('touchcancel', end)
    return () => {
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', end)
      root.removeEventListener('touchcancel', end)
    }
  }, [device, stack, handlers, sheetOpen, back])
  return { revealBelow }
}
