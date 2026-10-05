// Desktop with several sessions on the scripted fake SDK (the open sessions are listed in the Home's left column).
// User stories: I work in several folders at once; my sessions come back after a restart; I resume, rename, delete
// and fork sessions; an untrusted folder asks first; a notification brings me to the session that needs me; a crash of
// the local backend heals by itself.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFolder, button, composer, lastAnswer, launch, makeFolder, nextFolder, openChat, openRows, send, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
})
afterEach(() => ctx.close())

// Opens a new session in a fresh folder named `name` and returns the folder.
async function openIn(name: string): Promise<string> {
  const folder = makeFolder(name)
  await nextFolder(ctx.app, folder)
  await openChat(ctx.page, folder)
  return folder
}

// Renames the open session whose row matches, through its ⋯ menu.
async function renameOpen(row: ReturnType<typeof openRows>, name: string): Promise<void> {
  const { page } = ctx
  await row.getByRole('button', { name: /^Actions for / }).click()
  await page.locator('.sheet').getByRole('button', { name: 'Rename', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'New name' })
  await field.fill(name)
  await field.press('Enter')
}

describe('desktop several sessions (fake SDK)', () => {
  it('three sessions stream at the same time in three folders, all listed as open', async () => {
    const { page } = ctx
    for (const name of ['alpha', 'beta', 'gamma']) {
      await openIn(name)
      await send(page, 'slow')
      await expect.poll(() => lastAnswer(page).textContent()).toContain('word1')
    }
    await expect.poll(() => openRows(page).count()).toBe(3)
    await expect.poll(() => openRows(page).locator('.badge.working').count()).toBe(3)
    await openRows(page).filter({ hasText: 'alpha' }).getByRole('button').first().click()
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word10')
    expect(await page.locator('.col-left .row.current').textContent()).toContain('alpha')
  })

  it('sessions come back after a restart, dormant, and can be read and continued', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'hello there')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello there')
    await renameOpen(openRows(page), 'Kept')
    await expect.poll(() => openRows(page).first().textContent()).toContain('Kept')
    await ctx.quit()

    ctx = await launch(ctx.stateDir)
    const reopened = ctx.page
    await expect.poll(() => openRows(reopened).count()).toBe(1)
    expect(await openRows(reopened).first().textContent()).toContain('Kept')
    expect(await openRows(reopened).first().locator('.badge').getAttribute('class')).not.toMatch(/working|waiting|error/)
    await openRows(reopened).first().getByRole('button').first().click()
    // The fake SDK keeps its stored histories in memory only: the old messages are not listed again after a restart
    // (with the real CLI they come from its JSONL); the session itself continues.
    await send(reopened, 'again')
    await expect.poll(() => lastAnswer(reopened).textContent()).toBe('Echo: again')
  })

  it('resumes a stored session from "Past sessions", renames and deletes another', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'first session')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: first session')
    await button(page, 'More actions').click()
    await page.locator('.sheet').getByRole('button', { name: 'Close session' }).click()
    await openChat(page, ctx.projectDir)
    await send(page, 'second session')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: second session')
    await button(page, 'More actions').click()
    await page.locator('.sheet').getByRole('button', { name: 'Close session' }).click()
    await expect.poll(() => openRows(page).count()).toBe(0)

    // The folder's past sessions (the folder is entered with its row).
    await page.getByRole('button', { name: 'project', exact: true }).click()
    await button(page, 'Past sessions of project').click()
    const past = page.getByRole('region', { name: 'Folder sessions' })
    const second = past.locator('.row').filter({ hasText: 'second session' })
    await expect.poll(() => past.locator('.row').filter({ hasText: /(first|second) session/ }).count()).toBe(2)
    await second.getByRole('button', { name: /^Actions for / }).click()
    await page.locator('.sheet').getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('textbox', { name: 'New name' }).fill('Renamed')
    await page.getByRole('textbox', { name: 'New name' }).press('Enter')
    const renamed = past.locator('.row').filter({ hasText: 'Renamed' })
    await expect.poll(() => renamed.count()).toBe(1)
    // The rename sheet closes onto the session's menu, still open under it: Esc closes that too.
    await page.keyboard.press('Escape')
    await page.locator('.sheet').waitFor({ state: 'detached' })
    await renamed.getByRole('button', { name: /^Actions for / }).click()
    await page.locator('.sheet').getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => past.locator('.row').filter({ hasText: 'Renamed' }).count()).toBe(0)

    await past.locator('.row').filter({ hasText: 'first session' }).getByRole('button').first().click()
    await composer(page).waitFor()
    expect(await page.locator('.msg-user').first().textContent()).toContain('first session')
    expect(await lastAnswer(page).textContent()).toBe('Echo: first session')
  })

  it('fork copies the conversation into a new session next to it', async () => {
    const { page } = ctx
    await openChat(page, ctx.projectDir)
    await send(page, 'to be forked')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: to be forked')
    await button(page, 'More actions').click()
    await page.locator('.sheet').getByRole('button', { name: 'Fork: copy into a new session' }).click()
    await expect.poll(() => openRows(page).count()).toBe(2)
    const fork = openRows(page).filter({ hasText: '(fork)' })
    await expect.poll(() => fork.count()).toBe(1)
    await fork.getByRole('button').first().click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: to be forked')
  })

  it('closing a session from its menu removes it from the open ones', async () => {
    const { page } = ctx
    await openIn('one')
    await send(page, 'hi one')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hi one')
    await openIn('two')
    await send(page, 'hi two')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hi two')
    await expect.poll(() => openRows(page).count()).toBe(2)
    await openRows(page).filter({ hasText: 'two' }).getByRole('button', { name: /^Actions for / }).click()
    await page.locator('.sheet').getByRole('button', { name: 'Close session' }).click()
    await expect.poll(() => openRows(page).count()).toBe(1)
    expect(await openRows(page).first().textContent()).toContain('one')
  })

  it('an untrusted folder shows what it would run; nothing opens until trusted', async () => {
    const { page } = ctx
    const folder = makeFolder('risky')
    mkdirSync(join(folder, '.claude'))
    writeFileSync(join(folder, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'calc.exe' }] }] } }))
    await nextFolder(ctx.app, folder)
    await addFolder(page, folder)
    await button(page, 'Actions for the folder risky').click()
    await page.locator('.sheet').getByRole('button', { name: 'New session here' }).click()
    const dialog = page.getByRole('dialog', { name: 'Do you trust this folder?' })
    await dialog.waitFor()
    expect(await dialog.textContent()).toContain('SessionStart: calc.exe')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    expect(await composer(page).count()).toBe(0)
    expect(await openRows(page).count()).toBe(0)
  })

  it('a notification brings the window to the session that needs an answer', async () => {
    const { page, app } = ctx
    await app.evaluate(({ BrowserWindow, Notification }) => {
      const shown: Notification[] = []
      ;(globalThis as { shown?: Notification[] }).shown = shown
      BrowserWindow.prototype.isFocused = () => false
      // Linux without a notification daemon (xvfb) reports no support.
      Notification.isSupported = () => true
      Notification.prototype.show = function (this: Notification) {
        shown.push(this)
      }
    })
    await openIn('needs-me')
    await send(page, 'permission')
    await page.locator('.request').waitFor()
    await openIn('elsewhere')
    await expect.poll(() => openRows(page).locator('.badge.waiting').count()).toBe(1)
    const bodies = await app.evaluate(() => (globalThis as unknown as { shown: { body: string }[] }).shown.map((n) => n.body))
    expect(bodies).toContain('Claude needs you: Write notes.txt')
    await app.evaluate(() => {
      const shown = (globalThis as unknown as { shown: { body: string; emit(event: string): void }[] }).shown
      shown.find((n) => n.body.startsWith('Claude needs you'))!.emit('click')
    })
    await page.locator('.request').waitFor()
    await expect.poll(() => page.locator('.col-left .row.current').textContent()).toContain('needs-me')
  })

  it('killing the local backend restarts it and the sessions come back', async () => {
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
    await expect.poll(() => page.locator('.banner').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.banner').count(), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => openRows(page).count()).toBe(1)
    await send(page, 'after the crash')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: after the crash')
  })
})
