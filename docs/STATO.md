# STATO — AtHome

_Last updated: 2026-10-08 21:01 CEST_

## Current state
**Phases 0–3, sub-phases A, B, C1, C2 and D's native rewind of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. Details per session: [storico-sessioni.md](storico-sessioni.md).
- **Live:** `main` deploys itself on the home server when no session works (the update timer keeps current, previous
  and the newest failed release). Desktop installed on the PC (Start menu → claude-wrap, the `win-unpacked` build of C2).
- **Native panels done:** rewind (§9.11), Status / MCP servers / Hooks (§9.12), Permissions, Claude Code settings
  (`/config`) and Memory (`/memory`) — the last three by the phone session and the main-plan session (history entries
  of 2026-10-08).
- **New since the 2026-10-08 21:01 entry — the first deliberate exception to "native features only":** **chat widgets**
  (Claude puts a ```` ```widget ```` block in a reply; the app runs it in an isolated frame with the app's colours;
  `/creawidget` and a library in `~/.claude/widgets`; opt-in in Settings with its token cost), the **action API**
  (`actions.run`: one vocabulary of actions with a policy per caller), the **`athome` command** over a local socket
  (a person, Claude through Bash, scripts) and **plans**: a caller with a key (Petra) proposes a summary and ordered
  steps, the user approves them on the phone, the caller runs only those steps in that order. Tested end to end on the
  live server on 2026-10-08 evening. Guide for Petra: [reference/athome-command.md](reference/athome-command.md);
  design: [architettura.md](architettura.md) §9.13–9.14.
- **Repo:** public on GitHub (`main` only). Several Claude sessions push to `main` (the PC one and the ones in the
  server dev clone `/srv/progetti/claude-wrap`, which push over SSH): pull before working and before committing, and
  commit only your own paths — from a temporary index when another session has staged work ([procedure.md](procedure.md)).
- **Tests (2026-10-08, home server):** `npm test` 410 passed (+2 skipped); PWA e2e 96/96 (Playwright's Chromium);
  desktop e2e 39/39 (Electron under `xvfb-run`). Real CLI: `smoke:rewind` and `smoke:inspect` pass (2026-10-07); the
  athome command and a plan verified by hand on the live server.
- **Waiting for Sasha:** revoke the temporary device **"pulizia-test"** (Settings → Devices; used for the test
  clean-up, a device cannot revoke itself); add `~/.local/bin/athome`, the terminal
  socket and the new state files to `~/claude-config/server/inventario.md`; the **default palette**; the iPhone "install the app" link try.
- **Waiting for the PC session:** the packaged desktop on Windows with the terminal (procedure.md "Packaged build",
  step 5) and `npm test` there; `git pull` in its `claude-config` (lean reviewers).
- **Next:** Petra's port when she exists (the socket + key serve a program on the server; a container needs the socket
  folder mounted; another device would need a network API — decided then), keys made from the app (backlog 1), the
  remaining "later" panels.

## Open problems
- **"A person at a terminal" is detected from the TTY** (keys, direct actions): a program of the same user can fake it
  (`script`), as the live test did on purpose. Protects against ordinary use and prompt injection, not a deliberate
  program. Keys made from the app would close it (backlog 1).
- **Trust gate in the live test:** the plan's `prompt.send` went through in a folder never trusted explicitly; most
  likely Sasha trusted the chat on the phone between two commands — to confirm. If not, check `prepareStart` for
  sessions started by plans.
- **Closed plans are not listed:** `plan status` says `closed` for done / rejected / cancelled / expired alike.
- **Background subagents end with the process:** the automatic update waits only for sessions in a turn; a session
  whose background subagent still works counts as idle. `server.md` asks for subagents in the foreground.
- **Not verified for real:** the iOS start address (palette + pairing code) of the installed app; messages between
  sessions end-to-end after the 192c5c2 deploy; on a real iPhone the scroll-lock and selection fixes, the status bar
  style at launch, the draggable scroll indicator (the launch image needs the app re-added to the Home Screen).
- Auto-update trust model (accepted by Sasha): a push to `main` runs on the server without a
  manual step, and the server holds a GitHub key that can push to the account. Restrict or remove that key.
- A change of the build command makes the first automatic update fail: fix by hand ([deploy.md](deploy.md)).
- `queued_command` duplicates after a core restart for a message read mid-turn (rare, not verified). An unused session
  with only a photo is closed when left; a never-used session with a draft disappears at a server restart.
- SDK runtime behaviour outside the 0.3.287 types (raw control requests, `command_lifecycle`, `origin`/`is_meta`):
  `smoke:composer` and `sdkContract.test.ts` catch a change at the next SDK bump.
- Global cb hooks (`~/.claude/settings.json`) also run in AtHome sessions: to discuss with Sasha.
- The server keeps a WebSocket that iOS suspended as "visible" (no heartbeat): a push can be skipped (rare).
- Accounts added with `claude setup-token` cannot read the plan limits through `/usage`.
- The Playwright MCP of the server user is loaded by AtHome sessions too and reaches local services.
- Status / MCP / Hooks in a folder not trusted yet show the raw error; "Sign out" shows for every MCP server with a url.
- Each smoke run leaves a `projects[/tmp/…]` entry in `~/.claude.json` (harmless).
- **Flaky tests:** the plan-expiry unit test under full-suite load (now 500 ms / 5 s); PWA "wide window", desktop
  "a deny reason reaches Claude" and "Up/Down … Ctrl+R" pass on rerun.
- **Terminals:** they end with core; two devices on one terminal fight over its size; node-pty is a beta.
- **CSP:** `style-src` allows inline styles for xterm.js; the widget frame has its own policy (no network).
- Licence/ToS of the SDK and subscription login in a third-party app ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-08 | **Chat widgets are the one explicit exception to "native features only"**: ```` ```widget ```` / ```` ```widget:<name> ```` blocks, an isolated frame (opaque origin, own CSP, no network), the app's tokens and base styles, opt-in with the guide appended to the system prompt and `/creawidget` installed as a native custom command | Sasha wanted interactive widgets Claude builds with the user; the rest stays native |
| 2026-10-08 | One **action API** in core (`actions.run`), a policy per caller: widgets act on a tap (heavy actions confirmed in the chat); the `athome` command over a local Unix socket (no token, file permissions) — a person acts at once, Claude in an AtHome session confirms in its chat (`CLAUDE_WRAP_TAB_ID`), other programs read only; no writes to open sessions from the terminal; 10 new sessions/hour; program-started sessions in "ask permissions"; `actions.jsonl` log. All limits in one policy, each liftable later | Sasha: "chiunque da terminale, compreso Claude"; MCP rejected (not native, no good for Petra); risks explained and the safest mix chosen |
| 2026-10-08 | **Plans** for callers with a key (Petra): summary + ordered steps, approved on the phone (a card in the app's own words, free text and existing targets marked, push notification); only the next step with the approved arguments runs, no per-action confirmation; `session.follow` lets the caller answer Claude's requests for one turn; 24 h expiry; keys made only by a person at a terminal; **every other caller keeps the maximum limits** | Sasha: "approvare un progetto, non i singoli comandi"; "Petra deve saper fare tutto"; "gli altri tornano ad avere i limiti per la sicurezza totale" |
| 2026-10-08 | Petra will be a program on the server: comando + socket; other ports (container, network API with tokens) designed only when needed | Sasha, after the options were laid out |
| 2026-10-08 | Removing a device keeps the cascade but never removes the asking device nor what it created; self-revoke refused | Sasha; the phone in use fell in the cascade |
| 2026-10-08 | Launch screens flat #8e8e93 with the white `@~`; with a dark palette the status bar is `black-translucent` | Sasha: one screen, same colour as the chat header |
| 2026-10-07 | Status panel like `/status`; MCP servers and Hooks as session panels; MCP sign-in on a phone by pasting the localhost address back; hooks read-only | Sasha; the CLI does the same |
| 2026-10-06 | Rewind = `resume` + `resumeSessionAt` on the same session; first message → a new empty session; an extra "Are you sure?" | Sasha; native behaviour |
| 2026-10-06 | The shared browser was built and reverted the same evening | Sasha: Claude has its native Playwright MCP |
| 2026-10-06 | AtHome shows only native Claude Code features: the team-mode plan is cancelled (superseded on 2026-10-08 by the one widgets exception above, nothing else) | Sasha: "non voglio aggiungere funzionalità che non native di claude" |

## Backlog
1. **Keys made from the app** (a tap on the phone creates/revokes a caller's key) instead of the terminal: closes the
   TTY-detection hole. Then: list the callers and their plans (open and recent) in Settings; closed plans with their
   outcome in `plan status`.
2. **Petra's port** when she exists (container: mount the socket folder; another device: a network API with scoped,
   revocable tokens over Tailscale). `athome session read` beyond the recent items.
3. **Remaining "later" panels:** Skills, Agents, Styles, Plugins; chat panels Tasks/subagents, Todo and Diff.
4. **D cleanup** — delete the prototype (server folder, `cw-prototipo` service, port 3013, local copy).
5. **Default palette** — Sasha picks it ([procedure.md](procedure.md) "Splash screens and icons").
6. Optional: background subagents count as work for the automatic update; server heartbeat for WebSockets.
7. Terminal follow-ups: one size per terminal shared by devices, text size, names.
8. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
9. Move the desktop/packaged real-CLI smoke scripts into the repo; rerun `smoke:composer` on the session's account.
10. Undo for the queue card's bin; split `dragToClose` in `SheetHost.tsx` (~40 lines).
