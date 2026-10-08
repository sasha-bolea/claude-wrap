// Chat widgets in a reply: which code blocks are widgets, when a block is complete, and the messages the frame may send.
import { describe, expect, it } from 'vitest'
import { actionWords, fenceClosed, frameMessage, widgetSpec } from './widget.ts'

describe('widgetSpec', () => {
  it('an inline widget carries its HTML', () => {
    expect(widgetSpec('language-widget', '<b>hi</b>\n')).toEqual({ kind: 'inline', html: '<b>hi</b>\n' })
  })

  it('a library widget carries its name and the JSON data (none when empty)', () => {
    expect(widgetSpec('language-widget:vai', '{"text":"vai"}\n')).toEqual({ kind: 'library', name: 'vai', data: { text: 'vai' } })
    expect(widgetSpec('language-widget:vai', '\n')).toEqual({ kind: 'library', name: 'vai', data: undefined })
  })

  it('bad data or a bad name is an error the chat shows', () => {
    expect(widgetSpec('language-widget:vai', '{oops')).toEqual({ kind: 'error', reason: 'data' })
    expect(widgetSpec('language-widget:../x', '{}')).toEqual({ kind: 'error', reason: 'name' })
  })

  it('any other code block is not a widget', () => {
    expect(widgetSpec('language-ts', 'x')).toBeUndefined()
    expect(widgetSpec(undefined, 'x')).toBeUndefined()
    expect(widgetSpec('language-widgets', 'x')).toBeUndefined()
  })
})

describe('fenceClosed', () => {
  it('a fenced block is complete once its closing fence arrived', () => {
    expect(fenceClosed('```widget\n<b>hi</b>\n```')).toBe(true)
    expect(fenceClosed('~~~widget\n<b>hi</b>\n~~~')).toBe(true)
  })

  it('still streaming: no closing fence yet', () => {
    expect(fenceClosed('```widget\n<b>hi</b>\n')).toBe(false)
    expect(fenceClosed('```widget\n<b>hi</b>\n``')).toBe(false)
    expect(fenceClosed('```widget')).toBe(false)
  })
})

describe('frameMessage', () => {
  it('accepts the frame messages, typed', () => {
    expect(frameMessage({ type: 'athome.ready' })).toEqual({ type: 'athome.ready' })
    expect(frameMessage({ type: 'athome.height', height: 120.4 })).toEqual({ type: 'athome.height', height: 121 })
    expect(frameMessage({ type: 'athome.action', id: 3, action: 'prompt.send', args: { text: 'vai' } })).toEqual({ type: 'athome.action', id: 3, action: 'prompt.send', args: { text: 'vai' } })
  })

  it('refuses anything else', () => {
    expect(frameMessage('athome.ready')).toBeUndefined()
    expect(frameMessage({ type: 'other' })).toBeUndefined()
    expect(frameMessage({ type: 'athome.height', height: 'big' })).toBeUndefined()
    expect(frameMessage({ type: 'athome.action', id: 'x', action: 'prompt.send', args: {} })).toBeUndefined()
  })

  it('clamps the height', () => {
    expect(frameMessage({ type: 'athome.height', height: -5 })).toEqual({ type: 'athome.height', height: 0 })
    expect(frameMessage({ type: 'athome.height', height: 1e9 })).toEqual({ type: 'athome.height', height: 4000 })
  })
})

describe('actionWords', () => {
  it('says what a heavy action would do', () => {
    expect(actionWords({ action: 'project.create', args: { name: 'idea', parent: '/srv' } })).toEqual({ title: 'Create the project “idea” in /srv?' })
    expect(actionWords({ action: 'session.start', args: { folder: '/srv/idea', prompt: 'go' } })).toEqual({ title: 'Open a new session in /srv/idea?', detail: 'go' })
    expect(actionWords({ action: 'request.answer', args: { decision: 'allow' }, about: { toolName: 'Write', title: 'Write a.txt' } })).toEqual({ title: 'Allow “Write a.txt”?' })
  })

  it('never trusts the shape of what a widget sent', () => {
    expect(actionWords({ action: 'project.create', args: { name: 3 } })).toEqual({ title: 'Create the project “” in ?' })
    expect(actionWords({ action: 'other' })).toEqual({ title: 'Allow “other”?' })
  })
})
