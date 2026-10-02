import { useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { ModelInfo, TabMeta } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { Icon } from './Icon.tsx'
import { Sheet } from './Sheet.tsx'
import { badgeOf, BADGE_LABEL } from './TabBar.tsx'

type MobileChatHeaderProps = {
  meta: TabMeta
  connection: Connection
  // Another session waits for an answer: the back button shows a dot.
  otherWaiting: boolean
  onBack: () => void
  onFork: () => void
  onClose: () => void
  onError: (error: unknown) => void
}

type Open = 'menu' | 'model' | 'rename' | undefined

// Chat top bar on the phone: back to the sessions, status badge, title (tap to rename), and a ⋯ menu with the
// model, fork, rename and close (the desktop shows these in its header bar).
export function MobileChatHeader({ meta, connection, otherWaiting, onBack, onFork, onClose, onError }: MobileChatHeaderProps) {
  const [open, setOpen] = useState<Open>()
  const [models, setModels] = useState<ModelInfo[]>()
  const [title, setTitle] = useState(meta.title)
  const badge = badgeOf(meta)
  const canFork = Boolean(meta.sessionId) && (meta.status === 'idle' || meta.status === 'dormant')
  const close = () => setOpen(undefined)
  // The model list is asked only when the picker opens: asking may start the process, viewing must not.
  const openModels = () => {
    setOpen('model')
    if (!models) connection.request('tab.models', { tabId: meta.tabId }).then((result) => setModels(result.models), onError)
  }
  const pickModel = (model: string | undefined) => {
    close()
    connection.request('tab.setModel', { tabId: meta.tabId, model }).catch(onError)
  }
  const rename = () => {
    close()
    if (title.trim() && title.trim() !== meta.title) connection.request('tab.rename', { tabId: meta.tabId, title: title.trim() }).catch(onError)
  }

  return (
    <header className="m-topbar">
      <button className="icon-button" aria-label={otherWaiting ? t('backWaiting') : t('back')} onClick={onBack}>
        <Icon name="back" />
        {otherWaiting && <span className="icon-dot" />}
      </button>
      <span className={`badge ${badge === 'idle' ? '' : badge}`} role="img" aria-label={t(BADGE_LABEL[badge])} />
      <div className="m-title">
        <button className="m-title-button" aria-label={t('renameSession', { title: meta.title })} onClick={() => (setTitle(meta.title), setOpen('rename'))}>
          {meta.title}
        </button>
        <span className="m-subtitle">{[meta.activeModel ?? meta.model, meta.cwd].filter(Boolean).join(' · ')}</span>
      </div>
      <button className="icon-button" aria-label={t('moreActions')} onClick={() => setOpen('menu')}>
        <Icon name="more" />
      </button>
      {open === 'menu' && (
        <Sheet label={meta.title} onClose={close}>
          <ul className="menu">
            <li><button onClick={openModels}>{t('modelLabel')}<span className="menu-value">{meta.model ?? t('modelDefault')}</span></button></li>
            <li><button disabled={!canFork} onClick={() => (close(), onFork())}>{canFork ? t('forkHint') : t('forkUnavailable')}</button></li>
            <li><button onClick={() => (setTitle(meta.title), setOpen('rename'))}>{t('rename')}</button></li>
            <li><button className="danger" onClick={() => (close(), onClose())}>{t('closeSession')}</button></li>
          </ul>
        </Sheet>
      )}
      {open === 'model' && (
        <Sheet label={t('modelLabel')} onClose={close}>
          <ul className="menu">
            <li><button role="menuitemradio" aria-checked={!meta.model} onClick={() => pickModel(undefined)}>{t('modelDefault')}</button></li>
            {!models && <li className="muted" role="status">{t('loading')}</li>}
            {models?.filter((model) => model.value !== 'default').map((model) => (
              <li key={model.value}><button role="menuitemradio" aria-checked={meta.model === model.value} onClick={() => pickModel(model.value)}>{model.displayName}</button></li>
            ))}
          </ul>
        </Sheet>
      )}
      {open === 'rename' && (
        <Sheet label={t('renameTab')} onClose={close}>
          <input className="field" id="rename-session" aria-label={t('renameTab')} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && rename()} />
          <button className="button primary" onClick={rename}>{t('save')}</button>
        </Sheet>
      )}
    </header>
  )
}
