// Chat widgets through the protocol, on the fake SDK: the library in ~/.claude/widgets, the opt-in switch that appends
// the widget guide to the system prompt, and the /creawidget command it installs and removes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'
import { sdk } from './testing/messages.ts'

let root: string
let cwd: string
let claudeDir: string
let fake: FakeSdk
let core: Core
let client: RawClient

const widgetsDir = () => join(claudeDir, 'widgets')
const commandFile = () => join(claudeDir, 'commands', 'creawidget.md')
// Writes a library widget with a description meta tag (none when description is undefined).
const widget = (name: string, description?: string, body = '<button>Go</button>') =>
  writeFileSync(join(widgetsDir(), `${name}.html`), `${description === undefined ? '' : `<meta name="description" content="${description}">\n`}${body}\n`)

// The system prompt the last spawned process got.
const systemPrompt = () => fake.last().options.systemPrompt as { type: string; preset: string; append?: string }

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-widgets-'))
  cwd = join(root, 'demo')
  claudeDir = join(root, 'claude')
  mkdirSync(cwd)
  mkdirSync(widgetsDir(), { recursive: true })
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd })
})
afterEach(() => core.closeAll())

// Sends a message on t1 and waits for its process to start; returns the spawned session.
async function spawned(count: number) {
  await client.ok('tab.send', { tabId: 't1', text: 'hi' }, crypto.randomUUID())
  await client.waitFor(() => fake.sessions.length === count)
  return fake.last()
}

describe('the widget library', () => {
  it('lists the .html files of ~/.claude/widgets with their description, by name; skips bad names and other files', async () => {
    widget('vai', 'Sends vai')
    widget('schema')
    widget('Bad Name', 'no')
    writeFileSync(join(widgetsDir(), 'notes.txt'), 'x')
    const { widgets, guideTokens } = await client.ok('widgets.list', {})
    expect(widgets).toEqual([{ name: 'schema' }, { name: 'vai', description: 'Sends vai' }])
    expect(guideTokens).toBeGreaterThan(100)
  })

  it('is empty when the folder does not exist', async () => {
    const other = createCore({ backendId: 'test', backendKind: 'local', sdk: createFakeSdk(), claudeConfigDir: join(root, 'none') })
    const raw = new RawClient(other)
    await raw.hello()
    expect((await raw.ok('widgets.list', {})).widgets).toEqual([])
    other.closeAll()
  })

  it('reads a widget by name; refuses names outside the library and files too large', async () => {
    widget('vai', 'Sends vai')
    expect((await client.ok('widgets.read', { name: 'vai' })).html).toContain('<button>Go</button>')
    expect(await client.fails('widgets.read', { name: 'missing' })).toMatchObject({ code: 'not_found' })
    expect(await client.fails('widgets.read', { name: '../settings' })).toMatchObject({ code: 'invalid_args' })
    writeFileSync(join(widgetsDir(), 'big.html'), 'x'.repeat(300_000))
    expect(await client.fails('widgets.read', { name: 'big' })).toMatchObject({ code: 'too_large' })
  })
})

describe('the widgets switch', () => {
  it('is off by default: the system prompt is the plain preset and /creawidget is not installed', async () => {
    await spawned(1)
    expect(systemPrompt()).toEqual({ type: 'preset', preset: 'claude_code' })
    expect(existsSync(commandFile())).toBe(false)
  })

  it('on: saved and announced, /creawidget installed, the guide (with the library) appended at the next spawn', async () => {
    widget('vai', 'Sends vai')
    await client.ok('settings.setWidgets', { on: true })
    const update = (client.events(WORKSPACE_STREAM) as { type: string; widgets?: boolean }[]).find((ev) => ev.type === 'settings.updated')
    expect(update?.widgets).toBe(true)
    expect(readFileSync(commandFile(), 'utf8')).toContain('~/.claude/widgets/')
    await spawned(1)
    const { append } = systemPrompt()
    expect(append).toContain('```widget')
    expect(append).toContain('vai — Sends vai')
  })

  it('a live process restarts at the end of its turn to take the change', async () => {
    const session = await spawned(1)
    session.emit(sdk.init('s-widgets'))
    await client.ok('settings.setWidgets', { on: true })
    session.emit(sdk.success())
    await client.waitFor(() => session.closed)
    await spawned(2)
    expect(fake.last().options).toMatchObject({ resume: 's-widgets' })
    expect(systemPrompt().append).toContain('```widget')
  })

  it('off: /creawidget removed, unless the user edited it', async () => {
    await client.ok('settings.setWidgets', { on: true })
    await client.ok('settings.setWidgets', { on: false })
    expect(existsSync(commandFile())).toBe(false)
    await client.ok('settings.setWidgets', { on: true })
    writeFileSync(commandFile(), 'my own version')
    await client.ok('settings.setWidgets', { on: false })
    expect(readFileSync(commandFile(), 'utf8')).toBe('my own version')
  })
})
