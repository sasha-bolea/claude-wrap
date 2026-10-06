// Going back to one of your messages (rewind) on the desktop, on the scripted fake SDK. User story: Esc Esc in the
// empty composer opens the rewind in the right panel; I pick my first message, restore code and conversation, and the
// transcript is cut with the prompt back in the composer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composer, launch, openChat, send, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
  await openChat(ctx.page, ctx.projectDir)
})
afterEach(() => ctx.close())

describe('rewind (fake SDK)', () => {
  it('Esc Esc in the empty composer opens the rewind in the right panel; Restore code and conversation cuts the chat and returns the prompt', async () => {
    const { page } = ctx
    await send(page, 'edit')
    await page.getByText('Edited: done').waitFor()
    await send(page, 'hello')
    await page.getByText('Echo: hello').waitFor()
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' })
    await composer(page).focus()
    await composer(page).press('Escape')
    await composer(page).press('Escape')
    const panel = page.locator('.col-right')
    await panel.getByRole('region', { name: 'Go back' }).waitFor()
    expect(await panel.locator('.list .row .row-main').allInnerTexts()).toEqual(['edit', 'hello'])
    await panel.locator('.list .row .row-main').first().click()
    await page.locator('.rewind-files li').first().waitFor()
    await page.getByRole('button', { name: 'Restore code and conversation' }).click()
    await page.getByText('Are you sure?').waitFor()
    await page.locator('.two-buttons .button.danger').click()
    await page.getByText('Code and conversation restored (2 files)').waitFor()
    await expect.poll(() => composer(page).inputValue()).toBe('edit')
    await panel.waitFor({ state: 'detached' })
    expect(await page.locator('.msg-user').count()).toBe(0)
    expect(await page.getByText('Echo: hello').count()).toBe(0)
  })
})
