import { z } from 'zod'
import { coreActionNameSchema, type CoreActionName } from './actions.ts'

// Plans: how a caller with a key (Petra, through the athome command) acts on the app. It proposes a short summary and
// its steps; the user approves or rejects it on the phone; once approved, core lets the caller run only the steps the
// plan allows next, with those arguments, until nothing is left (then the plan is done), the caller ends it once only
// skippable steps are left, or PLAN_LIMITS.ttlMs passes (expired). Every other user of the action API keeps its own
// limits (core actions.ts).
//
// Besides plain steps, a plan may hold a choice (`either`: branches, each with the condition the caller reads, the
// first step run takes that branch), a step the caller may skip (`optional`), and a group it may repeat (`repeat`: up
// to N whole rounds, none included). Conditions are words for the user: core never checks them, it checks only that
// every action is one the plan allows at that point. Steps are numbered in reading order (planSteps); references
// ($step) use those numbers.

export const PLAN_LIMITS = { steps: 50, summary: 1000, ttlMs: 24 * 60 * 60 * 1000, branches: 5, rounds: 20, condition: 200, depth: 2, log: 30, logText: 300 } as const

// A caller's name: lowercase letters, digits, dashes.
export const callerNameSchema = z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/)

// A value a step's arguments may hold instead of a literal: the result of an earlier step (its path, tabId or queueId), or
// free text the caller decides when it runs the step (shown highlighted to the user).
export const stepRefSchema = z.object({ $step: z.number().int().min(1), field: z.enum(['path', 'tabId', 'queueId']) })
export const freeTextSchema = z.object({ $free: z.literal(true) })
export type StepRef = z.infer<typeof stepRefSchema>

// One step: an action of the action API and its arguments (a chat's action names its chat as args.tabId); optional:
// the caller may skip it; if: when it means to run it (only with optional).
export type PlanStep = { action: CoreActionName; args: Record<string, unknown>; optional?: boolean | undefined; if?: string | undefined }
// A choice: the caller takes one branch (its condition, its steps; a branch may have none).
export type PlanBranch = { if: string; steps: PlanNode[] }
export type PlanEither = { either: PlanBranch[] }
// A group of steps the caller may run up to `repeat` whole rounds (none too); if: until when.
export type PlanRepeat = { repeat: number; if?: string | undefined; steps: PlanNode[] }
export type PlanNode = PlanStep | PlanEither | PlanRepeat

const conditionSchema = z.string().trim().min(1).max(PLAN_LIMITS.condition)
export const planStepSchema = z.object({ action: coreActionNameSchema, args: z.record(z.string(), z.unknown()), optional: z.boolean().optional(), if: conditionSchema.optional() })
export const planNodeSchema: z.ZodType<PlanNode> = z.lazy(() => z.union([planStepSchema, planEitherSchema, planRepeatSchema]))
const planBranchSchema = z.object({ if: conditionSchema, steps: z.array(planNodeSchema).max(PLAN_LIMITS.steps) })
const planEitherSchema = z.object({ either: z.array(planBranchSchema).min(2).max(PLAN_LIMITS.branches) })
const planRepeatSchema = z.object({ repeat: z.number().int().min(1).max(PLAN_LIMITS.rounds), if: conditionSchema.optional(), steps: z.array(planNodeSchema).min(1).max(PLAN_LIMITS.steps) })

export const isPlanEither = (node: PlanNode): node is PlanEither => 'either' in node
export const isPlanRepeat = (node: PlanNode): node is PlanRepeat => 'repeat' in node

export const planProposalSchema = z.object({ summary: z.string().trim().min(1).max(PLAN_LIMITS.summary), steps: z.array(planNodeSchema).min(1).max(PLAN_LIMITS.steps) })
export type PlanProposal = z.infer<typeof planProposalSchema>

// Where a running plan is: a stack of the step lists it is inside (the plan's own, a branch's, a group's), each with
// the index of its next node; path: how to reach that list from the plan (a choice's node index and branch index, a
// group's node index); round: the group's round under way.
export const planFrameSchema = z.object({ path: z.array(z.number().int().min(0)), index: z.number().int().min(0), round: z.number().int().min(1).optional() })
export type PlanFrame = z.infer<typeof planFrameSchema>

// A command the caller ran under a plan, as the card shows it live: when, the action and its arguments (tabId
// included; texts cut to PLAN_LIMITS.logText), the step it was (absent: refused before it was one, or an answer while
// following a chat), how it went (running until it ends) and, refused or failed, why (core's words).
export const planLogEntrySchema = z.object({
  at: z.number(),
  action: coreActionNameSchema,
  args: z.record(z.string(), z.unknown()),
  step: z.number().int().min(1).optional(),
  outcome: z.enum(['running', 'done', 'refused', 'failed']),
  reason: z.string().optional()
})
export type PlanLogEntry = z.infer<typeof planLogEntrySchema>

// A plan as core keeps it. at: where it is; results: what each step run returned, by step number - 1 (the last round's
// for a repeated one; refs read them; null or absent: not run); following: the chat a session.follow step follows
// while its turn is under way (nothing else runs meanwhile); log: the caller's last commands under it (oldest first).
export const planSchema = planProposalSchema.extend({
  planId: z.string(),
  caller: callerNameSchema,
  status: z.enum(['proposed', 'running', 'done', 'rejected', 'cancelled', 'expired']),
  at: z.array(planFrameSchema).min(1),
  results: z.array(z.record(z.string(), z.unknown()).nullable()),
  following: z.string().optional(),
  log: z.array(planLogEntrySchema).max(PLAN_LIMITS.log).optional(),
  createdAt: z.number(),
  expiresAt: z.number()
})
export type Plan = z.infer<typeof planSchema>
// A plan still to answer or under way (the ones the app shows).
export const isOpenPlan = (plan: Plan) => plan.status === 'proposed' || plan.status === 'running'

