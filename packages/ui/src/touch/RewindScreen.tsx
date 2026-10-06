import { useEffect, useRef, useState } from 'react'
import { ClientError } from '@athome/client'
import type { Image } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { IconButton, Title, useQuery } from './parts.tsx'

type Mode = 'both' | 'conversation' | 'code'
// A message to go back to (tab.rewindPoints), oldest first.
type Point = { itemId: string; text: string; images?: number }
// What tab.rewind answers.
type Outcome = { text?: string; images?: Image[]; filesChanged?: string[]; skippedLinks?: number; newTabId?: string }

// The text of a failed rewind: Claude working gets a clear message, anything else the reason as given.
function rewindError(error: unknown): string {
  if (error instanceof ClientError && error.code === 'session_busy') return t('rewindBusy')
  return error instanceof Error ? error.message : String(error)
}

// The prompt of a point as the list and the sheets show it: its text, or the photo count when it has none.
const pointText = (point: Point) => point.text || t('imagesOnly', { count: String(point.images ?? 0) })

// The outcome of a restore as a short notice: files restored and links skipped (nothing when code was not touched).
function outcomeNotice(mode: Mode, outcome: Outcome): string | undefined {
  if (mode === 'conversation') return t('rewindDoneConversation')
  const files = outcome.filesChanged?.length ?? 0
  const skipped = outcome.skippedLinks ? ` ${t('rewindSkipped', { count: String(outcome.skippedLinks) })}` : ''
  return `${t(mode === 'both' ? 'rewindDoneBoth' : 'rewindDoneCode', { count: String(files) })}${skipped}`
}

// What the preview says about the code: the files that would change with the totals, or the CLI's reason it cannot.
function PreviewCard({ tabId, itemId, onReady }: { tabId: string; itemId: string; onReady: (files: number) => void }) {
  const { connection } = useTouch()
  const { data } = useQuery(() => connection.request('tab.rewindPreview', { tabId, itemId }), [connection, tabId, itemId])
  useEffect(() => data && onReady(data.canRewind ? (data.filesChanged?.length ?? 0) : 0), [data])
  if (!data)
    return (
      <p className="muted flat" role="status">
        {t('rewindChecking')}
      </p>
    )
  const files = data.canRewind ? (data.filesChanged ?? []) : []
  return (
    <div className={`card compact${data.canRewind ? '' : ' bad'}`}>
      <strong>{files.length ? t('rewindFilesTitle', { count: String(files.length) }) : t('rewindNoFiles')}</strong>
      {!data.canRewind && data.error && <span className="row-sub">{data.error}</span>}
      {files.length > 0 && (
        <>
          <ul className="rewind-files">
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          <span className="rewind-diff">
            <span className="added">+{data.insertions ?? 0}</span> <span className="removed">−{data.deletions ?? 0}</span>
          </span>
        </>
      )}
    </div>
  )
}

// Second step of a restore ("Are you sure?"): applies it, then goes back to the chat with the prompt in its composer
// (a conversation mode) or shows what was restored. Errors stay in the sheet. Cancel goes back to the actions.
function RewindConfirm({ tabId, point, mode }: { tabId: string; point: Point; mode: Mode }) {
  const touch = useTouch()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  // Leaves the rewind screen for the chat that now holds the prompt (the new session when it was the first message).
  const finish = (outcome: Outcome) => {
    touch.closeSheets()
    const target = outcome.newTabId ?? tabId
    if (mode !== 'code') touch.insertInComposer(target, { text: outcome.text ?? point.text, images: outcome.images })
    const notice = outcomeNotice(mode, outcome)
    if (notice) touch.toast(notice)
    if (outcome.newTabId) touch.reset([{ name: 'home' }, { name: 'chat', tabId: outcome.newTabId }])
    else if (touch.wide && touch.panel?.name === 'rewind') touch.togglePanel(touch.panel)
    else touch.backTo((screen) => screen.name === 'chat' && screen.tabId === tabId)
  }
  const apply = () => {
    setWorking(true)
    setError(undefined)
    touch.connection.request('tab.rewind', { tabId, itemId: point.itemId, mode }).then(finish, (failure: unknown) => (setError(rewindError(failure)), setWorking(false)))
  }
  return (
    <>
      <p className="rewind-quote">
        <span className="clamp-4">{pointText(point)}</span>
      </p>
      <p className="flat">{t(`rewindConfirm_${mode}`)}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="two-buttons">
        <button className="button" onClick={touch.closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" disabled={working} onClick={apply}>
          {t(`rewindApply_${mode}`)}
        </button>
      </div>
    </>
  )
}

// The actions for one message: the preview of the files, then restore code and conversation / conversation / code
// (code only where there are file changes) and Never mind. Each opens its confirmation.
function RewindActions({ tabId, point }: { tabId: string; point: Point }) {
  const { openSheet, closeSheet } = useTouch()
  const [files, setFiles] = useState<number>()
  const ask = (mode: Mode) => openSheet({ title: t('rewindConfirmTitle'), body: <RewindConfirm tabId={tabId} point={point} mode={mode} /> })
  const modes: Mode[] = files ? ['both', 'conversation', 'code'] : ['conversation']
  return (
    <>
      <p className="rewind-quote">
        <span className="clamp-4">{pointText(point)}</span>
      </p>
      <PreviewCard tabId={tabId} itemId={point.itemId} onReady={setFiles} />
      {files !== undefined && (
        <ul className="menu">
          {modes.map((mode) => (
            <li key={mode}>
              <button onClick={() => ask(mode)}>{t(`rewindMode_${mode}`)}</button>
            </li>
          ))}
          <li>
            <button onClick={closeSheet}>{t('rewindNeverMind')}</button>
          </li>
        </ul>
      )}
    </>
  )
}

// Go back to one of your messages, as /rewind: your messages in order (the latest at the bottom), a tap opens the
// actions for it. itemId (a long press on a message) goes straight to its actions once the list is loaded.
export function RewindScreen({ tabId, itemId }: { tabId: string; itemId?: string }) {
  const { connection, back, openSheet, toast } = useTouch()
  const { data } = useQuery(() => connection.request('tab.rewindPoints', { tabId }), [connection, tabId])
  const body = useRef<HTMLDivElement>(null)
  const opened = useRef(false)
  const open = (point: Point) => openSheet({ title: t('rewindTitle'), body: <RewindActions tabId={tabId} point={point} /> })
  useEffect(() => {
    const box = body.current
    if (data && box) box.scrollTop = box.scrollHeight
    const target = itemId ? data?.points.find((point) => point.itemId === itemId) : undefined
    if (data && itemId && !opened.current) {
      opened.current = true
      if (target) open(target)
      else toast(t('rewindNotFound'))
    }
  }, [data])
  return (
    <section className="screen" aria-label={t('rewindTitle')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('rewindTitle')} sub={t('rewindSub')} />
      </header>
      <div className="scroll" ref={body}>
        <div className="pad tight">
          {!data && (
            <p className="muted flat" role="status">
              {t('loading')}
            </p>
          )}
          {data && !data.points.length && <p className="muted flat">{t('rewindEmpty')}</p>}
          {data && data.points.length > 0 && (
            <ul className="list">
              {data.points.map((point) => (
                <li key={point.itemId} className="row">
                  <button className="row-main" onClick={() => open(point)}>
                    <span className="row-title clamp-2">{pointText(point)}</span>
                    {point.images ? <span className="row-sub">{t('imagesCount', { count: String(point.images) })}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
