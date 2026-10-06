# Architecture — AtHome

_Last updated: 2026-10-02 15:27. Source: the detailed plan approved by Sasha on 2026-10-02 (after three adversarial reviews, 36 findings folded in), corrected where the implementation of Phases 0–1 differs; §8 lists those differences with their reason. Phases and "done" criteria: [piano.md](piano.md)._

## 1. Principle and why
**The backend is the centre; every interface is only a window on it.** The first attempt let the Electron window own the tabs and had no event resume: two adversarial reviews (38 findings) traced most of its bugs to that — orphan processes, events lost between snapshot and stream, lost active tab, duplicated history (details in `personale/claude wrap/docs/handoff-ripartenza.md` §5). With simultaneous use from PC and phone, shared state *must* live in the backend. Hence:
- one `core` package owns tabs, sessions, transcripts, queues and requests, identical for the local (desktop) and remote (server) backend — a bug fixed once is fixed for both;
- clients keep only view state (active tab, drafts, scroll) and talk to core through one protocol over two transports (Electron MessagePort locally, WebSocket remotely);
- events are numbered per stream with an epoch, so a reload, a dropped phone connection or a core restart never loses or duplicates anything.

## 2. Monorepo structure
```
claude-wrap/
├─ package.json            workspaces packages/*, apps/*; scripts test, typecheck, dev:desktop, dev:server, probe, e2e
├─ tsconfig.base.json      strict, ES2023
├─ packages/
│  ├─ protocol/  zod schemas + TS types: envelope, hello/welcome, commands, events, error codes, size limits, PROTOCOL_VERSION. dep: zod.
│  ├─ core/      pure Node backend: Core (tabs, sessions, transcripts, queues, requests, connections), SDK adapter, transcript
│  │             normalizer, trust gate, file suggestions, blobs (images), process spawn + orphan cleanup, state store.
│  │             API: createCore(config) → {attach(channel), closeAll(), ready}. channel = {send, onMessage, onClose, close}.
│  │             Back-pressure policy lives in the hosts (server: ws bufferedAmount), not in core.
│  ├─ client/    transport-agnostic: Connection (hello/welcome, idempotent cmds with retry, per-stream {epoch, seq}, resume,
│  │             app-level ping, reconnect), Store (workspace + subscribed transcripts, useSyncExternalStore-ready).
│  │             A transport is any Channel {send, onMessage, onClose, close}: the desktop preload's port wrapper, a WebSocket
│  │             wrapper (Phase 3), createChannelPair (in protocol, tests and in-process hosts). dep: protocol.
│  ├─ ui/        the single React UI (adaptive desktop/mobile). Props {connection, capabilities}; never imports Electron.
│  │             View state per backendId in localStorage (viewState.ts): active tab, drafts, recent folder.
│  │             i18n: own tiny t(key, params) + typed en.ts / it.ts. deps: client, react, react-markdown, remark-gfm.
│  └─ server/    remote host: node:http + ws; static PWA from an in-memory map; /ws with Origin/Host/(Tailscale login) checks
│                and token auth; pairing CLI (`claude-wrap pair`); root confinement config; systemd unit; install/update scripts.
└─ apps/
   ├─ desktop/   Electron main: window, app:// scheme, single-instance lock, utilityProcess core host (restart with backoff),
   │             port brokering, **remote sockets owned by main** (ws, origin app://claude-wrap, token from safeStorage),
   │             native dialogs, notifications, backends list. Preload (CJS): holds the ports, exposes only
   │             connect(backendId) → Promise<{send, onMessage, onClose, close}>, chooseFolder, openExternal,
   │             onActivateTab, onCoreFailed via contextBridge. Renderer = ui. electron-vite 5 / vite 7.
   └─ mobile/    Vite build of ui as PWA (manifest, service worker, touch layout); output served by server.
```
Import rule: `protocol` ← `core`, `client`; `client` ← `ui`; `core` ← `server`, desktop core host; `ui` ← desktop renderer, mobile. `ui`/`client` never import `core`; `core` never imports Electron or `ws`. **The desktop renderer only ever speaks to main-brokered ports** (local core directly, remote backends through main's socket proxy) → renderer CSP `connect-src 'self'`, tokens never in renderer memory.

## 3. Protocol (packages/protocol)
**Envelope** (JSON; every frame zod-validated on receipt by both sides):
- client→core: `{t:'hello',…}` once; `{t:'cmd', id, name, args}`; `{t:'ping', n}`.
- core→client: `{t:'welcome',…}`; `{t:'reply', id, ok, result | error:{code, message, details?}}`; `{t:'ev', stream, epoch, seq, ev}`; `{t:'reset', stream, epoch, seq, snapshot}`; `{t:'gone', stream}` (a resumed tab stream whose tab no longer exists); `{t:'pong', n}`; `{t:'fatal', error}` (sent right before core closes a connection it refuses).
- `cmd.id` is a UUID (validated).

**Handshake.** `hello {protocolVersion, clientId (stable per install), token? (remote), visible, resume:{[stream]:{epoch, lastSeq}}}` → `welcome {protocolVersion, backendId, coreVersion, sdkVersion, cliVersion, backendKind, limits}` then, per stream: replay, `reset`, or `gone`. Unanswered commands are re-sent by the client after `welcome` with their original ids (no `pending` list in hello). Major mismatch → `fatal {incompatible_protocol}` + close; the client stops and the UI says which side to update. Remote unauthenticated: only `hello` and `pair.complete`, 5 s deadline. Core accepts `hello` only after its startup orphan sweep has finished.

**Streams, epochs, numbering.** `workspace` stream (tab list and meta: title, cwd, status, model, mode, queue, pending-request index, devices) + one `tab:<id>` stream per tab (transcript). Each stream has `{epoch, seq}`: epoch is random, minted at core start and again whenever a transcript is rebuilt (restart of a dead tab, `conversation_reset`). Resume: same epoch and lastSeq still in the ring → replay; otherwise `reset`. `reset` may also be pushed **at any time** on a live stream (seq keeps increasing). Ring buffers are bounded by **count and bytes** (e.g. 2 000 events / 4 MB). A `reset` snapshot carries the last K items + `hasMore`; older items via `tab.history {beforeItemId}`. Core is single-threaded and the **delta coalescer is the only writer** of transcript text: pending deltas are applied to state only when their event gets a seq, and any snapshot first flushes that stream → snapshot + seq is atomic by construction. Clients subscribe only to tabs they display; the workspace stream carries status, `turn.finished`, `request.opened` → badges/notifications for unsubscribed tabs.

**Transcript is normalized in core** (the first attempt's `chat/stato.ts` reducer moves to core; clients never see SDK messages). Items carry `itemId` and `sourceUuid` (JSONL message uuid). Kinds: `user {text, imageRefs?, from}`, `assistantText`, `thinking`, `toolCall {name, input, result?, isError?}`, `turnEnd {costUsd?, durationMs?, interrupted?, error?}`, `notice {level, text}`, `compactBoundary`, `localCommandOutput`, `shell {command, output, exitCode?}`, `peerMessage {from, text}` (a message from another Claude session, §9.9). Streamed item identity = (message id, block index); the final `assistant` frame emits `item.updated` on the same item, never a second `item.added`. Images live in a per-tab **blob store** (`{imageId, mediaType}` in items, bytes via `blob.get`). Subagent messages (`parent_tool_use_id`) are dropped: the chat shows the Agent call and its result (AtHome shows only native features; the plan to render them was cancelled on 2026-10-06). Unknown SDK types → ignored list (census Part D §4) or debug notice.

**Commands** (Phase 1 set as built; later phases add context, usage, mcp.*, rewind, tasks, settings…; not built yet: `blob.get`, `files.upload`, `tab.suggestFiles` (Phase 2), `client.visibility`, `devices.*`, `fs.browse`, `pair.complete` (Phase 3)):
- Workspace: `tab.create {tabId (client-generated), cwd, resume?, title?, model?, mode?}` (duplicate tabId → existing tab; a session already owned by any tab — dormant included — returns that tab), `tab.close`, `tab.rename` (also renames the stored session), `tab.reorder {index}` (→ workspace event `tab.moved`), `tab.fork {newTabId, upToItemId?}` (refused with `session_busy` while starting/running/waiting; the new tab goes right after the source), `tab.restart` (dead tab: transcript reloaded from the JSONL, new epoch, same session id), `tab.subscribe` / `tab.unsubscribe`, `tab.history`.
- Session: `tab.send {text, images?, pastes?}`, `tab.unqueue {queueId}`, `tab.interrupt`, `tab.restart`, `tab.setModel`, `tab.setMode`, `tab.models`, `tab.commands`, `client.watch {tabId?}` (the chat a client shows; with the page visible, its next queued message waits `queueCountdownMs` = 10 s, `TabMeta.queueCountdown`), `tab.queueHold {queueId}` (stops that countdown: the message comes back for the composer, the rest of the queue pauses), `tabs.continue {text?}` ("Continua": sessions stopped mid-work by a usage limit or an account switch — `TabMeta.interrupted` — get text as a message once their account is free; `tab.setAccount` / `accounts.setDefault` switch every session), `settings.setAutoCompactWindow {tokens?}` (Claude Code's `autoCompactWindow` for every session, flag settings at spawn; live processes restart since the CLI reads it only then; snapshot `autoCompactWindow`, event `settings.updated`), `settings.setDefaultEffort {effort?}` / `settings.setDefaultMode {mode?}` (effort and mode of new sessions: `Workspace.withDefaults` fills them in `tab.create` where the client gave none; forks keep their source's; an effort the model does not offer is fitted when `tab.models` reads the CLI; snapshot `defaultEffort` / `defaultMode`; `settings.updated` always carries every backend setting), `tab.refreshGauges` (composer gauges `TabMeta.context` / `planLimits`, read from a live process only: a summary `getContextUsage` at each turn end, the plan windows at most once a minute per account, and from every `rate_limit_event`'s `unifiedWindows`, the only source for token accounts), `tab.context` (as /context), `tab.usage` (as /usage: cost and the account's plan limits; the SDK's experimental call, isolated in `core/src/usage.ts`), `tab.suggestFiles {query}`, `request.answer {requestId, decision:'allow'|'allowAlways'|'deny', reason?, answers?, planNextMode?}` — **semantic**: core builds the SDK PermissionResult from the stored request (its own suggestions), clients never craft `updatedPermissions`.
- Attachments: images travel inside `tab.send` (within the size limits) and are moved by core into the blob store; other files via `files.upload {tabId, name, mime, bytes}` → stored in `<stateDir>/uploads/<tabId>/`, which core passes to the session as an `additionalDirectories` entry at spawn (no pollution of the user's repo), returns `{fileId, path}` for an `@` mention. Path-based drag (webUtils) only when `backendKind = local`; otherwise the desktop uploads.
- Stored sessions: `sessions.list {cwd}`, `sessions.rename`, `sessions.delete` (both refused with `session_busy` while any tab references the session).
- Notifications: `client.visibility {visible}`, `devices.setPush {subscription}` (remote; used in Phase 3).
- Trust: `trust.check {cwd}` → `{trusted, config:{hooks, mcp, permissions, risks, files}, scope}`, `trust.grant {cwd}`.
- Folders: `fs.browse {path}` (remote, confined to root); desktop local uses the native dialog (capability).
- Devices (remote): `devices.list`, `devices.pairStart {name}`, `devices.revoke {deviceId}`; pre-auth `pair.complete {code}`.

**Idempotency.** `cmd.id` is a client UUID. The client keeps unacknowledged cmds and re-sends them after `welcome` with the same id; core keeps a per-clientId reply cache (last 256 / 5 min) and returns the cached reply instead of re-executing (a command still running shares its promise). `tab.send` uses the cmd id as the SDK user-message uuid (the CLI stores it in the JSONL, verified), so after a core restart (cache gone) **core** finds that uuid in the history loaded at start and does not dispatch the message again.

**Errors.** Codes: `invalid_args`, `too_large`, `not_found`, `untrusted_folder`, `needs_trust`, `session_busy`, `outside_root`, `limit_reached`, `request_resolved`, `unauthorized`, `incompatible_protocol`, `sdk_error`, `internal`. UI translates by code; `message` is the English fallback. Non-fatal SDK errors become `notice` items and never end the turn.

**Multi-client semantics.**
- Requests (permission / question / plan) are core objects broadcast as `request.opened`; first valid answer resolves the SDK promise → `request.resolved {byDevice, outcome}`; later answers get `request_resolved`; SDK abort → `request.cancelled`.
- **Message queue lives in core** (not in the CLI's streaming input, whose queued messages survive a plain `interrupt()`): `tab.send` while a turn runs adds `{queueId, text, from}` to the tab's visible queue; retractable with `tab.unqueue`; dispatched on `result`. The `user` item is appended at dispatch time (matches JSONL order). After an interrupt queued items stay queued (Send now / Remove); exact TUI parity checked in Phase 2. Close/quit discards the queue.
- **Mode and model**: core keeps `mode` (last requested, displayed) and `confirmedMode`. `setMode` calls are chained; success confirms; on rejection mode = confirmedMode + notice + `sdk_error`. Changes the CLI makes itself overwrite both: setMode entries in an answered request's `updatedPermissions` (plan approval "auto-accept edits", "always" suggestions for edits), `system/status.permissionMode` (since CLI 2.1.287 also sent after our own `setPermissionMode`), `init.permissionMode` (since 2.1.287 `init` arrives every turn). An in-flight setMode wins over a stale status until it resolves. The model is two fields: `model` (requested, may be an alias, passed at spawn and to `setModel`) and `activeModel` (what `init` reports, e.g. after `/model haiku` typed as a prompt). Dormant tab: model/mode only update the Tab and are passed as options at spawn.
- **Palette on remote clients**: core forwards `init.terminal_slash_commands` so remote UIs hide terminal-only commands (SDK guidance).
- `conversation_reset` (/clear, plan exit with clear context…): move the session lock and persisted sessionId to `new_conversation_id`, reset the title, new epoch with an empty transcript, push `reset`.

**Liveness and size limits.** App-level `ping`/`pong` every 15 s on every transport; 2 misses → close + reconnect (browsers don't expose WS ping, and handovers leave half-open sockets). The PWA also reconnects on `visibilitychange`/`online`. Back-pressure: drop a socket only if `bufferedAmount` stays above the limit for N seconds of live traffic, never because of a reset/replay burst. Limits in protocol: `tab.send` ≤ 30 MB total, ≤ 5 MB per image, ≤ 20 images; server `maxPayload` 32 MiB; ≤ 4 concurrent unauthenticated sockets. The PWA downsizes photos client-side (long edge ≤ 1568 px, JPEG).

## 4. Core data model (packages/core)
- `CoreConfig {backendId, backendKind, sdk?: Partial<SdkApi> (query, getSessionMessages, getSessionInfo, listSessions, renameSession, deleteSession, forkSession — default: the real SDK; the FakeQuery store in tests), sdkOptions (pathToClaudeCodeExecutable…), stateDir?, allowedRoots: 'any' | string[], notifier?, maxLiveSessions (8), coalesceMs (16), snapshotItems (200), ring, closeTimeoutMs (3000)}`. The spawn hook is core's own (`process.ts`). `notifier` receives semantic notices `{kind: request | turnFinished | error, tabId, title, detail?, waiting, finished}` (waiting: chats with a pending request; finished: chats that finished or stopped while nobody looked — a chat leaves the count when a visible client watches it, it works again or closes; the phone shows one notification with these counts, see `apps/mobile/public/notice.js`, closing the others first since iOS ignores the tag): desktop → main shows an Electron Notification only while the window is unfocused (en/it texts in main); server → Web Push in Phase 3 (VAPID keypair in stateDir, per-device PushSubscription, skipping devices with a visible client; iOS needs the PWA installed, 16.4+). Hosts read `CLAUDE_WRAP_FAKE_SDK=1` to use the scripted fake SDK (`@athome/core/testing`, keyword-driven turns) for e2e.
- `Tab {tabId, title, cwd, sessionId?, status: dormant|starting|idle|running|requires_action|closing|needs_trust|error, model?, mode, confirmedMode?, queue[], lastActivity, error?}`, ordered; ids stable across restarts.
- **Viewing ≠ running.** `tab.subscribe` on a dormant tab loads the frozen history (`getSessionMessages`) and returns a snapshot — no process, no trust gate, no limit. The process starts only on `tab.send` (and on `models`/`commands` when no cached value exists); last results are cached in state. Before the first spawn, the history is reloaded if the stored session's `lastModified` (`getSessionInfo`) changed since it was loaded (no live items yet, so nothing duplicates). Once a process ran in this core run, the history is never read again (a new session gets its id from `init` after its items are already live). `limit_reached` and the trust gate apply only to spawning; an untrusted folder leaves the tab in `needs_trust` until `trust.grant`.
- **Session index over all tabs** (dormant included): `Map<sessionId, tabId>`. Start is a memoized per-tab `startPromise`: status → `starting` synchronously, concurrent callers await the same promise, the lock is re-checked synchronously right before `query()`. `tab.close` during `starting` → `closing`, await startPromise, normal close order. Opening a session whose owner is `closing` awaits its exit, then opens.
- `prepareStart(tab)` runs before **every** spawn (lazy start, restart, crash restart): canonicalize the cwd (`realpath` on Linux; keep the given path on Windows), check it against the current `allowedRoots`, run the trust gate (persisted + session-only set), spawn with that same string, store it as the tab's cwd. Failure → status `needs_trust` (UI shows the trust dialog) or `error`.
- `Session` (one live process per started tab): query, streaming-input queue (`CodaInput` from `sessions.ts`), pending canUseTool resolvers, read loop, exit promise, stderr tail.
- `Transcript`: frozen history + live items, `{epoch, seq}`, byte/count-bounded ring, blob store.
- `connections: Map<connId, {clientId, deviceId?, subscriptions, replyCache}>` (ephemeral); detached on transport close.
- **Persisted** in `stateDir` (atomic tmp + rename, serialized queue — pattern from `statoApp.ts`): `state.json {version, trustedFolders[], tabs[{tabId, title, cwd, sessionId?, model?, mode, cachedModels?, cachedCommands?}], livePids[{pid, startedAt}]}`; `devices.json` (remote, 0600; **server is its only writer**) `{devices[{deviceId, name, tokenHash, createdBy, createdAt, lastSeenAt, push?}]}`, `vapid.json` (0600); `pairing/` dir (0700) for codes created by the CLI. Transcripts are not persisted: the CLI JSONL in `~/.claude/projects` is the source of truth.
- Desktop `stateDir` = Electron userData, overridable via `CLAUDE_WRAP_STATE_DIR` (e2e isolation). Server: `~/.local/state/claude-wrap/`.
- Shared `~/.claude` with terminal sessions: core only **reads** `~/.claude.json` (retry on parse failure: concurrent CLI writers leave `.tmp` files). Opening a session whose JSONL changed in the last few seconds outside core → warning (two writers cannot be fully prevented). `/login` on the server switches the account for PWA sessions too (known, accepted).

## 5. Process lifecycle (packages/core/process)
- Spawn via the SDK's `spawnClaudeCodeProcess` hook; record `{pid, startedAt}` in `state.livePids`; keep the last 64 KB of stderr (the first attempt discarded it) for the tab error (e.g. `shell_tool_missing`).
- **Windows**: on claude exit, `taskkill /T /F` its children with PPID = dead PID and created after its start (port `processi.ts` + tests).
- **Linux**: `detached: true` → own process group; on close `kill(-pgid, SIGTERM)`, `SIGKILL` after 3 s. No startup sweep on Linux (systemd cgroup already guarantees it; a pgid sweep after reboot could hit unrelated processes).
- **Close order** (kept from `sessions.ts`): discard core queue → deny pending requests with `interrupt:true` → `interrupt()` → end input → `close()` → wait ≤ 3 s for exit → `taskkill /T /F /PID <claude>` (Windows, still parented, kills the MCP tree) or group SIGKILL (Linux) → release the session lock after exit.
- **Quit**: desktop `before-quit` → `closeAll` (all sessions in parallel, total cap 8 s, force-kill included) → exit. Server: unit `KillMode=mixed` (SIGTERM to node only), `TimeoutStopSec=15`, `OOMPolicy=continue` (an OOM kill takes down one tab, not the service); `closeAll` on SIGTERM.
- **Core host crash** (desktop, `apps/desktop/src/main/coreProcess.ts`): main restarts the utilityProcess with backoff (250 ms, 1 s, 3 s; max 3 in 60 s, then `core-failed` → error screen); port requests arriving meanwhile are queued and handed over at spawn. Renderer clients notice the closed port and reconnect on their own (no `core:restarted` message needed). At startup core sweeps `state.livePids` (Windows: kill each recorded claude tree if pid + start time still match within 5 s, otherwise the PPID children created after it) **before** accepting `hello`, then clears the list.
- Claude process dies on its own → tab `error` with stderr tail, transcript kept; `tab.restart` resumes the same sessionId (new epoch).
- `maxLiveSessions` (8 on both): counts `starting`/live/`closing` processes; exceeding → `limit_reached` on start (LRU auto-dormant later).

## 6. Security per transport
**Local (desktop).**
- No network listener. Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`; served from privileged `app://claude-wrap` via `protocol.handle` reading from an **in-memory map of built files** (exact path match, `host === 'claude-wrap'`, no filesystem path built from the URL, no `bypassCSP`).
- CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`.
- Navigation and `window.open` blocked; `setPermissionRequestHandler` denies everything except notifications; external links via main's `openExternal` handler, which itself checks `https:`.
- Ports stay inside the preload; the page only gets `connect(backendId) → {send, onMessage, onClose}`. Remote tokens: `safeStorage` in main, never sent to the renderer; pasted pairing links go to main, which runs `pair.complete`.
- Core validates every frame with the protocol schemas (same code as remote).

**Remote (server).**
- Bind `127.0.0.1:3012`; TLS by Tailscale Serve on `:8443`; ufw untouched.
- HTTP: static PWA from an **in-memory map** (`new URL(req.url).pathname` exact match, index.html for SPA routes, 404 otherwise; request-derived paths never touch the filesystem). Host allowlist on **every** request. Headers: same strict CSP as desktop with `connect-src 'self' wss://<host>.<tailnet>.ts.net:8443`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`.
- WS upgrade: `Origin` ∈ {`https://<host>.<tailnet>.ts.net:8443`, `app://claude-wrap`}, `Host` ∈ {ts.net:8443, `127.0.0.1:3012`}; optional (default on) `Tailscale-User-Login` == the owner's login, configured at setup, not in the repo (set by Serve only for tailnet traffic, client copies stripped). Else 403. This header is only an extra filter: a process on the server itself can reach `127.0.0.1:3012` directly and forge it, so the **device token stays the real authentication**.
- Auth: `hello.token` must match a non-revoked device within 5 s, else close 4401. Token = 32 random bytes base64url, stored as SHA-256, compared with `timingSafeEqual`. Revocation closes that device's connections immediately and **cascades** to devices and pending codes it created.
- **Pairing with one-time codes** (the long-lived token never appears in a QR/screenshot): `claude-wrap pair --name phone` (server CLI) writes `stateDir/pairing/<codeHash>.json` (O_EXCL, 0600; name chosen by the issuer, 10 min expiry); an authenticated client's "Add device" does the same through `devices.pairStart`. The QR/link is `https://…:8443/#pair=<code>`; the code is also shown as text. `pair.complete` reads and unlinks the file and returns the device token. The PWA's unpaired screen **accepts a pasted link/code** (iOS: install first, then paste inside the app — Safari and home-screen storage are separate), stores the token in IndexedDB, calls `navigator.storage.persist()`, clears the fragment. A missing token always leads to the pairing screen.
- Root confinement: every path is canonicalized and must lie inside `/srv/progetti`; checked again in `prepareStart`. Each allowed root counts as "too broad" for trust (trusting `/srv/progetti` itself is session-only and exact). **Not a sandbox**: Claude's tools can reach anything user `sasha` can; permission prompts and the trust dialog are the guard; no sudo on the host.
- Logs: metadata only, never tokens or message content.
- **Trust gate** (both backends; `packages/core/src/trust.ts` + `trustGate.ts`, port of `fiducia.ts`, extended): hooks/MCP/permissions/risks from settings files and ancestor `.mcp.json` as today, **plus** frontmatter `hooks` / `mcpServers` / `permissionMode` / Bash `allowed-tools` in commands, skills (any depth) and `.claude/agents/*.md`; `permissions.defaultMode` (acceptEdits/auto/dontAsk/bypass) flagged as a risk; settings keys `fileSuggestion.command`, `statusLine.command`, `subagentStatusLine`, `sandbox` relaxations, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, plus the handoff §4 list. Classification is by **top-level** `Settings` key: a key is risky-candidate when its name or any key nested under it mentions command/helper/url/path/hook; every such key is listed in `CLASSIFIED_SETTINGS` (shown as a risk, or reviewed: managed-only, restrictive, ignored in project files, harmless). `npm run probe` exits 1 and `settingsKeys.test.ts` fails on an unclassified one. Ceiling: a new risky field nested inside an already classified key is not detected (line-based scan of `sdk.d.ts`).
- Rendering: markdown without raw HTML; `components.img` overridden so remote images render as links (prompt-injection exfiltration); lint ban on `dangerouslySetInnerHTML` / `rehype-raw`; MCP UI resources (later) only in a sandboxed iframe.

## 7. Test plan
- **Core unit** (vitest, FakeQuery ported from `sessions.test.ts` `creaQueryFinta`): lifecycle and close order with timings; view-without-spawn; concurrent start (single process); close during starting; session index incl. dormant; `conversation_reset`; core queue (dispatch on result, unqueue, interrupt, close discards); mode confirmed/rejected/CLI-driven; requests first-answer-wins across 2 connections + SDK abort; semantic answers → PermissionResult; epochs, replay, reset on overflow (count and bytes), mid-stream reset; coalescer atomicity (subscribe inside a 16 ms window); item identity (no duplicate final frame); idempotent cmd retry; size limits; normalizer (port all `stato.test.ts` cases); trust (port 16 `fiducia.test.ts` + new risk sources); `prepareStart` confinement + symlink; orphan helpers (port `processi.test.ts`); state store.
- **Protocol contract**: one suite run on 2 transports (in-memory; real `ws` server on an ephemeral port — Electron's MessagePortMain is covered by the desktop e2e): handshake, version mismatch, replay, reset, core restarted with head seq > client lastSeq → reset (not replay), drop after `tab.send` and before the reply → exactly one user item, reconnect with pending cmds → no loss, no duplicates.
- **Client**: reconnect/backoff, ping timeout, resume after drops, store consistency, epoch change.
- **E2E on the fake SDK** (deterministic, zero quota; `CLAUDE_WRAP_FAKE_SDK` scripted scenarios: stream, permission, question, plan, crash). Desktop (`playwright` `_electron`, devDependency in the repo, `CLAUDE_WRAP_STATE_DIR` temp dir): old `fase2`/`fase3a` scenarios rewritten; reload mid-stream; kill utilityProcess → recovery; `![](https://x)` makes no network request; **UI error classes of handoff §5**: request opened while typing keeps focus in the composer, a request resolved elsewhere moves focus to the tab panel (not body), Esc interrupts only the visible tab, Shift+Tab outside the composer navigates normally, exactly one aria-live announcement per request, reload keeps active tab and draft; renderer `typeof require === 'undefined'` and CSP active. PWA (playwright chromium, mobile viewport, real server + core on an ephemeral port): two contexts on one tab (send on A appears on B; request answered on B closes on A with "answered from"); connection drop via a server test hook (`socket.terminate()`) or pausable TCP proxy — not `setOffline`, which leaves open WebSockets alive; wrong Origin/Host (node `ws` client) → 403; missing or revoked token → closed; cwd outside root → `outside_root`; static traversal (`/../`, `..%2f`, `%2e%2e/`) → 404; oversize frame → `too_large`.
- **Real-CLI smoke** (small, `/model haiku` + zero-token local commands): one turn streams, resume keeps the same sessionId, deny-with-reason reaches Claude, quit during a turn → no `claude.exe`/MCP orphans (fixture `.mcp.json` with a fake stdio MCP server that spawns a child), packaged build (`electron-builder --dir`, asarUnpack) starts the core and the CLI.
- **Linux**: orphan test, service stop/restart, OOM behaviour checked on the server during Phase 3.
- **Probe**: `npm run probe` at every SDK bump; diff against `docs/reference/sdk-probe.json` + settings-key classification check.

## 8. As built (Phases 0–1, 2026-10-02): differences from the approved plan
| Plan | As built | Why |
|---|---|---|
| `hello.pending`, `hello.capabilities` | not in hello; the client re-sends unanswered cmds after `welcome` | same guarantee through the reply cache; capabilities had no defined shape yet |
| refusal of a connection: unspecified frame | `fatal {error}` then close | the client must know why (incompatible protocol stops reconnecting) |
| `stream.gone` | `gone {stream}` frame | — |
| client checks the history before re-sending `tab.send` after a core restart | core skips a send whose uuid is already in the loaded history | one place, works for every client |
| model reconciled from `init.model` | `model` (requested) + `activeModel` (reported) | `init` now arrives every turn with the resolved id; overwriting would break the alias picker |
| text item added at `content_block_start` | added at the first non-empty delta | Haiku streams thinking blocks without text |
| `CoreConfig.query` | `CoreConfig.sdk` (all session functions) | sessions list/rename/delete/fork need the SDK store too |
| JSONL mtime before spawn | `getSessionInfo().lastModified` | uses the SDK, no file paths in core |
| preload `connect()` returns the channel | returns a Promise of it | the port arrives asynchronously from main |
| user messages: plain | stamped `origin: {kind:'human'}` | SDK 0.3.287: unattributed input fails closed at strict trust checks |
| desktop user data: Electron default | `%APPDATA%\claude-wrap` in dev and packaged; `CLAUDE_WRAP_STATE_DIR` overrides it (e2e) | same state in both runs; e2e never touch it |

## 9. As built (Phases 2–3 and sub-phases A–C1, 2026-10-02/03)

### 9.1 Hosts
- **Remote server** ([packages/server](../packages/server/src)): `node:http` + `ws` around the same `core`; pairing over
  `POST /pair` (a one-time code becomes a device token, stored hashed), device and push commands are *host commands*
  the server adds to the core's handlers; Origin/Host allow-lists, sessions confined to `allowedRoots`
  (`/srv/progetti`). It serves the PWA build (`no-cache`) and `version.json`. Deploy: [deploy.md](deploy.md).
  Per device it draws the PWA's icons and manifest ([tinted.ts](../packages/server/src/tinted.ts), mark in
  [markIcon.ts](../packages/server/src/markIcon.ts)): `/icon-{180,192,512}.png?accent=rrggbb` in a palette's accent,
  `/manifest.webmanifest?accent&pair&palette&colors` whose `start_url` carries what the setup page chose (iOS keeps
  Safari's storage apart from the installed app's); bounded cache, only the query decides the answer. `GET
  /setup/palettes?code=` gives the backend's palettes to the setup page with a valid pairing code, left unspent.
- **PWA host** ([apps/mobile/src/main.tsx](../apps/mobile/src/main.tsx)): pairing screen, WebSocket connection,
  Web Push through the service worker, version checks (`checkVersion` at every reconnection, back on screen, every
  15 min), gestures (no zoom). Both orientations (until 2026-10-03 portrait only). At start: `?pair=` in the browser →
  the setup page ([SetupScreen.tsx](../packages/ui/src/SetupScreen.tsx): palette, then install steps); `?pair=` in the
  installed app → pairs by itself and turns the carried palette on; `?browser=1#pair=` → pairs the browser at once.
- **Desktop**: the touch app since C2 (`DesktopShell` keeps one connection per backend and passes them as
  `capabilities.backends`: the switch on top of the Home); the local core asks main for the system trash (`trashItem` over `parentPort`,
  [coreHost.ts](../apps/desktop/src/main/coreHost.ts) ↔ [coreProcess.ts](../apps/desktop/src/main/coreProcess.ts)).

### 9.2 Touch UI ([packages/ui/src/touch](../packages/ui/src/touch))
- `App` renders `TouchApp` on every host. Below 1024 px it shows one screen at a time; from 1024 px (`useWide`) the
  same stack is split into **regions** by `regionOf` — left (home, folder sessions, trash), centre (one chat), right
  (files, notes, panels), window (settings) — each showing its last entry, with its own Back (`regionBack`, given to
  the region's screens through a per-region `Touch` value); a sheet opened from a button becomes a popover anchored to
  it (`SheetEntry.anchor`, placed by `SheetHost`). `TouchApp` keeps a **stack of mounted
  screens** (only the top is visible, so going back finds a screen as it was), a stack of **bottom sheets** (a sheet
  opened from another returns to it; a screen entered from a sheet reopens it on the way back), edge swipe, toasts and
  the undo bar, the photo viewer, and the texts other screens put in a chat's composer (`insertInComposer`).
- Screens read live state from the `Touch` context (store snapshot + actions); sheet bodies are elements that read the
  context too, so a sheet always shows the current state.
- Interface rules and catalogue: [design-system.md](design-system.md) (Touch layout).

### 9.3 Sending while Claude works, queue, send now
- `tab.send` during a turn goes to the CLI at once with `priority: 'next'` (read at the next tool step, same turn).
  The CLI's `command_lifecycle` frames (untyped in SDK 0.3.287, capability `msg_lifecycle_v1`) drive the user item's
  `pending` flag (`queued` → `started` = read) and keep the tab "working" while a sent message is unread
  (`held` map in [tab.ts](../packages/core/src/tab.ts)).
- **Queue** (the composer's queue mode): a separate per-tab list in core, persisted; one message at a time when the tab
  is free; paused by Stop (`reason: 'stop'`) and by a rejected `rate_limit_event` (every tab until `resetsAt`, then it
  resumes by itself); ▶ resumes earlier.
- **Stop** = plain `interrupt()` (messages already sent stay sent and run next). **Invia ora** on a waiting message =
  `tab.sendPendingNow` → the CLI's own send-now: an `interrupt` control request with `send_now: true` and the
  message uuid (capability `interrupt_send_now_v1`), sent through the Query's raw `request()` because the SDK types
  lack it; the CLI moves what the turn waits on to the background or ends the turn, so Claude reads the message now.

### 9.4 Folders, files, trash, notes
- The workspace snapshot carries the **Home** (`{kind:'root', path}` on the server, `{kind:'added', folders}` on this
  PC, seeded from the open sessions' folders) and the **project marks** (any level, canonical paths), with
  `folders.updated` to every client. Folder contents are pulled (`folders.list`, with the count of files right
  inside); clients reload after their own changes.
- **File commands** work on a *place*: a tab (its folder, trusted as for the session) or a Home folder (inside the
  roots, no trust: browsing is the user's own action). [files.ts](../packages/core/src/files.ts) resolves every path in
  one of three modes (target / create / entry) so nothing reaches outside the folder through `..` or symlinks; `.git`
  is hidden and protected; non-photo attachments go to `allegati/` (added to `.git/info/exclude`).
- **Trash**: on the server one app trash (`<stateDir>/trash`, 7 days, project marks kept); on this PC the system trash.
- **Notes**: per canonical folder in `notes.json`, `notes.changed` to every client; the 20% rule of "use in a message"
  is in the UI ([notes.ts](../packages/ui/src/notes.ts)).

### 9.5 Sessions: open and saved
- **Open session** = a tab of the core (title, folder, mode, model, effort, queue, pause; persisted in `state.json`),
  with a CLI process only while it works or waits (lazy start, at most 8 live). **Saved session** = the CLI's JSONL
  (`listSessions`). An open session that sent something has both (same session id): lists show it once, among the
  open ones.
- A tab where nothing was ever sent (no session id, no queue) is not restored after a restart; the touch UI closes it
  when its chat is left with an empty composer.
- The tab title follows the session's own title at every turn end while `autoTitle` (set when no title was given;
  off after a rename): `getSessionInfo`'s custom title — which includes the title the CLI generates after the first
  prompt — else the first 3 words of the first prompt ([tab.ts](../packages/core/src/tab.ts) `tabTitle`).
- **The tab title is the session's name for the other sessions** (ListAgents, SendMessage, also across folders): the
  CLI starts with `CLAUDE_CODE_SESSION_NAME` = the title, and a live session gets every new title through the
  `rename_session` control request (`source: 'remote'` for the automatic one, `'host'` for the user's; the CLI stores
  it as the session's title, so it then stays). A refused automatic rename is ignored; a refused user rename reaches
  the user. The CLI never renames itself after its generated title (probed on 2.1.287).

### 9.6 Updates
- Server: `claude-wrap-update.timer` → `install.sh main --when-idle` (build, tests on the server, switch only while
  `activity.json` says no session works; `.failed` releases skipped). PWA: `__APP_BUILD__` compiled in vs the served
  `version.json` → update bar and Settings → App.

### 9.7 Claude accounts
- [accounts.ts](../packages/core/src/accounts.ts): besides Claude Code's own login of the backend, accounts added with a
  token made by `claude setup-token` (format checked when added), a name each, in `<stateDir>/accounts.json` (mode
  0600). Tokens never leave core: clients get `{accountId, name, addedAt}` (`accounts.updated`, snapshot `accounts` /
  `defaultAccount`). Commands: `accounts.add`, `accounts.rename`, `accounts.remove`, `accounts.setDefault`,
  `tab.setAccount`.
- The token reaches the CLI as `CLAUDE_CODE_OAUTH_TOKEN` in that process's `Options.env`; no account = the login.
- **One account for every session**: a switch anywhere moves every tab and the new ones. A switch restarts each live
  process on the same stored session (the conversation stays); a session at work is stopped at once and marked
  `interrupted`, like one stopped by a usage limit, and waits — queue included — for "Continua" (`tabs.continue`) or a
  message.
- Usage limits are kept per account (`limitedUntil` in TabMeta; plan windows from `/usage` and from every
  `rate_limit_event`, since `/usage` gives no limits for setup-token accounts). Real-CLI check: `npm run smoke:accounts`.

### 9.7b Keyboard on the iPhone (2026-10-05)
- [keyboard.ts](../packages/ui/src/touch/keyboard.ts) follows the visual viewport (`--app-h`) only while a field is
  focused; with none focused the app fills the screen by CSS, because back from the background iOS can still report
  the height without the keyboard. Hiding the app lets the focused field go.

### 9.8 Terminals (2026-10-06)
- **Why in core:** a terminal must outlive the screen showing it and be the same on every device, like a chat; core
  already owns shared state and streams, so a terminal is one more stream.
- [terminals.ts](../packages/core/src/terminals.ts): real shells through **node-pty 1.2 (beta)**, chosen because it
  ships N-API prebuilds for Linux and Windows: no compiler on the server, the same binary in Node 24 and in Electron
  (no rebuild; `npmRebuild: false` in the desktop's electron-builder config, `node_modules/node-pty` unpacked from
  asar, external in electron-vite). Shell: `$SHELL` (else bash), PowerShell on Windows; `TERM=xterm-256color`.
- Opened in a session's folder (`tabId`, trust-gated like files) or a Home folder (`folder`, inside the roots); at most
  `MAX_TERMINALS` (5). The list is on the workspace stream (`terminals` in the snapshot — absent from an older backend
  reads as none — and `terminal.added/updated/removed`); `TerminalMeta` = id, cwd, title, tabId, cols/rows (the last
  client that resized wins), exitCode once the shell ended (it stays listed until closed).
- Each terminal has a `terminal:<id>` stream: raw output gathered for 16 ms per event (`terminal.output`), its end
  (`terminal.exit`); ring 1 MB for replay after a reconnection; the snapshot carries the recent screen (256k chars, cut
  at a line start). Commands: `terminal.open/subscribe/unsubscribe/input/resize/close`.
- Client: `Connection.subscribeTerminal(id, sink)` routes the stream straight to the terminal on screen (high
  frequency, never through the store); the store keeps only the list.
- UI: [TerminalScreen.tsx](../packages/ui/src/touch/TerminalScreen.tsx) — xterm.js loaded on demand, colours from the
  tokens, fit to the screen (resize sent after 120 ms of quiet), key bar on touch screens (see design-system.md).
- **CSP:** `style-src` allows `'unsafe-inline'` on the server and in the desktop, because xterm.js writes its measures
  and theme in `<style>` elements; scripts stay `'self'` only, and images, fonts and connections stay on the backend.
  Alternative kept in mind: xterm's WebGL renderer (strict CSP, but iOS loses the WebGL context in the background).
- **Automatic update:** a terminal running a command (its foreground process is not the shell) counts as work in
  `activity.json`, looked at every 2 s, so the update waits for it — a server left running in a terminal holds the
  updates until it stops. A shell started inside the shell is not seen as work.
- **Limits:** terminals end with core (a restart or an update closes them).

### 9.9 Messages between sessions (2026-10-06)
- Native Claude Code: `SendMessage` / `ListAgents` reach every live session of the machine, in any folder; a session
  is reachable while its CLI process runs (a dormant tab is not, like a closed terminal session).
- A message from another session starts a turn by itself and the CLI emits **no user message** for it: only a
  `command_lifecycle` `started` whose `command_uuid` is the stored message's uuid, and the turn's `result` with
  `origin: {kind: 'peer', name, body, …}`. [tab.ts](../packages/core/src/tab.ts) (`lookUpIncoming`): for a command core
  did not send, it reads the stored message (`getSessionMessages`, whose entries carry `origin` and `is_meta` outside
  the SDK's types), again at 150/250/500 ms while the CLI has not written it (it writes in batches, ~100 ms), and holds
  the live frames meanwhile (≤ 1.5 s), so the `peerMessage` precedes the answer; a result naming it is the fallback.
  Malformed or empty ones show nothing; every failure is caught (an unhandled rejection would stop the core).
- History: stored messages with `origin.kind === 'peer'` become `peerMessage` items, never a user bubble with the
  CLI's envelope ([normalize.ts](../packages/core/src/normalize.ts) `peerOrigin`, `storedPeer`).
- A background subagent's final report reaches its session the same way (`origin` peer with `senderTaskId`), so it
  shows as "Da @<agent>"; its task notification (`origin.kind 'task-notification'`) shows nothing.
- [sdkContract.test.ts](../packages/core/src/sdkContract.test.ts) runs the real `getSessionMessages` on a sample
  session file (temporary `CLAUDE_CONFIG_DIR`, zero tokens), so an SDK bump that drops `origin` fails `npm test`.

### 9.10 Palettes (2026-10-06)
- Palettes live in `<stateDir>/palettes.json` (core, [palettes.ts](../packages/core/src/palettes.ts)); which one is on
  is each device's (`localStorage`). The 17 presets of [presets.ts](../packages/protocol/src/presets.ts) are added once,
  after any saved ones (`palettes-presets.json` remembers it); then they are ordinary palettes.
- No light/dark theme: `touch.css`'s `:root` holds the default palette's colours (`DEFAULT_PALETTE_ID`), shown until
  the app knows the device's palette; a device that never picked one gets the default, else the first
  ([palette.ts](../packages/ui/src/palette.ts) `nextActive`). The iPhone splash screens use the default colours.
- The page points its icon and manifest links at the server's tinted versions (`pointIcons`), so the Home-screen icon
  takes the accent of the palette on when the app is added (iOS keeps it afterwards).
