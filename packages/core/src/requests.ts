import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { CommandArgs, PermissionMode, Request } from '@athome/protocol'
import { CoreError } from './errors.ts'

export type Answer = Omit<CommandArgs<'request.answer'>, 'tabId' | 'requestId'>
type Pending = { request: Request; suggestions?: PermissionUpdate[]; resolve: (result: PermissionResult) => void }

export interface RequestEvents {
  opened(request: Request): void
  resolved(requestId: string, by: string, outcome: Answer['decision']): void
  cancelled(requestId: string): void
}

// Messages sent to Claude when the user denies without writing a reason.
const DEFAULT_DENY: Record<Request['kind'], string> = {
  permission: 'The user denied this action.',
  question: 'The user preferred not to answer.',
  plan: 'The user wants to keep planning.'
}

// Which dialog a canUseTool call needs.
function kindOf(toolName: string): Request['kind'] {
  if (toolName === 'AskUserQuestion') return 'question'
  if (toolName === 'ExitPlanMode') return 'plan'
  return 'permission'
}

// Builds the SDK PermissionResult for a semantic answer: clients never craft updatedPermissions themselves.
export function buildResult({ request, suggestions }: Pending, answer: Answer): PermissionResult {
  if (answer.decision === 'deny') return { behavior: 'deny', message: answer.reason?.trim() || DEFAULT_DENY[request.kind] }
  const allow = { behavior: 'allow' as const, updatedInput: request.input }
  if (request.kind === 'question') return { ...allow, updatedInput: { ...request.input, ...(answer.answers && { answers: answer.answers }) } }
  if (request.kind === 'plan' && answer.planNextMode) {
    return { ...allow, updatedPermissions: [{ type: 'setMode', mode: answer.planNextMode, destination: 'session' }] }
  }
  if (answer.decision === 'allowAlways' && suggestions?.length) return { ...allow, updatedPermissions: suggestions }
  return allow
}

// Mode set by a result's updatedPermissions (plan approval, "always" suggestions), if any.
export function modeSetBy(result: PermissionResult): PermissionMode | undefined {
  if (result.behavior !== 'allow') return undefined
  return result.updatedPermissions?.findLast((update) => update.type === 'setMode')?.mode
}

// Open requests of one tab. First valid answer resolves the SDK promise; later answers get request_resolved.
export class Requests {
  private readonly pending = new Map<string, Pending>()
  private readonly events: RequestEvents

  constructor(events: RequestEvents) {
    this.events = events
  }

  get size(): number {
    return this.pending.size
  }

  list(): Request[] {
    return [...this.pending.values()].map((pending) => pending.request)
  }

  // canUseTool implementation: opens a request and waits for an answer or the CLI's cancellation.
  ask: CanUseTool = (toolName, input, options) => {
    const { signal, requestId, toolUseID, suggestions, suppressAlwaysAllowRule } = options
    const request: Request = {
      requestId,
      kind: kindOf(toolName),
      toolName,
      input,
      toolUseId: toolUseID,
      canAllowAlways: Boolean(suggestions?.length) && !suppressAlwaysAllowRule,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
      decisionReason: options.decisionReason,
      blockedPath: options.blockedPath,
      defaultToNo: options.defaultToNo,
      agentId: options.agentID
    }
    return new Promise((resolve) => {
      this.pending.set(requestId, { request, suggestions, resolve })
      signal.addEventListener('abort', () => this.cancel(requestId, { behavior: 'deny', message: 'Request cancelled' }), { once: true })
      this.events.opened(request)
    })
  }

  // Resolves a request with a user's answer. by: who answered. Returns the result given to the SDK.
  answer(requestId: string, answer: Answer, by: string): PermissionResult {
    const pending = this.pending.get(requestId)
    if (!pending) throw new CoreError('request_resolved', 'request already answered or cancelled')
    this.pending.delete(requestId)
    const result = buildResult(pending, answer)
    pending.resolve(result)
    this.events.resolved(requestId, by, answer.decision)
    return result
  }

  // Denies every open request with interrupt (tab closing): Claude stops instead of trying something else.
  denyAll(message: string): void {
    for (const requestId of [...this.pending.keys()]) this.cancel(requestId, { behavior: 'deny', message, interrupt: true })
  }

  // Removes a request and tells subscribers it is gone.
  private cancel(requestId: string, result: PermissionResult): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.resolve(result)
    this.events.cancelled(requestId)
  }
}
