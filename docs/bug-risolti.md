# Solved bugs — claude-wrap

_Append-only registry: date / symptom / cause / fix / files. Grep it before debugging: bugs come back in similar shapes._

## Inherited from the first attempt (`personale/claude wrap`, 2026-09-30 → 2026-10-02)
These were solved in the first attempt. Files refer to that repository. Each entry says how v2 avoids the bug class; the class matters more than the old code.

### 2026-10-01 — Shift+Tab did not update the permission mode
- **Symptom:** after Shift+Tab the selector still showed the old mode; two quick presses skipped or repeated a mode.
- **Cause:** `setPermissionMode` sends no confirmation message (no `system/status`); the UI waited for one.
- **Fix:** optimistic update + a ref holding the last *requested* mode, so the next press cycles from it.
- **Files:** `src/renderer/src/chat/Chat.tsx`, `chat/stato.ts`.
- **v2:** core keeps `mode` (requested) and `confirmedMode`, chains the calls, reconciles from `init`/`status`/answered requests ([architettura.md](architettura.md) §3).

### 2026-10-01 — Global Shift+Tab broke keyboard navigation
- **Symptom:** reverse tab navigation stopped working anywhere in the app; with a pending request Shift+Tab changed the mode instead of moving focus.
- **Cause:** a document-level Shift+Tab handler.
- **Fix:** Shift+Tab cycles the mode only inside the composer textarea and only without a pending request.
- **Files:** `src/renderer/src/chat/Composer.tsx`.
- **v2:** same rule in the design system; e2e assertion on the fake SDK.

### 2026-10-01 — Esc showed an error instead of "Interrupted"
- **Symptom:** interrupting with Esc ended the turn with an error message.
- **Cause:** the `result` after an interrupt is `error_during_execution`; it was treated as a failure.
- **Fix:** recognise `terminal_reason` `aborted_streaming` / `aborted_tools` as an interruption.
- **Files:** `src/renderer/src/chat/stato.ts`.
- **v2:** the normalizer in core maps it to `turnEnd {interrupted: true}`.

### 2026-10-01 — Orphan CLI processes from tab lifecycle races
- **Symptom:** `claude.exe` processes left running after closing a tab while it was opening, after a window reload, or when the process died but the tab still looked alive; the same session could be open twice.
- **Cause:** the window owned the tabs; process lifecycle and React state were synced loosely.
- **Fix:** generation counter + reconciliation on reload, closing just-created orphans, session lock.
- **Files:** `src/main/servizio.ts`, `src/main/sessions.ts`, `src/renderer/src/App.tsx`.
- **v2:** designed out — core owns tabs; memoized start, session index over all tabs, close during `starting` handled ([architettura.md](architettura.md) §4).

### 2026-10-01 — Duplicated history after a reload
- **Symptom:** the resumed conversation appeared twice after reloading the window.
- **Cause:** `getSessionMessages` on a live session also returns the live messages.
- **Fix:** history frozen at open and kept in the snapshot.
- **Files:** `src/main/sessions.ts`, `src/shared/ipc.ts`.
- **v2:** frozen history per transcript + epochs; a rebuild always starts a new epoch.

### 2026-10-02 — Settings saved with a UTF-8 BOM hid hooks, env and MCP from the trust dialog
- **Symptom:** a `settings.json` saved by Notepad showed "no configuration" in the trust dialog, while the CLI still loaded it.
- **Cause:** `JSON.parse` fails on the BOM; the CLI strips it.
- **Fix:** strip `﻿` before parsing, as the CLI does.
- **Files:** `src/main/fiducia.ts`.
- **v2:** ported with tests.

