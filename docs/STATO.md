# STATO — claude-wrap

_Last updated: 2026-10-02 15:27_

## Current state
**Phases 0 and 1 are done** (bootstrap, headless core, single-tab desktop, multi-tab desktop) — every "done" criterion of [piano.md](piano.md) §3 checked by tests, by real-CLI smoke runs or both (details in [storico-sessioni.md](storico-sessioni.md), 2026-10-02 15:27). Live check by Sasha still to do.
- Monorepo: `packages/{protocol,core,client,ui}` + `apps/desktop`; 101 unit tests, 19 desktop e2e on the scripted fake SDK, typecheck clean.
- Desktop: multi-tab Electron app, core in a utilityProcess with restart, state in `%APPDATA%\claude-wrap\state.json`, packaged build `apps/desktop/dist/win-unpacked/claude-wrap.exe` (personal use only, see [note-rilascio.md](note-rilascio.md)).
- Next: **Phase 2 — composer and commands** (palette, `@` mentions, images, long paste, history, visible queue with "send now", `!` mode).

## Open problems
- Subscription login in a third-party app and SDK redistribution: to verify before any public release ([note-rilascio.md](note-rilascio.md)).
- User data folder `%APPDATA%\claude-wrap` is the same name the first attempt used: its old `stato.json` is untouched, but the two apps cannot run at the same time. Rename is one line in `apps/desktop/src/main/index.ts` if wanted.
- After resuming a session, local command outputs and turn cost/duration do not come back (`getSessionMessages` does not return them).
- Fork verified on the fake SDK and in unit tests, not yet with the real CLI.
- The real-CLI smoke scripts (packaged build, orphans, resume) were run from the session scratchpad: not in the repo yet ([procedure.md](procedure.md)).
- Renderer bundle 1.27 MB (zod + react-markdown + React); fine for now.

## Recent decisions
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

## Backlog
1. Phase 2 — composer and commands ([piano.md](piano.md) §3).
2. Move the real-CLI smoke scripts into the repo (`npm run smoke`, haiku, few tokens).
3. Real-CLI check of fork.
4. Phase 3 — remote server + PWA + backend switcher (design session with Sasha first).
5. Phase 4+ — data panels, config, advanced editor, residuals.
