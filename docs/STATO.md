# STATO — claude-wrap

_Last updated: 2026-10-03 18:21_

## Current state
**Phases 0–3 are done, and so are sub-phases A, B and C1 of the realigned plan** ([piano.md](piano.md) §4): the
remote server runs on the home server, the iPhone PWA has the touch UI of the approved prototype, and the server
updates itself from `main`. Details per session: [storico-sessioni.md](storico-sessioni.md).
- **Live:** commit `e4ed6c2` on the home server (`/srv/apps/claude-wrap/current`), installed by the update timer;
  Sasha uses the PWA from the iPhone (one paired device).
- **Repo:** public on GitHub (`main` only), pushed. Tests: 182 unit (+3 skipped), 20 PWA e2e, 29 desktop e2e,
  154 core+server on Linux (WSL), real-CLI `smoke:composer` green (mid-turn read, send now, effort, history).
- **PWA (touch UI, `packages/ui/src/touch/`):** Home of folders and projects (+ files row, trash), sessions per folder
  and global, chat with requests inside the conversation, ghost and jump, floating composer with queue deck, "Invia
  ora" on waiting messages, file explorer with previews (also from the Home, without a session), notes (20% rule),
  settings (theme, devices, notifications), 🔜 placeholders, both orientations, no zoom, splash screens, update bar.
- **Claude accounts** (after the buonanotte, Sasha's request): besides Claude Code's own login, accounts added in
  Settings with a token made by `claude setup-token`; one account for every session (picked in Settings or in any
  session's menu ⋯ → Account), conversations kept; usage limits per account, with "Passa a …" in the chat. Sessions
  Claude stopped mid-work (usage limit, or a switch while it worked) get a "Continua" card once the account is free
  (right after a switch, or when the limit resets): it sends "continua" to all of them. Real-CLI check
  `smoke:accounts`: the account's token reaches the CLI (a bad one fails with 401), back to the login in the same
  conversation.
- **Context and usage panels** (Sasha's request, ahead of Phase 4): session menu → Contesto (window bar, categories,
  memory files, MCP servers, "Compatta ora") and Consumo e limiti (5-hour and weekly windows with reset times, session
  cost, tokens per model), through `tab.context` / `tab.usage`. Real-CLI check `smoke:usage` (zero tokens) green.
  A gauge right of the model in the composer shows the highest of context / 5-hour / weekly use; its sheet has the
  three bars and "Compatta ora" (values kept by core in `TabMeta.context` / `planLimits`, read at each turn end).
  Settings → Compattazione automatica: Claude Code's own `autoCompactWindow` (Standard, 100k, 200k, 500k, 1M) for
  every session.
- **Desktop:** still the Phase 1–3 UI (tab bar, start screen, old chat and composer) on the new core; it moves to the
  touch elements in **C2**.
- **Next:** C2 (desktop with the same elements, widths 300/380/~780 px), then D (native rewind, cleanup, prototype
  deletion).

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
| 2026-10-04 | While a chat is on screen (`client.watch` + visible), its next queued message waits a 5 s countdown in the composer (`TabMeta.queueCountdown`, timer in core) and can be stopped (`tab.queueHold`: back into the field, the rest of the queue paused); otherwise the queue goes at once | Sasha: "un messaggio in coda parte solo dopo 5 secondi di count down … dove io posso fermare" |
| 2026-10-04 | An empty queue is never paused (a Stop or ⏸ pause ends when the last message leaves it), except by a usage limit | Sasha: "la coda non può mai essere in pausa quando è vuota tranne quando i token sono finiti" |
| 2026-10-03 | Automatic compaction in Settings = Claude Code's official `autoCompactWindow` (tokens, 100k–1M), not a percentage: the only percentage is the undocumented test env `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Passed as flag settings at spawn; a live `applyFlagSettings` does not move it (CLI 2.1.287), so live processes restart (idle now, working at the turn's end) | Sasha chose B ("only if it is a native Claude Code setting") |
| 2026-10-03 | One account for every session (a switch anywhere moves all sessions and the new ones); a switch stops a session at work at once; sessions stopped mid-work by a limit or a switch are marked (`TabMeta.interrupted`, persisted) and wait — queue included — for "Continua" (`tabs.continue`, sends "continua") or a message | Sasha: "quando cambio account in una chat si cambi in tutte le sessioni" + a continue card after a switch or a reset |
| 2026-10-03 | Context and usage panels before C2; the window is `rawMaxTokens` (the autocompact window, as /context); the usage call is the SDK's experimental one, kept in `core/src/usage.ts` and checked by `smoke:usage` at every SDK bump; reset times normalized to plain ISO in core | Sasha asked for them now; the experimental API may be renamed |
| 2026-10-03 | Claude accounts: tokens from `claude setup-token` pasted in the app, kept by core in `accounts.json` (0600, never sent back), passed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN`; per session with a default for new ones; Claude Code's own login stays; a switch restarts the process on the same stored session (at the turn's end if busy); usage limits per account | Sasha: "voglio poter usare la stessa conversazione con più account, esattamente come faccio qui" — like /login in the terminal |

## Backlog
1. **C2** — desktop with the same elements ([piano.md](piano.md) §4; prototype delivery on the server: `/srv/progetti/claude-wrap-prototipo/NOTE-CONSEGNA.md` §5, read it before `index.html`).
2. **D** — native rewind (code / conversation / both, with preview), then cleanup: remove the old desktop
   components and `style.css` mobile rules, delete the prototype (server folder, `cw-prototipo` service, port 3013 in
   `~/.claude/porte.md`, local copy) after the final comparison.
3. Server dev workspace for working on claude-wrap from the phone (`/srv/progetti/claude-wrap`, requested
   2026-10-03; set up by linux stup).
4. Restrict the server's GitHub key (read-only deploy key, or push only from a dev clone Sasha accepts).
5. Phase 4+ — data panels (tasks, todo, diff, MCP, hooks, status; context and usage done in the PWA), config pages, advanced editor.
6. Move the desktop/packaged real-CLI smoke scripts into the repo.
