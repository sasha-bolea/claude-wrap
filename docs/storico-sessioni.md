# Session history — claude-wrap

_Append-only archive of session entries that left [STATO.md](STATO.md), newest on top._

## 2026-10-02 15:27 — Phases 0 and 1 (bootstrap → multi-tab desktop)
Built in one session, with a stop and Sasha's "vai" after each phase.
- **Phase 0:** workspaces, TS 5.9 with `erasableSyntaxOnly` (scripts run on Node 24 without a build), vitest, Electron window on `app://` showing the versions from `hello/welcome` over a brokered MessagePort. SDK 0.3.287 probe re-run: `system/init` now arrives **every turn**, `setPermissionMode` now **emits `system/status`**, `initializationResult.capabilities = ["ui_surface_v1"]`, model alias `fable` replaces `claude-fable-5-1`; the email is redacted in the committed probe (still present in commit `f128a80`).
- **Phase 1a:** protocol, core and client over the in-memory transport, FakeQuery; `npm run chat` talks to the real CLI (`/model haiku`) through core + client: unique item ids, user uuid stored in the JSONL.
- **Phase 1b:** single-tab desktop UI (streaming, permission/question/plan, Esc/Stop, model and mode, en/it, focus and aria-live rules), scripted fake SDK, 11 e2e; real-CLI smoke in Electron (permission, file written, no orphans on quit).
- **Phase 1c:** state.json with dormant restore and startup orphan sweep, trust gate with settings classification, sessions list/rename/delete, fork, rename/reorder/restart, notifications, core restart with backoff, packaged build. Real-CLI smoke on the packaged exe: chats, resume keeps the session id, core killed mid-turn → its claude swept, quit mid-turn → no orphans.

### Cambiamenti al codice
- Root: `package.json` (scripts `test`, `typecheck`, `dev:desktop`, `start:desktop`, `probe`, `chat`, `e2e`), `tsconfig.base.json`, `tsconfig.json`.
- `packages/protocol`: envelope (`hello`, `cmd`, `ping` / `welcome`, `reply`, `ev`, `reset`, `gone`, `pong`, `fatal`), model (items, requests, tab meta, workspace/tab events and snapshots, session info, project config), `COMMANDS` with args/result schemas, limits, `createChannelPair`.
- `packages/core`: `core.ts` (startup: load state, sweep, workspace; connections, reply cache), `workspace.ts` (tabs, session index, persistence, prepareStart, notices), `tab.ts` (lazy start, queue, mode/model reconciliation, requests, close order, restart, history refresh), `session.ts` (streaming input, read loop, close/kill), `transcript.ts` (items, coalescer, epochs), `stream.ts` (seq, ring, replay/reset), `normalize.ts` (port of `stato.ts` + item identity + stored slash commands), `requests.ts` (semantic answers), `trust.ts` + `trustGate.ts` (port of `fiducia.ts` + new risk sources), `settingsKeys.ts` (probe classification), `state.ts`, `process.ts` (spawn, orphan cleanup, startup sweep), `commands.ts`, `replyCache.ts`, `versions.ts`; `testing/` (FakeQuery with session store, scripted scenarios, message builders, raw client); `scripts/probe.ts`, `scripts/chat.ts`.
- `packages/client`: `Connection` (handshake, retry with same ids, resume, ping, backoff), `Store` (immutable, `useSyncExternalStore`-ready).
- `packages/ui`: `App`, `TabBar`, `StartScreen`, `SessionList`, `TrustDialog`, `ChatView` (+ `chatHooks`), `ChatHeader`, `ItemView`, `Markdown` (no raw HTML, images as links), `RequestPanel`, `Composer`, `i18n` (en/it), `focus`, `modes`, `viewState`, `style.css`.
- `apps/desktop`: `main/index.ts` (app:// from memory, CSP, IPC broker, folder picker, openExternal, notifications, graceful quit), `main/coreProcess.ts` (utilityProcess, backoff, queued ports, packaged claude path), `main/coreHost.ts`, `preload/index.ts`, `renderer/main.tsx`; `e2e/` (harness, `chat.e2e.ts`, `tabs.e2e.ts`), `vitest.e2e.config.ts`, electron-builder config.

## 2026-10-02 04:11 — Planning and scaffold
Plan approved by Sasha after three adversarial reviews; repository and docs created; census and parity map translated to English (row and heading counts match the originals). No code.
