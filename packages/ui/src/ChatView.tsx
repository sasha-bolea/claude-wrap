import { useCallback, useEffect, useRef, useState } from 'react'
import { ClientError, type Connection, type TabView } from '@claude-wrap/client'
import type { Request, TabMeta } from '@claude-wrap/protocol'
import { ChatHeader } from './ChatHeader.tsx'
import { useAutoScroll, useFocusAfterRequest, useInterruptOnEscape, useModeSwitch, useTabSubscription } from './chatHooks.ts'
import { Composer } from './Composer.tsx'
import { t } from './i18n.ts'
import { ItemView } from './ItemView.tsx'
import { modeLabel } from './modes.ts'
import { RequestPanel, type Answer } from './RequestPanel.tsx'
import { TrustDialog, type TrustCheck } from './TrustDialog.tsx'

export type ChatViewProps = {
  connection: Connection
  backendId: string
  meta: TabMeta
  view?: TabView
  openExternal?: (url: string) => void
  // Shows another tab (a fork just created).
  onOpenTab: (tabId: string) => void
}

// What screen readers hear: the open request (only when it changes) and the mode, in separate regions.
const requestAnnouncement = (request?: Request) => (request ? t('announceRequest', { what: request.title ?? request.displayName ?? request.toolName }) : '')

// Trust dialog of a tab whose folder is not trusted (restored tab, trust revoked): after "yes", the message
// that hit the gate is sent again.
function useTrustGate(connection: Connection, meta: TabMeta, onError: (failure: unknown) => void, resend: (text: string) => void) {
  const [check, setCheck] = useState<TrustCheck>()
  const blocked = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (meta.status === 'needs_trust') connection.request('trust.check', { cwd: meta.cwd }).then(setCheck, onError)
    else setCheck(undefined)
  }, [connection, meta.status, meta.cwd, onError])
  const grant = () =>
    connection.request('trust.grant', { cwd: meta.cwd }).then(() => {
      const text = blocked.current
      blocked.current = undefined
      if (text) resend(text)
    }, onError)
  return { check, grant, remember: (text: string) => (blocked.current = text) }
}

// One session: header, conversation, open request, composer.
export function ChatView({ connection, backendId, meta, view, openExternal, onOpenTab }: ChatViewProps) {
  const [error, setError] = useState<string>()
  const onError = useCallback((failure: unknown) => setError(t('actionFailed', { message: failure instanceof Error ? failure.message : String(failure) })), [])
  const tabId = meta.tabId
  const request = view?.requests[0]
  const running = meta.status === 'running' || meta.status === 'requires_action' || meta.status === 'starting'
  const input = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const scroll = useAutoScroll([view?.items, request])
  const mode = useModeSwitch(connection, meta, onError)
  const interrupt = useCallback(() => void connection.request('tab.interrupt', { tabId }).catch(onError), [connection, tabId, onError])
  useTabSubscription(connection, tabId, onError)
  useInterruptOnEscape(running, interrupt)
  useFocusAfterRequest(request?.requestId, panel)

  const send = (text: string) => {
    setError(undefined)
    connection.request('tab.send', { tabId, text }).catch((failure: unknown) => {
      if (failure instanceof ClientError && failure.code === 'needs_trust') trust.remember(text)
      else onError(failure)
    })
  }
  const trust = useTrustGate(connection, meta, onError, send)
  const fork = () => connection.request('tab.fork', { tabId, newTabId: crypto.randomUUID() }).then(({ tabId: forked }) => onOpenTab(forked), onError)
  const restart = () => connection.request('tab.restart', { tabId }).catch(onError)
  // Answering moves the focus back to the composer, ready for the next message.
  const answer = (requestId: string, choice: Answer) => {
    input.current?.focus()
    connection.request('request.answer', { tabId, requestId, ...choice }).catch(onError)
  }
  const close = () => {
    if (running && !window.confirm(t('closeConfirm'))) return
    connection.request('tab.close', { tabId }).catch(onError)
  }

  return (
    <div className="page chat" ref={panel} tabIndex={-1}>
      <ChatHeader meta={meta} connection={connection} onMode={mode.setMode} onFork={() => void fork()} onClose={close} onError={onError} />
      <div className="conversation" ref={scroll.ref} onScroll={scroll.onScroll}>
        {view?.items.map((item) => <ItemView key={item.itemId} item={item} openExternal={openExternal} />)}
        {meta.status === 'starting' && <p className="item muted" role="status">{t('starting')}</p>}
        {meta.status === 'running' && <p className="item muted">{t('working')}</p>}
        {meta.status === 'error' && meta.error && (
          <div className="item notice error" role="alert">
            <p>{t('processStopped', { error: meta.error })}</p>
            <button className="button" onClick={() => void restart()}>
              {t('restart')}
            </button>
          </div>
        )}
        {meta.status === 'needs_trust' && trust.check && <TrustDialog cwd={meta.cwd} check={trust.check} onAccept={() => void trust.grant()} />}
        {meta.queue.length > 0 && <p className="item muted">{t('queued', { count: String(meta.queue.length) })}</p>}
        {request && <RequestPanel key={request.requestId} request={request} onAnswer={(choice) => answer(request.requestId, choice)} openExternal={openExternal} />}
        {error && <p className="item notice error" role="alert">{error}</p>}
      </div>
      <div className="sr-only" aria-live="polite" data-live="request">{requestAnnouncement(request)}</div>
      <div className="sr-only" aria-live="polite" data-live="mode">{t('announceMode', { mode: t(modeLabel(meta.mode)) })}</div>
      <Composer
        backendId={backendId}
        tabId={tabId}
        running={running}
        requestPending={Boolean(request)}
        inputRef={input}
        onSend={send}
        onStop={interrupt}
        onCycleMode={mode.cycleMode}
      />
    </div>
  )
}
