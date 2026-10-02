import { useCallback, useEffect, useRef, useState } from 'react'
import { ClientError, type Connection, type TabView } from '@claude-wrap/client'
import type { Request, TabMeta } from '@claude-wrap/protocol'
import { ChatHeader } from './ChatHeader.tsx'
import { useAutoScroll, useFocusAfterRequest, useInterruptOnEscape, useModeSwitch, useTabSubscription } from './chatHooks.ts'
import { Composer, type Outgoing } from './Composer.tsx'
import { t } from './i18n.ts'
import { ItemView } from './ItemView.tsx'
import { MobileChatHeader } from './MobileChatHeader.tsx'
import { modeLabel } from './modes.ts'
import { QueueList } from './QueueList.tsx'
import { RequestPanel, type Answer } from './RequestPanel.tsx'
import { TrustDialog, type TrustCheck } from './TrustDialog.tsx'

export type ChatViewProps = {
  connection: Connection
  backendId: string
  meta: TabMeta
  view?: TabView
  openExternal?: (url: string) => void
  pathForFile?: (file: File) => string
  // Shows another tab (a fork just created).
  onOpenTab: (tabId: string) => void
  // Touch layout (phone): its own header with a back button, the request docked above the composer.
  mobile?: boolean
  // Another tab waits for an answer (mobile back button dot).
  otherWaiting?: boolean
  onBack?: () => void
}

// What screen readers hear: the open request (only when it changes) and the mode, in separate regions.
const requestAnnouncement = (request?: Request) => (request ? t('announceRequest', { what: request.title ?? request.displayName ?? request.toolName }) : '')

// Trust dialog of a tab whose folder is not trusted (restored tab, trust revoked): after "yes", the action
// that hit the gate (a message, a shell command) runs again.
function useTrustGate(connection: Connection, meta: TabMeta, onError: (failure: unknown) => void) {
  const [check, setCheck] = useState<TrustCheck>()
  const blocked = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (meta.status === 'needs_trust') connection.request('trust.check', { cwd: meta.cwd }).then(setCheck, onError)
    else setCheck(undefined)
  }, [connection, meta.status, meta.cwd, onError])
  const grant = () =>
    connection.request('trust.grant', { cwd: meta.cwd }).then(() => {
      const retry = blocked.current
      blocked.current = undefined
      retry?.()
    }, onError)
  return { check, grant, remember: (retry: () => void) => (blocked.current = retry) }
}

// One session: header, conversation, open request, composer.
export function ChatView({ connection, backendId, meta, view, openExternal, pathForFile, onOpenTab, mobile, otherWaiting, onBack }: ChatViewProps) {
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

  const trust = useTrustGate(connection, meta, onError)
  // Runs a command that may hit the trust gate: then it waits for the trust dialog's "yes".
  const run = (action: () => Promise<unknown>) => {
    setError(undefined)
    action().catch((failure: unknown) => {
      if (failure instanceof ClientError && failure.code === 'needs_trust') trust.remember(() => run(action))
      else onError(failure)
    })
  }
  const send = (message: Outgoing) => run(() => connection.request('tab.send', { tabId, ...message }))
  const shell = (command: string) => run(() => connection.request('tab.shell', { tabId, command }))
  const loadImage = useCallback((imageId: string) => connection.request('blob.get', { tabId, imageId }), [connection, tabId])
  const fork = () => connection.request('tab.fork', { tabId, newTabId: crypto.randomUUID() }).then(({ tabId: forked }) => onOpenTab(forked), onError)
  const restart = () => connection.request('tab.restart', { tabId }).catch(onError)
  // Answering moves the focus back to the composer, ready for the next message (not on a phone: the keyboard
  // would pop up over the conversation).
  const answer = (requestId: string, choice: Answer) => {
    if (!mobile) input.current?.focus()
    connection.request('request.answer', { tabId, requestId, ...choice }).catch(onError)
  }
  const close = () => {
    if (running && !window.confirm(t('closeConfirm'))) return
    connection.request('tab.close', { tabId }).catch(onError)
  }

  return (
    <div className="page chat" ref={panel} tabIndex={-1}>
      {mobile ? (
        <MobileChatHeader meta={meta} connection={connection} otherWaiting={Boolean(otherWaiting)} onBack={() => onBack?.()} onFork={() => void fork()} onClose={close} onError={onError} />
      ) : (
        <ChatHeader meta={meta} connection={connection} onMode={mode.setMode} onFork={() => void fork()} onClose={close} onError={onError} />
      )}
      <div className="conversation" ref={scroll.ref} onScroll={scroll.onScroll}>
        {view?.items.map((item) => <ItemView key={item.itemId} item={item} openExternal={openExternal} loadImage={loadImage} />)}
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
        {meta.queue.length > 0 && (
          <QueueList
            queue={meta.queue}
            onSendNow={(queueId) => void connection.request('tab.sendNow', { tabId, queueId }).catch(onError)}
            onRemove={(queueId) => void connection.request('tab.unqueue', { tabId, queueId }).catch(onError)}
          />
        )}
        {request && !mobile && <RequestPanel key={request.requestId} request={request} onAnswer={(choice) => answer(request.requestId, choice)} openExternal={openExternal} />}
        {error && <p className="item notice error" role="alert">{error}</p>}
      </div>
      {request && mobile && (
        <div className="request-dock">
          <RequestPanel key={request.requestId} request={request} onAnswer={(choice) => answer(request.requestId, choice)} openExternal={openExternal} />
        </div>
      )}
      <div className="sr-only" aria-live="polite" data-live="request">{requestAnnouncement(request)}</div>
      <div className="sr-only" aria-live="polite" data-live="mode">{t('announceMode', { mode: t(modeLabel(meta.mode)) })}</div>
      <Composer
        connection={connection}
        backendId={backendId}
        meta={meta}
        running={running}
        requestPending={Boolean(request)}
        inputRef={input}
        pathForFile={pathForFile}
        onSend={send}
        onShell={shell}
        onStop={interrupt}
        onCycleMode={mode.cycleMode}
        onError={(message) => setError(message)}
        mobile={mobile}
        onMode={mode.setMode}
      />
    </div>
  )
}