### 2026-10-02 — Trust too broad
- **Symptom:** trusting the home folder or a drive root was saved forever; folders under a trusted ancestor inherited trust across git roots.
- **Cause:** trust rules did not follow CLI 2.1.285 (git-root boundary, home and its ancestors session-only).
- **Fix:** git-root boundary; home, its ancestors, disk roots and `\\?\` paths session-only on the exact folder; oversized saved entries dropped at startup.
- **Files:** `src/main/fiducia.ts`, `src/main/servizio.ts`.
- **v2:** ported; allowed roots also count as too broad; trust re-checked before every spawn.

### 2026-10-02 — Dangerous settings not shown in the trust dialog
- **Symptom:** `proxyAuthHelper`, `autoMemoryDirectory`, http hook URLs, marketplace `headersHelper`, commands and skills pre-approving Bash were not listed.
- **Cause:** incomplete key list.
- **Fix:** list extended.
- **Files:** `src/main/fiducia.ts`.
- **v2:** list extended further (agent/skill frontmatter hooks, `defaultMode`, `statusLine.command`…) and checked by the probe at every SDK bump.

### 2026-10-02 — Closing a tab let the running turn finish
- **Symptom:** after closing a tab, already-approved tools kept running for seconds.
- **Cause:** on win32 `query.close()` only ends stdin; the CLI finishes the turn.
- **Fix:** `interrupt()` before closing; the session stays "occupied" until the process exits.
- **Files:** `src/main/sessions.ts`.
- **v2:** same close order, plus core-held queue discarded and a force-kill after 3 s.

### 2026-10-02 — Deleting a session right after closing its tab failed
- **Symptom:** "close the tab before deleting it" although the tab was already closed.
- **Cause:** the session was still marked as closing while its process exited.
- **Fix:** delete waits for the process exit (`attendiUscita`).
- **Files:** `src/main/servizio.ts`, `src/main/sessions.ts`.
- **v2:** covered by the session index + exit promise; Phase 1c done criterion.

### 2026-10-02 — Non-fatal errors ended the turn
- **Symptom:** a refused mode or model change showed "turn ended" while Claude kept working.
- **Cause:** every error was handled as terminal.
- **Fix:** separate non-fatal `avviso` action that leaves the turn running.
- **Files:** `src/renderer/src/chat/stato.ts`.
- **v2:** non-fatal SDK errors become `notice` items.

### 2026-10-02 — Focus stolen by dialogs that appear by themselves
- **Symptom:** a permission dialog appearing while typing took the focus; a space typed on "Yes" granted the permission.
- **Cause:** `autoFocus` on the dialog's first button.
- **Fix:** focus on the dialog container (`tabIndex=-1`), never on a granting button, and only when focus is free.
- **Files:** `src/renderer/src/chat/Richieste.tsx`, `tabs/DialogFiducia.tsx`.
- **v2:** design-system rule 6 + e2e assertions (also for requests resolved from another device).

### 2026-10-02 — Screen-reader announcements repeated or missing
- **Symptom:** requests in inactive tabs were not announced; mode and request announcements overwrote each other.
- **Cause:** one shared aria-live region; inactive tabs' regions are hidden.
- **Fix:** one region per message type, plus an app-level region for inactive tabs.
- **Files:** `src/renderer/src/chat/Chat.tsx`, `src/renderer/src/App.tsx`.
- **v2:** design-system rule 7 + e2e assertion "exactly one announcement per request".

### 2026-10-02 — Orphan MCP servers on Windows
- **Symptom:** each tab opened and closed left two `node`/`npx` processes (stdio MCP servers, e.g. Trello) running.
- **Cause:** on Windows, children of `claude.exe` are not killed when it exits.
- **Fix:** start `claude.exe` through `spawnClaudeCodeProcess`; on its exit `taskkill /T /F` the children whose PPID is the dead PID and that were created after its start (against PID reuse).
- **Files:** `src/main/processi.ts`.
- **v2:** ported; plus force-kill of the still-parented tree on close and a startup sweep of recorded pids.

### 2026-10-02 — e2e runs overwrote the user's app state
- **Symptom:** after an interrupted e2e run, the real `%APPDATA%/claude-wrap/stato.json` held test tabs.
- **Cause:** e2e used the real userData folder and restored it only on a clean exit.
- **Fix:** restore through `process.on('exit')`.
- **Files:** scratchpad e2e scripts.
- **v2:** designed out — `CLAUDE_WRAP_STATE_DIR` points every e2e run at a temp folder.

## v2 (`personale/claude-wrap`)

### 2026-10-02 — Desktop window stuck on "Connecting…" (app:// origin)
- **Symptom:** the built app never connected; the renderer waited forever for its port.
- **Cause:** the broker compared `new URL(senderFrame.url).origin` with `app://claude-wrap`, but Node's URL gives origin `"null"` for non-special schemes such as `app:`, so every request was refused.
- **Fix:** compare `protocol + '//' + host` (`originOf`).
- **Files:** `apps/desktop/src/main/index.ts`.

