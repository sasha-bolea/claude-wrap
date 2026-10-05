# Procedures — claude-wrap

_Runbook of multi-step or rare procedures. One-liners used often live in CLAUDE.md §5._

## SDK update (probe)
**When:** every time `@anthropic-ai/claude-agent-sdk` is bumped.
1. Update the exact version (pinned, no `^`) in `packages/core/package.json` **and** `apps/desktop/package.json` (runtime dependency of the packaged app).
2. `npm install`, then `npm run probe` (zero tokens: only local commands; runs in the repo folder and deletes its test session).
3. Read the printed facts and `git diff docs/reference/sdk-probe.json`: `system/init` fields, `supportedCommands()`, models, `initializationResult` keys, CLI version, and the facts (`initOnlyAtFirstTurn`, `setPermissionModeEmitsStatus`, `resumeKeepsSessionId`, `internalCommands`).
4. **Exit code 1 = unclassified settings:** `unclassifiedSettings` lists top-level `Settings` keys of the new `sdk.d.ts` that mention command/helper/url/path/hook. Classify each in `packages/core/src/trust.ts`: shown as a risk (add to `HELPERS` or `RISKY_SETTINGS`) or reviewed (add to `CLASSIFIED_SETTINGS` with the reason in the comment). The unit test `settingsKeys.test.ts` fails the same way.
5. If a fact changed, check the code that relies on it (mode reconciliation in `tab.ts`, item identity in `normalize.ts`) and record it in STATO.md decisions.
6. Commit the refreshed `sdk-probe.json` with the bump (the email is redacted by the probe).

**Warnings:** untyped runtime methods (census Part D §3) can change or disappear at any release; keep them behind feature detection.

## Electron binary missing after `npm install`
**When:** `npm run dev:desktop` / e2e fail with "Electron failed to install correctly", or `node_modules/electron/dist` is missing (seen on 2026-10-02: npm 11 did not run Electron's postinstall).
1. `node node_modules/electron/install.js`
2. Check `node_modules/electron/path.txt` contains `electron.exe`.

## End-to-end tests (desktop, fake SDK)
**When:** before closing any UI or core change.
1. `npm run e2e` — builds the desktop app (`electron-vite build`), then runs `apps/desktop/e2e/*.e2e.ts` one app at a time (~1 min).
2. Each test launches `apps/desktop` with `CLAUDE_WRAP_FAKE_SDK=1` (scripted fake SDK, zero quota), `CLAUDE_WRAP_STATE_DIR=<temp>` (never the real app state) and `--lang=en-US` (English UI for the selectors). The native folder dialog is stubbed: `nextFolder(app, folder)` sets what it returns.
3. Fake SDK keywords (send them as the message): `permission`, `question`, `plan`, `slow` (long stream to interrupt), `markdown` (remote image + link), `tools` (three Bash commands in a row, one long), `crash`; anything else is echoed word by word. Conversations are stored in the fake session store (in memory of the core process: gone after an app restart).
4. A failing selector: check names in `packages/ui/src/i18n/en.ts`; playwright `hasText` is a case-insensitive substring ("Renamed" matches "Rename"+"Delete").

5. On the home server (no display): `timeout 900 xvfb-run -a -s "-screen 0 1440x900x24" npm run e2e`. Needs the
   Electron binary in `node_modules/electron/dist` (`node node_modules/electron/install.js`) and the system package
   `libgtk-3-0t64` (installed 2026-10-05). The harness uses plain-text `safeStorage` on Linux (no keyring under xvfb).

**Warnings:** never point e2e at the real `%APPDATA%\claude-wrap`; the harness's `openChat` adds the folder the stubbed dialog returns and waits for the new session to be highlighted. On the server, never `pkill -f` with a pattern that also matches your own command line (it kills the shell running it): kill stray Electron processes by PID (`pgrep -f node_modules/electron/dist/electron`).

## Packaged build (personal use only)
**When:** checking the packaged app, or before giving Sasha an exe to try.
1. `npm run dist -w @claude-wrap/desktop` → `apps/desktop/dist/win-unpacked/claude-wrap.exe` (`electron-builder --win --dir`, no installer).
2. Check the CLI binary is unpacked: `apps/desktop/dist/win-unpacked/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`.
3. Check its signature is still Anthropic's (electron-builder logs "signing" it):
   `Get-AuthenticodeSignature <that claude.exe>` → `Valid`, `CN="Anthropic, PBC"`.
4. Launch it: the bottom-right line shows `core · SDK · CLI` versions; open a folder and chat.

**Warnings:** no public distribution until the SDK licence/ToS question is settled ([note-rilascio.md](note-rilascio.md)).

## Real-CLI smoke (few haiku tokens)
**When:** after changes to process lifecycle, resume, packaging, or an SDK bump.
- `npm run chat` (in repo): core + client headless, `/model haiku` + one prompt; prints the items and checks unique ids and the stored user uuid.
- Desktop/packaged smoke scripts were run from the session scratchpad on 2026-10-02 (not in the repo yet — backlog): playwright `_electron` on the exe with `CLAUDE_WRAP_STATE_DIR=<temp>`, stubbed folder dialog, `/model haiku`; checks: a chat answer, resume from the list keeps one stored session, killing the `claude-wrap core` utility process mid-turn leaves no `claude.exe` (sweep at restart), quitting mid-turn leaves none (`tasklist /FI "IMAGENAME eq claude.exe"` before/after). Delete the test sessions afterwards (`deleteSession`).

## End-to-end tests (PWA, fake SDK)
**When:** before closing any touch UI, server or core change.
1. `npm run e2e:mobile` — builds the PWA (`apps/mobile/dist`), then runs `apps/mobile/e2e/*.e2e.ts`: the real server
   in-process on an ephemeral port with the scripted fake SDK, the **system Chrome** (playwright channel `chrome`, no
   browser download) at 390×844 with touch, `en-US`. On the home server (no Chrome) point it at Playwright's Chromium:
   `CLAUDE_WRAP_E2E_CHROME=~/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome npm run e2e:mobile`.
2. `pairedPage(context, backend)` pairs with a fresh code and dismisses the notifications offer; `openProject(page)`
   opens a session in the root's `project` folder (trusting it). Fake SDK keywords as for the desktop (`slow` streams
   400 words ≈ 8 s).
