# STATO — AtHome

_Last updated: 2026-10-08 13:07 CEST_

## Current state
**Phases 0–3, sub-phases A, B, C1, C2 and D's native rewind of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. C2 was closed by Sasha on 2026-10-05 ("c2 ok"). Details per session:
[storico-sessioni.md](storico-sessioni.md).
- **Live:** `main` deploys itself on the home server when no session works (the update timer keeps current, previous
  and the newest failed release). Desktop installed on the PC (Start menu → claude-wrap, the `win-unpacked` build of C2).
- **Since the 2026-10-06 15:46 entry:** **native rewind** (`/rewind`, `/checkpoint`, `/undo`, Esc Esc) done and verified
  on the real CLI: code, conversation or both, file preview, extra confirmation, the prompt back in the composer
  ([architettura.md](architettura.md) §9.11). **Status, MCP servers and Hooks panels** (native `/status`, `/mcp`,
  `/hooks`) done (§9.12). Files and Terminal of a not-yet-trusted folder ask for trust (bug-risolti). The real-CLI smokes
  run on the launching session's account ([procedure.md](procedure.md)). The **shared browser** was built and reverted
  the same evening (decisions). Palettes, app icon, pairing links, session names, messages between sessions, the "working
  for" timer and the unseen-chat badge: earlier entries of [storico-sessioni.md](storico-sessioni.md).
- **Since the 2026-10-07 11:43 entry (phone UI-details session, 2026-10-06/08):** many small touch-UI changes — chat top
  bar one row, model and effort from a brain button in the composer, working-time tab on the composer, copy button on
  code blocks, cancel a message not read yet, folder notes from the folder screen, launch screens grey with the white
  glyph, status bar = top bar with a dark palette; fixes for iPhone scroll lock, selection handles, device revoke
  cascade. Details: [storico-sessioni.md](storico-sessioni.md) 2026-10-08 13:07, [bug-risolti.md](bug-risolti.md).
- **Repo:** public on GitHub (`main` only). Several Claude sessions push to `main` (the PC one and the ones in the
  server dev clone `/srv/progetti/claude-wrap`, which push over SSH): pull before working and before committing, and
  commit only your own paths.
- **Tests (2026-10-07, home server):** `npm test` 294 passed (+2 skipped), including `sdkContract.test.ts` (the real
  `getSessionMessages` on a sample session file); PWA e2e 66/66 (Playwright's Chromium); desktop e2e 36/36 (Electron under
  `xvfb-run`, one known flaky rerun). Real CLI: `smoke:rewind` and `smoke:inspect` pass.
- **Touch app:** the chat, queue with countdown, gauge, context/usage panels, accounts, terminal, wide arrangement,
  backend switch, palettes (Settings → Palette colori) and pairing as described in the history and in
  [design-system.md](design-system.md).
- **Waiting for Sasha:** the **default palette** (now "AtHome chiaro", a placeholder); a try of the "install the app"
  link on the iPhone (does iOS keep the start address with the palette and the code?).
- **Waiting for the PC session:** the packaged desktop on Windows with the terminal (procedure.md "Packaged build",
  step 5) and `npm test` there; `git pull` in its `claude-config` (lean reviewers).
- **Next:** Settings → Permissions and Claude Code settings, then the other "later" panels (backlog).

## Open problems
- **Background subagents end with the process:** the automatic update waits only for sessions in a turn (or terminals
  running a command); a session whose turn ended but whose background subagent still works counts as idle, and the
  restart kills the subagent. `server.md` asks for subagents in the foreground; counting background tasks as work is
  an option offered to Sasha (not asked yet).
- **Not verified for real:** the iOS start address (palette + pairing code) of the installed app; messages between
  sessions end-to-end after the 192c5c2 deploy (the CLI shapes were checked with probes, the flow with the fake SDK).
