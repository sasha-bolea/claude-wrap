import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

// Builders of SDK messages for tests and fake-SDK scenarios. Only the fields core reads are filled.

let counter = 0
const uuid = () => `uuid-${++counter}`
const as = (message: object) => message as unknown as SDKMessage

export const sdk = {
  init: (sessionId: string, extra: object = {}) =>
    as({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-5-5', permissionMode: 'default', uuid: uuid(), ...extra }),
  status: (permissionMode: string) => as({ type: 'system', subtype: 'status', status: null, permissionMode, uuid: uuid() }),
  messageStart: (messageId: string) => as({ type: 'stream_event', parent_tool_use_id: null, uuid: uuid(), event: { type: 'message_start', message: { id: messageId } } }),
  blockStart: (index: number, block: object) =>
    as({ type: 'stream_event', parent_tool_use_id: null, uuid: uuid(), event: { type: 'content_block_start', index, content_block: block } }),
  textDelta: (index: number, text: string) =>
    as({ type: 'stream_event', parent_tool_use_id: null, uuid: uuid(), event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } }),
  thinkingDelta: (index: number, thinking: string) =>
    as({ type: 'stream_event', parent_tool_use_id: null, uuid: uuid(), event: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } } }),
  assistant: (messageId: string, content: object[], parent: string | null = null) =>
    as({ type: 'assistant', uuid: uuid(), parent_tool_use_id: parent, message: { id: messageId, role: 'assistant', content } }),
  toolResult: (toolUseId: string, content: unknown, isError = false) =>
    as({ type: 'user', uuid: uuid(), parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] } }),
  success: (extra: object = {}) => as({ type: 'result', subtype: 'success', uuid: uuid(), total_cost_usd: 0.01, duration_ms: 1200, ...extra }),
  aborted: () => as({ type: 'result', subtype: 'error_during_execution', uuid: uuid(), terminal_reason: 'aborted_streaming', errors: [] }),
  failure: (subtype: string, errors: string[]) => as({ type: 'result', subtype, uuid: uuid(), errors }),
  localOutput: (content: string) => as({ type: 'system', subtype: 'local_command_output', content, uuid: uuid() }),
  compactBoundary: () => as({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), compact_metadata: { trigger: 'manual', pre_tokens: 1 } }),
  conversationReset: (newId: string) => as({ type: 'conversation_reset', new_conversation_id: newId, uuid: uuid(), session_id: 'old' }),
  // What the CLI says about a sent message (msg_lifecycle_v1; the SDK's types do not have it).
  lifecycle: (commandUuid: string, state: 'queued' | 'started' | 'completed' | 'cancelled') =>
    as({ type: 'command_lifecycle', command_uuid: commandUuid, state, uuid: uuid(), session_id: 's' }),
  // resetsAt in seconds, as the CLI sends it.
  rateLimit: (status: 'allowed' | 'allowed_warning' | 'rejected', resetsAt: number) =>
    as({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt, rateLimitType: 'five_hour' }, uuid: uuid(), session_id: 's' })
}

// Builders of stored-session (JSONL) messages, as returned by getSessionMessages.
export const stored = {
  user: (id: string, content: unknown) => ({ type: 'user', uuid: id, parent_tool_use_id: null, message: { role: 'user', content } }) as unknown as SessionMessage,
  assistant: (id: string, messageId: string, content: object[]) =>
    ({ type: 'assistant', uuid: id, parent_tool_use_id: null, message: { id: messageId, role: 'assistant', content } }) as unknown as SessionMessage
}