// A step with its number, and the branches it sits on (`<choice>:<branch>`, to tell steps on two branches apart).
export type NumberedStep = { number: number; step: PlanStep; branches: string[] }

// The plan's steps in reading order, numbered from 1.
export function planSteps(nodes: PlanNode[]): NumberedStep[] {
  const out: NumberedStep[] = []
  const visit = (list: PlanNode[], path: number[], branches: string[]): void =>
    list.forEach((node, index) => {
      const here = [...path, index]
      if (isPlanEither(node)) node.either.forEach((branch, at) => visit(branch.steps, [...here, at], [...branches, `${here.join('.')}:${at}`]))
      else if (isPlanRepeat(node)) visit(node.steps, here, branches)
      else out.push({ number: out.length + 1, step: node, branches })
    })
  visit(nodes, [], [])
  return out
}

// Whether two steps sit on different branches of the same choice (one of them can never run after the other).
export function stepsApart(one: NumberedStep, other: NumberedStep): boolean {
  return one.branches.some((key) => {
    const [choice, branch] = key.split(':')
    return other.branches.some((theirs) => theirs.startsWith(`${choice}:`) && theirs !== `${choice}:${branch}`)
  })
}

// Where a plan starts: before its first node.
export const planStart = (): PlanFrame[] => [{ path: [], index: 0 }]

// The plan as a tree of numbered steps, choices and groups (what the walk moves through).
type Walked = { kind: 'step'; number: number; optional: boolean } | { kind: 'either'; branches: Walked[][] } | { kind: 'repeat'; rounds: number; body: Walked[] }

// The plan's nodes as a tree to walk. counter: the last step number given.
function walked(nodes: PlanNode[], counter = { last: 0 }): Walked[] {
  return nodes.map((node): Walked => {
    if (isPlanEither(node)) return { kind: 'either', branches: node.either.map((branch) => walked(branch.steps, counter)) }
    if (isPlanRepeat(node)) return { kind: 'repeat', rounds: node.repeat, body: walked(node.steps, counter) }
    return { kind: 'step', number: ++counter.last, optional: Boolean(node.optional) }
  })
}

// The step list a frame's path leads to, and its group's rounds (if it is a group's). Throws on a path that does not fit.
function listAt(tree: Walked[], path: number[]): { list: Walked[]; rounds?: number } {
  let list = tree
  let rounds: number | undefined
  for (let index = 0; index < path.length; ) {
    const node = list[path[index]!]
    if (node?.kind === 'either' && node.branches[path[index + 1]!]) [list, rounds, index] = [node.branches[path[index + 1]!]!, undefined, index + 2]
    else if (node?.kind === 'repeat') [list, rounds, index] = [node.body, node.rounds, index + 1]
    else throw new Error('a plan position that does not fit the plan')
  }
  return { list, ...(rounds === undefined ? {} : { rounds }) }
}

// A step the caller may run now, and where the plan is once it ran.
export type PlanMove = { number: number; at: PlanFrame[] }

// Every move from a position (a step may come twice, by two ways) and whether the plan may end there. Explores in a
// fixed order: a step before skipping it, a group's next round before leaving it.
function moves(tree: Walked[], at: PlanFrame[]): { moves: PlanMove[]; finishable: boolean } {
  const out: PlanMove[] = []
  let finishable = false
  const seen = new Set<string>()
  const explore = (stack: PlanFrame[]): void => {
    const key = JSON.stringify(stack)
    if (seen.has(key)) return
    seen.add(key)
    const top = stack.at(-1)!
    const below = stack.slice(0, -1)
    const { list, rounds } = listAt(tree, top.path)
    const node = list[top.index]
    if (node) {
      const after = [...below, { ...top, index: top.index + 1 }]
      if (node.kind === 'step') {
        out.push({ number: node.number, at: after })
        if (node.optional) explore(after)
      } else if (node.kind === 'either') node.branches.forEach((_, branch) => explore([...after, { path: [...top.path, top.index, branch], index: 0 }]))
      else {
        explore([...after, { path: [...top.path, top.index], index: 0, round: 1 }])
        explore(after)
      }
      return
    }
    if (rounds !== undefined && (top.round ?? 1) < rounds) explore([...below, { ...top, index: 0, round: (top.round ?? 1) + 1 }])
    if (below.length) explore(below)
    else finishable = true
  }
  explore(at)
  return { moves: out, finishable }
}

// What the caller may run now: each step once (by the first way found) and where the plan goes with it; finishable:
// nothing is left but skippable steps (no step left at all: the plan is over).
export function planNext(nodes: PlanNode[], at: PlanFrame[]): { next: PlanMove[]; finishable: boolean } {
  const found = moves(walked(nodes), at)
  return { next: found.moves.filter((move, index) => found.moves.findIndex((one) => one.number === move.number) === index), finishable: found.finishable }
}

// The steps that may still run from a position, now or later (the others are on branches not taken, or behind).
export function planReachable(nodes: PlanNode[], at: PlanFrame[]): Set<number> {
  const tree = walked(nodes)
  const steps = new Set<number>()
  const seen = new Set<string>()
  const queue = [at]
  while (queue.length) {
    const stack = queue.pop()!
    const key = JSON.stringify(stack)
    if (seen.has(key)) continue
    seen.add(key)
    for (const move of moves(tree, stack).moves) (steps.add(move.number), queue.push(move.at))
  }
  return steps
}
