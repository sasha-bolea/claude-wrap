import { randomUUID } from 'node:crypto'
import {
  CORE_ACTIONS,
  PLAN_LIMITS,
  isOpenPlan,
  isPlanEither,
  isPlanRepeat,
  planNext,
  planSchema,
  planStart,
  planSteps,
  stepsApart,
  type CommandArgs,
  type CoreActionName,
  type NumberedStep,
  type Plan,
  type PlanLogEntry,
  type PlanMove,
  type PlanNode,
  type PlanProposal,
  type PlanStep,
  type StepRef
} from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// Plans (protocol plans.ts): a caller with a key proposes a summary and its steps; the user approves it in the app;
// then the caller may run only a step the plan allows next (planNext: the next one, a skippable one, the first of a
// branch, a group's next round), with the arguments the user saw (an earlier step's result or free text where the
// plan said so), with no confirmation, until nothing is left or the caller ends it (finish) with only skippable steps
// left. When an action fits two of the steps allowed now, the caller names the step. A session.follow step lasts a
// turn of its chat: meanwhile the caller may answer that chat's requests, nothing else. A plan expires after ttlMs;
// the open ones are saved in <stateDir>/plans.json and come back after a restart.

type Saved = { plans: Plan[] }
// What the caller may run under a plan: the resolved arguments of the step (tabId apart) and the move it makes, or a
// pass-through answer while following a chat (no step consumed); entry: the command in the plan's log.
export type Begun = { args: Record<string, unknown>; tabId?: string; passthrough: boolean; move?: PlanMove; entry: PlanLogEntry }

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
const invalid = (message: string) => new CoreError('invalid_args', message)
// Arguments as the log keeps them: texts longer than PLAN_LIMITS.logText cut, with an ellipsis.
const cut = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).map(([field, value]) => [field, typeof value === 'string' && value.length > PLAN_LIMITS.logText ? `${value.slice(0, PLAN_LIMITS.logText)}…` : value]))

// How many choices and groups sit inside one another, at most, in a list of nodes.
function depthOf(nodes: PlanNode[]): number {
  return Math.max(0, ...nodes.map((node) => (isPlanEither(node) ? 1 + Math.max(0, ...node.either.map((branch) => depthOf(branch.steps))) : isPlanRepeat(node) ? 1 + depthOf(node.steps) : 0)))
}

