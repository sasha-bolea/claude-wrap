import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react'
import type { Item } from '@claude-wrap/protocol'
import { useTabSubscription } from '../chatHooks.ts'
import { t } from '../i18n.ts'
import { modeLabel } from '../modes.ts'
import type { Answer } from '../RequestPanel.tsx'
import { useScreen, useTouch, type LaterKey } from './context.tsx'
import { AccountPickSheet, accountName } from './accounts.tsx'
import { Conversation } from './Conversation.tsx'
import { Icon } from './icons.tsx'
import { baseName, sessionState } from './model.ts'
import { ModelSheet, modelLabel, useModels } from './modelSheets.tsx'
import { Badge, ConnectionBanner, IconButton, UpdateBar, useQuery } from './parts.tsx'
import { pauseWords } from './queue.tsx'
import { CloseButton, RenameSheet, useTrustPrompt } from './sessions.tsx'
import { TouchComposer } from './TouchComposer.tsx'

type UserItem = Extract<Item, { kind: 'user' }>

// At the bottom within this distance (px): new text keeps the chat scrolled down.
const FOLLOW = 60
// Dragging the ghost up past this distance puts it away.
const GHOST_AWAY = 28
// Panels of a session that come later (🔜), in the session menu.
const SESSION_PANELS: LaterKey[] = ['context', 'usage', 'tasks', 'todo', 'diff', 'mcp', 'hooks', 'status']

// The ghost of your message whose answer you are reading, once it has scrolled off the top and you scroll up from the
// bottom: a tap goes back to it, a drag up puts it away until that message is on screen again. Gone at the bottom of
// the chat and while the keyboard is open.
function useGhost(conversation: React.RefObject<HTMLDivElement | null>) {
  const [ghost, setGhost] = useState<{ id: string; text: string }>()
  const dismissed = useRef<string | undefined>(undefined)
  const update = useCallback(() => {
    const box = conversation.current
    if (!box) return
    const top = box.getBoundingClientRect().top + 8
    let found: HTMLElement | undefined
    for (const bubble of box.querySelectorAll<HTMLElement>('.msg-user')) if (bubble.getBoundingClientRect().bottom < top) found = bubble
    const away = dismissed.current ? box.querySelector<HTMLElement>(`[data-msg="${dismissed.current}"]`) : null
    if (dismissed.current && (!away || away.getBoundingClientRect().bottom >= top)) dismissed.current = undefined
    const keyboard = box.closest('.device')?.classList.contains('kb-open')
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW
    if (!found || atBottom || found.dataset.msg === dismissed.current || keyboard) return setGhost(undefined)
    const text = [...found.childNodes].filter((node) => !(node instanceof HTMLElement && (node.classList.contains('thumbs') || node.classList.contains('pending-note')))).map((node) => node.textContent).join('').trim()
    const label = `${found.querySelector('.thumbs') ? '🖼 ' : ''}${text}`
    const id = found.dataset.msg!
    setGhost((current) => (current?.id === id && current.text === label ? current : { id, text: label }))
  }, [conversation])
  const dismiss = () => {
    dismissed.current = ghost?.id
    setGhost(undefined)
  }
  return { ghost, update, dismiss }
}

