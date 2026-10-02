# STATO — claude-wrap

_Last updated: 2026-10-02 04:11_

## Current state
Phase 0 (bootstrap) in progress: repository and docs created from the approved [plan](piano.md); reference docs being translated to English. No code yet.

## Open problems
- Subscription login in a third-party app and SDK redistribution: to verify before any public release ([note-rilascio.md](note-rilascio.md)).

## Recent decisions
| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-02 | Restart from zero in `personale/claude-wrap`; the first attempt (`personale/claude wrap`) stays as read-only reference | The first attempt let the window own the tabs and had no resume; with PC + phone on the same session the state must live in the backend. Rebuilding the structure was cleaner than refactoring it |
| 2026-10-02 | Three applications around one `core`: desktop (Electron, local or remote backend), remote server (Node on the Debian home server), mobile PWA | Use Claude from anywhere, phone included, without losing the desktop |
| 2026-10-02 | Local core in an Electron `utilityProcess`, reached over `MessagePort` | Real separation of front and back, crash isolation, same code as the server, no TCP port open on the PC |
| 2026-10-02 | Numbered event streams with epochs, idempotent commands, message queue and requests held in core | Reload, network drops and core restarts must never lose or duplicate events, prompts or answers; first answer to a request wins across devices |
| 2026-10-02 | Remote access with per-device tokens from one-time pairing codes, plus Origin/Host checks, behind Tailscale Serve (`:8443` → `127.0.0.1:3012`) | No credentials to type on the phone, revocable per device; Tailscale already authenticates devices, the token protects against local processes and lost phones |
| 2026-10-02 | Everything in English (code, comments, docs); UI in English and Italian | Open source audience; Sasha keeps an Italian UI |
| 2026-10-02 | Server + PWA in Phase 3, after the desktop chat and composer | Phone usable early; later panels and config are built once and tested on both backends |
| 2026-10-02 | npm workspaces; SDK 0.3.287; MIT; no public installers until SDK/ToS verified | No extra tooling; latest SDK at restart; redistributing the SDK binary is doubtful |

## Backlog
1. Phase 0 — bootstrap: workspaces/TS/vitest skeleton, SDK 0.3.287 probe, Electron window showing versions through hello/welcome over a brokered MessagePort ([piano.md](piano.md) §3).
2. Phase 1a — headless core: protocol + core + client over InMemory with FakeQuery.
3. Phase 1b — single-tab desktop chat.
4. Phase 1c — multi-tab, sessions, trust, restore, crash recovery, packaged build.
5. Phase 2 — composer and commands.
6. Phase 3 — remote server + PWA + backend switcher (design session with Sasha first).
