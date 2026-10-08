import { randomUUID } from 'node:crypto'
import type { McpServerStatus, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
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
//   widget     → answers with an inline chat widget: a Vai button (athome.send), a Nuovo progetto button
//                (athome.createProject('idea'), its outcome in #project) and a probe of its frame (runtime, theme,
//                storage, network, an action tried on load) written in #probe; widget <name> → a ```widget:<name> block
//                with {"text":"vai"}
//   edit       → writes src/app.ts and src/util.ts (Write tool calls), then "Edited: done"; rewindFiles reports the files
//                written by the turns from a message on (3 lines inserted per write), the dry run included
//   tools      → runs three Bash commands in a row (ls, a long git log, npm test), then "Tools: done"
//   peer       → answers, then another session's message arrives (stored) and gets its own answer
//   crash      → the process dies
//   /command   → "Ran /command" as a synthetic assistant message, like the CLI's local commands
//   anything else → streams "Echo: <text>" word by word (" [N images]" appended when images came along)
// Every turn ends with a result; an interrupt ends it as aborted, like the CLI. Transcript-only messages
// (shouldQuery: false, the `!` shell output) are stored and get only an empty result (num_turns 0), like the CLI.
// Every process also has data for the Status / MCP servers / Hooks panels (see scriptInspection).
// Like CLI 2.1.287, every message gets command_lifecycle frames (queued on arrival, started when read, completed at
// the end of its turn), and one sent with priority 'next' while a turn streams is read before that turn ends: its
// echo is added to the same answer.

export type ScenarioOptions = { wordDelayMs: number }

const as = (message: object) => message as unknown as SDKMessage
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
// peer: a message from another session arrives (stored, then the CLI starts its turn); returns its uuid.
type Turn = { session: FakeSession; interrupted: () => boolean; options: ScenarioOptions; store: (text: string) => void; fold: () => string; peer: (name: string, body: string) => string; edited: (file: string, lines: number) => void }

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
// The inline widget of the `widget` keyword. Its probe line: athome.send's type, whether the app's accent arrived,
// what storage access gives, what a fetch gives and what an action tried without a tap gives (all once both settle).
const WIDGET_HTML = [
  '<div class="row"><button id="go" onclick="athome.send(\'vai\').then(() => (document.body.dataset.sent = \'yes\'), (e) => (document.body.dataset.error = e.message))">Vai</button>',
  '<button class="secondary" onclick="athome.createProject(\'idea\').then((r) => (document.getElementById(\'project\').textContent = \'made \' + r.path), (e) => (document.getElementById(\'project\').textContent = \'refused\'))">Nuovo progetto</button></div>',
  '<p id="project"></p>',
  '<p id="probe"></p>',
  '<script>',
  "const storage = (() => { try { return typeof localStorage.length } catch { return 'blocked' } })()",
  "const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ? 'themed' : 'plain'",
  "const auto = athome.send('auto').then(() => 'auto-sent', () => 'auto-refused')",
  "const network = fetch('https://example.com/').then(() => 'fetched', () => 'offline')",
  "Promise.all([network, auto]).then((outcomes) => (document.getElementById('probe').textContent = [typeof athome.send, accent, storage, ...outcomes].join(',')))",
  '</script>'
].join('\n')

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
  if (keyword === 'edit') {
    for (const file of ['src/app.ts', 'src/util.ts']) {
      const id = `toolu_${randomUUID()}`
      const content = 'a\nb\nc'
      session.emit(sdk.assistant(`msg_${randomUUID()}`, [{ type: 'tool_use', id, name: 'Write', input: { file_path: file, content } }]))
      await sleep(turn.options.wordDelayMs * 2)
      session.emit(sdk.toolResult(id, `wrote ${file}`))
      turn.edited(file, 3)
    }
    return stream(turn, 'Edited: done')
  }
  if (keyword === 'tools') {
    for (const command of ['ls', 'git log --oneline --decorate --graph --all --since=2026-01-01 -- packages/ui/src/touch packages/core/src', 'npm test']) {
      const id = `toolu_${randomUUID()}`
      session.emit(sdk.assistant(`msg_${randomUUID()}`, [{ type: 'tool_use', id, name: 'Bash', input: { command } }]))
      await sleep(turn.options.wordDelayMs * 5)
      session.emit(sdk.toolResult(id, `ran ${command}`))
    }
    return stream(turn, 'Tools: done')
  }
  if (keyword === 'widget') return stream(turn, `Here it is:\n\n\`\`\`widget\n${WIDGET_HTML}\n\`\`\`\n\nTap it.`)
  if (keyword.startsWith('widget ')) return stream(turn, `\`\`\`widget:${keyword.slice(7)}\n{"text":"vai"}\n\`\`\``)
  if (keyword === 'markdown') return stream(turn, 'Image: ![tracker](https://example.com/pixel.png) and a [link](https://example.com).')
  if (keyword === 'peer') {
    // After this answer, another session sends a message (SendMessage): the CLI starts a turn for it by itself.
    await stream(turn, 'Peer: waiting for the other session')
    await sleep(turn.options.wordDelayMs * 5)
    const id = turn.peer('other-session', 'Tests pass on **main**')
    await stream(turn, 'Thanks, merging')
    return void session.emit(sdk.lifecycle(id, 'completed'))
  }
  if (keyword === 'limit') {
    // The account's usage limit, for an hour (as the CLI reports it before refusing).
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600))
    return stream(turn, "You've hit your session limit")
  }
  return stream(turn, `Echo: ${text}${images ? ` [${images} images]` : ''}`)
}