### 2026-10-02 — The `fatal` frame never reached the client
- **Symptom:** a version mismatch closed the connection without the `incompatible_protocol` error; the client kept reconnecting.
- **Cause:** the in-memory channel dropped messages still queued when `close()` ran right after `send()`.
- **Fix:** frames sent before close are delivered, like a socket.
- **Files:** `packages/protocol/src/channelPair.ts`.

### 2026-10-02 — Empty "thinking" item with Haiku
- **Symptom:** an empty thinking row before every Haiku answer.
- **Cause:** text/thinking items were added at `content_block_start`; Haiku streams a thinking block without any text.
- **Fix:** text and thinking items are created at their first non-empty delta (or by the final frame).
- **Files:** `packages/core/src/normalize.ts`.

### 2026-10-02 — A reload after the first turn replaced the live transcript
- **Symptom:** reloading the window mid-stream (after the first `init`) showed only the stored history; the streamed answer restarted from the middle.
- **Cause:** `init` gives a new tab its session id; the next subscribe saw a session id with no history loaded yet, read the JSONL and rebuilt the transcript over the live items.
- **Fix:** history is loaded only if no process ran in this core run (`liveStarted`); `restart` resets it.
- **Files:** `packages/core/src/tab.ts`.

### 2026-10-02 — Slash commands vanished after resuming a session
- **Symptom:** a resumed session showed nothing for `/model haiku` and other local commands.
- **Cause:** the JSONL stores them as `<command-name>/model</command-name>…<command-args>haiku</command-args>` and the normalizer skipped every text starting with `<`.
- **Fix:** stored commands become a user item with the typed text; `<local-command-stdout>` becomes a `localCommandOutput` item; other markup stays hidden.
- **Files:** `packages/core/src/normalize.ts`.

### 2026-10-02 — Picking the same folder again emptied the start screen
- **Symptom:** after "Change folder" → same folder, neither the trust dialog nor "New session" appeared.
- **Cause:** `choose()` cleared the trust state but the load effect depends on the folder string, which did not change, so it never re-ran.
- **Fix:** choosing the folder already shown just reloads it.
- **Files:** `packages/ui/src/StartScreen.tsx`.

### 2026-10-02 — state.json writes failing with ENOENT on rename
- **Symptom:** unhandled `ENOENT: rename state.json.tmp` when two cores (a restart, tests) used the same state folder.
- **Cause:** every store wrote the same `state.json.tmp`; one rename moved the other's file away. `closeAll` did not wait for queued writes.
- **Fix:** temp name unique per process and write (`state.json.<pid>.<n>.tmp`), `flush()` on quit, failed writes caught (the next save rewrites the whole state).
- **Files:** `packages/core/src/state.ts`, `packages/core/src/workspace.ts`.

### 2026-10-02 — Test-only bugs (e2e harness)
- **Mode read too early:** the Shift+Tab e2e read the select right after the key; the mode comes back from core a few ms later → `expect.poll`. (`apps/desktop/e2e/chat.e2e.ts`)
- **Stale "New session" click:** after "+", the start screen still showed the previous folder's buttons; the harness clicked them while the screen switched folders → `openChat(page, folder)` waits for the new folder path first. (`apps/desktop/e2e/harness.ts`)
- **"Renamed" matched "RenameDelete":** playwright `hasText` is a case-insensitive substring and the entry text ends with "Rename"+"Delete" → filter on the `.session-open` title. (`apps/desktop/e2e/tabs.e2e.ts`)
- **Utility process lookup:** the core's name is in `ProcessMetric.name` (`serviceName` is `node.mojom.NodeService`). (`apps/desktop/e2e/tabs.e2e.ts`)

## Phases 2–3 (2026-10-02 → 2026-10-03)

