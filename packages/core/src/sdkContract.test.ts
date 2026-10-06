// Contract with the SDK on what core reads outside its types (CLAUDE.md, Conventions): a stored message from another
// Claude session keeps its origin (sender name, text without the CLI's envelope) through the real getSessionMessages,
// so the chat shows it as a peerMessage. Zero tokens: a sample session file in a temporary config folder.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { storedPeer } from './normalize.ts'

const CONFIG = mkdtempSync(join(tmpdir(), 'cw-sdk-contract-'))
const CWD = '/tmp/cw-sdk-contract-project'
const SESSION = '11111111-2222-4333-8444-555555555555'
const HUMAN_UUID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PEER_UUID = 'aaaaaaaa-0000-4000-8000-000000000002'
const previousConfig = process.env.CLAUDE_CONFIG_DIR

// The session file as the CLI 2.1.287 writes it: a typed message, then one from another session (SendMessage).
function writeSession(): void {
  const dir = join(CONFIG, 'projects', CWD.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const base = { cwd: CWD, sessionId: SESSION, isSidechain: false, userType: 'external', version: '2.1.287', gitBranch: '', entrypoint: 'sdk-ts' }
  const envelope = 'Another Claude session sent a message:\n<cross-session-message from="uds:/x.sock" from-name="other-session" from-mode="prompting">\nTests pass\n</cross-session-message>'
  const lines = [
    { ...base, type: 'user', uuid: HUMAN_UUID, parentUuid: null, timestamp: '2026-10-06T10:00:00.000Z', message: { role: 'user', content: 'hello' }, origin: { kind: 'human' } },
    {
      ...base,
      type: 'user',
      uuid: PEER_UUID,
      parentUuid: HUMAN_UUID,
      timestamp: '2026-10-06T10:00:05.000Z',
      isMeta: true,
      message: { role: 'user', content: envelope },
      origin: { kind: 'peer', from: 'uds:/x.sock', name: 'other-session', fromMode: 'prompting', body: 'Tests pass' }
    }
  ]
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

beforeAll(() => {
  writeSession()
  process.env.CLAUDE_CONFIG_DIR = CONFIG
})

afterAll(() => {
  if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfig
  rmSync(CONFIG, { recursive: true, force: true })
})

describe('SDK contract: messages from another session', () => {
  it('the real getSessionMessages keeps the origin of a stored message from another session', async () => {
    const { getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk')
    const messages = await getSessionMessages(SESSION, { dir: CWD })
    expect(messages.map((message) => message.uuid)).toEqual([HUMAN_UUID, PEER_UUID])
    expect(storedPeer(messages[1]!)).toEqual({ from: 'other-session', text: 'Tests pass' })
    expect(storedPeer(messages[0]!)).toBeUndefined()
  })
})
