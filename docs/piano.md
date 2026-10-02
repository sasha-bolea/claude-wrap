# Plan — claude-wrap

_Project addition to the standard docs set (registered in CLAUDE.md §7). Approved by Sasha on 2026-10-02. Architecture, protocol, data model, processes, security and test plan: [architettura.md](architettura.md). Current progress: [STATO.md](STATO.md)._

## 1. Decisions locked with Sasha (2026-10-02)
| Topic | Decision |
|---|---|
| Location | New folder `personale/claude-wrap` (no space), new git repo. Old folder stays untouched as read-only reference. |
| Language | Code identifiers, comments, docs: **English**. UI: **English + Italian** (typed dictionary per language, default = system language, user override). Claude replies to Sasha in Italian. |
| Monorepo | npm workspaces. |
| Backends | **One `core` package**, identical for local and remote; only the host shell differs. |
| Desktop local backend | Core runs in an Electron **`utilityProcess`**, reached over **`MessagePort`** (no TCP port on the PC). |
| Desktop backends | **One shown at a time** (switcher); all configured connections stay open → badge + notification from hidden ones. Side-by-side later without core changes. |
| Window close | Closes local sessions; tabs restored (dormant) at next start. Tray later. |
| Remote host | Debian 13 home server: Node 24 (NodeSource apt), systemd **user** service + linger, listen `127.0.0.1:3012`, Tailscale Serve `https://<host>.<tailnet>.ts.net:8443`, code in `/srv/apps/claude-wrap` (outside the root), session root `/srv/progetti`, state `~/.local/state/claude-wrap/`, journald, `MemoryHigh=5G`/`MemoryMax=6G`, ~8 live sessions, versioned update script. Host changes are executed by the linux-stup session on Sasha's request. |
| Access | **Per-device token** obtained by pairing, stored hashed, revocable per device; plus Origin/Host checks. No credentials. |
| Multi-client | Messages queue in arrival order; first answer to a request wins, others close with "answered from <device>"; draft/scroll per client. |
| Orphans | Windows: taskkill tree of the dead claude's children (existing). Linux: process group + systemd cgroup. |
| Release | MIT for our code; **no public installers** until SDK licence/ToS verified (source-only, `npm install`). |
| SDK | Latest at restart (`0.3.287`, 2026-10-01) + re-run the probe. |
| Phase order | Server + PWA = **Phase 3, after Phase 2**; phases 4+ are built and tested on both backends. |
| Reference docs | Census and parity map **translated to English in Phase 0**. |
| Cost | No multi-agent review workflows without telling Sasha first. |

