# The `athome` command — using AtHome from outside (Petra's guide)

How a program on the home server (Petra, a script, Claude through its Bash tool) or a person over SSH uses AtHome:
lists projects and sessions, creates projects, starts sessions, talks to Claude, reads its replies. Everything goes
through one command, `athome`, over a local Unix socket; what each caller may do is decided by the server's core, never
by the command itself. Code: [packages/server/src/athomeCli.ts](../../packages/server/src/athomeCli.ts) (the command),
[packages/core/src/actions.ts](../../packages/core/src/actions.ts) (the policy), [packages/core/src/plans.ts](../../packages/core/src/plans.ts) (plans).

## 1. Where it runs
- On the server only, as the service user: the command connects to `~/.local/state/claude-wrap/terminal/athome.sock`
  (folder `0700`, socket `0600`). There is no network access and no token: the file system is the authentication.
- Installed by the deploy as `~/.local/bin/athome` (make sure `~/.local/bin` is in `PATH`, or call it by its path).
- `athome --help` prints the full usage. Every command accepts `--json` for machine-readable output.
- Exit codes: `0` done · `1` error (server not running, bad file, timeout) · `2` wrong command line · `3` not allowed.

## 2. Who may do what
| Caller | How the core tells | May do |
|---|---|---|
| A person in a terminal (SSH) | stdin and stdout are a TTY | read; create projects; start sessions — at once, no confirmation; make and revoke keys |
| Claude in an AtHome session | `CLAUDE_WRAP_TAB_ID` set by AtHome | read; create projects; start sessions — each one confirmed by the user in that chat (the command waits) |
| A caller with a key (**Petra**) | `ATHOME_KEY` | read; **everything else only inside a plan the user approved** (section 4) |
| Any other program | none of the above | read only |

Limits that apply to everyone: the folder trust gate (a session in a folder the user never trusted does not run until
they trust it in the app), at most 10 new sessions an hour from the terminal, sessions started by a program open in
"ask permissions" mode. Every action is logged in `~/.local/state/claude-wrap/actions.jsonl` (who, what, when, under
which plan, how it ended).

## 3. Setting Petra up
1. A person, in a terminal: `athome key create petra` → prints the key **once**. (`athome key list`, `athome key revoke petra`.)
   Keys cannot be made by a program: the command refuses when stdin/stdout are not a terminal. The server keeps only
   a hash of the key (`callers.json`).
