// A caller's plan (Petra's, through the athome command) in the PWA on the scripted fake SDK. User stories: a caller
// with a key proposes a plan and I see it on top of the Home, in the app's words; I approve it and the caller runs
// its steps, the card follows them, with every command live in its log, and goes away when the plan is done; I reject
// one and nothing runs; I cancel a running one; a plan with a choice, a group and an optional step shows them
// indented, and once a branch is taken the other one is struck through; the caller ends it. The caller speaks to the
// backend's core directly here (the socket and the command have their own tests).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import type { PlanNode } from '@athome/protocol'
import { RawClient } from '@athome/core/testing'
import { home, launchChrome, pairedPage, phone, startBackend, type Backend } from './harness.ts'

const TERMINAL = { deviceId: 'terminal', label: 'terminal', terminal: true }
let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []
let petra: RawClient

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => {
  backend = await startBackend()
  const person = new RawClient(backend.core, 'athome-cli', TERMINAL)
  await person.hello()
  const { key } = await person.ok('callers.create', { name: 'petra', interactive: true })
  petra = new RawClient(backend.core, 'athome-petra', TERMINAL)
  await petra.hello({}, key)
})
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

// A paired phone on the Home.
async function phoneHome(): Promise<Page> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await home(page).waitFor()
  return page
}

const card = (page: Page): Locator => page.getByRole('region', { name: 'Plan from petra' })
const runStep = (planId: string, action: string, args: object) => petra.cmd('actions.run', { action, args, source: 'terminal', plan: planId })

describe('PWA plans (fake SDK)', () => {
  it('a proposal shows on the Home in the app’s words; approved, the caller runs it and the card follows', async () => {
    const page = await phoneHome()
    const { planId } = await petra.ok('plans.propose', { summary: 'Make a test project and open a session in it', steps: [{ action: 'project.create', args: { name: 'idea' } }, { action: 'session.start', args: { folder: { $step: 1, field: 'path' }, prompt: { $free: true } } }] })
    await card(page).getByText('petra proposes a plan').waitFor()
    await card(page).getByText('Make a test project and open a session in it').waitFor()
    await card(page).getByText('Create the project “idea” in the Home').waitFor()
    await card(page).getByText('free text').waitFor()
    await card(page).getByRole('button', { name: 'Approve' }).click()
    await card(page).getByText('petra’s plan · next: step 1').waitFor()
    expect(await runStep(planId, 'project.create', { name: 'other' })).toMatchObject({ ok: false })
    expect(await runStep(planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: true })
    await card(page).getByText('petra’s plan · next: step 2').waitFor()
    // The log, newest first: the step done, then the refused command with core's reason.
    const log = card(page).getByRole('region', { name: 'What it did' }).locator('li')
    await expect.poll(() => log.count()).toBe(2)
    expect(await log.nth(0).textContent()).toMatch(/done.*step 1 · Create the project “idea” in the Home/)
    expect(await log.nth(1).textContent()).toMatch(/refused.*Create the project “other” in the Home.*not the arguments/)
    expect(existsSync(join(backend.root, 'idea'))).toBe(true)
    expect(await runStep(planId, 'session.start', { folder: join(backend.root, 'idea'), prompt: 'ciao' })).toMatchObject({ ok: true })
    await card(page).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /^idea/ }).waitFor()
  })

  it('rejected: the card goes away and nothing runs', async () => {
    const page = await phoneHome()
    const { planId } = await petra.ok('plans.propose', { summary: 'Make a test project', steps: [{ action: 'project.create', args: { name: 'idea' } }] })
    await card(page).getByRole('button', { name: 'Reject' }).click()
    await card(page).waitFor({ state: 'detached' })
    expect(await runStep(planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(existsSync(join(backend.root, 'idea'))).toBe(false)
  })

  it('a running plan can be cancelled from the Home', async () => {
    const page = await phoneHome()
    const { planId } = await petra.ok('plans.propose', { summary: 'Make a test project', steps: [{ action: 'project.create', args: { name: 'idea' } }] })
    await card(page).getByRole('button', { name: 'Approve' }).click()
    await card(page).getByRole('button', { name: 'Cancel the plan' }).click()
    await card(page).waitFor({ state: 'detached' })
    expect(await runStep(planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
  })

  it('a plan with choices: indented in the card; the branch not taken is struck through; the caller ends it', async () => {
    const page = await phoneHome()
    const box = (name: string): PlanNode => ({ action: 'folder.create', args: { parent: backend.root, name } })
    const steps: PlanNode[] = [
      { either: [{ if: 'Claude asks for a folder', steps: [box('asked')] }, { if: 'Claude does not', steps: [box('spare')] }] },
      { repeat: 3, if: 'until it is enough', steps: [box('again')] },
      { ...box('wrap'), optional: true }
    ]
    const { planId } = await petra.ok('plans.propose', { summary: 'Folders, depending on Claude', steps })
    await card(page).getByText('Only one of these ways:').waitFor()
    await card(page).getByText('If Claude asks for a folder:').waitFor()
    await card(page).getByText('Up to 3 times, until it is enough:').waitFor()
    await card(page).getByText('optional', { exact: false }).waitFor()
    await card(page).getByRole('button', { name: 'Approve' }).click()
    await card(page).getByText('petra’s plan · next: step 1 or 2').waitFor()
    expect(await runStep(planId, 'folder.create', { parent: backend.root, name: 'asked' })).toMatchObject({ ok: true })
    await card(page).getByText('petra’s plan · next: step 3 or 4').waitFor()
    await expect.poll(() => card(page).locator('li.plan-out').count()).toBe(1)
    expect(await card(page).locator('li.plan-out').textContent()).toContain('spare')
    expect(await card(page).locator('li.plan-ran').textContent()).toContain('asked')
    await petra.ok('plans.finish', { planId })
    await card(page).waitFor({ state: 'detached' })
  })
})
