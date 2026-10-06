import { useEffect, useRef, useState } from 'react'
import type { Terminal as Xterm } from '@xterm/xterm'
import type { TerminalMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useBackHandler, useScreen, useTouch, type Screen } from './context.tsx'
import { Icon } from './icons.tsx'
import { baseName } from './model.ts'
import { IconButton, Title } from './parts.tsx'

// xterm.js, its fit and links addons, loaded with the first terminal opened (its stylesheet comes with touch.css).
const loadXterm = () => Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')])

// A size change is sent to the backend once the terminal has stopped changing size for this long (the keyboard
// sliding in resizes it many times).
const RESIZE_DELAY = 120

// The key bar of a touch screen: keys the phone keyboard lacks or hides. Ctrl applies to the next key typed.
const KEYS: { label: string; name?: 'keyEscape' | 'keyTab' | 'keyLeft' | 'keyUp' | 'keyDown' | 'keyRight'; data: string }[] = [
  { label: 'Esc', name: 'keyEscape', data: '\x1b' },
  { label: 'Tab', name: 'keyTab', data: '\t' },
  { label: '←', name: 'keyLeft', data: '\x1b[D' },
  { label: '↑', name: 'keyUp', data: '\x1b[A' },
  { label: '↓', name: 'keyDown', data: '\x1b[B' },
  { label: '→', name: 'keyRight', data: '\x1b[C' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '/', data: '/' }
]

// What Ctrl turns a typed key into (Ctrl+C → ETX); other input passes unchanged. data: what the terminal typed.
export function withCtrl(data: string): string {
  if (data.length !== 1) return data
  const code = data.toUpperCase().charCodeAt(0)
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data
}

// The terminal's colours from the app's tokens (light and dark themes alike). element: inside the app.
function themeOf(element: HTMLElement) {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return { background: token('--background'), foreground: token('--text'), cursor: token('--accent'), selectionBackground: token('--surface-2') }
}

// Opens a terminal: the live one of a session if it has one, otherwise a new one in the session's folder or in a
// folder of the Home. show: how to show it (default: go to its screen).
export function useOpenTerminal() {
  const { state, connection, go, closeSheets, fail } = useTouch()
  return (place: { tabId: string } | { folder: string }, show: (screen: Screen) => void = go) => {
    const live = 'tabId' in place ? state.terminals.find((terminal) => terminal.tabId === place.tabId && terminal.exitCode === undefined) : undefined
    const open = (terminalId: string) => (closeSheets(), show({ name: 'terminal', terminalId }))
    if (live) return open(live.terminalId)
    connection.request('terminal.open', { ...place, cols: 80, rows: 24 }).then(({ terminalId }) => open(terminalId), fail)
  }
}

