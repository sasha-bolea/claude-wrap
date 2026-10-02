import { useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { ModelInfo, PermissionMode, TabMeta } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { MODES } from './modes.ts'

type ChatHeaderProps = {
  meta: TabMeta
  connection: Connection
  onMode: (mode: PermissionMode) => void
  onFork: () => void
  onClose: () => void
  onError: (error: unknown) => void
}

// Top bar: folder, active model, model and mode pickers, fork, close.
// Fork only between turns: mid-turn the copy would hold a tool call without result, "running" forever.
// The model list is fetched on first use of the picker: asking for it may start the process, viewing must not.
export function ChatHeader({ meta, connection, onMode, onFork, onClose, onError }: ChatHeaderProps) {
  const [models, setModels] = useState<ModelInfo[]>()
  const loadModels = () => {
    if (models) return
    setModels([])
    connection.request('tab.models', { tabId: meta.tabId }).then((result) => setModels(result.models), onError)
  }
  const setModel = (value: string) => connection.request('tab.setModel', { tabId: meta.tabId, model: value || undefined }).catch(onError)
  const options = models ?? []
  // The current model stays selectable even before (or without) the list.
  const showCurrent = meta.model && !options.some((model) => model.value === meta.model)
  const canFork = Boolean(meta.sessionId) && (meta.status === 'idle' || meta.status === 'dormant')

  return (
    <header className="bar">
      <span className="title" title={meta.cwd}>
        {meta.cwd}
      </span>
      {meta.activeModel && <span className="muted">{meta.activeModel}</span>}
      <select className="select" aria-label={t('modelLabel')} value={meta.model ?? ''} onFocus={loadModels} onPointerDown={loadModels} onChange={(event) => void setModel(event.target.value)}>
        <option value="">{t('modelDefault')}</option>
        {showCurrent && <option value={meta.model}>{meta.model}</option>}
        {options
          .filter((model) => model.value !== 'default')
          .map((model) => (
            <option key={model.value} value={model.value}>
              {model.displayName}
            </option>
          ))}
      </select>
      <select className="select" aria-label={t('modeLabel')} value={meta.mode} onChange={(event) => onMode(event.target.value as PermissionMode)}>
        {MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {t(mode.label)}
          </option>
        ))}
      </select>
      <button className="button" disabled={!canFork} title={canFork ? t('forkHint') : t('forkUnavailable')} onClick={onFork}>
        {t('fork')}
      </button>
      <button className="button" onClick={onClose}>
        {t('closeSession')}
      </button>
    </header>
  )
}
