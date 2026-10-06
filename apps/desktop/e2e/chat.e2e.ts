// Desktop chat on the scripted fake SDK, in the touch app's wide arrangement. User stories:
// I add a folder and chat (the answer streams in); I answer permissions, questions and plans; I interrupt
// with Esc or Stop; I switch mode with Shift+Tab; a session waiting elsewhere is announced once; reloading the
// window loses nothing; untrusted markdown cannot load remote content; the Home lists the folders of This PC.
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFolder, button, composer, launch, lastAnswer, openChat, openRows, send, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
})
afterEach(() => ctx.close())

describe('desktop home (fake SDK)', () => {
  it('"Add folder…" adds the chosen folder to This PC; "Take off the list" removes it and keeps its files', async () => {
    const { page } = ctx
    await page.getByText('Open a session from the column on the left').waitFor()
    await addFolder(page, ctx.projectDir)
    await button(page, 'Actions for the folder project').click()
    await page.locator('.sheet').getByRole('button', { name: 'Take off the list' }).click()
    await page.getByRole('button', { name: 'project', exact: true }).waitFor({ state: 'detached' })
    await page.getByRole('status').filter({ hasText: 'taken off the list: its files stay' }).waitFor()
    expect(existsSync(ctx.projectDir)).toBe(true)
  })
})

