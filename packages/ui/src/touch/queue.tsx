import { useState } from 'react'
import type { QueuedMessage, TabMeta } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'

// How many cards of the queue's stack show (the first with its text, the others as edges peeking out).
const STACK = 4

// Why the queue waits, in words (the usage limit says until when).
export function pauseWords(meta: TabMeta): string | undefined {
  const pause = meta.queuePause
  if (!pause) return undefined
  if (pause.reason === 'limit' && pause.until) return t('queuePausedUntil', { time: new Date(pause.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  return t('queuePaused')
}

// The queue under the composer: a stack of cards (only the first shows its text, one line) and play/pause beside it.
// A tap on the stack opens the whole queue. Nothing shows while the queue is empty.
export function QueueTray({ meta }: { meta: TabMeta }) {
  const { connection, openSheet, announce, fail } = useTouch()
  if (!meta.queue.length) return null
  const shown = meta.queue.slice(0, STACK)
  const paused = Boolean(meta.queuePause)
  const toggle = () =>
    connection.request('tab.queuePause', { tabId: meta.tabId, paused: !paused }).then(() => announce(t(paused ? 'queueResumed' : 'queuePaused')), fail)
  return (
    <div className="queue-tray">
      <button className="q-stack" aria-label={t('queueStackLabel', { count: String(meta.queue.length), next: meta.queue[0]!.text })} onClick={() => openSheet({ title: t('queue'), body: <QueueSheet tabId={meta.tabId} /> })}>
        {shown.map((item, index) => (
          <span key={item.queueId} className={`q-card k${index} m${shown.length - 1}`} aria-hidden="true">
            {index === 0 && <span className="q-line">{item.text || t('imagesOnly', { count: String(item.images ?? 0) })}</span>}
          </span>
        ))}
      </button>
      <button className="icon-btn q-play" aria-label={paused ? `${pauseWords(meta)}: ${t('resume')}` : t('pauseQueue')} onClick={() => void toggle()}>
        <Icon name={paused ? 'play' : 'pause'} />
      </button>
    </div>
  )
}

// The whole queue; a message opens its actions.
function QueueSheet({ tabId }: { tabId: string }) {
  const { state, openSheet } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  if (!meta) return null
  const paused = pauseWords(meta)
  return (
    <>
      {paused && <p className="muted flat">{paused}</p>}
      <ul className="menu">
        {meta.queue.map((item) => (
          <li key={item.queueId}>
            <button className="q-sheet-item" onClick={() => openSheet({ title: t('queuedMessage'), body: <QueueItemSheet tabId={tabId} queueId={item.queueId} /> })}>
              <span className="q-line">{item.text || t('imagesOnly', { count: String(item.images ?? 0) })}</span>
            </button>
          </li>
        ))}
        {!meta.queue.length && (
          <li className="muted" role="status">
            {t('queueEmpty')}
          </li>
        )}
      </ul>
    </>
  )
}

// One queued message: edit, send now (read at Claude's next step, nothing interrupted), move up or down, remove.
function QueueItemSheet({ tabId, queueId }: { tabId: string; queueId: string }) {
  const { state, connection, openSheet, closeSheet, closeSheets, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const index = meta?.queue.findIndex((item) => item.queueId === queueId) ?? -1
  if (!meta || index < 0) return null
  const item = meta.queue[index]!
  const running = meta.status === 'running' || meta.status === 'requires_action'
  const act = (request: Promise<unknown>, all = false) => request.then(() => (all ? closeSheets() : closeSheet()), fail)
  return (
    <>
      <p className="flat pre-wrap">{item.text}</p>
      <ul className="menu">
        <li>
          <button onClick={() => openSheet({ title: t('editQueued'), field: true, body: <QueueEditSheet tabId={tabId} item={item} /> })}>{t('edit')}</button>
        </li>
        <li>
          <button onClick={() => void act(connection.request('tab.sendNow', { tabId, queueId }), true)}>
            {t('sendNow')}
            {running && <span className="right">{t('readAtNextStep')}</span>}
          </button>
        </li>
        <li>
          <button disabled={index === 0} onClick={() => void act(connection.request('tab.queueMove', { tabId, queueId, index: index - 1 }))}>
            {t('moveUp')}
          </button>
        </li>
        <li>
          <button disabled={index === meta.queue.length - 1} onClick={() => void act(connection.request('tab.queueMove', { tabId, queueId, index: index + 1 }))}>
            {t('moveDown')}
          </button>
        </li>
        <li>
          <button className="danger" onClick={() => void act(connection.request('tab.unqueue', { tabId, queueId }))}>
            {t('removeFromQueue')}
          </button>
        </li>
      </ul>
    </>
  )
}

function QueueEditSheet({ tabId, item }: { tabId: string; item: QueuedMessage }) {
  const { connection, closeSheet, fail } = useTouch()
  const [text, setText] = useState(item.text)
  const save = () => connection.request('tab.queueEdit', { tabId, queueId: item.queueId, text }).then(closeSheet, fail)
  return (
    <>
      <textarea className="field" aria-label={t('text')} rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      <button className="button primary block" disabled={!text.trim() && !item.images} onClick={() => void save()}>
        {t('save')}
      </button>
    </>
  )
}
