import { randomUUID } from 'node:crypto'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createFakeSdk, type FakeSdk, type FakeSession } from './fakeQuery.ts'
import { sdk, stored } from './messages.ts'

// Scripted fake SDK for deterministic e2e runs (hosts enable it with CLAUDE_WRAP_FAKE_SDK=1).
// Each fake process answers the user's messages by keyword:
//   permission → asks to Write a file, then reports the decision (and the deny reason)
//   question   → asks a multiple-choice question, then echoes the answers
//   plan       → asks to approve a plan, then reports the decision
//   slow       → streams a long answer, word by word, until interrupted
//   markdown   → answers with a remote image and a link (rendering safety checks)
//   crash      → the process dies
//   anything else → streams "Echo: <text>" word by word
// Every turn ends with a result; an interrupt ends it as aborted, like the CLI.

export type ScenarioOptions = { wordDelayMs: number }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Text of a user message (string content or text blocks).
function textOf(message: SDKUserMessage): string {
  const { content } = message.message
  return typeof content === 'string' ? content : content.map((block) => ('text' in block ? block.text : '')).join('\n')
}

// One fake turn in progress: knows whether it was interrupted, and stores what it says like the CLI's JSONL.
type Turn = { session: FakeSession; interrupted: () => boolean; options: ScenarioOptions; store: (text: string) => void }

// Streams text word by word, then the final frame and a success result (or an aborted result if interrupted).
async function stream({ session, interrupted, options, store }: Turn, text: string): Promise<void> {
  const messageId = `msg_${randomUUID()}`
  session.emit(sdk.messageStart(messageId), sdk.blockStart(0, { type: 'text', text: '' }))
  for (const word of text.split(/(?<= )/)) {
    if (interrupted()) return session.emit(sdk.aborted())
    session.emit(sdk.textDelta(0, word))
    await sleep(options.wordDelayMs)
  }
  if (interrupted()) return session.emit(sdk.aborted())
  store(text)
  session.emit(sdk.assistant(messageId, [{ type: 'text', text }]), sdk.success())
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
const WRITE_RULE = [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'localSettings' }]
const SLOW_TEXT = Array.from({ length: 400 }, (_, n) => `word${n}`).join(' ')

// Answers one user message according to its keyword.
async function respond(turn: Turn, text: string): Promise<void> {
  const { session } = turn
  const keyword = text.trim().toLowerCase()
  if (keyword === 'crash') return session.exit(new Error('fake claude crashed'))
  if (keyword === 'permission') {
    const outcome = await ask(turn, 'Write', { file_path: 'notes.txt', content: 'hello' }, { suggestions: WRITE_RULE, title: 'Write notes.txt' })
    return stream(turn, `Permission: ${outcome}`)
  }
  if (keyword === 'question') return stream(turn, `Question: ${await ask(turn, 'AskUserQuestion', QUESTION)}`)
  if (keyword === 'plan') return stream(turn, `Plan: ${await ask(turn, 'ExitPlanMode', { plan: '1. Do the thing\n2. Check it' })}`)
  if (keyword === 'slow') return stream(turn, SLOW_TEXT)
  if (keyword === 'markdown') return stream(turn, 'Image: ![tracker](https://example.com/pixel.png) and a [link](https://example.com).')
  return stream(turn, `Echo: ${text}`)
}

// Drives one fake process: init at the first message (a resumed session keeps its id), then one scripted turn
// per user message, recorded in the fake session store.
async function drive(fake: FakeSdk, session: FakeSession, options: ScenarioOptions): Promise<void> {
  const sessionId = session.options.resume ?? randomUUID()
  const cwd = session.options.cwd
  let interrupted = false
  session.onInterrupt(() => (interrupted = true))
  const store = (text: string) => fake.record(sessionId, cwd, stored.assistant(randomUUID(), `msg_${randomUUID()}`, [{ type: 'text', text }]))
  for (let count = 1; !session.closed; count++) {
    await session.waitForInput(count)
    const message = session.received[count - 1]!
    if (count === 1) session.emit(sdk.init(sessionId, { model: 'fake-model', permissionMode: session.options.permissionMode ?? 'default' }))
    fake.record(sessionId, cwd, stored.user(message.uuid ?? randomUUID(), textOf(message)))
    interrupted = false
    await respond({ session, interrupted: () => interrupted, options, store }, textOf(message))
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
