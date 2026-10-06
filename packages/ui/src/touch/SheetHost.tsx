import { useEffect, useLayoutEffect, useRef } from 'react'
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

// Drag distance (px) past which a dragged sheet closes.
const DRAG_CLOSE = 90

// Whether a touch at target may pull the sheet down: fields keep their own gestures (caret, selection), and nothing
// between the target and the sheet may be scrolled away from its top (the drag scrolls it back first).
function canPull(target: Element, root: HTMLElement): boolean {
  if (target.closest('input, textarea, select, [contenteditable]')) return false
  for (let node: Element | null = target; node && node !== root.parentElement; node = node.parentElement) if (node.scrollTop > 0) return false
  return true
}

// Drag to close, on the head or on the content: a downward drag pulls the sheet when its content is at the top (a drag
// that scrolled the content up to the top goes on pulling it); released past DRAG_CLOSE it closes, otherwise it springs
// back. A drag that starts sideways never pulls. Native listeners: a pull must cancel the native scroll and bounce.
// root: the sheet; onClose: closes it. Returns the cleanup.
function dragToClose(root: HTMLElement, onClose: () => void): () => void {
  let touch: { x: number; y: number; from?: number; dy: number; sideways?: boolean } | undefined
  const start = (event: TouchEvent) => {
    const point = event.touches[0]!
    touch = { x: point.clientX, y: point.clientY, dy: 0 }
    if ((event.target as Element).closest('.sheet-head') && !(event.target as Element).closest('button')) touch.from = point.clientY
  }
  const move = (event: TouchEvent) => {
    if (!touch || touch.sideways || event.touches.length > 1) return
    const point = event.touches[0]!
    if (touch.from === undefined) {
      const dx = Math.abs(point.clientX - touch.x)
      const down = point.clientY - touch.y
      if (dx > Math.abs(down) && dx > 8) touch.sideways = true
      // Not at the top yet: the native scroll goes on; the drag starts where the content reaches the top.
      if (touch.sideways || down <= 0 || !canPull(event.target as Element, root)) return void (touch.y = point.clientY)
      touch.from = point.clientY
    }
    event.preventDefault()
    touch.dy = Math.max(0, point.clientY - touch.from)
    root.style.transform = `translateY(${touch.dy}px)`
  }
  const end = () => {
    if (touch?.from !== undefined) {
      if (touch.dy > DRAG_CLOSE) onClose()
      else root.style.transform = ''
    }
    touch = undefined
  }
  root.addEventListener('touchstart', start, { passive: true })
  root.addEventListener('touchmove', move, { passive: false })
  root.addEventListener('touchend', end)
  root.addEventListener('touchcancel', end)
  return () => {
    root.removeEventListener('touchstart', start)
    root.removeEventListener('touchmove', move)
    root.removeEventListener('touchend', end)
    root.removeEventListener('touchcancel', end)
  }
}

// The bottom sheets (wide arrangement: popovers by their button, or centred dialogs): one shown at a time (the last opened), over a scrim. Every sheet has the same head — grabber,
// title, Chiudi — and closes by dragging it down (by the head, or by the content from its top), tapping the scrim or Esc. A sheet that shows up again on the
// way back (instant) has no animation. Focus: the first field of a typing sheet, otherwise the title, never a button.
export function SheetHost({ sheets, instant, onClose }: { sheets: SheetEntry[]; instant: boolean; onClose: () => void }) {
  const sheet = sheets.at(-1)
  const element = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
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
  useEffect(() => {
    const root = element.current
    return root ? dragToClose(root, () => close.current()) : undefined
  }, [sheet?.id])
  if (!sheet) return null

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