### 2026-10-02 — Suggestions popup crashed with "destroy_ is not a function"
- **Symptom:** typing `/` or `@` crashed the composer.
- **Cause:** a `useEffect` written as an arrow with an expression body returned a value (not a cleanup function).
- **Fix:** block body.
- **Files:** `packages/ui/src/composerHooks.ts`.

### 2026-10-02 — `!` shell commands produced two fake turn ends and a notification
- **Symptom:** after a `!` command the chat showed two "turn ended" lines and a "Claude finished" notification.
- **Cause:** every message sent with `shouldQuery: false` makes the CLI emit an empty `result` (`num_turns` 0).
- **Fix:** a `silentResults` counter in the tab swallows them; the fact was added to the probe.
- **Files:** `packages/core/src/tab.ts`, `packages/core/scripts/probe.ts`.

### 2026-10-02 — `/compact` showed the kept answer twice
- **Symptom:** after `/compact` the last answer appeared twice.
- **Cause:** the CLI re-sends the kept messages with the same uuids.
- **Fix:** dedup by uuid in the normalizer.
- **Files:** `packages/core/src/normalize.ts`.

### 2026-10-02 — Server crashed on a frame over 32 MB
- **Symptom:** a too-large upload killed the server process.
- **Cause:** the socket's `error` event (max payload exceeded) had no listener.
- **Fix:** an `error` listener closes that socket only.
- **Files:** `packages/server/src/server.ts`.

### 2026-10-02 — The probe leaked the account email
- **Symptom:** the committed `sdk-probe.json` contained the email inside the organisation name.
- **Cause:** the redaction looked only at the `email` field.
- **Fix:** regex redaction of every email-like string; public `sdk-probe.json` + ignored `sdk-probe.local.json`; the
  history was rewritten before the repository went public.
- **Files:** `packages/core/scripts/probe.ts`, `.gitignore`.

### 2026-10-03 — Trust tests failed on Linux
- **Symptom:** `trust.test.ts` failed on the server (deploy tests run there).
- **Cause:** paths written as Windows paths only.
- **Fix:** paths built with `join` and temp folders.
- **Files:** `packages/core/src/trust.test.ts`.

## Sub-phases A, B, C1 and the phone fixes (2026-10-03)

### 2026-10-03 — A rolled-back release would be redeployed by the timer
- **Symptom (found in review):** after `rollback.sh`, the next timer run would install the same failing commit again.
- **Cause:** `--when-idle` only compared `current` with `origin/main`.
- **Fix:** `rollback.sh` marks the release `.failed`; `--when-idle` skips releases with `.failed` (also set when
  tests fail).
- **Files:** `deploy/install.sh`, `deploy/rollback.sh`, `packages/server/src/deploy.test.ts`.

### 2026-10-03 — File writes could escape the session folder through symlinks
- **Symptom (found writing the tests):** writing to `out/x.txt` where `out` links outside the folder, or to a dangling
  link, wrote outside; `allegati/` as a link sent attachments outside; deleting a link moved its target.
- **Cause:** one resolution mode for every operation (realpath of the target only).
- **Fix:** three modes — `target` (must exist, realpath inside), `create` (parent realpath inside, the name itself not
  a link), `entry` (the link itself, never its target); attachments resolve `allegati/` before writing.
- **Files:** `packages/core/src/files.ts`, tests in `packages/core/src/core.test.ts` (Linux only).

### 2026-10-03 — Push test flaky on Linux
- **Symptom:** `push.test.ts` failed now and then on Linux.
- **Cause:** a fixed 50 ms wait with commands sent in parallel.
- **Fix:** one command at a time, each awaited.
- **Files:** `packages/server/src/push.test.ts`.

### 2026-10-03 — `commands` field clashed with the `commands()` method of Tab
- **Symptom:** typecheck error after adding the lifecycle map.
- **Fix:** the map is `held`.
- **Files:** `packages/core/src/tab.ts`.

### 2026-10-03 — Websocket replay contract test flaky under load
- **Symptom:** "a drop is followed by a replay" failed once on Linux: `['first', 'while ']` instead of
  `['first', 'while away']`.
- **Cause:** the test waited for the replayed item to exist; replayed events arrive one at a time, so it read the
  text between the two deltas.
