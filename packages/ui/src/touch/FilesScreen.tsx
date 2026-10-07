import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { LIMITS, type CommandResult, type FileEntry } from '@athome/protocol'
import { t } from '../i18n.ts'
import { readBase64 } from '../images.ts'
import { Markdown } from '../Markdown.tsx'
import { useBackHandler, useScreen, useTouch } from './context.tsx'
import { Icon, type IconName } from './icons.tsx'
import { baseName, filesChanged, freeName, htmlLines, sizeLabel, spanNodes } from './model.ts'
import { Crumbs, IconButton, Title, useQuery } from './parts.tsx'
import { needsTrust, useTrustPrompt, when } from './sessions.tsx'

type FileData = CommandResult<'files.read'>
type Changes = { created: string[]; modified: string[] }

const CODE = /\.(c|cc|cpp|cs|css|go|h|html?|java|jsx?|json|kt|lua|mjs|cjs|php|py|rb|rs|scss|sh|sql|swift|toml|tsx?|vue|xml|ya?ml)$/i
const IMAGE = /\.(gif|heic|jpe?g|png|svg|webp)$/i
// Above this size code is shown without colours (highlighting a big file is slow on the phone).
const HIGHLIGHT_MAX = 200_000
const REFRESH_NOTE_MS = 6000

const join = (...parts: string[]) => parts.filter(Boolean).join('/')
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
const iconOf = (entry: FileEntry): IconName => (entry.kind === 'folder' ? 'folder' : IMAGE.test(entry.name) ? 'image' : CODE.test(entry.name) ? 'code' : 'file')
// A path inside the session folder written out in full, with the folder's own separator.
const fullPath = (cwd: string, path: string) => (path ? [cwd, ...path.split('/')].join(cwd.includes('\\') ? '\\' : '/') : cwd)

// Where the explorer works: a session's folder (opened from its chat) or a folder of the Home (no session). Exactly one.
type FilePlace = { tabId?: string; folder?: string }

// The folder of a place; undefined once its session is closed.
function useCwd(place: FilePlace): string | undefined {
  const { state } = useTouch()
  return place.folder ?? state.tabs.find((tab) => tab.tabId === place.tabId)?.cwd
}

