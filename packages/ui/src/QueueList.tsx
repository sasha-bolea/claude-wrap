import type { QueuedMessage } from '@claude-wrap/protocol'
import { t } from './i18n.ts'

type QueueListProps = {
  queue: QueuedMessage[]
  onSendNow: (queueId: string) => void
  onRemove: (queueId: string) => void
}

// Messages waiting for the turn to end (kept by core, shared by every device). Each can go out now (interrupting
// the turn) or be taken back.
export function QueueList({ queue, onSendNow, onRemove }: QueueListProps) {
  return (
    <section className="item queue" aria-label={t('queueRegion')}>
      <ul className="queue-list">
        {queue.map((message) => (
          <li key={message.queueId} className="queue-entry">
            <span className="queue-text">
              {message.text}
              {message.images ? <span className="chip">{t('queuedImages', { count: String(message.images) })}</span> : null}
            </span>
            <div className="actions">
              <button className="button" onClick={() => onSendNow(message.queueId)}>
                {t('sendNow')}
              </button>
              <button className="button danger" onClick={() => onRemove(message.queueId)}>
                {t('removeQueued')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
