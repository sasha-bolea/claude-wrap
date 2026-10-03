import { useEffect, useState } from 'react'

// The installed app's own version (the PWA host): its build, the newer builds the server offers, reload.
export type AppCapability = {
  version: string
  // Calls listener with the version of a newer build on the server (at once when already known). Returns the
  // unsubscribe function.
  onUpdate(listener: (version: string) => void): () => void
  // Loads the page again, so the newer build runs (drafts and the queue are already saved).
  reload(): void
}

// Version of a newer build on the server; undefined while the app is up to date.
export function useAvailableUpdate(app?: AppCapability): string | undefined {
  const [version, setVersion] = useState<string>()
  useEffect(() => app?.onUpdate(setVersion), [app])
  return version
}
