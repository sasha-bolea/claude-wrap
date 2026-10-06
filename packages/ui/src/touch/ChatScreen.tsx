import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react'
import type { Item } from '@athome/protocol'
import { useTabSubscription } from '../chatHooks.ts'
import { t } from '../i18n.ts'
import { modeLabel } from '../modes.ts'
import type { Answer } from '../chatHooks.ts'
import { useScreen, useTouch, type LaterKey } from './context.tsx'
import { AccountPickSheet, accountName } from './accounts.tsx'
import { Conversation, WorkingLine, WorkingMini } from './Conversation.tsx'
import { Icon } from './icons.tsx'
import { baseName, sessionState } from './model.ts'
import { ModeSheet, ModelSheet, currentEffort, modelLabel, useModels } from './modelSheets.tsx'
import { Badge, ConnectionBanner, IconButton, UpdateBar, useQuery } from './parts.tsx'
import { CloseButton, RenameSheet, useTrustPrompt } from './sessions.tsx'
import { useOpenTerminal } from './TerminalScreen.tsx'
import { TouchComposer } from './TouchComposer.tsx'

type UserItem = Extract<Item, { kind: 'user' }>

// At the bottom within this distance (px): new text keeps the chat scrolled down.
const FOLLOW = 60
// Following new text, each frame covers this share of the way still left to the bottom (an ease-out glide).
const GLIDE_SHARE = 0.2
// The working line is out of view (behind the dock) once it sits this far (px) under its place at the bottom: its
// height 20 + the 10 it floats over the dock.
const WORKING_OUT = 30
// A finger moving the chat faster than this (px/ms, over its last move) closes the keyboard; slower leaves it open.
const KEYBOARD_CLOSE_SPEED = 0.6
// Dragging the ghost up past this distance puts it away.
const GHOST_AWAY = 28
// Bottom of a one-line ghost under the top of the conversation (px: .ghost top 12 + bubble 44), until one is measured.
const GHOST_BOTTOM = 56
// Panels of a session that come later (🔜), in the session menu.
const SESSION_PANELS: LaterKey[] = ['tasks', 'todo', 'diff', 'mcp', 'hooks', 'status']

// The ghost of your message whose answer you are reading, once it has scrolled off the top and you scroll up from the
// bottom: a tap goes back to it, a drag up puts it away until that message is on screen again. Gone at the bottom of
// the chat and while the keyboard is open. It leaves as soon as your next message touches it, so the two never overlap
// (that message's own ghost comes in once it has scrolled off the top).
// Parameters: the conversation and the ghost's element. Returns the ghost, `update` (on scroll and new content), `dismiss`.
function useGhost(conversation: React.RefObject<HTMLDivElement | null>, element: React.RefObject<HTMLButtonElement | null>) {
  const [ghost, setGhost] = useState<{ id: string; text: string }>()
  const dismissed = useRef<string | undefined>(undefined)
  // Bottom of the ghost from the top of the conversation (px), kept from the last time it was on screen.
  const ghostBottom = useRef(GHOST_BOTTOM)
  const update = useCallback(() => {
    const box = conversation.current
    if (!box) return
    const top = box.getBoundingClientRect().top + 8
    const bubbles = [...box.querySelectorAll<HTMLElement>('.msg-user')]
    const index = bubbles.findLastIndex((bubble) => bubble.getBoundingClientRect().bottom < top)
    const found = bubbles[index]
    const ghostElement = element.current
    if (ghostElement) ghostBottom.current = ghostElement.offsetTop + ghostElement.offsetHeight
    const next = bubbles[index + 1]
    const touching = next !== undefined && next.getBoundingClientRect().top < box.getBoundingClientRect().top + ghostBottom.current
    const away = dismissed.current ? box.querySelector<HTMLElement>(`[data-msg="${dismissed.current}"]`) : null
    if (dismissed.current && (!away || away.getBoundingClientRect().bottom >= top)) dismissed.current = undefined
    const keyboard = box.closest('.device')?.classList.contains('kb-open')
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW
    if (!found || touching || atBottom || found.dataset.msg === dismissed.current || keyboard) return setGhost(undefined)
    const text = [...found.childNodes].filter((node) => !(node instanceof HTMLElement && (node.classList.contains('thumbs') || node.classList.contains('pending-note')))).map((node) => node.textContent).join('').trim()
    const label = `${found.querySelector('.thumbs') ? '🖼 ' : ''}${text}`
    const id = found.dataset.msg!
    setGhost((current) => (current?.id === id && current.text === label ? current : { id, text: label }))
  }, [conversation, element])
  const dismiss = () => {
    dismissed.current = ghost?.id
    setGhost(undefined)
  }
  return { ghost, update, dismiss }
}