// Saves a downloaded file: the share sheet (iOS: Salva su File, Salva immagine) where there is one, else a download.
// false: the share sheet needs a fresh tap (the file took too long to arrive).
async function saveFile(file: FileData, name: string): Promise<boolean> {
  const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
  const blob = new File([bytes], name, { type: file.mediaType })
  if (navigator.canShare?.({ files: [blob] })) {
    try {
      await navigator.share({ files: [blob] })
    } catch (error) {
      if ((error as Error).name === 'NotAllowedError') return false
      if ((error as Error).name !== 'AbortError') throw error
    }
    return true
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

// What can be done to a file or folder: mention it in the chat (only with a session), download, delete (with undo).
function useFileActions(place: FilePlace) {
  const { state, connection, backTo, insertInComposer, openSheet, closeSheets, toast, snack, fail } = useTouch()
  const cwd = useCwd(place) ?? ''
  const systemTrash = state.home.kind === 'added'
  const tabId = place.tabId
  const mention = tabId
    ? (path: string, folder: boolean) => {
        const text = `@${path}${folder ? '/' : ''}`
        closeSheets()
        insertInComposer(tabId, { text: `${text} ` })
        backTo((screen) => screen.name === 'chat' && screen.tabId === tabId)
        toast(t('mentioned', { path: text }))
      }
    : undefined
  const download = (path: string) =>
    connection
      .request('files.read', { ...place, path, download: true })
      .then((file) => saveFile(file, baseName(path)).then((done) => done || openSheet({ title: baseName(path), body: <ShareReady file={file} name={baseName(path)} /> })))
      .catch(fail)
  // The newest item of the trash that was this path, put back.
  const restore = (path: string) =>
    connection
      .request('trash.list', { under: cwd })
      .then(({ items }) => {
        const item = items.filter((candidate) => candidate.path.replace(/\\/g, '/').endsWith(`/${path}`)).sort((a, b) => b.deletedAt - a.deletedAt)[0]
        return item && connection.request('trash.restore', { id: item.id })
      })
      .then(() => toast(t('restoredIn', { path: parentOf(path) || baseName(cwd) })), fail)
  const remove = (path: string, onDone: () => void) =>
    connection.request('files.delete', { ...place, path }).then(() => {
      closeSheets()
      onDone()
      if (systemTrash) toast(t('inSystemTrash', { name: baseName(path) }))
      else snack(t('movedToTrash', { name: baseName(path) }), () => void restore(path).then(onDone))
    }, fail)
  return { mention, download, remove, systemTrash, cwd }
}

// The share sheet once the file is here (iOS wants a tap of its own when the download took a while).
function ShareReady({ file, name }: { file: FileData; name: string }) {
  const { closeSheet, fail } = useTouch()
  return (
    <button className="button primary block" onClick={() => void saveFile(file, name).then(closeSheet, fail)}>
      <Icon name="download" />
      {t('saveOrShare', { size: sizeLabel(file.size) })}
    </button>
  )
}

// Files of a session's folder or of a folder of the Home: browse (Back goes up a folder first), open a preview, upload
// photos and files, new folder, the ⋯ of each entry; the trash of this folder. With a session, at the end of a turn
// the list refreshes and says what Claude created or changed. Prototype: NOTE-CONSEGNA §1 (File).
export function FilesScreen({ tabId, folder: home }: FilePlace) {
  const { state, connection, back, go, openSheet, closeSheets, toast, fail } = useTouch()
  const { top } = useScreen()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const [path, setPath] = useState('')
  const [uploading, setUploading] = useState<{ folder: string; name: string }[]>([])
  const [marks, setMarks] = useState<Changes>()
  const [note, setNote] = useState<string>()
  const photos = useRef<HTMLInputElement>(null)
  const documents = useRef<HTMLInputElement>(null)
  const before = useRef<{ path: string; entries: FileEntry[] } | undefined>(undefined)
  const place: FilePlace = tabId ? { tabId } : { folder: home }
  const { systemTrash, cwd } = useFileActions(place)
  const askTrust = useTrustPrompt()
  // A folder not trusted yet is explained by a notice (with the way to decide), not by an error toast.
  const listing = useQuery(() => connection.request('files.list', { ...place, path }), [connection, tabId, home, path], needsTrust)
  const untrusted = listing.caught !== undefined
  const trash = useQuery(() => (systemTrash || !cwd ? Promise.resolve(undefined) : connection.request('trash.list', { under: cwd })), [connection, systemTrash, cwd])
  useBackHandler(path !== '', () => setPath(parentOf(path)))
  const busy = meta ? meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action' : false
  const wasBusy = useRef(busy)

  // Back on top (from a preview, the trash): lists again.
  useEffect(() => {
    if (!top) return
    listing.reload()
    trash.reload()
  }, [top])
  useEffect(() => setMarks(undefined), [path])
  // End of a turn: the list again, compared with the one before.
  useEffect(() => {
    if (wasBusy.current && !busy && listing.data) {
      before.current = { path, entries: listing.data.entries }
      listing.reload()
    }
    wasBusy.current = busy
  }, [busy])
  useEffect(() => {
    const old = before.current
    if (!old || !listing.data || old.path !== path) return
    before.current = undefined
    const changes = filesChanged(old.entries, listing.data.entries)
    setMarks(changes)
    if (changes.created.length || changes.modified.length) setNote(t('filesRefreshed', { created: String(changes.created.length), modified: String(changes.modified.length) }))
  }, [listing.data])
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(undefined), REFRESH_NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])

  if (!cwd) return null
  const root = baseName(cwd)
  const parts = path ? path.split('/') : []
  const entries = listing.data?.entries ?? []

  // Uploads one file at a time under a free name (refused beyond LIMITS.fileBytes).
  const upload = async (files: File[]) => {
    const folder = path
    const taken = new Set(entries.map((entry) => entry.name))
    const named = files.map((file) => ({ file, name: freeName(file.name, taken) }))
    const tooLarge = named.find(({ file }) => file.size > LIMITS.fileBytes)
    if (tooLarge) toast(t('fileTooLarge', { name: tooLarge.file.name, max: sizeLabel(LIMITS.fileBytes) }))
    const fitting = named.filter(({ file }) => file.size <= LIMITS.fileBytes)
    setUploading((current) => [...current, ...fitting.map(({ name }) => ({ folder, name }))])
    const done: string[] = []
    for (const { file, name } of fitting) {
      try {
        await connection.request('files.write', { ...place, path: join(folder, name), data: await readBase64(file) })
        done.push(name)
      } catch (error) {
        fail(error)
      }
      setUploading((current) => current.filter((entry) => entry.folder !== folder || entry.name !== name))
    }
    listing.reload()
    if (!done.length) return
    setMarks((current) => ({ created: [...(current?.created ?? []), ...done], modified: current?.modified ?? [] }))
    const where = folder ? baseName(folder) : root
    toast(done.length === 1 ? t('uploadedOne', { name: done[0]!, folder: where }) : t('uploadedMany', { count: String(done.length), folder: where }))
  }
  // Files dropped on the explorer are uploaded into the folder shown.
  const dropping = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files') && (event.preventDefault(), event.currentTarget.classList.add('dropping'))
  const dropped = (event: DragEvent<HTMLElement>) => {
    event.currentTarget.classList.remove('dropping')
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    void upload([...event.dataTransfer.files])
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length) void upload(files)
  }
  const open = (entry: FileEntry) => (entry.kind === 'folder' ? setPath(join(path, entry.name)) : go({ name: 'file', ...place, path: join(path, entry.name), modified: entry.modified }))
  const openAdd = () =>
    openSheet({
      title: t('addIn', { folder: parts.at(-1) ?? root }),
      body: (
        <AddSheet
          onPhotos={() => (closeSheets(), photos.current?.click())}
          onFiles={() => (closeSheets(), documents.current?.click())}
          onFolder={() => openSheet({ title: t('newFolderIn', { path: parts.at(-1) ?? root }), field: true, body: <NewFolderSheet place={place} parent={path} onDone={listing.reload} /> })}
        />
      )
    })
  const shownUploads = uploading.filter((entry) => entry.folder === path)

  return (
    <section className="screen" aria-label={t('folderFiles')} onDragOver={dropping} onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && event.currentTarget.classList.remove('dropping')} onDrop={dropped}>
      <header className="topbar">
        <IconButton icon="back" label={path ? t('upTo', { name: parts.at(-2) ?? root }) : t(tabId ? 'chat' : 'back')} onClick={back} />
        <Title text={t('files')} sub={fullPath(cwd, path)} />
        <IconButton icon="plus" label={t('addFilesLabel')} onClick={openAdd} disabled={untrusted} />
        {!systemTrash && <IconButton icon="trash" label={t('recentlyDeleted')} count={trash.data?.items.length ? String(trash.data.items.length) : undefined} onClick={() => go({ name: 'trash', under: cwd })} />}
      </header>
      <Crumbs parts={[root, ...parts]} onJump={(index) => setPath(parts.slice(0, index).join('/'))} />
      <div className="scroll">
        <div className="pad tight">
          {note && (
            <p className="refresh-note" role="status">
              {note}
            </p>
          )}
          {untrusted && (
            <div className="card">
              <span>{t('filesNeedTrust')}</span>
              <button className="button" onClick={() => askTrust(cwd, listing.reload)}>
                {t('decideTrust')}
              </button>
            </div>
          )}
          <ul className="list">
            {entries.map((entry) => {
              const full = join(path, entry.name)
              const folder = entry.kind === 'folder'
              return (
                <li key={entry.name} className="row">
                  <Icon name={iconOf(entry)} className={`ficon${folder ? ' dir' : ''}`} />
                  <button className="row-main" onClick={() => open(entry)}>
                    <span className="row-title">
                      {entry.name}
                      {marks?.created.includes(entry.name) && <span className="chip changed">{t('newChip')}</span>}
                      {marks?.modified.includes(entry.name) && <span className="chip changed">{t('changedByClaude')}</span>}
                    </span>
                    <span className="row-sub">{folder ? when(entry.modified) : `${sizeLabel(entry.size)} · ${when(entry.modified)}`}</span>
                  </button>
                  <IconButton
                    icon="more"
                    label={t(folder ? 'folderActions' : 'fileActions', { name: entry.name })}
                    onClick={() => openSheet({ title: entry.name, path: full, body: <FileItemSheet place={place} path={full} folder={folder} onOpen={() => open(entry)} onChanged={listing.reload} /> })}
                  />
                </li>
              )
            })}
            {shownUploads.map((entry) => (
              <li key={`upload-${entry.name}`} className="row uploading">
                <Icon name="upload" className="ficon" />
                <div className="row-main">
                  <span className="row-title">{entry.name}</span>
                  <span className="row-sub">{t('uploading')}</span>
                </div>
              </li>
            ))}
            {listing.data && !entries.length && !shownUploads.length && (
              <li className="row end-pad">
                <span className="muted grow">{t('emptyFolder')}</span>
                <button className="button" onClick={openAdd}>
                  {t('uploadHere')}
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
      <input type="file" ref={photos} accept="image/*,video/*" multiple hidden onChange={picked} />
      <input type="file" ref={documents} multiple hidden onChange={picked} />
    </section>
  )
}

