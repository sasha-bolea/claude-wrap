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
