// The shared browser in the PWA, on the fake DevTools endpoint (no Chromium) and the scripted fake SDK. User stories:
// I open the browser from the Home and see the page drawn; I type an address and go; I open a second tab and see both;
// my tap on the page reaches the browser; I see when Claude uses the browser and tap to open that chat.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { createFakeBrowser, type FakeBrowser } from '@athome/core/testing'
import { PROTOCOL_VERSION, createChannelPair } from '@athome/protocol'
import { button, composer, launchChrome, openProject, pairedPage, phone, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let fake: FakeBrowser
let contexts: BrowserContext[] = []

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => {
  fake = createFakeBrowser()
  backend = await startBackend({ browser: fake })
})
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

// The id of the first tab of the backend, read from the workspace snapshot of a throwaway client.
function firstTabId(): Promise<string> {
  const [client, side] = createChannelPair()
  backend.core.attach(side)
  return new Promise((resolve) => {
    client.onMessage((frame) => {
      const { t, snapshot } = frame as { t: string; snapshot?: { kind: string; tabs: { tabId: string }[] } }
      if (t !== 'reset' || snapshot?.kind !== 'workspace' || !snapshot.tabs[0]) return
      client.close()
      resolve(snapshot.tabs[0].tabId)
    })
    client.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: crypto.randomUUID(), visible: false, resume: {} })
  })
}

// A paired phone on the Home, then the browser screen open.
async function openBrowser(): Promise<Page> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await button(page, 'Browser').click()
  await page.locator('canvas.browser-canvas').waitFor()
  return page
}

// Waits until a frame was decoded and drawn into the canvas (some pixel is not transparent).
const waitDrawn = (page: Page) =>
  page.waitForFunction(() => {
    const canvas = document.querySelector('canvas.browser-canvas') as HTMLCanvasElement
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)
  })

const callsOf = (method: string) => fake.cdps.at(-1)!.calls.filter((call) => call.method === method)

describe('Shared browser (fake DevTools)', () => {
  it('opens from the Home, draws the page, navigates and lists the tabs', async () => {
    const page = await openBrowser()
    await waitDrawn(page)
    // No scheme typed: https:// is added.
    await page.getByRole('textbox', { name: 'Address' }).fill('example.com/hello')
    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await expect.poll(() => callsOf('Page.navigate').map((call) => call.params)).toEqual([{ url: 'https://example.com/hello' }])
    await button(page, 'Tabs').click()
    await page.locator('.sheet .row-title', { hasText: 'example.com' }).waitFor()
    await button(page, 'New tab').click()
    await button(page, 'Tabs').click()
    await expect.poll(() => page.locator('.sheet .row').count()).toBe(2)
  })

  it('shows a refused address as text and sends a tap on the page as a touch', async () => {
    const page = await openBrowser()
    await waitDrawn(page)
    await page.getByRole('textbox', { name: 'Address' }).fill('http://')
    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await page.getByRole('alert').getByText('Not a valid web address.').waitFor()
    const box = (await page.locator('canvas.browser-canvas').boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => callsOf('Input.dispatchTouchEvent').map((call) => (call.params as { type: string }).type)).toEqual(expect.arrayContaining(['touchStart', 'touchEnd']))
  })

  it('asks the page to be as large as the canvas, as a mobile page', async () => {
    const page = await openBrowser()
    await expect.poll(() => callsOf('Emulation.setDeviceMetricsOverride').length).toBeGreaterThan(0)
    const box = (await page.locator('canvas.browser-canvas').boundingBox())!
    expect(callsOf('Emulation.setDeviceMetricsOverride').at(-1)!.params).toMatchObject({ width: Math.round(box.width), height: Math.round(box.height), mobile: true })
  })

  it('shows the banner while Claude uses the browser and opens that chat from it', async () => {
    const context = await phone(browser)
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await openProject(page)
    const tabId = await firstTabId()
    // From the chat's menu this time.
    await button(page, 'More actions').click()
    await button(page, 'Browser').click()
    await page.locator('canvas.browser-canvas').waitFor()
    ;(await backend.core.browser())!.startActing(tabId, 'My chat')
    await page.getByRole('button', { name: 'Claude is using the browser — My chat' }).click()
    await composer(page).waitFor()
  })
})