// A terminal of the backend: the shell's screen (xterm.js) fed by its stream, what I type sent back, its size
// following the screen; on a touch screen the key bar. When the shell ends, a bar says so and offers to close it.
export function TerminalScreen({ terminalId }: { terminalId: string }) {
  const { state, connection, back, openSheet, closeSheets, wide, fail, toast, capabilities } = useTouch()
  const openLink = useRef((url: string) => void (capabilities.openExternal ? capabilities.openExternal(url) : window.open(url, '_blank', 'noopener')))
  const { entryId, registerBack } = useScreen()
  const meta = state.terminals.find((terminal) => terminal.terminalId === terminalId)
  // Leaving (Back, edge swipe) asks whether to close it; either answer then leaves for real.
  const leave = () => {
    closeSheets()
    registerBack(entryId, undefined)
    back()
  }
  const closeAndLeave = () => connection.request('terminal.close', { terminalId }).then(leave, fail)
  useBackHandler(!wide && meta !== undefined, () =>
    openSheet({
      title: t('closeTerminalQuestion'),
      body: (
        <ConfirmClose hint={t('leaveTerminalHint')} keep={t('keepItOpen')} close={t('closeTerminal')} onKeep={leave} onClose={() => void closeAndLeave()} />
      )
    })
  )
  const host = useRef<HTMLDivElement>(null)
  const xterm = useRef<Xterm | undefined>(undefined)
  const ctrl = useRef(false)
  const [ctrlOn, setCtrlOn] = useState(false)
  // What I type (or tap on the key bar) goes to the shell; a pending Ctrl applies to it.
  const type = (data: string) => {
    const keys = ctrl.current ? withCtrl(data) : data
    ctrl.current = false
    setCtrlOn(false)
    connection.request('terminal.input', { terminalId, data: keys }).catch(() => undefined)
  }
  const typeRef = useRef(type)
  typeRef.current = type
  useEffect(() => {
    let disposed = false
    let cleanup = () => undefined as void
    void loadXterm().then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
      const element = host.current
      if (disposed || !element) return
      const terminal = new Terminal({ fontFamily: getComputedStyle(element).getPropertyValue('--font-mono'), fontSize: 13, cursorBlink: true, scrollback: 5000, theme: themeOf(element) })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      // A link in the output opens outside the app (the system browser on the desktop).
      terminal.loadAddon(new WebLinksAddon((_event, url) => openLink.current(url)))
      terminal.open(element)
      xterm.current = terminal
      const input = terminal.onData((data) => typeRef.current(data))
      const stop = connection.subscribeTerminal(terminalId, {
        reset: (snapshot) => (terminal.reset(), terminal.write(snapshot.screen)),
        output: (data) => terminal.write(data),
        exit: () => undefined
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const resize = () => {
        fit.fit()
        clearTimeout(timer)
        timer = setTimeout(() => void connection.request('terminal.resize', { terminalId, cols: terminal.cols, rows: terminal.rows }).catch(() => undefined), RESIZE_DELAY)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(element)
      resize()
      cleanup = () => {
        clearTimeout(timer)
        observer.disconnect()
        stop()
        input.dispose()
        terminal.dispose()
      }
    })
    return () => {
      disposed = true
      cleanup()
      xterm.current = undefined
    }
  }, [connection, terminalId])

  const toggleCtrl = () => {
    ctrl.current = !ctrl.current
    setCtrlOn(ctrl.current)
    xterm.current?.focus()
  }
  // The whole output (scrollback included) as text, without the empty lines at the end.
  const copyAll = () => {
    const buffer = xterm.current?.buffer.active
    if (!buffer) return
    const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '')
    while (lines.length && !lines.at(-1)) lines.pop()
    navigator.clipboard.writeText(lines.join('\n')).then(() => (closeSheets(), toast(t('copiedOutput'))), fail)
  }
  // The clipboard typed into the shell (as a paste: a program that asks for it gets it marked).
  const paste = () =>
    navigator.clipboard.readText().then((text) => {
      closeSheets()
      xterm.current?.paste(text)
    }, fail)
  const openMenu = () => openSheet({ title: t('terminal'), path: meta?.cwd, body: <TerminalMenu terminalId={terminalId} onClosed={back} onCopy={copyAll} onPaste={() => void paste()} /> })
  return (
    <section className="screen terminal-screen" aria-label={t('terminal')}>
      <header className="topbar">
        {!wide && <IconButton icon="back" label={t('back')} onClick={back} />}
        <Title text={t('terminal')} sub={meta?.cwd} padLeft={wide} />
        <IconButton icon="more" label={t('terminalActions')} onClick={openMenu} />
      </header>
      <div className="terminal-host" ref={host} />
      {meta?.exitCode !== undefined && (
        <div className="terminal-ended" role="status">
          <span>{t('shellEnded', { code: String(meta.exitCode) })}</span>
          <button className="button" onClick={() => connection.request('terminal.close', { terminalId }).then(back, () => undefined)}>
            {t('close')}
          </button>
        </div>
      )}
      {!wide && (
        <div className="key-bar" role="toolbar" aria-label={t('terminalKeys')}>
          {/* The keys never take the focus: the keyboard stays open. */}
          <button className="key" aria-pressed={ctrlOn} onPointerDown={(event) => event.preventDefault()} onClick={toggleCtrl}>
            Ctrl
          </button>
          {KEYS.map((key) => (
            <button key={key.label} className="key" aria-label={key.name ? t(key.name) : undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => type(key.data)}>
              {key.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// A question with its hint, "keep" and a red "close" (leaving a terminal, closing them all).
function ConfirmClose({ hint, keep, close, onKeep, onClose }: { hint: string; keep: string; close: string; onKeep: () => void; onClose: () => void }) {
  return (
    <>
      <p className="flat">{hint}</p>
      <div className="two-buttons">
        <button className="button" onClick={onKeep}>
          {keep}
        </button>
        <button className="button danger" onClick={onClose}>
          {close}
        </button>
      </div>
    </>
  )
}

// Menu of a terminal: copy all its output, paste the clipboard into it, close it (the shell ends, for every device).
function TerminalMenu({ terminalId, onClosed, onCopy, onPaste }: { terminalId: string; onClosed: () => void; onCopy: () => void; onPaste: () => void }) {
  const { connection, closeSheets, fail } = useTouch()
  const close = () => connection.request('terminal.close', { terminalId }).then(() => (closeSheets(), onClosed()), fail)
  return (
    <ul className="menu">
      <li>
        <button onClick={onCopy}>
          <Icon name="files" />
          {t('copyAll')}
        </button>
      </li>
      <li>
        <button onClick={onPaste}>
          <Icon name="download" />
          {t('paste')}
        </button>
      </li>
      <li>
        <button className="danger" onClick={() => void close()}>
          <Icon name="close" />
          {t('closeTerminal')}
        </button>
      </li>
    </ul>
  )
}

// The backend's terminals in a list (the Home): folder, running or ended; a tap opens one; all closed at once.
export function OpenTerminals() {
  const { state, connection, go, panel, wide, openSheet, closeSheet, closeSheets, fail } = useTouch()
  if (!state.terminals.length) return null
  // Every terminal of the backend ends (each closed like from its menu), after a confirmation.
  const closeAll = () =>
    Promise.all(state.terminals.map((terminal) => connection.request('terminal.close', { terminalId: terminal.terminalId }))).then(closeSheets, fail)
  const askCloseAll = () =>
    openSheet({
      title: t('closeAllTerminalsQuestion'),
      body: <ConfirmClose hint={t('closeAllTerminalsHint')} keep={t('cancel')} close={t('closeAll')} onKeep={closeSheet} onClose={() => void closeAll()} />
    })
  const current = wide && panel?.name === 'terminal' ? panel.terminalId : undefined
  return (
    <>
      <p className="label">{t('terminals')}</p>
      <ul className="list">
        {state.terminals.map((terminal) => (
          <li key={terminal.terminalId} className={`row${terminal.terminalId === current ? ' current' : ''}`}>
            <Icon name="terminal" className="ficon" />
            <button className="row-main" onClick={() => go({ name: 'terminal', terminalId: terminal.terminalId })}>
              <span className="row-title">{baseName(terminal.cwd) || terminal.cwd}</span>
              <span className="row-sub">{terminalWords(terminal)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="link-btn" onClick={askCloseAll}>
        <Icon name="close" />
        {t('closeAllTerminals')}
      </button>
    </>
  )
}

// "Terminal · running" or "Terminal · ended (code 3)".
function terminalWords(terminal: TerminalMeta): string {
  return `${t('terminal')} · ${terminal.exitCode === undefined ? t('terminalRunning') : t('terminalEnded', { code: String(terminal.exitCode) })}`
}
