import { useEffect, useRef, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import { App, type Capabilities } from './App.tsx'

// One backend of the desktop: the local core or a paired server, each with its own connection and host abilities.
export type BackendEntry = { id: string; name: string; kind: 'local' | 'remote'; connection: Connection; capabilities: Capabilities }

type DesktopShellProps = {
  backends: BackendEntry[]
  // Pairs a server from a pasted link (rejects with an error code: invalid_link, unreachable, pair_failed…).
  onAdd: (link: string, name: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  // A notification was clicked: show that backend and tab. Returns the unsubscribe function.
  onActivate?: (listener: (tabId: string, backendId: string) => void) => () => void
}

const SELECTED_KEY = 'claude-wrap:backend'

function readSelected(): string | undefined {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? undefined
  } catch {
    return undefined
  }
}

// Backends with a session waiting for an answer (the dot on the switch). Follows every connection's store.
function useWaiting(backends: BackendEntry[]): Set<string> {
  const [waiting, setWaiting] = useState(new Set<string>())
  useEffect(() => {
    const compute = () => setWaiting(new Set(backends.filter((backend) => backend.connection.store.getSnapshot().tabs?.some((tab) => tab.status === 'requires_action')).map((backend) => backend.id)))
    compute()
    const stops = backends.map((backend) => backend.connection.store.subscribe(compute))
    return () => stops.forEach((stop) => stop())
  }, [backends])
  return waiting
}

// The desktop with several backends: the shown backend's app, which offers the switch (This PC, the servers, a dot
// where something waits) on top of its Home. Every connection stays open, so hidden backends still notify.
export function DesktopShell({ backends, onAdd, onRemove, onActivate }: DesktopShellProps) {
  const [selected, setSelected] = useState(() => readSelected() ?? 'local')
  const waiting = useWaiting(backends)
  // Notification taps for a backend whose app is not mounted yet wait here until it registers.
  const listeners = useRef(new Map<string, (tabId: string) => void>())
  const pending = useRef<{ backendId: string; tabId: string } | undefined>(undefined)
  const shown = backends.find((backend) => backend.id === selected) ?? backends[0]!

  const choose = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(SELECTED_KEY, id)
    } catch {
      // the choice is a convenience
    }
  }
  useEffect(() => backends.forEach((backend) => backend.connection.start()), [backends])
  useEffect(
    () =>
      onActivate?.((tabId, backendId) => {
        choose(backendId)
        const listener = listeners.current.get(backendId)
        if (listener) listener(tabId)
        else pending.current = { backendId, tabId }
      }),
    [onActivate]
  )
  const capabilities: Capabilities = {
    ...shown.capabilities,
    onActivateTab: (listener) => {
      listeners.current.set(shown.id, listener)
      if (pending.current?.backendId === shown.id) listener(pending.current.tabId)
      pending.current = undefined
      return () => void listeners.current.delete(shown.id)
    },
    backends: {
      list: backends.map(({ id, name, kind }) => ({ id, name, kind, waiting: waiting.has(id) })),
      selected: shown.id,
      choose,
      add: onAdd,
      remove: (id) => onRemove(id).then(() => void (id === shown.id && choose('local')))
    }
  }

  return <App key={shown.id} connection={shown.connection} capabilities={capabilities} />
}
