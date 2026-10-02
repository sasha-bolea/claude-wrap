import { useState, type KeyboardEvent, type RefObject } from 'react'
import { t } from './i18n.ts'
import { readDraft, writeDraft } from './viewState.ts'

type ComposerProps = {
  backendId: string
  tabId: string
  running: boolean
  requestPending: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  onSend: (text: string) => void
  onStop: () => void
  onCycleMode: () => void
}

// Message field. Enter sends, Shift+Enter adds a line, Shift+Tab switches mode (as in the CLI prompt) — only
// here and with no request open: elsewhere Shift+Tab moves focus back as usual. The draft survives reloads.
// (Palette, mentions, attachments and history come in Phase 2.)
export function Composer({ backendId, tabId, running, requestPending, inputRef, onSend, onStop, onCycleMode }: ComposerProps) {
  const [text, setText] = useState(() => readDraft(backendId, tabId))

  const update = (value: string) => {
    setText(value)
    writeDraft(backendId, tabId, value)
  }
  const send = () => {
    if (!text.trim()) return
    onSend(text)
    update('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    } else if (event.key === 'Tab' && event.shiftKey && !requestPending) {
      event.preventDefault()
      onCycleMode()
    }
  }

  return (
    <footer className="composer">
      <div className="composer-inner">
        <textarea
          ref={inputRef}
          className="field"
          rows={2}
          aria-label={t('composerLabel')}
          placeholder={t('composerPlaceholder')}
          value={text}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running && (
          <button className="button danger" onClick={onStop}>
            {t('stop')}
          </button>
        )}
        <button className="button primary" disabled={!text.trim()} onClick={send}>
          {t('send')}
        </button>
      </div>
    </footer>
  )
}