// "Aggiungi in …": upload from Photos or Files, or a new folder.
function AddSheet({ onPhotos, onFiles, onFolder }: { onPhotos: () => void; onFiles: () => void; onFolder: () => void }) {
  return (
    <ul className="menu">
      <li>
        <button onClick={onPhotos}>
          <Icon name="image" />
          {t('uploadPhotos')}
        </button>
      </li>
      <li>
        <button onClick={onFiles}>
          <Icon name="upload" />
          {t('uploadFiles')}
        </button>
      </li>
      <li>
        <button onClick={onFolder}>
          <Icon name="folder" />
          {t('newFolder')}
        </button>
      </li>
    </ul>
  )
}

function NewFolderSheet({ place, parent, onDone }: { place: FilePlace; parent: string; onDone: () => void }) {
  const { connection, closeSheets, toast, fail } = useTouch()
  const [name, setName] = useState('')
  const create = () => {
    const value = name.trim()
    if (!value) return
    connection.request('files.mkdir', { ...place, path: join(parent, value) }).then(() => {
      closeSheets()
      onDone()
      toast(t('folderCreated', { name: value }))
    }, fail)
  }
  return (
    <>
      <input className="field" aria-label={t('folderName')} placeholder={t('folderNamePlaceholder')} autoComplete="off" autoCapitalize="off" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
      <button className="button primary block" disabled={!name.trim()} onClick={create}>
        {t('create')}
      </button>
    </>
  )
}

