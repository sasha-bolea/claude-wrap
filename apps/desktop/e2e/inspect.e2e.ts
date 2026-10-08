// The native Status and MCP servers panels in the desktop's wide arrangement, on the scripted fake SDK (every fake
// process has the same data: see scriptInspection in packages/core/src/testing/scenarios.ts). User stories: from the
// chat's ⋯ menu the session's Status opens in the right panel, next to the chat; so do the MCP servers with their state
// and the Permissions with the rules written in the folder's settings file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { launch, openChat, type App } from './harness.ts'

let ctx: App

beforeEach(async () => {
  ctx = await launch()
  await openChat(ctx.page, ctx.projectDir)
})
afterEach(() => ctx.close())

describe('desktop inspection panels (fake SDK)', () => {
  it('⋯ → Status opens in the right panel, with the chat still in the middle', async () => {
    const { page } = ctx
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.sheet').getByRole('button', { name: /^Status/ }).click()
    const panel = page.locator('.col-right')
    await panel.getByRole('region', { name: 'Status', exact: true }).waitFor()
    await panel.getByText('Version', { exact: true }).waitFor()
    await panel.getByText('2.1.287', { exact: true }).waitFor()
    await panel.getByText('Environment', { exact: true }).waitFor()
    await panel.getByText('/home/user/.claude/settings.json').waitFor()
    await page.locator('.col-center').getByRole('textbox', { name: 'Message to Claude' }).waitFor()
  })

  it('⋯ → MCP servers lists the three servers with their state in the right panel', async () => {
    const { page } = ctx
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.sheet').getByRole('button', { name: /^MCP servers/ }).click()
    const panel = page.locator('.col-right').getByRole('region', { name: 'MCP servers', exact: true })
    await panel.locator('.list > .row').first().waitFor()
    const row = (name: string) => panel.locator('.row').filter({ has: page.getByText(name, { exact: true }) })
    await row('tiny').getByText('Connected', { exact: true }).waitFor()
    await row('remote').getByText('Needs sign-in', { exact: true }).waitFor()
    await row('off').getByText('Disabled', { exact: true }).waitFor()
    expect(await panel.locator('.list > .row').count()).toBe(3)
  })

  it('⋯ → Permissions lists the folder\'s rules in the right panel and adds one', async () => {
    const { page } = ctx
    mkdirSync(join(ctx.projectDir, '.claude'), { recursive: true })
    writeFileSync(join(ctx.projectDir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }))
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.sheet').getByRole('button', { name: /^Permissions/ }).click()
    const panel = page.locator('.col-right').getByRole('region', { name: 'Permissions', exact: true })
    await panel.getByRole('radio', { name: 'Allow 1' }).waitFor()
    await panel.getByText('Bash(ls:*)', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Add rule', exact: true }).click()
    const sheet = page.locator('.sheet')
    await sheet.getByRole('textbox', { name: 'Rule' }).fill('Read')
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await panel.getByText('Read', { exact: true }).waitFor()
    await panel.getByRole('radio', { name: 'Allow 2' }).waitFor()
  })
})
