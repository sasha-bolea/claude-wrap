import { z } from 'zod'
import { coreActionNameSchema } from './actions.ts'

// Plans: how a caller with a key (Petra, through the athome command) acts on the app. It proposes a short summary and
// its steps in order; the user approves or rejects it on the phone; once approved, core lets the caller run only the
// next step, with those arguments, until the last one (then the plan is done) or PLAN_LIMITS.ttlMs (expired).
// Every other user of the action API keeps its own limits (core actions.ts).

export const PLAN_LIMITS = { steps: 50, summary: 1000, ttlMs: 24 * 60 * 60 * 1000 } as const

// A caller's name: lowercase letters, digits, dashes.
export const callerNameSchema = z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/)

// A value a step's arguments may hold instead of a literal: the result of an earlier step (its path, tabId or queueId), or
// free text the caller decides when it runs the step (shown highlighted to the user).
export const stepRefSchema = z.object({ $step: z.number().int().min(1), field: z.enum(['path', 'tabId', 'queueId']) })
export const freeTextSchema = z.object({ $free: z.literal(true) })
export type StepRef = z.infer<typeof stepRefSchema>

// One step: an action of the action API and its arguments (a chat's action names its chat as args.tabId).
export const planStepSchema = z.object({ action: coreActionNameSchema, args: z.record(z.string(), z.unknown()) })
export type PlanStep = z.infer<typeof planStepSchema>

export const planProposalSchema = z.object({ summary: z.string().trim().min(1).max(PLAN_LIMITS.summary), steps: z.array(planStepSchema).min(1).max(PLAN_LIMITS.steps) })
export type PlanProposal = z.infer<typeof planProposalSchema>

// A plan as core keeps it. cursor: the index of the next step (steps.length once done); results: what each step run
// returned (refs read them); following: the current step is a session.follow whose turn is under way.
export const planSchema = planProposalSchema.extend({
  planId: z.string(),
  caller: callerNameSchema,
  status: z.enum(['proposed', 'running', 'done', 'rejected', 'cancelled', 'expired']),
  cursor: z.number().int().min(0),
  results: z.array(z.record(z.string(), z.unknown()).nullable()),
  following: z.boolean().optional(),
  createdAt: z.number(),
  expiresAt: z.number()
})
export type Plan = z.infer<typeof planSchema>
// A plan still to answer or under way (the ones the app shows).
export const isOpenPlan = (plan: Plan) => plan.status === 'proposed' || plan.status === 'running'
