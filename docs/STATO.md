# STATO — claude-wrap

_Last updated: 2026-10-06 11:02 CEST_

## Current state
**Phases 0–3 and sub-phases A, B, C1 and C2 of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. C2 was closed by Sasha on 2026-10-05 ("c2 ok") after trying the desktop built
and installed on the PC by the PC session. Details per session: [storico-sessioni.md](storico-sessioni.md).
- **Live:** `main` at `cdca724` (default effort and mode for new sessions), installed by the update timer when no
  session works (it keeps only current, previous and the newest failed release); desktop installed on the PC (Start
  menu → claude-wrap, the `win-unpacked` build of C2).
- **Since the last buonanotte (2026-10-05 19:03):** the terminal in the app shipped (core shells, phone screen,
  desktop panel, Copy all / Paste / links, holds the update) plus composer, queue, sheet and notification changes —
  22 commits `88b0f49`…`f1c09e3` by the other session, which documents them in its own buonanotte; this session added
  the "New sessions" settings ([storico-sessioni.md](storico-sessioni.md), 2026-10-06 entry).
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
- Licence/ToS of the SDK and subscription login in a third-party app: before any public release
  ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-06 | Settings → "Nuove sessioni": default effort and permission mode kept by the backend (`state.json`), applied in `tab.create` only (new and reopened sessions); a mode given at creation wins; forks keep their source's; open sessions keep theirs | Sasha agreed to the five proposed answers |
| 2026-10-06 | Every mode can be the default, the risky ones (`auto`, `dontAsk`, `acceptEdits`) included, with no warning | Sasha: "lascio scegliere liberamente" |
| 2026-10-06 | A default effort the model does not offer is fitted (highest level below) when the models are read from the CLI | Same rule as a model change (`fitEffort`); before that the CLI downgrades silently |
| 2026-10-05 | The desktop runs the touch app (App → TouchApp everywhere); the three-column arrangement is the same app from 1024 px, so the PWA in a wide window is the desktop UI too; the first desktop UI deleted | NOTE-CONSEGNA §5: same elements, rearranged; one codebase to keep |
| 2026-10-05 | Menus opened from a button are popovers by it; typing sheets and confirmations opened from a sheet are centred dialogs; Settings is a window | NOTE-CONSEGNA §5 |
| 2026-10-05 | Desktop e2e run on the home server under `xvfb-run` (GTK installed by Sasha); the PC runs them too | The phone session can verify the desktop itself |
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
5. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
6. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done in the PWA), config pages, advanced editor.
7. Move the desktop/packaged real-CLI smoke scripts into the repo.
