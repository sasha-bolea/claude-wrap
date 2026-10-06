# Session history — claude-wrap

_Append-only archive of session entries that left [STATO.md](STATO.md), newest on top._

## 2026-10-06 11:16 — Queue button, queue bin, sheets closed from their content, 10 s countdown (phone session)
A morning session in the server dev clone (09:30–11:15), Sasha on the iPhone: small composer, queue and sheet requests,
each pushed over SSH and deployed by the update timer. Another Claude session worked in the same clone at the same time
(default effort and mode, then one question at a time).
- **Queue button:** a filled 38 px circle like Send and Stop, in the text colour (dark on light, light on dark), so the
  three actions weigh the same and differ by colour. Its count is a small 14 px accent circle on the rim, centred on the
  digit's cap height (`text-box: trim-both cap alphabetic`). The font's line box had set the digit about 1.25 px high
  (measured from pixels in Chromium; with the trim it is 0.25 px off).
- **Queue bin:** a muted bin on the right end of the queue card removes the next queued message at once, with the toast
  "Tolto dalla coda" (no confirmation, no undo). It is a sibling of the stack button in `.q-front`, because buttons
  do not nest.
- **Sheets:** a downward drag on a sheet's content closes it once the content is at its top, as the head did already. A
  drag that scrolls the content back to the top goes on pulling. Sideways drags and fields never pull. The listeners
  are native and non-passive, so a pull cancels the native scroll and bounce.
- **Queue countdown:** 10 s instead of 5 (Sasha). Asked whether a bigger countdown was wanted beside the existing
  "parte tra N s" and ring: "va bene così".
- **Incident:** the 10 s commit (`f1c09e3`) used `git add -A` and swept in half of the other session's
  default-effort work, so `main` did not typecheck until that session pushed the rest (`cdca724`). It was the second
  time (bug-risolti). A fix commit, prepared in a separate worktree, was no longer needed.
- **Verification:** PWA e2e 37 → 40/40 (bin, sheet drag with real CDP touches, which fails without the change);
  unit + contract tests and typecheck green at every push. Nothing checked on a real iPhone.

### Cambiamenti al codice
- Queue button: `packages/ui/src/touch/TouchComposer.tsx` (`send queue-btn` instead of `icon-btn queue-btn`);
  `touch.css` (`.send.queue-btn`, its `.count`).
- Queue bin: `packages/ui/src/touch/queue.tsx` (`QueueTray`: `.q-front`, `.q-remove`, `removeNext` via `tab.unqueue`);
  `touch.css` (`.q-front`, `.q-remove`, `.q-card.k0` right padding); i18n `removeNextQueued`, `removedFromQueue`.
- Sheets: `packages/ui/src/touch/SheetHost.tsx` (`canPull`, `dragToClose` with native listeners; React touch
  handlers removed).
- Countdown: `packages/core/src/workspace.ts` (`queueCountdownMs` default 10 000), `config.ts` comment.
- Tests: `apps/mobile/e2e/pwa.e2e.ts` (+2: queue bin, sheet drag; countdown regex `\d+`).
- Docs: `design-system.md` (composer, queue, sheets rule 2), `architettura.md` (10 s).

## 2026-10-06 11:12 — Terminal in the app, one notification, keyboard and bounce fixes (phone session, server dev clone)
The phone session in the server dev clone, from 2026-10-05 20:30 to 2026-10-06 02:21, Sasha on the iPhone. Small
fixes first, then the terminal (backlog 1) in three steps plus four follow-ups, all pushed over SSH and deployed by the
update timer (which waited while this session worked: Sasha saw old builds for a while).
- **Keyboard space at opening:** first fix (blur + measure again on return) was not enough; the real cause was iOS
  still reporting the visual viewport without the keyboard after the return. With no field focused the app now fills
  the screen (CSS height) whatever the viewport says (bug-risolti).
