import { randomUUID } from 'node:crypto'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createFakeSdk, type FakeSdk, type FakeSession } from './fakeQuery.ts'
import { sdk, stored } from './messages.ts'

// Scripted fake SDK for deterministic e2e runs (hosts enable it with CLAUDE_WRAP_FAKE_SDK=1).
// Each fake process answers the user's messages by keyword:
//   permission → asks to Write a file, then reports the decision (and the deny reason)
//   question   → asks a multiple-choice question, then echoes the answers
//   questions  → asks two questions in one form (single and multiple choice), then echoes the answers
//   plan       → asks to approve a plan, then reports the decision
//   slow       → streams a long answer, word by word, until interrupted
//   markdown   → answers with a remote image and a link (rendering safety checks)
//   tools      → runs three Bash commands in a row (ls, a long git log, npm test), then "Tools: done"
//   crash      → the process dies
//   /command   → "Ran /command" as a synthetic assistant message, like the CLI's local commands
//   anything else → streams "Echo: <text>" word by word (" [N images]" appended when images came along)
// Every turn ends with a result; an interrupt ends it as aborted, like the CLI. Transcript-only messages
// (shouldQuery: false, the `!` shell output) are stored and get only an empty result (num_turns 0), like the CLI.
// Like CLI 2.1.287, every message gets command_lifecycle frames (queued on arrival, started when read, completed at
// the end of its turn), and one sent with priority 'next' while a turn streams is read before that turn ends: its
// echo is added to the same answer.

export type ScenarioOptions = { wordDelayMs: number }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Commands the scripted CLI offers in the palette.
const COMMANDS = [
  { name: 'clear', description: 'Clear conversation history', argumentHint: '' },
  { name: 'compact', description: 'Compact the conversation', argumentHint: '[instructions]' },
  { name: 'context', description: 'Show context usage', argumentHint: '' },
  { name: 'model', description: 'Set the model', argumentHint: '[model]' }
]

// Text of a user message (string content or text blocks).
function textOf(message: SDKUserMessage): string {
  const { content } = message.message
  return typeof content === 'string' ? content : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

// Number of image blocks in a user message.
const imageCount = (message: SDKUserMessage) => (typeof message.message.content === 'string' ? 0 : message.message.content.filter((block) => block.type === 'image').length)

// One fake turn in progress: knows whether it was interrupted, stores what it says like the CLI's JSONL, and reads
// the messages sent meanwhile (fold: the text they add to the answer).
type Turn = { session: FakeSession; interrupted: () => boolean; options: ScenarioOptions; store: (text: string) => void; fold: () => string }

// Streams text word by word, reads what was sent meanwhile, then the final frame and a success result (or an aborted
// result if interrupted).
async function stream({ session, interrupted, options, store, fold }: Turn, text: string): Promise<void> {
  const messageId = `msg_${randomUUID()}`
  session.emit(sdk.messageStart(messageId), sdk.blockStart(0, { type: 'text', text: '' }))
  for (const word of text.split(/(?<= )/)) {
    if (interrupted()) return session.emit(sdk.aborted())
    session.emit(sdk.textDelta(0, word))
    await sleep(options.wordDelayMs)
  }
  if (interrupted()) return session.emit(sdk.aborted())
  const answer = text + fold()
  store(answer)
  session.emit(sdk.assistant(messageId, [{ type: 'text', text: answer }]), sdk.success())
}

// Asks a permission/question/plan through canUseTool and returns a description of the answer.
// The short pause first lets e2e tests move the focus before the request appears.
async function ask({ session, options }: Turn, toolName: string, input: Record<string, unknown>, extra: object = {}): Promise<string> {
  await sleep(options.wordDelayMs * 5)
  const result = await session.askPermission(toolName, input, extra).result
  if (!result) return 'no decision'
  if (result.behavior === 'deny') return `deny — ${result.message}`
  const answers = (result.updatedInput as { answers?: unknown } | undefined)?.answers
  return answers ? `allow ${JSON.stringify(answers)}` : 'allow'
}

const QUESTION = {
  questions: [
    { question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Cold' }] }
  ]
}
const QUESTIONS = {
  questions: [
    QUESTION.questions[0],
    { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [{ label: 'Small', description: 'S' }, { label: 'Large', description: 'L' }] }
  ]
}
const WRITE_RULE = [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'localSettings' }]
const SLOW_TEXT = Array.from({ length: 400 }, (_, n) => `word${n}`).join(' ')

// A form of two questions, as the CLI runs it: the AskUserQuestion call, the request, then the call's result in the
// CLI's own words ("question"="answer" pairs), and an echo of the answers.
async function questions(turn: Turn): Promise<void> {
  const id = `toolu_${randomUUID()}`
  turn.session.emit(sdk.assistant(`msg_${randomUUID()}`, [{ type: 'tool_use', id, name: 'AskUserQuestion', input: QUESTIONS }]))
  const outcome = await ask(turn, 'AskUserQuestion', QUESTIONS)
  if (outcome.startsWith('allow ')) {
    const answers = JSON.parse(outcome.slice('allow '.length)) as Record<string, string>
    const pairs = Object.entries(answers).map(([question, answer]) => `"${question}"="${answer}"`).join(', ')
    turn.session.emit(sdk.toolResult(id, `Your questions have been answered: ${pairs}. You can now continue with these answers in mind.`))
  } else turn.session.emit(sdk.toolResult(id, 'The user did not answer the questions.', true))
  return stream(turn, `Questions: ${outcome}`)
}

// Answers one user message according to its keyword.
async function respond(turn: Turn, text: string, images: number): Promise<void> {
  const { session } = turn
  const keyword = text.trim().toLowerCase()
  if (keyword.startsWith('/')) return session.emit(sdk.assistant(randomUUID(), [{ type: 'text', text: `Ran ${text.trim()}` }]), sdk.success({ num_turns: 0 }))
  if (keyword === 'crash') return session.exit(new Error('fake claude crashed'))
  if (keyword === 'permission') {
    const outcome = await ask(turn, 'Write', { file_path: 'notes.txt', content: 'hello' }, { suggestions: WRITE_RULE, title: 'Write notes.txt' })
    return stream(turn, `Permission: ${outcome}`)
  }
  if (keyword === 'question') return stream(turn, `Question: ${await ask(turn, 'AskUserQuestion', QUESTION)}`)
  if (keyword === 'questions') return questions(turn)
  if (keyword === 'plan') return stream(turn, `Plan: ${await ask(turn, 'ExitPlanMode', { plan: '1. Do the thing\n2. Check it' })}`)
  if (keyword === 'slow') return stream(turn, SLOW_TEXT)
  if (keyword === 'tools') {
    for (const command of ['ls', 'git log --oneline --decorate --graph --all --since=2026-01-01 -- packages/ui/src/touch packages/core/src', 'npm test']) {
      const id = `toolu_${randomUUID()}`
      session.emit(sdk.assistant(`msg_${randomUUID()}`, [{ type: 'tool_use', id, name: 'Bash', input: { command } }]))
      await sleep(turn.options.wordDelayMs * 5)
      session.emit(sdk.toolResult(id, `ran ${command}`))
    }
    return stream(turn, 'Tools: done')
  }
  if (keyword === 'markdown') return stream(turn, 'Image: ![tracker](https://example.com/pixel.png) and a [link](https://example.com).')
  if (keyword === 'limit') {
    // The account's usage limit, for an hour (as the CLI reports it before refusing).
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600))
    return stream(turn, "You've hit your session limit")
  }
  return stream(turn, `Echo: ${text}${images ? ` [${images} images]` : ''}`)
}