// Gives a process the data the Status / MCP servers / Hooks panels show: status sections, three MCP servers (tiny
// connected, remote waiting for sign-in, off disabled) whose toggles, reconnects and sign-in change their state, the
// hooks listing, and one finished SessionStart hook run (hook_response) that the Hooks panel lists as a run.
// Sign-in: a callback address with `code=` connects `remote`, one with `error=` is refused with "OAuth error: access_denied".
// Parameters: the fake process and its folder.
function scriptInspection(session: FakeSession, cwd: string | undefined): void {
  session.statusAnswer = {
    sections: [
      { title: 'Session', rows: [{ label: 'Version', value: '2.1.287' }, { label: 'Working directory', value: cwd ?? '' }] },
      { title: 'Environment', rows: [{ label: 'Model', value: 'fake-model' }] }
    ]
  }
  session.mcpServers = [
    { name: 'tiny', status: 'connected', scope: 'project', source: 'project', config: { type: 'stdio', command: 'tiny-mcp' }, tools: [{ name: 'ping' }] },
    { name: 'remote', status: 'needs-auth', scope: 'project', source: 'project', config: { type: 'http', url: 'https://example.test/mcp' } },
    { name: 'off', status: 'disabled', scope: 'project', source: 'project', config: { type: 'stdio', command: 'off-mcp' } }
  ]
  const setStatus = (name: unknown, status: McpServerStatus['status']) => {
    session.mcpServers = session.mcpServers.map((server) => (server.name === name ? { ...server, status, error: undefined } : server))
  }
  session.inspectEffects.set('toggleMcpServer', ([name, enabled]) => setStatus(name, enabled ? 'connected' : 'disabled'))
  session.inspectEffects.set('reconnectMcpServer', ([name]) => session.mcpServers.find((server) => server.name === name)?.status === 'failed' && setStatus(name, 'connected'))
  session.inspectEffects.set('mcpClearAuth', ([name]) => setStatus(name, 'needs-auth'))
  session.inspectEffects.set('mcpSubmitOAuthCallbackUrl', ([name, url]) => {
    if (String(url).includes('error=')) throw new Error('OAuth error: access_denied')
    if (String(url).includes('code=')) setStatus(name, 'connected')
  })
  session.authAnswer = { authUrl: 'https://example.test/authorize?x=1', requiresUserAction: true, callbackExpected: true }
  session.hooksListing = {
    events: [],
    hooks: [
      { event: 'SessionStart', source: 'projectSettings', sourceLabel: 'Project settings', type: 'command', displayText: 'echo hello-hook', commandText: 'echo hello-hook', contentLabel: 'Command' },
      { event: 'PreToolUse', matcher: 'Bash', source: 'projectSettings', sourceLabel: 'Project settings', type: 'command', displayText: 'echo guard', commandText: 'echo guard', contentLabel: 'Command', timeout: 30 }
    ],
    eventCatalog: [],
    policy: { disabledByPolicy: false, managedOnly: false, pluginOnly: false, allDisabled: false, policyHookCount: 0 }
  }
  session.emit(
    as({ type: 'system', subtype: 'hook_response', hook_id: randomUUID(), hook_name: 'SessionStart:startup', hook_event: 'SessionStart', output: 'hello-hook\n', stdout: 'hello-hook\n', stderr: '', exit_code: 0, outcome: 'success', uuid: randomUUID(), session_id: 's' })
  )
}

