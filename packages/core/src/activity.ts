import { JsonFile } from './jsonFile.ts'

// The number of sessions at work, in a JSON file that deploy/install.sh --when-idle reads before restarting the
// server. Written only when the number changes.
export class ActivityFile {
  private readonly file: JsonFile<{ working: number; updatedAt: number }>
  private last?: number

  constructor(file: string) {
    this.file = new JsonFile(file)
  }

  // working: sessions starting, running or waiting for an answer.
  set(working: number): void {
    if (working === this.last) return
    this.last = working
    void this.file.save({ working, updatedAt: Date.now() })
  }
}
