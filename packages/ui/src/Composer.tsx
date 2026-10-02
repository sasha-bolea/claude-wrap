import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { Image, PermissionMode, TabMeta } from '@claude-wrap/protocol'
import { useComposerPopup, usePromptHistory } from './composerHooks.ts'
import { applySuggestion, expandPastes, isLongPaste, mention, pastePlaceholder } from './composerText.ts'
import { t } from './i18n.ts'
import { Icon } from './Icon.tsx'
import { dataUrl, isImageFile, readImages } from './images.ts'
import { MobileComposerTools } from './MobileComposerTools.tsx'
import { Suggestions, type Option } from './Suggestions.tsx'
import { readDraft, readPastes, writeDraft, writePastes } from './viewState.ts'

// A message as the composer hands it over.
export type Outgoing = { text: string; images?: Image[]; pastes?: string[] }

type ComposerProps = {
  connection: Connection
  backendId: string
  meta: TabMeta
  running: boolean
  requestPending: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  // Local path of a dropped file (desktop with a local backend); absent → only images can be dropped.
  pathForFile?: (file: File) => string
  onSend: (message: Outgoing) => void
  onShell: (command: string) => void
  onStop: () => void
  onCycleMode: () => void
  onError: (message: string) => void
  // Touch layout: Enter adds a line (send with the button), a row of tool buttons replaces the keyboard shortcuts,
  // photos are downscaled before sending.
  mobile?: boolean
  onMode?: (mode: PermissionMode) => void
}

const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp'
// Phone pickers offer the camera and the library only for a generic image type (photos may be HEIC: downscaling
// turns them into JPEG).
const ACCEPTED_PHOTOS = 'image/*'
const SUGGESTIONS_ID = 'composer-suggestions'

// True when the caret is on the first (Up) or last (Down) line of the field, with nothing selected.
function caretOnEdgeLine(field: HTMLTextAreaElement, edge: 'first' | 'last'): boolean {
  if (field.selectionStart !== field.selectionEnd) return false
  return edge === 'first' ? !field.value.slice(0, field.selectionStart).includes('\n') : !field.value.slice(field.selectionEnd).includes('\n')
}

// Text, long pastes and attached images of the draft. Text and pastes survive reloads; images do not (size).
function useDraft(backendId: string, tabId: string, inputRef: RefObject<HTMLTextAreaElement | null>) {
  const [text, setText] = useState(() => readDraft(backendId, tabId))
  const [pastes, setPastes] = useState(() => readPastes(backendId, tabId))
  const [images, setImages] = useState<Image[]>([])
  const pendingCaret = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = undefined
  }, [text, inputRef])
  // caret: where to put it after a programmatic change (typing leaves it to the browser).
  const setValue = (value: string, caret?: number) => {
    setText(value)
    writeDraft(backendId, tabId, value)
    pendingCaret.current = caret
  }
  const addPaste = (content: string) => {
    const id = Math.max(0, ...Object.keys(pastes).map(Number)) + 1
    const next = { ...pastes, [id]: content }
    setPastes(next)
    writePastes(backendId, tabId, next)
    return id
  }
  const clear = () => {
    setValue('')
    setPastes({})
    writePastes(backendId, tabId, {})
    setImages([])
  }
  return { text, pastes, images, setImages, setValue, addPaste, clear }
}

