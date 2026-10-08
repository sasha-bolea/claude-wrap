import { randomUUID } from 'node:crypto'
import { CORE_ACTIONS, isOpenPlan, type CommandArgs, type CoreActionName, type Plan, type PlanProposal, type PlanStep, type StepRef } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// Plans (protocol plans.ts): a caller with a key proposes a summary and steps in order; the user approves it in the
// app; then the caller may run only the next step, with the arguments the user saw (an earlier step's result or free
// text where the plan said so), with no confirmation, until the last step. A session.follow step lasts a turn of its
// chat: meanwhile the caller may answer that chat's requests. A plan expires after ttlMs; the open ones are saved in
// <stateDir>/plans.json and come back after a restart.

type Saved = { plans: Plan[] }
// What the caller may run under a plan: the resolved arguments of the step (tabId apart), or a pass-through answer
// while following a chat (no step consumed).
export type Begun = { args: Record<string, unknown>; tabId?: string; passthrough: boolean }

// Actions that act on a chat (their args name it as tabId); fields a step may leave free; what an earlier step's
// result offers to a reference.
const CHAT_ACTIONS: CoreActionName[] = ['prompt.send', 'request.answer', 'session.follow', 'queue.add', 'queue.remove', 'session.stop', 'session.close']
const FREE_FIELDS: Partial<Record<CoreActionName, string[]>> = { 'prompt.send': ['text'], 'session.start': ['prompt'], 'queue.add': ['text'] }
const RESULT_FIELDS: Partial<Record<CoreActionName, StepRef['field'][]>> = { 'project.create': ['path'], 'folder.create': ['path'], 'session.start': ['tabId'], 'queue.add': ['queueId'] }

const isRef = (value: unknown): value is StepRef => Boolean(value) && typeof value === 'object' && '$step' in (value as object)
const isFree = (value: unknown): boolean => Boolean(value) && typeof value === 'object' && (value as { $free?: unknown }).$free === true
// JSON with sorted keys: the same arguments give the same text.
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner as object).sort(([a], [b]) => a.localeCompare(b))) : inner))
const denied = (message: string) => new CoreError('action_denied', message)

