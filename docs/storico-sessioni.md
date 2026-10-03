# Session history — claude-wrap

_Append-only archive of session entries that left [STATO.md](STATO.md), newest on top._

## 2026-10-03 17:49 — Sub-phases A, B, C1 and the first fixes from the phone
The approved prototype (built with Sasha by a session on the server) became the UI spec; the plan was realigned in
sub-phases A–D after a check on the real CLI ([piano.md](piano.md) §4). A, B and C1 were done with Sasha's "vai" and
report after each, committed as `66884f3`, deployed by linux stup (first install of the update timer); then Sasha's
requests from the phone, each committed and deployed by the timer (`8625bdd`, `e4ed6c2`).
- **A — PWA polish and updates:** no zoom, splash screens for every iPhone size (light/dark), installed app offered
  the newer build (version.json), server auto-update when no session works.
- **B — core and protocol:** Home of folders with project marks, files of a session folder (confined, attachments in
  `allegati/`), one app trash (7 days; system trash on this PC), mid-turn messages with `priority: 'next'` and
  `command_lifecycle`, separate per-tab queue with pause (Stop, usage limits), folder notes, effort levels.
  `smoke:composer` on the real CLI: mid-turn read in the same turn, effort applied, history shows the message once.
- **C1 — touch UI of the prototype:** new `packages/ui/src/touch/` components and `touch.css`, PWA e2e rewritten,
  design-system Touch section rewritten, ~270 i18n keys (en + it).
- **From the phone, same day:** files row in Home folders (opens the explorer without a session), ghost hidden at the
  bottom of the chat, pause icon instead of the emoji, portrait only, "Invia ora" (the CLI's send-now; on the real
  CLI the waiting message was read 2.8 s after the tap during a 20 s tool), no duplicate sessions, empty sessions not
  kept, tab titles from Claude Code.
- Deploy: linux stup reviewed the deploy diff and asked Sasha directly before installing the timer (trust model:
  a push to `main` runs on the server). First install: `version.json` said "dev" (old script); fixed by the next build.

### Cambiamenti al codice
- `deploy/install.sh` (`--when-idle`, `.failed`, `CLAUDE_WRAP_BUILD`, timer install), `deploy/rollback.sh` (`.failed`),
  new `deploy/claude-wrap-update.service` + `.timer`; `packages/server/src/deploy.test.ts` (Linux only).
- `packages/core`: `activity.ts`, `files.ts` (resolve modes target/create/entry, attachments, `.git/info/exclude`),
  `trash.ts`, `notes.ts`, `jsonFile.ts`, `folders.ts` (list with file counts, create); `workspace.ts` (Home, projects,
  added folders, discard, trash timer, usage-limit pause, never-used tabs not restored); `tab.ts` (mid-turn dispatch,
  `held` lifecycles, queue methods, pause, `setEffort`/`fitEffort`, `sendPendingNow`, `followCliTitle`/`autoTitle`);
  `commands.ts` (folders/files/trash/notes/queue/effort/send-now handlers, file place = tab or Home folder);
  `state.ts` (queue, pause, effort, projects, addedFolders, autoTitle); testing: lifecycle/rate-limit messages,
  FakeQuery `applyFlagSettings` + raw `request`, scenarios folding `next` messages; `scripts/smoke-composer.ts`
  (mid-turn, send now, effort, history).
- `packages/protocol`: folders.*, files.* (`filePlace`: tabId or folder), trash.*, notes.*, tab.queue*, tab.setEffort,
  tab.sendPendingNow; model: user `pending`, TabMeta `effort` + `queuePause`, Home, events `folders.updated` and
  `notes.changed`; LIMITS `previewBytes`, `fileBytes`.
- `packages/client`: store with `home`, `projects`, `notesVersion`.
- `packages/ui`: `touch/` (TouchApp, context, SheetHost, parts, icons, model + test, keyboard, Splash, sessions,
  HomeScreen, TrashScreen, ChatScreen, Conversation, TouchComposer, queue, modelSheets, FilesScreen, NotesScreen,
  SettingsScreen, LaterScreen), `touch.css`, `appUpdate.ts` (was `UpdateBar.tsx`), `PairScreen.tsx` restyled,
  `App.tsx` (TouchApp / DesktopApp), `notes.ts` (20% rule) + test, `composerHooks.ts` (`useDraft`), `viewState.ts`
  (linked note), i18n en/it; removed `MobileApp.tsx` and the old `SettingsScreen.tsx`. New dependency highlight.js.
- `apps/mobile`: `index.html` (viewport, splash links, favicon), `scripts/icons.ts` (splash PNGs), `public/splash/`,
  `public/manifest.webmanifest` (portrait), `vite.config.ts` (build id, version.json), `src/main.tsx` (touch.css,
  gestures, version checks, `justPaired`, rotate notice), `e2e/` (harness + 20 tests).