- **Fix:** wait for the whole text (a lost delta still times out).
- **Files:** `packages/server/src/contract.test.ts`.

### 2026-10-03 — iOS would zoom in on fields
- **Symptom (e2e):** the touch fields were 15 px; iOS zooms on focus below 16 px.
- **Cause:** `button, input, textarea { font: inherit }` came after the 16 px rule and reset it.
- **Fix:** `input, textarea, select { font-size: 16px }` after the reset.
- **Files:** `packages/ui/src/touch.css`.

### 2026-10-03 — New folder not shown in the Home until navigating
- **Symptom:** after "Nuova cartella" the list stayed the same.
- **Cause:** the core emits `folders.updated` only for Home and project marks, not for folder contents.
- **Fix:** the Home reloads its listing after create, delete and restore.
- **Files:** `packages/ui/src/touch/HomeScreen.tsx`.

### 2026-10-03 — Code preview injected HTML
- **Symptom (review against design rule 10):** the highlighted code was rendered with `dangerouslySetInnerHTML`.
- **Fix:** highlight.js output parsed into React nodes (`spanNodes`, only `<span class>` and escaped text), with a test
  that an `<img onerror>` inside a string stays text.
- **Files:** `packages/ui/src/touch/model.ts`, `packages/ui/src/touch/FilesScreen.tsx`.

### 2026-10-03 — The ghost of the message showed at the bottom of the chat
- **Symptom:** the reminder of your message stayed on screen while reading the end of the answer.
- **Cause:** it showed whenever the message had scrolled off the top.
- **Fix:** hidden at the bottom of the chat (within the follow distance), shown as soon as you scroll up.
- **Files:** `packages/ui/src/touch/ChatScreen.tsx`.

### 2026-10-03 — The same session listed twice; empty sessions kept
- **Symptom:** a session "test" among the open ones and "Test session Claude wrap" among the past ones, both opening
  the same chat; a session created and never used ("progetti") stayed in the open list.
- **Cause:** the past list showed every stored session, open ones included (the tab and its JSONL are the same
  session); tabs were persisted and restored whether used or not; the tab title stayed the folder name while the CLI
  generated its own.
- **Fix:** past lists exclude sessions with a tab; a chat left with nothing sent and an empty composer is closed; the
  core does not restore tabs without a session or a queue; the title follows the CLI's at every turn end until the user
  renames the tab.
- **Files:** `packages/ui/src/touch/sessions.tsx`, `HomeScreen.tsx`, `TouchApp.tsx`, `packages/core/src/workspace.ts`,
  `packages/core/src/tab.ts`.

### 2026-10-03 — Smaller fixes found while checking the screens
- "Riavvia Claude" was offered on never-started sessions → only after a crash (`ChatScreen.tsx`).
- A never-started session showed "Model" as its model → "Modello predefinito" (`modelSheets.tsx`).
- `/favicon.ico` 404 in the PWA → icon link (`apps/mobile/index.html`).
- `.chip.changed` and two other rules lost in the CSS port → selector-by-selector diff with the prototype (`touch.css`).
- Test-only: the ghost e2e waited for the working line to disappear before it had appeared → waits for the whole
  answer; a tab named "to be forked" made the desktop "Fork" selector ambiguous ("Close to be forked") → exact match.

### 2026-10-03 — The gauge sheet showed only the context, never the 5-hour and weekly bars
- **Symptom:** on the iPhone the composer gauge's sheet had the context bar only, also after a turn.
- **Cause:** the sessions ran with an account added by `claude setup-token`: the CLI's `/usage` call answers
  `rate_limits_available: false` for such tokens (no profile scope), so core never had plan windows. (The plan windows
  were also memory-only, lost at every automatic update.)