// Drives one fake process: init at the first message (a resumed session keeps its id), then one scripted turn
// per user message (those read in the middle of a turn excepted), recorded in the fake session store.
async function drive(fake: FakeSdk, session: FakeSession, options: ScenarioOptions): Promise<void> {
  const sessionId = session.options.resume ?? randomUUID()
  const cwd = session.options.cwd
  session.commands = COMMANDS
  let initialized = false
  let interrupted = false
  let next = 0
  session.onInterrupt(() => (interrupted = true))
  const lifecycle = (message: SDKUserMessage, state: 'queued' | 'started' | 'completed') => message.uuid && session.emit(sdk.lifecycle(message.uuid, state))
  session.onReceive((message) => lifecycle(message, 'queued'))
  const store = (text: string) => fake.record(sessionId, cwd, stored.assistant(randomUUID(), `msg_${randomUUID()}`, [{ type: 'text', text }]))
  const remember = (message: SDKUserMessage) => fake.record(sessionId, cwd, stored.user(message.uuid ?? randomUUID(), message.message.content))
  while (!session.closed) {
    await session.waitForInput(next + 1)
    const message = session.received[next++]!
    remember(message)
    if (message.shouldQuery === false) {
      session.emit(sdk.success({ num_turns: 0 }))
      lifecycle(message, 'completed')
      continue
    }
    if (!initialized) session.emit(sdk.init(sessionId, { model: 'fake-model', permissionMode: session.options.permissionMode ?? 'default' }))
    initialized = true
    interrupted = false
    lifecycle(message, 'started')
    const turn = [message]
    // Messages sent with priority 'next' while this turn streams: read now, answered in the same turn.
    const fold = () => {
      let added = ''
      while (session.received[next]?.priority === 'next') {
        const read = session.received[next++]!
        remember(read)
        lifecycle(read, 'started')
        turn.push(read)
        added += `\nEcho: ${textOf(read)}`
      }
      return added
    }
    await respond({ session, interrupted: () => interrupted, options, store, fold }, textOf(message), imageCount(message))
    for (const done of turn) lifecycle(done, 'completed')
  }
}

// The scripted SDK: every CoreConfig SDK entry point, on the fake session store.
export function createScriptedSdk(options: ScenarioOptions = { wordDelayMs: 40 }) {
  const fake = createFakeSdk()
  const query = ((params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
    const handle = fake.query(params)
    void drive(fake, fake.last(), options)
    return handle
  }) as typeof fake.query
  return { ...fake, query }
}