// The conversation's scroll indicator on a touch screen. iOS draws its own down to the bottom of the scroller, behind
// the dock's blur, and has no inset for it: the native one is hidden (touch.css) and this one runs from the top of the
// conversation to just above the dock. It shows while scrolling and fades out like the native one.
// Parameters: the conversation and the dock. Returns the thumb's ref and `place`, to call on scroll and on resize.
function useScrollThumb(conversation: React.RefObject<HTMLDivElement | null>, dock: React.RefObject<HTMLDivElement | null>) {
  const thumb = useRef<HTMLDivElement>(null)
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const place = useCallback((show: boolean) => {
    const box = conversation.current
    const element = thumb.current
    if (!box || !element) return
    const dockHeight = dock.current?.offsetHeight ?? 0
    const track = box.clientHeight - dockHeight - 6
    const range = box.scrollHeight - box.clientHeight
    if (range <= 0 || track <= 0) return element.classList.remove('on')
    const size = Math.max(36, Math.min(track, (track * (box.clientHeight - dockHeight)) / (box.scrollHeight - dockHeight)))
    const offset = Math.min(1, Math.max(0, box.scrollTop / range)) * (track - size)
    element.style.height = `${Math.round(size)}px`
    element.style.transform = `translateY(${Math.round(offset)}px)`
    if (!show) return
    element.classList.add('on')
    clearTimeout(fade.current)
    fade.current = setTimeout(() => element.classList.remove('on'), 900)
  }, [conversation, dock])
  useEffect(() => () => clearTimeout(fade.current), [])
  return { thumb, place }
}