- **Fix:** plan windows also come from every `rate_limit_event` (`unifiedWindows.five_hour` / `seven_day`, fractions and
  epoch seconds, outside the SDK's types; checked on CLI 2.1.287 with both added accounts), merged per account; a
  `/usage` answer without limits does not erase them; saved in `state.json`.
- **Files:** `packages/core/src/usage.ts` (`planLimitsFromEvent`), `tab.ts`, `workspace.ts`.

### 2026-10-04 — A linked note pushed Send off the screen
- **Symptom:** after "Use in the message" on a note with a long first line, its card and the input bar grew wider
  than the iPhone screen; Send could not be reached.
- **Cause:** `.composer` and `.input-box` are grids with an implicit `auto` column: the note title (`nowrap`) set its
  min-content width, so the column widened past the screen (the ellipsis never applied). Same class as the
  spread-out tool cards (`.tool-group`, fixed the day before).
- **Fix:** `grid-template-columns: minmax(0, 1fr)` on both, `min-width: 0` on `.linked-note`; the PWA e2e checks bar
  and Send stay within the screen with a long note.
- **Files:** `packages/ui/src/touch.css`, `apps/mobile/e2e/pwa.e2e.ts`.
- **Rule:** a grid holding one-line ellipsized text needs a `minmax(0, 1fr)` column.

### 2026-10-04 — A session's title became a whole prompt and filled half the chat header
- **Symptom:** the title of a long session turned from a short phrase into the start of its first prompt (ending in
  "…"), with nobody renaming it; with titles wrapping, the chat header took half the screen.
- **Cause:** the CLI's `SDKSessionInfo.summary` is its generated title, but for some sessions (a long one here) it falls
  back to a prompt (the first, later the last). Opening a stored session from the list passed that text as the tab's
  title, which made it fixed (`autoTitle: false`), as if the user had renamed it.
- **Fix:** a title from the CLI is its custom title, or the summary only when ≤ 80 chars (`cliTitle`); a stored session
  is opened without a title and takes the CLI's right away; a saved title longer than 80 chars comes back as the
  folder's name, following the CLI again; top bar titles show two lines at most.
- **Files:** `packages/core/src/tab.ts`, `workspace.ts`, `commands.ts`, `packages/ui/src/touch/sessions.tsx`,
  `parts.tsx`, `touch.css`.

### 2026-10-04 — The chat slid up: header gone, an empty band under the composer
- **Symptom:** seen in screenshots of the PWA at iPhone size: the top bar out of view and ~120px of empty background
  under the composer.
- **Cause:** the composer's veil reaches 120px past the screen's bottom (so no strip of chat shows under it), and the
  screen and device clipped it with `overflow: hidden` — a hidden overflow can still be scrolled (focus,
  scrollIntoView), and the whole screen slid up by that much.
- **Fix:** `overflow: clip` on `.screen` and `.device` (not scrollable at all).
- **Files:** `packages/ui/src/touch.css`.
- **Rule:** anything drawn past an edge on purpose is clipped with `overflow: clip`, never `hidden`.

### 2026-10-04 — "Passa a …" shown although the account was not at its limit
- **Symptom:** the usage limit card appeared on sessions of "personale", whose 5-hour window was at 0%; the limit ran
  until 20:00, the weekly reset of the other account "CREAaps" (at 100%).
- **Cause:** a switch takes effect at the end of the running turn, but `Tab.account` changes at once: the old
  process's `rate_limit_event` (CREAaps rejected) was recorded for the new account (and its plan windows merged
  there). Nothing ever lifted a limit before its reset time either.
- **Fix:** limits and plan windows go to the account the process was started with (`processAccount`); a turn that
  ends in success without a rejection lifts the limit recorded for its account (`limitLifted`).
- **Files:** `packages/core/src/tab.ts`, `workspace.ts`.

### 2026-10-04 — Three PWA e2e tests broke without an app bug
- **Symptom:** before pushing the account rename, `npm run e2e:mobile` failed 3 of 29 tests (also on the commit before):
  the gauge read 24% instead of 37%; "deleting a folder with a session open inside" never found the folder's ⋯; the
  automatic-compaction test could not click "200k".
- **Causes:** (1) the fake `/usage` answer had fixed reset dates (2026-10-03 22:00): once past, the UI rightly counts
  the window as reset (0%). (2) Leaving a chat now lands in the project's folder, which goes up with "Up: <parent>",
  while the test only pressed "Back". (3) In `.segmented` the invisible radio sits over its label, so a click on the
  text is intercepted; and `check()` fails on a radio that turns on only after the backend answers.
