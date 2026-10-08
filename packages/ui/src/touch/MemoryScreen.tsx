import { useEffect, useState } from 'react'
import type { Memory } from '@athome/protocol'
import { ClientError } from '@athome/client'
import { t } from '../i18n.ts'
import { useBackHandler, useScreen, useTouch } from './context.tsx'
import { InspectBody, InspectTop, SheetError, errorText, useInspect, useReloadOnTop, useSheetRequest } from './inspect.tsx'
import { baseName } from './model.ts'
import { isIndexPath, knownType, sortMemories } from './memory.ts'
import { IconButton, SwitchRow, Title } from './parts.tsx'
import { visibleText } from './permissions.ts'
import { when } from './sessions.tsx'

type MemoryFile = Memory['files'][number]
type SavedMemory = Memory['memories'][number]

// The kind of a saved memory as a word: translated when known, else as it comes (untrusted text, spelled out).
function typeLabel(type: string): string {
  const known = knownType(type)
  return known ? t(`memType_${known}`) : visibleText(type)
}

// One instruction file: its label, what it is and its path, and a note while it does not exist; a tap opens the editor.
function FileRow({ tabId, file }: { tabId: string; file: MemoryFile }) {
  const { go } = useTouch()
  return (
    <li className="row">
      <button className="row-main" onClick={() => go({ name: 'memoryFile', tabId, path: file.path, label: file.label, kind: file.kind })}>
        <span className="row-title plain selectable">{visibleText(file.label)}</span>
        {file.description && <span className="row-sub wrap selectable">{visibleText(file.description)}</span>}
        <span className="row-sub mono-line selectable">{visibleText(file.path)}</span>
        {!file.exists && <span className="row-sub">{t('memNotCreated')}</span>}
      </button>
    </li>
  )
}

// One saved memory: name (the index is "Index"), description, kind and date; a tap opens it read-only; a bin ends every
// row but the index.
function MemoryRow({ tabId, memory, onDelete }: { tabId: string; memory: SavedMemory; onDelete: () => void }) {
  const { go } = useTouch()
  const index = isIndexPath(memory.path)
  const name = index ? t('memIndex') : visibleText(memory.name)
  return (
    <li className="row">
      <button className="row-main" onClick={() => go({ name: 'memoryView', tabId, path: memory.path, title: name })}>
        <span className="row-title plain selectable">{name}</span>
        {memory.description && <span className="row-sub wrap selectable">{visibleText(memory.description)}</span>}
        {(memory.type || memory.modifiedAt !== undefined) && (
          <span className="row-sub">
            {memory.type && <span className="chip">{typeLabel(memory.type)}</span>} {memory.modifiedAt !== undefined && when(memory.modifiedAt)}
          </span>
        )}
      </button>
      {!index && <IconButton icon="trash" label={t('memDeleteLabel', { name })} onClick={onDelete} />}
    </li>
  )
}

// Confirmation of a memory's deletion: it goes to the trash and leaves MEMORY.md; a refusal stays in the sheet.
function DeleteSheet({ tabId, memory, reload }: { tabId: string; memory: SavedMemory; reload: () => void }) {
  const { connection, closeSheet } = useTouch()
  const { error, busy, run } = useSheetRequest(reload)
  return (
    <>
      <p className="mono-line selectable flat">{visibleText(memory.name)}</p>
      <p className="muted flat">{t('memDeleteBody')}</p>
      <SheetError error={error} />
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" disabled={busy} onClick={() => run(() => connection.request('tab.memoryDelete', { tabId, path: memory.path }), t('memDeleted'))}>
          {t('delete')}
        </button>
      </div>
    </>
  )
}

// The instruction files the session loads, with the hint that changes reach later sessions.
function FilesSection({ tabId, files }: { tabId: string; files: MemoryFile[] }) {
  return (
    <div className="group">
      <p className="label">{t('memFiles')}</p>
      <ul className="list">
        {files.map((file) => (
          <FileRow key={file.path} tabId={tabId} file={file} />
        ))}
      </ul>
      <p className="muted flat">{t('memFilesHint')}</p>
    </div>
  )
}

// The auto-memory switch (shown at once, put back with the reason when the save is refused), its hint, the memory
// folder and the saved memories.
function AutoSection({ tabId, data, reload }: { tabId: string; data: Memory; reload: () => void }) {
  const { connection, openSheet, toast, fail } = useTouch()
  // The value just chosen, until the list is read again.
  const [pending, setPending] = useState<boolean>()
  useEffect(() => setPending(undefined), [data])
  const toggle = (enabled: boolean) => {
    setPending(enabled)
    connection.request('tab.setAutoMemory', { tabId, enabled }).then(
      () => (reload(), toast(t('ccSaved'))),
      (failure: unknown) => (setPending(undefined), fail(failure))
    )
  }
  const memories = sortMemories(data.memories)
  return (
    <div className="group">
      <p className="label">{t('memAuto')}</p>
      <ul className="list">
        <SwitchRow id="memory-auto" title={t('memAutoSwitch')} hint={t('memAutoHint')} checked={pending ?? data.autoMemory} onChange={toggle} />
      </ul>
      {data.folder && <p className="muted mono-line selectable flat">{visibleText(data.folder)}</p>}
      {memories.length ? (
        <ul className="list">
          {memories.map((memory) => (
            <MemoryRow key={memory.path} tabId={tabId} memory={memory} onDelete={() => openSheet({ title: t('memDeleteTitle'), body: <DeleteSheet tabId={tabId} memory={memory} reload={reload} /> })} />
          ))}
        </ul>
      ) : (
        <p className="empty-line">{t('memNone')}</p>
      )}
    </div>
  )
}

