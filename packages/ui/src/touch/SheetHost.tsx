import { useEffect, useRef, type TouchEvent } from 'react'
import { t } from '../i18n.ts'
import type { SheetSpec } from './context.tsx'
import { Icon } from './icons.tsx'

export type SheetEntry = SheetSpec & { id: number }

// Drag distance (px) past which a sheet dragged by its head closes.
const DRAG_CLOSE = 90

// The bottom sheets: one shown at a time (the last opened), over a scrim. Every sheet has the same head — grabber,
// title, Chiudi — and closes by dragging the head down, tapping the scrim or Esc. A sheet that shows up again on the
// way back (instant) has no animation. Focus: the first field of a typing sheet, otherwise the title, never a button.
export function SheetHost({ sheets, instant, onClose }: { sheets: SheetEntry[]; instant: boolean; onClose: () => void }) {
  const sheet = sheets.at(-1)
  const element = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; dy: number } | undefined>(undefined)
  useEffect(() => {
    const root = element.current
    if (!root || !sheet) return
    root.scrollTop = 0
    const field = sheet.field ? root.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]), textarea') : null
    ;(field ?? root.querySelector<HTMLElement>('.sheet-head h2'))?.focus({ preventScroll: true })
  }, [sheet?.id])
  if (!sheet) return null

  const onTouchStart = (event: TouchEvent) => {
    if ((event.target as Element).closest('.sheet-head') && !(event.target as Element).closest('button')) drag.current = { y: event.touches[0]!.clientY, dy: 0 }
  }
  const onTouchMove = (event: TouchEvent) => {
    if (!drag.current || !element.current) return
    drag.current.dy = Math.max(0, event.touches[0]!.clientY - drag.current.y)
    element.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onTouchEnd = () => {
    if (!drag.current) return
    if (drag.current.dy > DRAG_CLOSE) onClose()
    else if (element.current) element.current.style.transform = ''
    drag.current = undefined
  }

  return (
    <>
      <div className={`scrim${instant ? ' instant' : ''}`} onClick={onClose} />
      <section
        key={sheet.id}
        ref={element}
        className={`sheet${instant ? ' instant' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`sheet-title-${sheet.id}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onClose()
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="sheet-head">
          <h2 id={`sheet-title-${sheet.id}`} tabIndex={-1}>
            {sheet.title}
          </h2>
          <button className="icon-btn" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {sheet.path && <p className="muted path-line">{sheet.path}</p>}
        {sheet.body}
      </section>
    </>
  )
}
