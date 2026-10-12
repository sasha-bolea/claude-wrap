import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { t } from '../i18n.ts'
import { readPanelWidth, readTerminalShare, writePanelWidth, writeTerminalShare } from '../viewState.ts'

// The pointer's position along the divider's axis: x for a vertical divider (a column edge), y for a horizontal one.
type Axis = 'vertical' | 'horizontal'
const along = (axis: Axis, event: PointerEvent) => (axis === 'vertical' ? event.clientX : event.clientY)
// The divider's centre along its axis.
function centreOf(axis: Axis, element: Element): number {
  const box = element.getBoundingClientRect()
  return axis === 'vertical' ? box.left + box.width / 2 : box.top + box.height / 2
}

// A divider dragged to share the room between two areas (a finger, a mouse or the arrow keys); it sits centred on the
// boundary between them. The caller moves the areas: onDrag while dragging and onDrop at release get where the
// boundary goes (x or y, wherever the divider was grabbed), onStep an arrow key (-1 left/up, +1 right/down), onReset a
// double click. value/min/max: what a screen reader says (the size it sets).
export function Divider({ className, label, axis, value, min, max, onDrag, onDrop, onStep, onReset }: { className: string; label: string; axis: Axis; value: number; min: number; max: number; onDrag: (position: number) => void; onDrop: (position: number) => void; onStep: (direction: -1 | 1) => void; onReset: () => void }) {
  const grab = useRef(0)
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    grab.current = along(axis, event) - centreOf(axis, event.currentTarget)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => event.currentTarget.hasPointerCapture(event.pointerId) && onDrag(along(axis, event) - grab.current)
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    onDrop(along(axis, event) - grab.current)
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key] as -1 | 1 | undefined
    if (!direction) return
    event.preventDefault()
    onStep(direction)
  }
  return (
    <div
      className={`divider ${className}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
    />
  )
}

// Wide: the right panel's width, its default, the least it takes and the room the chat always keeps beside it.
const PANEL_WIDTH = 380
const PANEL_MIN = 300
const PANEL_ROOM = 640
const PANEL_STEP = 20

// Wide: the left edge of the right panel, dragged to widen or narrow it (one width for every panel, remembered on this
// device; a double click puts it back). device: the app's root, where the width goes as --panel-w.
export function PanelDivider({ device }: { device: RefObject<HTMLDivElement | null> }) {
  const [width, setWidth] = useState(readPanelWidth)
  useLayoutEffect(() => {
    if (width) device.current?.style.setProperty('--panel-w', `${width}px`)
    else device.current?.style.removeProperty('--panel-w')
  }, [device, width])
  const max = () => Math.max(PANEL_MIN, (device.current?.clientWidth ?? 0) - PANEL_ROOM)
  const clamp = (value: number) => Math.min(Math.max(value, PANEL_MIN), max())
  // The panel's width with its left edge at x (the panel ends at the window's right edge).
  const at = (x: number) => clamp((device.current?.getBoundingClientRect().right ?? x) - x)
  const save = (value: number | undefined) => (setWidth(value), writePanelWidth(value))
  const shown = Math.min(width ?? PANEL_WIDTH, max())
  return (
    <Divider
      className="panel-divider"
      label={t('panelWidth')}
      axis="vertical"
      value={shown}
      min={PANEL_MIN}
      max={max()}
      onDrag={(x) => device.current?.style.setProperty('--panel-w', `${at(x)}px`)}
      onDrop={(x) => save(at(x))}
      onStep={(direction) => save(clamp(shown - direction * PANEL_STEP))}
      onReset={() => save(undefined)}
    />
  )
}

// Phone: the terminal's share of the height beside its chat, by default and at most/least; dropped this close to the
// top edge, the terminal goes back to full screen.
const SHARE = 0.5
const SHARE_MIN = 0.2
const SHARE_MAX = 0.8
const SHARE_EXIT = 0.12
const SHARE_STEP = 0.05

// Phone: the bar between the chat (above) and its terminal (below), dragged to share the height (remembered on this
// device; a double click halves it again). device: the app's root, where the chat's height goes as --split-top.
// onFull: the bar was dropped at the top edge.
export function SplitDivider({ device, onFull }: { device: RefObject<HTMLDivElement | null>; onFull: () => void }) {
  const [share, setShare] = useState(() => readTerminalShare() ?? SHARE)
  const place = (value: number) => device.current?.style.setProperty('--split-top', `${(1 - value) * 100}%`)
  useLayoutEffect(() => place(share), [device, share])
  const clamp = (value: number) => Math.min(Math.max(value, SHARE_MIN), SHARE_MAX)
  // The terminal's share with the bar at y, unclamped.
  const at = (y: number) => {
    const box = device.current?.getBoundingClientRect()
    return box ? 1 - (y - box.top) / box.height : share
  }
  const save = (value: number) => (setShare(value), writeTerminalShare(value), place(value))
  return (
    <Divider
      className="split-divider"
      label={t('terminalSize')}
      axis="horizontal"
      value={share * 100}
      min={SHARE_MIN * 100}
      max={SHARE_MAX * 100}
      onDrag={(y) => place(clamp(at(y)))}
      onDrop={(y) => (at(y) > 1 - SHARE_EXIT ? (place(share), onFull()) : save(clamp(at(y))))}
      onStep={(direction) => save(clamp(share - direction * SHARE_STEP))}
      onReset={() => save(SHARE)}
    />
  )
}
