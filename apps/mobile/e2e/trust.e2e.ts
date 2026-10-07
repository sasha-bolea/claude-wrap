// A session in a folder that is not trusted yet (a nested git repo does not inherit the trust of the folder above it):
// the folder's Files and Terminal answer needs_trust. User stories: from the chat's ⋯ menu, Files shows a notice instead of
// a raw error; its button opens the trust sheet and, once I trust the folder, the listing appears. Terminal opens the
// trust sheet at once and, once I trust the folder, opens the terminal.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { RawClient } from '../../../packages/core/src/testing/rawClient.ts'
import { button, launchChrome, pairedPage, phone, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []
let raw: RawClient | undefined

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => (backend = await startBackend()))
afterEach(async () => {
  raw?.close()
  raw = undefined
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

// A session in a new untrusted git repo `name` (with one file), created through the protocol (the app itself asks for
// the trust before it creates one); a paired phone with its chat open.
async function untrustedChat(name: string): Promise<Page> {
  const folder = join(backend.root, name)
  mkdirSync(join(folder, '.git'), { recursive: true })
  writeFileSync(join(folder, 'readme.txt'), 'hello')
  raw = new RawClient(backend.core, 'e2e-raw')
  await raw.hello()
  await raw.ok('tab.create', { tabId: crypto.randomUUID(), cwd: folder, title: `Chat of ${name}` })
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await button(page, 'Show sessions').click()
  await page.getByRole('button', { name: new RegExp(`Chat of ${name}`) }).first().click()
  await page.getByRole('button', { name: 'More actions' }).waitFor()
  return page
}

describe('Folder trust in Files and Terminal (fake SDK)', () => {
  it('Files of an untrusted folder: a notice, not a raw error; Decide… → trust sheet → Yes → the listing', async () => {
    const page = await untrustedChat('lonely')
    await button(page, 'More actions').click()
    await button(page, 'Folder files').click()
    const screen = page.getByRole('region', { name: 'Folder files' })
    await screen.getByText('This folder is not trusted yet: its files stay closed until you decide.').waitFor()
    expect(await page.getByText(/folder not trusted/).count()).toBe(0)
    expect(await screen.getByText('readme.txt').count()).toBe(0)
    await screen.getByRole('button', { name: 'Decide…' }).click()
    await page.getByText('Do you trust this folder?').waitFor()
    await button(page, 'Yes, I trust it').click()
    await screen.getByText('readme.txt').waitFor()
    expect(await screen.getByText('This folder is not trusted yet: its files stay closed until you decide.').count()).toBe(0)
  })

  it('Terminal of an untrusted folder: the trust sheet opens, and after Yes the terminal opens', async () => {
    const page = await untrustedChat('second')
    await button(page, 'More actions').click()
    await button(page, 'Terminal').click()
    await page.getByText('Do you trust this folder?').waitFor()
    expect(await page.getByText(/folder not trusted/).count()).toBe(0)
    await button(page, 'Yes, I trust it').click()
    await page.getByRole('region', { name: 'Terminal' }).waitFor()
    await page.locator('.terminal-host').waitFor()
  })
})
