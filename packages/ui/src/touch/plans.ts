import { isPlanEither, isPlanRepeat, planNext, planReachable, type CoreActionName, type Plan, type PlanNode, type PlanStep, type TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'

// A plan's steps in plain words (PlanCard.tsx), written by the app from the steps themselves, never from the caller's
// summary: what the user approves is what the core will enforce. Values a step leaves to the caller (free text) and
// targets that exist already (a literal folder, chat or message, not one the plan creates) are marked, so the user
// sees at a glance where the plan touches what is already there. Choices, groups and optional steps become indented
// rows (planRows), with the conditions as the caller wrote them (words for the user, never checked by core).

// A piece of a step's sentence: plain words, free text the caller decides later, or an existing target.
export type StepPart = { kind: 'text' | 'free' | 'existing'; text: string }

type Ref = { $step: number; field: 'path' | 'tabId' | 'queueId' }
const isRef = (value: unknown): value is Ref => Boolean(value) && typeof value === 'object' && '$step' in (value as object)
const isFree = (value: unknown): boolean => Boolean(value) && typeof value === 'object' && (value as { $free?: unknown }).$free === true
const REF_WORDS = { path: 'planRefPath', tabId: 'planRefTabId', queueId: 'planRefQueueId' } as const

// The sentence of each action, with {placeholders} for its arguments.
function sentenceOf(step: PlanStep): string {
  const args = step.args
  switch (step.action) {
    case 'project.create':
      return t('planStep_projectCreate')
    case 'folder.create':
      return t('planStep_folderCreate')
    case 'project.mark':
      return t(args.project === false ? 'planStep_projectUnmark' : 'planStep_projectMark')
    case 'session.start':
      return t(args.prompt !== undefined ? 'planStep_sessionStartPrompt' : 'planStep_sessionStart')
    case 'session.follow':
      return t('planStep_sessionFollow')
    case 'prompt.send':
      return t('planStep_promptSend')
    case 'queue.add':
      return t('planStep_queueAdd')
    case 'queue.remove':
      return t('planStep_queueRemove')
    case 'session.stop':
      return t('planStep_sessionStop')
    case 'session.close':
      return t('planStep_sessionClose')
    case 'request.answer':
      return t('planStep_requestAnswer')
    default:
      return step.action satisfies CoreActionName
  }
}

// One argument as parts: a reference ("the chat from step 2"), free text, or a literal — an existing target when it
// names a folder, a chat (its title) or a message, plain words otherwise.
function partsOf(field: string, value: unknown, tabs: TabMeta[]): StepPart[] {
  if (isRef(value)) return [{ kind: 'text', text: t('planStepRef', { what: t(REF_WORDS[value.field]), step: String(value.$step) }) }]
  if (isFree(value)) return [{ kind: 'free', text: t('planFree') }]
  if (field === 'chat') {
    const tab = tabs.find((one) => one.tabId === value)
    return [{ kind: 'existing', text: tab ? tab.title : t('planUnknownChat', { tabId: String(value) }) }]
  }
  if (field === 'parent' && value === undefined) return [{ kind: 'text', text: t('planTheHome') }]
  if (field === 'parent' || field === 'path' || field === 'folder' || field === 'queueId') return [{ kind: 'existing', text: String(value) }]
  return [{ kind: 'text', text: String(value) }]
}

// The parts of a step's sentence. tabs: the open chats (a chat's title for a literal tabId).
export function stepParts(step: PlanStep, tabs: TabMeta[]): StepPart[] {
  const values: Record<string, unknown> = { ...step.args, ...(step.args.tabId !== undefined ? { chat: step.args.tabId } : {}) }
  if (step.action === 'project.create' && values.parent === undefined) values.parent = undefined
  const parts: StepPart[] = []
  const sentence = sentenceOf(step)
  const pattern = /\{(\w+)\}/g
  let last = 0
  for (const match of sentence.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: 'text', text: sentence.slice(last, match.index) })
    parts.push(...partsOf(match[1]!, values[match[1]!], tabs))
    last = match.index + match[0].length
  }
  if (last < sentence.length) parts.push({ kind: 'text', text: sentence.slice(last) })
  return parts
}

// The card's heading: a proposal, or a running plan with the steps it may run next (or the chat it follows).
export function planHeading(plan: Plan): string {
  if (plan.status === 'proposed') return t('planProposed', { caller: plan.caller })
  if (plan.following) return t('planRunningFollow', { caller: plan.caller })
  const numbers = planNext(plan.steps, plan.at).next.map((move) => String(move.number))
  return t('planRunningNext', { caller: plan.caller, steps: numbers.join(t('planOr')) })
}

// A row of the card: a step (its number, sentence, optional note and state), or the line that opens a choice, one of
// its branches or a group. depth: how far it is indented. A step's state: ran, may run next, may run later, or out
// (on a branch not taken, or behind).
export type PlanRow =
  | { kind: 'step'; depth: number; number: number; parts: StepPart[]; note?: string; state: 'ran' | 'next' | 'later' | 'out' }
  | { kind: 'either' | 'branch' | 'repeat'; depth: number; text: string }

// The plan as rows, in reading order (the same numbering core uses). tabs: the open chats.
export function planRows(plan: Plan, tabs: TabMeta[]): PlanRow[] {
  const running = plan.status === 'running'
  const next = new Set(running && !plan.following ? planNext(plan.steps, plan.at).next.map((move) => move.number) : [])
  const reachable = running ? planReachable(plan.steps, plan.at) : undefined
  const stateOf = (number: number): 'ran' | 'next' | 'later' | 'out' => {
    if (next.has(number)) return 'next'
    if (plan.results[number - 1]) return 'ran'
    return !reachable || reachable.has(number) ? 'later' : 'out'
  }
  const rows: PlanRow[] = []
  let number = 0
  const visit = (nodes: PlanNode[], depth: number): void =>
    nodes.forEach((node) => {
      if (isPlanEither(node)) {
        rows.push({ kind: 'either', depth, text: t('planEither') })
        node.either.forEach((branch) => (rows.push({ kind: 'branch', depth, text: t('planBranch', { if: branch.if }) }), visit(branch.steps, depth + 1)))
      } else if (isPlanRepeat(node)) {
        rows.push({ kind: 'repeat', depth, text: node.if ? t('planRepeatIf', { count: String(node.repeat), if: node.if }) : t('planRepeat', { count: String(node.repeat) }) })
        visit(node.steps, depth + 1)
      } else {
        number++
        const note = node.optional ? (node.if ? `${t('planOptional')}: ${node.if}` : t('planOptional')) : undefined
        rows.push({ kind: 'step', depth, number, parts: stepParts(node, tabs), ...(note ? { note } : {}), state: stateOf(number) })
      }
    })
  visit(plan.steps, 0)
  return rows
}
