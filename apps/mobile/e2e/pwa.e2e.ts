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
import type { Browser, BrowserContext, CDPSession } from 'playwright-core'
import { createPairingCode } from '@athome/server'
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
  it('on iPhone Safari it asks to install first (only that when opened for a coloured icon); once paired it stays paired after a reload', async () => {
    const safari = await (await newPhone(true)).newPage()
    await safari.goto(backend.url)
    await safari.getByRole('heading', { name: 'Install the app first' }).waitFor()
    expect(await safari.getByRole('button', { name: 'Continue in the browser' }).count()).toBe(1)
    // Opened from "Icon in this colour": only the way to the Home screen, pairing Safari would waste the code.
    await safari.goto(`${backend.url}/?accent=0f766e`)
    await safari.getByText('Pair the app opened from the Home screen').waitFor()
    expect(await safari.getByRole('button', { name: 'Continue in the browser' }).count()).toBe(0)
    const page = await pairedPage(await newPhone(), backend)
    expect(page.url()).not.toContain('#pair=')
    await page.reload()
    await home(page).waitFor()
  })

  it('Add device gives two links with one code: the browser one pairs Safari at once', async () => {
    const context = await newPhone()
    const page = await pairedPage(context, backend)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: backend.url })
    await button(page, 'Settings').click()
    await page.getByRole('button', { name: 'Add device' }).click()
    await page.getByLabel('Name of the new device').fill('tablet')
    await page.getByRole('button', { name: 'Create code' }).click()
    await page.getByRole('button', { name: 'Copy the link to install the app' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`^${backend.url}/\\?pair=[\\w-]+$`))
    await page.getByRole('button', { name: 'Copy the link to use it in the browser' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`^${backend.url}/\\?browser=1#pair=[\\w-]+$`))
    const safari = await (await newPhone(true)).newPage()
    await safari.goto(await page.evaluate(() => navigator.clipboard.readText()))
    await safari.getByRole('button', { name: 'Not now' }).click()
    await home(safari).waitFor()
  })

  it('the app link asks for a palette in Safari and carries it, with the code, into the installed app, which pairs by itself', async () => {
    const { code } = await createPairingCode(backend.stateDir, 'iphone')
    const safari = await (await newPhone(true)).newPage()
    await safari.goto(`${backend.url}/?pair=${code}`)
    await safari.getByRole('heading', { name: 'Install AtHome' }).waitFor()
    await safari.getByText('Choose Add to Home Screen.').waitFor()
    await safari.getByRole('radio', { name: /^Notte/ }).click()
    expect(await safari.evaluate(() => document.documentElement.style.getPropertyValue('--background'))).toBe('#0f1419')
    expect(await safari.getByRole('radio', { name: /^Notte/ }).getAttribute('aria-checked')).toBe('true')
    expect(safari.url()).toContain(`pair=${code}`)
    expect(safari.url()).toContain('palette=preset-night')
    expect(await safari.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('/icon-180.png?accent=4c9aff')
    const manifestHref = await safari.locator('link[rel="manifest"]').getAttribute('href')
    const manifest = await (await safari.request.get(`${backend.url}${manifestHref}`)).json()
    expect(manifest.start_url).toContain(`pair=${code}`)
    expect(manifest.start_url).toContain('palette=preset-night')

    // The installed app opens at that start address, with storage of its own.
    const installed = await newPhone(true)
    await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
    const app = await installed.newPage()
    await app.goto(`${backend.url}${manifest.start_url}`)
    await app.getByRole('button', { name: 'Not now' }).click()
    await home(app).waitFor()
    expect(app.url()).toBe(`${backend.url}/`)
    expect(await app.evaluate(() => document.documentElement.style.getPropertyValue('--background'))).toBe('#0f1419')
    await button(app, 'Settings').click()
    await app.getByRole('button', { name: /^Colour palette/ }).filter({ hasText: 'Notte' }).waitFor()

    // The code is spent: the setup page says so.
    await safari.goto(`${backend.url}/?pair=${code}`)
    await safari.getByText('This code was used or has expired').waitFor()
  })

  it('a new session with a name, from the folder menu: the chat opens with that name', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Actions for the folder project').click()
    await page.getByRole('dialog').getByRole('button', { name: 'New session with a name…' }).click()
    await page.getByLabel('Session name').fill('Login review')
    await page.getByRole('button', { name: 'Create' }).click()
    // A new backend: the folder is not trusted yet, the trust question comes first.
    const trust = page.getByRole('button', { name: 'Yes, I trust it' })
    await trust.or(composer(page)).first().waitFor()
    if (await trust.isVisible()) await trust.click()
    await composer(page).waitFor()
    expect(await page.locator('.chat-screen .chat-title').textContent()).toBe('Login review')
  })

  it('a message from another session shows in the chat with its sender, before the answer to it', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'peer')
    const peer = page.locator('.msg-peer')
    await peer.waitFor()
    expect(await peer.locator('.from').textContent()).toBe('From @other-session')
    expect(await peer.locator('strong').textContent()).toBe('main')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('Thanks, merging')
    const order = await page.locator('.msg-peer, .msg-ai').evaluateAll((elements) => elements.map((element) => element.className))
    expect(order.slice(-2)).toEqual(['msg-peer', 'msg-ai'])
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

  it('the permission mode sheet and the photo picker of the composer work; + is first, the brain (model and effort) follows the mode button, the top bar is one row', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    const box = async (name: string | RegExp) => (await button(page, name).boundingBox())!
    const plus = await box('Attach photos or files')
    const modeBtn = await box('Permission mode: Ask for permissions')
    const brain = await box(/^Model: /)
    expect(plus.x).toBeLessThan(modeBtn.x)
    expect(brain.x).toBeGreaterThan(modeBtn.x)
    expect(Math.abs(brain.y - modeBtn.y)).toBeLessThan(2)
    expect(await page.locator('.composer .input-tools .mode-btn + .model-tool').count()).toBe(1)
    // The top bar is one row: back, title, rewind and ⋯ on the same line, with no model button.
    const title = (await page.locator('.chat-title').boundingBox())!
    const back = await box('Back')
    const rewind = await box('Go back to one of your messages')
    const more = await box('More actions')
    const bar = (await page.locator('.chat-screen .topbar').boundingBox())!
    expect(bar.height).toBeLessThan(60)
    const mid = bar.y + bar.height / 2
    for (const item of [back, title, rewind, more]) expect(Math.abs(item.y + item.height / 2 - mid)).toBeLessThan(4)
    expect(title.x).toBeGreaterThan(back.x + back.width - 1)
    expect(title.x + title.width).toBeLessThanOrEqual(rewind.x + 1)
    expect(await page.locator('.topbar .model-btn').count()).toBe(0)
    // The title is the chat's name only (no folder), plain text: tapping it opens nothing.
    expect(await page.locator('.chat-title').textContent()).not.toContain(' / ')
    expect(await page.locator('.chat-title').evaluate((el) => el.closest('button') === null)).toBe(true)
    await page.locator('.chat-title').click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    // The brain opens the sheet with the models and, under them, the effort; the mode sheet has no effort.
    await button(page, /^Model: /).click()
    const modelSheet = page.getByRole('dialog', { name: 'Model and effort' })
    await modelSheet.getByText('Haiku').waitFor()
    const effort = modelSheet.getByRole('radiogroup', { name: 'Effort' })
    await effort.getByRole('radio', { name: 'High', exact: true }).click()
    await expect.poll(() => effort.getByRole('radio', { name: 'High', exact: true }).isChecked()).toBe(true)
    await page.keyboard.press('Escape')
    // The ⋯ menu has one "Model and effort" item (model · effort on its right).
    await button(page, 'More actions').click()
    const menu = page.getByRole('dialog').last()
    expect(await menu.getByRole('button', { name: /^Model and effort/ }).count()).toBe(1)
    expect(await menu.getByRole('button', { name: /^Effort/ }).count()).toBe(0)
    expect(await menu.getByRole('button', { name: /^Model and effort/ }).textContent()).toContain('high')
    await page.keyboard.press('Escape')
    await button(page, /^Permission mode/).click()
    const modeSheet = page.getByRole('dialog', { name: 'Permission mode' })
    expect(await modeSheet.getByRole('radiogroup', { name: 'Effort' }).count()).toBe(0)
    await modeSheet.getByRole('radio', { name: 'Plan' }).click()
    await page.keyboard.press('Escape')
    await button(page, 'Permission mode: Plan').waitFor()
    await page.locator('.composer input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG })
    await page.getByRole('img', { name: 'Image 1' }).waitFor()
    await send(page, 'look')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: look [1 images]')
  })

  it('a sheet closes when its content is dragged down from the top; a short drag or a scroll leaves it open', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    const cdp = await page.context().newCDPSession(page)
    // A real touch drag (scrolls natively, unlike synthetic events): from (x, y) down by dy in small steps.
    const drag = async (x: number, y: number, dy: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * step) / 10 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const dialog = page.getByRole('dialog')
    await button(page, 'More actions').click()
    await dialog.waitFor()
    const item = (await dialog.getByRole('button').nth(1).boundingBox())!
    await drag(item.x + 20, item.y + item.height / 2, 40)
    await page.waitForTimeout(400)
    expect(await dialog.count()).toBe(1)
    // A drag up scrolls the content, it never closes the sheet.
    await drag(item.x + 20, item.y + item.height / 2, -150)
    await page.waitForTimeout(400)
    expect(await dialog.count()).toBe(1)
    await page.evaluate(() => document.querySelector('.sheet')!.scrollTo(0, 0))
    await drag(item.x + 20, item.y + item.height / 2, 200)
    await dialog.waitFor({ state: 'detached' })
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

  it('"Cancel send" beside a waiting message: the bubble goes and its text comes back into the composer, after the draft', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await send(page, 'oops wrong chat')
    await page.locator('.msg-user', { hasText: 'oops wrong chat' }).waitFor()
    await composer(page).fill('draft')
    await page.getByRole('button', { name: 'Cancel send', exact: true }).click()
    await page.locator('.msg-user', { hasText: 'oops wrong chat' }).waitFor({ state: 'detached' })
    await expect.poll(() => composer(page).inputValue()).toBe('draft oops wrong chat')
    // Nothing was read: the slow turn goes on alone and ends without an echo of the withdrawn message.
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).not.toContain('oops')
  })

  it('the ghost of a message with images shows the first one as a thumbnail and +N for the others (no emoji)', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    const file = page.locator('.composer input[type=file]')
    await file.setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByRole('img', { name: 'Image 2' }).waitFor()
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    const conversation = page.locator('.conversation')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 300))
    const ghost = page.locator('.ghost')
    await ghost.locator('img.ghost-thumb').waitFor()
    expect(await ghost.locator('.ghost-more').textContent()).toBe('+1')
    expect(await ghost.textContent()).not.toContain('🖼')
    expect(await ghost.locator('.clamp-2').textContent()).toBe('slow')
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

  it('the working line ends the text and scrolls with it; once scrolled out of view a mini label (dot and time) shows on the left of the jump button, and goes when the line is back or the turn ends', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    const conversation = page.locator('.conversation')
    const line = conversation.locator('.working-line')
    const mini = page.locator('.working-mini')
    await line.waitFor()
    await expect.poll(() => conversation.evaluate((box) => box.scrollHeight - box.clientHeight), { timeout: 20_000 }).toBeGreaterThan(450)
    // Following: the line is the last thing in the text, in view, and there is no label.
    expect(await conversation.evaluate((box) => box.lastElementChild!.classList.contains('working-line'))).toBe(true)
    expect(await mini.count()).toBe(0)
    // Scrolling up by hand: the line goes with the text, below the visible area, and the label takes over.
    const area = (await conversation.boundingBox())!
    await page.mouse.move(area.x + area.width / 2, area.y + 100)
    await page.mouse.wheel(0, -300)
    await mini.waitFor()
    expect((await line.boundingBox())!.y).toBeGreaterThan(area.y + area.height - 90)
    expect(await mini.getAttribute('aria-label')).toContain('Claude is working')
    expect(await mini.textContent()).toMatch(/^\s*\d+ (s|min|h)/)
    // A tab resting on the input box's top border (which stays visible), flush with its left edge, once it slid out.
    await page.waitForTimeout(400)
    const label = (await mini.boundingBox())!
    const box = (await page.locator('.input-box').boundingBox())!
    expect(Math.abs(label.y + label.height - box.y)).toBeLessThan(1)
    expect(Math.abs(label.x - box.x)).toBeLessThan(1)
    // The box's top left corner is square while the tab shows: the tab's left side runs on into the box's edge.
    expect(await page.locator('.input-box').evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe('0px')
    const jump = (await page.locator('.jump').boundingBox())!
    expect(label.x + label.width).toBeLessThan(jump.x)
    // Back at the bottom: the line is in view again and the label goes.
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight))
    await mini.waitFor({ state: 'detached' })
    // The turn ends: both are gone.
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 600))
    await mini.waitFor()
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    await line.waitFor({ state: 'detached' })
    await mini.waitFor({ state: 'detached' })
  })

  it('scrolling down to the end of the chat is never moved by the app (the native bounce is not cut short)', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    const conversation = page.locator('.conversation')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 600))
    await page.waitForTimeout(300)
    // From now on every scrollTop the app sets is counted; the wheel scrolls natively.
    await conversation.evaluate((box) => {
      const native = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
      const counted = box as HTMLElement & { writes?: number }
      counted.writes = 0
      Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => native.get!.call(box), set: (value: number) => ((counted.writes! += 1), native.set!.call(box, value)) })
    })
    const area = (await conversation.boundingBox())!
    await page.mouse.move(area.x + area.width / 2, area.y + 100)
    for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 120)
    await page.waitForTimeout(400)
    expect(await conversation.evaluate((box) => box.scrollHeight - box.scrollTop - box.clientHeight)).toBeLessThan(2)
    expect(await conversation.evaluate((box) => (box as HTMLElement & { writes?: number }).writes)).toBe(0)
  })

  // A real touch gesture over CDP: from (x, y) through the given offsets, one move each, without lifting.
  const touchStart = (cdp: CDPSession, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  const touchMove = (cdp: CDPSession, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  const touchEnd = (cdp: CDPSession) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  it('a vertical drag from the left edge scrolls the chat and never moves the screen; a horizontal edge swipe still goes back', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    const conversation = page.locator('.conversation')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 100))
    await page.waitForTimeout(300)
    const before = await conversation.evaluate((box) => box.scrollTop)
    const cdp = await page.context().newCDPSession(page)
    const area = (await conversation.boundingBox())!
    const y = area.y + area.height / 2
    await touchStart(cdp, 10, y)
    const seen: string[] = []
    for (let step = 1; step <= 10; step++) {
      // Down by 12 px a step, a few px of sideways drift.
      await touchMove(cdp, 10 + (step % 3), y + step * 12)
      seen.push(await page.evaluate(() => { const screen = document.querySelector<HTMLElement>('.chat-screen')!; return `${screen.style.transform}|${screen.classList.contains('dragging')}` }))
    }
    await touchEnd(cdp)
    expect(seen.every((value) => value === '|false')).toBe(true)
    await page.waitForTimeout(300)
    expect(await conversation.evaluate((box) => box.scrollTop)).not.toBe(before)
    // A horizontal swipe from the same edge goes back.
    await touchStart(cdp, 10, y)
    for (let step = 1; step <= 10; step++) await touchMove(cdp, 10 + step * 25, y + step)
    await touchEnd(cdp)
    await page.locator('.chat-screen').waitFor({ state: 'detached' })
  })

  it('the scroll indicator can be grabbed while it shows: dragging it scrolls in proportion, it grows while held; hidden, the right edge scrolls as usual', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    const conversation = page.locator('.conversation')
    const thumb = page.locator('.scroll-thumb')
    const cdp = await page.context().newCDPSession(page)
    const area = (await conversation.boundingBox())!
    // Hidden thumb: a drag on the right edge scrolls the text natively, nothing grabs.
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 600))
    await page.waitForTimeout(1500)
    expect(await thumb.evaluate((element) => element.classList.contains('on'))).toBe(false)
    const rest = await conversation.evaluate((box) => box.scrollTop)
    const edge = area.x + area.width - 10
    await touchStart(cdp, edge, area.y + area.height / 2)
    for (let step = 1; step <= 10; step++) await touchMove(cdp, edge, area.y + area.height / 2 + step * 10)
    expect(await thumb.evaluate((element) => element.classList.contains('grabbed'))).toBe(false)
    await touchEnd(cdp)
    await page.waitForTimeout(1500)
    const scrolled = await conversation.evaluate((box) => box.scrollTop)
    expect(rest - scrolled).toBeGreaterThan(50)
    expect(rest - scrolled).toBeLessThan(150)
    // Visible thumb: grab it and drag up by 60 px, the conversation follows in proportion.
    await conversation.evaluate((box) => (box.scrollTop -= 1))
    await expect.poll(() => thumb.evaluate((element) => element.classList.contains('on'))).toBe(true)
    const rect = (await thumb.boundingBox())!
    const m = await conversation.evaluate((box) => ({ range: box.scrollHeight - box.clientHeight, top: box.scrollTop, dock: document.querySelector<HTMLElement>('.dock')!.offsetHeight, height: box.clientHeight }))
    const room = m.height - m.dock - 6 - rect.height
    const x = rect.x + 1
    const y = rect.y + rect.height / 2
    await touchStart(cdp, x, y)
    for (let step = 1; step <= 10; step++) await touchMove(cdp, x - (step % 3), y - step * 6)
    expect(await thumb.evaluate((element) => element.classList.contains('grabbed'))).toBe(true)
    expect(await thumb.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(5)
    // Held past the usual fade: still visible.
    await page.waitForTimeout(1200)
    expect(await thumb.evaluate((element) => element.classList.contains('on'))).toBe(true)
    const now = await conversation.evaluate((box) => box.scrollTop)
    const expected = (60 / room) * m.range
    expect(m.top - now).toBeGreaterThan(expected * 0.85)
    expect(m.top - now).toBeLessThan(expected * 1.15)
    await touchEnd(cdp)
    await expect.poll(() => thumb.evaluate((element) => element.classList.contains('grabbed'))).toBe(false)
    await expect.poll(() => thumb.evaluate((element) => element.classList.contains('on')), { timeout: 3000 }).toBe(false)
  })

  it('a fast drag on the chat with the keyboard open writes no scrollTop and keeps the field until the finger lifts', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toContain('word399')
    await page.locator('.working-line').waitFor({ state: 'detached' })
    const conversation = page.locator('.conversation')
    await conversation.evaluate((box) => (box.scrollTop = box.scrollHeight - box.clientHeight - 100))
    await composer(page).click()
    await page.evaluate(() => document.querySelector('.device')!.classList.add('kb-open'))
    // With the keyboard open the veil ends in the plain page colour, opaque, at the box's bottom edge.
    const veil = await page.locator('.input-box').evaluate((element) => [getComputedStyle(element, '::before').backgroundImage, getComputedStyle(document.body).backgroundColor])
    expect(veil[0]).toContain(`${veil[1]} calc(100% - 120px)`)
    await conversation.evaluate((box) => {
      const native = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
      const counted = box as HTMLElement & { writes?: number }
      counted.writes = 0
      Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => native.get!.call(box), set: (value: number) => ((counted.writes! += 1), native.set!.call(box, value)) })
    })
    const cdp = await page.context().newCDPSession(page)
    const area = (await conversation.boundingBox())!
    await touchStart(cdp, area.x + 100, area.y + area.height / 2)
    // Fast: 40 px every few ms. The dock resizes under the finger (as when the keyboard goes away).
    for (let step = 1; step <= 5; step++) {
      await touchMove(cdp, area.x + 100, area.y + area.height / 2 - step * 40)
      await page.waitForTimeout(10)
    }
    await page.evaluate(() => { document.querySelector<HTMLElement>('.dock')!.style.paddingTop = '30px' })
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
    expect(await conversation.evaluate((box) => (box as HTMLElement & { writes?: number }).writes)).toBe(0)
    await touchEnd(cdp)
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA')
  })

  it('a drag on a short message in the field is blocked, unless text is selected (the selection handles move)', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await composer(page).fill('short text')
    // A cancelable touchmove on the field, as iOS sends for a selection handle: was it blocked?
    const blocked = () =>
      composer(page).evaluate((field) => {
        const touch = new Touch({ identifier: 1, target: field, clientX: 20, clientY: 20 })
        const event = new TouchEvent('touchmove', { touches: [touch], bubbles: true, cancelable: true })
        field.dispatchEvent(event)
        return event.defaultPrevented
      })
    expect(await blocked()).toBe(true)
    await composer(page).evaluate((field: HTMLTextAreaElement) => (field.focus(), field.setSelectionRange(0, 5)))
    expect(await blocked()).toBe(false)
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

  it('the queue: the queue button puts what I wrote in the queue at once; Stop pauses the queue; ▶ sends the next message', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    // Nothing written: nothing to queue.
    expect(await button(page, /^Add to the queue/).isDisabled()).toBe(true)
    await composer(page).fill('queued one')
    await button(page, /^Add to the queue \(empty\)/).click()
    await page.getByRole('button', { name: /^Queue: 1 waiting\. Next: queued one/ }).waitFor()
    // The field is empty again and Send still sends (no queue mode).
    expect(await composer(page).inputValue()).toBe('')
    await button(page, /^Add to the queue \(1 queued\)/).waitFor()
    expect(await page.locator('.composer.queue-mode').count()).toBe(0)
    await button(page, 'Send').waitFor()
    await button(page, 'Stop: stop Claude').click()
    const resume = page.getByRole('button', { name: 'Queue paused: Resume' })
    await resume.waitFor()
    await page.locator('.working-line').waitFor({ state: 'detached' })
    expect(await page.locator('.msg-user').filter({ hasText: 'queued one' }).count()).toBe(0)
    await resume.click()
    // The chat is on screen: the message counts down in the composer before it goes.
    await page.getByRole('status').filter({ hasText: /From the queue: goes in \d+ s/ }).waitFor()
    await expect.poll(() => lastAnswer(page).textContent(), { timeout: 20_000 }).toBe('Echo: queued one')
    await page.locator('.queue-tray').waitFor({ state: 'detached' })
  })

  it('the bin on the queue card removes the next queued message', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await composer(page).fill('first queued')
    await button(page, /^Add to the queue/).click()
    await composer(page).fill('second queued')
    await button(page, /^Add to the queue/).click()
    await page.getByRole('button', { name: /^Queue: 2 waiting\. Next: first queued/ }).waitFor()
    await button(page, 'Remove the next message: first queued').click()
    await page.getByRole('button', { name: /^Queue: 1 waiting\. Next: second queued/ }).waitFor()
    await button(page, 'Remove the next message: second queued').click()
    await page.locator('.queue-tray').waitFor({ state: 'detached' })
  })

  it('the next queued message counts down in the composer while the chat is on screen; Stop brings it back into the field', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'slow')
    await page.locator('.working-line').waitFor()
    await composer(page).fill('wait for me')
    await button(page, /^Add to the queue/).click()
    await composer(page).fill('after me')
    await button(page, /^Add to the queue/).click()
    await button(page, 'Stop: stop Claude').click()
    await button(page, 'Queue paused: Resume').click()
    const countdown = page.getByRole('status').filter({ hasText: 'wait for me' })
    await countdown.waitFor()
    // The message counting down has left the queue: the stack shows only the one after it.
    await page.getByRole('button', { name: /^Queue: 1 waiting\. Next: after me/ }).waitFor()
    expect(await page.locator('.queue-tray').textContent()).not.toContain('wait for me')
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
    // The bar stays as wide as the screen and Send stays on it.
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
    // Notes of the folder from its sessions screen: no chat, so no "Use in the message".
    await button(page, 'Folder notes').click()
    await button(page, 'New note').click()
    await page.keyboard.type('Folder note without a chat')
    await page.getByText(/^Saved · /).waitFor()
    expect(await button(page, 'Use in the message').count()).toBe(0)
    await button(page, 'Notes').click()
    await page.getByRole('button', { name: /^Folder note without a chat/ }).waitFor()
    expect(await button(page, 'Use in the message').count()).toBe(0)
    await button(page, 'Back').click()
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

  it('new sessions in Settings: the effort and permission mode chosen there are those of the next session', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Settings').click()
    const effort = page.getByRole('radiogroup', { name: 'Effort' })
    expect(await effort.getByRole('radio', { name: 'Model’s own' }).isChecked()).toBe(true)
    await effort.getByRole('radio', { name: 'High', exact: true }).click()
    await page.getByText('New sessions: effort High').waitFor()
    await button(page, /^Permission mode/).click()
    await page.getByRole('dialog', { name: 'Permission mode' }).getByRole('radio', { name: 'Plan' }).click()
    await page.getByText('New sessions: Plan').waitFor()
    await page.reload()
    await button(page, 'Settings').click()
    expect(await page.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio', { name: 'High', exact: true }).isChecked()).toBe(true)
    await button(page, 'Back').click()
    await openProject(page)
    await button(page, 'Permission mode: Plan').waitFor()
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
    // Menus are popovers by their button: below one at the top, above the composer's (the model's too).
    await button(page, 'More actions').click()
    const menu = page.locator('.sheet.popover')
    const more = (await button(page, 'More actions').boundingBox())!
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(more.y + more.height)
    await page.keyboard.press('Escape')
    await page.locator('.model-tool').click()
    await page.getByRole('dialog', { name: 'Model and effort' }).getByText('Haiku').waitFor()
    const model = (await page.locator('.model-tool').boundingBox())!
    expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(model.y)
    await page.keyboard.press('Escape')
    await page.locator('.mode-btn').click()
    await page.getByRole('dialog', { name: 'Permission mode' }).waitFor()
    const modeButton = (await page.locator('.mode-btn').boundingBox())!
    const popover = (await menu.boundingBox())!
    expect(popover.y + popover.height).toBeLessThanOrEqual(modeButton.y)
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
    await page.locator('.model-tool').click()
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

  it('a new device starts with the default palette; the presets, light and dark, replace the theme switch; the one picked stays after a reload', async () => {
    const page = await pairedPage(await newPhone(), backend)
    const background = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--background'))
    await expect.poll(background).toBe('#faf9f7')
    await button(page, 'Settings').click()
    expect(await page.getByRole('radio', { name: 'Dark' }).count()).toBe(0)
    await page.getByRole('button', { name: /^Colour palette/ }).filter({ hasText: 'AtHome chiaro' }).click()
    expect(await page.getByRole('radio', { name: /^AtHome chiaro/ }).getAttribute('aria-checked')).toBe('true')
    expect(await page.getByRole('radio').count()).toBeGreaterThanOrEqual(15)
    await page.getByRole('radio', { name: /^Notte/ }).click()
    expect(await background()).toBe('#0f1419')
    await page.reload()
    await home(page).waitFor()
    expect(await background()).toBe('#0f1419')
  })

  it('a colour palette made in Settings colours the app while I edit it, stays on after a reload, is offered to another device and is changed again', async () => {
    const page = await pairedPage(await newPhone(), backend)
    const background = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--background'))
    await button(page, 'Settings').click()
    await page.getByRole('button', { name: /^Colour palette/ }).click()
    await page.getByRole('button', { name: 'New palette' }).click()
    await page.getByLabel('Palette name').fill('Night')
    await page.getByLabel('Background, hex code').fill('#101418')
    expect(await background()).toBe('#101418')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('radio', { name: /^Night/ }).waitFor()
    expect(await page.getByRole('radio', { name: /^Night/ }).getAttribute('aria-checked')).toBe('true')
    await page.reload()
    await home(page).waitFor()
    expect(await background()).toBe('#101418')

    const other = await pairedPage(await newPhone(), backend)
    await button(other, 'Settings').click()
    await other.getByRole('button', { name: /^Colour palette/ }).click()
    await other.getByRole('radio', { name: /^Night/ }).waitFor()
    expect(await other.evaluate(() => document.documentElement.style.getPropertyValue('--background'))).toBe('#faf9f7')

    await button(page, 'Settings').click()
    await page.getByRole('button', { name: /^Colour palette/ }).click()
    await page.getByRole('radio', { name: /^AtHome chiaro/ }).click()
    expect(await background()).toBe('#faf9f7')
  })

  it('a code block in an answer has a copy button: it copies the code and shows a tick for a moment', async () => {
    const context = await newPhone()
    const page = await pairedPage(context, backend)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: backend.url })
    await openProject(page)
    await composer(page).fill('run this\n```\nls -la /srv\n```')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const block = page.locator('.msg-ai .code-block').last()
    await block.waitFor()
    await block.getByRole('button', { name: 'Copy the code' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('ls -la /srv\n')
    await block.getByRole('button', { name: 'Code copied' }).waitFor()
    await block.getByRole('button', { name: 'Copy the code' }).waitFor()
  })

  it("on a phone the page behind the app (seen through iOS's keyboard tool bar) has the app's own colour, not the frame's", async () => {
    const page = await pairedPage(await newPhone(), backend)
    const colours = () => page.evaluate(() => [document.documentElement, document.body, document.querySelector('.device')!].map((element) => getComputedStyle(element).backgroundColor))
    const [html, body, device] = await colours()
    expect(html).toBe(device)
    expect(body).toBe(device)
  })

  it('with a palette on, the Home screen icon and the manifest take its accent; "Icon in this colour" copies a link that gives them to a browser not paired', async () => {
    const context = await newPhone()
    const page = await pairedPage(context, backend)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: backend.url })
    const href = (target: typeof page, rel: string) => target.locator(`link[rel="${rel}"]`).getAttribute('href')
    await expect.poll(() => href(page, 'apple-touch-icon')).toBe('/icon-180.png?accent=c96442')
    await button(page, 'Settings').click()
    await page.getByRole('button', { name: /^Colour palette/ }).click()
    await page.getByRole('button', { name: 'New palette' }).click()
    await page.getByLabel('Palette name').fill('Teal')
    await page.getByLabel('Accent, hex code').fill('#0f766e')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('radio', { name: /^Teal/ }).waitFor()
    expect(await href(page, 'apple-touch-icon')).toBe('/icon-180.png?accent=0f766e')
    expect(await href(page, 'icon')).toBe('/icon-192.png?accent=0f766e')
    expect(await href(page, 'manifest')).toBe('/manifest.webmanifest?accent=0f766e')

    await page.getByRole('button', { name: 'Icon in this colour' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${backend.url}/?accent=0f766e`)
    const browser = await (await newPhone()).newPage()
    await browser.goto(`${backend.url}/?accent=0f766e`)
    await expect.poll(() => href(browser, 'apple-touch-icon')).toBe('/icon-180.png?accent=0f766e')
    const icon = await browser.request.get(`${backend.url}/icon-180.png?accent=0f766e`)
    expect(icon.headers()['content-type']).toBe('image/png')
    const manifest = await (await browser.request.get(`${backend.url}/manifest.webmanifest?accent=0f766e`)).json()
    expect(manifest.theme_color).toBe('#0f766e')

    await page.getByRole('radio', { name: /^AtHome chiaro/ }).click()
    expect(await href(page, 'apple-touch-icon')).toBe('/icon-180.png?accent=c96442')
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

  it('a terminal from the session menu: I type and the shell answers, the key bar sends ↑, the Home lists it, I close it', async () => {
    const page = await pairedPage(await newPhone(), backend)
    const refused: string[] = []
    page.on('console', (message) => message.text().includes('Content Security Policy') && refused.push(message.text()))
    await openProject(page)
    await button(page, 'More actions').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Terminal', exact: true }).click()
    const terminal = page.getByRole('region', { name: 'Terminal' })
    const rows = terminal.locator('.xterm-rows')
    await rows.waitFor()
    await terminal.locator('.xterm').click()
    await page.keyboard.type('echo cw-"mark"er')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows.textContent(), { timeout: 10_000 }).toContain('cw-marker')
    // Only xterm's own scrollbar: the viewport's native one (iOS's indicator) is hidden.
    expect(await terminal.locator('.xterm-viewport').evaluate((element) => [getComputedStyle(element).scrollbarWidth, getComputedStyle(element, '::-webkit-scrollbar').display])).toEqual(['none', 'none'])
    // The terminal takes the app's colours, under the app's CSP (no inline styles).
    expect(refused).toEqual([])
    expect(await terminal.locator('.xterm-rows').evaluate((element) => getComputedStyle(element).color)).toBe(await page.evaluate(() => getComputedStyle(document.querySelector('.screen')!).color))
    // The key bar: ↑ brings the last command back, Enter runs it again.
    await terminal.getByRole('button', { name: 'Up' }).click()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await rows.textContent())!.split('cw-marker').length - 1, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    // Leaving asks whether to close it: kept open, back to the session menu it came from (closed), then the Home: the
    // Sessioni view lists it; it opens again with its screen.
    await button(page, 'Back').click()
    await page.getByRole('dialog', { name: 'Close the terminal?' }).getByRole('button', { name: 'Keep it open' }).click()
    await page.getByRole('dialog', { name: 'project' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await button(page, 'Back').click()
    await button(page, 'Show sessions').click()
    await page.getByRole('button', { name: /^project/ }).filter({ hasText: 'Terminal' }).click()
    await expect.poll(() => page.getByRole('region', { name: 'Terminal' }).locator('.xterm-rows').textContent(), { timeout: 10_000 }).toContain('cw-marker')
    await button(page, 'Terminal actions').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close terminal' }).click()
    await page.getByRole('region', { name: 'Terminal' }).waitFor({ state: 'detached' })
    expect(await page.getByRole('button', { name: /^project/ }).filter({ hasText: 'Terminal' }).count()).toBe(0)
  })

  it('a terminal on the phone: "Copy all" puts its output on the clipboard, "Paste" types the clipboard, a link opens', async () => {
    const context = await newPhone()
    const page = await pairedPage(context, backend)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: backend.url })
    await button(page, 'Actions for the folder project').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Terminal here' }).click()
    const terminal = page.getByRole('region', { name: 'Terminal' })
    const rows = terminal.locator('.xterm-rows')
    await rows.waitFor()
    await terminal.locator('.xterm').click()
    await page.keyboard.type('echo cw-"mark"er http://example.test/"pa"th')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows.textContent(), { timeout: 10_000 }).toContain('cw-marker http://example.test/path')
    // Copy all: the whole output, as text.
    await button(page, 'Terminal actions').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Copy all' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('cw-marker http://example.test/path')
    // Paste: the clipboard goes to the shell as a paste (bash waits for Enter before running it).
    await page.evaluate(() => navigator.clipboard.writeText('echo pasted-"o"k'))
    await button(page, 'Terminal actions').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Paste' }).click()
    await expect.poll(() => rows.textContent(), { timeout: 10_000 }).toContain('echo pasted-"o"k')
    await terminal.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect.poll(() => rows.textContent(), { timeout: 10_000 }).toContain('pasted-ok')
    // A link in the output opens outside the app.
    await page.evaluate(() => (window.open = ((url: string) => ((window as unknown as { opened: string }).opened = url, null)) as typeof window.open))
    const row = rows.locator('div').filter({ hasText: /^cw-marker http/ }).first()
    const box = (await row.boundingBox())!
    const cell = box.width / (await page.evaluate(() => document.querySelector('.xterm-rows div')!.textContent!.length || 1))
    await page.mouse.move(box.x + cell * 14, box.y + box.height / 2)
    await page.mouse.click(box.x + cell * 14, box.y + box.height / 2)
    await expect.poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened)).toBe('http://example.test/path')
  })

  it('a terminal in a folder of the Home from its menu; on a wide window the chat opens one in the right panel', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await button(page, 'Actions for the folder project').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Terminal here' }).click()
    await page.getByRole('region', { name: 'Terminal' }).locator('.xterm-rows').waitFor()
    // Kept open on leaving; a second one in the same folder is closed on leaving: the Home lists one.
    await button(page, 'Back').click()
    await page.getByRole('dialog', { name: 'Close the terminal?' }).getByRole('button', { name: 'Keep it open' }).click()
    // Back to the folder's menu it came from.
    await page.getByRole('dialog', { name: 'project' }).getByRole('button', { name: 'Terminal here' }).click()
    await page.getByRole('region', { name: 'Terminal' }).locator('.xterm-rows').waitFor()
    await button(page, 'Back').click()
    await page.getByRole('dialog', { name: 'Close the terminal?' }).getByRole('button', { name: 'Close terminal' }).click()
    await page.getByRole('region', { name: 'Terminal' }).waitFor({ state: 'detached' })
    await page.getByRole('dialog', { name: 'project' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await button(page, 'Show sessions').click()
    const rowsOf = () => page.getByRole('button', { name: /^project/ }).filter({ hasText: 'Terminal' })
    await expect.poll(() => rowsOf().count()).toBe(1)
    // "Close all terminals", confirmed, ends the rest.
    await button(page, 'Close all terminals').click()
    await page.getByRole('dialog', { name: 'Close all terminals?' }).getByRole('button', { name: 'Close all' }).click()
    await expect.poll(() => rowsOf().count()).toBe(0)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    contexts.push(context)
    const wide = await pairedPage(context, backend, 'laptop')
    await openProject(wide)
    await button(wide, 'Folder files').click()
    await wide.locator('.col-right').getByRole('button', { name: 'Terminal', exact: true }).click()
    await wide.locator('.col-right').getByRole('region', { name: 'Terminal' }).locator('.xterm-rows').waitFor()
  })

  it('the notification about several chats opens the open sessions: tapped with the app open or closed', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    // App open: the service worker posts open-tab without a tab.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-tab' } }))))
    await button(page, 'Show projects').waitFor()
    await button(page, 'Show projects').click()
    // App closed: it opens on /#sessions.
    await page.goto(`${backend.url}/#sessions`)
    await page.reload()
    await button(page, 'Show projects').waitFor()
  })

  it('the app comes back from the background with the keyboard closed: no field focused, the full height', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await composer(page).click()
    // The state iOS can leave behind: the field still focused, the app shrunk for a keyboard that is gone, and the
    // visual viewport still reporting the height without the keyboard after the return.
    await page.evaluate(() => {
      const device = document.querySelector<HTMLElement>('.device')!
      device.classList.add('kb-open')
      device.style.setProperty('--app-h', '300px')
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 300 })
    })
    const setVisibility = (state: string) => page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
    await setVisibility('hidden')
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA')
    await setVisibility('visible')
    await expect.poll(() => page.evaluate(() => {
      const device = document.querySelector<HTMLElement>('.device')!
      return { open: device.classList.contains('kb-open'), height: Math.round(device.getBoundingClientRect().height) === window.innerHeight }
    })).toEqual({ open: false, height: true })
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

  it('every splash screen link points to a PNG the server serves, one per iPhone size (no light/dark)', async () => {
    const page = await (await newPhone()).newPage()
    await page.goto(backend.url)
    const links = await page.locator('link[rel=apple-touch-startup-image]').evaluateAll((elements) => elements.map((element) => ({ href: (element as HTMLLinkElement).href, media: (element as HTMLLinkElement).media })))
    expect(links.length).toBeGreaterThanOrEqual(12)
    expect(links.filter((link) => link.media.includes('prefers-color-scheme')).length).toBe(0)
    for (const link of links) {
      const response = await page.request.get(link.href)
      expect(response.status(), link.href).toBe(200)
      expect(response.headers()['content-type']).toBe('image/png')
    }
  })

  it('the launch screen is the iOS launch image\'s flat grey, blank for the first second of connecting, with the page behind it the same grey until connected', async () => {
    const context = await newPhone()
    await (await pairedPage(context, backend)).close()
    let page = await context.newPage()
    // The socket opens but never answers: the app stays connecting.
    await page.routeWebSocket(/.*/, () => {})
    await page.goto(backend.url)
    const splash = page.locator('section.splash')
    await splash.waitFor()
    expect(await splash.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(142, 142, 147)')
    // The page itself is never grey: iOS would keep that colour under the status bar.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).not.toBe('rgb(142, 142, 147)')
    expect(await splash.innerText()).toBe('')
    expect(await page.getByText('AtHome', { exact: true }).count()).toBe(0)
    // The white glyph is there from the first frame, where the iOS launch image has it: 13 × 7 cells of 16/3 points,
    // centred across, its top 68.17 points above the middle of the 390 × 844 screen (launch image: 1170 × 2532, glyph
    // at x 481-689, y 1062-1174 in pixels).
    const glyph = splash.locator('svg.splash-glyph')
    expect(await glyph.getAttribute('aria-hidden')).toBe('true')
    expect(await glyph.evaluate((element) => getComputedStyle(element).fill)).toBe('rgb(255, 255, 255)')
    const box = (await glyph.boundingBox())!
    expect(Math.abs(box.x * 3 - 481)).toBeLessThan(1)
    expect(Math.abs(box.y * 3 - 1062)).toBeLessThan(1)
    expect(Math.abs(box.width * 3 - 208)).toBeLessThan(1)
    expect(Math.abs(box.height * 3 - 112)).toBeLessThan(1)
    expect(await splash.locator('svg.splash-glyph rect').count()).toBe(31)
    await expect.poll(() => splash.innerText(), { timeout: 5000 }).toContain('Connecting to the server')
    // Connected: the page takes the palette's colour back.
    await page.close()
    page = await context.newPage()
    await page.goto(backend.url)
    await home(page).waitFor()
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(142, 142, 147)')
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
