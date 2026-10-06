# STATO — AtHome

_Last updated: 2026-10-06 11:16 CEST_

## Current state
**Phases 0–3 and sub-phases A, B, C1 and C2 of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. C2 was closed by Sasha on 2026-10-05 ("c2 ok") after trying the desktop built
and installed on the PC by the PC session. Details per session: [storico-sessioni.md](storico-sessioni.md).
- **Live:** `main` at `4316848` (one question at a time), installed by the update timer when no
  session works (it keeps only current, previous and the newest failed release); desktop installed on the PC (Start
  menu → claude-wrap, the `win-unpacked` build of C2).
- **Since the last buonanotte (2026-10-05 19:03):** the **terminal in the app** (backlog 1, done: node-pty shells in
  core shared through the protocol, xterm.js on the phone with a key bar and in the desktop's right panel; it holds
  the automatic update while a command runs; leaving asks to close it; "Chiudi tutti"; Copia tutto / Incolla; links),
  **one notification** with the counts of chats waiting / finished, keyboard-space and end-of-chat bounce fixes,
  vivid reds, working time in minutes, model under the chat's title, + first, a queue button that queues directly
  (no queue mode) — the phone session, 2026-10-06 11:12 entry; plus the "New sessions" defaults and other composer,
  queue and sheet changes (11:02 entry); then the queue button as a filled circle with a small round count, a bin
  on the queue card, sheets that close when their content is dragged down from the top, and a 10 s queue countdown
  (11:16 entry). Details in [storico-sessioni.md](storico-sessioni.md).
- **Repo:** public on GitHub (`main` only). Two Claude sessions push to `main` (the PC one and the phone one in the
  server dev clone `/srv/progetti/claude-wrap`, which pushes over SSH): pull before working and before committing.
