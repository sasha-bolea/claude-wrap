# STATO — claude-wrap

_Last updated: 2026-10-04 17:00_

## Current state
**Phases 0–3 are done, and so are sub-phases A, B and C1 of the realigned plan** ([piano.md](piano.md) §4); on
2026-10-03/04 a long session from the phone (in the server's dev clone `/srv/progetti/claude-wrap`) added Sasha's
requests to the PWA one by one, each pushed and deployed by the update timer. Details per session:
[storico-sessioni.md](storico-sessioni.md).
- **Live:** commit `d3a9e28` on the home server (`/srv/apps/claude-wrap/current`), installed by the update timer;
  Sasha uses the PWA from the iPhone (one paired device), on two accounts added with a token ("personale", "CREAaps").
- **Repo:** public on GitHub (`main` only), pushed (from the server over SSH: the clone's `origin` is HTTPS without
  credentials). Tests: 208 unit (+2 skipped) on Linux, 29 PWA e2e green **on the home server** with Playwright's
  Chromium (`CLAUDE_WRAP_E2E_CHROME`), 29 desktop e2e (last run on the PC before this session), real-CLI
  `smoke:usage` green (context, usage, gauges, auto-compact window).
- **PWA (touch UI, `packages/ui/src/touch/`):** Home of folders and projects (+ files row, trash), sessions per folder
  and global, chat with requests inside the conversation, ghost and jump, floating composer with queue deck, "Invia
  ora", file explorer with previews, notes (20% rule; "Usa nel messaggio" as a top bar icon), settings (theme,
  accounts, automatic compaction, devices, notifications), 🔜 placeholders, both orientations, no zoom, splash
  screens, update bar. Added on 2026-10-03/04:
  - chat: own scroll indicator above the composer, smooth glide following new text, a quick drag closes the keyboard,
    ghost leaving upwards and before the next message touches it, commands in a row stacked like the queue (tap to
    spread, "Raggruppa"), queued messages counting down 5 s in the composer while the chat is on screen (Stop puts
    the message back into the field), a light veil under the composer (faint blur, slightly dark gradient);
  - composer gauge (highest of context / 5-hour / weekly use) with its sheet and "Compatta ora"; session menu →
    Contesto and Consumo e limiti panels;
  - accounts: one account for every session, rename, usage limit card (quiet "Passa a …" for the added accounts only,
    Annulla), "Continua" card after a stop by a limit or a switch;
  - nothing leaves the screen and text wraps (design rule 8; one-line exceptions: stack cards, a tool card's command,
    titles clamped to two lines); deleting a folder with sessions open inside it closes them too.
- **Desktop:** runs the touch app since C2.4 (three columns from 1024 px, backend switch on top of the Home, This PC's
  added folders); the old components and the desktop e2e (written for the tab bar) are still in the repo until C2.5.
  Electron cannot start on the home server (no GTK libraries: `libgtk-3.so.0`), so desktop e2e run on the PC.