// The chat of a session: top bar (back, title = session menu, Torna indietro, Coda, ⋯), the conversation with
// Claude's request inside it, the ghost of your message and "Torna giù", and the floating dock (composer + queue).
export function ChatScreen({ tabId }: { tabId: string }) {
  const touch = useTouch()
  const { state, connection, back, openSheet, go, fail } = touch
  const { top } = useScreen()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const view = state.transcripts[tabId]
  useTabSubscription(connection, tabId, fail)
  const [queueMode, setQueueMode] = useState(false)
  const [follow, setFollow] = useState(true)
  const [missed, setMissed] = useState(false)
  const screen = useRef<HTMLElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const ghostDrag = useRef<{ y: number; dy: number } | undefined>(undefined)
  const ghostElement = useRef<HTMLButtonElement>(null)
  const { ghost, update: updateGhost, dismiss: dismissGhost } = useGhost(conversation)
  const askTrust = useTrustPrompt()
  const loadImage = useCallback((imageId: string) => connection.request('blob.get', { tabId, imageId }), [connection, tabId])

  const toBottom = () => {
    const box = conversation.current
    if (box) box.scrollTop = box.scrollHeight
  }
  // New content: scrolled down while following, otherwise the "Torna giù" button gets a dot.
  useLayoutEffect(() => {
    if (follow) toBottom()
    else setMissed(true)
    updateGhost()
  }, [view?.items, view?.requests])
  // The dock floats over the conversation, which leaves room for it under its last message.
  useEffect(() => {
    const element = dock.current
    if (!element || !window.ResizeObserver) return
    const observer = new ResizeObserver(() => {
      screen.current?.style.setProperty('--dock-h', `${Math.round(element.offsetHeight)}px`)
      if (follow) toBottom()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [follow])
  // A drag on the dock never scrolls the page (only the text inside the field, when it overflows).
  useEffect(() => {
    const element = dock.current
    if (!element) return
    const block = (event: globalThis.TouchEvent) => {
      const field = (event.target as Element).closest('textarea')
      if (!field || field.scrollHeight <= field.clientHeight) event.preventDefault()
    }
    element.addEventListener('touchmove', block, { passive: false })
    return () => element.removeEventListener('touchmove', block)
  }, [])
  // Back on top (from File, Note): the conversation at the bottom again if it was following.
  useEffect(() => {
    if (top && follow) toBottom()
  }, [top])

  if (!meta) return null
  const request = view?.requests[0]
  const running = meta.status === 'running' || meta.status === 'starting'
  const busy = running || Boolean(request)
  const otherWaiting = state.tabs.some((tab) => tab.tabId !== tabId && tab.status === 'requires_action')
  const onScroll = () => {
    const box = conversation.current!
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW
    setFollow(atBottom)
    if (atBottom) setMissed(false)
    updateGhost()
  }
  const answer = (requestId: string, choice: Answer) => connection.request('request.answer', { tabId, requestId, ...choice }).catch(fail)
  const openMenu = () => openSheet({ title: meta.title, body: <SessionMenu tabId={tabId} /> })
  const sendNow = (item: UserItem) => connection.request('tab.sendPendingNow', { tabId, itemId: item.itemId }).catch(fail)
  const openActions = (item: UserItem) => openSheet({ title: t('yourMessage'), body: <MessageActions item={item} tabId={tabId} /> })
  const toggleQueue = () => {
    setQueueMode(!queueMode)
    if (!queueMode) screen.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }
  const queueCount = meta.queuePause ? undefined : meta.queue.length ? String(meta.queue.length) : undefined
  const queueLabel = `${t('queue')}: ${meta.queue.length ? t('queuedCount', { count: String(meta.queue.length) }) : t('queueEmptyShort')}${meta.queuePause ? `, ${pauseWords(meta)}` : ''}`

  // Ghost: drag up to put away; a tap scrolls back to the message.
  const onGhostStart = (event: TouchEvent) => (ghostDrag.current = { y: event.touches[0]!.clientY, dy: 0 })
  const onGhostMove = (event: TouchEvent) => {
    if (!ghostDrag.current || !ghostElement.current) return
    ghostDrag.current.dy = Math.min(0, event.touches[0]!.clientY - ghostDrag.current.y)
    ghostElement.current.style.transform = `translateY(${ghostDrag.current.dy}px)`
    ghostElement.current.style.opacity = String(Math.max(0, 1 + ghostDrag.current.dy / 90))
  }
  const onGhostEnd = () => {
    const drag = ghostDrag.current
    if (!drag || !ghostElement.current) return
    ghostElement.current.style.transform = ghostElement.current.style.opacity = ''
    if (drag.dy < -GHOST_AWAY) dismissGhost()
    if (drag.dy > -6) ghostDrag.current = undefined
  }
  const onGhostClick = () => {
    if (ghostDrag.current) return void (ghostDrag.current = undefined)
    conversation.current?.querySelector(`[data-msg="${ghost?.id}"]`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <section className="screen chat-screen" ref={screen} aria-label={t('chat')}>
      <header className="topbar">
        <IconButton icon="back" label={otherWaiting ? t('backWaiting') : t('back')} dot={otherWaiting} onClick={back} />
        <button className="title-btn" aria-haspopup="dialog" onClick={openMenu}>
          <Badge state={sessionState(meta)} />
          <span className="title-text">
            <span>{meta.title}</span>
            <span className="sub">{baseName(meta.cwd)}</span>
          </span>
        </button>
        <IconButton icon="rewind" className={busy ? 'dim' : undefined} label={busy ? t('rewindStopFirst') : t('rewindLabel')} onClick={() => (busy ? touch.toast(t('stopFirst')) : go({ name: 'later', key: 'rewind', tabId }))} />
        <IconButton icon="queue" className={`queue-btn${queueMode ? ' on' : ''}`} label={queueLabel} count={queueCount} countIcon={meta.queuePause ? 'pause' : undefined} expanded={queueMode} onClick={toggleQueue} />
        <IconButton icon="more" label={t('moreActions')} onClick={openMenu} />
      </header>
      <UpdateBar />
      <ConnectionBanner />
      <div className="chat-body">
        <div className="conversation" ref={conversation} onScroll={onScroll} aria-live="off">
          <Conversation meta={meta} view={view} loadImage={loadImage} onAnswer={answer} onRestart={() => void connection.request('tab.restart', { tabId }).catch(fail)} onTrust={() => askTrust(meta.cwd, () => undefined)} onActions={openActions} onSendNow={sendNow} />
        </div>
        {ghost && (
          <>
            <button className="ghost" ref={ghostElement} aria-label={t('ghostLabel', { text: ghost.text })} onClick={onGhostClick} onTouchStart={onGhostStart} onTouchMove={onGhostMove} onTouchEnd={onGhostEnd}>
              <span className="ghost-bubble">
                <span className="clamp-2">{ghost.text}</span>
              </span>
            </button>
            <button className="sr-only" onClick={dismissGhost}>
              {t('ghostHide')}
            </button>
          </>
        )}
        {!follow && (
          <button className={`jump${request ? ' ask' : ''}`} aria-label={request ? t('jumpRequest') : t('jumpBottom')} onClick={() => (setFollow(true), setMissed(false), toBottom())}>
            {request && <span>{t('claudeWaitsYou')}</span>}
            <Icon name="down" />
            {missed && <span className="dot" />}
          </button>
        )}
      </div>
      <div className="dock" ref={dock}>
        <TouchComposer meta={meta} queueMode={queueMode} running={running} requestOpen={Boolean(request)} onFocusField={() => (setFollow(true), toBottom())} />
      </div>
    </section>
  )
}

// The session menu (⋯ and the title): where it runs and with what; File, Note, Torna indietro, model and effort,
// account, rename, fork, restart, the panels to come, close.
function SessionMenu({ tabId }: { tabId: string }) {
  const { state, connection, go, openSheet, closeSheets, toast, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const models = useModels(tabId)
  const notes = useQuery(() => (meta ? connection.request('notes.list', { cwd: meta.cwd }) : Promise.resolve(undefined)), [connection, meta?.cwd, state.notesVersion[meta?.cwd ?? '']])
  if (!meta) return null
  const busy = meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action'
  // "Modello" alone for a model without effort levels (unknown until the model sheet asked: assume it has them).
  const levels = models?.find((model) => model.value === (meta.model ?? 'default'))?.supportedEffortLevels
  const modelTitle = models && !levels?.length ? t('model') : t('modelAndEffort')
  const stopped = meta.status === 'error'
  const fork = () =>
    connection.request('tab.fork', { tabId, newTabId: crypto.randomUUID() }).then(() => {
      closeSheets()
      toast(t('forked', { title: `${meta.title} (fork)` }))
    }, fail)
  const restart = () =>
    connection.request('tab.restart', { tabId }).then(() => {
      closeSheets()
      toast(t('restarted'))
    }, fail)
  return (
    <>
      <div className="card compact">
        <span className="mono-line">{meta.cwd}</span>
        <span className="muted">{`${modelLabel(meta, models)} · ${t(modeLabel(meta.mode))}`}</span>
      </div>
      <ul className="menu">
        <li>
          <button onClick={() => go({ name: 'files', tabId })}>{t('folderFiles')}</button>
        </li>
        <li>
          <button onClick={() => go({ name: 'notes', tabId })}>
            {t('folderNotes')}
            {notes.data && <span className="right">{notes.data.notes.length}</span>}
          </button>
        </li>
        <li>
          <button disabled={busy} onClick={() => go({ name: 'later', key: 'rewind', tabId })}>
            {t('rewindLabel')}
            {busy && <span className="right">{t('stopFirstShort')}</span>}
          </button>
        </li>
        <li>
          <button onClick={() => openSheet({ title: modelTitle, body: <ModelSheet tabId={tabId} /> })}>
            {modelTitle}
            <span className="right">{modelLabel(meta, models)} ›</span>
          </button>
        </li>
        <li>
          <button onClick={() => openSheet({ title: t('account'), body: <AccountPickSheet tabId={tabId} /> })}>
            {t('account')}
            <span className="right">{accountName(state, meta.account)} ›</span>
          </button>
        </li>
        <li>
          <button onClick={() => openSheet({ title: t('rename'), field: true, body: <RenameSheet tabId={tabId} current={meta.title} /> })}>{t('rename')}</button>
        </li>
        <li>
          <button onClick={() => void fork()}>{t('forkLong')}</button>
        </li>
        {stopped && (
          <li>
            <button onClick={() => void restart()}>{t('restartClaude')}</button>
          </li>
        )}
      </ul>
      <p className="label">{t('panelsLater')}</p>
      <ul className="menu">
        {SESSION_PANELS.map((key) => (
          <li key={key}>
            <button onClick={() => go({ name: 'later', key, tabId })}>
              {t(`later_${key}`)}
              <span className="right">{t('laterShort')} ›</span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="menu">
        <li>
          <CloseButton tab={meta} />
        </li>
      </ul>
    </>
  )
}

// Long press on one of your messages: copy its text (going back to before it comes with Torna indietro).
function MessageActions({ item, tabId }: { item: UserItem; tabId: string }) {
  const { state, go, closeSheets, toast } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const busy = meta ? meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action' : true
  const copy = () => {
    closeSheets()
    navigator.clipboard?.writeText(item.text).then(() => toast(t('textCopied')), () => toast(t('copyFailed')))
  }
  return (
    <>
      <p className="rewind-quote">
        <span className="clamp-4">{item.text}</span>
      </p>
      <ul className="menu">
        <li>
          <button onClick={copy}>{t('copyText')}</button>
        </li>
        <li>
          <button disabled={busy} onClick={() => go({ name: 'later', key: 'rewind', tabId })}>
            {t('rewindToBefore')}
            {busy && <span className="right">{t('stopFirstShort')}</span>}
          </button>
        </li>
      </ul>
    </>
  )
}
