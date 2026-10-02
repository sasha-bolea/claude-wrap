// SDK probe (`npm run probe`): runs real CLI sessions with zero-token local commands, records what the bundled
// CLI exposes and re-checks the SDK facts the design relies on. Writes docs/reference/sdk-probe.json.
// Runs directly on Node 24 (type stripping). Exit code 1 if a risky Settings key is not classified in the trust gate.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deleteSession, query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { unclassifiedSettings } from '../src/settingsKeys.ts'

// Local command: makes the CLI emit system/init without calling the model.
const PROBE_PROMPT = '/context'
const OUTPUT_PATH = new URL('../../../docs/reference/sdk-probe.json', import.meta.url)
const CWD = process.cwd()

// Streaming input that stays open until end(): control methods only work while it is open.
// Returns the async iterable for query(), push(text) to send a user message, end() to close it.
function createInput() {
  const queue: SDKUserMessage[] = []
  let wake: (() => void) | undefined
  let ended = false
  async function* stream(): AsyncGenerator<SDKUserMessage> {
    while (!ended) {
      const next = queue.shift()
      if (next) yield next
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  }
  return {
    stream: stream(),
    push(text: string) {
      queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    }
  }
}

// Opens a session with the same options the app uses. resume: session id to resume, if any.
function openSession(resume?: string) {
  const input = createInput()
  const session = query({
    prompt: input.stream,
    options: { cwd: CWD, resume, settingSources: ['user', 'project', 'local'], systemPrompt: { type: 'preset', preset: 'claude_code' } }
  })
  return { input, session, messages: session[Symbol.asyncIterator]() }
}

// Reads messages until the end of the current turn. Returns the turn's messages.
async function readTurn(messages: AsyncIterator<SDKMessage>): Promise<SDKMessage[]> {
  const turn: SDKMessage[] = []
  for (;;) {
    const next = await messages.next()
    if (next.done) return turn
    turn.push(next.value)
    if (next.value.type === 'result') return turn
  }
}

const describeType = (message: SDKMessage) => ('subtype' in message ? `${message.type}/${message.subtype}` : message.type)
const findInit = (turn: SDKMessage[]) => turn.find((message) => message.type === 'system' && message.subtype === 'init')

// Replaces the account email so the committed probe carries no personal data.
function redact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, field) => (key === 'email' ? '<redacted>' : field)))
}

// First session: inventory, two turns, setPermissionMode in between. Returns the raw observations.
async function probeFirstSession() {
  const { input, session, messages } = openSession()
  try {
    input.push(PROBE_PROMPT)
    const initialization = await session.initializationResult()
    const [commands, models, agents, account] = await Promise.all([
      session.supportedCommands(),
      session.supportedModels(),
      session.supportedAgents(),
      session.accountInfo()
    ])
    const firstTurn = await readTurn(messages)
    await session.setPermissionMode('acceptEdits')
    input.push(PROBE_PROMPT)
    const secondTurn = await readTurn(messages)
    return { initialization, commands, models, agents, account, firstTurn, secondTurn }
  } finally {
    input.end()
    session.close()
  }
}

// Resumes a session with one local command. Returns the session id reported by init (or the error).
async function probeResume(sessionId: string): Promise<string> {
  const { input, session, messages } = openSession(sessionId)
  try {
    input.push(PROBE_PROMPT)
    const init = findInit(await readTurn(messages))
    return init && 'session_id' in init ? init.session_id : 'no init'
  } catch (error) {
    return `error: ${String(error)}`
  } finally {
    input.end()
    session.close()
  }
}

// Runs the probe and writes the JSON. Exit code 1 if the probe itself fails.
async function main(): Promise<void> {
  const sdkEntry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
  const sdkPackage = JSON.parse(readFileSync(join(dirname(sdkEntry), 'package.json'), 'utf8'))
  const first = await probeFirstSession()
  const init = findInit(first.firstTurn)
  const sessionId = init && 'session_id' in init ? init.session_id : ''
  const resumedSessionId = await probeResume(sessionId)
  await deleteSession(sessionId, { dir: CWD })

  const result = {
    created: new Date().toISOString(),
    sdkVersion: sdkPackage.version,
    cliVersion: sdkPackage.claudeCodeVersion,
    facts: {
      controlMethodsWorkInStreamingInput: true,
      initOnlyAtFirstTurn: !findInit(first.secondTurn),
      setPermissionModeEmitsStatus: first.secondTurn.some((message) => describeType(message) === 'system/status'),
      resumeKeepsSessionId: resumedSessionId === sessionId,
      resumedSessionId: resumedSessionId === sessionId ? undefined : resumedSessionId,
      internalCommands: first.commands.filter((command) => command.name.startsWith('__')).map((command) => command.name),
      // Settings keys that may run something and the trust gate has not classified: must stay empty.
      unclassifiedSettings: unclassifiedSettings(readFileSync(join(dirname(sdkEntry), 'sdk.d.ts'), 'utf8'))
    },
    systemInit: init,
    initialization: first.initialization,
    commands: first.commands,
    models: first.models,
    agents: first.agents,
    account: first.account,
    firstTurnMessageTypes: first.firstTurn.map(describeType),
    secondTurnMessageTypes: first.secondTurn.map(describeType)
  }
  writeFileSync(OUTPUT_PATH, JSON.stringify(redact(result), null, 2) + '\n')
  console.log(JSON.stringify({ sdkVersion: result.sdkVersion, cliVersion: result.cliVersion, ...result.facts }, null, 2))
  if (result.facts.unclassifiedSettings.length) {
    console.error(`Classify these settings in packages/core/src/trust.ts (CLASSIFIED_SETTINGS): ${result.facts.unclassifiedSettings.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