// The chat of a session: top bar (back, title and folder = session menu with the model under them, Torna indietro, ⋯), the conversation with
// Claude's request inside it, the ghost of your message and "Torna giù", and the floating dock (composer + queue).
export function ChatScreen({ tabId }: { tabId: string }) {
  const touch = useTouch()
  const { state, connection, back, openSheet, go, fail } = touch
  const { top } = useScreen()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const view = state.transcripts[tabId]
  const models = useModels(tabId)
  useTabSubscription(connection, tabId, fail)
  const [follow, setFollow] = useState(true)
  // follow for the dock's observer, which lives as long as the chat.
  const following = useRef(follow)
  following.current = follow
  const [missed, setMissed] = useState(false)
  // The working line's element and whether it is out of view (then its mini label shows).
  const workingLine = useRef<HTMLDivElement>(null)
  const [lineOut, setLineOut] = useState(false)
  const screen = useRef<HTMLElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const ghostDrag = useRef<{ y: number; dy: number } | undefined>(undefined)
  const ghostElement = useRef<HTMLButtonElement>(null)
  const { ghost, update: updateGhost, dismiss: dismissGhost } = useGhost(conversation, ghostElement)
  const { thumb, place: placeThumb } = useScrollThumb(conversation, dock)
  // The ghost on screen: once `ghost` goes away it stays for its slide back up (`.leaving`), then it is removed.
  const [lastGhost, setLastGhost] = useState(ghost)
  const shownGhost = ghost ?? lastGhost
  useLayoutEffect(() => {
    if (ghost) {
      setLastGhost(ghost)
      // Back while sliding away after a drag: it starts again from its place, not from where the finger left it.
      if (ghostElement.current) ghostElement.current.style.transform = ghostElement.current.style.opacity = ''
      return
    }
    const timer = setTimeout(() => setLastGhost(undefined), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200)
    return () => clearTimeout(timer)
  }, [ghost])
  const askTrust = useTrustPrompt()
  const loadImage = useCallback((imageId: string) => connection.request('blob.get', { tabId, imageId }), [connection, tabId])

  // A glide to the bottom in progress (its animation frame) and the position its last step set, and whether a finger
  // is on the chat.
  const glide = useRef<number | undefined>(undefined)
  const glideAt = useRef(0)
  const touching = useRef(false)
  // Where and when the finger last moved on the chat (speed of the drag).
  const lastMove = useRef<{ y: number; at: number } | undefined>(undefined)
  // A quick drag was seen while the keyboard is open: the field lets go when the finger lifts, never mid-pan (the
  // keyboard closing resizes the viewport under the finger and cancels the native scroll).
  const closeKeyboard = useRef(false)
  // The chat should go to the bottom but a finger was down: done when it lifts (if still following).
  const pendingBottom = useRef(false)
  // A quick drag on the chat while the keyboard is open marks it to close; a slow one reads on.
  const onChatTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]!.clientY
    const at = event.timeStamp
    const last = lastMove.current
    lastMove.current = { y, at }
    if (!last || at <= last.at || !screen.current?.closest('.device')?.classList.contains('kb-open')) return
    if (Math.abs(y - last.y) / (at - last.at) < KEYBOARD_CLOSE_SPEED) return
    closeKeyboard.current = true
  }
  // The finger lifted (or the touch was cancelled): the deferred keyboard close (only on a real end: a cancel can come
  // from iOS taking the pan over, and closing the keyboard then is the very resize we avoid) and the deferred scroll.
  const onChatTouchEnd = (ended: boolean) => {
    touching.current = false
    const close = closeKeyboard.current
    closeKeyboard.current = false
    if (ended && close) {
      const field = document.activeElement
      if (field instanceof HTMLElement && screen.current?.contains(field)) field.blur()
    }
    if (pendingBottom.current) {
      pendingBottom.current = false
      if (following.current) toBottom()
    }
  }
  // The working line follows the end of the text: moved down by the distance left to the bottom (a CSS variable, no
  // layout, no scrollTop). Called when the user scrolls and when text arrives while not following; while following,
  // the glide never moves it. `rest`: back in its place (the chat is going to the bottom).
  const placeWorking = (rest = false) => {
    const box = conversation.current
    const element = workingLine.current
    if (!box || !element) return
    const distance = rest ? 0 : box.scrollHeight - box.clientHeight - box.scrollTop
    element.style.setProperty('--working-y', `${distance}px`)
    setLineOut(distance >= WORKING_OUT)
  }
  const stopGlide = () => {
    if (glide.current !== undefined) cancelAnimationFrame(glide.current)
    glide.current = undefined
  }
  const toBottom = () => {
    stopGlide()
    const box = conversation.current
    if (box) box.scrollTop = box.scrollHeight
    placeWorking(true)
  }
  // A scroll to the bottom caused by a layout change: with a finger on the chat it waits for the finger to lift.
  const settleBottom = () => {
    if (touching.current) pendingBottom.current = true
    else toBottom()
  }
  // Follows new text without jumps: each frame the chat moves a share of the way still left, so the bottom is
  // reached softly however the text arrives. Farther than a screen (a history loaded), with reduced motion or while
  // a finger is on the chat it goes at once (or not at all). Moved by anything else (a wheel, a fling), it gives way.
  const glideToBottom = () => {
    const box = conversation.current
    if (!box || touching.current) return
    if (box.scrollHeight - box.clientHeight - box.scrollTop > box.clientHeight || matchMedia('(prefers-reduced-motion: reduce)').matches) return toBottom()
    if (glide.current !== undefined) return
    placeWorking(true)
    glideAt.current = box.scrollTop
    const step = () => {
      const left = box.scrollHeight - box.clientHeight - box.scrollTop
      if (left <= 1 || touching.current || Math.abs(box.scrollTop - glideAt.current) > 1) return void (glide.current = undefined)
      box.scrollTop += Math.max(1, Math.ceil(left * GLIDE_SHARE))
      glideAt.current = box.scrollTop
      glide.current = requestAnimationFrame(step)
    }
    glide.current = requestAnimationFrame(step)
  }
  useEffect(() => stopGlide, [])
  // New content: followed down while at the bottom, otherwise the "Torna giù" button gets a dot.
  useLayoutEffect(() => {
    if (follow) glideToBottom()
    else (setMissed(true), placeWorking())
    updateGhost()
  }, [view?.items, view?.requests])
  // The line appears (a turn starts): in its place, or where the text's end is if the chat is scrolled up.
  useLayoutEffect(() => placeWorking(following.current), [meta?.status === 'running' || meta?.status === 'starting'])
  // The dock floats over the conversation, which leaves room for it under its last message. Only a real change of the
  // dock's height moves the chat: reaching the bottom by hand is never touched, or iOS would cut its bounce short.
  useEffect(() => {
    const element = dock.current
    if (!element || !window.ResizeObserver) return
    let height: number | undefined
    const observer = new ResizeObserver(() => {
      const next = Math.round(element.offsetHeight)
      if (next === height) return
      height = next
      screen.current?.style.setProperty('--dock-h', `${next}px`)
      if (following.current) settleBottom()
      placeThumb(false)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // A drag on the dock never scrolls the page (only the text inside the field, when it overflows). With text selected
  // in the field nothing is blocked: the drag may be a selection handle (iOS draws them past the field's edges too).
  useEffect(() => {
    const element = dock.current
    if (!element) return
    const block = (event: globalThis.TouchEvent) => {
      const focused = document.activeElement
      if (focused instanceof HTMLTextAreaElement && element.contains(focused) && focused.selectionStart !== focused.selectionEnd) return
      const field = (event.target as Element).closest('textarea')
      if (!field || field.scrollHeight <= field.clientHeight) event.preventDefault()
    }
    element.addEventListener('touchmove', block, { passive: false })
    return () => element.removeEventListener('touchmove', block)
  }, [])
  // This chat on screen (again after a reconnection): core holds its next queued message for a countdown here.
  const connected = state.status === 'connected'
  useEffect(() => {
    if (!top || !connected) return
    void connection.request('client.watch', { tabId }).catch(() => undefined)
    return () => void connection.request('client.watch', {}).catch(() => undefined)
  }, [top, connected, tabId, connection])
  // Back on top (from File, Note): the conversation at the bottom again if it was following.
  useEffect(() => {
    if (top && follow) settleBottom()
  }, [top])

  if (!meta) return null
  const request = view?.requests[0]
  const running = meta.status === 'running' || meta.status === 'starting'
  const busy = running || Boolean(request)
  const otherWaiting = state.tabs.some((tab) => tab.tabId !== tabId && tab.status === 'requires_action')
  const onScroll = () => {
    const box = conversation.current!
    // The glide's own steps: the chat keeps following (new text may outrun it for a moment). Any other move stops it.
    if (glide.current !== undefined && !touching.current && Math.abs(box.scrollTop - glideAt.current) <= 1) return void (updateGhost(), placeThumb(false))
    stopGlide()
    placeWorking()
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW
    setFollow(atBottom)
    if (atBottom) setMissed(false)
    updateGhost()
    placeThumb(true)
  }
  const answer = (requestId: string, choice: Answer) => connection.request('request.answer', { tabId, requestId, ...choice }).catch(fail)
  const openMenu = () => openSheet({ title: meta.title, body: <SessionMenu tabId={tabId} /> })
  const unsend = useUnsend(tabId)
  const sendNow = (item: UserItem) => connection.request('tab.sendPendingNow', { tabId, itemId: item.itemId }).catch(fail)
  const openActions = (item: UserItem) => openSheet({ title: t('yourMessage'), body: <MessageActions item={item} tabId={tabId} /> })

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
    // Put away: it slides on up from where the finger left it; otherwise back in its place.
    if (drag.dy < -GHOST_AWAY) dismissGhost()
    else ghostElement.current.style.transform = ghostElement.current.style.opacity = ''
    if (drag.dy > -6) ghostDrag.current = undefined
  }
  const onGhostClick = () => {
    if (ghostDrag.current) return void (ghostDrag.current = undefined)
    conversation.current?.querySelector(`[data-msg="${ghost?.id}"]`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <section className="screen chat-screen" ref={screen} aria-label={t('chat')}>
      <header className="topbar">
        {!touch.wide && <IconButton icon="back" label={otherWaiting ? t('backWaiting') : t('back')} dot={otherWaiting} onClick={back} />}
        {/* Title and folder (the session menu), the model under them */}
        <div className="title-stack">
          <button className="title-btn" aria-haspopup="dialog" onClick={openMenu}>
            <Badge state={sessionState(meta)} />
            <span className="title-text">
              <span>{meta.title}</span>
              <span className="sub">{baseName(meta.cwd)}</span>
            </span>
          </button>
          <button className="model-btn" aria-label={t('modelButtonLabel', { model: modelLabel(meta, models) })} onClick={() => openSheet({ title: t('model'), body: <ModelSheet tabId={tabId} /> })}>
            <span>{modelLabel(meta, models)}</span>
            <Icon name="down" />
          </button>
        </div>
        {touch.wide && (
          <>
            <IconButton icon="files" className={touch.panel?.name === 'files' ? 'on' : undefined} label={t('folderFiles')} expanded={touch.panel?.name === 'files'} onClick={() => touch.togglePanel({ name: 'files', tabId })} />
            <IconButton icon="note" className={touch.panel?.name === 'notes' ? 'on' : undefined} label={t('folderNotes')} expanded={touch.panel?.name === 'notes'} onClick={() => touch.togglePanel({ name: 'notes', tabId })} />
          </>
        )}
        <IconButton icon="rewind" className={busy ? 'dim' : undefined} label={busy ? t('rewindStopFirst') : t('rewindLabel')} onClick={() => (busy ? touch.toast(t('stopFirst')) : go({ name: 'rewind', tabId }))} />
        <IconButton icon="more" label={t('moreActions')} onClick={openMenu} />
      </header>
      <UpdateBar />
      <ConnectionBanner />
      <div className="chat-body">
        <div className="conversation" ref={conversation} onScroll={onScroll} onTouchStart={() => ((touching.current = true), (closeKeyboard.current = false), (lastMove.current = undefined), stopGlide())} onTouchMove={onChatTouchMove} onTouchEnd={() => onChatTouchEnd(true)} onTouchCancel={() => onChatTouchEnd(false)} onWheel={stopGlide} aria-live="off">
          <Conversation meta={meta} view={view} loadImage={loadImage} onAnswer={answer} onRestart={() => void connection.request('tab.restart', { tabId }).catch(fail)} onTrust={() => askTrust(meta.cwd, () => undefined)} onActions={openActions} onSendNow={sendNow} onUnsend={unsend} />
        </div>
        {running && <WorkingLine since={meta.status === 'running' ? meta.workingSince : undefined} lineRef={workingLine} />}
        {running && lineOut && <WorkingMini since={meta.status === 'running' ? meta.workingSince : undefined} />}
        <div className="scroll-thumb" ref={thumb} aria-hidden="true" />
        {shownGhost && (
          <>
            <button className={`ghost${ghost ? '' : ' leaving'}`} ref={ghostElement} aria-hidden={ghost ? undefined : true} tabIndex={ghost ? undefined : -1} aria-label={t('ghostLabel', { text: shownGhost.text })} onClick={onGhostClick} onTouchStart={onGhostStart} onTouchMove={onGhostMove} onTouchEnd={onGhostEnd}>
              <span className="ghost-bubble">
                <span className="clamp-2">{shownGhost.text}</span>
              </span>
            </button>
            {ghost && (
              <button className="sr-only" onClick={dismissGhost}>
                {t('ghostHide')}
              </button>
            )}
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
        <TouchComposer meta={meta} running={running} requestOpen={Boolean(request)} onFocusField={() => (setFollow(true), settleBottom())} />
      </div>
    </section>
  )
}

// The session menu (⋯ and the title): where it runs and with what; File, Note, Torna indietro, model, effort,
// account, rename, fork, restart, the panels to come, close.
function SessionMenu({ tabId }: { tabId: string }) {
  const { state, connection, go, openSheet, closeSheets, toast, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const models = useModels(tabId)
  const openTerminal = useOpenTerminal()
  const notes = useQuery(() => (meta ? connection.request('notes.list', { cwd: meta.cwd }) : Promise.resolve(undefined)), [connection, meta?.cwd, state.notesVersion[meta?.cwd ?? '']])
  if (!meta) return null
  const busy = meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action'
  // No "Impegno" item for a model known to have no effort levels (unknown until a sheet asked: assume it has them).
  const levels = models?.find((model) => model.value === (meta.model ?? 'default'))?.supportedEffortLevels
  const effort = currentEffort(meta, models)
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
        <span className="muted">{[modelLabel(meta, models), effort, t(modeLabel(meta.mode))].filter(Boolean).join(' · ')}</span>
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
          <button onClick={() => openTerminal({ tabId })}>{t('terminal')}</button>
        </li>
        <li>
          <button disabled={busy} onClick={() => go({ name: 'rewind', tabId })}>
            {t('rewindLabel')}
            {busy && <span className="right">{t('stopFirstShort')}</span>}
          </button>
        </li>
        <li>
          <button onClick={() => openSheet({ title: t('model'), body: <ModelSheet tabId={tabId} /> })}>
            {t('model')}
            <span className="right">{modelLabel(meta, models)} ›</span>
          </button>
        </li>
        {!(models && !levels?.length) && (
          <li>
            <button onClick={() => openSheet({ title: t('modeTitle'), body: <ModeSheet tabId={tabId} /> })}>
              {t('effort')}
              <span className="right">{effort ?? t('defaultEffortModel')} ›</span>
            </button>
          </li>
        )}
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
      <ul className="menu">
        {(['context', 'usage'] as const).map((name) => (
          <li key={name}>
            <button onClick={() => go({ name, tabId })}>
              {t(`later_${name}`)}
              <span className="right">›</span>
            </button>
          </li>
        ))}
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

// "Cancel send" of a message Claude has not read: it leaves the chat and its text and images go back into the composer
// (after what is already written there). Claude having read it meanwhile is a notice, not an error.
function useUnsend(tabId: string): (item: UserItem) => Promise<unknown> {
  const { connection, insertInComposer, toast, fail } = useTouch()
  return (item) =>
    connection.request('tab.unsendPending', { tabId, itemId: item.itemId }).then(
      ({ text, images }) => insertInComposer(tabId, { text, ...(images?.length ? { images } : {}) }),
      (error: unknown) => ((error as { code?: string }).code === 'invalid_args' ? toast(t('alreadyRead')) : fail(error))
    )
}

// Long press on one of your messages: copy its text (going back to before it comes with Torna indietro).
function MessageActions({ item, tabId }: { item: UserItem; tabId: string }) {
  const { state, go, closeSheets, toast } = useTouch()
  const unsend = useUnsend(tabId)
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
        {item.pending && (
          <li>
            <button onClick={() => (closeSheets(), void unsend(item))}>{t('unsendPending')}</button>
          </li>
        )}
        <li>
          <button disabled={busy} onClick={() => go({ name: 'rewind', tabId, itemId: item.itemId })}>
            {t('rewindToBefore')}
            {busy && <span className="right">{t('stopFirstShort')}</span>}
          </button>
        </li>
      </ul>
    </>
  )
}