// The session's memory, as /memory: the instruction files (tap to edit) and the auto memory (switch, folder, saved
// memories to read or delete).
export function MemoryScreen({ tabId }: { tabId: string }) {
  const { state, connection } = useTouch()
  const inspect = useInspect(() => connection.request('tab.memory', { tabId }), [connection, tabId])
  useReloadOnTop(inspect)
  const cwd = state.tabs.find((tab) => tab.tabId === tabId)?.cwd
  return (
    <section className="screen" aria-label={t('later_memory')}>
      <InspectTop title={t('later_memory')} sub={cwd ? baseName(cwd) : undefined} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {(data) => (
          <>
            <FilesSection tabId={tabId} files={data.files} />
            <AutoSection tabId={tabId} data={data} reload={inspect.reload} />
          </>
        )}
      </InspectBody>
    </section>
  )
}

// A saved memory, read only: its text as selectable plain text.
export function MemoryViewScreen({ tabId, path, title }: { tabId: string; path: string; title: string }) {
  const { connection } = useTouch()
  const inspect = useInspect(() => connection.request('tab.memoryRead', { tabId, path }), [connection, tabId, path])
  return (
    <section className="screen" aria-label={title}>
      <InspectTop title={title} sub={t('memReadOnly')} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {(data) => (
          <>
            <p className="muted mono-line selectable flat">{visibleText(path)}</p>
            <pre className="local-output selectable">{data.text}</pre>
          </>
        )}
      </InspectBody>
    </section>
  )
}

// Whether a failed save is "the file changed meanwhile" (the core refuses with invalid_args).
const isChanged = (error: unknown): boolean => error instanceof ClientError && error.code === 'invalid_args'

// What the editor knows of the file on disk: its text and version as last read or saved.
type Base = { text: string; exists: boolean; version: string }

// Sheet asked when leaving with unsaved changes: keep editing, or discard them and leave.
function DiscardSheet({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <>
      <p className="flat">{t('memDiscardBody')}</p>
      <div className="two-buttons">
        <button className="button" onClick={onKeep}>
          {t('memKeepEditing')}
        </button>
        <button className="button danger" onClick={onDiscard}>
          {t('memDiscard')}
        </button>
      </div>
    </>
  )
}

// The editor's load, draft and save: the file read at the version it is at; Save writes the draft at that version
// and keeps the new one; a refusal (also "changed meanwhile") stays as `failure`; reload() reads the file again and
// drops the draft.
// Parameters: the session and the file. Returns the state and its actions.
function useFileEditor(tabId: string, path: string) {
  const { connection, toast } = useTouch()
  const inspect = useInspect(() => connection.request('tab.memoryRead', { tabId, path }), [connection, tabId, path])
  const [base, setBase] = useState<Base>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ text: string; changed: boolean }>()
  useEffect(() => {
    if (!inspect.data) return
    setBase(inspect.data)
    setDraft(inspect.data.text)
    setFailure(undefined)
  }, [inspect.data])
  const save = () => {
    if (!base || busy) return
    setBusy(true)
    setFailure(undefined)
    connection.request('tab.memoryWrite', { tabId, path, text: draft, version: base.version }).then(
      ({ version }) => (setBase({ text: draft, exists: true, version }), toast(t('memSaved'))),
      (error: unknown) => setFailure({ text: isChanged(error) ? t('memChanged') : errorText(error), changed: isChanged(error) })
    ).finally(() => setBusy(false))
  }
  return { inspect, base, draft, setDraft, busy, failure, save, dirty: base !== undefined && draft !== base.text }
}

// An instruction file's editor: its path, the text in a monospace field, Save in the top bar. Saving a file that does
// not exist yet creates it. Leaving with unsaved changes asks first.
export function MemoryFileScreen({ tabId, path, label, kind }: { tabId: string; path: string; label: string; kind: string }) {
  const { back, openSheet, closeSheet, closeSheets } = useTouch()
  const { entryId, registerBack } = useScreen()
  const editor = useFileEditor(tabId, path)
  const { base, draft, dirty, busy, failure } = editor
  // Both answers of the question leave for real, so the screen's own back handler is dropped first.
  const leave = () => {
    closeSheets()
    registerBack(entryId, undefined)
    back()
  }
  useBackHandler(dirty, () => openSheet({ title: t('memDiscardTitle'), body: <DiscardSheet onKeep={closeSheet} onDiscard={leave} /> }))
  const loadFailed = editor.inspect.error && !base
  return (
    <section className="screen" aria-label={visibleText(label)}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={visibleText(label)} sub={dirty ? t('memUnsaved') : undefined} />
        <IconButton icon="check" className="accent" label={t('save')} disabled={!dirty || busy} onClick={editor.save} />
      </header>
      <div className="pad tight">
        <p className="muted mono-line selectable flat">{visibleText(path)}</p>
        {base && !base.exists && <p className="muted flat">{t('memCreateHint')}</p>}
        {kind === 'other' && <p className="muted flat">{t('memOtherNote')}</p>}
        {failure && (
          <div className="card bad" role="alert">
            <span className="selectable">{failure.text}</span>
            {failure.changed && (
              <button className="button" onClick={editor.inspect.reload}>
                {t('memReload')}
              </button>
            )}
          </div>
        )}
        {loadFailed && (
          <div className="card bad" role="alert">
            <span className="selectable">{editor.inspect.error}</span>
            <button className="button" onClick={editor.inspect.reload}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>
      <textarea className="note-editor mono" aria-label={t('memFileText')} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={draft} disabled={!base} onChange={(event) => editor.setDraft(event.target.value)} />
    </section>
  )
}
