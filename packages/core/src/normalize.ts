import type { SDKMessage, SDKMessageOrigin, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { IMAGE_TYPES, type Image, type ImageRef, type ImageType, type Item } from '@athome/protocol'

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
  // Stores image bytes, returns the id items reference them by.
  addBlob(image: Image): string
}

// Messages API content block, typed only in the fields used here.
type Block = {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { type: string; media_type?: string; data?: string }
}
type StreamEvent = { type: string; index?: number; message?: { id?: string }; content_block?: Block; delta?: { type: string; text?: string; thinking?: string } }

// Text of a tool_result content (string or blocks).
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block: Block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

// The origin of a stored message when another session sent it here (SendMessage, kind 'peer'): the CLI stores it with
// the message, outside the SDK's SessionMessage type.
export function peerOrigin(message: SessionMessage): SDKMessageOrigin | undefined {
  const origin = (message as { origin?: SDKMessageOrigin }).origin
  return origin?.kind === 'peer' ? origin : undefined
}

// The sender and text of a message another session sent here, from its origin (also on the result of the turn it
// started): name (empty when the sender gave none) and body, the text without the CLI's envelope (fallback when the
// sender gave none). undefined for any other message, and for one without text.
export function peerOf(origin: SDKMessageOrigin | undefined, fallback: string): { from: string; text: string } | undefined {
  if (origin?.kind !== 'peer') return undefined
  const text = origin.body ?? fallback
  return text.trim() ? { from: origin.name ?? '', text } : undefined
}

// The message another session sent, when a stored message is one with text (see peerOf). Its content comes from a
// file another session wrote to: read defensively.
export function storedPeer(message: SessionMessage): { from: string; text: string } | undefined {
  const origin = peerOrigin(message)
  const content = (message.message as { content?: unknown } | undefined)?.content
  return origin && peerOf(origin, typeof content === 'string' || Array.isArray(content) ? userText(content as string | Block[]) : '')
}

// Text of a user message content (string or blocks).
function userText(content: string | Block[]): string {
  return typeof content === 'string' ? content : content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
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

// Text between <tag> and </tag>, or undefined when the tag is absent.
const tagged = (text: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]

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
  // Live assistant messages already applied: after /compact the CLI emits the preserved ones again, with the same
  // uuid and a new message id.
  private readonly appliedAssistants = new Set<string>()
  // Last stored `!` command, which the next stored <bash-stdout> message completes.
  private lastShell?: Extract<Item, { kind: 'shell' }>

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
        if (this.appliedAssistants.has(message.uuid)) return
        this.appliedAssistants.add(message.uuid)
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

  // Applies a stored message of a resumed session: here the user's text and images are shown too, and so are slash
  // commands with their local output and `!` commands with theirs; other CLI markup is not.
  history(message: SessionMessage): void {
    if (message.parent_tool_use_id || message.type === 'system') return
    // A message from another session: its sender and text, never the CLI's envelope (nothing when it has no text).
    if (peerOrigin(message)) {
      const peer = storedPeer(message)
      return void (peer && this.out.add({ kind: 'peerMessage', itemId: message.uuid, sourceUuid: message.uuid, ...peer }))
    }
    const { content, id } = message.message as { content: string | Block[]; id?: string }
    if (message.type === 'assistant') return this.assistantBlocks(id ?? message.uuid, content as Block[], message.uuid)
    const text = userText(content)
    const base = { itemId: message.uuid, sourceUuid: message.uuid }
    // Marker the CLI stores when a turn is interrupted.
    if (text.startsWith('[Request interrupted')) return this.out.add({ ...base, kind: 'turnEnd', interrupted: true })
    const command = storedCommand(text)
    const output = tagged(text, 'local-command-stdout')
    const shell = tagged(text, 'bash-input')
    const shellOutput = tagged(text, 'bash-stdout')
    const images = Array.isArray(content) ? this.storeImages(content) : []
    if (command) this.out.add({ ...base, kind: 'user', text: command })
    else if (output) this.out.add({ ...base, kind: 'localCommandOutput', text: output })
    else if (shell !== undefined) this.out.add((this.lastShell = { ...base, kind: 'shell', command: shell, output: '' }))
    else if (shellOutput !== undefined && this.lastShell) {
      const stderr = tagged(text, 'bash-stderr')
      this.out.update({ ...this.lastShell, output: [shellOutput, stderr].filter(Boolean).join('\n') })
      this.lastShell = undefined
    } else if ((text && !text.startsWith('<')) || images.length) this.out.add({ ...base, kind: 'user', text, ...(images.length ? { images } : {}) })
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

  // Moves the base64 image blocks of a stored user message into the blob store; returns their references.
  private storeImages(blocks: Block[]): ImageRef[] {
    return blocks.flatMap((block) => {
      const { source } = block
      const mediaType = source?.media_type as ImageType
      if (block.type !== 'image' || source?.type !== 'base64' || !source.data || !IMAGE_TYPES.includes(mediaType)) return []
      const image: Image = { mediaType, data: source.data }
      return [{ imageId: this.out.addBlob(image), mediaType: image.mediaType }]
    })
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
