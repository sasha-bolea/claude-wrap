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
- Server (Phase 3): `node:http` + `ws`, systemd user service on Debian 13.
- zod 4 (protocol), vitest 5 (unit + e2e runner), playwright-core (`_electron` for e2e).
- Environment quirks: Windows 11 is the main dev machine; the server is reachable only through Tailscale. npm 11 may skip Electron's postinstall ([procedure](docs/procedure.md#electron-binary-missing-after-npm-install)). Workspace packages export their `.ts` sources (relative imports carry the `.ts` extension).

## 4. Key structure
```
packages/protocol   zod schemas + types: envelope (index.ts), data model (model.ts), commands (commands.ts), in-memory channel
packages/core       the backend: core.ts (startup, connections) → workspace.ts (tabs, persistence, prepareStart) → tab.ts
                    (lazy session, queue, mode, requests) → session.ts (CLI process); transcript/stream/normalize (items,
                    epochs, replay); trust.ts + trustGate.ts; state.ts (state.json); process.ts (spawn, orphan sweep);
                    testing/ (FakeQuery, scripted scenarios, raw client); scripts/probe.ts, scripts/chat.ts
packages/client     Connection (handshake, retries, resume, ping) + Store
packages/ui         the single React UI: App, TabBar, StartScreen, ChatView, RequestPanel, TrustDialog, i18n/, style.css
apps/desktop        Electron: main/index.ts (app://, IPC, notifications, quit), main/coreProcess.ts (utilityProcess, restart),
                    main/coreHost.ts, preload/, renderer/; e2e/ (harness + suites)
packages/server     remote host (Phase 3, not yet)
apps/mobile         PWA build of the UI (Phase 3, not yet)
```

## 5. Commands
- Setup: `npm install` (then check Electron, see procedure).
- `npm test` — unit + contract tests (vitest, ~3 s). `npm run typecheck` — tsc over the whole repo.
- `npm run dev:desktop` — Electron with the renderer dev server on 5199 (real CLI, real app state in `%APPDATA%\claude-wrap`).
- `npm run start:desktop` — build + run the app as served from `app://` (CSP active).
- `npm run e2e` — build + desktop e2e on the fake SDK (~1 min, zero quota).
- `npm run probe` — SDK probe, zero tokens; exit 1 on unclassified risky settings.
- `npm run chat` — headless real-CLI chat through core + client (`/model haiku`, few tokens).
- `npm run dist -w @claude-wrap/desktop` — packaged app in `apps/desktop/dist/win-unpacked/`.
- Fake SDK by hand: `$env:CLAUDE_WRAP_FAKE_SDK='1'; $env:CLAUDE_WRAP_STATE_DIR="$env:TEMP\cw-try"; npm run start:desktop`.
- Multi-step procedures (SDK update/probe, Electron binary, e2e, packaged build, real-CLI smoke): [docs/procedure.md](docs/procedure.md).
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
- UI: follow [docs/design-system.md](docs/design-system.md) before building or changing any interface.
- Host changes on the home server are done by the `linux stup` session on Sasha's request, never from here.
- Do not run multi-agent review workflows without telling Sasha the cost first (they exhausted the 5-hour subscription quota before).

## 7. Docs references
- [docs/STATO.md](docs/STATO.md) — current state, decisions, backlog
- [docs/brief.md](docs/brief.md) — what and why
- [docs/piano.md](docs/piano.md) — **project addition**: approved plan, phases with "done" criteria
- [docs/architettura.md](docs/architettura.md) — structure, protocol, data model, processes, security, test plan
- [docs/design-system.md](docs/design-system.md) — UI rules and catalogue
- [docs/bug-risolti.md](docs/bug-risolti.md) — solved bugs (incl. the first attempt's)
- [docs/procedure.md](docs/procedure.md) — runbook
- [docs/note-rilascio.md](docs/note-rilascio.md) — licence and subscription constraints
- [docs/reference/cli-census.md](docs/reference/cli-census.md) — every CLI feature (+ Part D: SDK control protocol)
- [docs/reference/parity-map.md](docs/reference/parity-map.md) — each census entry → how the GUI covers it
- First attempt (read-only reference): `personale/claude wrap/docs/handoff-ripartenza.md`
