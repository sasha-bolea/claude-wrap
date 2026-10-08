// Chat widgets in the desktop app (served from app://), on the scripted fake SDK (keyword `widget`). User stories: a
// reply with a widget shows it in its own frame under the app's policy, themed and cut off from storage and network;
// tapping its button sends its prompt in the chat; a widget cannot act by itself.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lastAnswer, launch, openChat, send, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
  await openChat(ctx.page, ctx.projectDir)
})
afterEach(() => ctx.close())

describe('desktop chat widgets (fake SDK)', () => {
  it('a widget runs in its frame from app:// and its button sends its prompt', async () => {
    const { page } = ctx
    await send(page, 'widget')
    const frame = lastAnswer(page).frameLocator('iframe.widget-frame')
    await frame.getByText('function,themed,blocked,offline,auto-refused').waitFor()
    await frame.getByRole('button', { name: 'Vai' }).click()
    await page.locator('.msg-ai').getByText('Echo: vai').waitFor()
    expect(await page.locator('.msg-ai').getByText('Echo: auto').count()).toBe(0)
  })
})
