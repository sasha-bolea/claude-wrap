import { useEffect, useLayoutEffect, useRef, type TouchEvent } from 'react'
import { t } from '../i18n.ts'
import type { SheetSpec } from './context.tsx'
import { Icon } from './icons.tsx'

// anchor: the button it was opened from (viewport box), when it shows as a popover (wide arrangement).
export type Anchor = { top: number; bottom: number; left: number; right: number }
export type SheetEntry = SheetSpec & { id: number; anchor?: Anchor }

// Width of a popover and its distance from the button and from the window's edges (px).
const POPOVER_WIDTH = 320
const POPOVER_GAP = 6
const EDGE = 8

// Places a popover next to its button: below a button in the upper half of the window, above one in the lower half
// (the composer); aligned to the button's side nearer the window's edge; inside the window.
function placePopover(element: HTMLElement, anchor: Anchor): void {
  const below = anchor.bottom < innerHeight / 2
  const room = below ? innerHeight - anchor.bottom - POPOVER_GAP - EDGE : anchor.top - POPOVER_GAP - EDGE
  element.style.setProperty('--pop-max', `${Math.max(160, room)}px`)
  const height = Math.min(element.scrollHeight, room)
  const top = below ? anchor.bottom + POPOVER_GAP : anchor.top - POPOVER_GAP - height
  const left = anchor.right > innerWidth / 2 ? anchor.right - POPOVER_WIDTH : anchor.left
  element.style.setProperty('--pop-top', `${Math.max(EDGE, top)}px`)
  element.style.setProperty('--pop-left', `${Math.min(Math.max(EDGE, left), innerWidth - POPOVER_WIDTH - EDGE)}px`)
}

// Drag distance (px) past which a sheet dragged by its head closes.
const DRAG_CLOSE = 90

// The bottom sheets (wide arrangement: popovers by their button, or centred dialogs): one shown at a time (the last opened), over a scrim. Every sheet has the same head — grabber,
// title, Chiudi — and closes by dragging the head down, tapping the scrim or Esc. A sheet that shows up again on the
// way back (instant) has no animation. Focus: the first field of a typing sheet, otherwise the title, never a button.
export function SheetHost({ sheets, instant, onClose }: { sheets: SheetEntry[]; instant: boolean; onClose: () => void }) {
  const sheet = sheets.at(-1)
  const element = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; dy: number } | undefined>(undefined)
  // A popover is placed when it opens and again when its content grows (a list that arrives later).
  useLayoutEffect(() => {
    const root = element.current
    const anchor = sheet?.anchor
    if (!root || !anchor) return
    placePopover(root, anchor)
    const observer = new ResizeObserver(() => placePopover(root, anchor))
    for (const child of root.children) observer.observe(child)
    return () => observer.disconnect()
  }, [sheet?.id])
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
      <div className={`scrim${instant ? ' instant' : ''}${sheet.anchor ? ' clear' : ''}`} onClick={onClose} />
      <section
        key={sheet.id}
        ref={element}
        className={`sheet${instant ? ' instant' : ''}${sheet.anchor ? ' popover' : ''}`}
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
