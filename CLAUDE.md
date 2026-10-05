# claude-wrap

## 0. Language (project override)
- **Code identifiers, code comments and all docs are in English.** This overrides the global rule "comments in Italian". The docs keep the standard Italian **filenames** (`STATO.md`, `architettura.md`, `bug-risolti.md`, …); only their content is English.
- The UI ships in **English and Italian** (`t()` + typed dictionaries, both always complete).
- Claude still **replies to Sasha in Italian**.
- Comment style otherwise as the global rules: above each function (what / parameters / return), inline only on dense lines.

## 1. Project & purpose
A graphical app with every feature of the Claude Code CLI, built on the Claude Agent SDK, in three applications around one backend `core`: desktop (Electron, local or remote backend), remote server on the Debian home server, mobile PWA. The same session can be open on PC and phone at the same time. Details: [docs/brief.md](docs/brief.md).

## 2. Team & roles
- sasha — sole developer and owner.

## 3. Stack
- TypeScript 5.9 everywhere (`erasableSyntaxOnly`: no enums, no parameter properties — scripts run directly on Node 24 type stripping), npm workspaces, Node 24.
- `@anthropic-ai/claude-agent-sdk` **0.3.287** (pinned exact in `packages/core` and `apps/desktop`; bundles CLI 2.1.287). Authoritative API: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.
- Desktop: Electron 44, electron-vite 5 (requires **vite ≤ 7**), React 19 + react-markdown 10, preload must be **CJS** with `sandbox: true`, electron-builder 26 (`--dir`, personal use only).
- Server: `node:http` + `ws`, systemd user service on Debian 13 with an update timer ([docs/deploy.md](docs/deploy.md)).
- PWA: vite 7 build of the same UI (`apps/mobile`), touch layout with its own `touch.css`; highlight.js loaded on demand.
- zod 4 (protocol), vitest 5 (unit + e2e runner), playwright-core (`_electron` for desktop e2e, system Chrome for PWA e2e).
- Environment quirks: Windows 11 is the main dev machine; the server is reachable only through Tailscale. npm 11 may skip Electron's postinstall ([procedure](docs/procedure.md#electron-binary-missing-after-npm-install)). Workspace packages export their `.ts` sources (relative imports carry the `.ts` extension). The working tree has CRLF line endings (`core.autocrlf`); scripts that edit files must keep them. The Bash tool's heredocs mangle backslashes and backticks: write scripts with the Write tool and run them. `wsl` from Git Bash expands `# claude-wrap

## 0. Language (project override)
- **Code identifiers, code comments and all docs are in English.** This overrides the global rule "comments in Italian". The docs keep the standard Italian **filenames** (`STATO.md`, `architettura.md`, `bug-risolti.md`, …); only their content is English.
- The UI ships in **English and Italian** (`t()` + typed dictionaries, both always complete).
- Claude still **replies to Sasha in Italian**.
- Comment style otherwise as the global rules: above each function (what / parameters / return), inline only on dense lines.

## 1. Project & purpose
A graphical app with every feature of the Claude Code CLI, built on the Claude Agent SDK, in three applications around one backend `core`: desktop (Electron, local or remote backend), remote server on the Debian home server, mobile PWA. The same session can be open on PC and phone at the same time. Details: [docs/brief.md](docs/brief.md).

## 2. Team & roles
- sasha — sole developer and owner.

## 3. Stack
- TypeScript 5.9 everywhere (`erasableSyntaxOnly`: no enums, no parameter properties — scripts run directly on Node 24 type stripping), npm workspaces, Node 24.
- `@anthropic-ai/claude-agent-sdk` **0.3.287** (pinned exact in `packages/core` and `apps/desktop`; bundles CLI 2.1.287). Authoritative API: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.
- Desktop: Electron 44, electron-vite 5 (requires **vite ≤ 7**), React 19 + react-markdown 10, preload must be **CJS** with `sandbox: true`, electron-builder 26 (`--dir`, personal use only).
- Server: `node:http` + `ws`, systemd user service on Debian 13 with an update timer ([docs/deploy.md](docs/deploy.md)).
- PWA: vite 7 build of the same UI (`apps/mobile`), touch layout with its own `touch.css`; highlight.js loaded on demand.
- zod 4 (protocol), vitest 5 (unit + e2e runner), playwright-core (`_electron` for desktop e2e, system Chrome for PWA e2e).
- Environment quirks: Windows 11 is the main dev machine; the server is reachable only through Tailscale. npm 11 may skip Electron's postinstall ([procedure](docs/procedure.md#electron-binary-missing-after-npm-install)). : run it from PowerShell.

## 4. Key structure
```
packages/protocol   zod schemas + types: envelope (index.ts), data model (model.ts), commands (commands.ts), in-memory channel
packages/core       the backend: core.ts (startup, connections) → workspace.ts (tabs, persistence, prepareStart) → tab.ts
                    (lazy session, queue, mode, requests) → session.ts (CLI process); transcript/stream/normalize (items,
                    epochs, replay); trust.ts + trustGate.ts; state.ts (state.json); process.ts (spawn, orphan sweep);
                    testing/ (FakeQuery, scripted scenarios, raw client); scripts/probe.ts, scripts/chat.ts
                    + files.ts (confined paths), trash.ts, notes.ts, folders.ts, activity.ts; scripts/smoke-composer.ts
