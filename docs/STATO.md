# STATO — claude-wrap

_Last updated: 2026-10-05 19:03 CEST_

## Current state
**Phases 0–3 and sub-phases A, B, C1 and C2 of the realigned plan are done** ([piano.md](piano.md) §4): the remote
server on the home server, the PWA on the iPhone and the desktop all run the same touch app — one screen at a time on
a phone, three columns from 1024 px. C2 was closed by Sasha on 2026-10-05 ("c2 ok") after trying the desktop built
and installed on the PC by the PC session. Details per session: [storico-sessioni.md](storico-sessioni.md).
- **Live:** commit `f2cdd50` on the home server, installed by the update timer (which now keeps only current,
  previous and the newest failed release); desktop installed on the PC (Start menu → claude-wrap, the
  `win-unpacked` build of C2).
- **Repo:** public on GitHub (`main` only). Two Claude sessions push to `main` (the PC one and the phone one in the
  server dev clone `/srv/progetti/claude-wrap`, which pushes over SSH): pull before working and before committing.
- **Tests:** 208 unit (+2 skipped) on Linux; PWA e2e 31/31 and **desktop e2e 31/31 both on the home server** (PWA with
  Playwright's Chromium, desktop with Electron under `xvfb-run` after Sasha installed `libgtk-3-0t64`); real-CLI
  `smoke:usage` green.
- **Touch app:** everything listed in the 2026-10-03/04 entries of the history (chat, queue with countdown, gauge,
  context/usage panels, accounts, rule 8 wrap/clip) plus, since C2: the wide arrangement (Home column with "Aperte",
  chat in the middle at ~780 px, right panel File | Note and the 🔜 panels, Settings window), popovers by their button,
  hardware keyboard and mouse (Esc, Shift+Tab, ↑/↓ and Ctrl+R history, drop files on chat and explorer), the backend
  switch This PC | servers with "Server…", This PC's added folders with "Aggiungi cartella…". The first desktop UI
  (tab bar, start screen, `style.css`) is gone.
- **Waiting for Sasha:** the 5 questions on the terminal (how to get a PTY on the server — prebuilt `node-pty`,
  build tools via linux stup, or a Python helper —; This PC too; where it opens on the phone; lifetime and limit; key
  bar keys). Colours and logo (palette screenshots in `/srv/progetti/test/palette/`, logo ideas) still undecided.
- **Next:** the terminal in the app, then D (native rewind, cleanup, prototype deletion), then the shared browser.

## Open problems
- Not verifiable from the PC: edge swipe and keyboard on a real iPhone. The final screen-by-screen comparison with the
  prototype was done by Sasha on the desktop (C2 ok); the phone screens were checked one by one while built.
- Auto-update trust model (raised by linux stup, accepted by Sasha): a push to `main` runs on the server without a
  manual step, and the server holds a GitHub key that can push to the account. Restrict or remove that key.
- `queued_command` duplicates: a `tab.send` retried after a core restart, for a message read mid-turn, might
  duplicate it if the stored uuid differs (rare, not verified).
- An unused session with only a photo attached (no text) is closed when you leave it; a never-used session with a
  draft disappears at a server restart (its draft stays orphaned in the device's storage).
- The server has no C/C++ build tools (`gcc`, `make`): native npm modules (e.g. `node-pty` for the terminal) need a
  prebuilt binary or `build-essential` installed by linux stup.
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
| 2026-10-05 | The desktop runs the touch app (App → TouchApp everywhere); the three-column arrangement is the same app from 1024 px, so the PWA in a wide window is the desktop UI too; the first desktop UI deleted | NOTE-CONSEGNA §5: same elements, rearranged; one codebase to keep |
| 2026-10-05 | Menus opened from a button are popovers by it; typing sheets and confirmations opened from a sheet are centred dialogs; Settings is a window | NOTE-CONSEGNA §5 |
| 2026-10-05 | Desktop e2e run on the home server under `xvfb-run` (GTK installed by Sasha); the PC runs them too | The phone session can verify the desktop itself |
| 2026-10-05 | Terminal in the app after C2, shared browser after D; the "Anteprima" idea (dev server preview from the phone) becomes one use of the shared browser | Sasha: "teniamo l'ordine" |
| 2026-10-04 | Limits and plan windows belong to the account the process was started with (`processAccount`); a turn that ends in success without a rejection lifts its account's limit | A switch left the old process reporting "CREAaps"'s weekly limit as "personale"'s |
| 2026-10-04 | Titles from the CLI: its custom title, or its summary when ≤ 80 chars; a stored session is opened without a fixed title | The CLI's summary fell back to a whole prompt and became a fixed title |
| 2026-10-04 | Nothing leaves the screen and text wraps (design-system touch rule 8); `overflow: clip` for anything drawn past an edge | Sasha: "mai nessun elemento possa uscire dallo schermo, testi vanno sempre a capo" |
| 2026-10-04 | PWA e2e also on the home server with Playwright's Chromium (`CLAUDE_WRAP_E2E_CHROME`) | The server has no Chrome; screenshots there found a real layout bug |
| 2026-10-04 | While a chat is on screen (`client.watch` + visible), its next queued message waits a 5 s countdown in the composer (`TabMeta.queueCountdown`, timer in core) and can be stopped (`tab.queueHold`: back into the field, the rest of the queue paused); otherwise the queue goes at once | Sasha: "un messaggio in coda parte solo dopo 5 secondi di count down … dove io posso fermare" |
| 2026-10-04 | An empty queue is never paused (a Stop or ⏸ pause ends when the last message leaves it), except by a usage limit | Sasha: "la coda non può mai essere in pausa quando è vuota tranne quando i token sono finiti" |
| 2026-10-04 | Shared browser (a Chromium on the server driven by Claude, seen and touched in the app) designed after C2 and D | Sasha: "teniamo l'ordine" |
| 2026-10-04 | A second Claude session in the server dev clone pushes to `main` too; every session pulls before working | Sasha works on claude-wrap from the phone through it |
| 2026-10-04 | Accounts can be renamed (token kept) | Sasha: "posso dare un nome ai token?" |

## Backlog
1. **Terminal in the app** (Sasha, 2026-10-05; after C2): an interactive shell through core (`node-pty`, rebuilt for
   Electron) and `xterm.js` — desktop: a third tab of the right panel (File | Note | Terminale); phone: its own screen
   with a key bar (Esc, Tab, Ctrl, arrows, |, ~); several terminals that survive a reconnection; folders inside the
   roots only.
2. **D** — native rewind (code / conversation / both, with preview), then cleanup: delete the prototype (server folder, `cw-prototipo` service, port 3013 in
   `~/.claude/porte.md`, local copy) after the final comparison.
3. **Shared browser** — after D: who has control, touch and keyboard from the phone, where it opens, one per session or
   one per server (memory), isolated profile (see open problems).
4. **Colours and logo** (Sasha, 2026-10-04): replace Claude's palette and the "cw" mark (tokens in `touch.css`,
   `manifest.webmanifest`, `index.html` theme colour, `apps/mobile/scripts/icons.ts` for icons and splash
   screens); maybe the name.
5. Server heartbeat for WebSockets (dead connections; "visible" only with recent signs of life) — see Open problems.
6. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
7. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done in the PWA), config pages, advanced editor.
8. Move the desktop/packaged real-CLI smoke scripts into the repo.
