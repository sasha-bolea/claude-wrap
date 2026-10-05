import type { Connection } from '@claude-wrap/client'
import { TouchApp } from './touch/TouchApp.tsx'
import type { BackendsCapability } from './touch/backends.tsx'
import type { PushCapability } from './touch/SettingsScreen.tsx'
import type { AppCapability } from './appUpdate.ts'

// Host abilities the UI may use when present (desktop: native folder picker, system browser, notifications).
export type Capabilities = {
  chooseFolder?: () => Promise<string | undefined>
  openExternal?: (url: string) => void
  // A system notification was clicked: show that tab. Returns the unsubscribe function.
  onActivateTab?: (listener: (tabId: string) => void) => () => void
  // A notification about several chats was tapped: show the open sessions. Returns the unsubscribe function.
  onShowSessions?: (listener: () => void) => () => void
  // The local backend crashed too often and will not come back.
  onCoreFailed?: (listener: () => void) => () => void
  // Local path of a dropped file (desktop; with a remote backend files will be uploaded instead, Phase 3).
  pathForFile?: (file: File) => string
  // Touch layout (the PWA): one screen at a time instead of the tab bar.
  layout?: 'desktop' | 'mobile'
  push?: PushCapability
  // Link that pairs a new device with a one-time code (the server's address).
  pairLink?: (code: string) => string
  // Forgets this device's pairing (the PWA goes back to its pairing screen).
  logout?: () => void
  // The installed app's version and the newer builds the server offers (the PWA).
  app?: AppCapability
  // This device was paired just now (the PWA offers the notifications once).
  justPaired?: boolean
  // The desktop's backends (This PC and the paired servers): the switch on top of the Home.
  backends?: BackendsCapability
}

export interface AppProps {
  // Link to the backend; the App starts it and renders its store.
  connection: Connection
  capabilities: Capabilities
}

// Root of the UI: the touch app, one screen at a time on a phone, three columns on a wide window (desktop, tablets).
export function App(props: AppProps) {
  return <TouchApp {...props} />
}
