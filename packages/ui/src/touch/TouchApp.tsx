import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Connection } from '@athome/client'
import type { Capabilities } from '../App.tsx'
import { t } from '../i18n.ts'
import { readDraft } from '../viewState.ts'
import { ChatScreen } from './ChatScreen.tsx'
import { ScreenContext, TouchContext, type BackHandler, type ComposerInsert, type LiveState, type Screen, type SheetSpec, type Touch } from './context.tsx'
import { FilesScreen, FileScreen } from './FilesScreen.tsx'
import { FolderSessionsScreen, HomeScreen } from './HomeScreen.tsx'
import { Icon } from './icons.tsx'
import { useKeyboard } from './keyboard.ts'
import { TerminalScreen, useOpenTerminal } from './TerminalScreen.tsx'
import { LaterScreen } from './LaterScreen.tsx'
import { ContextScreen, UsageScreen } from './UsageScreens.tsx'
import { NoteScreen, NotesScreen } from './NotesScreen.tsx'
import { applyStoredTheme, EnablePushSheet, SettingsScreen } from './SettingsScreen.tsx'
import { SheetHost, type SheetEntry } from './SheetHost.tsx'
import { Splash } from './Splash.tsx'
import { TrashScreen } from './TrashScreen.tsx'

type Entry = { id: number; screen: Screen; returnSheet?: SheetSpec }

// Where a screen goes in the wide arrangement.
type Region = 'left' | 'center' | 'right' | 'window'
function regionOf(screen: Screen): Region {
  switch (screen.name) {
    case 'home':
    case 'folderSessions':
    case 'trash':
      return 'left'
    case 'chat':
      return 'center'
    case 'settings':
      return 'window'
    default:
      return 'right'
  }
}
// The right panel's first screens (opened from the chat's top bar or its menu); the others go on top of one.
const PANEL_ROOTS = new Set<Screen['name']>(['files', 'notes', 'terminal', 'later', 'context', 'usage'])
// Width from which the wide arrangement is used.
const WIDE_QUERY = '(min-width: 1024px)'