- **Tests (2026-10-06, home server):** 443 unit + contract (+4 skipped); PWA e2e 40/40 (Playwright's Chromium);
  desktop e2e 32/32 (Electron under `xvfb-run`); real-CLI `smoke:usage` green last time it ran (2026-10-05).
- **Touch app:** everything listed in the 2026-10-03/04 entries of the history (chat, queue with countdown, gauge,
  context/usage panels, accounts, rule 8 wrap/clip) plus, since C2: the wide arrangement (Home column with "Aperte",
  chat in the middle at ~780 px, right panel File | Note and the 🔜 panels, Settings window), popovers by their button,
  hardware keyboard and mouse (Esc, Shift+Tab, ↑/↓ and Ctrl+R history, drop files on chat and explorer), the backend
  switch This PC | servers with "Server…", This PC's added folders with "Aggiungi cartella…". The first desktop UI
  (tab bar, start screen, `style.css`) is gone.
- **Waiting for Sasha:** colours and logo (palette screenshots in `/srv/progetti/test/palette/`, logo ideas; a
  `palettes` worktree of another session sits in `.claude/worktrees/`, untracked, its tests failing in `npm test`).
- **Waiting for the PC session:** the packaged desktop on Windows with the terminal (procedure.md "Packaged build",
  step 5) and `npm test` there (the terminal tests have only run with bash).
- **Next:** D (native rewind, cleanup, prototype deletion), then the shared browser.

## Open problems
- Not verifiable from the PC: edge swipe and keyboard on a real iPhone. The final screen-by-screen comparison with the
  prototype was done by Sasha on the desktop (C2 ok); the phone screens were checked one by one while built.
- Auto-update trust model (raised by linux stup, accepted by Sasha): a push to `main` runs on the server without a
  manual step, and the server holds a GitHub key that can push to the account. Restrict or remove that key.
- `queued_command` duplicates: a `tab.send` retried after a core restart, for a message read mid-turn, might
  duplicate it if the stored uuid differs (rare, not verified).
- An unused session with only a photo attached (no text) is closed when you leave it; a never-used session with a
  draft disappears at a server restart (its draft stays orphaned in the device's storage).
- `tab.sendPendingNow` and `cancelAsyncMessage` use SDK runtime methods outside the 0.3.287 types (the Query's raw
  control request): `smoke:composer` catches a change at the next SDK bump.
- Global cb hooks (`~/.claude/settings.json`) also run in claude-wrap sessions: to discuss with Sasha.
- The server keeps a WebSocket that iOS suspended as "visible" (no server-side heartbeat): a push notification can be
  skipped when the app was put away before it said it was hidden (rare). Proposed: server ping + "visible" only with
  recent signs of life.
- Accounts added with `claude setup-token` cannot read the plan limits through the CLI's `/usage` (no profile scope):
  their gauge comes only from `rate_limit_event`s (`unifiedWindows`, outside the SDK's types), so it fills after a turn.
- The CLI's session `summary` falls back to a prompt for long sessions: such titles are not adopted (> 80 chars), so a
  long session keeps the folder's name unless renamed.
- The composer gauge's context share is the CLI's quick estimate (`detail: 'summary'`), which can differ from the
  full /context of the Contesto panel.
- The Playwright MCP installed for the server user (by linux stup) is loaded by claude-wrap sessions too
  (`settingSources` includes `user`), and the browser it drives reaches local services (127.0.0.1): a page could steer
  Claude there (prompt injection). To weigh in the shared-browser design.
- **Two sessions in one clone:** more than one Claude session can work in `/srv/progetti/claude-wrap` at once; one
  commit swept in the other's unfinished work (bug-risolti). Commit only your own paths; a separate worktree per
  session would avoid it altogether.
- **Flaky e2e:** passed on rerun — PWA "wide window" (once), desktop "a deny reason reaches Claude" and "Up/Down …
  Ctrl+R" (once each). Timing, not app bugs so far; watch them.
- **Terminals:** they end with core (restart, update); two devices on one terminal fight over its size (the last to
  resize wins); a server left running in a terminal holds the automatic update until stopped; node-pty is a beta.
- **CSP:** `style-src` allows inline styles for xterm.js (server and desktop); the WebGL renderer would keep it strict.
- Licence/ToS of the SDK and subscription login in a third-party app: before any public release
  ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-06 | Settings → "Nuove sessioni": default effort and permission mode kept by the backend (`state.json`), applied in `tab.create` only (new and reopened sessions); a mode given at creation wins; forks keep their source's; open sessions keep theirs | Sasha agreed to the five proposed answers |
| 2026-10-06 | Every mode can be the default, the risky ones (`auto`, `dontAsk`, `acceptEdits`) included, with no warning | Sasha: "lascio scegliere liberamente" |
| 2026-10-06 | A default effort the model does not offer is fitted (highest level below) when the models are read from the CLI | Same rule as a model change (`fitEffort`); before that the CLI downgrades silently |
| 2026-10-05 | The desktop runs the touch app (App → TouchApp everywhere); the three-column arrangement is the same app from 1024 px, so the PWA in a wide window is the desktop UI too; the first desktop UI deleted | NOTE-CONSEGNA §5: same elements, rearranged; one codebase to keep |
| 2026-10-06 | Terminal: node-pty 1.2 beta (N-API prebuilds, no compiler, no rebuild for Electron); shells in core, one `terminal:<id>` stream each, max 5, shared by every device | No build tools on the server; a terminal must outlive its screen like a chat |
| 2026-10-06 | CSP `style-src 'unsafe-inline'` for xterm.js rather than its WebGL renderer | Smallest change; scripts, images, fonts and connections stay locked; WebGL is lost by iOS in the background |
| 2026-10-06 | A command running in a terminal counts as work for the automatic update | Sasha picked it first: an update must not kill a running command |
| 2026-10-06 | Leaving a terminal asks "Chiudere il terminale?" every time; "Chiudi tutti i terminali" in the Home; never closed on leaving the app | Sasha: "1b" + "2"; iOS leaves the app on every app switch |
| 2026-10-06 | The next queued message counts down 10 s (was 5) while its chat is on screen | Sasha |
| 2026-10-06 | The bin on the queue card removes the next message at once, no confirmation (toast only) | Sasha asked for a quick bin; an undo is in the backlog |
| 2026-10-06 | A sheet closes when its content is dragged down from the top, not only by the head | Sasha: "voglio che anche scrollando il contenuto si chiuda" |
| 2026-10-06 | The queue button is a filled circle like Send and Stop, in the text colour | Sasha: "alla pari di invio o stop" |
| 2026-10-06 | The queue button queues what is written at once; no queue mode; Send always sends | Sasha: "deve direttamente mandare in coda il contenuto della input bar" |
| 2026-10-06 | The model and effort sit under the chat's title; + is the first composer button | Sasha |
| 2026-10-05 | One phone notification for every chat, with the counts of chats waiting and finished; tap → that chat or the open sessions | Sasha: "sempre solo una notifica con il numero di chat" |
| 2026-10-05 | Terminal in the app after C2, shared browser after D; the "Anteprima" idea (dev server preview from the phone) becomes one use of the shared browser | Sasha: "teniamo l'ordine" |

## Backlog
1. **D** — native rewind (code / conversation / both, with preview), then cleanup: delete the prototype (server folder, `cw-prototipo` service, port 3013 in
   `~/.claude/porte.md`, local copy) after the final comparison.
2. **Shared browser** — after D: who has control, touch and keyboard from the phone, where it opens, one per session or
   one per server (memory), isolated profile (see open problems).
3. **Colours and logo** (Sasha, 2026-10-04): replace Claude's palette and the "cw" mark (tokens in `touch.css`,
   `manifest.webmanifest`, `index.html` theme colour, `apps/mobile/scripts/icons.ts` for icons and splash
   screens); maybe the name.
4. Server heartbeat for WebSockets (dead connections; "visible" only with recent signs of life) — see Open problems.
5. Terminal follow-ups proposed, not asked yet: one size per terminal shared by devices, text size, names.
6. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
7. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done in the PWA), config pages, advanced editor.
8. Move the desktop/packaged real-CLI smoke scripts into the repo.
9. Undo for the queue card's bin (toast with "Annulla"); split `dragToClose` in `SheetHost.tsx` (~40 lines).
