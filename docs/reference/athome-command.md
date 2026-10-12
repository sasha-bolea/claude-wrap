# The `athome` command — using AtHome from a terminal

How a person over SSH, a script, or Claude through its Bash tool uses AtHome from the home server: lists projects and
sessions, reads a chat and waits for Claude's reply, creates projects, starts sessions. Everything goes through one
command, `athome`, over a local Unix socket; what each caller may do is decided by the server's core, never by the
command itself. Code: [packages/server/src/athomeCli.ts](../../packages/server/src/athomeCli.ts) (the command),
[packages/core/src/actions.ts](../../packages/core/src/actions.ts) (the policy).

Plans and caller keys (a program such as Petra acting on its own inside plans the user approved) existed from
2026-10-08 to 2026-10-12 and were removed: Sasha decided Petra does not use AtHome on her own.

## 1. Where it runs
- On the server only, as the service user: the command connects to `~/.local/state/claude-wrap/terminal/athome.sock`
  (folder `0700`, socket `0600`). There is no network access and no token: the file system is the authentication.
- Installed by the deploy as `~/.local/bin/athome` (make sure `~/.local/bin` is in `PATH`, or call it by its path).
- `athome --help` prints the full usage. Every command accepts `--json` for machine-readable output.
- Exit codes: `0` done · `1` error (server not running, timeout) · `2` wrong command line · `3` not allowed.

## 2. Who may do what
| Caller | How the core tells | May do |
|---|---|---|
| A person in a terminal (SSH) | stdin and stdout are a TTY | read; create projects; start sessions — at once, no confirmation |
| Claude in an AtHome session | `CLAUDE_WRAP_TAB_ID` set by AtHome | read; create projects; start sessions — each one confirmed by the user in that chat (the command waits) |
| Any other program | none of the above | read only |

The command never writes to a session already open (no prompts, answers or queue). Limits that apply to everyone: the
folder trust gate (a session in a folder the user never trusted does not run until they trust it in the app), at most
10 new sessions an hour from the terminal, sessions started by a program open in "ask permissions" mode. Every action
is logged in `~/.local/state/claude-wrap/actions.jsonl` (who, what, when, how it ended).

## 3. Acting
| Command | Does | Output (`--json`) |
|---|---|---|
| `athome project create <name> [--in <folder>]` | a new project folder (default: in the Home) | `{path}` |
| `athome session start <folder> [--prompt <text>]` | a new session in a folder, with an optional first prompt | `{tabId, needsTrust?}` |

Folder paths may be relative (resolved from the current directory). A `session.start` in a folder the user never
trusted creates the chat but does not send the prompt (`needsTrust`): the user must open it and trust the folder.
Run by Claude, the command prints "Waiting for the confirmation in the AtHome chat…" and waits for the user's Yes / No
in that chat (give it a timeout of a few minutes); No ends with exit 3.

## 4. Reading
| Command | Output (`--json`) |
|---|---|
| `athome projects` | `[{name, path}]` |
| `athome sessions` | `[{tabId, title, cwd, status}]` — status: `idle`, `running`, `requires_action`, `dormant`, `needs_trust`, … |
| `athome session read <id> [--last N]` | `[{who: "user"\|"claude", text}]` (default: the last 5) |
| `athome session wait <id> [--timeout S]` | `{status, reply, request?}` — waits until Claude finishes or asks (default 600 s, exit 1 on timeout), `request` = `{kind, title}` when the chat waits for the user |

Text output: `user: …` / `claude: …` lines; `wait` prints `waiting for you: <request>` and/or `claude: <reply>`.

## 5. What the user sees
Heavy actions asked by Claude from a chat appear in that chat as "The athome command, run by Claude in this chat, asks
for it", with Yes / No (the same action card as a widget's).

## 6. Known limits
- "A person in a terminal" is detected from the TTY: a program can fake it (e.g. `script`). It protects against
  ordinary use and prompt injection, not against a deliberate program of the same user.
- No `session read` beyond the chat's recent items (what the app would show on opening).
