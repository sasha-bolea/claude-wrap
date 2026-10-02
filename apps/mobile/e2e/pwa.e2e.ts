// Phase 3b, the PWA on the real server with the scripted fake SDK, in Chrome at iPhone size. User stories:
// I pair the phone with a one-time code; I open a session in a folder of the server and chat; Claude's request
// docks above the composer and I answer it; the same session open on two devices stays in sync and an answer on
// one closes the request on the other; a revoked device goes back to pairing; on iPhone Safari I am told to
// install the app first.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext } from 'playwright-core'
import { composer, lastAnswer, launchChrome, openProject, pairedPage, phone, send, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []

const newPhone = async (ios = false) => {
  const context = await phone(browser, ios)
  contexts.push(context)
  return context
}

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
    await page.getByRole('heading', { name: 'Sessions' }).waitFor()
  })

  it('a wrong code is refused with a clear message', async () => {
    const page = await (await newPhone()).newPage()
    await page.goto(`${backend.url}/#pair=not-a-code`)
    await page.getByRole('button', { name: 'Pair' }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toBe('Unknown or expired code: ask for a new one.')
  })

  it('opens a session in a server folder, chats, and answers a request docked above the composer', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await send(page, 'hello phone')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello phone')
    await send(page, 'permission')
    const request = page.locator('.request-dock').getByRole('region', { name: 'Permission request' })
    await request.waitFor()
    // Never focused by itself: a stray tap on the keyboard cannot grant.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON')
    await request.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')
    // Back to the sessions: the session is listed, idle.
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: /^project / }).waitFor()
  })

  it('the mode selector and the photo picker of the touch row work', async () => {
    const page = await pairedPage(await newPhone(), backend)
    await openProject(page)
    await page.getByRole('button', { name: 'Permission mode: Ask for permissions' }).click()
    await page.getByRole('dialog', { name: 'Permission mode' }).getByRole('menuitemradio', { name: 'Plan' }).click()
    await page.getByRole('button', { name: 'Permission mode: Plan' }).waitFor()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
    await page.getByRole('img', { name: 'Image 1' }).waitFor()
    await send(page, 'look')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: look [1 images]')
  })

  it('two devices on the same session stay in sync; an answer on one closes the request on the other', async () => {
    const first = await pairedPage(await newPhone(), backend, 'phone')
    await openProject(first)
    await send(first, 'permission')
    await first.locator('.request-dock').waitFor()
    const second = await pairedPage(await newPhone(), backend, 'tablet')
    await second.getByRole('button', { name: /^project / }).click()
    expect(await second.locator('.item.user').first().textContent()).toBe('permission')
    await second.locator('.request-dock').getByRole('button', { name: 'Yes', exact: true }).click()
    await first.locator('.request-dock').waitFor({ state: 'detached' })
    await expect.poll(() => lastAnswer(first).textContent()).toBe('Permission: allow')
    await composer(second).waitFor()
  })

  it('a device revoked from another one goes back to pairing', async () => {
    const first = await pairedPage(await newPhone(), backend, 'phone')
    const second = await pairedPage(await newPhone(), backend, 'tablet')
    await first.getByRole('button', { name: 'Settings' }).click()
    const tablet = first.getByRole('listitem').filter({ hasText: 'tablet' })
    await tablet.getByRole('button', { name: 'Revoke' }).click()
    await tablet.getByRole('button', { name: 'Confirm revoke' }).click()
    await second.getByRole('heading', { name: 'Pair this device' }).waitFor()
    await expect.poll(() => second.getByRole('alert').textContent()).toBe('This device was revoked: pair it again.')
  })
})
