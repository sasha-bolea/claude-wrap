import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateStore } from './state.ts'

describe('StateStore', () => {
  it('starts empty when the file is missing or broken', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'state-'))
    expect((await StateStore.load(join(folder, 'missing.json'))).data).toEqual({ version: 1, trustedFolders: [], tabs: [], livePids: [], projects: [] })
    await writeFile(join(folder, 'broken.json'), '{ half')
    expect((await StateStore.load(join(folder, 'broken.json'))).data.tabs).toEqual([])
  })

  it('saves atomically and in order: the last update wins and the file reloads', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'state-')), 'nested', 'state.json')
    const store = await StateStore.load(file)
    void store.update((data) => data.trustedFolders.push('C:/a'))
    await store.update((data) => data.trustedFolders.push('C:/b'))
    expect(JSON.parse(await readFile(file, 'utf8')).trustedFolders).toEqual(['C:/a', 'C:/b'])
    expect((await StateStore.load(file)).data.trustedFolders).toEqual(['C:/a', 'C:/b'])
  })
})