- `apps/desktop`: `main/coreHost.ts` + `main/coreProcess.ts` (system trash through main), e2e selectors.

## 2026-10-02 15:27 → 2026-10-03 — Phases 2 and 3 (composer, remote server, PWA, deploy)
Committed as `bf79ef0` (phases 2–3c) and `2e5df97` (deploy, portable trust tests); the repository was made public
after rewriting its history (no email, no tailnet name).
- **Phase 2:** command palette (`supportedCommands`), `@` mentions, images, long pastes, prompt history, visible
  queue with send now/remove, `!` shell mode.
- **Phase 3a–c:** server (`node:http` + `ws`, pairing over `POST /pair`, devices, Web Push, Origin/Host checks, root
  confinement), PWA (`apps/mobile`), desktop backend switcher (main-owned sockets, tokens in `safeStorage`).
- **Phase 3d:** deploy on the home server by linux stup (systemd user service, Tailscale Serve on 8443).

### Decisions moved out of STATO (Phases 0–1, 2026-10-02)
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-02 | Restart from zero in `personale/claude-wrap`; the first attempt stays read-only reference | The window owned the tabs and had no resume; with PC + phone the state must live in the backend |
| 2026-10-02 | Three applications around one `core`; local core in an Electron `utilityProcess` over `MessagePort` | Same code for local and remote, crash isolation, no TCP port on the PC |
| 2026-10-02 | Numbered streams with epochs, idempotent commands, queue and requests in core | Reloads, drops and core restarts never lose or duplicate anything; first answer wins across devices |
| 2026-10-02 | Cmd ids are UUIDs; for `tab.send` the id is the SDK user-message uuid | The CLI stores it in the JSONL: core recognises a retried send after a restart by finding it in the history |
| 2026-10-02 | No `pending` list in `hello`: the client re-sends unanswered cmds after `welcome` with the same ids | Same guarantee through the reply cache, one mechanism less |
| 2026-10-02 | New frames `fatal` (refusal before close) and `gone` (stream of a tab that no longer exists) | The protocol had no way to say why a connection was refused or that a resumed tab is gone |
| 2026-10-02 | Tab meta keeps `model` (requested, may be an alias) and `activeModel` (what `init` reports) | `init` now arrives every turn with the resolved id; overwriting the picker value with it would break the alias |
| 2026-10-02 | Text and thinking items are created at their first delta, not at block start | Haiku sends thinking blocks without text: no empty items |
| 2026-10-02 | User messages are stamped `origin: {kind:'human'}` | SDK 0.3.287: unattributed input fails closed at strict trust checks |
| 2026-10-02 | Trust gate classifies every top-level `Settings` key mentioning command/helper/url/path/hook; the probe and a unit test fail on unclassified ones | New SDK settings that run things must never slip past the trust dialog unnoticed |
| 2026-10-02 | History of a tab is loaded only if no process ran in this core; before the first spawn it is re-read when the stored session's `lastModified` changed | Re-reading a live session replaced live items; a terminal CLI may write to the session in between |
| 2026-10-02 | Notifications: core emits semantic notices, the desktop main shows them only when the window is unfocused, with its own en/it texts | Core has no UI language; focus is known only to main |
| 2026-10-02 | Desktop core restart: backoff 250 ms / 1 s / 3 s, max 3 in 60 s, then an error screen; ports queued while it restarts | A crash must heal by itself, a crash loop must not spin |
| 2026-10-02 | Workspace packages are devDependencies of the desktop app (bundled); only the SDK is a runtime dependency (external, binary unpacked from asar) | electron-builder then ships just the SDK; the Anthropic signature on `claude.exe` stays valid |
| 2026-10-02 | "Yes, don't ask again" follows the CLI suggestions: for Write that is accept-edits for the session (no file), for Bash a rule in `.claude/settings.local.json` | Verified on the real CLI: parity, not a missing feature |
| 2026-10-02 | Server + PWA in Phase 3; MIT; no public installers until SDK/ToS verified | See [piano.md](piano.md) §1 |

### Cambiamenti al codice
- `packages/server` (new): HTTP + WebSocket host, pairing, devices store, push, static files, `main.ts`; contract tests
  on the websocket transport.
- `apps/mobile` (new): the PWA build of the UI (service worker, manifest, icons, pairing).
- `packages/ui`: palette and suggestions, mentions, images, pastes, history, queue list, mobile layout (replaced in
  C1), backend switcher (`DesktopShell`).
- `apps/desktop`: main-owned remote sockets, server list, tokens in `safeStorage`.
- `deploy/`: `claude-wrap.service`, `install.sh`, `rollback.sh`, `env.example`; `docs/deploy.md`.
- `packages/core`: shell mode (`silentResults`), `/compact` dedup by uuid, probe split public/local.

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