- **Pending with Sasha:** new colours and logo (not Claude's): four palettes shown as screenshots in
  `/srv/progetti/test/palette/` (A indaco, B verde acqua, C viola, D grafite e lime) and three logo ideas (cw
  monogram, `< • >`, folded square); Sasha asked for an artifact, which this session cannot make — proposed a live
  "Colore" choice in Settings or a prompt for claude.ai. Also: the name "claude-wrap" contains "Claude".
- **Next:** decide colours and logo; then C2 (desktop with the same elements, widths 300/380/~780 px), then D (native
  rewind, cleanup, prototype deletion).

## Open problems
- Not verifiable from the PC: edge swipe and keyboard on a real iPhone; final screen-by-screen comparison with the
  prototype together with Sasha (end of C).
- Auto-update trust model (raised by linux stup, accepted by Sasha): a push to `main` runs on the server without a
  manual step, and the server holds a GitHub key that can push to the account. Restrict or remove that key.
- `queued_command` duplicates: a `tab.send` retried after a core restart, for a message read mid-turn, might
  duplicate it if the stored uuid differs (rare, not verified).
- An unused session with only a photo attached (no text) is closed when you leave it; a never-used session with a
  draft disappears at a server restart (its draft stays orphaned in the device's storage).
- Desktop e2e: two request tests timed out once when run right after the PWA suite; not reproduced in two reruns.
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
- Licence/ToS of the SDK and subscription login in a third-party app: before any public release
  ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-03 | The approved prototype is the UI spec (mobile and desktop); plan realigned in sub-phases A–D | Sasha designed the screens with a prototype session on the server; the old plan predated it |
| 2026-10-03 | 10 prototype decisions: `allegati/` (excluded in `.git/info/exclude`), no "start the queue", one trash, project mark at any level, ↶ and clock icons, effort only with the model's levels, desktop widths fixed, system trash on this PC, Home of this PC seeded from open sessions, iPhone keyboard tricks without a native wrapper | Sasha: "concordo su tutto" ([piano.md](piano.md) §4) |
| 2026-10-03 | Mid-turn messages go to the CLI at once (`priority: 'next'`), `pending` until its `command_lifecycle` says started; a separate per-tab queue (pause after Stop and on usage limits) | Verified on the real CLI: `next` is read at the next tool step in the same turn |
| 2026-10-03 | Stop = plain `interrupt()`; "Invia ora" on a waiting message = the CLI's own send-now (interrupt with `send_now` + message uuid), not a Stop | Same as the terminal (Ctrl+Enter); the queue is not paused |
| 2026-10-03 | Server updates itself: `claude-wrap-update.timer` every 5 min, builds and tests a new `main`, switches only while no session works (`activity.json`); `.failed` blocks a release that failed or was rolled back | Pushes reach the phone without a manual step; nothing restarts under a working session |
| 2026-10-03 | Repo public with the GitHub noreply email; probe split in public `sdk-probe.json` and ignored `sdk-probe.local.json` | No personal data in history |
| 2026-10-03 | Pairing over `POST /pair`; device and push commands are host commands of the server; contract tests on two transports | Pairing happens before a WS identity exists; the core stays host-agnostic |
| 2026-10-03 | Touch UI in `packages/ui/src/touch/` with its own `touch.css` (the prototype's CSS); the desktop keeps the old components until C2 | No half-migrated screens on either platform |
| 2026-10-03 | highlight.js loaded only when a file is opened; its output rendered as React nodes (`spanNodes`), never injected HTML | Plan choice; design rule 10 (no `dangerouslySetInnerHTML` on untrusted content) |
| 2026-10-03 | File commands take a tab (trusted folder) or a Home folder (inside the roots, no trust needed) | Browsing files is the user's own action; trusting the root just to look would trust every subfolder |
| 2026-10-03 | Open session = a tab of the core; saved session = the CLI's JSONL. Past lists exclude open ones; a chat left with nothing sent and an empty composer is closed; never-used tabs are not restored; the tab title follows Claude Code's title until the user renames it | Sasha saw the same session twice and empty sessions kept |
| 2026-10-03 | ~~Portrait only~~ (reverted the same day: both orientations, text never enlarged in landscape); no zoom; no emoji in UI badges (icons of the set) | Sasha's choices |
| 2026-10-03 | Rewind stays a 🔜 placeholder until D (built with the core) | Its screens depend on what `rewindFiles` dry runs return |
| 2026-10-04 | Limits and plan windows belong to the account the process was started with (`processAccount`); a turn that ends in success without a rejection lifts its account's limit | A switch left the old process reporting "CREAaps"'s weekly limit as "personale"'s |
| 2026-10-04 | Titles from the CLI: its custom title, or its summary when ≤ 80 chars; a stored session is opened without a fixed title | The CLI's summary fell back to a whole prompt and became a fixed title |
| 2026-10-04 | Nothing leaves the screen and text wraps (design-system touch rule 8); `overflow: clip` for anything drawn past an edge | Sasha: "mai nessun elemento possa uscire dallo schermo, testi vanno sempre a capo" |
| 2026-10-04 | PWA e2e also on the home server with Playwright's Chromium (`CLAUDE_WRAP_E2E_CHROME`) | The server has no Chrome; screenshots there found a real layout bug |
| 2026-10-04 | While a chat is on screen (`client.watch` + visible), its next queued message waits a 5 s countdown in the composer (`TabMeta.queueCountdown`, timer in core) and can be stopped (`tab.queueHold`: back into the field, the rest of the queue paused); otherwise the queue goes at once | Sasha: "un messaggio in coda parte solo dopo 5 secondi di count down … dove io posso fermare" |
| 2026-10-04 | An empty queue is never paused (a Stop or ⏸ pause ends when the last message leaves it), except by a usage limit | Sasha: "la coda non può mai essere in pausa quando è vuota tranne quando i token sono finiti" |
| 2026-10-03 | Automatic compaction in Settings = Claude Code's official `autoCompactWindow` (tokens, 100k–1M), not a percentage: the only percentage is the undocumented test env `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Passed as flag settings at spawn; a live `applyFlagSettings` does not move it (CLI 2.1.287), so live processes restart (idle now, working at the turn's end) | Sasha chose B ("only if it is a native Claude Code setting") |
| 2026-10-03 | One account for every session (a switch anywhere moves all sessions and the new ones); a switch stops a session at work at once; sessions stopped mid-work by a limit or a switch are marked (`TabMeta.interrupted`, persisted) and wait — queue included — for "Continua" (`tabs.continue`, sends "continua") or a message | Sasha: "quando cambio account in una chat si cambi in tutte le sessioni" + a continue card after a switch or a reset |
| 2026-10-03 | Context and usage panels before C2; the window is `rawMaxTokens` (the autocompact window, as /context); the usage call is the SDK's experimental one, kept in `core/src/usage.ts` and checked by `smoke:usage` at every SDK bump; reset times normalized to plain ISO in core | Sasha asked for them now; the experimental API may be renamed |
| 2026-10-03 | Claude accounts: tokens from `claude setup-token` pasted in the app, kept by core in `accounts.json` (0600, never sent back), passed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN`; per session with a default for new ones; Claude Code's own login stays; a switch restarts the process on the same stored session (at the turn's end if busy); usage limits per account | Sasha: "voglio poter usare la stessa conversazione con più account, esattamente come faccio qui" — like /login in the terminal |

## Backlog
1. **C2** — desktop with the same elements ([piano.md](piano.md) §4; prototype delivery on the server: `/srv/progetti/claude-wrap-prototipo/NOTE-CONSEGNA.md` §5, read it before `index.html`).
2. **Terminal in the app** (Sasha, 2026-10-05; after C2): an interactive shell through core (`node-pty`, rebuilt for
   Electron) and `xterm.js` — desktop: a third tab of the right panel (File | Note | Terminale); phone: its own screen
   with a key bar (Esc, Tab, Ctrl, arrows, |, ~); several terminals that survive a reconnection; folders inside the
   roots only.
3. **D** — native rewind (code / conversation / both, with preview), then cleanup: remove the old desktop
   components and `style.css` mobile rules, delete the prototype (server folder, `cw-prototipo` service, port 3013 in
   `~/.claude/porte.md`, local copy) after the final comparison.
4. **Colours and logo** (Sasha, 2026-10-04): replace Claude's palette and the "cw" mark (tokens in `touch.css` and
   `style.css`, `manifest.webmanifest`, `index.html` theme colour, `apps/mobile/scripts/icons.ts` for icons and splash
   screens); maybe the name.
5. Server heartbeat for WebSockets (dead connections; "visible" only with recent signs of life) — see Open problems.
6. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
7. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done in the PWA), config pages, advanced editor.
8. Move the desktop/packaged real-CLI smoke scripts into the repo.