3. A test that only needs the build again: `npx vitest run --config apps/mobile/vitest.e2e.config.ts -t "<name>"`
   after `npm run build -w @claude-wrap/mobile`.

**Warnings:** names come from `packages/ui/src/i18n/en.ts`; `getByRole` names are substrings unless `exact` (a tab
title can contain "fork"); hidden screens of the stack are in the DOM: scope locators (`.chat-screen .topbar`).
In a `.segmented` group the invisible radio covers its label: click the radio by role, never its text; use `click()`,
not `check()`, when the radio turns on only after the backend answers. A folder screen goes up with "Up: <parent>",
not "Back". Dates in fake data must be relative to now or far ahead (a fixed date that passes breaks the test later).

## Core and server tests on Linux (WSL)
**When:** before a push that touches core, server or deploy (the server runs the same tests before switching).
1. From **PowerShell** (Git Bash would expand `$` in the command): `wsl bash <scratchpad>/linux-test-local.sh`.
2. The script copies the working tree (uncommitted changes included, no `node_modules`/`dist`/`.git`) to
   `/tmp/cw-linux/local`, uses a portable Node 24 in `/tmp/cw-linux/node`, `npm ci` with
   `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, and runs `vitest run packages/core packages/server` (Linux-only tests: symlinks,
   process groups, `deploy.test.ts`).

**Warnings:** the script lives in the session scratchpad (recreate it from these steps if missing).

## Real-CLI composer smoke (`npm run smoke:composer`, a few haiku tokens)
**When:** after changes to sending, mid-turn messages, send now, effort, history, or an SDK bump.
- Through core + client in a temp folder: palette commands, an image, `!` shell, a message sent while a Bash `sleep 6`
  runs (read in the same turn), **Invia ora** during a `sleep 20` (must be read within 12 s), effort `low`, then the
  stored session reopened in a fresh core (the mid-turn message exactly once). Prints `OK: …` or the problems, deletes
  its sessions.

## Real-CLI accounts smoke (`npm run smoke:accounts`)
**When:** after changes to accounts or session spawning, or an SDK bump.
- A tab with an account whose token is well-formed but invalid must fail with "401 OAuth access token is invalid"
  (proof the token reaches the CLI, zero tokens spent); switched back to Claude Code's own login, the next message
  in the same conversation gets an answer (or the login's usage limit, shown as the session's `limitedUntil`).

## Real-CLI context and usage smoke (`npm run smoke:usage`)
**When:** after changes to `packages/core/src/usage.ts`, and at every SDK bump (the usage call is
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`: its name will change).
- No message is sent (zero tokens): a fresh tab starts its process; `tab.context` must give a window, tokens and
  categories, `tab.usage` the session cost and the plan limits (or null for an API key), `tab.refreshGauges` the
  composer's gauges, and a 100k auto-compact window set in the app must show as the window (compacts at ~67k). It
  prints them: compare with
  `/context` and `/usage` in the terminal when in doubt.
- If the SDK renamed the usage call: update `readUsage` in `usage.ts` (and the fake in `testing/fakeQuery.ts`).

## Splash screens and icons of the PWA
**When:** the accent or background token changes, or a new iPhone size appears.
1. `node apps/mobile/scripts/icons.ts` — writes `apps/mobile/public/icon-*.png`, the 24 splash PNGs in
   `public/splash/` and the `<link rel="apple-touch-startup-image">` block of `apps/mobile/index.html` (between its
   two comments).
2. `npm run e2e:mobile` (the splash test checks every link is served as PNG).

## Following an automatic deploy on the home server
**When:** after a push to `main`, to know when the phone can update.
1. `ssh server 'systemctl --user list-timers claude-wrap-update.timer'` — next check (every 5 min after the last).
2. `ssh server 'readlink /srv/apps/claude-wrap/current'` — the release in use; done when it ends with the new commit.
3. Waiting longer? `ssh server 'cat ~/.local/state/claude-wrap/activity.json'` (`working` > 0 defers the switch) and
   `journalctl --user -u claude-wrap-update -n 30`; a `.failed` file in `releases/<commit>/` means its tests failed.
4. On the iPhone: "Nuova versione disponibile · Aggiorna", or close and reopen the app.

**Warnings:** from the PC only read; host changes go through linux stup.

## Translations check (params)
**When:** many new `t()` keys at once.
- The typecheck catches missing keys, not `{placeholders}`: for every `t('key', { … })` compare the param names with
  the `{x}` in `en.ts` and `it.ts` (done on 2026-10-03 with a throwaway script: depth-aware parse of the object
  literal after `t('key',`). Dynamic keys (`t(cond ? 'a' : 'b')`, template keys) need a manual look.
