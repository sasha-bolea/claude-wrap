// Phase 1c, multi-tab desktop on the scripted fake SDK. User stories:
// I work in several folders at once; my tabs come back after a restart; I resume, rename, delete and fork
// sessions; an untrusted folder asks first; a notification brings me to the tab that needs me; a crash of the
// local backend heals by itself.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lastAnswer, launch, makeFolder, nextFolder, openChat, send, tabs, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
})
afterEach(() => ctx.close())

// Opens a new tab in a fresh folder named `name` and returns the folder.
async function openTabIn(name: string): Promise<string> {
  const folder = makeFolder(name)
  await nextFolder(ctx.app, folder)
  await ctx.page.getByRole('button', { name: 'New tab' }).click()
  await openChat(ctx.page, folder)
  return folder
}

describe('desktop multi-tab (fake SDK)', () => {
  it('three sessions stream at the same time in three folders', async () => {
    const { page } = ctx
    for (const name of ['alpha', 'beta', 'gamma']) {
      await openTabIn(name)
      await send(page, 'slow')
    }
    await expect.poll(() => tabs(page).count()).toBe(3)
    await expect.poll(() => page.locator('.tab .badge.working').count()).toBe(3)
    await tabs(page).nth(0).click()
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word10')
    expect(await page.locator('.bar .title').textContent()).toContain('alpha')
  })

  it('tabs come back after a restart, dormant, and can be read and continued', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'hello there')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello there')
    await page.locator('.tab-title').first().dblclick()
    await page.getByRole('textbox', { name: 'New name for the session' }).fill('Kept')
    await page.getByRole('textbox', { name: 'New name for the session' }).press('Enter')
    await expect.poll(() => page.locator('.tab-title').first().textContent()).toBe('Kept')
    await ctx.quit()

    ctx = await launch(ctx.stateDir)
    const reopened = ctx.page
    await expect.poll(() => tabs(reopened).count()).toBe(1)
    expect(await reopened.locator('.tab-title').first().textContent()).toBe('Kept')
    expect(await reopened.locator('.tab .badge').first().getAttribute('class')).toContain('idle')
    await send(reopened, 'again')
    await expect.poll(() => lastAnswer(reopened).textContent()).toBe('Echo: again')
  })

  it('resumes a stored session from the list, renames and deletes another', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'first session')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: first session')
    await page.getByRole('button', { name: 'Close session' }).click()
    await openChat(page, ctx.projectDir)
    await send(page, 'second session')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: second session')
    await page.getByRole('button', { name: 'Close session' }).click()

    await page.getByRole('button', { name: 'Change folder' }).click()
    const entries = page.locator('.session-entry')
    await expect.poll(() => entries.count()).toBe(2)
    const second = entries.filter({ hasText: 'second session' })
    await second.getByRole('button', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'New name for the session' }).fill('Renamed')
    await page.getByRole('textbox', { name: 'New name for the session' }).press('Enter')
    // Filter on the title only: "Rename"+"Delete" would match "Renamed" too.
    const renamed = entries.filter({ has: page.locator('.session-open', { hasText: 'Renamed' }) })
    await expect.poll(() => renamed.count()).toBe(1)
    await renamed.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Confirm delete' }).click()
    await expect.poll(() => entries.count()).toBe(1)

    await entries.first().locator('.session-open').click()
    await page.getByRole('textbox', { name: 'Message to Claude' }).waitFor()
    expect(await page.locator('.item.user').first().textContent()).toBe('first session')
    expect(await lastAnswer(page).textContent()).toBe('Echo: first session')
  })

  it('fork copies the conversation into a new tab next to it', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'to be forked')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: to be forked')
    await page.getByRole('button', { name: 'Fork', exact: true }).click()
    await expect.poll(() => tabs(page).count()).toBe(2)
    await expect.poll(() => page.locator('.tab.active .tab-title').textContent()).toContain('(fork)')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: to be forked')
  })

  it('an untrusted folder shows what it would run; nothing opens until trusted', async () => {
    const { page } = ctx
    const folder = makeFolder('risky')
    mkdirSync(join(folder, '.claude'))
    writeFileSync(join(folder, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'calc.exe' }] }] } }))
    await nextFolder(ctx.app, folder)
    await page.getByRole('button', { name: 'Choose a working folder' }).click()
    const dialog = page.getByRole('region', { name: 'Folder trust' })
    await dialog.waitFor()
    expect(await dialog.textContent()).toContain('SessionStart: calc.exe')
    expect(await page.getByRole('button', { name: 'New session' }).count()).toBe(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await page.getByRole('region', { name: 'Folder trust' }).count()).toBe(0)
  })

  it('a notification brings the window to the tab that needs an answer', async () => {
    const { page, app } = ctx
    await app.evaluate(({ BrowserWindow, Notification }) => {
      const shown: Notification[] = []
      ;(globalThis as { shown?: Notification[] }).shown = shown
      BrowserWindow.prototype.isFocused = () => false
      Notification.prototype.show = function (this: Notification) {
        shown.push(this)
      }
    })
    await openTabIn('needs-me')
    await send(page, 'permission')
    await page.locator('.request-panel').waitFor()
    await openTabIn('elsewhere')
    await expect.poll(() => page.locator('.tab .badge.waiting').count()).toBe(1)
    const bodies = await app.evaluate(() => (globalThis as unknown as { shown: { body: string }[] }).shown.map((n) => n.body))
    expect(bodies).toContain('Claude needs you: Write notes.txt')
    await app.evaluate(() => {
      const shown = (globalThis as unknown as { shown: { body: string; emit(event: string): void }[] }).shown
      shown.find((n) => n.body.startsWith('Claude needs you'))!.emit('click')
    })
    await expect.poll(() => page.locator('.bar .title').textContent()).toContain('needs-me')
    await page.locator('.request-panel').waitFor()
  })

  it('killing the local backend restarts it and the tabs come back', async () => {
    const { page, app } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'before the crash')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: before the crash')
    const killed = await app.evaluate(({ app: electronApp }) => {
      const core = electronApp.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'claude-wrap core')
      if (core) process.kill(core.pid)
      return Boolean(core)
    })
    expect(killed).toBe(true)
    await expect.poll(() => page.getByRole('status').filter({ hasText: 'Connecting' }).count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.getByRole('status').filter({ hasText: 'Connecting' }).count(), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => tabs(page).count()).toBe(1)
    await send(page, 'after the crash')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: after the crash')
  })

  it('tabs move with Ctrl+Shift+arrows and close from their ×', async () => {
    const { page } = ctx
    await openTabIn('one')
    await openTabIn('two')
    await tabs(page).nth(1).focus()
    await page.keyboard.press('Control+Shift+ArrowLeft')
    await expect.poll(() => page.locator('.tab-title').first().textContent()).toBe('two')
    await page.getByRole('button', { name: 'Close two' }).click()
    await expect.poll(() => tabs(page).count()).toBe(1)
  })
})
