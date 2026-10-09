// How core walks a plan with choices (plans.ts). User stories: a plan may hold an alternative ("if this happens, these
// steps, otherwise those"), a step the caller may skip, and a group it may repeat up to N times; its steps are numbered
// in reading order; at any moment the caller may run only the steps the plan allows next; once only skippable work is
// left, the plan may end; a step on a branch not taken, or behind a finished group, can no longer run.
import { describe, expect, it } from 'vitest'
import { planNext, planReachable, planStart, planSteps, planProposalSchema, stepsApart, type PlanFrame, type PlanNode } from './plans.ts'

const step = (name: string, extra: object = {}): PlanNode => ({ action: 'project.create', args: { name }, ...extra })
// The numbers the plan allows next, and whether it may end there.
const next = (nodes: PlanNode[], at: PlanFrame[]) => {
  const { next: moves, finishable } = planNext(nodes, at)
  return { next: moves.map((move) => move.number), finishable }
}
// Runs the steps with these numbers in turn from the start; returns where the plan is then.
function run(nodes: PlanNode[], ...numbers: number[]): PlanFrame[] {
  let at = planStart()
  for (const number of numbers) {
    const move = planNext(nodes, at).next.find((one) => one.number === number)
    if (!move) throw new Error(`step ${number} is not allowed now`)
    at = move.at
  }
  return at
}

describe('numbering', () => {
  it('counts the steps in reading order, inside choices and groups too', () => {
    const nodes: PlanNode[] = [step('a'), { either: [{ if: 'x', steps: [step('b'), step('c')] }, { if: 'y', steps: [step('d')] }] }, { repeat: 3, steps: [step('e')] }, step('f')]
    expect(planSteps(nodes).map((one) => `${one.number}${(one.step.args as { name: string }).name}`)).toEqual(['1a', '2b', '3c', '4d', '5e', '6f'])
  })

  it('tells apart steps on two branches of the same choice', () => {
    const nodes: PlanNode[] = [step('a'), { either: [{ if: 'x', steps: [step('b')] }, { if: 'y', steps: [step('c')] }] }, step('d')]
    const [a, b, c, d] = planSteps(nodes)
    expect(stepsApart(b!, c!)).toBe(true)
    expect(stepsApart(a!, b!)).toBe(false)
    expect(stepsApart(b!, d!)).toBe(false)
  })
})

describe('what may run next', () => {
  it('a plain list: one step after the other, then the plan is over', () => {
    const nodes = [step('a'), step('b')]
    expect(next(nodes, planStart())).toEqual({ next: [1], finishable: false })
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [2], finishable: false })
    expect(next(nodes, run(nodes, 1, 2))).toEqual({ next: [], finishable: true })
  })

  it('an optional step may be run or skipped; at the end it leaves the plan finishable', () => {
    const nodes = [step('a'), step('b', { optional: true }), step('c')]
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [2, 3], finishable: false })
    expect(next(nodes, run(nodes, 1, 3))).toEqual({ next: [], finishable: true })
    const tail = [step('a'), step('b', { optional: true })]
    expect(next(tail, run(tail, 1))).toEqual({ next: [2], finishable: true })
  })

  it('a choice: the first step of a branch takes it, the others are out', () => {
    const nodes: PlanNode[] = [step('a'), { either: [{ if: 'x', steps: [step('b'), step('c')] }, { if: 'y', steps: [step('d')] }] }, step('e')]
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [2, 4], finishable: false })
    expect(next(nodes, run(nodes, 1, 2))).toEqual({ next: [3], finishable: false })
    expect(next(nodes, run(nodes, 1, 2, 3))).toEqual({ next: [5], finishable: false })
    expect(next(nodes, run(nodes, 1, 4))).toEqual({ next: [5], finishable: false })
    expect([...planReachable(nodes, run(nodes, 1, 2))].sort()).toEqual([3, 5])
  })

  it('a branch with no steps lets the caller go straight on', () => {
    const nodes: PlanNode[] = [{ either: [{ if: 'x', steps: [step('a')] }, { if: 'otherwise', steps: [] }] }, step('b')]
    expect(next(nodes, planStart())).toEqual({ next: [1, 2], finishable: false })
  })

  it('a group repeats up to its number of rounds, whole rounds only, and may be left out', () => {
    const nodes: PlanNode[] = [{ repeat: 2, steps: [step('a'), step('b')] }, step('c')]
    expect(next(nodes, planStart())).toEqual({ next: [1, 3], finishable: false })
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [2], finishable: false })
    expect(next(nodes, run(nodes, 1, 2))).toEqual({ next: [1, 3], finishable: false })
    expect(next(nodes, run(nodes, 1, 2, 1, 2))).toEqual({ next: [3], finishable: false })
    expect(planReachable(nodes, run(nodes, 1, 2, 1, 2))).toEqual(new Set([3]))
  })

  it('a group at the end: the plan may end between rounds', () => {
    const nodes: PlanNode[] = [step('a'), { repeat: 5, if: 'until it is done', steps: [step('b')] }]
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [2], finishable: true })
    expect(next(nodes, run(nodes, 1, 2, 2))).toEqual({ next: [2], finishable: true })
  })

  it('a choice inside a group: each round may take another branch', () => {
    const nodes: PlanNode[] = [{ repeat: 2, steps: [{ either: [{ if: 'x', steps: [step('a')] }, { if: 'y', steps: [step('b')] }] }] }]
    expect(next(nodes, run(nodes, 1))).toEqual({ next: [1, 2], finishable: true })
    expect(next(nodes, run(nodes, 1, 2))).toEqual({ next: [], finishable: true })
  })
})

describe('the proposal', () => {
  it('reads plain steps, choices, optional steps and groups', () => {
    const nodes = [step('a', { optional: true, if: 'if needed' }), { either: [{ if: 'x', steps: [] }, { if: 'y', steps: [step('b')] }] }, { repeat: 3, steps: [step('c')] }]
    expect(planProposalSchema.safeParse({ summary: 's', steps: nodes }).success).toBe(true)
  })

  it('refuses a choice of one branch, a group of no steps or too many rounds', () => {
    expect(planProposalSchema.safeParse({ summary: 's', steps: [{ either: [{ if: 'x', steps: [step('a')] }] }] }).success).toBe(false)
    expect(planProposalSchema.safeParse({ summary: 's', steps: [{ repeat: 2, steps: [] }] }).success).toBe(false)
    expect(planProposalSchema.safeParse({ summary: 's', steps: [{ repeat: 21, steps: [step('a')] }] }).success).toBe(false)
  })
})
