// The app's trash (remote server) keeps deleted things for 7 days, then forgets them: checked at startup and once a
// day, here with a fake clock.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TRASH_DAYS, Trash } from './trash.ts'

const DAY = 24 * 3600 * 1000

describe('trash', () => {
  it('forgets what was deleted more than 7 days ago', async () => {
    let now = Date.parse('2026-10-01T10:00:00Z')
    const folder = mkdtempSync(join(tmpdir(), 'cw-trash-src-'))
    writeFileSync(join(folder, 'old.txt'), 'old')
    writeFileSync(join(folder, 'new.txt'), 'new')
    const trash = new Trash(join(mkdtempSync(join(tmpdir(), 'cw-trash-')), 'trash'), () => now)
    await trash.put(join(folder, 'old.txt'))
    now += 2 * DAY
    await trash.put(join(folder, 'new.txt'))
    now += (TRASH_DAYS - 2) * DAY + 1
    await trash.expire()
    expect((await trash.list()).map((item) => item.path)).toEqual([join(folder, 'new.txt')])
  })
})
