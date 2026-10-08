// A plan's steps in the app's words: references, free text and existing targets are told apart.
import { describe, expect, it } from 'vitest'
import type { TabMeta } from '@athome/protocol'
import { planHeading, stepParts } from './plans.ts'

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
  const base = { planId: 'p', caller: 'petra', summary: 's', steps: [{ action: 'project.create' as const, args: {} }, { action: 'session.start' as const, args: {} }], results: [], createdAt: 0, expiresAt: 0 }
  it('says who proposes, or which step is next', () => {
    expect(planHeading({ ...base, status: 'proposed', cursor: 0 })).toBe('petra proposes a plan')
    expect(planHeading({ ...base, status: 'running', cursor: 1 })).toBe('petra’s plan · step 2 of 2')
  })
})