- **One notification:** core counts chats waiting for an answer and chats finished while nobody looked; the push
  carries the counts; the service worker keeps one notification ("2 chat aspettano te · 1 chat ha finito"; one chat →
  its title, tap opens it; more → tap opens the open sessions); the app clears it when on screen. iOS does not
  replace a notification with the same tag (WebKit bug 258922): every one is closed before the new one — confirmed
  working by Sasha ("1").
- **Small UI:** "Claude sta lavorando · 9 min 27 s" (minutes and hours via `durationLabel`); the native bounce at the
  end of the chat was cut by a programmatic scroll (bug-risolti); vivid reds (`--danger` #ff6b5e dark, #c62828 light).
- **Terminal:** node-pty 1.2 beta (N-API prebuilds: no compiler on the server, same binary in Electron); shells in core
  shared through the protocol (`terminal:<id>` streams with replay, list on the workspace stream, max 5); xterm.js
  screen on the phone (key bar Ctrl/Esc/Tab/arrows/|/~//) and in the desktop's right panel; opened from the session
  menu, a folder's menu ("Terminale qui"), the panel tab; listed in the Home. Follow-ups asked by Sasha: a command
  running in a terminal holds the automatic update; leaving a terminal asks "Chiudere il terminale?" (1b) and the
  Home has "Chiudi tutti i terminali" (2); Copia tutto / Incolla; clickable links. CSP `style-src` now allows inline
  styles (xterm writes `<style>`); electron-builder no longer rebuilds native modules (`npmRebuild: false`).
- **Chat and composer:** the model and effort on a second line under the chat's title; + first in the composer; the
  queue button (beside Stop while Claude responds) puts what is written straight into the queue — queue mode is gone.
- **Two sessions, one folder:** the other Claude session works in the same clone; one commit of this session
  (`78c1191`) swept in its unfinished chat changes (`git add -A`). Rule since then: commit only the files you touched.
  For a while GitHub refused the server's SSH key; it worked again later without changes here.
- **Verification:** unit + contract tests green at every push (221 here, before the other session's additions); PWA e2e
  37/37; desktop e2e 32/32 under xvfb (two desktop tests and one PWA test failed once each and passed when rerun:
  flaky, see STATO). The Windows packaged build was only cross-built from Linux (checks node-pty's win32 prebuilds and
  ConPTY unpacked; unusable without the Windows CLI binary): the real check is for the PC session.
- **Decisions archived from STATO (2026-10-05):**
  | 2026-10-05 | Menus opened from a button are popovers by it; typing sheets and confirmations opened from a sheet are centred dialogs; Settings is a window | NOTE-CONSEGNA §5 |
  | 2026-10-05 | Desktop e2e run on the home server under `xvfb-run` (GTK installed by Sasha); the PC runs them too | The phone session can verify the desktop itself |

### Cambiamenti al codice
- Keyboard: `packages/ui/src/touch/keyboard.ts` (blur on `visibilitychange`/`pageshow`/start; no `--app-h` while no
  field is focused).
- Notifications: `packages/core/src/config.ts` (`Notice.waiting/finished`), `workspace.ts` (`finished` set, `notify`,
  `seen`), `commands.ts` (`client.watch`/`client.visibility` mark seen); `packages/server/src/push.ts` (counts in the
  payload); `apps/mobile/public/notice.js` (new: `noticeView`, `showOnly`), `public/sw.js` (one tag, `/#sessions`);
  `apps/mobile/src/main.tsx` (`onShowSessions`, `clearNotifications`); `packages/ui/src/App.tsx`
  (`Capabilities.onShowSessions`), `touch/context.tsx` (`home.view`), `TouchApp.tsx`, `HomeScreen.tsx`;
  `apps/desktop/src/main/remoteNotices.ts` (`DesktopNotice`).
- Working time: `touch/Conversation.tsx` (`workingFor` + `durationLabel`). Bounce: `touch/ChatScreen.tsx` (dock
  observer lives with the chat, moves it only on a real height change; the glide gives way to moves it did not make).
  Reds: `touch.css` tokens.
- Terminal core: `packages/core/src/terminals.ts` (new), `workspace.ts` (`terminals`, `countActivity`, activity poll),
  `commands.ts` (`terminal.*`), `core.ts` (resume/detach), `stream.ts` (types), `config.ts` (`terminalShell`,
  `activityPollMs`); `packages/protocol/src/model.ts` (`terminalMetaSchema`, events, snapshot, `terminalStream`),
  `commands.ts` (`terminal.open/subscribe/unsubscribe/input/resize/close`), `index.ts`; `packages/client/src/connection.ts`
  (`subscribeTerminal`, `TerminalSink`), `store.ts` (`terminals`); `node-pty` in `packages/core` and `apps/desktop`.
- Terminal UI: `packages/ui/src/touch/TerminalScreen.tsx` (new: screen, key bar, `useOpenTerminal`, `OpenTerminals`,
  `ConfirmClose`, `withCtrl`, copy/paste, links), `TouchApp.tsx` (route, panel tab), `ChatScreen.tsx` (session menu
  item), `HomeScreen.tsx` (folder menu, list), `icons.tsx` (`terminal`), `touch.css`, i18n en + it; `@xterm/xterm`,
  `@xterm/addon-fit`, `@xterm/addon-web-links` in `packages/ui`.
- CSP: `packages/server/src/server.ts`, `apps/desktop/src/main/index.ts` (`style-src 'self' 'unsafe-inline'`).
  Packaging: `apps/desktop/package.json` (`npmRebuild: false`, `node_modules/node-pty/**` unpacked),
  `electron.vite.config.ts` (comment).
- Chat/composer: `ChatScreen.tsx` (`.title-stack`, no queue mode), `TouchComposer.tsx` (+ first, `send(toQueue)`,
  queue button label), `touch.css`.
- Tests: `packages/core/src/terminals.test.ts` (new, 5), `core.test.ts` (notice counts), `server/src/push.test.ts`,
  `server/src/contract.test.ts` (terminal over both transports), `apps/mobile/src/notice.test.ts` (new),
  `packages/ui/src/touch/terminal.test.ts` (new), `touch/model.test.ts`, `apps/mobile/e2e/pwa.e2e.ts` (keyboard, bounce,
  notification tap, terminal ×3, layout, queue), `apps/desktop/e2e/chat.e2e.ts` (terminal tab).
- Docs: `architettura.md` §9.8, `procedure.md` (packaged build), `design-system.md` (terminal, top bar, composer, danger).

## 2026-10-06 11:02 — Default effort and permission mode for new sessions (server dev clone)
A short session in the server dev clone, from the phone. Sasha asked for a default effort and a default permission
mode in the app's settings; the proposal (five questions with a recommended answer each) was approved as is, with
every mode selectable and no warning for the risky ones. Tests first, then core, protocol, client and the Settings
group; pushed over SSH as `cdca724` (deployed by the update timer).
- **Behaviour:** the defaults apply to sessions created from then on (new and reopened from history); a mode given at
  creation wins; forks keep their source's effort and mode (the fork used to drop the effort — bug-risolti); an effort
  the model does not offer moves to its highest level below once the models are read.
- **Verification:** core tests (2 new, the fork test extended), PWA e2e 40/40 (1 new), desktop e2e 32/32, typecheck.
  `npm test` also picks up the untracked `.claude/worktrees/palettes` worktree of another session (2 failures there,
  not in this change).
- **Decisions archived from STATO (2026-10-04):**
  | 2026-10-04 | Limits and plan windows belong to the account the process was started with (`processAccount`); a turn that ends in success without a rejection lifts its account's limit | A switch left the old process reporting "CREAaps"'s weekly limit as "personale"'s |
  | 2026-10-04 | Titles from the CLI: its custom title, or its summary when ≤ 80 chars; a stored session is opened without a fixed title | The CLI's summary fell back to a whole prompt and became a fixed title |
  | 2026-10-04 | Nothing leaves the screen and text wraps (design-system touch rule 8); `overflow: clip` for anything drawn past an edge | Sasha: "mai nessun elemento possa uscire dallo schermo, testi vanno sempre a capo" |
  | 2026-10-04 | PWA e2e also on the home server with Playwright's Chromium (`CLAUDE_WRAP_E2E_CHROME`) | The server has no Chrome; screenshots there found a real layout bug |
  | 2026-10-04 | While a chat is on screen (`client.watch` + visible), its next queued message waits a 5 s countdown in the composer (`TabMeta.queueCountdown`, timer in core) and can be stopped (`tab.queueHold`: back into the field, the rest of the queue paused); otherwise the queue goes at once | Sasha: "un messaggio in coda parte solo dopo 5 secondi di count down … dove io posso fermare" |
  | 2026-10-04 | An empty queue is never paused (a Stop or ⏸ pause ends when the last message leaves it), except by a usage limit | Sasha: "la coda non può mai essere in pausa quando è vuota tranne quando i token sono finiti" |
  | 2026-10-04 | Shared browser (a Chromium on the server driven by Claude, seen and touched in the app) designed after C2 and D | Sasha: "teniamo l'ordine" |
  | 2026-10-04 | A second Claude session in the server dev clone pushes to `main` too; every session pulls before working | Sasha works on claude-wrap from the phone through it |
  | 2026-10-04 | Accounts can be renamed (token kept) | Sasha: "posso dare un nome ai token?" |

### Cambiamenti al codice
- `packages/protocol/src/commands.ts`: `settings.setDefaultEffort {effort?}`, `settings.setDefaultMode {mode?}`.
- `packages/protocol/src/model.ts`: `settings.updated` carries every backend setting (+ `defaultEffort`,
  `defaultMode`); workspace snapshot `defaultEffort`, `defaultMode`.
- `packages/core/src/state.ts`: `PersistedState.defaultEffort`, `defaultMode`.
- `packages/core/src/workspace.ts`: `setDefaultEffort`, `setDefaultMode`, `withDefaults`, `announceSettings`
  (also used by `setAutoCompactWindow`); snapshot fields.
- `packages/core/src/commands.ts`: `tab.create` through `withDefaults`; fork passes `effort`; the two handlers.
- `packages/core/src/tab.ts`: `keepEffortOffered` (from `setModel`), also run by `models()` after reading the CLI.
- `packages/client/src/store.ts`: `defaultEffort`, `defaultMode` from snapshot and `settings.updated`.
- `packages/ui/src/touch/SettingsScreen.tsx`: `NewSessionsGroup`, `DefaultModeSheet`;
  `touch/modelSheets.tsx`: `ModeMenu` (shared with `ModeSheet`), `effortLabel` exported; i18n en + it.
- Tests: `core.test.ts` (+2), `workspace.test.ts` (fork), `apps/mobile/e2e/pwa.e2e.ts` (+1).
- Docs: `design-system.md` (Settings → new sessions), `architettura.md` (commands), `bug-risolti.md` (fork effort).

## 2026-10-05 19:03 — C2 done: the desktop on the touch app (phone session)
Same phone session as the 2026-10-04 entry, in the server dev clone. After the buonanotte of 2026-10-04 it showed the
palettes (screenshots: the session cannot make artifacts), took the terminal into the backlog after C2 (Sasha), saw
the PC session's buonanotte (shared browser after D, pull-first rule) and its deploy cleanup, then did C2 in five
steps with a report after each; Sasha installed `libgtk-3-0t64` so Electron runs on the server, the PC session built
and installed the desktop, and Sasha closed C2 ("c2 ok").
- **C2.1 wide arrangement:** the touch app from 1024 px puts the screens in regions (left: Home, folder sessions, trash;
  centre: one chat; right: File/Note/panels; window: Settings), each with its own Back; "Aperte" on top of the Home;
  File and Note in the chat's top bar; conversation padded to ~780 px.
- **C2.2 popovers:** a sheet opened from a button is placed by it (below in the upper half, above in the lower half),
  re-placed when its content grows.
- **C2.3 keyboard and mouse:** ↑/↓ and Ctrl+R history (CLI's), Shift+Tab mode, Esc closes or stops, drop files on the
  chat (attach) and on the explorer (upload).
- **C2.4 desktop on the touch app:** App renders TouchApp on every host, the renderer loads touch.css, DesktopShell
  passes the backends as a capability (switch on top of the Home, "Server…" sheet), "Aggiungi cartella…" on This PC.
- **C2.5 cleanup and e2e:** the first desktop UI deleted (−1836 lines); desktop e2e rewritten by a sonnet subagent and
  verified here: 31/31 under xvfb.
- **Verification:** PWA e2e 31/31 (+3 tests: wide window, popovers, keyboard/drop), desktop e2e 31/31, screenshots at
  1280×800 during C2.1/C2.2 (found the user bubbles stretched and the model popover misplaced, both fixed before
  commit), the desktop launched under xvfb (found the backend switch cell too narrow).
- **Decisions archived from STATO (2026-10-03):**
  | 2026-10-03 | The approved prototype is the UI spec (mobile and desktop); plan realigned in sub-phases A–D | Sasha designed the screens with a prototype session on the server; the old plan predated it |
  | 2026-10-03 | 10 prototype decisions: `allegati/` (excluded in `.git/info/exclude`), no "start the queue", one trash, project mark at any level, ↶ and clock icons, effort only with the model's levels, desktop widths fixed, system trash on this PC, Home of this PC seeded from open sessions, iPhone keyboard tricks without a native wrapper | Sasha: "concordo su tutto" ([piano.md](piano.md) §4) |
  | 2026-10-03 | Mid-turn messages go to the CLI at once (`priority: 'next'`), `pending` until its `command_lifecycle` says started; a separate per-tab queue (pause after Stop and on usage limits) | Verified on the real CLI: `next` is read at the next tool step in the same turn |
  | 2026-10-03 | Stop = plain `interrupt()`; "Invia ora" on a waiting message = the CLI's own send-now (interrupt with `send_now` + message uuid), not a Stop | Same as the terminal (Ctrl+Enter); the queue is not paused |
  | 2026-10-03 | Server updates itself: `claude-wrap-update.timer` every 5 min, builds and tests a new `main`, switches only while no session works (`activity.json`); `.failed` blocks a release that failed or was rolled back | Pushes reach the phone without a manual step; nothing restarts under a working session |
  | 2026-10-03 | File commands take a tab (trusted folder) or a Home folder (inside the roots, no trust needed) | Browsing files is the user's own action; trusting the root just to look would trust every subfolder |
  | 2026-10-03 | Open session = a tab of the core; saved session = the CLI's JSONL. Past lists exclude open ones; a chat left with nothing sent and an empty composer is closed; never-used tabs are not restored; the tab title follows Claude Code's title until the user renames it | Sasha saw the same session twice and empty sessions kept |
  | 2026-10-03 | Rewind stays a 🔜 placeholder until D (built with the core) | Its screens depend on what `rewindFiles` dry runs return |
  | 2026-10-03 | Automatic compaction in Settings = Claude Code's official `autoCompactWindow` (tokens, 100k–1M), not a percentage: the only percentage is the undocumented test env `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Passed as flag settings at spawn; a live `applyFlagSettings` does not move it (CLI 2.1.287), so live processes restart (idle now, working at the turn's end) | Sasha chose B ("only if it is a native Claude Code setting") |
  | 2026-10-03 | One account for every session (a switch anywhere moves all sessions and the new ones); a switch stops a session at work at once; sessions stopped mid-work by a limit or a switch are marked (`TabMeta.interrupted`, persisted) and wait — queue included — for "Continua" (`tabs.continue`, sends "continua") or a message | Sasha: "quando cambio account in una chat si cambi in tutte le sessioni" + a continue card after a switch or a reset |
  | 2026-10-03 | Context and usage panels before C2; the window is `rawMaxTokens` (the autocompact window, as /context); the usage call is the SDK's experimental one, kept in `core/src/usage.ts` and checked by `smoke:usage` at every SDK bump; reset times normalized to plain ISO in core | Sasha asked for them now; the experimental API may be renamed |
  | 2026-10-03 | Claude accounts: tokens from `claude setup-token` pasted in the app, kept by core in `accounts.json` (0600, never sent back), passed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN`; per session with a default for new ones; Claude Code's own login stays; a switch restarts the process on the same stored session (at the turn's end if busy); usage limits per account | Sasha: "voglio poter usare la stessa conversazione con più account, esattamente come faccio qui" — like /login in the terminal |

### Cambiamenti al codice
- `packages/ui/src/touch/TouchApp.tsx`: `useWide`, `regionOf`, region-aware `go`/`regionBack`/`backTo`,
  `togglePanel`, wide render (columns, `PanelTabs`, `NoChat`, Settings window), Esc handler, core-failed notice;
  popover anchors in `openSheet`.
- `touch/SheetHost.tsx`: `placePopover` + ResizeObserver; `touch/context.tsx`: `wide`, `chatTabId`, `panel`,
  `togglePanel`; `touch/ChatScreen.tsx`: no back arrow when wide, File/Note buttons; `touch/sessions.tsx`:
  `OpenSessions`, current row; `touch/HomeScreen.tsx`: Aperte, `BackendSwitch`, "Aggiungi cartella…";
  `touch/TouchComposer.tsx`: history keys, Shift+Tab, drop; `touch/FilesScreen.tsx`: drop upload;
  `touch/backends.tsx` (new): switch + Servers sheet.
- `packages/ui/src/App.tsx` (TouchApp only), `DesktopShell.tsx` (capabilities.backends), `chatHooks.ts` (`Answer`),
  `composerText.ts` (`caretOnEdgeLine`); deleted ChatView, StartScreen, TabBar, ChatHeader, Composer, ItemView,
  QueueList, RequestPanel, TrustDialog, FolderBrowser, SessionList, Mobile*, Sheet, Icon, focus.ts, style.css.
- `touch.css`: wide arrangement, popovers, backend switch, drop outline, core-failed; i18n en + it.
- `apps/desktop/src/renderer/main.tsx` (touch.css); `apps/desktop/e2e/*` rewritten; `apps/mobile/e2e` +3 tests.

## 2026-10-04 17:00 — A day of requests from the phone (dev clone on the server)
Sasha worked from the iPhone in a session of the claude-wrap PWA itself, on the server's dev clone
`/srv/progetti/claude-wrap`; 37 commits, each pushed over SSH (the clone's HTTPS `origin` has no credentials) and
deployed by the update timer when no session worked (this session counted as working while it answered, so a
deploy waited for a quiet moment). No C2 work: Sasha's requests came first.
- **Chat and composer:** own scroll indicator stopping above the composer (iOS cannot inset its own), ghost leaving
  upwards and before the next message touches it (and above the tool cards), smooth glide following new text, quick
  drag closes the keyboard, commands in a row stacked like the queue, queued messages counting down 5 s in the
  composer while the chat is on screen (Stop → back into the field), a light veil under the composer, long press on
  your message no longer selects the screen, landscape back (text-size-adjust).
- **Context, usage, limits:** Contesto and Consumo e limiti panels (`tab.context`, `tab.usage`; the usage call is the
  SDK's experimental one), composer gauge with its sheet and "Compatta ora", Settings → automatic compaction (Claude
  Code's `autoCompactWindow`, read by the CLI only at spawn: live processes restart), plan windows from
  `rate_limit_event` for token accounts, saved across restarts.
- **Accounts:** one account for every session, "Continua" card after a stop by a limit or a switch (`tabs.continue`),
  limit card with quiet "Passa a …" (added accounts only) and Annulla; limits attributed to the process's own account.
- **Other:** delete a folder together with its open sessions; an empty queue is never paused (except by a limit);
  session titles stay short; nothing leaves the screen and text wraps (rule 8).
- **Verification:** the PWA e2e ran on the server for the first time (Playwright's Chromium): 29/29, after fixing a
  real bug (an account switch during the limit message) and a test; screenshots at iPhone size found the screen
  sliding up under the composer's veil (`overflow: clip`). Real-CLI checks: `smoke:usage` (100k window → compacts at
  67k), `/usage` per account (token accounts: no limits), `rate_limit_event` `unifiedWindows` with both accounts.
- **Not done / pending:** rewind stays for D (Sasha: no); colours and logo await Sasha's choice (palette screenshots
  in `/srv/progetti/test/palette/`); server WebSocket heartbeat proposed; the percentage auto-compact (only an
  undocumented test env) refused by Sasha's own rule.

### Cambiamenti al codice
- `packages/core`: `usage.ts` (context/usage reduction, gauges, `planLimitsFromEvent`, `readUsage`), `tab.ts`
  (gauges, `processAccount`, `turnRejected`/`limitLifted`, `interrupted` + `resume`, queue countdown + `holdQueued`,
  `applyAutoCompactWindow`, `cliTitle`/`MAX_AUTO_TITLE`, empty-queue pause rule), `workspace.ts` (`useAccount`,
  `continueStopped`, plans per account saved in state, `refreshGauges`, `setAutoCompactWindow`, `deleteFolder` with
  `closeSessions`, `restoredTitle`), `commands.ts`, `core.ts` (`client.watch`), `config.ts`, `state.ts`; testing:
  fake `getContextUsage`/usage, scenario `tools`; `scripts/smoke-usage.ts`.
- `packages/protocol`: `tab.context`, `tab.usage`, `tab.refreshGauges`, `tab.queueHold`, `tabs.continue`,
  `client.watch`, `settings.setAutoCompactWindow`, `folders.delete.closeSessions`; TabMeta `interrupted`, `context`,
  `planLimits`, `queueCountdown`; snapshot `autoCompactWindow`, event `settings.updated`.
- `packages/client`: store `autoCompactWindow`.
- `packages/ui/src/touch`: `UsageScreens.tsx`, `gauge.tsx` (new); `ChatScreen` (scroll thumb, glide, keyboard
  close, ghost, watch), `Conversation` (ToolStack), `TouchComposer` (gauge, countdown), `accounts` (ContinueCard,
  limit card), `SettingsScreen` (automatic compaction), `HomeScreen` (folder delete), `NotesScreen`, `parts`
  (title clamp), `icons` (`to-chat`); `touch.css` (rule 8 wrap/clip, veil, stacks, gauge, countdown, quiet buttons);
  i18n en + it.
- `apps/mobile`: manifest `orientation: any`, `main.tsx` (rotate notice removed), e2e (+9 tests, harness
  `CLAUDE_WRAP_E2E_CHROME`).
- Docs: STATO, architettura, design-system, procedure, bug-risolti (6 entries), CLAUDE.md (`smoke:usage`).
## 2026-10-04 12:15 — Claude accounts, rename, and a second session on the server
After the 2026-10-03 buonanotte Sasha asked to switch Claude accounts from the app ("voglio poter usare la stessa
conversazione con più account, esattamente come faccio qui", "fallo subito", keeping the normal login): accounts with
`claude setup-token` tokens, committed as `dc963a7` and live. Overnight a **second Claude session**, working from the
server dev clone `/srv/progetti/claude-wrap` (set up by linux stup), pushed 33 commits to `main` from Sasha's phone
requests; this session pulled them before going on ("sei indietro con i commit").
- **Accounts (this session):** `AccountStore`, token check, per-process `CLAUDE_CODE_OAUTH_TOKEN`, switch = restart on
  the same stored session, limits per account, `smoke:accounts` on the real CLI (a bad token fails with 401; back to
  the login in the same conversation). Then **Rinomina** (`7359924`): ⋯ of an added account → Rename / Remove.
- **Server session (summary of its commits, documented by it in STATO, design system and bug-risolti):** one account
  for every session with a "Continua" card after a stop (`d6a0b29`), limit card offering only added accounts; context
  and usage panels and the composer gauge (`fab0edb`, `d6d3d58`); Settings → automatic compaction (`b68a337`); deleting
  a folder with its open sessions (`384b7c3`); stacked command cards; queue countdown of 5 s while the chat is on screen
  (`d8692cb`); an empty queue never paused; short session titles (`b59dc8a`); both orientations again; many
  composer/veil/ghost/scroll polish commits.
- **Before pushing the rename**, 3 PWA e2e tests failed on `main` without an app bug (fake reset dates had passed;
  "Up:" instead of "Back"; segmented radios) — fixed in the same commit ([bug-risolti.md](bug-risolti.md)).
- **Shared browser** (Sasha's idea via linux stup): a Chromium on the server driven by Claude that Sasha also sees and
  touches in the app. Sasha (2026-10-04): keep the order, design it after C2 and D. Meanwhile linux stup installed the
  Playwright MCP for the server user (`@playwright/mcp` 0.0.83, headless Chrome 155, `--isolated`, started on first
  use, 150–300 MB each); claude-wrap sessions load it too (`settingSources` includes `user`). A real test loaded a
  local service (127.0.0.1) — the browser Claude drives reaches local services.
- Tests at the end: 205 unit (+3 skipped), 29 PWA e2e, 175 core+server on Linux. Live: `7359924`.

### Cambiamenti al codice
- `packages/core`: new `accounts.ts` (`AccountStore`: add / rename / remove / setDefault, `accounts.json` 0600);
  `jsonFile.ts` (`mode` option); `workspace.ts` / `tab.ts` (account per process env, limits per account,
  `limitedUntil`); `commands.ts` (accounts.* and `tab.setAccount` handlers); testing: FakeQuery raw `request`,
  scenario keyword `limit`, fake `/usage` reset dates in 2099; `scripts/smoke-accounts.ts` (`npm run smoke:accounts`).
- `packages/protocol`: `accountSchema`, snapshot `accounts` / `defaultAccount`, event `accounts.updated`, TabMeta
  `account` / `limitedUntil`, commands `accounts.add|rename|remove|setDefault`, `tab.setAccount`.
- `packages/client`: store keeps accounts.
- `packages/ui`: `touch/accounts.tsx` (AccountsGroup, AddAccountSheet, AccountMenu, RenameAccountSheet,
  AccountPickSheet, LimitCard), session menu Account row, i18n keys (en + it).
- Tests: core accounts tests (incl. rename), PWA e2e accounts test (add, rename twice, pick, limit card), e2e fixes
  for "Up:" and segmented radios.
- Docs: design-system Claude accounts entry (Rename), architettura §9.7, procedure (PWA e2e warnings).

### Decisions moved from STATO
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-03 | Repo public with the GitHub noreply email; probe split in public `sdk-probe.json` and ignored `sdk-probe.local.json` | No personal data in history |
| 2026-10-03 | Pairing over `POST /pair`; device and push commands are host commands of the server; contract tests on two transports | Pairing happens before a WS identity exists; the core stays host-agnostic |
| 2026-10-03 | Touch UI in `packages/ui/src/touch/` with its own `touch.css` (the prototype's CSS); the desktop keeps the old components until C2 | No half-migrated screens on either platform |
| 2026-10-03 | highlight.js loaded only when a file is opened; its output rendered as React nodes (`spanNodes`), never injected HTML | Plan choice; design rule 10 (no `dangerouslySetInnerHTML` on untrusted content) |
| 2026-10-03 | ~~Portrait only~~ (reverted the same day: both orientations, text never enlarged in landscape); no zoom; no emoji in UI badges (icons of the set) | Sasha's choices |

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