// Checks one step's arguments: a reference points at an earlier step, not on another branch of the same choice, that
// gives that field; free text sits only where the action allows it; a chat's action names its chat; once references
// and free text are filled, the arguments fit the action. Throws invalid_args.
function checkStep({ number, step }: NumberedStep, steps: NumberedStep[]): void {
  if (step.if !== undefined && !step.optional) throw invalid(`step ${number}: a condition (if) goes only on an optional step`)
  const probe: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(step.args)) {
    if (isRef(value)) {
      const earlier = steps[value.$step - 1]
      if (value.$step >= number || !earlier) throw invalid(`step ${number} refers to step ${value.$step}, which is not before it`)
      if (stepsApart(earlier, steps[number - 1]!)) throw invalid(`step ${number} refers to step ${value.$step}, on another branch of the same choice`)
      if (!RESULT_FIELDS[earlier.step.action]?.includes(value.field)) throw invalid(`step ${number}: step ${value.$step} (${earlier.step.action}) gives no ${value.field}`)
      probe[field] = 'x'
    } else if (isFree(value)) {
      if (!FREE_FIELDS[step.action]?.includes(field)) throw invalid(`step ${number}: ${field} of ${step.action} cannot be free text`)
      probe[field] = 'x'
    } else probe[field] = value
  }
  if (CHAT_ACTIONS.includes(step.action) && typeof probe.tabId !== 'string') throw invalid(`step ${number}: ${step.action} needs its chat (tabId)`)
  const parsed = CORE_ACTIONS[step.action].safeParse(probe)
  if (!parsed.success) throw invalid(`step ${number} (${step.action}): ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'} ${issue.message}`).join('; ')}`)
}

// Checks a proposal: not nested too deep, not too many steps, every step as checkStep says. Throws invalid_args.
function check({ steps: nodes }: PlanProposal): void {
  if (depthOf(nodes) > PLAN_LIMITS.depth) throw invalid(`choices and groups nested too deep: at most ${PLAN_LIMITS.depth} levels`)
  const steps = planSteps(nodes)
  if (steps.length > PLAN_LIMITS.steps) throw invalid(`at most ${PLAN_LIMITS.steps} steps in a plan`)
  steps.forEach((step) => checkStep(step, steps))
}

// A step's arguments with references filled from the results so far. free: what a free field takes (absent: the
// field is left out). Throws action_denied when a referenced step has not run.
function resolve(step: PlanStep, results: Plan['results'], free?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(step.args)) {
    if (isRef(value)) {
      const result = results[value.$step - 1]
      if (!result) throw denied(`step ${value.$step} has not run`)
      if (typeof result[value.field] !== 'string') throw denied(`step ${value.$step} gave no ${value.field}`)
      out[field] = result[value.field]
    } else if (isFree(value)) {
      if (free && field in free) out[field] = free[field]
    } else out[field] = value
  }
  return out
}

// Step numbers in words: "step 3", "steps 3 and 5", "steps 1, 3 and 5".
function stepWords(numbers: number[]): string {
  if (numbers.length === 1) return `step ${numbers[0]}`
  return `steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`
}

// What a plan allows now, in words (for a refusal).
function allowedNow(steps: NumberedStep[], next: PlanMove[], finishable: boolean): string {
  if (!next.length) return 'nothing is left in this plan: finish it'
  const moves = next.map((move) => `step ${move.number} (${steps[move.number - 1]!.step.action})`).join(' or ')
  return `now the plan allows ${moves}${finishable ? ', or to finish it' : ''}`
}

// The step a caller's action is, among the moves allowed now. given: its arguments (tabId included); step: the
// number the caller named, if any. Throws action_denied when it fits none, or more than one and no number was named.
function pick(plan: Plan, run: CommandArgs<'actions.run'>, given: Record<string, unknown>): { move: PlanMove; resolved: Record<string, unknown> } {
  const steps = planSteps(plan.steps)
  const { next, finishable } = planNext(plan.steps, plan.at)
  const same = next.filter((move) => steps[move.number - 1]!.step.action === run.action)
  const fits: { move: PlanMove; resolved: Record<string, unknown> }[] = []
  let why: string | undefined
  for (const move of same) {
    try {
      const resolved = resolve(steps[move.number - 1]!.step, plan.results, given)
      if (canonical(resolved) === canonical(given)) fits.push({ move, resolved })
      else why = `not the arguments the user approved for step ${move.number}`
    } catch (error) {
      why = `step ${move.number}: ${(error as Error).message}`
    }
  }
  const chosen = run.step ? fits.filter((fit) => fit.move.number === run.step) : fits
  if (chosen.length > 1) throw denied(`this fits ${stepWords(chosen.map((fit) => fit.move.number))}: say which with its step number (--step)`)
  if (chosen.length === 1) return chosen[0]!
  if (run.step && fits.length) throw denied(`step ${run.step} is not allowed now with this action and these arguments`)
  throw denied(same.length === 1 && why ? why : allowedNow(steps, next, finishable))
}

export class PlanStore {
  private plans: Plan[] = []
  private readonly file?: JsonFile<Saved>
  private readonly ttlMs: number
  private readonly changed: () => void
  private readonly proposed?: (plan: Plan) => void
  private readonly timers = new Map<string, NodeJS.Timeout>()
  // Plans with a step under way (begun, not yet completed or released): one step at a time.
  private readonly busy = new Set<string>()
  readonly loaded: Promise<void>

  // file: where the open plans are saved (absent: memory only); ttlMs: how long a plan may live; changed: called after
  // every change the app should see; proposed: called with every new proposal (a notification).
  constructor(file: string | undefined, ttlMs: number, changed: () => void, proposed?: (plan: Plan) => void) {
    this.file = file ? new JsonFile<Saved>(file) : undefined
    this.ttlMs = ttlMs
    this.changed = changed
    this.proposed = proposed
    this.loaded = (this.file?.read() ?? Promise.resolve(undefined)).then((saved) => {
      this.plans = (saved?.plans ?? []).filter((plan) => planSchema.safeParse(plan).success && isOpenPlan(plan))
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
    const plan: Plan = { ...proposal, planId: randomUUID(), caller, status: 'proposed', at: planStart(), results: [], createdAt: now, expiresAt: now + this.ttlMs }
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

  // The caller ends its running plan: only when nothing but skippable steps is left. Throws not_found, unauthorized
  // (not its plan) or action_denied (steps it must run are left).
  finish(planId: string, caller: string): void {
    const plan = this.plans.find((one) => one.planId === planId && one.status === 'running')
    if (!plan) throw new CoreError('not_found', 'no such running plan')
    if (plan.caller !== caller) throw new CoreError('unauthorized', 'not your plan')
    const { next, finishable } = planNext(plan.steps, plan.at)
    if (!finishable) throw denied(`steps the plan must run are left (${allowedNow(planSteps(plan.steps), next, finishable)}): cancel it instead`)
    plan.status = 'done'
    this.commit()
  }

  // What a caller may run now under a plan: a step the plan allows next, with the arguments the user saw (run.step
  // names it when the action fits more than one), or an answer to the chat it follows. run: the actions.run
  // arguments. Throws action_denied for anything else (logged as refused). A begun command is in the plan's log as
  // running, and must be completed or failed.
  begin(planId: string, caller: string, run: CommandArgs<'actions.run'>): Begun {
    this.sweep()
    const plan = this.plans.find((one) => one.planId === planId && one.caller === caller)
    if (!plan || plan.status !== 'running') throw denied(plan ? `this plan is ${plan.status}` : 'no such plan of yours')
    const given: Record<string, unknown> = { ...run.args, ...(run.tabId ? { tabId: run.tabId } : {}) }
    const entry: PlanLogEntry = { at: Date.now(), action: run.action, args: cut(given), outcome: 'running' }
    try {
      const begun = this.allowed(plan, run, given)
      if (begun.move) entry.step = begun.move.number
      this.note(plan, entry)
      return { ...begun, entry }
    } catch (error) {
      this.note(plan, { ...entry, outcome: 'refused', reason: (error as Error).message })
      throw error
    }
  }

  // What begin lets through: an answer while following, or the step this action is (the plan is then busy until it
  // ends). Throws action_denied.
  private allowed(plan: Plan, run: CommandArgs<'actions.run'>, given: Record<string, unknown>): Omit<Begun, 'entry'> {
    if (plan.following) {
      if (run.action === 'request.answer' && given.tabId === plan.following) return { args: run.args, tabId: plan.following, passthrough: true }
      throw denied('the plan follows a chat: only its requests can be answered until its turn ends')
    }
    if (this.busy.has(plan.planId)) throw denied('a step of this plan is still running')
    const { move, resolved } = pick(plan, run, given)
    this.busy.add(plan.planId)
    const { tabId, ...args } = resolved
    return { args, ...(typeof tabId === 'string' ? { tabId } : {}), passthrough: false, move }
  }

  // A begun command ran: done in the log; a step keeps its result and moves the plan on (done once nothing is left).
  // A session.follow step whose chat is at work leaves the plan following that chat until the turn ends.
  complete(planId: string, begun: Begun, value: unknown): void {
    begun.entry.outcome = 'done'
    if (begun.move) this.busy.delete(planId)
    const plan = this.plans.find((one) => one.planId === planId && one.status === 'running')
    if (!plan) return
    if (begun.move) this.moveOn(plan, begun.move, value)
    this.commit()
  }

  // A begun command failed: failed in the log, with why; the plan stays where it was, and the caller may try again.
  fail(planId: string, begun: Begun, error: unknown): void {
    Object.assign(begun.entry, { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) })
    if (begun.move) this.busy.delete(planId)
    if (this.plans.some((one) => one.planId === planId)) this.commit()
  }

  // A step ran: keeps its result (by its number) and moves the plan to where that step leads.
  private moveOn(plan: Plan, move: PlanMove, value: unknown): void {
    const step = planSteps(plan.steps)[move.number - 1]!.step
    while (plan.results.length < move.number) plan.results.push(null)
    plan.results[move.number - 1] = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    plan.at = move.at
    const followed = resolve(step, plan.results).tabId
    if (step.action === 'session.follow' && (value as { following?: boolean } | undefined)?.following && typeof followed === 'string') plan.following = followed
    else this.settle(plan)
  }

  // Adds a command to the plan's log (the last PLAN_LIMITS.log kept) and tells the app.
  private note(plan: Plan, entry: PlanLogEntry): void {
    plan.log = [...(plan.log ?? []), entry].slice(-PLAN_LIMITS.log)
    this.commit()
  }

  // A chat's turn ended: the plans following it move on.
  onTurnFinished(tabId: string): void {
    let moved = false
    for (const plan of this.plans) {
      if (plan.status !== 'running' || plan.following !== tabId) continue
      delete plan.following
      this.settle(plan)
      moved = true
    }
    if (moved) this.commit()
  }

  // A running plan with no step left is done.
  private settle(plan: Plan): void {
    if (!planNext(plan.steps, plan.at).next.length) plan.status = 'done'
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