- **Fix:** fake reset dates in 2099; the test presses "Back" or "Up: …"; the radio is clicked by role with `click()`.
  Warnings added to [procedure.md](procedure.md#end-to-end-tests-pwa-fake-sdk).
- **Files:** `packages/core/src/testing/fakeQuery.ts`, `packages/core/src/core.test.ts`, `apps/mobile/e2e/pwa.e2e.ts`.

### 2026-10-05 — Automatic updates filled the server's disk
- **Symptom (reported by linux stup):** 42 releases of ~740 MB in `/srv/apps/claude-wrap/releases` = 31 GB, growing
  ~8 GB a day while developing; at that pace the free 366 GB would last weeks, then Jellyfin and the system stop too.
- **Cause:** `install.sh` builds one release per commit (each with its own `node_modules`) and never removed old ones.
- **Fix:** after every switch keep `current`, `previous` (rollback) and the newest `.failed` release (to look into);
  remove the rest. A removed failed release is an older commit than the live one, so the timer never rebuilds it.
  First version exited at once under `pipefail` when no release had `.failed` (`ls` with no match) → `|| true`.
- **Files:** `deploy/install.sh`, `packages/server/src/deploy.test.ts`, `docs/deploy.md`.

### 2026-10-05 — The backend switch squeezed "This PC" into a narrow cell
- **Symptom:** on the desktop launched under xvfb, with one backend, the switch's only option took a third of the
  row and its label wrapped ("This / PC").
- **Cause:** `.backend-choices` (flex) came earlier in `touch.css` than `.segmented` (grid, 3 columns) with the same
  specificity, so the generic segmented grid won.
- **Fix:** `.segmented.backend-choices` (flex, options `flex: 1 1 0`).
- **Files:** `packages/ui/src/touch.css`.
- **Rule:** a variant of a shared element is written with both classes, so its order in the stylesheet does not matter.

### 2026-10-06 — A forked session lost its effort
- **Symptom:** "Fork" copied a session with its model and mode but the copy started at the model's default effort.
- **Cause:** `fork` in `core/src/commands.ts` built the new tab with `model` and `mode` only; `effort` (added in
  sub-phase B) was never added there.
- **Fix:** the fork passes `effort: tab.effort` too; the workspace fork test now checks effort and mode.
- **Files:** `packages/core/src/commands.ts`, `packages/core/src/workspace.test.ts`.
- **Rule:** a new per-tab setting is checked in every place that creates a tab (`tab.create`, fork, restore).

### 2026-10-05 — Opening the app showed the space of a keyboard that was not there
- **Symptom:** sometimes, opening the PWA on the iPhone, the app was shrunk with an empty dark band at the bottom, as
  if the keyboard were open.
- **Cause:** back from the background, iOS kept reporting the visual viewport without the keyboard, and
  `keyboard.ts` copied that height into `--app-h`. A first fix (blur the field and measure again on
  `visibilitychange`/`pageshow`) measured right then and took the same stale value again.
- **Fix:** with no field focused there is no keyboard: `--app-h` is dropped and the CSS height fills the screen; the
  viewport height is followed only while typing. The focused field is still let go when the app is hidden.
- **Files:** `packages/ui/src/touch/keyboard.ts`, `apps/mobile/e2e/pwa.e2e.ts`.

### 2026-10-05 — Several notifications at once instead of one
- **Symptom:** one notification per chat; then, with a single tag, still several stacked on the iPhone.
- **Cause:** the service worker used one tag per session; and iOS does not replace a notification that has the same
  tag (WebKit bug 258922), it adds a new one.
- **Fix:** one notification with the counts of chats waiting and finished (core keeps them); every notification is
  closed (`getNotifications()` + `close()`) before showing the new one; the app clears them when on screen.
- **Files:** `apps/mobile/public/notice.js`, `apps/mobile/public/sw.js`, `apps/mobile/src/main.tsx`,
  `packages/core/src/workspace.ts`, `packages/server/src/push.ts`.

### 2026-10-05 — Reaching the end of the chat stopped dead, without the bounce
- **Symptom:** scrolling down to the end of a chat stopped abruptly instead of bouncing.
- **Causes:** (1) reaching the bottom set `follow`, which recreated the dock's `ResizeObserver`; its first callback
  set `scrollTop`, and a programmatic scroll on iOS cuts the momentum and the bounce. (2) While the glide to new text
  ran, a scroll by the user was taken for one of its steps and ignored, so the glide kept pulling.
- **Fix:** the observer lives as long as the chat and moves it only when the dock's height really changes; the glide
  remembers the position it set and stops at any other move. The e2e counts `scrollTop` writes while the wheel
  scrolls to the end (must be 0).
- **Files:** `packages/ui/src/touch/ChatScreen.tsx`, `apps/mobile/e2e/pwa.e2e.ts`.

### 2026-10-05 — "Claude sta lavorando · 567 s"
- **Symptom:** the working time beside "Claude sta lavorando" counted only seconds.
- **Fix:** it uses `durationLabel` ("9 min 27 s", "1 h 12 min"), like the usage panel.
- **Files:** `packages/ui/src/touch/Conversation.tsx`, i18n en + it.

### 2026-10-05 — The reds of the dark theme looked pink
- **Cause:** `--danger` was `#f2b8b5` (a pale red) in the dark theme.
- **Fix:** `#ff6b5e` dark, `#c62828` light, both ≥ 4.5:1 on every background; rule written in design-system.md.
- **Files:** `packages/ui/src/touch.css`, `docs/design-system.md`.

### 2026-10-06 — The terminal lost its colours and measures under the CSP
- **Symptom:** 20 "Applying inline style violates … style-src 'self'" errors when a terminal opened; colours and row
  measures of xterm.js missing.
- **Cause:** xterm.js writes its theme and dimensions in `<style>` elements (and `style` attributes), blocked by the
  strict CSP of the server and the desktop.
- **Fix:** `style-src 'self' 'unsafe-inline'` (scripts stay `'self'`; images, fonts and connections stay on the
  backend). Alternative left open: xterm's WebGL renderer. The terminal e2e asserts no CSP refusal.
- **Files:** `packages/server/src/server.ts`, `apps/desktop/src/main/index.ts`, `apps/mobile/e2e/pwa.e2e.ts`.

### 2026-10-06 — Packaging the desktop tried to compile node-pty
- **Symptom:** `electron-builder --win --dir` stopped with "node-gyp does not support cross-compiling native modules".
- **Cause:** electron-builder rebuilds native dependencies by default (on the PC it would need Visual Studio tools).
- **Fix:** `"npmRebuild": false` — node-pty's N-API prebuilds work in Electron as they are; `node_modules/node-pty/**`
  unpacked from asar.
- **Files:** `apps/desktop/package.json`, `docs/procedure.md`.

### 2026-10-06 — A commit swept in another session's unfinished work
- **Symptom:** `78c1191` (terminal Copy all/Paste/links) also contained chat and composer changes of the other Claude
  session, which committed only their design-system entry afterwards (`4928714`).
- **Cause:** both sessions work in the same dev clone `/srv/progetti/claude-wrap`, and the commit used `git add -A`.
- **Fix:** commit only the paths you touched (`git add <files>`), check `git status` first (rule in CLAUDE.md
  "Conventions"). The swept changes had been through the full e2e run, so nothing broke.

### 2026-10-06 — The same sweep again, and this time `main` did not typecheck
- **Symptom:** `f1c09e3` (queue countdown 10 s) also contained the other session's unfinished default-effort work
  (`workspace.ts`, its e2e test and docs) without its protocol and state parts: `tsc` failed on `main`.
- **Cause:** `git add -A` again, in the clone both sessions use. The tests had passed in that tree because they
  ran on everyone's uncommitted files.
- **Fix:** the other session pushed its complete change on top (`cdca724`); a corrective commit made in a separate
  worktree was then unnecessary. Commit by path only, as the CLAUDE.md rule says. To check what a commit alone does,
  use a separate worktree with its own `node_modules/@claude-wrap` links: the root `node_modules` links are relative
  and point back to the shared clone.
- **Files:** none (process); `CLAUDE.md` "Conventions" already holds the rule.
