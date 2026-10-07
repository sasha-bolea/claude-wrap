import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type TouchEvent } from 'react'
import { ClientError } from '@athome/client'
import { LIMITS, type TabMeta } from '@athome/protocol'
import { useComposerPopup, useDraft, usePromptHistory } from '../composerHooks.ts'
import { applySuggestion, caretOnEdgeLine, expandPastes, isLongPaste, pastePlaceholder, trimBlankLines } from '../composerText.ts'
import { t } from '../i18n.ts'
import { dataUrl, readBase64, readImages } from '../images.ts'
import { modeLabel, nextMode } from '../modes.ts'
import { noteUsed } from '../notes.ts'
import type { Option } from '../Suggestions.tsx'
import { readLinkedNote, writeLinkedNote, type LinkedNote } from '../viewState.ts'
import { useTouch } from './context.tsx'
import { GaugeButton } from './gauge.tsx'
import { Icon, modeIcon } from './icons.tsx'
import { sizeLabel } from './model.ts'
import { ModeSheet } from './modelSheets.tsx'
import { IconButton, noteTitle } from './parts.tsx'
import { useUndoReset } from './keyboard.ts'
import { pauseWords, QueueTray } from './queue.tsx'
import { useTrustPrompt } from './sessions.tsx'

// Tallest the field grows before it scrolls (px).
const MAX_FIELD = 140
const SUGGESTIONS_ID = 'touch-suggestions'
const noHistory = () => Promise.resolve([])
// Enter sends only where there is a hardware keyboard (a pointer that hovers); on the phone it adds a line.
const enterSends = () => matchMedia('(hover: hover)').matches
// Two Esc presses within this time in an empty field open the rewind.
const ESCAPE_TWICE_MS = 600

// tab: shown as a tab sticking out of the input box's top left edge (the working time while its line is out of view).
type ComposerProps = { meta: TabMeta; running: boolean; requestOpen: boolean; onFocusField: () => void; tab?: ReactNode }

// Ring of the countdown around Stop (SVG units, a 44×44 box).
const RING_RADIUS = 20
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
// How often the countdown's seconds and ring move (ms).
const COUNTDOWN_TICK = 200

// The next queued message in the composer while it counts down to go: its text (and how many images), "parte tra N s"
// and Stop inside a ring that empties until it goes.
function QueuedCountdown({ text, images, until, onStop }: { text: string; images?: number; until: number; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const total = useRef(Math.max(1, until - Date.now()))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK)
    return () => clearInterval(timer)
  }, [until])
  const left = Math.max(0, until - now)
  const seconds = Math.ceil(left / 1000)
  return (
    <div className="countdown" role="status">
      <p className="countdown-text">
        {images ? `${t('imagesCount', { count: String(images) })} ` : ''}
        {text}
      </p>
      <div className="input-tools">
        <span className="countdown-label">{t('queuedGoesIn', { seconds: String(seconds) })}</span>
        <button className="countdown-stop" aria-label={t('stopQueued')} onClick={onStop}>
          <svg className="countdown-ring" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r={RING_RADIUS} strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - left / total.current)} />
          </svg>
          <Icon name="stop" />
        </button>
      </div>
    </div>
  )
}