// ⋯ of a file or folder: open (or preview), mention in the chat, download, rename or move, to the trash.
function FileItemSheet({ place, path, folder, onOpen, onChanged, onRenamed, onDeleted }: { place: FilePlace; path: string; folder: boolean; onOpen?: () => void; onChanged: () => void; onRenamed?: (to: string) => void; onDeleted?: () => void }) {
  const { openSheet, closeSheets } = useTouch()
  const { mention, download, remove, systemTrash, cwd } = useFileActions(place)
  return (
    <ul className="menu">
      {onOpen && (
        <li>
          <button onClick={() => (closeSheets(), onOpen())}>{t(folder ? 'open' : 'preview')}</button>
        </li>
      )}
      {mention && (
        <li>
          <button onClick={() => mention(path, folder)}>
            <span className="at" aria-hidden="true">
              @
            </span>
            {t('mentionInChat')}
          </button>
        </li>
      )}
      {!folder && (
        <li>
          <button onClick={() => (closeSheets(), void download(path))}>
            <Icon name="download" />
            {t('download')}
          </button>
        </li>
      )}
      <li>
        <button onClick={() => openSheet({ title: t('renameOrMove'), field: true, body: <MoveSheet place={place} root={baseName(cwd)} from={path} onDone={(to) => (onChanged(), onRenamed?.(to))} /> })}>{t('renameOrMove')}</button>
      </li>
      <li>
        <button className="danger" onClick={() => void remove(path, () => (onChanged(), onDeleted?.()))}>
          <Icon name="trash" />
          {t(systemTrash ? 'moveToSystemTrash' : 'moveToTrash')}
        </button>
      </li>
    </ul>
  )
}