// Whether the window is wide enough for the three-column arrangement (follows resizes).
function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const query = matchMedia(WIDE_QUERY)
    const change = () => setWide(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return wide
}

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
      return <HomeScreen view={screen.view} />
    case 'folderSessions':
      return <FolderSessionsScreen path={screen.path} />
    case 'trash':
      return <TrashScreen under={screen.under} />
    case 'chat':
      return <ChatScreen tabId={screen.tabId} />
    case 'files':
      return <FilesScreen tabId={screen.tabId} folder={screen.folder} />
    case 'file':
      return <FileScreen tabId={screen.tabId} folder={screen.folder} path={screen.path} modified={screen.modified} />
    case 'notes':
      return <NotesScreen tabId={screen.tabId} />
    case 'terminal':
      return <TerminalScreen terminalId={screen.terminalId} />
    case 'note':
      return <NoteScreen tabId={screen.tabId} noteId={screen.noteId} />
    case 'settings':
      return <SettingsScreen />
    case 'later':
      return <LaterScreen which={screen.key} tabId={screen.tabId} />
    case 'context':
      return <ContextScreen tabId={screen.tabId} />
    case 'usage':
      return <UsageScreen tabId={screen.tabId} />
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
  const wide = useWide()
  const wideRef = useRef(wide)
  wideRef.current = wide

  const [stack, setStack] = useState<Entry[]>(() => [{ id: nextId++, screen: { name: 'home' } }])
  const [sheets, setSheets] = useState<SheetEntry[]>([])
  const [instant, setInstant] = useState(false)
  const [toastText, setToastText] = useState<string>()
  const [snackState, setSnackState] = useState<{ text: string; undo?: () => void }>()
  const [announcement, setAnnouncement] = useState('')
  const [viewer, setViewer] = useState<string>()
  const viewerRef = useRef(viewer)
  viewerRef.current = viewer
  // The local backend (desktop) crashed too often and will not come back.
  const [coreFailed, setCoreFailed] = useState(false)
  useEffect(() => capabilities.onCoreFailed?.(() => setCoreFailed(true)), [capabilities])
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
    const first = !sheetsRef.current.length
    if (first) opener.current = document.activeElement as HTMLElement | null
    // Wide: a menu opened from a button is a popover by it; typing sheets and those opened from a sheet are centred.
    const button = first && wideRef.current && !sheet.field ? opener.current?.closest('button') : null
    const box = button?.getBoundingClientRect()
    const anchor = box && box.width ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : undefined
    setInstant(false)
    setSheets((current) => [...current, { ...sheet, id: nextId++, anchor }])
  }, [])

  const go = useCallback((screen: Screen) => {
    if (wideRef.current) {
      // Wide: one chat in the middle (another one closes the right panel), one panel on the right.
      const region = regionOf(screen)
      setSheets([])
      setStack((current) => {
        const kept =
          region === 'center' ? current.filter((entry) => regionOf(entry.screen) === 'left' || regionOf(entry.screen) === 'window')
          : region === 'right' && PANEL_ROOTS.has(screen.name) ? current.filter((entry) => regionOf(entry.screen) !== 'right')
          : current
        return [...kept, { id: nextId++, screen }]
      })
      return
    }
    // Entered from a sheet (the session menu): coming back, that sheet is open again.
    const returnSheet = sheetsRef.current.at(-1)
    setSheets([])
    setStack((current) => [...current, { id: nextId++, screen, returnSheet }])
  }, [])
  // Wide: Back inside one region (its own top screen; the Home stays), or the screen's own back first (up a folder).
  const regionBack = useCallback((region: Region) => {
    const current = stackRef.current
    const top = current.findLast((entry) => regionOf(entry.screen) === region)
    if (!top) return
    const handler = backHandlers.current.get(top.id)
    if (handler?.active) return handler.run()
    if (top.screen.name === 'home') return
    setStack(current.filter((entry) => entry !== top))
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
    // Wide: the chat is already on screen; the panel stays open (Menziona in chat, Usa nel messaggio).
    if (wideRef.current) return setSheets([])
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

  // Esc (hardware keyboard) closes what is open — the photo, a sheet or popover, the Settings window — otherwise it
  // stops Claude in the chat on screen, as in the terminal. Keys already handled (a field's popup, a sheet) are left.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (viewerRef.current) setViewer(undefined)
      else if (sheetsRef.current.length) closeSheet()
      else if (wideRef.current && stackRef.current.some((entry) => regionOf(entry.screen) === 'window')) regionBack('window')
      else {
        const chat = stackRef.current.findLast((entry) => entry.screen.name === 'chat')
        const shown = chat && (wideRef.current || chat === stackRef.current.at(-1)) ? tabOf(chat.screen) : undefined
        const tab = shown && connection.store.getSnapshot().tabs?.find((candidate) => candidate.tabId === shown)
        if (!tab || !['running', 'starting', 'requires_action'].includes(tab.status)) return
        void connection.request('tab.interrupt', { tabId: tab.tabId }).catch(fail)
      }
      event.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [closeSheet, regionBack, connection, fail])

  // A notification tap: Home, then that session's chat.
  useEffect(() => capabilities.onActivateTab?.((tabId) => reset([{ name: 'home' }, { name: 'chat', tabId }])), [capabilities, reset])
  useEffect(() => capabilities.onShowSessions?.(() => reset([{ name: 'home', view: 'sessions' }])), [capabilities, reset])
  // A session closed elsewhere: its screens (and those above them) go.
  useEffect(() => {
    if (!state.tabs) return
    const open = new Set(state.tabs.map((tab) => tab.tabId))
    const gone = stack.findIndex((entry) => tabOf(entry.screen) && !open.has(tabOf(entry.screen)!))
    if (gone > 0) setStack(stack.slice(0, gone))
  }, [state.tabs, stack])

  // A chat left without anything ever sent (no stored session, nothing in it or in its queue) and with nothing written
  // in its composer: the session is closed, so it is neither kept nor listed.
  const shownChats = useRef<string[]>([])
  useEffect(() => {
    const chats = stack.flatMap((entry) => (entry.screen.name === 'chat' ? [entry.screen.tabId] : []))
    for (const tabId of shownChats.current) {
      if (chats.includes(tabId)) continue
      const tab = state.tabs?.find((candidate) => candidate.tabId === tabId)
      const unused = tab && !tab.sessionId && !tab.queue.length && !state.transcripts[tabId]?.items.length && !readDraft(state.welcome?.backendId ?? '', tabId).trim()
      if (unused) void connection.request('tab.close', { tabId }).catch(() => undefined)
    }
    shownChats.current = chats
  }, [stack])

  // A session that starts waiting for you while its chat is not on screen is announced (VoiceOver).
  const statuses = useRef(new Map<string, string>())
  useEffect(() => {
    const shown = tabOf(stack.at(-1)!.screen)
    for (const tab of state.tabs ?? []) {
      if (tab.status === 'requires_action' && statuses.current.get(tab.tabId) !== 'requires_action' && tab.tabId !== shown) setAnnouncement(t('announceWaiting', { title: tab.title }))
      statuses.current.set(tab.tabId, tab.status)
    }
  }, [state.tabs])

  const swipe = useEdgeSwipe(device, stack, backHandlers, sheets.length > 0 || wide, back)
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

  // Wide: the screen shown in each region (the last of its entries).
  const shownIn = (region: Region) => stack.findLast((entry) => regionOf(entry.screen) === region)
  const chatEntry = wide ? shownIn('center') : undefined
  const panelEntries = wide ? stack.filter((entry) => regionOf(entry.screen) === 'right') : []
  const panelRoot = panelEntries[0]?.screen
  const togglePanel = useCallback(
    (screen: Screen) => {
      const open = stackRef.current.find((entry) => regionOf(entry.screen) === 'right')?.screen
      if (open && open.name === screen.name && tabOf(open) === tabOf(screen)) setStack((current) => current.filter((entry) => regionOf(entry.screen) !== 'right'))
      else go(screen)
    },
    [go]
  )

  const touch = useMemo<Touch | undefined>(() => {
    if (!state.welcome || !state.tabs || !state.home || !state.projects) return undefined
    return {
      wide,
      chatTabId: chatEntry && tabOf(chatEntry.screen),
      panel: panelRoot,
      togglePanel,
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
  }, [state, connection, capabilities, go, back, backTo, reset, openSheet, closeSheet, closeSheets, toast, snack, fail, insertInComposer, clearInsert, inserts, wide, chatEntry, panelRoot, togglePanel])
  // Wide: each region's screens get Back for that region.
  const regionTouch = useMemo(() => {
    if (!touch) return undefined
    const of = (region: Region): Touch => ({ ...touch, back: () => regionBack(region) })
    return { left: of('left'), center: of('center'), right: of('right'), window: of('window') }
  }, [touch, regionBack])

  // Just paired: the notifications offered once, if iOS has not been asked yet.
  const pushOffered = useRef(false)
  useEffect(() => {
    if (!touch || pushOffered.current || !capabilities.justPaired || capabilities.push?.permission() !== 'default') return
    pushOffered.current = true
    openSheet({ title: t('pairedTitle'), body: <EnablePushSheet /> })
  }, [touch])

  // Wide: the regions side by side, each showing its last screen (the others stay mounted, hidden).
  const regionView = (region: Region) =>
    stack
      .filter((entry) => regionOf(entry.screen) === region)
      .map((entry, index, entries) => (
        <ScreenContext.Provider key={entry.id} value={{ entryId: entry.id, top: index === entries.length - 1, registerBack }}>
          <div className="screen-host" hidden={index < entries.length - 1} data-entry={entry.id}>
            <ScreenView screen={entry.screen} />
          </div>
        </ScreenContext.Provider>
      ))
  const settingsOpen = wide && Boolean(shownIn('window'))

  return (
    <div className={`device${wide ? ` wide${panelEntries.length ? ' with-panel' : ''}` : ''}`} ref={device}>
      {!touch || !regionTouch ? (
        <Splash connection={connection} state={state} app={capabilities.app} />
      ) : wide ? (
        <TouchContext.Provider value={touch}>
          <div className="col-left">
            <TouchContext.Provider value={regionTouch.left}>{regionView('left')}</TouchContext.Provider>
          </div>
          <main className="col-center">
            <TouchContext.Provider value={regionTouch.center}>{chatEntry ? regionView('center') : <NoChat />}</TouchContext.Provider>
          </main>
          {panelEntries.length > 0 && panelRoot && (
            <aside className="col-right" aria-label={t('sidePanel')}>
              <PanelTabs root={panelRoot} chatTabId={tabOf(chatEntry?.screen ?? panelRoot)} onToggle={togglePanel} onClose={() => setStack((current) => current.filter((entry) => regionOf(entry.screen) !== 'right'))} />
              <div className="panel-body">
                <TouchContext.Provider value={regionTouch.right}>{regionView('right')}</TouchContext.Provider>
              </div>
            </aside>
          )}
          {settingsOpen && (
            <div className="window-scrim" onClick={(event) => event.target === event.currentTarget && regionBack('window')}>
              <div className="window" role="dialog" aria-modal="true" aria-label={t('settings')}>
                <TouchContext.Provider value={regionTouch.window}>{regionView('window')}</TouchContext.Provider>
              </div>
            </div>
          )}
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
      {coreFailed && (
        <div className="core-failed" role="alert">
          {t('coreFailed')}
        </div>
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

// Wide: the middle column before a chat is chosen.
function NoChat() {
  return (
    <section className="screen no-chat" aria-label={t('chat')}>
      <p className="muted">{t('pickASession')}</p>
    </section>
  )
}

// Wide: the right panel's head — File, Note and Terminal of the chat's folder as tabs (the panel shown highlighted),
// × closes. Terminal opens the session's live terminal, or a new one in its folder.
function PanelTabs({ root, chatTabId, onToggle, onClose }: { root: Screen; chatTabId?: string; onToggle: (screen: Screen) => void; onClose: () => void }) {
  const openTerminal = useOpenTerminal()
  return (
    <div className="panel-tabs">
      {chatTabId && (
        <>
          <button className="panel-tab" aria-pressed={root.name === 'files'} onClick={() => root.name !== 'files' && onToggle({ name: 'files', tabId: chatTabId })}>
            {t('files')}
          </button>
          <button className="panel-tab" aria-pressed={root.name === 'notes'} onClick={() => root.name !== 'notes' && onToggle({ name: 'notes', tabId: chatTabId })}>
            {t('notes')}
          </button>
          <button className="panel-tab" aria-pressed={root.name === 'terminal'} onClick={() => root.name !== 'terminal' && openTerminal({ tabId: chatTabId }, onToggle)}>
            {t('terminal')}
          </button>
        </>
      )}
      <IconButtonClose onClose={onClose} />
    </div>
  )
}

// The × of the right panel.
function IconButtonClose({ onClose }: { onClose: () => void }) {
  return (
    <button className="icon-btn panel-close" aria-label={t('closePanel')} onClick={onClose}>
      <Icon name="close" />
    </button>
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
