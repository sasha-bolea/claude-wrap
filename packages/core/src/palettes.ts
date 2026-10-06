import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { PRESET_PALETTES, type Palette, type PaletteColors } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// The colour palettes of the app, shared by every device, in <stateDir>/palettes.json (in memory only without a
// state folder). Which palette is on stays on each device. The preset palettes are added once, after the saved
// ones (palettes-presets.json remembers it): from then on they are edited and deleted like any other.
export class PaletteStore {
  readonly loaded: Promise<void>
  private data: Palette[] = []
  private readonly file?: JsonFile<Palette[]>
  private readonly presets?: JsonFile<{ added: boolean }>
  private readonly changed: () => void

  // file: where they are saved; changed: called after every change (and once loaded) to tell the clients.
  constructor(file: string | undefined, changed: () => void) {
    this.file = file ? new JsonFile<Palette[]>(file) : undefined
    this.presets = file ? new JsonFile<{ added: boolean }>(join(dirname(file), 'palettes-presets.json')) : undefined
    this.changed = changed
    this.loaded = this.load()
  }

  // Reads the saved palettes and adds the presets the first time; tells the clients.
  private async load(): Promise<void> {
    const [saved, presets] = await Promise.all([this.file?.read(), this.presets?.read()])
    this.data = saved ?? []
    if (!presets?.added) {
      const now = Date.now()
      const missing = PRESET_PALETTES.filter((preset) => !this.data.some((palette) => palette.paletteId === preset.paletteId))
      this.data = [...this.data, ...missing.map((preset) => ({ ...preset, colors: { ...preset.colors }, updatedAt: now }))]
      await this.file?.save(this.data)
      await this.presets?.save({ added: true })
    }
    if (this.data.length) this.changed()
  }

  // The palettes in the order they were made.
  list(): Palette[] {
    return this.data
  }

  // Creates a palette (paletteId absent) or changes one. Returns it.
  async save(paletteId: string | undefined, name: string, colors: PaletteColors): Promise<Palette> {
    await this.loaded
    if (paletteId && !this.data.some((palette) => palette.paletteId === paletteId)) throw new CoreError('not_found', 'palette not found')
    const palette = { paletteId: paletteId ?? randomUUID(), name, colors, updatedAt: Date.now() }
    this.data = paletteId ? this.data.map((old) => (old.paletteId === paletteId ? palette : old)) : [...this.data, palette]
    await this.store()
    return palette
  }

  async delete(paletteId: string): Promise<void> {
    await this.loaded
    if (!this.data.some((palette) => palette.paletteId === paletteId)) throw new CoreError('not_found', 'palette not found')
    this.data = this.data.filter((palette) => palette.paletteId !== paletteId)
    await this.store()
  }

  // Saves and tells the clients.
  private async store(): Promise<void> {
    await this.file?.save(this.data)
    this.changed()
  }
}