packages/client     Connection (handshake, retries, resume, ping) + Store (home, projects, notesVersion)
packages/ui         App → TouchApp on every host (one screen at a time on a phone, three columns from 1024 px);
                    touch/ = screens, sheets/popovers, composer, backend switch; touch.css; DesktopShell (backends);
                    i18n/ (en, it)
apps/desktop        Electron: main/index.ts (app://, IPC, notifications, quit), main/coreProcess.ts (utilityProcess, restart,
                    system trash), main/coreHost.ts, preload/, renderer/; e2e/ (harness + suites)
packages/server     remote host: HTTP + WebSocket, pairing (POST /pair), devices, Web Push, static PWA, main.ts
apps/mobile         the PWA: src/main.tsx (host: pairing, push, version checks, orientation), scripts/icons.ts, e2e/
deploy/             install.sh (--when-idle), rollback.sh, systemd units (service + update timer), env.example
```

## 5. Commands
- Setup: `npm install` (then check Electron, see procedure).
- `npm test` — unit + contract tests (vitest, ~3 s). `npm run typecheck` — tsc over the whole repo.
- `npm run dev:desktop` — Electron with the renderer dev server on 5199 (real CLI, real app state in `%APPDATA%\claude-wrap`).
- `npm run start:desktop` — build + run the app as served from `app://` (CSP active).
- `npm run e2e` — build + desktop e2e on the fake SDK (~1.5 min, zero quota).
- `npm run e2e:mobile` — build the PWA + its e2e in the system Chrome on the fake SDK (~3 min); on the home server (no Chrome) with `CLAUDE_WRAP_E2E_CHROME=~/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome`.
- `npm run smoke:composer` — real CLI (haiku): palette, image, shell, mid-turn, send now, effort, history.
- `npm run smoke:accounts` — real CLI: an account's token reaches the CLI; back to the login in the same conversation.
- `npm run smoke:usage` — real CLI, zero tokens: `tab.context` and `tab.usage` answer and pass the protocol (the usage call is the SDK's experimental one).
- `npm run dev:server` (env `CLAUDE_WRAP_ROOT`, `CLAUDE_WRAP_PUBLIC_URL`) / `npm run start:server` (PWA build + server).
- `node apps/mobile/scripts/icons.ts` — PWA icons and iPhone splash screens.
- `npm run probe` — SDK probe, zero tokens; exit 1 on unclassified risky settings.
- `npm run chat` — headless real-CLI chat through core + client (`/model haiku`, few tokens).
- `npm run dist -w @claude-wrap/desktop` — packaged app in `apps/desktop/dist/win-unpacked/`.
- Fake SDK by hand: `$env:CLAUDE_WRAP_FAKE_SDK='1'; $env:CLAUDE_WRAP_STATE_DIR="$env:TEMP\cw-try"; npm run start:desktop`.
- Multi-step procedures (SDK update/probe, Electron binary, desktop and PWA e2e, Linux tests via WSL, packaged build, real-CLI smokes, following an automatic deploy): [docs/procedure.md](docs/procedure.md).
- Ports: renderer dev server **5199**, server dev **3012** (registered in `~/.claude/porte.md`; on the home server 3012 is registered in `personale/linux stup/docs/architettura.md`).

## 6. Conventions
- **The core owns all shared state**; clients keep only view state. `ui` and `client` never import `core`; `core` never imports Electron or `ws`.
- Every frame crossing a transport is validated with the `protocol` zod schemas, on both sides.
- Tests first (from user stories), then code. Core logic is tested through the protocol with `RawClient` + the FakeQuery (`CoreConfig.sdk = createFakeSdk()`), core+client together in `contract.test.ts`, the desktop in e2e on the scripted fake SDK (`CLAUDE_WRAP_FAKE_SDK=1`); the real CLI only in small smoke runs with `/model haiku`.
- Core tests need a real, trusted folder: `prepareStart` checks it exists and passes the trust gate (`trust.grant` in the test setup).
- e2e and dev runs that are not the real app use `CLAUDE_WRAP_STATE_DIR` (never the real app state); e2e also pass `--lang=en-US`.
- Cmd ids are UUIDs (the client uses `crypto.randomUUID()`); for `tab.send` the id is the SDK user-message uuid and the user item id.
- New protocol commands: schema in `packages/protocol/src/commands.ts`, handler in `packages/core/src/commands.ts`, the client validates the result automatically.
- New settings keys from an SDK bump that mention command/helper/url/path/hook must be classified in `packages/core/src/trust.ts` (the probe and a unit test fail otherwise).
- Workspace packages are devDependencies of `apps/desktop` (bundled by electron-vite); runtime `dependencies` there = only what must stay external (the SDK).
- Touch UI: components in `packages/ui/src/touch/`, styles only in `touch.css` (no inline styles, no emoji in badges: icons of `touch/icons.tsx`); untrusted text never becomes HTML (highlighted code goes through `spanNodes`). Before a push, check the PWA e2e and the Linux tests: `main` deploys itself on the home server.
- File commands take a place: `tabId` (the session's folder, trust-gated) or `folder` (a Home folder, inside the roots).
- SDK runtime methods outside its types (raw control requests: send now, `cancelAsyncMessage`, `command_lifecycle` frames) stay behind casts in core and are covered by `smoke:composer`.
- UI: follow [docs/design-system.md](docs/design-system.md) before building or changing any interface.
- Host changes on the home server are done by the `linux stup` session on Sasha's request, never from here.
- A second Claude session (server dev clone `/srv/progetti/claude-wrap`) also pushes to `main`: `git pull --ff-only` before working and before committing, push promptly.
- Do not run multi-agent review workflows without telling Sasha the cost first (they exhausted the 5-hour subscription quota before).

## 7. Docs references
- [docs/STATO.md](docs/STATO.md) — current state, decisions, backlog
- [docs/brief.md](docs/brief.md) — what and why
- [docs/piano.md](docs/piano.md) — **project addition**: approved plan, phases with "done" criteria
- [docs/architettura.md](docs/architettura.md) — structure, protocol, data model, processes, security, test plan
- [docs/design-system.md](docs/design-system.md) — UI rules and catalogue
- [docs/bug-risolti.md](docs/bug-risolti.md) — solved bugs (incl. the first attempt's)
- [docs/procedure.md](docs/procedure.md) — runbook
- [docs/deploy.md](docs/deploy.md) — home server install, automatic updates, rollback, logs
- [docs/note-rilascio.md](docs/note-rilascio.md) — licence and subscription constraints
- [docs/reference/cli-census.md](docs/reference/cli-census.md) — every CLI feature (+ Part D: SDK control protocol)
- [docs/reference/parity-map.md](docs/reference/parity-map.md) — each census entry → how the GUI covers it
- First attempt (read-only reference): `personale/claude wrap/docs/handoff-ripartenza.md`