- Not verifiable from the PC: edge swipe and keyboard on a real iPhone. **Waiting for Sasha's try on the iPhone:** the
  scroll-lock and selection-handle fixes, the "Undo Typing" attempt (fields remounted in the background; if it shows
  again, only iOS's Shake to Undo setting helps), the status bar style chosen at launch (`palette-early.js`), the
  draggable chat scroll indicator. The new launch image needs the app re-added to the Home Screen (iOS caches it).
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
- The Playwright MCP of the server user is loaded by AtHome sessions too and reaches local services (Claude's native
  browser; the shared browser was dropped).
- **Status / MCP / Hooks in a folder not trusted yet** show the raw error in their card instead of the trust prompt;
  "Sign out" shows for every MCP server that has a url.
- Each `smoke:inspect` / smoke run leaves a `projects[/tmp/…]` entry in `~/.claude.json` (harmless; not cleaned, to
  avoid racing other sessions).
- **Rewind:** a core restart between the new process start and its first record shows the uncut history (rare).
- **Flaky e2e:** passed on rerun — PWA "wide window", desktop "a deny reason reaches Claude" and "Up/Down … Ctrl+R".
- **Terminals:** they end with core (restart, update); two devices on one terminal fight over its size; a server left
  running in a terminal holds the automatic update; node-pty is a beta.
- **CSP:** `style-src` allows inline styles for xterm.js (server and desktop).
- Licence/ToS of the SDK and subscription login in a third-party app: before any public release
  ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-08 | Removing a device keeps the cascade (devices paired with codes it made) but never removes the asking device nor what it created; self-revoke refused; the confirmation lists who else goes | Sasha; the phone in use fell in the cascade |
| 2026-10-08 | Launch screens (iOS image and the app's) = flat #8e8e93 with the white pixel `@~`, same place, no tile, no orange; the page is never grey (iOS keeps the launch colour under the status bar) | Sasha: one screen, no old orange |
| 2026-10-08 | With a dark saved palette the status bar style is `black-translucent` (the top bar is its background); `default` otherwise (its text would be white on light colours) | Sasha: status bar the same colour as the chat header |
| 2026-10-07 | Status panel like `/status` plus the settings files; MCP servers and Hooks are session panels, reached from Settings with "Choose a session"; MCP sign-in on a phone by pasting the failed localhost address back (the CLI's own fallback); hooks read-only with the last 50 runs | Sasha; the CLI does the same |
| 2026-10-06 | Rewind = `resume` + `resumeSessionAt` on the same session (not `forkSession`: forks lose the undo history); first message → a new empty session in the same folder; queue paused; an extra "Are you sure?"; only messages after the last `/compact`; Esc Esc on an empty composer; the list follows the CLI's filter (prompts, slash and `!` commands) | Sasha; native behaviour |
| 2026-10-06 | Real-CLI scripts run on the launching session's account (`appAccounts`, `CoreConfig.accountsFile` read-only), not the server's default login | Smokes failed on the default login's weekly limit, a server fact, not a project constraint |
| 2026-10-06 | The shared browser (one Chromium per server, live view, Playwright MCP over CDP) was built and reverted the same evening | Sasha: Claude already has its native Playwright MCP, he does not need to watch it |
| 2026-10-06 | A chat finished (or stopped with an error) while nobody looked: its idle badge takes the accent colour, not pulsing, words unchanged; same on its folder; grey again once opened on any device. The mark is `TabMeta.unseen`, kept and saved by core | Sasha: same colour as "waiting", no extra dot; shared state belongs to core |
| 2026-10-06 | AtHome shows only native Claude Code features: the team-mode plan (capo/operai inside the app, AtHome tools for sessions, agent cards, team view) is cancelled; the code stays at `192c5c2` plus `214f10f`, which only removes the capo/operai names | Sasha: "non voglio aggiungere funzionalità che non native di claude"; subagents stay as Claude makes them |

## Backlog
1. **Settings → Permissions and Claude Code settings** (next), then Memory/Skills/Agents/Styles and Plugins; chat panels
   Tasks/subagents, Todo and Diff.
2. **D cleanup** — delete the prototype (server folder, `cw-prototipo` service, port 3013 in `~/.claude/porte.md`, local
   copy) after the final comparison.
3. **Default palette** — Sasha picks it: `DEFAULT_PALETTE_ID` and its colours in
   [presets.ts](../packages/protocol/src/presets.ts), `touch.css` base tokens, then the splash screens
   ([procedure.md](procedure.md) "Splash screens and icons").
4. Optional: background subagents count as work for the automatic update (see Open problems).
5. Server heartbeat for WebSockets (dead connections; "visible" only with recent signs of life).
6. Terminal follow-ups proposed, not asked yet: one size per terminal shared by devices, text size, names.
7. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
8. Phase 4+ — config pages and advanced editor (the data panels are in item 1).
9. Move the desktop/packaged real-CLI smoke scripts into the repo; rerun `smoke:composer` on the session's account.
10. Undo for the queue card's bin; split `dragToClose` in `SheetHost.tsx` (~40 lines).