// Message field. Enter sends, Shift+Enter adds a line, Shift+Tab switches mode (as in the CLI prompt) — only here
// and with no request open: elsewhere Shift+Tab moves focus back as usual. `/` suggests commands, `@` files of the
// folder, Up/Down and Ctrl+R previous messages, `!` runs a shell command. Images come by paste, drop or the Image
// button; long pastes collapse into a placeholder. Every keyboard action also has a button (design rule 9).
export function Composer(props: ComposerProps) {
  const { connection, backendId, meta, running, requestPending, inputRef, pathForFile, onSend, onShell, onStop, onCycleMode, onError, mobile, onMode } = props
  const draft = useDraft(backendId, meta.tabId, inputRef)
  const { text, images } = draft
  const history = usePromptHistory(connection, meta.cwd)
  const suggestions = useComposerPopup(connection, meta.tabId, history.load)
  const popup = suggestions.popup
  const fileInput = useRef<HTMLInputElement>(null)
  const shellMode = text.startsWith('!')

  const change = (value: string, caret: number) => {
    draft.setValue(value)
    history.reset()
    suggestions.refresh(value, caret)
  }
  const pick = (option: Option) => {
    if (popup?.kind === 'history' || !popup?.trigger) draft.setValue(option.value, option.value.length)
    else {
      const applied = applySuggestion(text, popup.trigger, option.value)
      draft.setValue(applied.text, applied.caret)
      if (applied.text.endsWith('/', applied.caret)) return suggestions.refresh(applied.text, applied.caret)
    }
    suggestions.close()
  }
  const send = () => {
    if (shellMode) {
      if (!text.slice(1).trim()) return
      onShell(text.slice(1).trim())
    } else {
      if (!text.trim() && !images.length) return
      // Trailing blanks go (a picked command leaves one); pastes are expanded after, so they stay whole.
      const expanded = expandPastes(text.trimEnd(), draft.pastes)
      onSend({ text: expanded.text, ...(images.length ? { images } : {}), ...(expanded.pastes.length ? { pastes: expanded.pastes } : {}) })
    }
    draft.clear()
    suggestions.close()
    history.reset()
    history.invalidate()
  }
  const attach = async (files: File[]) => {
    const { images: read, errors } = await readImages(files, images.length, mobile)
    if (read.length) draft.setImages((current) => [...current, ...read])
    if (errors.length) onError(errors.join(' '))
  }
  // Up/Down on the first/last line browse previous messages (caret at the start going back, at the end coming forward).
  const browse = (direction: 1 | -1) =>
    void history.step(direction, text).then((value) => value !== undefined && draft.setValue(value, direction === 1 ? 0 : value.length))

  const onPopupKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!popup) return false
    const choosing = popup.options.length > 0
    if (event.key === 'Escape') suggestions.close()
    else if (choosing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) suggestions.move(event.key === 'ArrowDown' ? 1 : -1)
    else if (choosing && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) pick(popup.options[popup.active]!)
    else return false
    event.preventDefault()
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || onPopupKey(event)) return
    const field = event.currentTarget
    if (event.key === 'r' && event.ctrlKey) suggestions.openHistory(text)
    else if (event.key === 'ArrowUp' && caretOnEdgeLine(field, 'first')) browse(1)
    else if (event.key === 'ArrowDown' && history.browsing() && caretOnEdgeLine(field, 'last')) browse(-1)
    else if (event.key === 'Enter' && !event.shiftKey && !mobile) send()
    else if (event.key === 'Tab' && event.shiftKey && !requestPending) onCycleMode()
    else return
    event.preventDefault()
  }
  // Pasted images are attached; a long text paste becomes a placeholder at the caret.
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
  // The / and @ buttons of the touch layout: start a command, or add a mention at the end.
  const insert = (trigger: '/' | '@') => {
    const value = trigger === '/' ? '/' : `${text}${text && !text.endsWith(' ') ? ' ' : ''}@`
    draft.setValue(value, value.length)
    suggestions.refresh(value, value.length)
    inputRef.current?.focus()
  }
  const openHistory = () => (inputRef.current?.focus(), suggestions.openHistory(text))
  // Dropped images are attached; other files become `@` mentions of their path (when the host knows paths).
  const onDrop = (event: DragEvent) => {
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    event.preventDefault()
    void attach(files.filter(isImageFile))
    const paths = pathForFile ? files.filter((file) => !isImageFile(file)).map((file) => mention(pathForFile(file))) : []
    if (paths.length) draft.setValue(`${text}${text && !text.endsWith(' ') ? ' ' : ''}${paths.join(' ')} `)
  }

  return (
    <footer className={`composer${shellMode ? ' shell' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="composer-inner">
        {popup && <Suggestions id={SUGGESTIONS_ID} label={t(`suggestions_${popup.kind}`)} options={popup.options} active={popup.active} onPick={pick} />}
        {images.length > 0 && (
          <ul className="attachments" aria-label={t('attachments')}>
            {images.map((image, index) => (
              <li key={index} className="attachment">
                <img className="attachment-thumb" src={dataUrl(image)} alt={t('imageAlt', { n: String(index + 1) })} />
                <button className="tab-close" aria-label={t('removeImage', { n: String(index + 1) })} onClick={() => draft.setImages(images.filter((other) => other !== image))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {shellMode && <p className="muted">{t('shellHint', { cwd: meta.cwd })}</p>}
        <div className="composer-row">
          <input ref={fileInput} type="file" accept={mobile ? ACCEPTED_PHOTOS : ACCEPTED_IMAGES} multiple hidden onChange={(event) => void attach([...(event.target.files ?? [])]).then(() => (event.target.value = ''))} />
          <textarea
            ref={inputRef}
            className="field"
            rows={mobile ? 1 : 2}
            aria-label={t('composerLabel')}
            aria-autocomplete="list"
            aria-controls={popup ? SUGGESTIONS_ID : undefined}
            aria-activedescendant={popup?.options.length ? `${SUGGESTIONS_ID}-${popup.active}` : undefined}
            placeholder={t(mobile ? 'composerPlaceholderTouch' : 'composerPlaceholder')}
            value={text}
            onChange={(event) => change(event.target.value, event.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => suggestions.close()}
          />
          {mobile ? (
            <RoundSend stop={running && !text.trim() && !images.length} label={shellMode ? t('run') : t('send')} disabled={!text.trim() && !images.length} onSend={send} onStop={onStop} />
          ) : (
            <>
              <button className="button" onClick={() => fileInput.current?.click()}>
                {t('attachImage')}
              </button>
              <button className="button" onClick={openHistory}>
                {t('historyButton')}
              </button>
              {running && (
                <button className="button danger" onClick={onStop}>
                  {t('stop')}
                </button>
              )}
              <button className="button primary" disabled={!text.trim() && !images.length} onClick={send}>
                {shellMode ? t('run') : t('send')}
              </button>
            </>
          )}
        </div>
        {mobile && onMode && <MobileComposerTools mode={meta.mode} onPhoto={() => fileInput.current?.click()} onHistory={openHistory} onInsert={insert} onMode={onMode} />}
      </div>
    </footer>
  )
}

type RoundSendProps = { stop: boolean; label: string; disabled: boolean; onSend: () => void; onStop: () => void }

// Round send button of the touch layout; while Claude works and nothing is typed it becomes Stop (Esc on the desktop).
function RoundSend({ stop, label, disabled, onSend, onStop }: RoundSendProps) {
  return (
    <button className={`send-round${stop ? ' stop' : ''}`} aria-label={stop ? t('stop') : label} disabled={!stop && disabled} onClick={stop ? onStop : onSend}>
      <Icon name={stop ? 'stop' : 'send'} />
    </button>
  )
}
