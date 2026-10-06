# STATO — AtHome

_Last updated: 2026-10-06 15:46 CEST_

## Current state
**Phases 0–3 and sub-phases A, B, C1 and C2 of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. C2 was closed by Sasha on 2026-10-05 ("c2 ok"). Details per session:
[storico-sessioni.md](storico-sessioni.md).
- **Live:** `192c5c2` (messages from other sessions); `214f10f` (no capo/operai names in the code) is built and
  goes live when no session works. The update timer keeps only current, previous and the newest failed release. Desktop
  installed on the PC (Start menu → claude-wrap, the `win-unpacked` build of C2).
- **Since the 11:16 buonanotte:** the app is **AtHome** with the "@~" mark (other session, `0192a0b`); **colour
  palettes** saved on the backend and picked per device (other session, `6ab0a83`), then 17 preset palettes, a default
  one and no more light/dark theme; the **app icon** in the palette's accent; **"Aggiungi dispositivo" with two links**
  (use it in the browser, or install the app with a palette); **session names** = tab titles; **messages between
  sessions** shown as "Da @nome"; open sessions ordered by last use (other session, `353cebc`); answered questions kept
  in the chat (`9d9bf10`). At 15:41 the **"working for" timer** is kept by core (`6c3dfd1`): it survives reopening the app and
  stops while Claude waits for an answer (bug-risolti). At 15:46 a chat **finished but not looked at yet** has its badge in the
  accent colour (not pulsing), its folder too (`465e27c`). The team-mode plan (capo/operai inside AtHome) was **cancelled**: AtHome shows only native
  Claude Code features. Details in the 15:32 entry of [storico-sessioni.md](storico-sessioni.md).
- **Repo:** public on GitHub (`main` only). Several Claude sessions push to `main` (the PC one and the ones in the
  server dev clone `/srv/progetti/claude-wrap`, which push over SSH): pull before working and before committing, and
  commit only your own paths.
