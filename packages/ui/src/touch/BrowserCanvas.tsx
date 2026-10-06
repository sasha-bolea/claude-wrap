import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Connection } from '@athome/client'
import type { BrowserSnapshot } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { frameBox, jpegBlob, pageFraction, viewportFor, type Box } from './browserView.ts'

// The shared browser's page: a canvas drawing the latest frame, the page size following the canvas, and what I do on
// it (tap, drag, wheel) sent as pointer and wheel commands. Text goes through the hidden field of BrowserScreen.

export type BrowserFrame = NonNullable<BrowserSnapshot['frame']>
export type DrawRef = RefObject<((frame: BrowserFrame) => void) | undefined>

// A size change is sent to the backend once the canvas has stopped changing size for this long (the keyboard sliding
// in resizes it many times).
const RESIZE_DELAY = 150
// A line of a wheel is this many px.
const LINE_PX = 16

// Draws frames into the canvas. A frame arriving while another is decoded waits (the newest one wins). Returns the
// box the page occupies in the canvas (canvas px) and a repaint for when the canvas changes size.
function useFramePainter(canvas: RefObject<HTMLCanvasElement | null>, drawRef: DrawRef) {
  const bitmap = useRef<ImageBitmap | undefined>(undefined)
  const box = useRef<Box>({ x: 0, y: 0, width: 0, height: 0 })
  const repaint = useCallback(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    context.clearRect(0, 0, element.width, element.height)
    if (!bitmap.current) return
    box.current = frameBox(element.width, element.height, bitmap.current.width, bitmap.current.height)
    context.drawImage(bitmap.current, box.current.x, box.current.y, box.current.width, box.current.height)
  }, [canvas])
  useEffect(() => {
    let decoding = false
    let waiting: BrowserFrame | undefined
    const draw = (frame: BrowserFrame) => {
      if (decoding) return void (waiting = frame)
      decoding = true
      createImageBitmap(jpegBlob(frame.data))
        .then((next) => (bitmap.current?.close(), (bitmap.current = next), repaint()))
        .catch(() => undefined)
        .finally(() => {
          decoding = false
          const next = waiting
          waiting = undefined
          if (next) draw(next)
        })
    }
    drawRef.current = draw
    return () => {
      drawRef.current = undefined
      bitmap.current?.close()
      bitmap.current = undefined
    }
  }, [drawRef, repaint])
  return { box, repaint }
}

// Keeps the canvas as sharp as its box (pixel ratio) and, once the browser is up (active), asks for a page of that
// size: a phone's page is a mobile one with the screen's pixel ratio.
function useViewport(canvas: RefObject<HTMLCanvasElement | null>, active: boolean, phone: boolean, connection: Connection, repaint: () => void) {
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fit = () => {
      const rect = element.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      element.width = Math.max(1, Math.round(rect.width * ratio))
      element.height = Math.max(1, Math.round(rect.height * ratio))
      repaint()
      clearTimeout(timer)
      if (!active || rect.width < 1 || rect.height < 1) return
      timer = setTimeout(() => void connection.request('browser.viewport', viewportFor(rect.width, rect.height, phone, ratio)).catch(() => undefined), RESIZE_DELAY)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    fit()
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [canvas, active, phone, connection, repaint])
}

// Where a pointer or wheel event lands on the page (0..1), or undefined outside the drawn page.
function pointOf(element: HTMLCanvasElement, box: Box, event: { clientX: number; clientY: number }, clamp = false) {
  const rect = element.getBoundingClientRect()
  const scale = element.width / rect.width
  return pageFraction(box, (event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale, clamp)
}

// Taps, drags and mouse moves on the page as pointer commands (moves at most once per animation frame; a finger
// moves the page only while down). Returns the handlers of the canvas.
function usePointerInput(canvas: RefObject<HTMLCanvasElement | null>, box: RefObject<Box>, connection: Connection) {
  const pressed = useRef(false)
  const moved = useRef<{ x: number; y: number; touch: boolean } | undefined>(undefined)
  const raf = useRef<number | undefined>(undefined)
  const send = (type: 'down' | 'move' | 'up', at: { x: number; y: number }, extra: { button?: 'left' | 'right' | 'middle'; clickCount?: number; touch?: boolean }) =>
    void connection.request('browser.pointer', { type, ...at, ...extra }).catch(() => undefined)
  const flush = () => {
    cancelAnimationFrame(raf.current ?? 0)
    raf.current = undefined
    const last = moved.current
    moved.current = undefined
    if (last) send('move', last, last.touch ? { touch: true } : {})
  }
  useEffect(() => () => cancelAnimationFrame(raf.current ?? 0), [])
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = canvas.current && pointOf(canvas.current, box.current, event)
    if (!at) return
    pressed.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const button = (['left', 'middle', 'right'] as const)[event.button] ?? 'left'
    send('down', at, { button, clickCount: Math.min(3, Math.max(1, event.detail)), ...(event.pointerType === 'touch' ? { touch: true } : {}) })
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const touch = event.pointerType === 'touch'
    if (touch && !pressed.current) return
    const at = canvas.current && pointOf(canvas.current, box.current, event, pressed.current)
    if (!at) return
    moved.current = { ...at, touch }
    raf.current ??= requestAnimationFrame(flush)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pressed.current || !canvas.current) return
    pressed.current = false
    flush()
    const at = pointOf(canvas.current, box.current, event, true)
    if (at) send('up', at, { button: (['left', 'middle', 'right'] as const)[event.button] ?? 'left', ...(event.pointerType === 'touch' ? { touch: true } : {}) })
  }
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onContextMenu: (event: { preventDefault(): void }) => event.preventDefault() }
}

// The mouse wheel as wheel commands, gathered per animation frame (not passive: the page under it must not scroll).
function useWheel(canvas: RefObject<HTMLCanvasElement | null>, box: RefObject<Box>, connection: Connection) {
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let sum: { x: number; y: number; dx: number; dy: number } | undefined
    let raf = 0
    const flush = () => {
      if (sum) void connection.request('browser.wheel', sum).catch(() => undefined)
      sum = undefined
      raf = 0
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const at = pointOf(element, box.current, event)
      if (!at) return
      const unit = event.deltaMode === 1 ? LINE_PX : 1
      sum = { ...at, dx: (sum?.dx ?? 0) + event.deltaX * unit, dy: (sum?.dy ?? 0) + event.deltaY * unit }
      raf ||= requestAnimationFrame(flush)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(raf)
    }
  }, [canvas, box, connection])
}

// The canvas of the page. drawRef: gets the function that draws a frame; active: the browser is up (its size is asked).
export function BrowserCanvas({ drawRef, active }: { drawRef: DrawRef; active: boolean }) {
  const { connection, wide } = useTouch()
  const canvas = useRef<HTMLCanvasElement>(null)
  const { box, repaint } = useFramePainter(canvas, drawRef)
  useViewport(canvas, active, !wide, connection, repaint)
  useWheel(canvas, box, connection)
  const handlers = usePointerInput(canvas, box, connection)
  return <canvas ref={canvas} className="browser-canvas" aria-label={t('browserPage')} {...handlers} />
}
