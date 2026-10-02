import type { Channel } from './index.ts'

type EndState = { messageListeners: ((frame: unknown) => void)[]; closeListeners: (() => void)[] }

// Creates two connected in-memory channel ends (tests and in-process hosts).
// Delivery is asynchronous and structured-cloned like a real transport; closing either end closes both.
// Returns [endA, endB].
export function createChannelPair(): [Channel, Channel] {
  let open = true
  const states: [EndState, EndState] = [
    { messageListeners: [], closeListeners: [] },
    { messageListeners: [], closeListeners: [] }
  ]
  const closeBoth = () => {
    if (!open) return
    open = false
    for (const state of states) for (const listener of state.closeListeners) queueMicrotask(listener)
  }
  const makeEnd = (self: EndState, peer: EndState): Channel => ({
    send: (frame) => {
      if (!open) return
      const copy = structuredClone(frame)
      // Like a socket, frames sent before close are still delivered.
      queueMicrotask(() => peer.messageListeners.forEach((listener) => listener(copy)))
    },
    onMessage: (listener) => self.messageListeners.push(listener),
    onClose: (listener) => self.closeListeners.push(listener),
    close: closeBoth
  })
  return [makeEnd(states[0], states[1]), makeEnd(states[1], states[0])]
}