// The composer of the touch layout: one box floating over the chat — the text on top; under it + (photos and
// files), permissions and the context gauge on the left; on the right Stop and Coda while Claude responds (Coda puts
// what is written straight into the queue), then Send (the model is in the chat's top bar, the effort in the mode sheet). `/` suggests
// commands, `@` files; `!` runs a shell command; long pastes collapse. Files that are not photos go to allegati/ and
// are mentioned.
// A note used in the message is deleted at send when at least 20% of it is still there. Prototype: NOTE-CONSEGNA §3.
export function TouchComposer({ meta, running, requestOpen, onFocusField, tab }: ComposerProps) {
  const { connection, backendId, openSheet, toast, snack, fail, inserts, clearInsert, go } = useTouch()
  const tabId = meta.tabId
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const undoReset = useUndoReset()
  const draft = useDraft(backendId, tabId, input)
  const { text, images } = draft
  const [docs, setDocs] = useState<File[]>([])
  const [linked, setLinkedState] = useState<LinkedNote | undefined>(() => readLinkedNote(backendId, tabId))
  // Previous messages (shared with the CLI): Up/Down and Ctrl+R where there is a hardware keyboard, none on the phone.
  const history = usePromptHistory(connection, meta.cwd)
  const suggestions = useComposerPopup(connection, tabId, enterSends() ? history.load : noHistory)
  const popup = suggestions.popup
  const askTrust = useTrustPrompt()
  const shellMode = text.startsWith('!')
  const hasContent = Boolean(text.trim() || images.length || docs.length)

  // The next queued message counting down to go (while this chat is on screen); Stop brings it back into the field,
  // before what was being written.
  const countdown = meta.queueCountdown
  const waiting = countdown && meta.queue.find((message) => message.queueId === countdown.queueId)
  const hold = () =>
    countdown &&
    connection.request('tab.queueHold', { tabId, queueId: countdown.queueId }).then(({ text: held, images: heldImages }) => {
      const joined = text.trim() ? `${held}\n\n${text}` : held
      draft.setValue(joined, held.length)
      if (heldImages?.length) draft.setImages([...heldImages, ...images])
      toast(t('queuedStopped'))
    }, fail)

  const setLinked = (note: LinkedNote | undefined) => {
    setLinkedState(note)
    writeLinkedNote(backendId, tabId, note)
  }
  // Grows with the text up to MAX_FIELD.
  useLayoutEffect(() => {
    const field = input.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD)}px`
  }, [text, undoReset])
  // Text sent here from File (Menziona in chat) or Note (Usa nel messaggio).
  const insert = inserts[tabId]
  useEffect(() => {
    if (!insert) return
    clearInsert(tabId)
    const joined = insert.replace ? insert.text : insert.noteId ? `${text.replace(/\s*$/, '')}\n\n${insert.text}`.trimStart() : `${text ? text.replace(/\s*$/, ' ') : ''}${insert.text}`
    draft.setValue(joined, joined.length)
    if (insert.images?.length) draft.setImages([...insert.images, ...images])
    if (insert.noteId) setLinked({ noteId: insert.noteId, text: insert.text })
  }, [insert])

  const change = (value: string, caret: number) => {
    draft.setValue(value)
    history.reset()
    suggestions.refresh(value, caret)
  }
  const pick = (option: Option) => {
    // A previous message (Ctrl+R) takes the field's place.
    if (popup?.kind === 'history') return void (draft.setValue(option.value, option.value.length), suggestions.close())
    if (!popup?.trigger) return
    const applied = applySuggestion(text, popup.trigger, option.value)
    draft.setValue(applied.text, applied.caret)
    if (applied.text.endsWith('/', applied.caret)) return suggestions.refresh(applied.text, applied.caret)
    suggestions.close()
  }
  // Photos are attached (downscaled); other files wait to go to allegati/ at send.
  const attach = async (files: File[]) => {
    const photos = files.filter((file) => file.type.startsWith('image/'))
    const others = files.filter((file) => !file.type.startsWith('image/'))
    const tooBig = others.filter((file) => file.size > LIMITS.fileBytes)
    if (tooBig.length) toast(t('fileTooLarge', { name: tooBig[0]!.name, max: sizeLabel(LIMITS.fileBytes) }))
    setDocs((current) => [...current, ...others.filter((file) => file.size <= LIMITS.fileBytes)])
    const { images: read, errors } = await readImages(photos, images.length, true)
    if (read.length) draft.setImages((current) => [...current, ...read])
    if (errors.length) toast(errors.join(' '))
  }
  // After a send: the linked note goes when the message still holds at least 20% of it (undo brings it back).
  const settleNote = (sent: string) => {
    if (!linked) return
    const note = linked
    setLinked(undefined)
    if (!noteUsed(note.text, sent)) return toast(t('noteKept'))
    connection.request('notes.delete', { cwd: meta.cwd, noteId: note.noteId }).then(
      () => snack(t('noteUsedDeleted', { title: noteTitle(note.text) }), () => void connection.request('notes.save', { cwd: meta.cwd, text: note.text }).catch(fail)),
      () => undefined
    )
  }
  // Sends (or runs as a shell command); toQueue: into the queue instead (the queue button). On failure everything goes
  // back into the composer; an untrusted folder opens the trust sheet first.
  const send = async (toQueue = false) => {
    if (!hasContent) return
    const sent = { text, images, docs, pastes: draft.pastes }
    const expanded = expandPastes(trimBlankLines(text), draft.pastes)
    history.reset()
    history.invalidate()
    draft.clear()
    setDocs([])
    suggestions.close()
    try {
      if (shellMode) {
        await connection.request('tab.shell', { tabId, command: sent.text.slice(1).trim() })
        return
      }
      const mentions: string[] = []
      for (const doc of sent.docs) {
        const { path } = await connection.request('files.write', { tabId, path: doc.name, data: await readBase64(doc), attachment: true })
        mentions.push(`@${path}`)
      }
      const message = [expanded.text, mentions.join(' ')].filter(Boolean).join('\n')
      const args = { tabId, text: message, ...(sent.images.length ? { images: sent.images } : {}), ...(expanded.pastes.length ? { pastes: expanded.pastes } : {}) }
      await connection.request(toQueue ? 'tab.queueAdd' : 'tab.send', args)
      settleNote(message)
    } catch (error) {
      draft.setValue(expanded.text || sent.text)
      draft.setImages(sent.images)
      setDocs(sent.docs)
      if (error instanceof ClientError && error.code === 'needs_trust') askTrust(meta.cwd, () => void send(toQueue))
      else fail(error)
    }
  }
  const stop = () => void connection.request('tab.interrupt', { tabId }).catch(fail)
  // When Esc was last pressed in the field (for Esc Esc).
  const lastEscape = useRef(0)
  // Esc twice quickly in an empty field (hardware keyboard) opens the rewind, as in the CLI. Returns whether it did;
  // the first press is left to the app's Esc (stops Claude), and while Claude still works the second says to stop first.
  const rewindOnSecondEscape = (): boolean => {
    const now = Date.now()
    const previous = lastEscape.current
    lastEscape.current = now
    if (!enterSends() || hasContent || now - previous > ESCAPE_TWICE_MS) return false
    lastEscape.current = 0
    if (running) toast(t('stopFirst'))
    else go({ name: 'rewind', tabId })
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    const choosing = Boolean(popup?.options.length)
    if (popup && event.key === 'Escape') suggestions.close()
    else if (event.key === 'Escape' && rewindOnSecondEscape()) event.stopPropagation()
    else if (choosing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) suggestions.move(event.key === 'ArrowDown' ? 1 : -1)
    else if (choosing && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) pick(popup!.options[popup!.active]!)
    else if (event.key === 'Enter' && !event.shiftKey && enterSends()) void send()
    else if (enterSends() && !choosing && keyboardAction(event)) return
    else return
    event.preventDefault()
  }
  // Hardware keyboard, as in the CLI prompt: Ctrl+R searches previous messages, Up on the first line / Down on the last
  // browse them, Shift+Tab switches the permission mode (not with a request open: there it moves focus back). Returns
  // whether the key was handled (its default then prevented).
  const keyboardAction = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const field = event.currentTarget
    const browse = (direction: 1 | -1) => void history.step(direction, text).then((value) => value !== undefined && draft.setValue(value, direction === 1 ? 0 : value.length))
    if (event.key === 'r' && event.ctrlKey) suggestions.openHistory(text)
    else if (event.key === 'ArrowUp' && !event.shiftKey && caretOnEdgeLine(field, 'first')) browse(1)
    else if (event.key === 'ArrowDown' && !event.shiftKey && history.browsing() && caretOnEdgeLine(field, 'last')) browse(-1)
    else if (event.key === 'Tab' && event.shiftKey && !requestOpen) void connection.request('tab.setMode', { tabId, mode: nextMode(meta.mode) }).catch(fail)
    else return false
    event.preventDefault()
    return true
  }
  // Files dropped on the chat are attached (photos as thumbnails, other files into allegati/), as with +.
  useEffect(() => {
    const chat = input.current?.closest<HTMLElement>('.chat-screen')
    if (!chat) return
    const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'))
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      chat.classList.add('dropping')
    }
    const leave = (event: DragEvent) => {
      if (!chat.contains(event.relatedTarget as Node | null)) chat.classList.remove('dropping')
    }
    const drop = (event: DragEvent) => {
      chat.classList.remove('dropping')
      if (!carriesFiles(event)) return
      event.preventDefault()
      void attach([...(event.dataTransfer?.files ?? [])])
    }
    chat.addEventListener('dragover', over)
    chat.addEventListener('dragleave', leave)
    chat.addEventListener('drop', drop)
    return () => {
      chat.removeEventListener('dragover', over)
      chat.removeEventListener('dragleave', leave)
      chat.removeEventListener('drop', drop)
    }
  })
  // Pasted images are attached; a long text paste becomes a placeholder (the whole text is sent).
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    const pasted = event.clipboardData.getData('text/plain')
    if (!files.length && !isLongPaste(pasted)) return
    event.preventDefault()
    if (files.length) return void attach(files)
    const { selectionStart, selectionEnd } = event.currentTarget
    const placeholder = pastePlaceholder(draft.addPaste(pasted), pasted)
    draft.setValue(text.slice(0, selectionStart) + placeholder + text.slice(selectionEnd), selectionStart + placeholder.length)
  }
  // The first tap focuses the field without letting iOS pan the whole page up (preventScroll); taps inside a focused
  // field (selection, caret) work as usual.
  const onTouchEnd = (event: TouchEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget
    if (document.activeElement === field) return
    event.preventDefault()
    field.focus({ preventScroll: true })
    field.setSelectionRange(field.value.length, field.value.length)
  }
  // Send and Stop while typing keep the keyboard open: they never take the focus from the field.
  const keepFocus = { onPointerDown: (event: PointerEvent) => document.activeElement === input.current && event.preventDefault() }
  const queueCount = meta.queuePause ? undefined : meta.queue.length ? String(meta.queue.length) : undefined
  // "Add to the queue (2 queued, paused …)": what the button does and what the queue holds.
  const queueLabel = `${t('addToQueue')} (${meta.queue.length ? t('queuedCount', { count: String(meta.queue.length) }) : t('queueEmptyShort')}${meta.queuePause ? `, ${pauseWords(meta)}` : ''})`

  return (
    <footer className={`composer${shellMode ? ' shell-mode' : ''}`}>
      {popup && popup.options.length > 0 && (
        <ul className="suggest" role="listbox" id={SUGGESTIONS_ID} aria-label={t(`suggestions_${popup.kind}`)}>
          {popup.options.map((option, index) => (
            <li key={option.key} id={`${SUGGESTIONS_ID}-${index}`} role="option" aria-selected={index === popup.active} onMouseDown={(event) => (event.preventDefault(), pick(option))}>
              <span className="s-label">{option.label}</span>
              {option.detail && <span className="s-detail">{option.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {(images.length > 0 || docs.length > 0) && (
        <div className="attachments" aria-label={t('attachments')}>
          {images.map((image, index) => (
            <div key={index} className="attachment">
              <img className="thumb" src={dataUrl(image)} alt={t('imageAlt', { n: String(index + 1) })} />
              <button aria-label={t('removeImage', { n: String(index + 1) })} onClick={() => draft.setImages(images.filter((other) => other !== image))}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
          {docs.map((doc, index) => (
            <div key={`${doc.name}-${index}`} className="attachment">
              <span className="doc-chip">
                <Icon name="file" />
                <span>
                  <strong>{doc.name}</strong>
                  <small>{sizeLabel(doc.size)}</small>
                </span>
              </span>
              <button aria-label={t('removeFile', { name: doc.name })} onClick={() => setDocs(docs.filter((other) => other !== doc))}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
        </div>
      )}
      {shellMode && <div className="shell-hint">{t('shellHintShort')}</div>}
      <div className="input-box">
        {tab}
        {waiting && countdown && <QueuedCountdown text={waiting.text} images={waiting.images} until={countdown.until} onStop={hold} />}
        <textarea
          key={undoReset}
          hidden={Boolean(waiting)}
          ref={input}
          rows={1}
          aria-label={t('composerLabel')}
          aria-autocomplete="list"
          aria-controls={popup?.options.length ? SUGGESTIONS_ID : undefined}
          aria-activedescendant={popup?.options.length ? `${SUGGESTIONS_ID}-${popup.active}` : undefined}
          placeholder={t('writeToClaude')}
          value={text}
          onChange={(event) => change(event.target.value, event.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onTouchEnd={onTouchEnd}
          onFocus={onFocusField}
          onBlur={() => suggestions.close()}
        />
        <div className="input-tools" hidden={Boolean(waiting)}>
          <IconButton icon="plus" label={t('attachPhotoOrFile')} onClick={() => picker.current?.click()} />
          <button className="icon-btn mode-btn" data-mode={meta.mode} aria-label={t('modeButtonLabel', { mode: t(modeLabel(meta.mode)) })} onClick={() => openSheet({ title: t('modeTitle'), body: <ModeSheet tabId={tabId} /> })}>
            <Icon name={modeIcon(meta.mode)} />
          </button>
          <GaugeButton meta={meta} />
          {(running || requestOpen) && (
            <>
              <button className="send stop" aria-label={t('stopClaude')} onClick={stop} {...keepFocus}>
                <Icon name="stop" />
              </button>
              <button className="send queue-btn" aria-label={queueLabel} disabled={!hasContent || shellMode} onClick={() => void send(true)} {...keepFocus}>
                <Icon name="queue" />
                {(queueCount || meta.queuePause) && (
                  <span className="count" aria-hidden="true">
                    {meta.queuePause ? <Icon name="pause" /> : queueCount}
                  </span>
                )}
              </button>
            </>
          )}
          <button className="send" aria-label={t(shellMode ? 'run' : 'send')} disabled={!hasContent} onClick={() => void send()} {...keepFocus}>
            <Icon name="send" />
          </button>
        </div>
      </div>
      <QueueTray meta={meta} />
      <input ref={picker} type="file" multiple hidden onChange={(event) => void attach([...(event.target.files ?? [])]).then(() => (event.target.value = ''))} />
    </footer>
  )
}
