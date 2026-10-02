# claude-wrap

## 0. Language (project override)
- **Code identifiers, code comments and all docs are in English.** This overrides the global rule "comments in Italian". The docs keep the standard Italian **filenames** (`STATO.md`, `architettura.md`, `bug-risolti.md`, …); only their content is English.
- The UI ships in **English and Italian** (`t()` + typed dictionaries, both always complete).
- Claude still **replies to Sasha in Italian**.
- Comment style otherwise as the global rules: above each function (what / parameters / return), inline only on dense lines.

## 1. Project & purpose
A graphical app with every feature of the Claude Code CLI, built on the Claude Agent SDK, in three applications around one backend `core`: desktop (Electron, local or remote backend), remote server on the Debian home server, mobile PWA. The same session can be open on PC and phone at the same time. Details: [docs/brief.md](docs/brief.md).

## 2. Team & roles
- sasha — sole developer and owner.

## 3. Stack
- TypeScript 5.9 everywhere, npm workspaces, Node 24.
- `@anthropic-ai/claude-agent-sdk` **0.3.287** (pinned exact; bundles CLI 2.1.287). Authoritative API: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.
- Desktop: Electron 44, electron-vite 5 (requires **vite ≤ 7**), React 19, preload must be **CJS** with `sandbox: true`.
- Server: `node:http` + `ws`, systemd user service on Debian 13.
- zod 4 (protocol), vitest 5 (tests), playwright (e2e).
- Environment quirks: Windows 11 is the main dev machine; the server is reachable only through Tailscale.

## 4. Key structure
```
packages/protocol   zod schemas + types of the client↔core protocol
packages/core       the backend: tabs, sessions, transcripts, requests, trust, processes, state
packages/client     transport-agnostic connection + store used by the UI
packages/ui         the single React UI (desktop + mobile)
packages/server     remote host (WebSocket, pairing, static PWA, systemd)
apps/desktop        Electron shell (core in a utilityProcess, MessagePort brokering)
apps/mobile         PWA build of the UI
```
_(filled in as the code grows — Phase 0)_

## 5. Commands
_(filled in Phase 0: setup, dev:desktop, dev:server, test, typecheck, probe, e2e)_
- Multi-step procedures (SDK update/probe, e2e): [docs/procedure.md](docs/procedure.md).
- Ports: renderer dev server **5199**, server dev **3012** (registered in `~/.claude/porte.md`; on the home server 3012 is registered in `personale/linux stup/docs/architettura.md`).

## 6. Conventions
- **The core owns all shared state**; clients keep only view state. `ui` and `client` never import `core`; `core` never imports Electron or `ws`.
- Every frame crossing a transport is validated with the `protocol` zod schemas, on both sides.
- Tests first (from user stories), then code. Core logic is tested with the FakeQuery (`CoreConfig.query`), e2e on the fake SDK (`CLAUDE_WRAP_FAKE_SDK`); the real CLI only in the small smoke suite with `/model haiku`.
- e2e and dev runs that are not the real app use `CLAUDE_WRAP_STATE_DIR` (never the real app state).
- UI: follow [docs/design-system.md](docs/design-system.md) before building or changing any interface.
- Host changes on the home server are done by the `linux stup` session on Sasha's request, never from here.
- Do not run multi-agent review workflows without telling Sasha the cost first (they exhausted the 5-hour subscription quota before).

## 7. Docs references
- [docs/STATO.md](docs/STATO.md) — current state, decisions, backlog
- [docs/brief.md](docs/brief.md) — what and why
- [docs/piano.md](docs/piano.md) — **project addition**: approved plan, phases with "done" criteria
- [docs/architettura.md](docs/architettura.md) — structure, protocol, data model, processes, security, test plan
- [docs/design-system.md](docs/design-system.md) — UI rules and catalogue
- [docs/bug-risolti.md](docs/bug-risolti.md) — solved bugs (incl. the first attempt's)
- [docs/procedure.md](docs/procedure.md) — runbook
- [docs/note-rilascio.md](docs/note-rilascio.md) — licence and subscription constraints
- [docs/reference/cli-census.md](docs/reference/cli-census.md) — every CLI feature (+ Part D: SDK control protocol)
- [docs/reference/parity-map.md](docs/reference/parity-map.md) — each census entry → how the GUI covers it
- First attempt (read-only reference): `personale/claude wrap/docs/handoff-ripartenza.md`