2. Give Petra the key as the environment variable `ATHOME_KEY`. Make sure `CLAUDE_WRAP_TAB_ID` is **not** set in her
   environment (it marks an AtHome session's own shell).
3. With the key and no plan, Petra can only read (section 5). Any action answers `Not allowed: … propose one first`.

## 4. Plans: how Petra acts
A plan is a JSON file (or standard input with `-`): a short **summary** in the user's words and the **steps**, in the
order they will run. The user sees the summary and, written by the app itself from the steps, what the plan will be
allowed to do; approves or rejects it on the phone. Once approved the server lets Petra run **only the next step, with
exactly the arguments the user saw**; anything else is refused with exit 3.

```json
{
  "summary": "Creo il progetto petra-test, ci apro una sessione, chiedo a Claude di presentarsi e seguo la risposta.",
  "steps": [
    { "action": "project.create", "args": { "name": "petra-test" } },
    { "action": "session.start",  "args": { "folder": { "$step": 1, "field": "path" } } },
    { "action": "prompt.send",    "args": { "tabId": { "$step": 2, "field": "tabId" }, "text": "Ciao! Presentati in una riga." } },
    { "action": "session.follow", "args": { "tabId": { "$step": 2, "field": "tabId" } } }
  ]
}
```

### 4.1 The workflow
```
athome plan propose plan.json --wait        # prints "<planId>\tapproved" (exit 0) or "…\trejected" (exit 3)
export ATHOME_PLAN=<planId>
athome project create petra-test            # step 1 → Created: /srv/progetti/petra-test
athome session start /srv/progetti/petra-test --json   # step 2 → {"tabId":"…"}
athome session send <tabId> "Ciao! Presentati in una riga."   # step 3 → Done
athome session follow <tabId>               # step 4 → Following… / Claude was idle: nothing to follow
athome session wait <tabId>                 # (a read, no step) → claude: <the reply>
athome plan status <planId>                 # → closed  (done)
```
- Without `--wait`, `plan propose` prints the id at once; poll `athome plan status <id>` (`proposed`, `running step N
  of M`, or `closed` = done, rejected, cancelled or expired).
- A step that fails (e.g. a folder that does not exist) does **not** advance: fix and run it again.
- `athome plan cancel <id>` gives the plan up; the user can cancel it from the app at any time.
- A plan expires 24 hours after it was proposed. At most 50 steps; summary at most 1000 characters.
- `--plan <id>` on any command is the same as `ATHOME_PLAN`.

### 4.2 Steps: actions and arguments
| Action | Arguments | Gives | Command under the plan |
|---|---|---|---|
| `project.create` | `name`, `parent?` (default: the Home) | `path` | `athome project create <name> [--in <folder>]` |
| `folder.create` | `parent`, `name` | `path` | `athome folder create <name> --in <folder>` |
| `project.mark` | `path`, `project` (true/false) | — | `athome project mark <path> [--off]` |
| `session.start` | `folder`, `prompt?` | `tabId` | `athome session start <folder> [--prompt <text>]` |
| `prompt.send` | `tabId`, `text` | — | `athome session send <id> <text>` |
| `queue.add` | `tabId`, `text` | `queueId` | `athome queue add <id> <text>` |
| `queue.remove` | `tabId`, `queueId` | — | `athome queue remove <id> <queueId>` |
| `session.follow` | `tabId` | — | `athome session follow <id>` |
| `session.stop` | `tabId` | — | `athome session stop <id>` |
| `session.close` | `tabId` | — | `athome session close <id>` |
| `request.answer` | `tabId`, `decision` (`allow`/`deny`), `answers?` | — | `athome request answer <id> allow\|deny [--answers <json>]` |

Argument values can be:
- a **literal** (a name, a path, an existing chat's `tabId`, a text) — the app marks existing folders and chats as such;
- a **reference** to an earlier step's result: `{ "$step": N, "field": "path" | "tabId" | "queueId" }` (only to a
  step before, only to a field that step gives: see the "Gives" column);
- **free text**, decided when the step runs: `{ "$free": true }` — allowed only for `prompt.send.text`,
  `session.start.prompt` and `queue.add.text`; the app shows it to the user as "free text".

Folder paths are absolute (relative ones are resolved from the current directory). A `session.start` in a folder the
user never trusted creates the chat but does not send the prompt (`needsTrust`): the user must open it and trust the
folder; then `prompt.send` works.

### 4.3 Following a chat (`session.follow`)
While Claude works in that chat, the plan stays on this step and Petra may answer the chat's requests any number of
times with `athome request answer <id> allow|deny [--answers '{"question":"label"}']` (a step is not consumed). The
step ends by itself when the turn ends; if the chat is idle when the step runs, it ends at once. Answering requests
of another chat, or outside a follow step, is refused. **Allowing a permission here approves what Claude asked**: the
user sees that in the plan before approving it.

## 5. Reading (no plan needed)
| Command | Output (`--json`) |
|---|---|
| `athome projects` | `[{name, path}]` |
| `athome sessions` | `[{tabId, title, cwd, status}]` — status: `idle`, `running`, `requires_action`, `dormant`, `needs_trust`, … |
| `athome session read <id> [--last N]` | `[{who: "user"\|"claude", text}]` (default: the last 5) |
| `athome session wait <id> [--timeout S]` | `{status, reply, request?}` — waits until Claude finishes or asks (default 600 s, exit 1 on timeout), `request` = `{kind, title}` when the chat waits for the user |

Text output: `user: …` / `claude: …` lines; `wait` prints `waiting for you: <request>` and/or `claude: <reply>`.

## 6. What the user sees
- A push notification "petra proposes a plan: approve it in AtHome" and a card on top of the Home with the summary and
  the steps in the app's words, with Approve / Reject; while running, "step N of M" and "Cancel the plan".
- Heavy actions asked by Claude from a chat (no key) appear in that chat as "The athome command, run by Claude in this
  chat, asks for it", with Yes / No.

## 7. Known limits (2026-10-08)
- "A person in a terminal" is detected from the TTY: a program can fake it (e.g. `script`). It protects against
  ordinary use and prompt injection, not against a deliberate program of the same user. A key made from the app (a tap)
  instead of the terminal is in the backlog.
- Closed plans are not listed: `plan status` says `closed` for done, rejected, cancelled and expired alike (use
  `--wait` on `propose` to tell approved from rejected).
- No `session read` beyond the chat's recent items (what the app would show on opening).
