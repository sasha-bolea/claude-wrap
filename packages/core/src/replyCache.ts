import type { Reply } from '@athome/protocol'

const MAX_PER_CLIENT = 256
const MAX_AGE_MS = 5 * 60 * 1000

type Entry = { reply: Promise<Reply>; at: number }

// Replies by (clientId, cmd id), so a command re-sent after a reconnect returns the first reply instead of
// running twice. Keeps the last 256 per client for 5 minutes; a command still running shares its promise.
export class ReplyCache {
  private readonly clients = new Map<string, Map<string, Entry>>()

  // Cached reply of a command, or undefined if it never ran (or expired).
  get(clientId: string, id: string): Promise<Reply> | undefined {
    const entry = this.clients.get(clientId)?.get(id)
    return entry && Date.now() - entry.at < MAX_AGE_MS ? entry.reply : undefined
  }

  set(clientId: string, id: string, reply: Promise<Reply>): void {
    let entries = this.clients.get(clientId)
    if (!entries) this.clients.set(clientId, (entries = new Map()))
    entries.set(id, { reply, at: Date.now() })
    // Map keeps insertion order: the first key is the oldest.
    while (entries.size > MAX_PER_CLIENT) entries.delete(entries.keys().next().value!)
  }
}
