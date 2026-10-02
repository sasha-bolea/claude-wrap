// Phase 1b, single-tab desktop on the scripted fake SDK. User stories:
// I choose a folder and chat (the answer streams in); I answer permissions, questions and plans; I interrupt
// with Esc or Stop; I switch mode with Shift+Tab; a request never steals my focus or grants anything by
// accident; reloading the window loses nothing; untrusted markdown cannot load remote content.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { launch, lastAnswer, openChat, send, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
  await openChat(ctx.page, ctx.projectDir)
})
afterEach(() => ctx.close())

describe('desktop single tab (fake SDK)', () => {
  it('the renderer has no Node and a strict CSP', async () => {
    expect(await ctx.page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
    const outcome = await ctx.page.evaluate(() => fetch('https://example.com').then(() => 'loaded', () => 'blocked'))
    expect(outcome).toBe('blocked')
  })

  it('streams the answer word by word', async () => {
    const { page } = ctx
    await send(page, 'one two three four five six seven eight nine ten')
    const seen = new Set<string>()
    for (let n = 0; n < 40 && !(await page.locator('.item.turn-end').count()); n++) {
      seen.add((await lastAnswer(page).textContent().catch(() => '')) ?? '')
      await page.waitForTimeout(25)
    }
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: one two three four five six seven eight nine ten')
    expect(seen.size).toBeGreaterThan(3)
    expect(await page.locator('.item.user').textContent()).toBe('one two three four five six seven eight nine ten')
  })

  it('a deny reason reaches Claude; allow goes through', async () => {
    const { page } = ctx
    await send(page, 'permission')
    const panel = page.getByRole('region', { name: 'Permission request' })
    await panel.getByRole('textbox', { name: 'Reason or instructions for Claude (if you deny)' }).fill('use other.txt')
    await panel.getByRole('button', { name: 'No' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: deny — use other.txt')
    await send(page, 'permission')
    await page.getByRole('region', { name: 'Permission request' }).getByRole('button', { name: "Yes, don't ask again" }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')
    expect(await page.locator('.request-panel').count()).toBe(0)
  })

  it('answers a multiple-choice question', async () => {
    const { page } = ctx
    await send(page, 'question')
    const panel = page.getByRole('region', { name: 'Question from Claude' })
    await panel.getByRole('radio', { name: /Blue/ }).check()
    await panel.getByRole('button', { name: 'Answer' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Question: allow {"Which color?":"Blue"}')
  })

  it('approving a plan with auto-accept switches the permission mode', async () => {
    const { page } = ctx
    await send(page, 'plan')
    await page.getByRole('region', { name: 'Plan approval' }).getByRole('button', { name: 'Yes, auto-accept edits' }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Plan: allow')
    await expect.poll(() => page.getByRole('combobox', { name: 'Permission mode' }).inputValue()).toBe('acceptEdits')
  })

  it('Esc and Stop interrupt the turn', async () => {
    const { page } = ctx
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word3')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.item.turn-end').last().textContent()).toBe('Interrupted')
    await send(page, 'slow')
    await expect.poll(() => page.locator('.item.assistant-text').count()).toBe(2)
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect.poll(() => page.locator('.item.turn-end').count()).toBe(2)
    expect(await page.locator('.item.turn-end').last().textContent()).toBe('Interrupted')
  })

  it('a request never steals focus from the composer; with focus free it lands on the panel, never on a button', async () => {
    const { page } = ctx
    await send(page, 'permission')
    await page.locator('.request-panel').waitFor()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Message to Claude')
    await page.getByRole('region', { name: 'Permission request' }).getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')

    await send(page, 'permission')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.locator('.request-panel').waitFor()
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toContain('request-panel')
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('SECTION')
  })

  it('Shift+Tab switches mode only inside the composer', async () => {
    const { page } = ctx
    const mode = page.getByRole('combobox', { name: 'Permission mode' })
    await page.getByRole('textbox', { name: 'Message to Claude' }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => mode.inputValue()).toBe('acceptEdits')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Message to Claude')
    await page.getByRole('button', { name: 'Close session' }).focus()
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(200)
    expect(await mode.inputValue()).toBe('acceptEdits')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).not.toBe('Close session')
  })

  it('announces each request exactly once to screen readers', async () => {
    const { page } = ctx
    await page.evaluate(() => {
      const region = document.querySelector('[data-live="request"]')!
      const counter = window as unknown as { announcements: string[] }
      counter.announcements = []
      new MutationObserver(() => {
        if (region.textContent) counter.announcements.push(region.textContent)
      }).observe(region, { childList: true, characterData: true, subtree: true })
    })
    await send(page, 'permission')
    await page.locator('.request-panel').waitFor()
    await page.waitForTimeout(300)
    await page.getByRole('region', { name: 'Permission request' }).getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Permission: allow')
    expect(await page.evaluate(() => (window as unknown as { announcements: string[] }).announcements)).toEqual(['Claude asks: Write notes.txt'])
  })

  it('a reload mid-stream loses and duplicates nothing, and keeps the draft', async () => {
    const { page } = ctx
    await send(page, 'slow')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word5')
    await page.getByRole('textbox', { name: 'Message to Claude' }).fill('half-written draft')
    await page.reload()
    await expect.poll(() => lastAnswer(page).textContent()).toContain('word20')
    expect(await page.getByRole('textbox', { name: 'Message to Claude' }).inputValue()).toBe('half-written draft')
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect.poll(() => page.locator('.item.turn-end').count()).toBe(1)
    const words = ((await lastAnswer(page).textContent()) ?? '').trim().split(' ')
    expect(words).toEqual(words.map((_, n) => `word${n}`))
    expect(await page.locator('.item.user').count()).toBe(1)
    expect(await page.locator('.item.assistant-text').count()).toBe(1)
  })

  it('remote images in markdown render as links and load nothing', async () => {
    const { page } = ctx
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await send(page, 'markdown')
    await expect.poll(() => page.locator('.item.turn-end').count()).toBe(1)
    expect(await lastAnswer(page).locator('img').count()).toBe(0)
    expect(await lastAnswer(page).getByRole('link', { name: 'tracker' }).count()).toBe(1)
    expect(requested.filter((url) => url.includes('example.com'))).toEqual([])
  })
})
