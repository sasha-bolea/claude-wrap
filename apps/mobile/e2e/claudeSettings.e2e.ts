// The native Claude Code settings screen (/config) in the PWA on the scripted fake SDK. User stories: from Settings →
// Claude Code I open the screen and see Claude Code's defaults; a switch saves at once into the user settings file;
// I pick the default model in a sheet; I set the reply language and put it back to the default (the key leaves the
// file); turning Dynamic workflows off dims the "ultracode" switch. The core's Claude config folder is a temp folder.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import { launchChrome, pairedPage, phone, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => (backend = await startBackend()))
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

// The user settings file of the temp Claude config folder.
const settingsFile = () => join(backend.claudeDir, 'settings.json')
// Its content (an absent file reads as nothing set).
const saved = (): Record<string, unknown> => (existsSync(settingsFile()) ? JSON.parse(readFileSync(settingsFile(), 'utf8')) : {})

// A paired phone on the Home, then Settings → Claude Code settings; returns the screen.
async function openScreen(): Promise<{ page: Page; screen: Locator }> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Claude Code settings' }).click()
  const screen = page.getByRole('region', { name: 'Claude Code settings' })
  await screen.getByText('Default model').waitFor()
  return { page, screen }
}

describe('PWA Claude Code settings (fake SDK)', () => {
  it('opens from Settings with Claude Code\'s defaults and the file it saves into', async () => {
    const { screen } = await openScreen()
    await screen.getByRole('button', { name: /^Default model/ }).getByText('Claude Code’s default').waitFor()
    for (const name of [/^Thinking/, /^Auto-compact/, /^Auto mode while planning/, /^Dynamic workflows/, /^“ultracode” keyword/]) expect(await screen.getByRole('checkbox', { name }).isChecked()).toBe(true)
    expect(await screen.getByRole('radio', { name: 'Fresh from the main branch' }).isChecked()).toBe(true)
    await screen.getByRole('button', { name: /^Reply language/ }).getByText('Default', { exact: true }).waitFor()
    await screen.getByText(`Saved in ${settingsFile()}.`, { exact: false }).waitFor()
    expect(existsSync(settingsFile())).toBe(false)
  })

  it('Thinking off is saved as alwaysThinkingEnabled: false, and on again removes it', async () => {
    const { screen } = await openScreen()
    const thinking = screen.getByRole('checkbox', { name: /^Thinking/ })
    await thinking.click()
    await expect.poll(() => saved().alwaysThinkingEnabled).toBe(false)
    expect(await thinking.isChecked()).toBe(false)
    await thinking.click()
    await expect.poll(() => 'alwaysThinkingEnabled' in saved()).toBe(false)
    expect(await thinking.isChecked()).toBe(true)
  })

  it('the default model is picked in a sheet: the row shows it and the file has it', async () => {
    const { page, screen } = await openScreen()
    await screen.getByRole('button', { name: /^Default model/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Default model' })
    expect(await sheet.getByRole('radio', { name: 'Claude Code’s default' }).getAttribute('aria-checked')).toBe('true')
    await sheet.getByRole('radio', { name: 'Opus · 1M context' }).click()
    await screen.getByRole('button', { name: /^Default model/ }).getByText('Opus · 1M context').waitFor()
    await expect.poll(() => saved().model).toBe('opus[1m]')
  })

  it('a reply language is saved, and Back to default removes the key', async () => {
    const { page, screen } = await openScreen()
    await screen.getByRole('button', { name: /^Reply language/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Reply language' })
    await sheet.getByRole('textbox').fill('Italian')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await screen.getByRole('button', { name: /^Reply language/ }).getByText('Italian', { exact: true }).waitFor()
    await expect.poll(() => saved().language).toBe('Italian')
    await screen.getByRole('button', { name: /^Reply language/ }).click()
    expect(await page.getByRole('dialog', { name: 'Reply language' }).getByRole('textbox').inputValue()).toBe('Italian')
    await page.getByRole('dialog', { name: 'Reply language' }).getByRole('button', { name: 'Back to default' }).click()
    await screen.getByRole('button', { name: /^Reply language/ }).getByText('Default', { exact: true }).waitFor()
    await expect.poll(() => 'language' in saved()).toBe(false)
  })

  it('Dynamic workflows off dims the ultracode switch; the worktree base is saved', async () => {
    const { screen } = await openScreen()
    const ultracode = screen.getByRole('checkbox', { name: /^“ultracode” keyword/ })
    expect(await ultracode.isEnabled()).toBe(true)
    await screen.getByRole('checkbox', { name: /^Dynamic workflows/ }).click()
    await expect.poll(() => saved().enableWorkflows).toBe(false)
    await expect.poll(() => ultracode.isDisabled()).toBe(true)
    expect(await screen.locator('.row.dim').count()).toBe(1)
    await screen.getByRole('radio', { name: 'Current commit' }).click()
    await expect.poll(() => (saved().worktree as { baseRef?: string } | undefined)?.baseRef).toBe('head')
  })

  it('a broken settings file shows the error and the screen reads it again once fixed', async () => {
    writeFileSync(settingsFile(), '{ nope')
    const context = await phone(browser)
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Claude Code settings' }).click()
    const screen = page.getByRole('region', { name: 'Claude Code settings' })
    await screen.getByRole('alert').waitFor()
    writeFileSync(settingsFile(), '{}')
    await screen.getByRole('button', { name: 'Try again' }).click()
    await screen.getByText('Default model').waitFor()
  })
})
