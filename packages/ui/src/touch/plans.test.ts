// A plan's steps in the app's words: references, free text and existing targets are told apart.
import { describe, expect, it } from 'vitest'
import type { Plan, TabMeta } from '@athome/protocol'
import { planHeading, planRows, stepParts } from './plans.ts'

const tabs = [{ tabId: 't1', title: 'Website' }] as TabMeta[]
const words = (parts: ReturnType<typeof stepParts>) => parts.map((part) => (part.kind === 'text' ? part.text : `[${part.kind}:${part.text}]`)).join('')

describe('stepParts', () => {
  it('a new project in the Home, then a session in it with a free prompt', () => {
    expect(words(stepParts({ action: 'project.create', args: { name: 'idea' } }, tabs))).toBe('Create the project “idea” in the Home')
    expect(words(stepParts({ action: 'session.start', args: { folder: { $step: 1, field: 'path' }, prompt: { $free: true } } }, tabs))).toBe('Open a new session in the folder from step 1 and send: “[free:free text]”')
  })

  it('an existing folder or chat is marked as such; a chat shows its title', () => {
    expect(words(stepParts({ action: 'project.create', args: { name: 'idea', parent: '/srv' } }, tabs))).toBe('Create the project “idea” in [existing:/srv]')
    expect(words(stepParts({ action: 'prompt.send', args: { tabId: 't1', text: 'go' } }, tabs))).toBe('Send to [existing:Website]: “go”')
    expect(words(stepParts({ action: 'session.close', args: { tabId: 'gone' } }, tabs))).toBe('Close [existing:chat gone]')
  })

  it('every action has its sentence', () => {
    expect(words(stepParts({ action: 'folder.create', args: { parent: '/srv', name: 'box' } }, tabs))).toBe('Create the folder “box” in [existing:/srv]')
    expect(words(stepParts({ action: 'project.mark', args: { path: '/srv/box', project: false } }, tabs))).toBe('Take the project mark off [existing:/srv/box]')
    expect(words(stepParts({ action: 'session.follow', args: { tabId: { $step: 2, field: 'tabId' } } }, tabs))).toBe('Follow the chat from step 2 until Claude finishes, answering its requests (allowing them too)')
    expect(words(stepParts({ action: 'queue.add', args: { tabId: 't1', text: 'later' } }, tabs))).toBe('Queue in [existing:Website]: “later”')
    expect(words(stepParts({ action: 'queue.remove', args: { tabId: 't1', queueId: { $step: 3, field: 'queueId' } } }, tabs))).toBe('Take the message from step 3 out of the queue of [existing:Website]')
    expect(words(stepParts({ action: 'session.stop', args: { tabId: 't1' } }, tabs))).toBe('Interrupt Claude in [existing:Website]')
    expect(words(stepParts({ action: 'request.answer', args: { tabId: 't1', decision: 'deny' } }, tabs))).toBe('Answer the request of [existing:Website]: deny')
  })
})

describe('planHeading', () => {
  const base = { planId: 'p', caller: 'petra', summary: 's', steps: [{ action: 'project.create' as const, args: {} }, { action: 'session.start' as const, args: {}, optional: true }, { action: 'session.close' as const, args: {} }], results: [], createdAt: 0, expiresAt: 0 }
  it('says who proposes, which steps may run next, or that the plan follows a chat', () => {
    expect(planHeading({ ...base, status: 'proposed', at: [{ path: [], index: 0 }] })).toBe('petra proposes a plan')
    expect(planHeading({ ...base, status: 'running', at: [{ path: [], index: 0 }] })).toBe('petra’s plan · next: step 1')
    expect(planHeading({ ...base, status: 'running', at: [{ path: [], index: 1 }] })).toBe('petra’s plan · next: step 2 or 3')
    expect(planHeading({ ...base, status: 'running', at: [{ path: [], index: 1 }], following: 't1' })).toBe('petra’s plan · following a chat')
  })
})

describe('planRows', () => {
  const step = (name: string, extra: object = {}) => ({ action: 'project.create' as const, args: { name }, ...extra })
  const steps: Plan['steps'] = [
    step('a'),
    { either: [{ if: 'Claude asks', steps: [step('b')] }, { if: 'otherwise', steps: [{ repeat: 3, if: 'until it is done', steps: [step('c')] }] }] },
    step('d', { optional: true, if: 'only at the end' })
  ]
  const plan = (extra: Partial<Plan>): Plan => ({ planId: 'p', caller: 'petra', summary: 's', steps, status: 'proposed', at: [{ path: [], index: 0 }], results: [], createdAt: 0, expiresAt: 0, ...extra })
  // A row in short: its depth, then the words (and a step's state).
  const short = (rows: ReturnType<typeof planRows>) => rows.map((row) => `${row.depth}${row.kind === 'step' ? ` ${row.number}. ${words(row.parts)}${row.note ? ` (${row.note})` : ''} [${row.state}]` : ` ${row.text}`}`)

  it('lays out choices, groups and optional steps, numbered in reading order', () => {
    expect(short(planRows(plan({}), tabs))).toEqual([
      '0 1. Create the project “a” in the Home [later]',
      '0 Only one of these ways:',
      '0 If Claude asks:',
      '1 2. Create the project “b” in the Home [later]',
      '0 If otherwise:',
      '1 Up to 3 times, until it is done:',
      '2 3. Create the project “c” in the Home [later]',
      '0 4. Create the project “d” in the Home (optional: only at the end) [later]'
    ])
  })

  it('running, in the group after a round: what ran, what may run next (another round, or the last step), what is out', () => {
    const rows = planRows(plan({ status: 'running', at: [{ path: [], index: 2 }, { path: [1, 1], index: 1 }, { path: [1, 1, 0], index: 1, round: 1 }], results: [{ path: '/a' }, null, { path: '/c' }] }), tabs)
    expect(rows.flatMap((row) => (row.kind === 'step' ? [`${row.number}:${row.state}`] : []))).toEqual(['1:ran', '2:out', '3:next', '4:next'])
  })
})