// Checks a proposal: every step's arguments fit its action once references and free text are filled, a reference
// points at an earlier step that gives that field, free text sits only where the action allows it, a chat's action
// names its chat. Throws invalid_args.
function check({ steps }: PlanProposal): void {
  steps.forEach((step, index) => {
    const number = index + 1
    const probe: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(step.args)) {
      if (isRef(value)) {
        const earlier = steps[value.$step - 1]
        if (value.$step >= number || !earlier) throw new CoreError('invalid_args', `step ${number} refers to step ${value.$step}, which is not before it`)
        if (!RESULT_FIELDS[earlier.action]?.includes(value.field)) throw new CoreError('invalid_args', `step ${number}: step ${value.$step} (${earlier.action}) gives no ${value.field}`)
        probe[field] = 'x'
      } else if (isFree(value)) {
        if (!FREE_FIELDS[step.action]?.includes(field)) throw new CoreError('invalid_args', `step ${number}: ${field} of ${step.action} cannot be free text`)
        probe[field] = 'x'
      } else probe[field] = value
    }
    if (CHAT_ACTIONS.includes(step.action) && typeof probe.tabId !== 'string') throw new CoreError('invalid_args', `step ${number}: ${step.action} needs its chat (tabId)`)
    const parsed = CORE_ACTIONS[step.action].safeParse(probe)
    if (!parsed.success) throw new CoreError('invalid_args', `step ${number} (${step.action}): ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'} ${issue.message}`).join('; ')}`)
  })
}

// A step's arguments with references filled from the results so far. free: what a free field takes (absent: the
// field is left out).
function resolve(step: PlanStep, results: Plan['results'], free?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(step.args)) {
    if (isRef(value)) {
      const result = results[value.$step - 1]?.[value.field]
      if (typeof result !== 'string') throw denied(`step ${value.$step} gave no ${value.field}`)
      out[field] = result
    } else if (isFree(value)) {
      if (free && field in free) out[field] = free[field]
    } else out[field] = value
  }
  return out
}

export class PlanStore {
  private plans: Plan[] = []
  private readonly file?: JsonFile<Saved>
  private readonly ttlMs: number
  private readonly changed: () => void
  private readonly proposed?: (plan: Plan) => void
  private readonly timers = new Map<string, NodeJS.Timeout>()
  readonly loaded: Promise<void>

  // file: where the open plans are saved (absent: memory only); ttlMs: how long a plan may live; changed: called after
  // every change the app should see; proposed: called with every new proposal (a notification).
  constructor(file: string | undefined, ttlMs: number, changed: () => void, proposed?: (plan: Plan) => void) {
    this.file = file ? new JsonFile<Saved>(file) : undefined
    this.ttlMs = ttlMs
    this.changed = changed
    this.proposed = proposed
    this.loaded = (this.file?.read() ?? Promise.resolve(undefined)).then((saved) => {
      this.plans = (saved?.plans ?? []).filter(isOpenPlan)
      this.plans.forEach((plan) => this.watch(plan))
      this.sweep()
    })
  }

  // The plans to answer or under way.
  open(): Plan[] {
    this.sweep()
    return this.plans.filter(isOpenPlan)
  }

  // A caller's proposal, checked and kept as proposed (the app shows it).
  propose(caller: string, proposal: PlanProposal): Plan {
    check(proposal)
    const now = Date.now()
    const plan: Plan = { ...proposal, planId: randomUUID(), caller, status: 'proposed', cursor: 0, results: [], createdAt: now, expiresAt: now + this.ttlMs }
    this.plans.push(plan)
    this.watch(plan)
    this.commit()
    this.proposed?.(plan)
    return plan
  }

  // The user's answer. request_resolved when the plan is not waiting for one.
  answer(planId: string, decision: 'approve' | 'reject'): void {
    const plan = this.plans.find((one) => one.planId === planId)
    if (!plan || plan.status !== 'proposed') throw new CoreError('request_resolved', 'this plan is not waiting for an answer')
    plan.status = decision === 'approve' ? 'running' : 'rejected'
    this.commit()
  }

  // Cancels an open plan. caller: the caller cancelling (must own the plan); absent: the app.
  cancel(planId: string, caller?: string): void {
    const plan = this.plans.find((one) => one.planId === planId && isOpenPlan(one))
    if (!plan) throw new CoreError('not_found', 'no such open plan')
    if (caller && plan.caller !== caller) throw new CoreError('unauthorized', 'not your plan')
    plan.status = 'cancelled'
    this.commit()
  }

  // What a caller may run now under a plan: the next step with the arguments the user saw, or an answer to the chat
  // it follows. run: the actions.run arguments. Throws action_denied for anything else.
  begin(planId: string, caller: string, run: CommandArgs<'actions.run'>): Begun {
    this.sweep()
    const plan = this.plans.find((one) => one.planId === planId && one.caller === caller)
    if (!plan || plan.status !== 'running') throw denied(plan ? `this plan is ${plan.status}` : 'no such plan of yours')
    const step = plan.steps[plan.cursor]!
    const given: Record<string, unknown> = { ...run.args, ...(run.tabId ? { tabId: run.tabId } : {}) }
    if (plan.following) {
      const followed = resolve(step, plan.results).tabId
      if (run.action === 'request.answer' && typeof followed === 'string' && given.tabId === followed) return { args: run.args, tabId: followed, passthrough: true }
      throw denied(`step ${plan.cursor + 1} follows a chat: only its requests can be answered until its turn ends`)
    }
    if (step.action !== run.action) throw denied(`step ${plan.cursor + 1} is ${step.action}, not ${run.action}`)
    const resolved = resolve(step, plan.results, given)
    if (canonical(resolved) !== canonical(given)) throw denied(`not the arguments the user approved for step ${plan.cursor + 1}`)
    const { tabId, ...args } = resolved
    return { args, ...(typeof tabId === 'string' ? { tabId } : {}), passthrough: false }
  }

  // The current step ran: keeps its result and moves on (the plan is done after the last one). A session.follow step
  // whose chat is at work stays current, following, until the turn ends.
  complete(planId: string, value: unknown): void {
    const plan = this.plans.find((one) => one.planId === planId && one.status === 'running')
    if (!plan) return
    const step = plan.steps[plan.cursor]!
    if (step.action === 'session.follow' && (value as { following?: boolean } | undefined)?.following) plan.following = true
    else this.advance(plan, value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
    this.commit()
  }

  // A chat's turn ended: the plans following it move on.
  onTurnFinished(tabId: string): void {
    let moved = false
    for (const plan of this.plans) {
      if (plan.status !== 'running' || !plan.following) continue
      if (resolve(plan.steps[plan.cursor]!, plan.results).tabId !== tabId) continue
      plan.following = false
      this.advance(plan, {})
      moved = true
    }
    if (moved) this.commit()
  }

  private advance(plan: Plan, result: Record<string, unknown>): void {
    plan.results[plan.cursor] = result
    plan.cursor++
    if (plan.cursor >= plan.steps.length) plan.status = 'done'
  }

  // Flips the plans past their time to expired.
  private sweep(): void {
    const now = Date.now()
    let flipped = false
    for (const plan of this.plans) {
      if (!isOpenPlan(plan) || plan.expiresAt > now) continue
      plan.status = 'expired'
      flipped = true
    }
    if (flipped) this.commit()
  }

  // Tells the app when a plan expires, so it disappears without anyone asking.
  private watch(plan: Plan): void {
    const timer = setTimeout(() => (this.timers.delete(plan.planId), this.sweep()), Math.max(0, plan.expiresAt - Date.now()))
    timer.unref()
    this.timers.set(plan.planId, timer)
  }

  // Saves the open plans, forgets the closed ones, and tells the app.
  private commit(): void {
    this.plans = this.plans.filter(isOpenPlan)
    for (const [planId, timer] of this.timers) if (!this.plans.some((plan) => plan.planId === planId)) (clearTimeout(timer), this.timers.delete(planId))
    void this.file?.save({ plans: this.plans })
    this.changed()
  }
}
