import { useEffect } from 'react'
import type { TrashItem } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { useScreen, useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { baseName } from './model.ts'
import { IconButton, Title, useQuery } from './parts.tsx'
import { when } from './sessions.tsx'

const DAY_MS = 24 * 3600 * 1000

// The folder an item was deleted from.
const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || path

// "Eliminate di recente": one trash for files and folders (remote server), 7 days to change your mind. Opened from
// File it shows only what comes from that session's folder (under).
export function TrashScreen({ under }: { under?: string }) {
  const { state, connection, back, openSheet, toast, fail } = useTouch()
  const { top } = useScreen()
  const trash = useQuery(() => connection.request('trash.list', { under }), [connection, under])
  useEffect(() => {
    if (top) trash.reload()
  }, [top])
  const items = trash.data?.items ?? []
  const restore = (item: TrashItem) =>
    connection.request('trash.restore', { id: item.id }).then(() => {
      trash.reload()
      toast(t('restoredIn', { path: parentOf(item.path) }))
    }, fail)
  const where = under ?? (state.home.kind === 'root' ? state.home.path : '')
  return (
    <section className="screen" aria-label={t('recentlyDeleted')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('recentlyDeleted')} sub={under ? baseName(under) : where} />
      </header>
      <div className="scroll">
        <div className="pad tight">
          <ul className="list">
            {items.map((item) => (
              <li key={item.id} className="row end-pad">
                <Icon name={item.kind === 'folder' ? 'folder' : 'file'} className="ficon" />
                <div className="row-main">
                  <span className="row-title">{baseName(item.path)}</span>
                  <span className="row-sub">{t('trashItemSub', { from: parentOf(item.path), when: when(item.deletedAt), left: String(Math.max(1, Math.ceil((item.expiresAt - Date.now()) / DAY_MS))) })}</span>
                </div>
                <button className="button" onClick={() => void restore(item)}>
                  {t('restore')}
                </button>
              </li>
            ))}
            {trash.data && !items.length && (
              <li className="row">
                <span className="muted">{t('trashEmpty')}</span>
              </li>
            )}
          </ul>
        </div>
      </div>
      {items.length > 0 && (
        <div className="sticky-actions">
          <button className="button danger block" onClick={() => openSheet({ title: t('emptyTrashTitle'), body: <EmptyTrash count={items.length} under={under} onDone={trash.reload} /> })}>
            {t('emptyTrash')}
          </button>
        </div>
      )}
    </section>
  )
}

// "Svuotare?": deletes for good what the list shows.
function EmptyTrash({ count, under, onDone }: { count: number; under?: string; onDone: () => void }) {
  const { connection, closeSheet, closeSheets, toast, fail } = useTouch()
  const empty = () =>
    connection.request('trash.empty', { under }).then(() => {
      onDone()
      closeSheets()
      toast(t('deletedForGood'))
    }, fail)
  return (
    <>
      <p className="flat">{t(count === 1 ? 'emptyTrashOne' : 'emptyTrashBody', { count: String(count) })}</p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={() => void empty()}>
          {t('deleteForGood')}
        </button>
      </div>
    </>
  )
}
