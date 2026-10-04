// The PWA (touch layout of the approved prototype) on the real server with the scripted fake SDK, in Chrome at
// iPhone size. User stories: I pair the phone with a one-time code; I open a session in a folder of the server and
// chat; Claude's request is part of the conversation and I answer it; the same session open on two devices stays in
// sync; a revoked device goes back to pairing; on iPhone Safari I am told to install the app first. Sub-phase A: no
// zoom, splash screens, the newer build offered. Sub-phase C1: a message sent while Claude works is read in the same
// turn; the queue (pause after Stop, resume); the folder's files (browse, preview, mention, upload, trash with undo);
// notes used in a message; folders and projects in the Home; the theme.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext } from 'playwright-core'
import { button, composer, home, lastAnswer, launchChrome, openProject, pairedPage, phone, send, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []

const newPhone = async (ios = false) => {
  const context = await phone(browser, ios)
  contexts.push(context)
  return context
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => (backend = await startBackend()))
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

describe('PWA (fake SDK)', () => {
  it('on iPhone Safari it asks to install first; once paired it stays paired after a reload', async () => {
    const safari = await (await newPhone(true)).newPage()
    await safari.goto(backend.url)
    await safari.getByRole('heading', { name: 'Install the app first' }).waitFor()
    const page = await pairedPage(await newPhone(), backend)
    expect(page.url()).not.toContain('#pair=')
    await page.reload()
    await home(page).waitFor()
  })

  it('a wrong code is refused with a clear message', async () => {
    const page = await (await newPhone()).newPage()
    await page.goto(`${backend.url}/#pair=not-a-code`)
    await page.getByRole('button', { name: 'Pair' }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toBe('Unknown or expired code: ask for a new one.')
  })

  it('opens a session in a server folder, chats, and answers a request inside the conversation', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'hello phone')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello phone')
    await send(page, 'permission')
    const request = page.getByRole('region', { name: 'Permission request' })
    await request.waitFor()
    // Never focused by itself: a stray tap on the keyboard cannot grant.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON')
    await request.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')
    // Back to the Home: the Sessioni view lists the session once, with the title the CLI gave it (here the first
    // prompt), among the open ones only.
    await button(page, 'Back').click()
    await button(page, 'Show sessions').click()
    await page.getByRole('button', { name: /^hello phone project/ }).waitFor()
    expect(await page.getByRole('button', { name: /^hello phone/ }).count()).toBe(1)
    await page.getByText('No past sessions').waitFor()
  })

  it('a session left without sending anything is closed; with a draft written it stays', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await button(page, 'Back').click()
    await button(page, 'Show sessions').click()
    await page.getByText('No open sessions').waitFor()
    await button(page, 'Show projects').click()
    await button(page, 'New session in project').click()
    await composer(page).fill('a draft to finish')
    await button(page, 'Back').click()
    await button(page, 'Show sessions').click()
    await page.getByRole('button', { name: /^project project/ }).waitFor()
  })

  it('the permission mode sheet and the photo picker of the composer work', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await button(page, 'Permission mode: Ask for permissions').click()
    await page.getByRole('dialog', { name: 'Permission mode' }).getByRole('radio', { name: 'Plan' }).click()
    await button(page, 'Permission mode: Plan').waitFor()
    await page.locator('.composer input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG })
    await page.getByRole('img', { name: 'Image 1' }).waitFor()
    await send(page, 'look')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: look [1 images]')
  })

  it('two devices on the same session stay in sync; an answer on one closes the request on the other', async () => {
    const first = await pairedPage(await newPhone(), backend, 'phone')
    await openProject(first)
    await send(first, 'permission')
    await first.locator('.request').waitFor()
    const second = await pairedPage(await newPhone(), backend, 'tablet')
    await button(second, /^Show sessions/).click()
    await second.getByRole('button', { name: /^project / }).click()
    expect(await second.locator('.msg-user').first().textContent()).toBe('permission')
    await second.locator('.request').getByRole('button', { name: 'Yes', exact: true }).click()
    await first.locator('.request').waitFor({ state: 'detached' })
    await expect.poll(() => lastAnswer(first).textContent()).toBe('Permission: allow')
    await composer(second).waitFor()
  })

  it('a message sent while Claude works waits, is read in the same turn and answered in it', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await send(page, 'extra')
    const extra = page.locator('.msg-user').filter({ hasText: 'extra' })
    await extra.filter({ hasText: 'waiting' }).waitFor()
    await extra.filter({ hasText: 'read' }).waitFor({ timeout: 20_000 })
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: extra')
  })

  it('"Send now" beside a waiting message: Claude stops waiting for its step and reads it at once', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await send(page, 'right now')
    const sendNow = page.getByRole('button', { name: 'Send now: Claude reads it right away' })
    await sendNow.click()
    await sendNow.waitFor({ state: 'detached' })
    // Well before the slow answer would have ended by itself (8 s).
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 5_000 }).toBe('Echo: right now')
  })

  it('the ghost of my message: hidden at the bottom of the chat, shown as soon as I scroll up, hidden back at the bottom', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    // The whole (long) answer first: taller than the screen.
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    const conversation = page.locator('.conversation')
    const ghost = page.locator('.ghost')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight))
    await page.waitForTimeout(200)
    expect(await ghost.count()).toBe(0)
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 300))
    await ghost.waitFor()
    expect(await ghost.textContent()).toContain('slow')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight))
    await ghost.waitFor({ state: 'detached' })
  })

  it('commands in a row stack up like the queue; a tap spreads them into their cards, "Stack" gathers them again', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'tools')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Tools: done')
    const stack = page.getByRole('button', { name: /^3 commands in a row, the last: Bash npm test, done/ })
    await stack.waitFor()
    expect(await page.locator('.tool-card').count()).toBe(3)
    // Under the ghost: the cards' z-index stays inside the stack.
    expect(await stack.evaluate((element) => getComputedStyle(element).isolation)).toBe('isolate')
    expect(await page.locator('details.tool').count()).toBe(0)
    await stack.click()
    await page.locator('details.tool').nth(2).waitFor()
    expect(await page.locator('details.tool summary').allTextContents()).toEqual(['Bashlsdone', 'Bashgit log --oneline --decorate --graph --all --since=2026-01-01 -- packages/ui/src/touch packages/core/srcdone', 'Bashnpm testdone'])
    // Closed, as one line each: a long command is cut, the cards stay as wide as the chat.
    const width = await page.locator('.conversation').evaluate((box) => box.clientWidth)
    for (const card of await page.locator('details.tool').all()) {
      expect(await card.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)
      expect((await card.boundingBox())!.width).toBeLessThan(width)
    }
    await page.getByRole('button', { name: 'Stack the 3 commands' }).click()
    await stack.waitFor()
    expect(await page.locator('details.tool').count()).toBe(0)
  })

  it('the queue: queue mode adds a card; Stop pauses the queue; ▶ sends the next message', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await button(page, /^Queue: empty/).click()
    await composer(page).fill('queued one')
    await button(page, 'Add to the queue').click()
    await page.getByRole('button', { name: /^Queue: 1 waiting\. Next: queued one/ }).waitFor()
    await button(page, 'Stop: stop Claude').click()
    const resume = page.getByRole('button', { name: 'Queue paused: Resume' })
    await resume.waitFor()
    await page.locator('.working-line').waitFor({ state: 'detached' })
    expect(await page.locator('.msg-user').filter({ hasText: 'queued one' }).count()).toBe(0)
    await resume.click()
    // The chat is on screen: the message counts down in the composer before it goes.
    await page.getByRole('status').filter({ hasText: /From the queue: goes in \d s/ }).waitFor()
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toBe('Echo: queued one')
    await page.locator('.queue-tray').waitFor({ state: 'detached' })
  })

  it('the next queued message counts down in the composer while the chat is on screen; Stop brings it back into the field', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await button(page, /^Queue: empty/).click()
    await composer(page).fill('wait for me')
    await button(page, 'Add to the queue').click()
    await button(page, 'Stop: stop Claude').click()
    await button(page, 'Queue paused: Resume').click()
    const countdown = page.getByRole('status').filter({ hasText: 'wait for me' })
    await countdown.waitFor()
    await countdown.getByRole('button', { name: 'Stop: it comes back into the field' }).click()
    await expect.poll(() => composer(page).inputValue()).toBe('wait for me')
    await page.waitForTimeout(6000)
    expect(await page.locator('.msg-user').filter({ hasText: 'wait for me' }).count()).toBe(0)
  })

  it("the folder's files: browse, preview with colours, mention in the chat, upload, trash with undo", async () => {
    const project = join(backend.root, 'project')
    mkdirSync(join(project, 'src'))
    writeFileSync(join(project, 'src', 'app.ts'), 'export const answer = 42\n')
    writeFileSync(join(project, 'README.md'), '# Title\n\nText.\n')
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await button(page, 'More actions').click()
    await button(page, 'Folder files').click()
    await button(page, /^src /).click()
    await button(page, /^app\.ts /).click()
    await page.locator('.code .hljs-keyword').first().waitFor()
    await button(page, 'Mention in chat').click()
    await expect.poll(() => composer(page).inputValue()).toBe('@src/app.ts ')
    await composer(page).fill('')
    // Upload into the folder's root, then delete README.md and undo.
    await button(page, 'More actions').click()
    await button(page, 'Folder files').click()
    await page.locator('input[type=file]:not([accept])').last().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
    await page.getByRole('button', { name: /^notes\.txt new/ }).waitFor()
    await button(page, 'Actions for README.md').click()
    await button(page, 'Move to the trash').click()
    await page.getByRole('button', { name: /^README\.md/ }).waitFor({ state: 'detached' })
    await page.getByRole('status').getByRole('button', { name: 'Restore' }).click()
    await expect.poll(() => page.getByRole('status').filter({ hasText: 'Restored in' }).count()).toBe(1)
    await button(page, 'Recently deleted').click()
    await page.getByText('Nothing deleted').waitFor()
  })

  it('a note used in the message is linked to the draft and deleted at send', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await button(page, 'More actions').click()
    await button(page, /^Folder notes/).click()
    await button(page, 'New note').click()
    const text = 'Remember the milk, then the long list of everything else that keeps going on and on past the screen'
    await page.keyboard.type(text)
    await page.getByText(/^Saved · /).waitFor()
    await button(page, 'Notes').click()
    await button(page, 'Use in the message').click()
    await expect.poll(() => composer(page).inputValue()).toBe(text)
    await page.locator('.linked-note').getByText('Remember the milk', { exact: false }).waitFor()
    // A long title is cut: the bar stays as wide as the screen and Send stays on it.
    const send = page.getByRole('button', { name: 'Send', exact: true })
    const viewport = page.viewportSize()!.width
    expect((await page.locator('.input-box').boundingBox())!.width).toBeLessThanOrEqual(viewport)
    const sendBox = (await send.boundingBox())!
    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(viewport)
    await send.click()
    await page.getByRole('status').filter({ hasText: 'used and deleted' }).waitFor()
    await button(page, 'More actions').click()
    await page.getByRole('button', { name: 'Folder notes 0' }).waitFor()
  })

  it('folders: a new project at the root, its sessions screen, delete with undo', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'New folder').click()
    await page.getByRole('textbox', { name: 'Folder name' }).fill('app')
    expect(await page.getByRole('checkbox', { name: 'It is a project' }).isChecked()).toBe(true)
    await button(page, 'Create').click()
    await page.getByRole('img', { name: 'Project' }).waitFor()
    await page.getByRole('button', { name: 'app', exact: true }).click()
    await button(page, 'New session here').waitFor()
    await button(page, 'Back').click()
    await button(page, 'Actions for the folder app').click()
    await button(page, 'Delete').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'app', exact: true }).waitFor({ state: 'detached' })
    await page.getByRole('status').getByRole('button', { name: 'Restore' }).click()
    await page.getByRole('button', { name: 'app', exact: true }).waitFor()
  })

  it('deleting a folder with a session open inside: Cancel or "Delete folder and sessions", which closes it too', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'hello')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: hello')
    // Back to the Home root (through the project's folder, which goes up with "Up: <parent>").
    const actions = page.getByRole('button', { name: 'Actions for the folder project' })
    for (let step = 0; step < 3 && !(await actions.waitFor({ timeout: 1500 }).then(() => true, () => false)); step++) await button(page, /^Back$|^Up: /).click()
    await actions.click()
    await button(page, 'Delete').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('A session is open inside this folder: it will be closed').waitFor()
    expect(await dialog.getByRole('button', { name: 'Go to the sessions' }).count()).toBe(0)
    await dialog.getByRole('button', { name: 'Delete folder and sessions' }).click()
    await page.getByRole('button', { name: 'project', exact: true }).waitFor({ state: 'detached' })
  })

  it('a folder of the Home ends with its files ("2 files, 1 hidden"), which open the explorer; none when it has no files', async () => {
    writeFileSync(join(backend.root, 'project', 'app.ts'), 'export {}\n')
    writeFileSync(join(backend.root, 'project', '.env'), 'X=1\n')
    const page = await pairedPage(await newPhone(), backend)
    expect(await page.getByRole('button', { name: /^\d+ files?/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'project', exact: true }).click()
    await button(page, '2 files, 1 hidden').click()
    await page.getByRole('heading', { name: /^Files/ }).waitFor()
    await button(page, /^app\.ts /).click()
    await page.locator('.code .hljs-keyword').first().waitFor()
    expect(await page.getByRole('button', { name: 'Mention in chat' }).count()).toBe(0)
  })

  it('accounts: added with a token in Settings, picked for a session, and offered when the account hits its usage limit', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Settings').click()
    await button(page, 'Add account').click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Second')
    await page.locator('#account-token').fill('not a token')
    await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click()
    await page.getByRole('status').filter({ hasText: 'setup-token' }).waitFor()
    await page.locator('#account-token').fill(`sk-ant-oat01-${'x'.repeat(40)}`)
    await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click()
    await page.getByRole('button', { name: 'Use Second in every session' }).waitFor()
    // The token is never sent back to the app.
    expect(await page.content()).not.toContain('x'.repeat(40))
    // A name can be changed later; the token stays.
    await button(page, 'Actions for Second').click()
    await button(page, 'Rename').click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Work')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Use Work in every session' }).waitFor()
    await button(page, 'Actions for Work').click()
    await button(page, 'Rename').click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Second')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Use Second in every session' }).waitFor()
    await button(page, 'Back').click()
    await openProject(page)
    await send(page, 'limit')
    const card = page.getByRole('status').filter({ hasText: 'Usage limit of Claude Code login reached until' })
    await card.waitFor()
    await card.getByRole('button', { name: 'Switch to Second' }).click()
    await card.waitFor({ state: 'detached' })
    // Stopped by the limit, the session can go on with the new account: "Continue" sends "continue".
    const stopped = page.getByRole('status').filter({ hasText: 'Claude stopped at the usage limit' })
    await stopped.getByRole('button', { name: 'Continue' }).click()
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: continue')
    await stopped.waitFor({ state: 'detached' })
    await button(page, 'More actions').click()
    await page.getByRole('button', { name: /^Account Second/ }).waitFor()
  })

  it('context and usage panels from the session menu: the window and its categories, plan limits and the session cost', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'hello')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: hello')
    await button(page, 'More actions').click()
    await page.getByRole('dialog').getByRole('button', { name: /^Context/ }).click()
    const context = page.getByRole('region', { name: 'Context' })
    await context.getByText('24%').waitFor()
    expect(await context.locator('.ctx-total').textContent()).toBe('48.5k / 200k tokens24%')
    await context.getByText('Compacts by itself at 155k (78% of the window)').waitFor()
    expect(await context.locator('.ctx-row').filter({ hasText: 'Messages' }).textContent()).toContain('29.5k')
    await context.getByText('2 tools').waitFor()
    await context.getByRole('button', { name: 'Compact now' }).click()
    await expect.poll(() => page.getByRole('textbox', { name: 'Message to Claude' }).inputValue()).toBe('/compact')
    await button(page, 'More actions').click()
    await page.getByRole('dialog').getByRole('button', { name: /^Usage/ }).click()
    const usage = page.getByRole('region', { name: 'Usage and limits' })
    await usage.getByText('Session (5 hours)').waitFor()
    expect(await usage.locator('.usage-row').first().textContent()).toContain('37%')
    await usage.getByText('Week · Fable').waitFor()
    await usage.getByText('$0.42').first().waitFor()
  })

  it('the composer gauge shows the highest of context, 5-hour and weekly use; its sheet has the three bars and compacts now', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    expect(await page.locator('.gauge-btn').count()).toBe(0)
    await send(page, 'hello')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: hello')
    const gauge = page.getByRole('button', { name: 'Context and limits: 37% at most' })
    await gauge.click()
    const sheet = page.getByRole('dialog')
    await sheet.getByText('48.5k / 200k tokens').waitFor()
    expect(await sheet.locator('.gauge-bar').allTextContents()).toEqual([
      expect.stringContaining('24%'),
      expect.stringMatching(/Session \(5 hours\).*37% · Resets/),
      expect.stringMatching(/Week.*12% · Resets/)
    ])
    await sheet.getByRole('button', { name: 'Compact now' }).click()
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Ran /compact')
  })

  it('automatic compaction in Settings: Default, then a size for every session', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Settings').click()
    const group = page.getByRole('radiogroup', { name: 'Compact when the conversation reaches' })
    expect(await group.getByRole('radio', { name: 'Default' }).isChecked()).toBe(true)
    // A click, not check(): the radio turns on only once the backend has the new value.
    await group.getByRole('radio', { name: '200k' }).click()
    await page.getByText('Sessions compact by themselves at 200k').waitFor()
    await page.reload()
    await button(page, 'Settings').click()
    expect(await page.getByRole('radiogroup', { name: 'Compact when the conversation reaches' }).getByRole('radio', { name: '200k' }).isChecked()).toBe(true)
  })

  it('the usage limit card: quiet "Switch to" buttons and Cancel, which puts it away', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'limit')
    const card = page.getByRole('status').filter({ hasText: 'Usage limit of Claude Code login reached until' })
    await card.waitFor()
    expect(await card.getByRole('button', { name: 'Add an account' }).getAttribute('class')).toContain('quiet')
    await card.getByRole('button', { name: 'Cancel' }).click()
    await card.waitFor({ state: 'detached' })
  })

  it('nothing is wider than the screen: long words, paths and tables wrap (chat, its menu, Settings)', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, `a ${'verylongwordwithoutanyspace'.repeat(6)} /srv/progetti/project/${'deep/'.repeat(12)}file.ts`)
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('file.ts')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    await send(page, 'tools')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Tools: done')
    // Every visible element ends inside the screen (1 px of rounding allowed).
    const outside = () =>
      page.evaluate(() => {
        const width = document.documentElement.clientWidth
        return [...document.querySelectorAll<HTMLElement>('.device *')]
          .filter((element) => !element.closest('[hidden], .sr-only') && element.getClientRects().length > 0)
          .filter((element) => {
            const box = element.getBoundingClientRect()
            return box.width > 0 && (box.right > width + 1 || box.left < -1)
          })
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      })
    expect(await outside()).toEqual([])
    await page.locator('.tool-stack').click()
    await page.locator('details.tool').first().click()
    expect(await outside()).toEqual([])
    await button(page, 'More actions').click()
    expect(await outside()).toEqual([])
  })

  it('wide window (≥ 1024 px): Home on the left with the open sessions, the chat in the middle, File/Note on the right, Settings in a window', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await page.getByText('Open a session from the column on the left').waitFor()
    await openProject(page)
    await send(page, 'hello')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: hello')
    // The Home stays on the left, with the open session highlighted; the chat has no back arrow.
    expect(await page.locator('.col-left .row.current').count()).toBe(1)
    expect(await page.locator('.col-center').getByRole('button', { name: 'Back', exact: true }).count()).toBe(0)
    await button(page, 'Folder files').click()
    await page.locator('.col-right').getByRole('button', { name: 'Notes' }).click()
    await page.locator('.col-right').getByRole('button', { name: 'New note' }).waitFor()
    await button(page, 'Folder notes').click()
    await page.locator('.col-right').waitFor({ state: 'detached' })
    // Menus are popovers by their button: below one at the top, above the composer's.
    await button(page, 'More actions').click()
    const menu = page.locator('.sheet.popover')
    const more = (await button(page, 'More actions').boundingBox())!
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(more.y + more.height)
    await page.keyboard.press('Escape')
    await page.locator('.model-btn').click()
    await page.getByRole('dialog', { name: 'Model and effort' }).getByText('Haiku').waitFor()
    const model = (await page.locator('.model-btn').boundingBox())!
    const popover = (await menu.boundingBox())!
    expect(popover.y + popover.height).toBeLessThanOrEqual(model.y)
    await page.keyboard.press('Escape')
    await button(page, 'Settings').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Back' }).click()
    await settings.waitFor({ state: 'detached' })
    // The composer and the conversation stay within a readable width in the middle.
    expect((await page.locator('.col-center .composer').boundingBox())!.width).toBeLessThanOrEqual(808)
  })

  it('hardware keyboard and mouse (wide window): Enter, Up and Ctrl+R history, Shift+Tab, Esc closes then stops, files dropped on the chat', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await openProject(page)
    const field = composer(page)
    await field.fill('first message')
    await field.press('Enter')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('Echo: first message')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    // Up on the empty field brings the previous message back; Ctrl+R lists them.
    await field.press('ArrowUp')
    await expect.poll(() => field.inputValue()).toBe('first message')
    await field.fill('')
    await field.press('Control+r')
    await page.locator('.suggest').getByText('first message').waitFor()
    await field.press('Escape')
    // Shift+Tab switches the permission mode.
    const mode = await page.locator('.mode-btn').getAttribute('data-mode')
    await field.press('Shift+Tab')
    await expect.poll(() => page.locator('.mode-btn').getAttribute('data-mode')).not.toBe(mode)
    // Esc closes a popover first, then stops Claude.
    await field.fill('slow')
    await field.press('Enter')
    await page.locator('.working-line').waitFor()
    await page.locator('.model-btn').click()
    await page.locator('.sheet.popover').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.sheet.popover').waitFor({ state: 'detached' })
    expect(await page.locator('.working-line').count()).toBe(1)
    await page.keyboard.press('Escape')
    await page.locator('.working-line').waitFor({ state: 'detached', timeout: 10_000 })
    // A file dropped on the chat is attached.
    const files = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['notes'], 'readme.txt', { type: 'text/plain' }))
      return transfer
    })
    await page.dispatchEvent('.chat-screen', 'drop', { dataTransfer: files })
    await page.locator('.doc-chip').getByText('readme.txt').waitFor()
  })

  it('the theme chosen in Settings applies and stays after a reload', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Settings').click()
    await page.getByRole('radio', { name: 'Dark' }).check()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await page.reload()
    await home(page).waitFor()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  })

  // Sub-phase A: no zoom (pinch, double tap, focus on a small field), a splash screen for every iPhone size, and an
  // installed app that offers the newer build after a server update.
  it('zoom is locked: viewport, double tap, 16 px fields on the pairing screen too', async () => {
    const page = await (await newPhone()).newPage()
    await page.goto(backend.url)
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('maximum-scale=1')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe('manipulation')
    expect(await page.locator('.field').first().evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px')
  })

  it('both orientations: the manifest locks none, a phone turned sideways shows the app, text is never enlarged', async () => {
    const manifest = (await (await fetch(`${backend.url}/manifest.webmanifest`)).json()) as { orientation?: string }
    expect(manifest.orientation).toBe('any')
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: 'en-US' })
    contexts.push(context)
    const sideways = await context.newPage()
    await sideways.goto(backend.url)
    await sideways.getByRole('heading', { name: 'Pair this device' }).waitFor()
    expect(await sideways.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('-webkit-text-size-adjust'))).toBe('100%')
  })

  it('every splash screen link points to a PNG the server serves, light and dark', async () => {
    const page = await (await newPhone()).newPage()
    await page.goto(backend.url)
    const links = await page.locator('link[rel=apple-touch-startup-image]').evaluateAll((elements) => elements.map((element) => ({ href: (element as HTMLLinkElement).href, media: (element as HTMLLinkElement).media })))
    expect(links.length).toBeGreaterThanOrEqual(20)
    expect(links.filter((link) => link.media.includes('dark')).length).toBe(links.length / 2)
    for (const link of links) {
      const response = await page.request.get(link.href)
      expect(response.status(), link.href).toBe(200)
      expect(response.headers()['content-type']).toBe('image/png')
    }
  })

  it('a newer build on the server shows the update bar; Update reloads; Settings shows the version', async () => {
    const page = await pairedPage(await newPhone(), backend)
    const bar = page.getByRole('status').filter({ hasText: 'New version available' })
    expect(await bar.count()).toBe(0)
    backend.files.set('/version.json', { body: Buffer.from(JSON.stringify({ build: 'newer', version: '9.9.9' })), type: 'application/json' })
    // Back on screen: the app checks the server's version.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await bar.waitFor()
    const reloaded = page.waitForEvent('load')
    await bar.getByRole('button', { name: 'Update' }).click()
    await reloaded
    // Still older than the server: offered again; Later hides it, Settings keeps it.
    await bar.waitFor()
    await bar.getByRole('button', { name: 'Later' }).click()
    await bar.waitFor({ state: 'detached' })
    await button(page, 'Settings').click()
    const row = page.getByRole('listitem').filter({ hasText: 'App version' })
    await expect.poll(() => row.textContent()).toContain('9.9.9 available')
    await row.getByRole('button', { name: 'Update' }).waitFor()
    await button(page, 'Reload').waitFor()
  })

  it('a device revoked from another one goes back to pairing', async () => {
    const first = await pairedPage(await newPhone(), backend, 'phone')
    const second = await pairedPage(await newPhone(), backend, 'tablet')
    await button(first, 'Settings').click()
    await first.getByRole('listitem').filter({ hasText: 'tablet' }).getByRole('button', { name: 'Revoke' }).click()
    await first.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
    await second.getByRole('heading', { name: 'Pair this device' }).waitFor()
    await expect.poll(() => second.getByRole('alert').textContent()).toBe('This device was revoked: pair it again.')
  })
})
