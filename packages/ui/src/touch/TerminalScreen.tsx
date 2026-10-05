import { useEffect, useRef, useState } from 'react'
import type { Terminal as Xterm } from '@xterm/xterm'
import type { TerminalMeta } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { useTouch, type Screen } from './context.tsx'
import { Icon } from './icons.tsx'
import { baseName } from './model.ts'
import { IconButton, Title } from './parts.tsx'

// xterm.js and its fit addon, loaded with the first terminal opened (its stylesheet comes with touch.css).
const loadXterm = () => Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])

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
  const { state, connection, back, openSheet, wide } = useTouch()
  const meta = state.terminals.find((terminal) => terminal.terminalId === terminalId)
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
    void loadXterm().then(([{ Terminal }, { FitAddon }]) => {
      const element = host.current
      if (disposed || !element) return
      const terminal = new Terminal({ fontFamily: getComputedStyle(element).getPropertyValue('--font-mono'), fontSize: 13, cursorBlink: true, scrollback: 5000, theme: themeOf(element) })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
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
  const openMenu = () => openSheet({ title: t('terminal'), path: meta?.cwd, body: <TerminalMenu terminalId={terminalId} onClosed={back} /> })
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

// Menu of a terminal: close it (the shell ends, for every device).
function TerminalMenu({ terminalId, onClosed }: { terminalId: string; onClosed: () => void }) {
  const { connection, closeSheets, fail } = useTouch()
  const close = () => connection.request('terminal.close', { terminalId }).then(() => (closeSheets(), onClosed()), fail)
  return (
    <ul className="menu">
      <li>
        <button className="danger" onClick={() => void close()}>
          <Icon name="close" />
          {t('closeTerminal')}
        </button>
      </li>
    </ul>
  )
}

// The backend's terminals in a list (the Home): folder, running or ended; a tap opens one.
export function OpenTerminals() {
  const { state, go, panel, wide } = useTouch()
  if (!state.terminals.length) return null
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
    </>
  )
}

// "Terminal · running" or "Terminal · ended (code 3)".
function terminalWords(terminal: TerminalMeta): string {
  return `${t('terminal')} · ${terminal.exitCode === undefined ? t('terminalRunning') : t('terminalEnded', { code: String(terminal.exitCode) })}`
}
