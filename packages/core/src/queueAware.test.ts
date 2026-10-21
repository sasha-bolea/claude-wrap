// Claude knows about the AtHome queue. User stories:
// 1. Claude starts a message with more queued after it: it is told how many wait, so it does not stop on a question
//    and keeps the explanations for the end;
// 2. Claude starts the last message of a queued series: it is told to give the full explanation for the whole queue;
// 3. the queue changes while Claude works (a message added, removed, the queue paused): it is told at its next tool
//    step, only when the number changed;
// 4. a message with no queue around it: Claude is told nothing.
import { describe, expect, it } from 'vitest'
import { QUEUE_LAST, QueueAwareness, queueMore } from './queueAware.ts'

// An awareness over a queue whose size the test sets.
function setup(initial = 0) {
  const state = { waiting: initial }
  return { state, aware: new QueueAwareness(() => state.waiting) }
}

describe('queue awareness', () => {
  it('says nothing for a message with no queue around it', () => {
    const { aware } = setup()
    expect(aware.atPrompt()).toBeUndefined()
    expect(aware.afterTool()).toBeUndefined()
  })

  it('tells how many wait at the start of a turn, then that the last one is the last', () => {
    const { state, aware } = setup(2)
    aware.startedFromQueue()
    expect(aware.atPrompt()).toBe(queueMore(2))
    aware.turnEnded()
    state.waiting = 1
    aware.startedFromQueue()
    expect(aware.atPrompt()).toBe(queueMore(1))
    aware.turnEnded()
    state.waiting = 0
    aware.startedFromQueue()
    expect(aware.atPrompt()).toBe(QUEUE_LAST)
    aware.turnEnded()
    expect(aware.atPrompt()).toBeUndefined()
  })

  it('a message typed directly with messages queued after it starts a series', () => {
    const { state, aware } = setup(1)
    expect(aware.atPrompt()).toBe(queueMore(1))
    aware.turnEnded()
    state.waiting = 0
    aware.startedFromQueue()
    expect(aware.atPrompt()).toBe(QUEUE_LAST)
  })

  it('tells a change during the turn once, at the next tool step', () => {
    const { state, aware } = setup()
    expect(aware.atPrompt()).toBeUndefined()
    state.waiting = 1
    expect(aware.afterTool()).toBe(queueMore(1))
    expect(aware.afterTool()).toBeUndefined()
    state.waiting = 3
    expect(aware.afterTool()).toBe(queueMore(3))
    state.waiting = 0
    expect(aware.afterTool()).toBe(QUEUE_LAST)
    expect(aware.afterTool()).toBeUndefined()
  })

  it('a series ends with its turn when nothing waits (a paused queue counts as nothing)', () => {
    const { state, aware } = setup(1)
    aware.atPrompt()
    state.waiting = 0
    aware.turnEnded()
    expect(aware.atPrompt()).toBeUndefined()
  })

  it('pluralises the count', () => {
    expect(queueMore(1)).toContain('1 more message from the user is waiting')
    expect(queueMore(2)).toContain('2 more messages from the user are waiting')
  })
})
