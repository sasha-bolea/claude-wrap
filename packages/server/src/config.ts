import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Server settings from the environment (systemd EnvironmentFile on the home server, not in the repo):
//   CLAUDE_WRAP_ROOT            folder sessions may run in (required; e.g. /srv/progetti)
//   CLAUDE_WRAP_PUBLIC_URL      URL the clients use (required; the Tailscale Serve address, e.g. https://<host>.<tailnet>.ts.net:8443)
//   CLAUDE_WRAP_PORT / _HOST    listen address (default 3012 on 127.0.0.1)
//   CLAUDE_WRAP_STATE_DIR       state, devices, pairing codes (default ~/.local/state/claude-wrap)
//   CLAUDE_WRAP_TAILSCALE_LOGIN owner's Tailscale login; when set, requests without it are refused
//   CLAUDE_WRAP_STATIC_DIR      PWA build to serve (default apps/mobile/dist)
//   CLAUDE_WRAP_BROWSER_PORT   DevTools port of the shared browser, loopback only (default 3013)
//   CLAUDE_WRAP_CHROME          Chromium executable (default ~/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome;
//                               not found -> the browser is off)
//   CLAUDE_WRAP_FAKE_SDK=1      scripted fake SDK (tests, zero quota)

export type ServerConfig = {
  root: string
  publicUrl: URL
  port: number
  host: string
  stateDir: string
  tailscaleLogin?: string
  staticDir: string
  fakeSdk: boolean
  // Absent when no Chromium is found: the browser is off.
  browser?: { port: number; executable: string; profileDir: string }
}

// Reads the configuration; throws with a readable message when the root is missing.
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (!env.CLAUDE_WRAP_ROOT) throw new Error('CLAUDE_WRAP_ROOT is not set: the folder sessions may run in (e.g. /srv/progetti)')
  if (!env.CLAUDE_WRAP_PUBLIC_URL) throw new Error('CLAUDE_WRAP_PUBLIC_URL is not set: the address clients use (e.g. https://<host>.<tailnet>.ts.net:8443)')
  const stateDir = env.CLAUDE_WRAP_STATE_DIR ?? join(homedir(), '.local', 'state', 'claude-wrap')
  return {
    root: env.CLAUDE_WRAP_ROOT,
    publicUrl: new URL(env.CLAUDE_WRAP_PUBLIC_URL),
    port: Number(env.CLAUDE_WRAP_PORT ?? 3012),
    host: env.CLAUDE_WRAP_HOST ?? '127.0.0.1',
    stateDir,
    tailscaleLogin: env.CLAUDE_WRAP_TAILSCALE_LOGIN || undefined,
    staticDir: env.CLAUDE_WRAP_STATIC_DIR ?? fileURLToPath(new URL('../../../apps/mobile/dist', import.meta.url)),
    fakeSdk: env.CLAUDE_WRAP_FAKE_SDK === '1',
    browser: browserConfig(env, stateDir)
  }
}

// The shared browser's settings, or undefined when no Chromium is found. Creates the private profile folder (0700).
function browserConfig(env: NodeJS.ProcessEnv, stateDir: string): ServerConfig['browser'] {
  const executable = env.CLAUDE_WRAP_CHROME || join(homedir(), '.cache', 'ms-playwright', 'chromium-1247', 'chrome-linux64', 'chrome')
  if (!existsSync(executable)) return undefined
  const profileDir = join(stateDir, 'browser', 'profile')
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  return { port: Number(env.CLAUDE_WRAP_BROWSER_PORT ?? 3013), executable, profileDir }
}

// Origins and Host values a request may carry: the public URL, the desktop app, and the local address.
export function allowedPeers(config: ServerConfig): { origins: string[]; hosts: string[] } {
  return {
    origins: [config.publicUrl.origin, 'app://claude-wrap'],
    hosts: [config.publicUrl.host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]
  }
}
