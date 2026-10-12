import { useEffect, useRef, useState, type PointerEvent } from 'react'

// The two columns of cards under the composer.
export type TrayList = 'notes' | 'queue'
// Where a card dragged over the other column would land.
export type DropTarget = { list: TrayList; index: number }

// A press that moves farther than this (px) drags the card instead of opening it.
const DRAG_START = 5

// Drag the cards of the notes and the queue with a mouse or a finger. Past DRAG_START px the pressed card is dragged:
// over its own column it takes the place of the card under the pointer (the order changes as it goes, committed on
// release); over the other column it shows where it would land, and released there it moves to that column.
// Parameters: ids (each column's cards in their order), onReorder (a column's new order and the card moved) and onMove (a card dropped on
// the other column at an index).
// Returns order (a column's cards, as dragged), register / registerColumn (the elements), handlers (for a card's grab
// area: the card's handle), dragged and target.
export function useTrayDrag({ ids, onReorder, onMove }: { ids: Record<TrayList, string[]>; onReorder: (list: TrayList, ids: string[], id: string) => void; onMove: (from: TrayList, id: string, to: TrayList, index: number) => void }) {
  const cards = useRef(new Map<string, HTMLElement>())
  const columns = useRef(new Map<TrayList, HTMLElement>())
  const press = useRef<{ list: TrayList; id: string; y: number; moved: boolean }>(undefined)
  // While dragging (and until the lists come back in that order): a column's order as dragged.
  const [live, setLive] = useState<Partial<Record<TrayList, string[]>>>({})
  const [dragged, setDragged] = useState<{ list: TrayList; id: string }>()
  const [target, setTarget] = useState<DropTarget>()
  const order = (list: TrayList) => live[list] ?? ids[list]
  const latest = useRef(order)
  latest.current = order
  const targetRef = useRef<DropTarget>(undefined)
  const key = `${ids.notes.join()}|${ids.queue.join()}`
  useEffect(() => setLive({}), [key])

  const register = (list: TrayList, id: string, element: HTMLElement | null) => {
    if (element) cards.current.set(`${list}:${id}`, element)
    else cards.current.delete(`${list}:${id}`)
  }
  const registerColumn = (list: TrayList, element: HTMLElement | null) => {
    if (element) columns.current.set(list, element)
    else columns.current.delete(list)
  }
  // The column under a point of the screen, if any.
  const columnAt = (x: number, y: number) =>
    ([...columns.current.entries()].find(([, element]) => {
      const box = element.getBoundingClientRect()
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    }) ?? [])[0]
  // A card of a column under a height of the screen.
  const cardAt = (list: TrayList, y: number) =>
    latest.current(list).find((id) => {
      const box = cards.current.get(`${list}:${id}`)?.getBoundingClientRect()
      return box !== undefined && y >= box.top && y <= box.bottom
    })
  // Where a card would land in a column: before the first card whose middle is below the pointer.
  const indexAt = (list: TrayList, y: number) => {
    const index = latest.current(list).findIndex((id) => {
      const box = cards.current.get(`${list}:${id}`)?.getBoundingClientRect()
      return box !== undefined && y < box.top + box.height / 2
    })
    return index < 0 ? latest.current(list).length : index
  }
  const aim = (next: DropTarget | undefined) => {
    targetRef.current = next
    setTarget(next)
  }
  const end = () => {
    press.current = undefined
    setDragged(undefined)
    aim(undefined)
  }

  const handlers = (list: TrayList, id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button === 0) press.current = { list, id, y: event.clientY, moved: false }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current
      if (!current || current.id !== id || current.list !== list) return
      if (!current.moved) {
        if (Math.abs(event.clientY - current.y) < DRAG_START) return
        current.moved = true
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragged({ list, id })
      }
      const over = columnAt(event.clientX, event.clientY)
      if (over && over !== list) return aim({ list: over, index: indexAt(over, event.clientY) })
      aim(undefined)
      if (over !== list) return
      const under = cardAt(list, event.clientY)
      const before = latest.current(list)
      if (!under || under === id) return
      const next = before.filter((other) => other !== id)
      next.splice(next.indexOf(under) + (before.indexOf(under) > before.indexOf(id) ? 1 : 0), 0, id)
      setLive((current) => ({ ...current, [list]: next }))
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = press.current
      const drop = targetRef.current
      if (!current?.moved) return end()
      event.currentTarget.releasePointerCapture(event.pointerId)
      end()
      if (drop) onMove(list, id, drop.list, drop.index)
      else if (latest.current(list).join() !== ids[list].join()) onReorder(list, latest.current(list), id)
    },
    onPointerCancel: end
  })
  return { order, register, registerColumn, handlers, dragged, target }
}

export type TrayDrag = ReturnType<typeof useTrayDrag>