- **Tests (2026-10-06 15:20, home server):** `npm test` 255 passed (+2 skipped, 15:32), including `sdkContract.test.ts` (the
  real `getSessionMessages` on a sample session file); PWA e2e 46/46 (Playwright's Chromium); desktop e2e 33/33
  (Electron under `xvfb-run`). `smoke:composer` has not run since: the server's default login hit its weekly limit.
- **Touch app:** the chat, queue with countdown, gauge, context/usage panels, accounts, terminal, wide arrangement,
  backend switch, palettes (Settings → Palette colori) and pairing as described in the history and in
  [design-system.md](design-system.md).
- **Waiting for Sasha:** the **default palette** (now "AtHome chiaro", a placeholder); a try of the "install the app"
  link on the iPhone (does iOS keep the start address with the palette and the code?).
- **Waiting for the PC session:** the packaged desktop on Windows with the terminal (procedure.md "Packaged build",
  step 5) and `npm test` there; `git pull` in its `claude-config` (lean reviewers).
- **Next:** D (native rewind, cleanup, prototype deletion), then the shared browser.

## Open problems
- **Background subagents end with the process:** the automatic update waits only for sessions in a turn (or terminals
  running a command); a session whose turn ended but whose background subagent still works counts as idle, and the
  restart kills the subagent. `server.md` asks for subagents in the foreground; counting background tasks as work is
  an option offered to Sasha (not asked yet).
- **Not verified for real:** the iOS start address (palette + pairing code) of the installed app; messages between
  sessions end-to-end after the 192c5c2 deploy (the CLI shapes were checked with probes, the flow with the fake SDK).
- The server's default Claude login is at its weekly limit until 2026-10-09 22:00: real-CLI smokes wait until then
  (`smoke:composer` now also checks the session name).
- Not verifiable from the PC: edge swipe and keyboard on a real iPhone.
- Auto-update trust model (raised by linux stup, accepted by Sasha): a push to `main` runs on the server without a
  manual step, and the server holds a GitHub key that can push to the account. Restrict or remove that key.
- A change of the build command (e.g. the workspace rename) makes the first automatic update fail: the live release's
  `install.sh` builds the new commit; fix by hand ([deploy.md](deploy.md), bug-risolti 2026-10-06).
- `queued_command` duplicates: a `tab.send` retried after a core restart, for a message read mid-turn, might
  duplicate it if the stored uuid differs (rare, not verified).
- An unused session with only a photo attached is closed when you leave it; a never-used session with a draft
  disappears at a server restart (its draft stays orphaned in the device's storage).
- SDK runtime behaviour outside the 0.3.287 types: raw control requests (`interrupt` with send_now,
  `cancelAsyncMessage`, `rename_session`), `command_lifecycle` frames, `origin`/`is_meta` on stored messages.
  `smoke:composer` and `sdkContract.test.ts` catch a change at the next SDK bump.
- Global cb hooks (`~/.claude/settings.json`) also run in AtHome sessions: to discuss with Sasha.
- The server keeps a WebSocket that iOS suspended as "visible" (no server-side heartbeat): a push notification can be
  skipped (rare). Proposed: server ping + "visible" only with recent signs of life.
- Accounts added with `claude setup-token` cannot read the plan limits through `/usage`: their gauge fills only from
  `rate_limit_event`s, after a turn.
- The composer gauge's context share is the CLI's quick estimate, which can differ from the Contesto panel.
- The Playwright MCP of the server user is loaded by AtHome sessions too and reaches local services: to weigh in the
  shared-browser design.
- **Flaky e2e:** passed on rerun — PWA "wide window", desktop "a deny reason reaches Claude" and "Up/Down … Ctrl+R".
- **Terminals:** they end with core (restart, update); two devices on one terminal fight over its size; a server left
  running in a terminal holds the automatic update; node-pty is a beta.
- **CSP:** `style-src` allows inline styles for xterm.js (server and desktop).
- Licence/ToS of the SDK and subscription login in a third-party app: before any public release
  ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-06 | A chat finished (or stopped with an error) while nobody looked: its idle badge takes the accent colour, not pulsing, words unchanged; same on its folder; grey again once opened on any device. The mark is `TabMeta.unseen`, kept and saved by core | Sasha: same colour as "waiting", no extra dot; shared state belongs to core |
| 2026-10-06 | AtHome shows only native Claude Code features: the team-mode plan (capo/operai inside the app, AtHome tools for sessions, agent cards, team view) is cancelled; the code stays at `192c5c2` plus `214f10f`, which only removes the capo/operai names | Sasha: "non voglio aggiungere funzionalità che non native di claude"; subagents stay as Claude makes them |
| 2026-10-06 | Kept, as not team-specific: automatic session name from the first prompt, "Nuova sessione con nome…", messages between sessions across folders ("Da @nome") | Sasha, multiple-choice answers |
| 2026-10-06 | A session's name for the other sessions is its tab's title: the CLI's title after the first prompt (else its first 3 words), a name given at creation, or a rename, which stays | Sasha: "come l'app di Claude" |
| 2026-10-06 | Messages from another session (native `SendMessage`) shown with their sender before the answer; live frames held ≤ 1.5 s while the stored message is read | The CLI emits no user message for them; the history showed the raw envelope as if typed by Sasha |
| 2026-10-06 | No light/dark theme: palettes only. 17 presets (9 light, 8 dark) added once to the backend, editable and deletable; a device without a palette gets the default | Sasha |
| 2026-10-06 | The app icon takes the palette's accent: the server draws icons and manifest per device; iOS keeps the icon taken when the app was added | Sasha; drawing on the server needs no image library |
| 2026-10-06 | "Aggiungi dispositivo": two links for one code — browser (pairs at once) and install the app (setup page with every palette, then the steps); palette and code travel in the start address, the installed app pairs by itself | Sasha: all palettes, one code, automatic pairing |
| 2026-10-06 | Settings → "Nuove sessioni": default effort and permission mode kept by the backend, applied in `tab.create` only; every mode can be the default, no warning | Sasha |
| 2026-10-06 | Terminal: node-pty 1.2 beta, shells in core, one `terminal:<id>` stream each, max 5; a running command counts as work for the automatic update | No build tools on the server; an update must not kill a running command |
| 2026-10-06 | The queue button queues what is written at once (filled circle like Send and Stop); 10 s queue countdown; bin on the queue card without confirmation | Sasha |
| 2026-10-05 | The desktop runs the touch app; the three-column arrangement is the same app from 1024 px | NOTE-CONSEGNA §5: one codebase |
| 2026-10-05 | One phone notification for every chat, with the counts of chats waiting and finished | Sasha |
| 2026-10-05 | Terminal in the app after C2, shared browser after D | Sasha: "teniamo l'ordine" |

## Backlog
1. **D** — native rewind (code / conversation / both, with preview), then cleanup: delete the prototype (server
   folder, `cw-prototipo` service, port 3013 in `~/.claude/porte.md`, local copy) after the final comparison.
2. **Shared browser** — after D: who has control, touch and keyboard from the phone, where it opens, one per session
   or one per server (memory), isolated profile (see open problems).
3. **Default palette** — Sasha picks it: `DEFAULT_PALETTE_ID` and its colours in
   [presets.ts](../packages/protocol/src/presets.ts), `touch.css` base tokens, then the splash screens
   ([procedure.md](procedure.md) "Splash screens and icons").
4. Optional: background subagents count as work for the automatic update (see Open problems).
5. Server heartbeat for WebSockets (dead connections; "visible" only with recent signs of life).
6. Terminal follow-ups proposed, not asked yet: one size per terminal shared by devices, text size, names.
7. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
8. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done), config pages, advanced editor.
9. Move the desktop/packaged real-CLI smoke scripts into the repo; rerun `smoke:composer` after 2026-10-09 22:00.
10. Undo for the queue card's bin; split `dragToClose` in `SheetHost.tsx` (~40 lines).
