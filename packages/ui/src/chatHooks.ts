import { useEffect, useRef, type DependencyList, type RefObject } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { PermissionMode, TabMeta } from '@claude-wrap/protocol'
import { isFocusFree } from './focus.ts'
import { nextMode } from './modes.ts'

// Receives the tab's transcript while the view is mounted.
export function useTabSubscription(connection: Connection, tabId: string, onError: (error: unknown) => void): void {
  useEffect(() => {
    connection.subscribeTab(tabId).catch(onError)
    return () => void connection.unsubscribeTab(tabId).catch(() => undefined)
    // onError is a fresh function every render: the subscription follows the tab only.
  }, [connection, tabId])
}

// Keeps the conversation scrolled to the bottom, unless the user scrolled up to read.
export function useAutoScroll(deps: DependencyList) {
  const ref = useRef<HTMLDivElement>(null)
  const attached = useRef(true)
  useEffect(() => {
    if (attached.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, deps)
  const onScroll = () => {
    const element = ref.current!
    attached.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
  }
  return { ref, onScroll }
}

// Esc interrupts a running turn (CLI shortcut). An Esc already handled elsewhere (preventDefault) does not.
export function useInterruptOnEscape(running: boolean, interrupt: () => void): void {
  useEffect(() => {
    if (!running) return
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === 'Escape') interrupt()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, interrupt])
}

// Mode changes. Two quick Shift+Tab must start from the last *requested* mode, not from the confirmed one.
export function useModeSwitch(connection: Connection, meta: TabMeta, onError: (error: unknown) => void) {
  const requested = useRef(meta.mode)
  useEffect(() => {
    requested.current = meta.mode
  }, [meta.mode])
  const setMode = (mode: PermissionMode) => {
    requested.current = mode
    connection.request('tab.setMode', { tabId: meta.tabId, mode }).catch(onError)
  }
  return { setMode, cycleMode: () => setMode(nextMode(requested.current)) }
}

// When a request panel disappears and the focus fell to the page (answered elsewhere, or cancelled),
// the focus goes to the chat panel, never left on body.
export function useFocusAfterRequest(requestId: string | undefined, panel: RefObject<HTMLElement | null>): void {
  const previous = useRef(requestId)
  useEffect(() => {
    if (previous.current && previous.current !== requestId && isFocusFree()) panel.current?.focus()
    previous.current = requestId
  }, [requestId, panel])
}
