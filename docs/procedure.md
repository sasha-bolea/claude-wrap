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
3. Fake SDK keywords (send them as the message): `permission`, `question`, `plan`, `slow` (long stream to interrupt), `markdown` (remote image + link), `crash`; anything else is echoed word by word. Conversations are stored in the fake session store (in memory of the core process: gone after an app restart).
4. A failing selector: check names in `packages/ui/src/i18n/en.ts`; playwright `hasText` is a case-insensitive substring ("Renamed" matches "Rename"+"Delete").

**Warnings:** never point e2e at the real `%APPDATA%\claude-wrap`; `openChat(page, folder)` must get the folder the dialog returns, or it may click the previous folder's buttons.

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