describe('desktop chat (fake SDK)', () => {
  beforeEach(async () => {
    await openChat(ctx.page, ctx.projectDir)
  })

  it('the renderer has no Node and a strict CSP', async () => {
    expect(await ctx.page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
    const outcome = await ctx.page.evaluate(() => fetch('https://example.com').then(() => 'loaded', () => 'blocked'))
    expect(outcome).toBe('blocked')
  })

  it('shows the chat in the middle with the Home and its open session on the left, and no back arrow', async () => {
    const { page } = ctx
    await send(page, 'hello')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello')
    expect(await page.locator('.col-left .row.current').count()).toBe(1)
    expect(await page.locator('.col-center').getByRole('button', { name: 'Back', exact: true }).count()).toBe(0)
    await button(page, 'Folder files').click()
    await page.locator('.col-right').waitFor()
    await button(page, 'Folder files').click()
    await page.locator('.col-right').waitFor({ state: 'detached' })
  })

  it('the Terminal tab of the right panel runs a shell in the session folder (node-pty inside Electron)', async () => {
    const { page } = ctx
    await button(page, 'Folder files').click()
    await page.locator('.col-right').getByRole('button', { name: 'Terminal', exact: true }).click()
    const terminal = page.locator('.col-right').getByRole('region', { name: 'Terminal' })
    await terminal.locator('.xterm').click()
    await page.keyboard.type('echo cw-"mark"er')
    await page.keyboard.press('Enter')
    await expect.poll(() => terminal.locator('.xterm-rows').textContent(), { timeout: 10_000 }).toContain('cw-marker')
  })

  it('streams the answer word by word', async () => {
    const { page } = ctx
    await send(page, 'one two three four five six seven eight nine ten')
    const seen = new Set<string>()
    for (let n = 0; n < 40 && !(await page.locator('.turn-end').count()); n++) {
      seen.add((await lastAnswer(page).textContent().catch(() => '')) ?? '')
      await page.waitForTimeout(25)
    }
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: one two three four five six seven eight nine ten')
    expect(seen.size).toBeGreaterThan(3)
    expect(await page.locator('.msg-user').textContent()).toContain('one two three four five six seven eight nine ten')
  })

  it('a deny reason reaches Claude; allow goes through', async () => {
    const { page } = ctx
    await send(page, 'permission')
    const panel = page.getByRole('region', { name: 'Permission request' })
    await panel.getByRole('button', { name: 'No…' }).click()
    await panel.getByRole('textbox', { name: 'Why (optional)' }).fill('use other.txt')
    await panel.getByRole('button', { name: 'Answer no' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: deny — use other.txt')
    await send(page, 'permission')
    await page.getByRole('region', { name: 'Permission request' }).getByRole('button', { name: "Yes, don't ask again" }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')
    expect(await page.locator('.request').count()).toBe(0)
  })

  it('answers a multiple-choice question', async () => {
    const { page } = ctx
    await send(page, 'question')
    const panel = page.getByRole('region', { name: 'Question from Claude' })
    await panel.getByRole('radio', { name: /Blue/ }).check()
    await panel.getByRole('button', { name: 'Answer' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Question: allow {"Which color?":"Blue"}')
  })

  it('shows the questions of one form one at a time, like the CLI', async () => {
    const { page } = ctx
    await send(page, 'questions')
    const panel = page.getByRole('region', { name: 'Question from Claude' })
    await expect.poll(() => panel.getByRole('group').count()).toBe(1)
    expect(await panel.getByRole('group').getAttribute('aria-label')).toBe('Color, question 1 of 2')
    await panel.getByRole('radio', { name: /Blue/ }).click()
    await expect.poll(() => panel.getByRole('group').getAttribute('aria-label')).toBe('Size, question 2 of 2')
    expect(await panel.getByRole('button', { name: 'Answer' }).isDisabled()).toBe(true)
    await panel.getByRole('checkbox', { name: /Small/ }).check()
    await panel.getByRole('checkbox', { name: /Large/ }).check()
    await panel.getByRole('button', { name: /^Color/ }).click()
    expect(await panel.getByRole('radio', { name: /Blue/ }).isChecked()).toBe(true)
    await panel.getByRole('button', { name: 'Next' }).click()
    await panel.getByRole('button', { name: 'Answer' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Questions: allow {"Which color?":"Blue","Which sizes?":"Small, Large"}')
    const answered = page.getByRole('region', { name: 'Your answers' }).last()
    await expect.poll(() => answered.locator('.answered-q').allTextContents()).toEqual(['Color Which color?', 'Size Which sizes?'])
    expect(await answered.locator('.answered-a').allTextContents()).toEqual(['Blue', 'Small, Large'])
  })

  it('approving a plan with auto-accept switches the permission mode', async () => {
    const { page } = ctx
    await send(page, 'plan')
    await page.getByRole('region', { name: 'Plan approval' }).getByRole('button', { name: 'Yes, auto-accept edits' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Plan: allow')
    await expect.poll(() => page.locator('.mode-btn').getAttribute('data-mode')).toBe('acceptEdits')
  })

  it('Esc and Stop interrupt the turn', async () => {
    const { page } = ctx
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word3')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.turn-end').last().textContent()).toBe('Interrupted')
    await send(page, 'slow')
    await expect.poll(() => page.locator('.msg-ai').count()).toBe(2)
    await page.getByRole('button', { name: 'Stop: stop Claude' }).click()
    await expect.poll(() => page.locator('.turn-end').count()).toBe(2)
    expect(await page.locator('.turn-end').last().textContent()).toBe('Interrupted')
  })

  it('a request never steals focus from the composer and is never focused on a button', async () => {
    const { page } = ctx
    await send(page, 'permission')
    await page.locator('.request').waitFor()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Message to Claude')
    await page.getByRole('region', { name: 'Permission request' }).getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')

    await send(page, 'permission')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.locator('.request').waitFor()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON')
  })

  it('Shift+Tab switches mode only inside the composer', async () => {
    const { page } = ctx
    const mode = page.locator('.mode-btn')
    const first = await mode.getAttribute('data-mode')
    await composer(page).focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => mode.getAttribute('data-mode')).not.toBe(first)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Message to Claude')
    const switched = await mode.getAttribute('data-mode')
    await button(page, 'More actions').focus()
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(200)
    expect(await mode.getAttribute('data-mode')).toBe(switched)
  })

  it('a session waiting while its chat is not on screen is announced exactly once', async () => {
    const { page } = ctx
    await send(page, 'permission')
    await page.locator('.request').waitFor()
    // After a reload no chat is shown: the waiting session is announced (the live region VoiceOver reads).
    await page.addInitScript(() => {
      const spoken: string[] = []
      ;(window as unknown as { announcements: string[] }).announcements = spoken
      new MutationObserver(() => {
        const text = document.querySelector('.sr-only[aria-live]')?.textContent
        if (text && spoken.at(-1) !== text) spoken.push(text)
      }).observe(document, { childList: true, characterData: true, subtree: true })
    })
    await page.reload()
    await page.locator('.col-left').waitFor()
    await expect.poll(() => page.evaluate(() => (window as unknown as { announcements: string[] }).announcements.length)).toBe(1)
    await page.waitForTimeout(500)
    const spoken = await page.evaluate(() => (window as unknown as { announcements: string[] }).announcements)
    expect(spoken).toEqual([expect.stringMatching(/ is waiting for your answer$/)])
  })

  it('a reload mid-stream loses and duplicates nothing, and keeps the draft', async () => {
    const { page } = ctx
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word5')
    await composer(page).fill('half-written draft')
    await page.reload()
    await page.locator('.col-left').waitFor()
    // After the reload the session is in the left column: open it.
    await openRows(page).first().getByRole('button').first().click()
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word20')
    expect(await composer(page).inputValue()).toBe('half-written draft')
    await page.getByRole('button', { name: 'Stop: stop Claude' }).click()
    await expect.poll(() => page.locator('.turn-end').count()).toBe(1)
    const words = ((await lastAnswer(page).textContent()) ?? '').trim().split(' ')
    expect(words).toEqual(words.map((_, n) => `word${n}`))
    expect(await page.locator('.msg-user').count()).toBe(1)
    expect(await page.locator('.msg-ai').count()).toBe(1)
  })

  it('remote images in markdown render as links and load nothing', async () => {
    const { page } = ctx
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await send(page, 'markdown')
    await expect.poll(() => page.locator('.turn-end').count()).toBe(1)
    expect(await lastAnswer(page).locator('img').count()).toBe(0)
    expect(await lastAnswer(page).getByRole('link', { name: 'tracker' }).count()).toBe(1)
    expect(requested.filter((url) => url.includes('example.com'))).toEqual([])
  })
})
