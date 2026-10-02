import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Item } from '@claude-wrap/protocol'

// Turns SDK messages (live) and stored JSONL messages (history) into transcript items.
// Port of the first attempt's chat/stato.ts reducer, moved into core.
//
// Item identity: an assistant block is `${messageId}:${index}` (API block index while streaming, block ordinal
// in final frames and history); a tool call is its tool_use id; user items and turn ends use the message uuid.
// So the final `assistant` frame updates the streamed item instead of adding a second one.

// Where the normalizer writes. The transcript implements it; tests use an array.
export interface TranscriptWriter {
  get(itemId: string): Item | undefined
  add(item: Item): void
  update(item: Item): void
  appendText(itemId: string, text: string): void
}

// Messages API content block, typed only in the fields used here.
type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }
type StreamEvent = { type: string; index?: number; message?: { id?: string }; content_block?: Block; delta?: { type: string; text?: string; thinking?: string } }

// Text of a tool_result content (string or blocks).
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block: Block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

// Text of a user message content (string or blocks).
function userText(content: string | Block[]): string {
  return typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

// Item for one final assistant block, or undefined for blocks not shown (empty text, redacted thinking…).
function blockItem(block: Block, itemId: string, sourceUuid: string): Item | undefined {
  if (block.type === 'text' && block.text) return { kind: 'assistantText', itemId, sourceUuid, text: block.text }
  if (block.type === 'thinking' && block.thinking) return { kind: 'thinking', itemId, sourceUuid, text: block.thinking }
  if (block.type === 'tool_use' && block.id) return { kind: 'toolCall', itemId: block.id, sourceUuid, name: block.name ?? '?', input: block.input ?? {} }
  return undefined
}

// A slash command as the CLI stores it ("<command-name>/model</command-name>…<command-args>haiku</command-args>"),
// back to what the user typed ("/model haiku"); undefined for any other text.
function storedCommand(text: string): string | undefined {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]
  if (!name) return undefined
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}

// Turn-end item of a result: cost and duration, an interruption (Esc/Stop), or the error.
function turnEnd(message: Extract<SDKMessage, { type: 'result' }>): Item {
  const base = { kind: 'turnEnd' as const, itemId: message.uuid, sourceUuid: message.uuid }
  if (message.subtype === 'success') return { ...base, costUsd: message.total_cost_usd, durationMs: message.duration_ms }
  if (message.terminal_reason?.startsWith('aborted')) return { ...base, interrupted: true }
  return { ...base, error: [message.subtype, ...(message.errors ?? [])].join(': ') }
}

export class Normalizer {
  private readonly out: TranscriptWriter
  // Message being streamed (from message_start), and final blocks already seen per message id.
  private streamingMessageId = ''
  private readonly finalBlocks = new Map<string, number>()

  constructor(out: TranscriptWriter) {
    this.out = out
  }

  // Applies a live SDK message. Subagent messages stay out of the main transcript (task panel in Phase 4).
  live(message: SDKMessage): void {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return
    switch (message.type) {
      case 'stream_event':
        return this.streamEvent(message.event as StreamEvent)
      case 'assistant':
        return this.assistantBlocks(message.message.id ?? message.uuid, message.message.content as Block[], message.uuid)
      case 'user':
        // The user's own text is added by core at dispatch; from the live stream only tool results matter.
        return Array.isArray(message.message.content) ? this.toolResults(message.message.content as Block[]) : undefined
      case 'result':
        return this.out.add(turnEnd(message))
      case 'system':
        if (message.subtype === 'compact_boundary') this.out.add({ kind: 'compactBoundary', itemId: message.uuid, sourceUuid: message.uuid })
        if (message.subtype === 'local_command_output') this.out.add({ kind: 'localCommandOutput', itemId: message.uuid, sourceUuid: message.uuid, text: message.content })
    }
  }

  // Applies a stored message of a resumed session: here the user's text is shown too, and so are slash commands
  // and their local output; other CLI markup is not.
  history(message: SessionMessage): void {
    if (message.parent_tool_use_id || message.type === 'system') return
    const { content, id } = message.message as { content: string | Block[]; id?: string }
    if (message.type === 'assistant') return this.assistantBlocks(id ?? message.uuid, content as Block[], message.uuid)
    const text = userText(content)
    const base = { itemId: message.uuid, sourceUuid: message.uuid }
    // Marker the CLI stores when a turn is interrupted.
    if (text.startsWith('[Request interrupted')) return this.out.add({ ...base, kind: 'turnEnd', interrupted: true })
    const command = storedCommand(text)
    const output = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text)?.[1]
    if (command) this.out.add({ ...base, kind: 'user', text: command })
    else if (output) this.out.add({ ...base, kind: 'localCommandOutput', text: output })
    else if (text && !text.startsWith('<')) this.out.add({ ...base, kind: 'user', text })
    if (Array.isArray(content)) this.toolResults(content)
  }

  // Streaming events. A tool call appears when its block starts; text and thinking items appear with their
  // first delta (a thinking block whose text is not sent, e.g. Haiku, must not leave an empty item).
  private streamEvent(event: StreamEvent): void {
    if (event.type === 'message_start') this.streamingMessageId = event.message?.id ?? ''
    const itemId = `${this.streamingMessageId}:${event.index}`
    const block = event.content_block
    if (event.type === 'content_block_start' && block?.type === 'tool_use' && block.id) {
      this.out.add({ kind: 'toolCall', itemId: block.id, name: block.name ?? '?', input: block.input ?? {} })
    }
    if (event.type !== 'content_block_delta' || !event.delta) return
    const kind = event.delta.type === 'text_delta' ? 'assistantText' : event.delta.type === 'thinking_delta' ? 'thinking' : undefined
    const text = event.delta.text ?? event.delta.thinking ?? ''
    if (!kind || !text) return
    if (this.out.get(itemId)) this.out.appendText(itemId, text)
    else this.out.add({ kind, itemId, text })
  }

  // Final blocks of an assistant message: update the streamed item with the same id, or add a new one.
  private assistantBlocks(messageId: string, blocks: Block[], sourceUuid: string): void {
    for (const block of blocks) {
      const ordinal = this.finalBlocks.get(messageId) ?? 0
      this.finalBlocks.set(messageId, ordinal + 1)
      const item = blockItem(block, `${messageId}:${ordinal}`, sourceUuid)
      if (!item) continue
      if (this.out.get(item.itemId)) this.out.update(item)
      else this.out.add(item)
    }
  }

  // Attaches tool_result blocks to their tool call items.
  private toolResults(blocks: Block[]): void {
    for (const block of blocks) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue
      const call = this.out.get(block.tool_use_id)
      if (call?.kind === 'toolCall') this.out.update({ ...call, result: toolResultText(block.content), isError: Boolean(block.is_error) })
    }
  }
}
