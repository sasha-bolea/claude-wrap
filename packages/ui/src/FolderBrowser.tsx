import { useCallback, useEffect, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { CommandResult } from '@claude-wrap/protocol'
import { t } from './i18n.ts'

type FolderBrowserProps = {
  connection: Connection
  // Where to start (the last folder used); absent → the backend's root.
  initial?: string
  onChoose: (path: string) => void
  onError: (failure: unknown) => void
}

type Listing = CommandResult<'fs.browse'>

// Folder picker for backends without a native dialog (the remote server): browse the allowed root, go up,
// create a folder, use the one shown. Paths come from the backend (fs.browse), which keeps them inside its root.
export function FolderBrowser({ connection, initial, onChoose, onError }: FolderBrowserProps) {
  const [listing, setListing] = useState<Listing>()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const open = useCallback((path?: string) => connection.request('fs.browse', { path }).then(setListing, onError), [connection, onError])
  // A remembered folder that no longer exists falls back to the root.
  useEffect(() => void connection.request('fs.browse', { path: initial }).then(setListing, () => open()), [connection, initial, open])

  const create = () => {
    if (!listing || !name.trim()) return
    connection.request('fs.mkdir', { path: listing.path, name: name.trim() }).then(({ path }) => (setCreating(false), setName(''), open(path)), onError)
  }

  if (!listing) return <p className="muted" role="status">{t('loading')}</p>
  const separator = listing.path.includes('\\') ? '\\' : '/'
  const child = (folder: string) => (listing.path.endsWith(separator) ? listing.path + folder : listing.path + separator + folder)
  return (
    <section className="folder-browser" aria-label={t('folderBrowser')}>
      <p className="folder-path">{listing.path}</p>
      <ul className="m-list">
        {listing.parent && (
          <li className="m-row">
            <button className="m-row-main" onClick={() => void open(listing.parent)}>
              <span className="m-row-title">..</span>
              <span className="m-row-sub">{t('parentFolder')}</span>
            </button>
          </li>
        )}
        {listing.folders.map((folder) => (
          <li key={folder} className="m-row">
            <button className="m-row-main" onClick={() => void open(child(folder))}>
              <span className="m-row-title">{folder}</span>
            </button>
          </li>
        ))}
        {!listing.folders.length && <li className="m-row muted">{t('noSubfolders')}</li>}
      </ul>
      {creating ? (
        <div className="actions">
          <input className="field" id="new-folder-name" aria-label={t('newFolderName')} value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
          <button className="button" onClick={create} disabled={!name.trim()}>
            {t('create')}
          </button>
        </div>
      ) : (
        <button className="button" onClick={() => setCreating(true)}>
          {t('newFolder')}
        </button>
      )}
      <button className="button primary" onClick={() => onChoose(listing.path)}>
        {t('useFolder', { path: listing.path })}
      </button>
    </section>
  )
}