// Rename, or move by changing the path (inside the explorer's folder, named root).
function MoveSheet({ place, root, from, onDone }: { place: FilePlace; root: string; from: string; onDone: (to: string) => void }) {
  const { connection, closeSheets, toast, fail } = useTouch()
  const [to, setTo] = useState(from)
  const save = () => {
    const target = to.trim().replace(/^\/+/, '')
    if (!target || target === from) return closeSheets()
    connection.request('files.rename', { ...place, from, to: target }).then(() => {
      closeSheets()
      onDone(target)
      toast(t('nowIs', { path: target }))
    }, fail)
  }
  return (
    <>
      <label className="label" htmlFor="move-path">
        {t('pathInFolder', { folder: root })}
      </label>
      <input className="field mono" id="move-path" autoComplete="off" autoCapitalize="off" value={to} onChange={(event) => setTo(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && save()} />
      <p className="muted flat">{t('moveHint', { example: `docs/archive/${baseName(from)}` })}</p>
      <button className="button primary block" onClick={save}>
        {t('save')}
      </button>
    </>
  )
}

// Preview of a file: code with line numbers and colours, markdown, images (SVG only as an image, never run), HTML as
// its source; anything else says there is no preview. Mention in the chat and download stay at the bottom.
export function FileScreen({ tabId, folder, path: opened, modified }: FilePlace & { path: string; modified?: number }) {
  const { connection, back, openSheet, viewImage, capabilities } = useTouch()
  const place: FilePlace = tabId ? { tabId } : { folder }
  const [path, setPath] = useState(opened)
  const file = useQuery(() => connection.request('files.read', { ...place, path }), [connection, tabId, folder, path])
  const { mention, download, cwd } = useFileActions(place)
  if (!cwd) return null
  const name = baseName(path)
  const data = file.data
  const image = data && (data.mediaType === 'image/svg+xml' && !data.truncated ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.data)}` : data.mediaType.startsWith('image/') && data.encoding === 'base64' && data.data ? `data:${data.mediaType};base64,${data.data}` : undefined)
  let body: ReactNode = null
  if (data && image)
    body = (
      <div className="preview-img">
        <button aria-label={t('openFullScreen', { name })} onClick={() => viewImage(image)}>
          <img src={image} alt={name} />
        </button>
      </div>
    )
  else if (data?.encoding === 'utf8' && data.mediaType === 'text/markdown')
    body = (
      <div className="md-view msg-ai">
        <Markdown text={data.data} openExternal={capabilities.openExternal} />
      </div>
    )
  else if (data?.encoding === 'utf8') body = <CodeView text={data.data} name={name} />
  else if (data)
    body = (
      <div className="preview-empty">
        <Icon name="file" />
        <strong>{t('noPreview')}</strong>
        <span className="muted">{sizeLabel(data.size)}</span>
      </div>
    )
  const details = data && [sizeLabel(data.size), modified !== undefined && t('modifiedAt', { when: when(modified) }), data.truncated && data.encoding === 'utf8' && t('previewStart', { size: sizeLabel(LIMITS.previewBytes) })].filter(Boolean).join(' · ')

  return (
    <section className="screen" aria-label={t('filePreview')}>
      <header className="topbar">
        <IconButton icon="back" label={t('backToFiles')} onClick={back} />
        <Title text={name} sub={parentOf(path) || baseName(cwd)} />
        <IconButton icon="more" label={t('fileMoreActions')} onClick={() => openSheet({ title: name, path, body: <FileItemSheet place={place} path={path} folder={false} onChanged={() => undefined} onRenamed={setPath} onDeleted={back} /> })} />
      </header>
      <p className="file-meta">{details || ' '}</p>
      <div className="scroll">{body}</div>
      <div className={`sticky-actions${mention ? ' two' : ''}`}>
        {mention && (
          <button className="button" onClick={() => mention(path, false)}>
            <span className="at" aria-hidden="true">
              @
            </span>
            {t('mentionInChat')}
          </button>
        )}
        <button className="button" onClick={() => void download(path)}>
          <Icon name="download" />
          {t('download')}
        </button>
      </div>
    </section>
  )
}

// Code with line numbers, coloured by highlight.js (loaded with the first file opened; plain text for big files and
// languages it does not know). Its output becomes React nodes (spanNodes): no HTML is injected.
function CodeView({ text, name }: { text: string; name: string }) {
  const [html, setHtml] = useState<string>()
  const source = text.replace(/\n$/, '')
  useEffect(() => {
    const language = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
    setHtml(undefined)
    if (!language || source.length > HIGHLIGHT_MAX) return
    let live = true
    import('highlight.js/lib/common')
      .then(({ default: hljs }) => {
        if (live && hljs.getLanguage(language)) setHtml(hljs.highlight(source, { language }).value)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [source, name])
  const lines = html ? htmlLines(html).map(spanNodes) : source.split('\n')
  return (
    <pre className="code" tabIndex={0} aria-label={t('code')}>
      {lines.map((line, index) => (
        <span key={index} className="line">
          <span className="ln" aria-hidden="true">
            {index + 1}
          </span>
          {line}
        </span>
      ))}
    </pre>
  )
}
