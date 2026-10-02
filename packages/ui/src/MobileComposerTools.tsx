import { useState } from 'react'
import type { PermissionMode } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { Icon } from './Icon.tsx'
import { MODES, modeLabel } from './modes.ts'
import { Sheet } from './Sheet.tsx'

type MobileComposerToolsProps = {
  mode: PermissionMode
  onPhoto: () => void
  onHistory: () => void
  onInsert: (trigger: '/' | '@') => void
  onMode: (mode: PermissionMode) => void
}

// Touch row under the composer: the visible controls for what the desktop does with keys (design rule 9) —
// photo picker (drag), previous messages (Up/Ctrl+R), commands and file mentions, mode selector (Shift+Tab).
export function MobileComposerTools({ mode, onPhoto, onHistory, onInsert, onMode }: MobileComposerToolsProps) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="composer-tools">
      <button className="icon-button" aria-label={t('attachImage')} onClick={onPhoto}>
        <Icon name="photo" />
      </button>
      <button className="icon-button" aria-label={t('historyButton')} onClick={onHistory}>
        <Icon name="history" />
      </button>
      <button className="icon-button glyph" aria-label={t('insertCommand')} onClick={() => onInsert('/')}>
        /
      </button>
      <button className="icon-button glyph" aria-label={t('insertMention')} onClick={() => onInsert('@')}>
        @
      </button>
      <button className="mode-chip" data-mode={mode} aria-label={t('announceMode', { mode: t(modeLabel(mode)) })} onClick={() => setPicking(true)}>
        <span className="mode-swatch" />
        {t(modeLabel(mode))}
      </button>
      {picking && (
        <Sheet label={t('modeLabel')} onClose={() => setPicking(false)}>
          <ul className="menu">
            {MODES.map((entry) => (
              <li key={entry.value}>
                <button role="menuitemradio" aria-checked={entry.value === mode} onClick={() => (setPicking(false), onMode(entry.value))}>
                  {t(entry.label)}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  )
}
