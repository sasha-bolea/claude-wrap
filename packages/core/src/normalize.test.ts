import { describe, expect, it } from 'vitest'
import type { Item } from '@claude-wrap/protocol'
import { Normalizer, type TranscriptWriter } from './normalize.ts'
import { sdk, stored } from './testing/messages.ts'

// Array-backed writer: records the operations and applies them immediately.
function recorder() {
  const items: Item[] = []
  const ops: string[] = []
  const writer: TranscriptWriter = {
    get: (itemId) => items.find((item) => item.itemId === itemId),
    add: (item) => (ops.push(`add ${item.itemId}`), items.push(item)),
    update: (item) => {
      ops.push(`update ${item.itemId}`)
      items[items.findIndex((existing) => existing.itemId === item.itemId)] = item
    },
    appendText: (itemId, text) => {
      ops.push(`text ${itemId}`)
      const item = items.find((existing) => existing.itemId === itemId)
      if (item && 'text' in item) item.text += text
    }
  }
  return { items, ops, normalizer: new Normalizer(writer) }
}

describe('normalizer — live messages', () => {
  it('streams text into one item and the final frame updates that same item', () => {
    const { items, ops, normalizer } = recorder()
    for (const message of [sdk.messageStart('m1'), sdk.blockStart(0, { type: 'text', text: '' }), sdk.textDelta(0, 'Hello '), sdk.textDelta(0, 'world')]) {
      normalizer.live(message)
    }
    expect(items).toEqual([{ kind: 'assistantText', itemId: 'm1:0', text: 'Hello world' }])
    normalizer.live(sdk.assistant('m1', [{ type: 'text', text: 'Hello world!' }]))
    expect(items).toEqual([expect.objectContaining({ kind: 'assistantText', itemId: 'm1:0', text: 'Hello world!' })])
    expect(ops.filter((op) => op.startsWith('add'))).toEqual(['add m1:0'])
  })

  it('maps final frames split one block per frame onto the streamed items in order', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.messageStart('m1'))
    normalizer.live(sdk.blockStart(0, { type: 'thinking', thinking: '' }))
    normalizer.live(sdk.thinkingDelta(0, 'hmm'))
    normalizer.live(sdk.blockStart(1, { type: 'text', text: '' }))
    normalizer.live(sdk.textDelta(1, 'answer'))
    normalizer.live(sdk.blockStart(2, { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }))
    normalizer.live(sdk.assistant('m1', [{ type: 'thinking', thinking: 'hmm.' }]))
    normalizer.live(sdk.assistant('m1', [{ type: 'text', text: 'answer.' }]))
    normalizer.live(sdk.assistant('m1', [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]))
    expect(items.map((item) => [item.kind, item.itemId])).toEqual([
      ['thinking', 'm1:0'],
      ['assistantText', 'm1:1'],
      ['toolCall', 'tool-1']
    ])
    expect(items[2]).toMatchObject({ name: 'Bash', input: { command: 'ls' } })
  })

  it('a streamed thinking block without text leaves no item', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.messageStart('m1'))
    normalizer.live(sdk.blockStart(0, { type: 'thinking', thinking: '' }))
    normalizer.live(sdk.assistant('m1', [{ type: 'thinking', thinking: '' }]))
    expect(items).toEqual([])
  })

  it('adds the items of an assistant message that was not streamed (local command output)', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.assistant('m9', [{ type: 'text', text: 'Context usage: …' }]))
    expect(items).toEqual([expect.objectContaining({ kind: 'assistantText', itemId: 'm9:0', text: 'Context usage: …' })])
  })

  it('attaches tool results to the tool call', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]))
    normalizer.live(sdk.toolResult('t1', [{ type: 'text', text: 'a.txt' }]))
    expect(items).toEqual([expect.objectContaining({ kind: 'toolCall', itemId: 't1', name: 'Bash', input: { command: 'ls' }, result: 'a.txt', isError: false })])
  })

  it('keeps subagent messages out of the main transcript', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.assistant('m1', [{ type: 'text', text: 'from the subagent' }], 'parent-tool'))
    expect(items).toEqual([])
  })

  it('ends the turn with cost, error, or interruption', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.success({ total_cost_usd: 0.012, duration_ms: 3400 }))
    normalizer.live(sdk.failure('error_max_turns', ['too many turns']))
    normalizer.live(sdk.aborted())
    expect(items.map(({ itemId: _itemId, sourceUuid: _sourceUuid, ...rest }) => rest)).toEqual([
      { kind: 'turnEnd', costUsd: 0.012, durationMs: 3400 },
      { kind: 'turnEnd', error: 'error_max_turns: too many turns' },
      { kind: 'turnEnd', interrupted: true }
    ])
  })

  it('records compaction and local command output', () => {
    const { items, normalizer } = recorder()
    normalizer.live(sdk.compactBoundary())
    normalizer.live(sdk.localOutput('done'))
    expect(items.map((item) => item.kind)).toEqual(['compactBoundary', 'localCommandOutput'])
    expect(items[1]).toMatchObject({ text: 'done' })
  })
})

describe('normalizer — stored history', () => {
  it('shows user prompts, slash commands, answers and tools, without other CLI markup', () => {
    const { items, normalizer } = recorder()
    const history = [
      stored.user('u1', 'run ls'),
      stored.user('u0', `<command-name>/model</command-name>
  <command-message>model</command-message>
  <command-args>haiku</command-args>`),
      stored.user('u4', '<local-command-stdout>Set model to Haiku</local-command-stdout>'),
      stored.user('u5', '<system-reminder>internal</system-reminder>'),
      stored.assistant('a1', 'm1', [{ type: 'text', text: 'Sure' }]),
      stored.assistant('a2', 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
      stored.user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      stored.user('u3', [{ type: 'text', text: '[Request interrupted by user]' }])
    ]
    for (const message of history) normalizer.history(message)
    expect(items).toEqual([
      { kind: 'user', itemId: 'u1', sourceUuid: 'u1', text: 'run ls' },
      { kind: 'user', itemId: 'u0', sourceUuid: 'u0', text: '/model haiku' },
      { kind: 'localCommandOutput', itemId: 'u4', sourceUuid: 'u4', text: 'Set model to Haiku' },
      { kind: 'assistantText', itemId: 'm1:0', sourceUuid: 'a1', text: 'Sure' },
      { kind: 'toolCall', itemId: 't1', sourceUuid: 'a2', name: 'Bash', input: {}, result: 'ok', isError: false },
      { kind: 'turnEnd', itemId: 'u3', sourceUuid: 'u3', interrupted: true }
    ])
  })

  it('continues block numbering of a message across history and live frames', () => {
    const { items, normalizer } = recorder()
    normalizer.history(stored.assistant('a1', 'm1', [{ type: 'text', text: 'one' }]))
    normalizer.live(sdk.assistant('m2', [{ type: 'text', text: 'two' }]))
    expect(items.map((item) => item.itemId)).toEqual(['m1:0', 'm2:0'])
  })
})