## 2. Bootstrap (first actions after approval)
1. `~/.claude/porte.md`: add **3012** (PC, server dev) and rename the 5199 row to `claude-wrap`. Message `linux-stup-87`: Sasha confirmed 3012 / 8443 / `/srv/apps/claude-wrap` / memory limits → it registers the port in its table.
2. Create `personale/claude-wrap/`, `git init`, docs with the **standard filenames and English content** (the project CLAUDE.md states that only the content language changes): `brief.md` (old brief + 3-app vision), `STATO.md`, `storico-sessioni.md`, `architettura.md` (§2-§7 of this plan), `piano.md` (§8 phases; registered in CLAUDE.md §7 as a project addition), `design-system.md` (rules 1-8 carried over, rule 3 with English class names, rule 8 rewritten as "all UI text through `t()`, en and it dictionaries always complete"; catalogue filled as UI is built), `note-rilascio.md` (licence/ToS), `bug-risolti.md` (seeded with the first attempt's solved bugs: commits `3c0a6d1`, `7ad95d5`, `532414b`, handoff §5), `procedure.md` (e2e, probe). `deploy.md` is created in Phase 3 (systemd install/update).
3. `docs/reference/cli-census.md` and `docs/reference/parity-map.md`: English translations of the originals (sonnet subagent; row/entry counts must match), plus `docs/reference/sdk-probe.json` refreshed in Phase 0.
4. Project `CLAUDE.md` (numbered sections per global standard) with an explicit **language override** (identifiers/comments/docs English, overriding the global "comments in Italian"; UI en+it; replies in Italian).
5. First commit. Update memory `progetto-claude-wrap-ripartenza` to point at the new folder (the memory directory key is identical for both folder names).

## 3. Phases with verifiable "done" criteria
Scope per phase follows `docs/reference/parity-map.md` (260 entries; N and B excluded). "Done" = criteria checked live by Sasha + tests green + docs updated at buonanotte.
- **Phase 0 — Bootstrap.** ✅ done 2026-10-02. §1; workspaces/TS/vitest skeleton; SDK 0.3.287 probe re-run and handoff §4 facts re-verified; Electron window (app://) shows versions obtained through hello/welcome over a brokered MessagePort from the utilityProcess core. *Done:* `npm test` + `npm run typecheck` green; `npm run dev:desktop` shows "core x.y.z · SDK 0.3.287 · CLI 2.1.287"; probe diff recorded; reference docs translated with matching counts.
- **Phase 1 — Core + local desktop chat** (first-attempt parity minus palette), in three steps with a stop after each — ✅ all three done 2026-10-02 (live check by Sasha pending):
  - **1a — Headless.** protocol + core + client over InMemory, FakeQuery. *Done:* unit + contract tests green; a node script chats through the real CLI (`/model haiku`) via core + client and prints the normalized items.
  - **1b — Single-tab desktop.** Electron shell, port brokering, ui with streaming, permission/question/plan, interrupt (Esc + Stop), model and mode, en/it, design-system rules (focus never on granting buttons, aria-live, Shift+Tab only in the composer). *Done:* token-by-token; deny with reason reaches Claude; "always" applies the CLI's suggestion (a rule in `.claude/settings.local.json` for Bash; accept-edits for the session for Write — verified CLI behaviour); Esc → `aborted_*`; renderer `typeof require === 'undefined'` and CSP active; reload mid-stream loses/duplicates nothing.
  - **1c — Multi-tab and robustness.** Tabs, sessions list/resume/rename/delete/fork, trust gate, dormant restore, notifications + badges, crash recovery, packaged `--dir` build. *Done:* resume same sessionId; fork → new id in the list; 3 sessions streaming in 3 folders; untrusted folder blocks hooks; notification on `requires_action`; killing the utilityProcess → auto-restart, tabs back, zero orphans; quit during a turn → zero orphans; deleting a just-closed session works; opening an old tab only to read it starts no process; the packaged build starts and chats.
- **Phase 2 — Composer and commands.** Palette (`supportedCommands` + `commands_changed`), `@` mentions, image paste/drag, long paste, history Up/Ctrl+R, core queue UI, `!` mode. *Done:* every ✓b/✓s row runs from the palette with visible output; a pasted image reaches the model; a queued message fires at turn end and can be removed before.
- **Phase 3 — Remote server + PWA + backend switcher** (detailed design session with Sasha first; this plan fixes only the constraints of §0/§6). Server package, WS transport, pairing/devices, Origin/Host, root confinement, folder browser, Linux process groups, systemd unit + install/update scripts, PWA touch layout (Stop button for Esc, mode selector for Shift+Tab, history button, photo/file picker + `files.upload` for drag), Web Push notifier, desktop switcher with cross-backend badges, main-owned remote sockets, `docs/deploy.md`. *Done:* phone over Tailscale: pair (installed PWA, pasted code), open a tab in `/srv/progetti/x`, chat, answer a permission; with the phone locked, a permission request arrives as a push notification; the same tab on the desktop (remote backend) streams live; answer on the phone closes the request on the desktop; airplane mode 30 s → nothing lost; revoke → disconnected; service restart → tabs dormant, `ps` shows no orphans.
- **Phase 4 — Data panels** (context, usage, status, MCP, tasks/subagents, todo, rewind, diff, hooks). *Done:* same numbers as CLI `/context` and `/usage`; rewind restores an Edit-modified file.
- **Phase 5 — Config** (settings with provenance, permissions, memory, skills/agents/output styles, plugins/MCP, theme). *Done:* a GUI change lands in the right file and is honoured by the terminal CLI.
- **Phase 6 — Advanced editor** (desktop only: CodeMirror 6, vim, readline keys, external editor).
- **Phase 7 — Residuals** (untyped runtime methods behind feature detection, fallbacks).
- **Phase 8+ — Sasha's own features.**

## 4. Verification of this plan's execution
Each phase ends with its "done" checklist run live by Sasha (links/paths, no screenshots), `npm test` + `npm run typecheck` + the relevant e2e suite green, and a buonanotte doc update. Phase 0: run `npm run dev:desktop` and read the version line; `npm test` output.