// Drives one fake process: init at the first message (a resumed session keeps its id), then one scripted turn
// per user message (those read in the middle of a turn excepted), recorded in the fake session store.
async function drive(fake: FakeSdk, session: FakeSession, options: ScenarioOptions): Promise<void> {
  const sessionId = session.options.resume ?? randomUUID()
  const cwd = session.options.cwd
  session.commands = COMMANDS
  scriptInspection(session, cwd)
  let initialized = false
  let interrupted = false
  let next = 0
  session.onInterrupt(() => (interrupted = true))
  const lifecycle = (message: SDKUserMessage, state: 'queued' | 'started' | 'completed') => message.uuid && session.emit(sdk.lifecycle(message.uuid, state))
  session.onReceive((message) => lifecycle(message, 'queued'))
  const store = (text: string) => fake.record(sessionId, cwd, stored.assistant(randomUUID(), `msg_${randomUUID()}`, [{ type: 'text', text }]))
  const remember = (message: SDKUserMessage) => fake.record(sessionId, cwd, stored.user(message.uuid ?? randomUUID(), message.message.content))
  const peer = (name: string, body: string) => {
    const id = randomUUID()
    fake.record(sessionId, cwd, stored.peer(id, name, body))
    session.emit(sdk.lifecycle(id, 'started'))
    return id
  }
  // Files written per turn, in order: the answers of rewindFiles (the files of the turns from a message on).
  const turns: { uuid: string; files: Map<string, number> }[] = []
  const publishRewinds = () => {
    turns.forEach(({ uuid }, index) => {
      const files = new Map<string, number>()
      for (const later of turns.slice(index)) for (const [file, lines] of later.files) files.set(file, (files.get(file) ?? 0) + lines)
      const filesChanged = [...files.keys()]
      session.rewindResults.set(uuid, { canRewind: true, filesChanged, insertions: [...files.values()].reduce((sum, n) => sum + n, 0), deletions: 0 })
    })
  }
  while (!session.closed) {
    await session.waitForInput(next + 1)
    const message = session.received[next++]!
    if (message.uuid && session.cancelled.has(message.uuid)) continue
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
    const written = new Map<string, number>()
    turns.push({ uuid: message.uuid ?? randomUUID(), files: written })
    const edited = (file: string, lines: number) => written.set(file, (written.get(file) ?? 0) + lines)
    // Messages sent with priority 'next' while this turn streams: read now, answered in the same turn.
    const fold = () => {
      let added = ''
      while (session.received[next] && (session.received[next]!.priority === 'next' || session.cancelled.has(session.received[next]!.uuid ?? ''))) {
        if (session.cancelled.has(session.received[next]!.uuid ?? '')) {
          next++
          continue
        }
        const read = session.received[next++]!
        remember(read)
        lifecycle(read, 'started')
        turn.push(read)
        added += `\nEcho: ${textOf(read)}`
      }
      return added
    }
    await respond({ session, interrupted: () => interrupted, options, store, fold, peer, edited }, textOf(message), imageCount(message))
    publishRewinds()
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
