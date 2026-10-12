import type { TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { NewCard, TrayCard, TrayItem } from './NotesTray.tsx'
import { IconButton } from './parts.tsx'
import type { TrayDrag } from './trayDrag.ts'

// How many cards of the queue's stack show (the first with its text, the others as edges peeking out).
const STACK = 4

// Why the queue waits, in words (the usage limit says until when).
export function pauseWords(meta: TabMeta): string | undefined {
  const pause = meta.queuePause
  if (!pause) return undefined
  if (pause.reason === 'limit' && pause.until) return t('queuePausedUntil', { time: new Date(pause.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  return t('queuePaused')
}

// The queue still waiting: the message counting down to go is already in the composer, so it is no longer in the queue.
export const waitingQueue = (meta: TabMeta) => meta.queue.filter((message) => message.queueId !== meta.queueCountdown?.queueId)

// The queue under the composer: a stack of cards (only the first shows its text, one line, and a bin on its right that
// removes it) and play/pause beside it. A tap on the stack opens the whole queue (onOpen). Nothing shows while the queue
// is empty.
export function QueueTray({ meta, onOpen }: { meta: TabMeta; onOpen: () => void }) {
  const { connection, announce, fail } = useTouch()
  const queue = waitingQueue(meta)
  if (!queue.length) return null
  const shown = queue.slice(0, STACK)
  const paused = Boolean(meta.queuePause)
  const next = queue[0]!
  const nextText = next.text || t('imagesOnly', { count: String(next.images ?? 0) })
  const removeNext = () =>
    connection.request('tab.unqueue', { tabId: meta.tabId, queueId: next.queueId }).then(() => announce(t('removedFromQueue')), fail)
  const toggle = () =>
    connection.request('tab.queuePause', { tabId: meta.tabId, paused: !paused }).then(() => announce(t(paused ? 'queueResumed' : 'queuePaused')), fail)
  return (
    <div className="queue-tray">
      <div className={`q-front m${shown.length - 1}`}>
        <button className="q-stack" aria-label={t('queueStackLabel', { count: String(queue.length), next: next.text })} onClick={onOpen}>
          {shown.map((item, index) => (
            <span key={item.queueId} className={`q-card k${index} m${shown.length - 1}`} aria-hidden="true">
              {index === 0 && <span className="q-line">{nextText}</span>}
            </span>
          ))}
        </button>
        <button className="icon-btn q-remove" aria-label={t('removeNextQueued', { next: nextText })} onClick={() => void removeNext()}>
          <Icon name="trash" />
        </button>
      </div>
      <button className="icon-btn q-play" aria-label={paused ? `${pauseWords(meta)}: ${t('resume')}` : t('pauseQueue')} onClick={() => void toggle()}>
        <Icon name={paused ? 'play' : 'pause'} />
      </button>
    </div>
  )
}

// The queue as a list of cards (the Coda tool): the first card adds a message at the end (into an empty queue it waits
// there, the queue paused, until ▶); each other card is edited in place, removed (top right), sent now (bottom right:
// read at Claude's next step, nothing interrupted) and dragged by its handle to another place.
// Parameters: the chat's meta and the drag.
export function QueueColumn({ meta, drag }: { meta: TabMeta; drag: TrayDrag }) {
  const { connection, announce, fail } = useTouch()
  const tabId = meta.tabId
  const queue = waitingQueue(meta)
  const byId = new Map(queue.map((message) => [message.queueId, message]))
  const shown = drag.order('queue').flatMap((id) => byId.get(id) ?? [])
  const remove = (queueId: string) => connection.request('tab.unqueue', { tabId, queueId }).then(() => announce(t('removedFromQueue')), fail)
  return (
    <div className="tray queue-column" ref={(element) => drag.registerColumn('queue', element)}>
      <ul className={`tray-list${drag.target?.list === 'queue' ? ' drop-target' : ''}`}>
        <li>
          <NewCard label={t('addToQueue')} saveLabel={t('queueIt')} onKeep={(text) => connection.request('tab.queueAdd', { tabId, text, hold: true })} />
        </li>
        {shown.map((message, index) => (
          <TrayItem key={message.queueId} list="queue" id={message.queueId} index={index} drag={drag}>
            <TrayCard
              className="q"
              text={message.text}
              label={message.text || t('imagesOnly', { count: String(message.images ?? 0) })}
              fieldLabel={t('queuedText')}
              list="queue"
              id={message.queueId}
              drag={drag}
              onSave={(text) => void connection.request('tab.queueEdit', { tabId, queueId: message.queueId, text }).catch(fail)}
              onEmptied={() => (message.images ? void connection.request('tab.queueEdit', { tabId, queueId: message.queueId, text: '' }).catch(fail) : void remove(message.queueId))}
            >
              {Boolean(message.images) && <span className="chip q-images">{t('imagesOnly', { count: String(message.images) })}</span>}
              <IconButton icon="trash" className="tray-note-delete" label={t('removeFromQueue')} onClick={() => void remove(message.queueId)} />
              <button className="send tray-note-send" aria-label={t('sendNow')} onClick={() => void connection.request('tab.sendNow', { tabId, queueId: message.queueId }).catch(fail)}>
                <Icon name="send" />
              </button>
            </TrayCard>
          </TrayItem>
        ))}
        {drag.target?.list === 'queue' && drag.target.index >= shown.length && <li className="drop-marker" aria-hidden="true" />}
      </ul>
    </div>
  )
}
