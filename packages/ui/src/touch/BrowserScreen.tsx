import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type Ref } from 'react'
import type { Connection } from '@athome/client'
import type { BrowserSnapshot } from '@athome/protocol'
import { t } from '../i18n.ts'
import { BrowserCanvas, type BrowserFrame, type DrawRef } from './BrowserCanvas.tsx'
import { hostOf, normalizeUrl } from './browserView.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { IconButton, Title } from './parts.tsx'

// The server's shared browser: its live page (the same one Claude drives), its address bar, its tabs, and who is
// acting in it. The stream goes straight to the screen (frames never pass through the store).

type BrowserTab = BrowserSnapshot['tabs'][number]
type Info = { ready: boolean; running: boolean; tabs: BrowserTab[]; acting: BrowserSnapshot['acting']; error?: string }
type InfoStore = ReturnType<typeof createInfoStore>

// What the stream says besides frames, as a small store (the tabs sheet reads it too, outside this screen).
function createInfoStore() {
  let info: Info = { ready: false, running: false, tabs: [], acting: [] }
  const listeners = new Set<() => void>()
  return {
    get: () => info,
    set(patch: Partial<Info>) {
      info = { ...info, ...patch }
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

// Follows the browser's stream while the screen is shown: frames to the canvas, the rest to the store.
function useBrowserStream(connection: Connection, enabled: boolean, store: InfoStore, drawRef: DrawRef) {
  useEffect(() => {
    if (!enabled) return
    return connection.subscribeBrowser({
      snapshot: (snapshot) => {
        store.set({ ready: true, running: snapshot.running, tabs: snapshot.tabs, acting: snapshot.acting, error: undefined })
        if (snapshot.frame) drawRef.current?.(snapshot.frame)
      },
      event: (event) => {
        if (event.type === 'browser.frame') drawRef.current?.(event as BrowserFrame)
        else if (event.type === 'browser.tabs') store.set({ tabs: event.tabs, running: event.running })
        else store.set({ acting: event.sessions })
      },
      failed: (error) => store.set({ error: error instanceof Error ? error.message : String(error) })
    })
  }, [connection, enabled, store, drawRef])
}

// The browser as a screen (a right-panel root on a wide window).
export function BrowserScreen() {
  const { state, connection, back, wide, go, openSheet } = useTouch()
  const available = state.welcome.browser === true
  const [store] = useState(createInfoStore)
  const info = useSyncExternalStore(store.subscribe, store.get)
  const drawRef: DrawRef = useRef(undefined)
  const keys = useRef<HTMLInputElement>(null)
  const [typing, setTyping] = useState(false)
  useBrowserStream(connection, available, store, drawRef)
  const active = info.tabs.find((tab) => tab.active)
  const openChat = (tabId: string) => state.tabs.some((tab) => tab.tabId === tabId) && go({ name: 'chat', tabId })
  return (
    <section className="screen browser-screen" aria-label={t('browser')}>
      <header className="topbar">
        {!wide && <IconButton icon="back" label={t('back')} onClick={back} />}
        <Title text={t('browser')} sub={active ? hostOf(active.url) : undefined} padLeft={wide} />
        <IconButton icon="keyboard" label={t('browserKeyboard')} className={typing ? 'accent' : undefined} onClick={() => keys.current?.focus()} />
        <IconButton icon="tabs" label={t('browserTabs')} count={String(info.tabs.length)} onClick={() => openSheet({ title: t('browserTabsTitle'), body: <BrowserTabsSheet store={store} /> })} />
      </header>
      {!available || info.error ? (
        <div className="pad">
          <div className="card bad" role="alert">
            {available ? info.error : t('browserUnavailable')}
          </div>
        </div>
      ) : (
        <>
          <AddressBar active={active} />
          {info.acting.map((session) => (
            <button key={session.tabId} className="update-bar browser-acting" onClick={() => openChat(session.tabId)}>
              {t('browserActing', { title: session.title })}
            </button>
          ))}
          {typing && <p className="notice-line">{t('browserKeysHint')}</p>}
          <div className="browser-stage">
            <BrowserCanvas drawRef={drawRef} active={info.ready && info.running} />
            {!(info.ready && info.running) && (
              <p className="browser-status muted" role="status">
                {t('browserStarting')}
              </p>
            )}
          </div>
          <TypingField ref={keys} onTyping={setTyping} />
        </>
      )}
    </section>
  )
}

// Page back, forward, reload and the address field (Enter or Go navigates; no scheme: https://). While the text is
// being changed the Go button shows; a refused address is shown under the field.
function AddressBar({ active }: { active?: BrowserTab }) {
  const { connection } = useTouch()
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const shown = draft ?? (active && active.url !== 'about:blank' ? active.url : '')
  useEffect(() => setDraft(undefined), [active?.url])
  const run = (name: 'browser.back' | 'browser.forward' | 'browser.reload') => void connection.request(name, {}).catch((e: unknown) => setError(messageOf(e)))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = normalizeUrl(shown)
    if (!url) return
    setError(undefined)
    if (!URL.canParse(url)) return setError(t('browserBadUrl'))
    connection.request('browser.navigate', { url }).then(() => (setDraft(undefined), (document.activeElement as HTMLElement | null)?.blur()), (e: unknown) => setError(messageOf(e)))
  }
  return (
    <>
      <div className="browser-bar">
        <IconButton icon="back" label={t('browserBack')} onClick={() => run('browser.back')} />
        <IconButton icon="chevron" label={t('browserForward')} onClick={() => run('browser.forward')} />
        <IconButton icon="reload" label={t('browserReload')} onClick={() => run('browser.reload')} />
        <form onSubmit={submit}>
          <input
            className="field mono"
            type="text"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t('browserAddress')}
            value={shown}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          {draft !== undefined && (
            <button className="button primary" type="submit">
              {t('browserGo')}
            </button>
          )}
        </form>
      </div>
      {error && (
        <div className="pad tight">
          <p className="error-text" role="alert">
            {error}
          </p>
        </div>
      )}
    </>
  )
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The hidden field the keyboard button focuses: what is typed goes to the page as text (no Enter, Backspace or arrow
// keys yet: the hint says so). A composition (IME) is sent once it ends.
function TypingField({ ref, onTyping }: { ref: Ref<HTMLInputElement>; onTyping: (typing: boolean) => void }) {
  const { connection } = useTouch()
  const type = (field: HTMLInputElement) => {
    const text = field.value
    field.value = ''
    if (text) void connection.request('browser.text', { text }).catch(() => undefined)
  }
  return (
    <input
      ref={ref}
      className="browser-keys"
      aria-label={t('browserTyping')}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      onFocus={() => onTyping(true)}
      onBlur={() => onTyping(false)}
      onInput={(event) => !event.nativeEvent.isComposing && type(event.currentTarget)}
      onCompositionEnd={(event) => type(event.currentTarget)}
    />
  )
}

// The tabs of the browser: tap one to show it, × closes it, "New tab" opens an empty one (at most 5 at once).
function BrowserTabsSheet({ store }: { store: InfoStore }) {
  const { connection, closeSheets, fail } = useTouch()
  const info = useSyncExternalStore(store.subscribe, store.get)
  const select = (tabId: string) => connection.request('browser.tabSelect', { tabId }).then(closeSheets, fail)
  const close = (tabId: string) => connection.request('browser.tabClose', { tabId }).catch(fail)
  const add = () => connection.request('browser.tabNew', {}).then(closeSheets, fail)
  return (
    <>
      <ul className="list">
        {info.tabs.map((tab) => (
          <li key={tab.tabId} className={`row${tab.active ? ' current' : ''}`}>
            <button className="row-main" aria-current={tab.active || undefined} onClick={() => void select(tab.tabId)}>
              <span className="row-title">{tab.title || hostOf(tab.url) || t('browserNewTab')}</span>
              {tab.title && hostOf(tab.url) && <span className="row-sub">{hostOf(tab.url)}</span>}
            </button>
            <IconButton icon="close" label={t('browserCloseTab', { title: tab.title || hostOf(tab.url) || t('browserNewTab') })} onClick={() => void close(tab.tabId)} />
          </li>
        ))}
      </ul>
      <button className="button block" onClick={() => void add()}>
        <Icon name="plus" />
        {t('browserNewTab')}
      </button>
    </>
  )
}
