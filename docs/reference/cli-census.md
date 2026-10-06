# CLI Census — Claude Code 2.1.280

_Translated from the Italian original (personale/claude wrap/docs/censimento-cli.md, 2026-10-02). Content otherwise unchanged._

_Created: 2026-09-30. Parity specification for AtHome: every terminal feature the app must replicate._

Collected from official documentation (code.claude.com/docs), the changelog, and the local CLI (`claude --help`).
Each entry indicates its source; ⚠️ / "Uncertain" = to be manually verified on the CLI before replicating it.

## Table of Contents
- [Part A — Slash commands](#parte-a--slash-command)
- [Part B — Shortcuts, dialogs, clicks and interactions](#parte-b--shortcut-dialog-click-e-interazioni)
- [Part C — CLI, settings, hooks, SDK protocol](#parte-c--cli-settings-hook-protocollo-sdk)
- [Part D — SDK protocol (from sdk.d.ts 0.3.285)](#parte-d--protocollo-sdk-da-sdkdts-03285)

---

# Part A — Slash commands


**Locally installed version:** `2.1.280` (verified with `claude --version` on the machine, executable at `C:\Users\sasha\AppData\Roaming\npm\claude.cmd`).
**Census date:** 2026-09-30.
**Method:** cross-referencing (a) the official `docs/en/commands` page (the "All commands" table, the primary and most authoritative source: it also reports the minimum version requirement for each behavior), (b) `docs/en/interactive-mode`, (c) detail pages (`settings`, `permissions`, `hooks`, `checkpointing`, `memory`, `sub-agents`, `skills`, `plugins/cli-reference`, `model-config`, `mcp`), (d) the raw official CHANGELOG (`raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, read with `curl`, not through the fetch tool with AI summarization, to avoid fabrications) to understand what was added **after** 2.1.280.

**Important note on versioning**: the online documentation describes the most recent version of the product (the changelog goes up to 2.1.285), which is **ahead of** the installed version (2.1.280). For every command/behavior that the documentation flags as "requires vX.Y.Z", I checked whether X.Y.Z is ≤ 2.1.280 (already present locally) or > 2.1.280 (not yet available locally, useful only as a roadmap for the GUI). Entries not yet available in 2.1.280 are explicitly flagged with 🔜.

**What is verified vs. uncertain**: everything derived from the "All commands" table of `docs/en/commands` is considered verified against a primary source (I also report near-verbatim phrases). The "interactive interface" sections for complex commands (`/config`, `/permissions`, `/mcp`, `/agents`, `/model`, `/plugin`, `/hooks`) partly derive from a fetch tool that summarizes the page with a supporting AI model: where the summary was not cross-checked against a verbatim quote from the original page, I mark it with ⚠️ **[to verify]**.

---

## 1. Summary table

Argument legend: `<arg>` = required, `[arg]` = optional. "Type": **Built-in** (behavior in the CLI code), **Skill** (bundled skill, a prompt executed by Claude), **Workflow** (bundled dynamic workflow), **Alias**, **Removed**.

| Command | Alias | Type | Arguments | What it does (summary) |
|---|---|---|---|---|
| `/add-dir <path>` | — | Built-in | path | Adds an additional working directory for file access in the current session |
| `/advisor [model\|off]` | — | Built-in | opt. | Enables/disables the "advisor tool" (consults a second model at key moments). Requires v2.1.260+ for direct arguments |
| `/agents` | — | Built-in (changed) | — | Since v2.1.198 it only prints a reminder to create/manage subagents by asking Claude or editing `.claude/agents/` / `~/.claude/agents/`. Previously (≤2.1.197) it opened an interactive creation interface |
| `/artifact-capabilities` | — | Skill | — | Loads the reference on artifact runtime capabilities |
| `/artifact-diagramming` | — | Skill | — | Loads diagramming guidelines for artifacts (requires v2.1.221+) |
| `/artifacts` | — | Built-in | — | Lists owned/shared artifacts, allows attaching them, opening them in the browser, and copying their link (requires v2.1.208+) |
| `/auto-mode-setup` | — | Built-in | — | Generates draft `autoMode.environment` rules (requires Pro/Max/Team plan, v2.1.228+) |
| `/autocompact [auto\|<tokens>]` | — | Built-in | opt. | Sets the auto-compact window (requires v2.1.221+) |
| `/autofix-pr [prompt]` | — | Built-in | opt. | Starts a cloud session that follows the current branch's PR and fixes the CI |
| `/background [prompt]` | `/bg` | Built-in | opt. | Detaches the current session to run it as a background agent |
| `/batch <instruction>` | — | Skill | instruction | Orchestration of large-scale changes: 5-30 independent units, one subagent per worktree |
| `/branch [name]` | — | Built-in | opt. | Creates a branch of the current conversation from this point |
| `/btw [question]` | — | Built-in | opt. | Side question without adding it to the conversation history |
| `/bug [report]` | `/share` | Built-in | opt. | Reports a bug or shares the conversation (consent screen) |
| `/cd <path>` | — | Built-in | path | Moves the session to a new working directory while keeping the conversation |
| `/chrome` | — | Built-in | — | Configures "Claude in Chrome" settings |
| `/claude-api [subcommands]` | — | Skill | subcommands | Claude API / Managed Agents reference |
| `/claude-in-chrome [task]` | — | Skill | opt. | Has Claude execute a task in the browser via the Chrome extension |
| `/clear [name]` | `/reset`, `/new` | Built-in | opt. | New conversation with empty context, keeps project memory |
| `/code-review […] [pr#\|branch\|path]` | `/review` | Skill | various flags | Review of the current diff or a PR for correctness bugs; `--fix`, `--comment`, `ultra` |
| `/color [color\|default]` | — | Built-in | opt. | Prompt bar color for the session |
| `/compact [instructions]` | — | Built-in | opt. | Frees up context by summarizing the conversation |
| `/config [key=value...]` | `/settings` | Built-in | opt. | Opens the Settings interface (Config tab); `key=value` form to set without opening the panel |
| `/context [all]` | — | Built-in | opt. | Displays context usage as a colored grid |
| `/copy [N]` | — | Built-in | opt. | Copies the last response (or the Nth one) to the clipboard |
| `/cost` | — | Alias of `/usage` | — | — |
| `/dataviz [request]` | — | Skill | opt. | Guide to designing charts/dashboards (requires v2.1.198+) |
| `/debug [description]` | — | Skill | opt. | Enables debug logging and analyzes the session log |
| `/deep-research <question>` | — | Workflow | question | Fan-out of web searches, cross-checking of sources, cited report |
| `/design [brief]` | — | Skill | opt. | UI drafts on canvas as a "Claude Design" artifact (requires v2.1.265+, not available on Bedrock/Vertex/Foundry/Claude Platform on AWS) |
| `/design-login` | — | Built-in | — | Authorizes access to the design system for `/design-sync` |
| `/design-sync [hint]` | — | Skill | opt. | Converts the repo's React design system and uploads it to Claude Design |
| `/desktop` | `/app` | Built-in | — | Continues the session in the Claude Code Desktop app (macOS/Windows x64, requires subscription) |
| `/diff` | — | Built-in | — | Shows changes in the working tree, including those made by Claude |
| `/doctor [prompt-audit [path]]` | `/checkup` | Skill | opt. | Diagnostic check of installation/config; `prompt-audit` verifies CLAUDE.md/skills (requires v2.1.283+ 🔜) |
| `/effort [level\|auto\|status\|ultracode [on\|off]]` | — | Built-in | opt. | Sets the reasoning level (low→xhigh, max, auto) and the ultracode toggle |
| `/exit` | `/quit` | Built-in | — | Exits the CLI |
| `/export [filename]` | — | Built-in | opt. | Exports the current conversation as plain text |
| `/fast [on\|off]` | — | Built-in | opt. | Enables/disables fast mode (requires v2.1.205+) |
| `/feedback [report]` | — | Built-in | opt. | Sends product feedback (same dialog as `/bug`) |
| `/fewer-permission-prompts` | — | Skill | — | Analyzes transcripts to add a read-only allowlist to `.claude/settings.json` |
| `/focus` | — | Built-in | — | Enables/disables "focus view" (fullscreen rendering only) |
| `/fork [prompt]` | — | Built-in | opt. | Copies the conversation into a new background session, while staying in the current one (requires v2.1.212+; previously it was a forked subagent) |
| `/goal [condition\|clear]` | — | Built-in | opt. | Sets a goal: Claude keeps working across turns until it is satisfied |
| `/heapdump` | — | Built-in (hidden from menu) | — | Writes a JS heap snapshot + memory breakdown for diagnostics |
| `/help` | — | Built-in | — | Shows help and the available commands |
| `/hooks` | — | Built-in | — | Displays hook configurations for tool events (read-only panel) |
| `/ide` | — | Built-in | — | Manages IDE integrations and shows status |
| `/import [codex\|gemini\|cursor] [--dry-run] [--yes]` | — | Built-in | opt. | Imports configuration from OpenAI Codex/Gemini CLI/Cursor (requires v2.1.213+; Cursor v2.1.265+) |
| `/init` | — | Built-in | — | Initializes the project with a `CLAUDE.md` guide |
| `/insights` | — | Built-in | — | Generates an HTML report on recent sessions on the machine |
| `/install-github-app` | — | Built-in | — | Installs the Claude GitHub App for a repository (github.com only) |
| `/install-slack-app` | — | Built-in | — | Installs the Claude Slack app (OAuth via browser) |
| `/keybindings` | — | Built-in | — | Opens the keyboard shortcuts file |
| `/list-agents` | `/peers` | Built-in | — | Lists subagents, agent team teammates, and other messageable Claude Code sessions (requires v2.1.224+) |
| `/login` | — | Built-in | — | Logs into your Anthropic account |
| `/logout` | — | Built-in | — | Logs out of the Anthropic account |
| `/loop [interval] [prompt]` | `/proactive` | Skill | opt. | Runs a prompt repeatedly while the session stays open |
| `/mcp [reconnect <server>\|enable\|disable [<server>\|all]]` | — | Built-in | opt. | Manages MCP server connections and OAuth authentication |
| `/memory` | — | Built-in | — | Edits `CLAUDE.md` files, enables/disables auto memory, displays entries |
| `/mobile` | `/ios`, `/android` | Built-in | — | Shows a QR code to download the Claude mobile app |
| `/model [model]` | — | Built-in | opt. | Changes the AI model and saves it as default; left/right arrows adjust effort |
| `/output-style [style]` | — | Built-in | opt. | Lists/changes output style (requires v2.1.269+) |
| `/passes` | — | Built-in | — | Shares a free week of Claude Code (if eligible) |
| `/permissions` | `/allowed-tools` | Built-in | — | Interactive dialog for allow/ask/deny rules, working directories, Auto mode tab |
| `/plan [description]` | — | Built-in | opt. | Enters plan mode directly from the prompt |
| `/plugin [subcommand]` | — | Built-in | opt. | Manages plugins: interactive menu or direct subcommands (`list`, `install`, `enable`, `disable`, …) |
| `/powerup` | — | Built-in | — | Interactive lessons to discover Claude Code features |
| `/pr-comments [PR]` | — | **Removed** in v2.1.91 | — | Ask Claude directly instead |
| `/privacy-settings` | — | Built-in | — | Displays/updates privacy settings (Pro/Max only) |
| `/radio` | — | Built-in | — | Opens Claude FM (lo-fi radio) in the browser |
| `/rate-limit-options` | — | Built-in | — | Shows options when a claude.ai usage limit blocks a request |
| `/recap` | — | Built-in | — | Generates a one-line summary of the current session |
| `/release-notes` | — | Built-in | — | Displays the changelog in an interactive version picker |
| `/reload-plugins [--force]` | — | Built-in | opt. | Reloads all active plugins without restarting (requires v2.1.260+) |
| `/reload-skills` | — | Built-in | — | Re-scans the skill/command directories |
| `/remote-control` | `/rc` | Built-in | — | Makes the session available for Remote Control from claude.ai |
| `/remote-env` | — | Built-in | — | Chooses the default cloud environment for cloud sessions from the CLI |
| `/rename [name]` | — | Built-in | opt. | Renames the current session |
| `/resume [session]` | `/continue` | Built-in | opt. | Resumes a conversation by ID/name or opens the session picker |
| `/review […]` | Alias of `/code-review` | Skill | various | See `/code-review` |
| `/rewind` | `/checkpoint`, `/undo` | Built-in | — | Rolls back code and/or conversation to a checkpoint, or summarizes from a point |
| `/run` | — | Skill | — | Launches and drives the project's app to see a change working |
| `/run-skill-generator` | — | Skill | — | Teaches `/run` and `/verify` how to start the app from a clean environment |
| `/sandbox` | — | Built-in | — | Enables/disables sandbox mode (supported platforms) |
| `/schedule [description]` | `/routines` | Built-in | opt. | Creates/updates/lists/runs routines that run in the cloud |
| `/scroll-speed` | — | Built-in | — | Adjusts mouse scroll speed (fullscreen only) |
| `/security-review` | — | Built-in | — | Analyzes the current branch's changes for security vulnerabilities |
| `/setup-bedrock` | — | Built-in (hidden) | — | Amazon Bedrock configuration wizard |
| `/setup-vertex` | — | Built-in (hidden) | — | Google Cloud Agent Platform configuration wizard |
| `/simplify [target]` | — | Skill | opt. | Review for reuse/simplification/efficiency (does not look for bugs) |
| `/skill-doctor` | — | Built-in | — | Shows context cost and usage frequency of each skill (requires v2.1.252+) |
| `/skills` | — | Built-in | — | Lists available skills (filterable, sortable panel, with visibility toggle) |
| `/slides [brief]` | — | Skill | opt. | Creates a presentation as a "Claude Slides" artifact (requires v2.1.265+) |
| `/stats` | — | Alias of `/usage` | — | Opens on the Stats tab |
| `/status` | — | Built-in | — | Opens Settings on the Status tab (version, model, account, connectivity) |
| `/statusline` | — | Built-in | — | Configures the status line |
| `/stickers` | — | Built-in | — | Orders Claude Code stickers |
| `/stop` | — | Built-in | — | Stops the current background session (only while attached) |
| `/subtask <task>` | — | Built-in | task | Spawns a forked background subagent whose result returns to the conversation |
| `/tasks` | `/bashes` | Built-in | — | Displays/manages the session's background work |
| `/team-onboarding` | — | Built-in | — | Generates an onboarding guide from usage history |
| `/teleport` | `/tp` | Built-in | — | Brings a cloud session into the local terminal (requires claude.ai subscription) |
| `/terminal-setup` | — | Built-in | — | Installs the Shift+Enter keybinding for newline (or terminal-specific equivalents) |
| `/theme` | — | Built-in | — | Changes the color theme |
| `/tui [default\|fullscreen]` | — | Built-in | opt. | Sets the terminal interface renderer |
| `/ultraplan <prompt>` | — | **Removed** | — | Use plan mode instead |
| `/ultrareview [PR\|branch]` | — | Built-in | opt. | In-depth multi-agent review in cloud sandbox (alias of `/code-review ultra`) |
| `/update-config [request]` | — | Skill | opt. | Modifies the correct `settings.json` file based on a described request |
| `/upgrade` | — | Built-in | — | Opens the plan upgrade page in the browser |
| `/usage` | — | Built-in | — | Shows session cost, plan limits, activity statistics |
| `/usage-credits` | — | Built-in (formerly `/extra-usage`) | — | Configures extra usage credits |
| `/verify` | — | Skill | — | Confirms that a change works by actually running the app |
| `/vim` | — | **Removed** in v2.1.92 | — | Use `/config` → Editor mode instead |
| `/voice [hold\|tap\|off]` | — | Built-in | opt. | Enables/configures voice dictation |
| `/web-setup` | — | Built-in | — | Connects the GitHub account for cloud sessions |
| `/workflow-authoring` | — | Skill | — | Reference for writing dynamic workflow scripts (requires workflows enabled, v2.1.248+) |
| `/workflows` | — | Built-in | — | Opens the workflow progress view |

**Total built-in/skill/workflow/alias/removed commands listed in the official table**: **118** rows (source: the "All commands" table of `docs/en/commands`, counted programmatically). In addition to these there are mechanisms not listed as individual rows but documented separately: custom commands (skill/`.claude/commands`), plugin commands (`plugin:command`), MCP prompts (`/mcp__server__prompt`).

**Commands mentioned in the changelog but NOT yet in the local version 2.1.280** (added in 2.1.281–2.1.285, hence 🔜 GUI roadmap, not present today):
- `/plugin configure` (2.1.285)
- `/effort ultracode on|off` as an independent toggle no longer forced to xhigh (2.1.284; previously the behavior was different)
- `/mcp reconnect all` (2.1.284)
- `/rate-limit-options` in `/help` for claude.ai subscribers as a dedicated entry (2.1.284)
- `/doctor prompt-audit` (2.1.283)
- `/context` separate count for MCP instructions (2.1.283)
- `/model` with date/version suffixes for Sonnet (already present in 2.1.280 according to the changelog, line "Version 2.1.280")
- `/batch` outside a git repo (requires 2.1.281+)
- vim `d0`/`c0`/`y0` (requires 2.1.281+)

---

## 2. Per-command details (interactive interface)

### 2.1 Session, workflow and navigation

**`/help`** — Text listing of commands available to the current user (filtered by platform/plan).

**`/clear` (`/reset`, `/new`)** — Starts an empty conversation; with a name it labels the previous conversation in the `/resume` picker. Keeps the project memory (CLAUDE.md). The previous conversation remains recoverable from `/resume` or from the rewind menu ("previous session" entry).

**`/compact [instructions]`** — Summarizes the conversation to free up context space; optional instructions to guide the summary. The root CLAUDE.md survives and is re-injected after the compact.

**`/context [all]`** — A colored grid of context usage with optimization suggestions (heavy tools, memory bloat, capacity warnings). In fullscreen mode it collapses the per-item breakdown; `all` expands it. From v2.1.283 (🔜, not yet available locally) it counts MCP server instructions separately.

**`/diff`** — Opens a persistent **diff panel** in fullscreen next to the conversation (requires a git repo, a terminal ≥110 columns, v2.1.260+): lists modified files with +/- counters, allows clicking a line to open its diff, selecting lines with the mouse to ask Claude for explanations, and cycling (`Ctrl+X B`) between "this session's changes" / "uncommitted changes" / "everything since the default branch". Outside fullscreen (classic renderer) it instead opens a full-screen **diff viewer** with Left/Right navigation between the "Current" view and per-turn views, Up/Down to select a file, Enter to open, Esc to go back/close.

**`/rewind`** (alias `/checkpoint`, `/undo`) — Can also be opened with **double `Esc`** on an empty prompt. Lists every message sent in the session (except those merged into a turn already in progress) as a selectable list; for each point it offers the actions: **Restore code and conversation**, **Restore conversation**, **Restore code** (only if there are tracked file changes to revert), **Summarize from here**, **Summarize up to here**, **Never mind**. For the summarize options you can type additional instructions in the "add context (optional)" field before pressing Enter, or press the number key directly to summarize without instructions. If `/clear` was previously run, an extra `/resume <session-id> (previous session)` entry appears at the top. Known limits: it does not track changes made by Bash commands (`rm`, `mv`, `cp`), does not restore subagent changes (except foreground-forked skills), does not track changes external to the session, and does not restore symlink/hardlink files (shows `Restored the code, but skipped N files`).

**`/branch [name]`** — Creates a branch of the conversation at the current point and switches to it; the original remains reachable with `/resume`. Different from `/fork` (copies into a separate background session) and from `/subtask` (a subagent that brings its result back into this conversation).

**`/fork [prompt]`** — Copies the current conversation into a new background session (agent view) and keeps working here. With a prompt, the copy starts immediately; without one, it waits in agent view for the first prompt. Requires v2.1.212+; in versions 2.1.161–2.1.211 (or with agent view disabled) it instead behaves like a forked subagent.

**`/subtask <task>`** — Spawns a forked background subagent that inherits the entire conversation and whose result returns to this conversation when the work is done.

**`/resume [session]`** (alias `/continue`) — Resumes by ID/name or opens the **session picker**; background sessions are marked `bg` in the picker (a session still running cannot be resumed from here: it must be attached via `claude agents` or stopped first).

**`/rename [name]`** — Renames the current session and shows it in the prompt bar; without a name it generates one from the history. Names that duplicate another active session on the same machine receive an automatic variant.

**`/branch`, `/fork`, `/subtask` vs `/rewind`**: the documentation clearly distinguishes these four "branching" mechanisms for work.

**`/tasks`** (alias `/bashes`) — Panel of the current session's background work (shells and subagents), including finished ones. A **panel below the prompt** ⚠️ [to verify in detail on the exact keys, summarized from a secondary source] shows rows for active forks/subagents with Up/Down navigation, `Enter` to open the transcript and send follow-up messages, `x` to stop/remove a row, `Esc` to return to the main prompt.

**`/stop`** — Stops the current background session; available only while attached to a background session (keeps transcript and worktree). To detach without stopping it: `/exit` or the `←` arrow key.

**`/background [prompt]`** (alias `/bg`) — Detaches the current session to run it as a background agent, freeing up the terminal.

**`/exit`** (alias `/quit`) — Exits the CLI; if attached to a background session, it only detaches (the session keeps running).

### 2.2 Model, effort, speed

**`/model [model]`** — Without an argument it opens a **picker** with: built-in aliases (`default`, `best`, `fable`, `sonnet`, `opus`, `haiku` and `[1m]` variants for extended context), `opusplan` (Opus in plan mode then Sonnet for execution), custom entries pinned via `ANTHROPIC_CUSTOM_MODEL_OPTION`/`modelPicker`, an "Org default" row if the admin has set one, a "Default" option. On the selected model's row, the **left/right arrow adjusts the effort level** (shown next to the name, e.g. "with low effort"). The **`s`** key on a row: switches to that model **only for the current session** without changing the default; `Enter` saves it as the default for new sessions. ⚠️ [detail of the exact picker entries summarized from a secondary source, not verbatim from the page]

**`/effort [level|auto|status|ultracode [on|off]]`** — Levels: `low`, `medium`, `high`, `xhigh` (depends on the model: Fable 5.1/5, Opus 5.5, Sonnet 5.5, Opus 5, Sonnet 5, Opus 4.8, Opus 4.7 also have `max`; Opus/Sonnet 4.6 stop at `max` without `xhigh` in the table provided ⚠️). Without arguments it opens an **interactive slider**; `status` prints the current level; `auto` resets the saved level for the active model. The **Ultracode** toggle is located in the slider (press `Tab` to enable/disable it) and is a separate setting (not an effort level) that enables dynamic workflows. `ultracode on|off` as separate arguments **requires v2.1.284+** 🔜 (in 2.1.280 `/effort ultracode` sets the session to `xhigh` and `/effort ultracode off` failed with "Invalid argument").

**`/fast [on|off]`** — Toggles fast mode (requires v2.1.205+). Alt+O (Windows/Linux) / Option+O (macOS) is the equivalent keyboard shortcut.

**`/advisor [model|off]`** — Enables/disables a second "advisor" model at key moments (`fable`, `opus`, `sonnet` or a full ID). Without an argument it opens a picker.

### 2.3 Permissions and modes

**`/permissions`** (alias `/allowed-tools`) — Interactive dialog that lists **all permission rules** along with the `settings.json` file each one comes from. It allows you to: view rules by scope, add/remove rules, manage additional working directories, review **recent auto mode denials**. When auto mode is available, an **"Auto mode" tab** also appears with the classifier's rules, directly editable from here. Rules are evaluated in order: **deny → ask → allow** (the first match in this order wins, regardless of specificity).

Permission modes (cyclable with **Shift+Tab**, or **Alt+M** on Windows in certain runtimes): `default` (labeled "Manual"), `acceptEdits`, `plan`, `bypassPermissions`, `auto`, and `dontAsk`. From `auto` the first Shift+Tab goes back to `default`.

On a permission prompt: **Tab** opens a comment field on the selected Yes/No option (not on WebFetch/browser); **Shift+Tab** on a file prompt selects "allow for the rest of the session" when no comment field is open.

**`/plan [description]`** — Enters plan mode directly from the prompt, optionally with an initial task.

**`/sandbox`** — Toggles sandbox mode (sandboxed bash with filesystem/network isolation), on supported platforms.

### 2.4 MCP

**`/mcp [reconnect <server>|enable|disable [<server>|all]]`** — Without an argument it opens an **interactive list** of configured MCP servers, with the status of each (connected / requires OAuth authentication / failed with error detail / awaiting project approval / disabled for the project / loaded from cache). It shows the tool count for each connected server, flags servers that declare tools but expose none, handles OAuth sign-in for remote servers, and lists unused claude.ai connectors in a collapsed section. Direct actions without opening the panel: `reconnect <server>`, `enable`/`disable <server>|all`. From v2.1.284 (🔜) `/mcp reconnect all` is also available, to reconnect all failed servers in bulk. In non-interactive mode (`-p`) with no arguments it prints a text summary instead of opening the list (requires v2.1.205+). ⚠️ **[to verify]**: the details above about the panel derive from a secondary-source summary; the official page `docs/en/mcp#use-mcp-prompts-as-commands` is cited by `docs/en/commands` and `docs/en/interactive-mode` as the reference for **MCP prompts exposed as slash commands** (`/mcp__server__prompt` syntax), but the direct verification fetch did not find an explicit section with that syntax: the mechanism exists (referenced by two independent pages) but should be checked manually on the live page.

### 2.5 Plugins

**`/plugin [subcommand]`** — Without an argument it opens the interactive **plugin menu**; with a subcommand (`list`, `install`, `enable`, `disable`, …) it acts directly. During installation a plugin may activate itself; the installation summary indicates whether that happened or whether `/reload-plugins` is needed. From v2.1.285 (🔜, not available locally) `/plugin configure <plugin>` is also available, to show a plugin's options and save new ones.

**`/reload-plugins [--force]`** — Reloads all active plugins without restarting, with counts per reloaded component and reporting of loading errors; if the reload would change the loaded MCP tools (invalidating the prompt cache) it warns and skips unless `--force` is given (requires v2.1.260+).

**`claude plugin` (CLI, outside the session)** — Subcommands verified from the "Plugin commands reference" page: `init`, `install`, `uninstall`, `enable`, `disable`, `update`, `list` (with `--json`), `details`, `prune`, `eval` (+ `eval init`), `tag`, `validate` (also on directories), and the `marketplace` sub-namespace: `add` (with `--scope`, `--sparse`, `--claudeai`), `list` (with `--json`), `remove`/`rm`, `update`. `claude plugins` is an alias of `claude plugin`. Exit codes: `0` success, `1` failure (`validate` adds `2` for unexpected errors).

### 2.6 Skills and custom commands (mechanism — NOT the user's custom commands)

"Custom commands" have been **unified into the skill system**: a `.claude/commands/deploy.md` file and a `.claude/skills/deploy/SKILL.md` skill both create `/deploy` and behave the same way; old files in `.claude/commands/` continue to work.

**Supported frontmatter** (between `---` at the top of the file, lowercase letters and hyphens only except for `when_to_use`; unrecognized fields are ignored without error):

| Field | Required | Notes |
|---|---|---|
| `name` | No | Command name in the `/` menu; default = directory name |
| `description` | Recommended | Used by Claude to decide when to apply the skill; truncated to 1536 characters together with `when_to_use` |
| `when_to_use` | No | Additional context on when to invoke the skill |
| `argument-hint` | No | Autocomplete hint, e.g. `[issue-number]` |
| `arguments` | No | Named positional arguments for `$name` substitution |
| `disable-model-invocation` | No | `true` prevents Claude from invoking it on its own (manual `/name` only); it also prevents preloading in subagents and (v2.1.196+) in scheduled tasks |
| `user-invocable` | No | `false` hides the skill from the `/` menu and prevents `/name` (only Claude can invoke it) |
| `allowed-tools` | No | Tools pre-approved for the turn that invokes the skill (resets on the next message) |
| `disallowed-tools` | No | Tools removed from the pool while the skill is active |
| `model` | No | Model override for the current turn; accepts the same values as `/model` or `inherit` |
| `effort` | No | Effort level override while the skill is active |
| `context: fork` | No | Runs the skill in an isolated forked subagent (does not inherit history) |
| `agent` | No | Subagent type to use with `context: fork` |
| `background` | No | With `context: fork`, `false` waits for the result in the foreground instead of running in the background (default `true`, requires v2.1.218+) |
| `hooks` | No | Hooks registered when the skill is invoked, active for the rest of the session |
| `paths` | No | Glob pattern: the skill activates automatically only when working on matching files |
| `shell` | No | `bash` (default) or `powershell` for `` !`command` `` blocks |
| `metadata` | No | Free-form YAML map for custom data |
| `license`, `compatibility` | No | Fields from the "Agent Skills" standard |

**String substitutions available in the skill body**:
- `$ARGUMENTS` — all arguments passed to the invocation
- `$ARGUMENTS[N]` — the Nth argument (0-indexed)
- `$N` — shorthand for `$ARGUMENTS[N]` (e.g. `$1` = second argument)
- `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}` — expanded both in the markdown and in the Bash rules of `allowed-tools`
- `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` — only in plugin skills

Up to **6 chainable skills** in a single message (`/skill-a /skill-b do XYZ`, from v2.1.199): every skill named at the start is loaded and the final text is passed to each as an argument.

Inline bash execution `` !`command` `` and `@file` file references are general Claude Code input mechanisms (not only for skills): `!` at the start of a line activates direct shell mode; `@` activates autocomplete for file paths (and for other sessions via cross-session messaging).

**Command names based on skill location**: personal/project skill → `name` frontmatter or directory name; nested skill with a conflicting name → relative path (`/apps/web:deploy`); file in `.claude/commands/` → file name without extension; subdirectory of `.claude/commands/` → path with `:` instead of `/`; plugin skill → `pluginname:name` (automatic namespace); skill synced from claude.ai → `anthropic-skills:` prefix.

**`/skills` panel** — List filterable by name/description/source; the **`t`** key sorts by token count; **Space/Enter** toggles a skill's visibility (to Claude and to the `/` menu); **Esc** saves and closes. It is not possible to toggle plugin skills, skills with `disable-model-invocation: true`, or skills with an entry in `skillOverrides` in the managed settings.

**`/skill-doctor`** — Shows the token cost and usage frequency of each skill, to find ones to disable (requires v2.1.252+ and the fetching feature flag active).

**`/reload-skills`** — Re-scans the skill/command directories to make skills added/modified on disk during the session available without restarting.

### 2.7 Hooks

**`/hooks`** — A **read-only** panel that lists every configured hook event with: hook count per event, the ability to open the matchers to see which hooks fire for specific conditions, full handler details (command/prompt/URL/MCP tool), and the source of each hook (`User Settings`, `Project Settings`, `Local Settings`, `Plugin Hooks`, `Session Hooks`). To modify hooks you need to edit the settings JSON files or ask Claude to do it. ⚠️ [panel details summarized from a secondary source, not verbatim]

Hook events (list verified via fetch, names match those in `docs/en/hooks`): `SessionStart`, `Setup`, `SessionEnd`, `UserPromptSubmit`, `UserPromptExpansion`, `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `FileChanged`, `CwdChanged`, `DirectoryAdded`, `InstructionsLoaded`, `ConfigChange`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Notification`, `MessageDisplay`, `WorktreeCreate`, `WorktreeRemove`, `Elicitation`, `ElicitationResult`.

### 2.8 Memory (CLAUDE.md / AGENTS.md / auto memory)

**`/memory`** — Lists the locations of `CLAUDE.md`, `CLAUDE.local.md` files and other memory locations (user and project scope), including entries for user/project files that **do not exist yet**. Allows enabling/disabling auto memory and offers an option to open the auto memory folder. Selecting a file opens it in the editor (creates the file if it does not exist). With a GUI editor (VS Code) it opens in a separate window without blocking the session (from v2.1.216; previously it waited for it to close); terminal editors (Vim) occupy the terminal until you exit.

**`/init`** — Generates an initial `CLAUDE.md` by analyzing the codebase. With `CLAUDE_CODE_NEW_INIT=1` it activates a multi-phase interactive flow that also proposes skills and hooks, explores the codebase with a subagent, and presents a reviewable proposal before writing. If it finds Codex/Gemini CLI config, it proposes importing it with `/import`.

**`/doctor prompt-audit [path]`** 🔜 (requires v2.1.283+, not available locally) — Has Claude analyze CLAUDE.md/skills/hooks/subagents/output-styles for outdated or conflicting instructions, with a report and proposed changes (nothing is applied unless requested).

CLAUDE.md/AGENTS.md hierarchy: managed policy → user (`~/.claude/CLAUDE.md`) → project (`./CLAUDE.md` or `./.claude/CLAUDE.md`, or `AGENTS.md` if CLAUDE.md is absent) → local (`./CLAUDE.local.md`, personal, to be put in `.gitignore`). **Project instructions** setting in `/config`: `claude-md-or-agents-md` (default), `claude-md-and-agents-md`, `claude-md`, `managed-only`.

**Auto memory**: 4 note types (`user`, `feedback`, `project`, `reference`), saved in `~/.claude/projects/<project>/memory/` (index `MEMORY.md` + one file per topic). Only the first 200 lines or 25KB of `MEMORY.md` are loaded in every session. Toggled from `/memory` (saves `autoMemoryEnabled` in `~/.claude/settings.json`) or via the `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` variable.

### 2.9 Diagnostics and status

**`/doctor`** (alias `/checkup`) — Diagnostic check of the installation: detects duplicate/leftover installations, `PATH` issues, unparseable settings files; finds skills/MCP servers/plugins unused relative to their context cost; flags slow hooks; checks for updates on the release channel; deduplicates local `CLAUDE.md` files against committed ones; proposes cuts to committed `CLAUDE.md` files; offers to make auto mode the default and to pre-approve read-only commands that are often denied. It always shows the results and asks for confirmation before changing anything. From the terminal, `claude doctor` prints a read-only diagnosis without starting a session. Before v2.1.205 it opened a diagnostics-only screen and the `f` key sent the report to Claude.

**`/status`** — Opens the Settings interface on the **Status tab**: version, model, account, connectivity. A "Session kind" line (from v2.1.221+) shows `background job · attached`/`unattended` or `interactive`. Works even while Claude is responding.

**`/context [all]`** — see §2.1.

**`/usage`** (alias `/cost`, `/stats`) — Session cost, plan usage limits, activity statistics; on Pro/Max/Team/Enterprise plans it includes a breakdown of what is consuming the plan's limits. `/cost` and `/stats` are pure aliases (the latter opens on the Stats tab).

**`/usage-credits`** (formerly `/extra-usage`) — Opens the credit billing settings in the browser; on Team/Enterprise without billing access it instead sends a request to the administrator from the CLI, with a confirmation dialog.

**`/insights`** — HTML report generated on recent sessions (projects, usage patterns, errors, features to try). Not available in cloud sessions.

**`/debug [description]`** — Enables debug logging from that point on (if not already started with `claude --debug`) and analyzes its log.

**`/heapdump`** — Command hidden from the menu (must be typed in full): writes a JS heap snapshot + diagnostics file to the Desktop (or home directory on Linux without a Desktop). The `.heapsnapshot` file contains the entire conversation and credentials: do not share it, only the `-diagnostics.json` file.

### 2.10 Settings, theme, interface

**`/config [key=value ...]`** (alias `/settings`) — Opens the Settings interface on the **Config tab**: lists a restricted subset of personal options (theme, editor mode, verbose output, etc.), not every possible key. Selecting an entry changes it and saves it automatically (mostly to `~/.claude/settings.json`; some, like "Show tips", to `.claude/settings.local.json`; global config options to `~/.claude.json`). Direct form without opening the panel: `/config key=value` (e.g. `/config theme=dark`), also usable in non-interactive mode (`-p`) and from the mobile app via Remote Control; it cannot, however, enable settings that require explicit confirmation in the panel (e.g. `autoContinueAtUsageLimit`), only disable them. `/config --help` lists the accepted keys. **Not available** in the VS Code chat panel nor in the desktop app (there it is changed via files or the app's own settings).

**`/theme`** — Color theme change: `auto` (follows the terminal background), light/dark variants, colorblind-accessible themes, ANSI themes (terminal palette), custom themes from `~/.claude/themes/` or from plugins; a "New custom theme…" entry to create one.

**`/statusline`** — Configures the custom status line by describing what to show, or auto-configures from the shell prompt if launched without arguments.

**`/output-style [style]`** — Lists or changes output styles (requires v2.1.269+).

**`/focus`** — Toggles "focus view" (prompt only, tool-call summary in one line with diffstat, final response); persists across sessions (overridden with `viewMode`); from Remote Control `/focus [on|off]` changes it only for the current session.

**`/tui [default|fullscreen]`** — Sets/shows the active TUI renderer; `fullscreen` enables the flicker-free alt-screen renderer.

**`/scroll-speed`** — Interactive adjustment of mouse wheel scroll speed, with a scrollable preview ruler while the dialog is open (fullscreen only, not in the JetBrains IDE terminal).

**`/color [color|default]`** — Prompt bar color for the session (`red`,`blue`,`green`,`yellow`,`purple`,`orange`,`pink`,`cyan`, or random without an argument); syncs with claude.ai/code via Remote Control.

**`/vim`** — **Removed in v2.1.92**: Vim mode is now enabled from `/config` → Editor mode.

**`/keybindings`** — Opens the customizable shortcuts file.

### 2.11 Account, login, privacy, upgrade

**`/login` / `/logout`** — Logs into/out of the Anthropic account.

**`/upgrade`** — Opens the plan upgrade page in the browser (not shown on Enterprise plans); if the browser does not open, it shows a login prompt without printing the URL.

**`/privacy-settings`** — Displays/updates privacy settings (Pro/Max subscribers only).

**`/rate-limit-options`** — Shows the options when a usage limit blocks a request: waiting with automatic continuation at reset, adding usage credits, plan upgrade. Claude Code opens it automatically when a limit is reached.

**`/passes`** — Sharing of a free week (only if the account is eligible).

### 2.12 GitHub/GitLab/CI

**`/install-github-app`** — Repo selection and GitHub App/Actions configuration wizard (github.com only; on gitlab.com/bitbucket.org it prints a warning and exits).
**`/install-slack-app`** — Browser-based OAuth for the Slack app.
**`/autofix-pr [prompt]`** — A cloud session that follows the current branch's PR via `gh pr view` and fixes CI/review comments.
**`/pr-comments [PR]`** — **Removed in v2.1.91**; it used to fetch/show the comments of a GitHub PR.
**`/security-review`** — Analyzes the branch↔`origin` default branch diff for vulnerabilities (requires an `origin` remote).
**`/code-review` / `/review` / `/ultrareview`** — See the table; `/code-review ultra` = `/ultrareview` = multi-agent cloud review (3 free runs on Pro/Max, then extra credits).
**`/simplify [target]`** — 4 review agents in parallel (reuse, simplification, efficiency, abstraction level); does not look for bugs (for that: `/code-review`).

### 2.13 Cloud, remote, teleport, mobile

**`/teleport`** (alias `/tp`) — Picker to bring a cloud session into the local terminal (fetches branch and conversation).
**`/remote-control`** (alias `/rc`) — Makes the session reachable from Remote Control on claude.ai.
**`/remote-env`** — Chooses the default cloud environment for sessions started from the CLI.
**`/mobile`** (alias `/ios`, `/android`) — QR code for the mobile app.
**`/desktop`** (alias `/app`) — Continues in the Desktop app (macOS/Windows x64, requires subscription).
**`/web-setup`** — Connects the GitHub account via local `gh` credentials for cloud sessions.
**`/schedule [description]`** (alias `/routines`) — Creates/manages cloud routines through a guided conversation.
**`/list-agents`** (alias `/peers`) — List of subagents/teammates/other messageable sessions (requires v2.1.224+).

### 2.14 Miscellaneous/fun

**`/radio`** — Opens Claude FM lo-fi radio in the browser (or prints the stream URL).
**`/stickers`** — Orders Claude Code stickers.
**`/passes`** — see §2.11.
**`/powerup`** — Interactive lessons with animated demos.
**`/team-onboarding`** — Generates an onboarding guide from usage history (30 days), with a shareable link on Pro/Max/Team/Enterprise plans.

### 2.15 Removed commands

- **`/pr-comments`** — removed in v2.1.91.
- **`/vim`** — removed in v2.1.92 (replaced by `/config` → Editor mode).
- **`/ultraplan`** — removed (replaced by native plan mode).

---

## 3. Plugin command mechanism

A plugin can contribute its own skills/commands, which appear in the `/` menu with the namespace `pluginname:command` (e.g. `myplugin:deploy-app`). Typing just `/deploy`, the menu still finds the plugin's skill via a bare-name match, but selecting it writes out the full `/myplugin:deploy-app`. Plugin management: `/plugin` (in-session) and `claude plugin` (CLI, outside the session) — see §2.5. `/reload-plugins` applies changes without restarting.

## 4. MCP prompts as commands mechanism

`docs/en/commands` and `docs/en/interactive-mode` both cite the `docs/en/mcp#use-mcp-prompts-as-commands` section for **prompts exposed by MCP servers as slash commands**. This session's direct verification fetch did not locate a section with the verbatim syntax `/mcp__server__prompt` (probably due to a cut in the automatic summary, not because the mechanism does not exist — it is cited by two independent pages). **Recommendation for the GUI**: treat it as a real feature to implement (MCP servers can expose `prompts/list`), but manually verify the exact syntax at `https://code.claude.com/docs/en/mcp` before wiring it into the final spec.

## 5. Notes for the GUI (operational summary)

- About **118 commands** (built-in/skill/workflow/alias) are listed in the official "All commands" table (`docs/en/commands`), all available (with platform/plan differences) in version **2.1.280**, except for the 🔜 exceptions listed above.
- Several commands open the **same "Settings" panel** on different tabs: `/config`→Config tab, `/status`→Status tab, `/usage`/`/cost`/`/stats`→Stats tab. In the GUI it makes sense to model them as a single Settings component with a selectable entry tab.
- Commands with a complex dialog interface to faithfully replicate: `/permissions` (tabs + lists + rule editor), `/mcp` (server list with statuses and actions), `/model`+`/effort` (effort slider, ultracode toggle), `/rewind` (message list + contextual action menu), `/skills` (filterable/sortable list with toggle), `/hooks` (read-only browser), `/plugin` (menu with subcommands), `/diff` (persistent panel vs. full-screen viewer), `/theme` (theme gallery), `/memory` (file list + auto memory toggle).
- The **custom commands/skill** mechanism (§2.6) is the basis for "add your own command" in the GUI: the frontmatter parsing, the `$ARGUMENTS`/`$N` substitutions, inline bash execution, `@file` references, and the command-name resolution rules all need to be replicated.

---

## 6. Sources

- `https://code.claude.com/docs/en/commands` — the complete official "All commands" table (primary source, quoted almost verbatim for most entries)
- `https://code.claude.com/docs/en/interactive-mode` — keyboard shortcuts, quick commands, `/diff`, `/btw`, task list, session recap, wait on usage limit
- `https://code.claude.com/docs/en/permissions` — permission system, `/permissions`, permission modes
- `https://code.claude.com/docs/en/settings` — `/config`, settings precedence
- `https://code.claude.com/docs/en/hooks` — hook events, `/hooks`
- `https://code.claude.com/docs/en/checkpointing` — `/rewind`, automatic checkpoints
- `https://code.claude.com/docs/en/memory` — `/memory`, CLAUDE.md/AGENTS.md, auto memory, `/doctor prompt-audit`
- `https://code.claude.com/docs/en/sub-agents` — `/agents`, subagent format, fork panel
- `https://code.claude.com/docs/en/skills` — skill/custom command mechanism, frontmatter, string substitutions
- `https://code.claude.com/docs/en/plugins/cli-reference` — `claude plugin`, `/plugin`, `/reload-plugins`
- `https://code.claude.com/docs/en/model-config` — `/model`, `/effort` (summarized via fetch with a supporting AI, not verbatim — see ⚠️ notes)
- `https://code.claude.com/docs/en/mcp` — `/mcp` (summarized via fetch with a supporting AI for the panel part; the prompts-as-commands section was not directly located, see §4)
- `https://code.claude.com/docs/llms.txt` — complete index of documentation pages
- `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` — raw official changelog (downloaded with `curl`, not summarized), used to distinguish what is already in 2.1.280 and what comes later (2.1.281–2.1.285)
- `claude --version` (local) → `2.1.280`; `where claude` → `C:\Users\sasha\AppData\Roaming\npm\claude` / `claude.cmd`


---

# Part B — Shortcuts, dialogs, clicks and interactions


Locally installed version (verified with `claude --version`): **2.1.280**.
The official documentation sometimes describes features that require later versions (e.g. v2.1.281, v2.1.283, v2.1.284): in these cases the text flags it explicitly, and here it is reported marked as "requires vX.X.X — might not yet be active in 2.1.280".

Legend for the **Verified** column:
- **Doc** = confirmed by the official documentation (code.claude.com/docs)
- **Doc+Chg** = confirmed by documentation + changelog/web research
- **Local** = observed in the user's local files (~/.claude/settings.json etc.)
- **Uncertain** = not found in a primary source, inferred or to be verified in the field

There is no `~/.claude/keybindings.json` file on the user's machine (never created with `/keybindings`): all combinations are therefore at the documented default values.

---

## 1. Global shortcuts (context: anywhere in the TUI)

| Key | Action (name in keybindings.json) | Effect | Context/Notes | OS | Remappable | Verified |
|---|---|---|---|---|---|---|
| `Ctrl+C` | `app:interrupt` | Interrupts the operation in progress; if nothing is in progress, the first press clears the input, the second exits | Global | all | No (reserved) | Doc |
| `Ctrl+D` | `app:exit` | Exits Claude Code. The first press shows a confirmation hint, a second within 800ms exits. If the prompt contains text, it deletes the character after the cursor instead of exiting | Global | all | No (reserved) | Doc |
| `Ctrl+X Ctrl+K` | `chat:killAgents` | Stops all of the session's background subagents and disables automatic responses to artifacts for the rest of the session. Press twice within 3s to confirm | Chat | all | Yes | Doc |
| `Ctrl+G` / `Ctrl+X Ctrl+E` | `chat:externalEditor` | Opens the prompt (or the current response) in the default text editor ($VISUAL/$EDITOR). `Ctrl+X Ctrl+E` is the "readline-native" binding. With the **Show last response in external editor** option in `/config`, it precedes the prompt with Claude's previous response as a `#` comment, removed on save | Chat / Agents view | all | Yes | Doc |
| `Ctrl+L` | `chat:clearInput` | Redraws the whole screen, keeping input and history. Useful if the display gets "dirty" | Chat | all | Yes | Doc |
| `Cmd+K` (iTerm2/Terminal.app) | `chat:clearScreen` | Same as `chat:clearInput`; iTerm2/Terminal.app handle Cmd+K at the terminal level (clearing their own screen) and Claude Code detects the cleared screen and redraws the conversation | Chat | macOS | Yes | Doc |
| `Ctrl+O` | `app:toggleTranscript` | Shows/hides the detailed transcript viewer (tool usage, timestamp, model for each message; expands collapsed MCP calls and messages from other sessions) | Global | all | Yes | Doc |
| `Ctrl+R` | `history:search` | Backward search through command history (in fullscreen it opens a dedicated dialog) | Global | all | Yes | Doc |
| `Ctrl+V` / `Cmd+V` (iTerm2) / `Alt+V` (Windows/WSL) | `chat:imagePaste` | Pastes an image from the clipboard, inserting a `[Image #N]` chip referenceable in the prompt. On WSL both keys are active | Chat | all (varies by terminal) | Yes | Doc |
| `Ctrl+B` | `task:background` | Sends running Bash commands/agents to the background. In tmux it must be pressed twice (conflict with the tmux prefix); a dedicated `Ctrl+X Ctrl+B` chord also exists | Task | all | Yes | Doc |
| `Ctrl+T` | `app:toggleTodos` | Shows/hides Claude's to-do checklist (max 5 visible items). This is not the background task view (`/tasks`) | Global | all | Yes | Doc |
| `Ctrl+S` | `chat:stash` | With text in the prompt: it "stashes" it and clears the input. On an empty prompt: restores text, cursor position, pasted content, and input mode (including shell mode `!`) | Chat | all | Yes | Doc |
| `Ctrl+Z` | (no dedicated action) | Suspends the process to the shell (Unix only); `fg` to resume | Global | macOS/Linux | N/A | Doc |
| `Left`/`Right` | `tabs:next` / `tabs:previous` | Navigates between tabs in tabbed dialogs (permissions, menus) | Tabs | all | Yes | Doc |
| `Tab` | `autocomplete:accept` / comment on permission | Accepts the autocomplete suggestion; on a permission prompt with Yes/No focused, it opens a comment field (pressing it again closes it) | Autocomplete / Confirmation | all | Yes | Doc |
| `Up`/`Down` or `Ctrl+P`/`Ctrl+N` | `history:previous`/`history:next` (also cursor movement) | If the input is multi-line, it first moves the cursor; on the first/last visual line it navigates command history. With queued messages, `Up` from the first line "recalls" them | Chat / History | all | Yes | Doc |
| `Esc` | `chat:cancel` | Interrupts the response/tool in progress (work already done is kept); if there are queued messages it sends them right after. Closes an open dialog. On a selected footer item, it deselects instead of interrupting. On a permission prompt, it is equivalent to **No** without a comment | Chat / various dialogs | all | Partially (`chat:cancel` yes) | Doc |
| `Esc` `Esc` (double) | — | With text in the prompt: clears the input and saves it to history (recallable with `Up`). With an empty prompt: opens the **rewind/checkpoint menu** | Chat | all | N/A (composite behavior) | Doc |
| `Ctrl+Enter` / `Ctrl+X Ctrl+S` | `chat:sendNow` | Immediately sends queued messages (+ draft). `Ctrl+Enter` arrives as plain `Enter` on terminals without extended keys: use `Ctrl+X Ctrl+S`, which works everywhere. Requires v2.1.275+ | Chat | all | Yes | Doc |
| `Shift+Tab` (or `Alt+M` on Windows without VT input) | `chat:cycleMode` | Cycles permission modes: `default`(Manual) → `acceptEdits` → `plan` → (`bypassPermissions`/`auto` if available) → back to `default`. On a file permission prompt, it closes an open comment field or selects "allow for the rest of the session" | Chat / Confirmation | all | Yes | Doc |
| `Option+P` (macOS) / `Alt+P` (Win/Linux) | `chat:modelPicker` | Opens the model selector without clearing the prompt | Chat | all (requires Option-as-Meta on macOS) | Yes | Doc |
| `Option+T` (macOS) / `Alt+T` (Win/Linux) | `chat:thinkingToggle` | Enables/disables extended thinking. No effect on Opus 5.5/Sonnet 5.5/Fable (always thinking). Works on macOS without configuring Option as Meta | Chat | all | Yes | Doc |
| `Option+O` (macOS) / `Alt+O` (Win/Linux) | `chat:fastMode` | Enables/disables fast mode | Chat | all | Yes | Doc |
| `?` on empty input | — | Shows/hides the shortcuts help panel. If the input contains text, `?` is typed normally | Chat | all | N/A | Doc |

## 2. Text editing in the prompt

| Key | Effect | Notes | Verified |
|---|---|---|---|
| `Ctrl+A` | Cursor to the start of the current logical line | Multi-line | Doc |
| `Ctrl+E` | Cursor to the end of the current logical line | Multi-line | Doc |
| `Ctrl+K` | Deletes to end of line (saved for paste) | | Doc |
| `Ctrl+U` | Deletes from cursor to start of line (saved for paste). On macOS `Cmd+Backspace` maps here in iTerm2/Terminal.app | Repeated it clears multiple lines | Doc |
| `Ctrl+W` | Deletes backward to the previous whitespace (ignores punctuation: one press deletes an entire path/`--flag=value`) | To delete only the previous word: `Option+Delete` (macOS) / `Ctrl+Backspace` (Windows) | Doc |
| `Ctrl+Y` | Pastes the last deleted text (from `Ctrl+K`/`U`/`W`) | | Doc |
| `Alt+Y` (after `Ctrl+Y`) | Cycles through the paste history (kill-ring) | Requires Option-as-Meta on macOS | Doc |
| `Alt+B` | Cursor back one word | Requires Option-as-Meta on macOS | Doc |
| `Alt+F` | Cursor forward one word | same | Doc |
| `Alt+D` | Deletes to end of word (saved for paste) | same | Doc |
| `Ctrl+_` or `Ctrl+Shift+-` | Undoes the last input change (restores text and cursor position) | Not remappable | Doc |

"Word" boundaries for `Alt+B/F/D`, `Option+Delete`, `Ctrl+Backspace` treat letters/digits as a word (punctuation like `_`, `.`, `/` separates); `Ctrl+W`, on the other hand, ignores punctuation and deletes up to whitespace. These "readline" conventions have applied since v2.1.261+; the old `keybindingFlavor` setting is deprecated and has no effect. None of these are remappable via keybindings.json (no dedicated action).

## 3. Multi-line input

| Method | Combination | Notes | Verified |
|---|---|---|---|
| Quick escape | `\` + `Enter` | Works in every terminal, no configuration | Doc |
| Option key | `Option+Enter` | Requires Option-as-Meta on macOS | Doc |
| Shift+Enter | `Shift+Enter` | Native in iTerm2, WezTerm, Ghostty, Kitty, Warp, Apple Terminal, Windows Terminal, foot, Alacritty≥0.16. Elsewhere (VS Code, Cursor, Devin Desktop, Zed, Alacritty<0.16) requires a one-time `/terminal-setup`; not available in gnome-terminal and JetBrains IDEs | Doc |
| Control sequence | `Ctrl+J` | Works everywhere with no configuration; action `chat:newline` | Doc |
| Direct paste | Pasting code/log blocks | Text >800 characters or >3 lines is collapsed into a `[Pasted text #N +N lines]` placeholder, but the full content is still sent | Doc |

`chat:newline` (default `Ctrl+J`) and `chat:submit` (default `Enter`) can be swapped via keybindings.json to invert the behavior (e.g. Enter = newline, Shift+Enter = send).

## 4. Special prefixes at the start of the prompt and quick commands

| Prefix/Key | Function | Notes | Verified |
|---|---|---|---|
| `/` at start of line | Command or skill | Opens the `/` menu; filters as you type letters; also mid-prompt after a space (`... then /com`); `Tab` on a bare `/` lists all commands | Doc |
| `!` at start of line | Shell mode | Executes a shell command directly, adds the output to context, Claude responds automatically unless `respondToBashCommands:false`. History autocomplete with `Tab`, live path autocomplete (v2.1.193+) by typing a token with `/`. Exit with `Escape`, `Backspace`, or `Ctrl+U` on an empty prompt. Pasting text that starts with `!` activates shell mode automatically | Doc |
| `#` at start of prompt | Memory (quick addition to CLAUDE.md) | **Not explicitly found in the documentation consulted in this session** — present as the `memoryBackgroundColor` theme color ("background behind `#` memory entries in the transcript"), so the feature appears to still be active, but the detailed behavior was not verified in this research | **Uncertain** |
| `@` | File/resource mention | File path autocomplete; in sessions with cross-session messaging, typing at least one letter after `@` also suggests other live sessions on the machine (to send messages). Requires v2.1.232+ | Doc |
| `:` | Emoji shortcode | A complete `:name:` immediately inserts the emoji; `:` + 2+ characters opens a suggestion popup (`Tab`/`Enter` to insert). Requires v2.1.217+; disable with `emojiCompletionEnabled:false` | Doc |
| `&` | — | **No reference found** in the official documentation consulted (interactive-mode, commands, keybindings). No documented `&` prefix appears to exist | **Uncertain/absent** |
| `?` on empty input | Toggles the shortcuts panel | See table §1 | Doc |
| File drag & drop | — | **Not explicitly found** in the documentation consulted; pasting images is documented (`Ctrl+V`/`Alt+V`), file drag & drop as a separate mechanism is not | **Uncertain** |

## 5. Vim mode (enabled in `/config` → Editor mode, or `editorMode:"vim"` in settings.json)

### Mode switching
| Key | Action | From mode |
|---|---|---|
| `Esc` or `Ctrl+[` | Enters NORMAL (Ctrl+[ requires v2.1.242+ on Kitty protocol terminals) | INSERT, VISUAL |
| `i` | Insert before the cursor | NORMAL |
| `I` | Insert at start of line | NORMAL |
| `a` | Insert after the cursor | NORMAL |
| `A` | Insert at end of line | NORMAL |
| `o` | Opens a line below | NORMAL |
| `O` | Opens a line above | NORMAL |
| `v` | Character-wise visual selection | NORMAL |
| `V` | Line-wise visual selection | NORMAL |

### Navigation (NORMAL)
`h`/`j`/`k`/`l`, `Space` (right), `w` (next word), `e` (end of word), `b` (previous word), `0` (start of line), `$` (end of line), `^` (first non-blank), `gg` (start of input), `G` (end of input), `f{char}`/`F{char}` (go to next/previous occurrence), `t{char}`/`T{char}` (go just before/after an occurrence), `;`/`,` (repeat f/F/t/T motion forward/backward), `/` (opens history search, like `Ctrl+R`; from an empty prompt a hint suggests `Esc` `i` `/` for the command menu). If the cursor is at the start/end of the input and cannot move further, `j`/`k` and the arrow keys navigate command history; `←` on an empty prompt opens the agent view even from NORMAL (from v2.1.219+).

### Editing (NORMAL)
`x` (deletes a character), `r{char}` (replaces a character), `dd` (deletes a line), `D` (deletes to end of line), `dw`/`de`/`db`, `df{char}`/`dt{char}`, `dj`/`dk`, `dgg`/`dG`, `d0`/`c0`/`y0` (requires v2.1.281+), `cc` (changes a line), `C`, `cw`/`ce`/`cb`, `s` (replaces a character, v2.1.211+), `S` (replaces a line, v2.1.211+), `yy`/`Y` (yanks a line), `yw`/`ye`/`yb`, `p`/`P` (pastes after/before), `>>`/`<<` (indent/dedent), `J` (joins lines), `u` (undo), `.` (repeats the last change).

### Text objects (NORMAL, with operators `d`/`c`/`y`)
`iw`/`aw` (inner/around word), `iW`/`aW` (WORD, whitespace-delimited), `i"`/`a"`, `i'`/`a'`, `i(`/`a(`, `i[`/`a[`, `i{`/`a{`.

### Visual mode
`v` (char-wise) / `V` (line-wise) to start; `d`/`x` (deletes the selection), `y` (yank), `c`/`s` (changes), `p` (replaces with register), `r{char}`, `~`/`u`/`U` (toggle/lowercase/uppercase), `>`/`<` (indent/dedent lines), `J` (joins lines), `o` (swaps cursor/anchor), text objects (`iw`/`aw`/`i"`/...), `v`/`V` (switches between char-wise/line-wise or exits). **Block-wise visual (`Ctrl+V`) is not supported.**

### INSERT remap
`vimInsertModeRemaps` (user settings/`--settings`/managed only, not from a project's `.claude/settings.json`) maps a 2-character sequence to Escape, e.g. `{"jj":"<Esc>"}`. The second character within 1s of the first triggers the remap; beyond that window both characters remain literal. Requires v2.1.208+.

Interaction notes: vim mode and keybindings.json operate at independent levels (vim handles input at the text level, keybindings handle actions at the component level). `Esc` in vim mode switches from INSERT to NORMAL and **does not** trigger `chat:cancel`. Most `Ctrl+` combinations still pass through to the keybinding system. In NORMAL, `?` opens the help (vim behavior), `/` opens history search.

## 6. Command history and search

| Command | Effect | Verified |
|---|---|---|
| `Up`/`Down` | Recalls previous/next prompts (per working directory; after `/clear`, the new session's prompts come first) | Doc |
| `Ctrl+R` | Interactive backward search. In the classic renderer: an inline sequence (type the query, `Ctrl+R` to cycle to older matches, `Tab`/`Esc` accepts and keeps editing, `Enter` accepts and executes immediately, `Ctrl+C` cancels, `Backspace` on an empty search cancels). In fullscreen it opens a **dedicated dialog**: type to filter, `Up`/`Down` to move, `Ctrl+S` cycles scope (session/project/everywhere), `Enter`/`Tab` inserts the match, `Esc` cancels | Doc |

## 7. Background Bash commands and shell mode

| Item | Detail | Verified |
|---|---|---|
| `Ctrl+B` | Sends a Bash command running in the foreground to the background (in tmux it must be pressed twice due to the conflict with the tmux prefix) | Doc |
| Automatic timeout | A command that reaches the timeout is automatically moved to the background (unless it starts with `sleep`) | Doc |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` | Disables background tasks entirely | Doc |
| `/tasks` | View of background commands/subagents (different from the `Ctrl+T` to-do list) | Doc |

## 8. Message queue while Claude is working

| Action | Key | Detail | Verified |
|---|---|---|---|
| Queue a message | `Enter` during execution | The message is queued, it does not interrupt the turn; shown grayed out until it is sent | Doc |
| Send queued messages immediately | `Ctrl+Enter` / `Ctrl+X Ctrl+S` (`chat:sendNow`) | If Claude is only writing (no work that can be moved to the background) it interrupts the turn and sends; if it is running a shell/subagent, that work moves to the background and the message is read in the same turn. Requires v2.1.275+ | Doc |
| Recall queued content | `Up` from the first line of the input | Puts back into the input queue (one line per entry) what had been queued | Doc |
| Queue a `!`/slash command | same as above | They are executed in order at the end of the turn; some commands (`/status`, `/model`, `/effort`, `/fast`) run immediately without waiting | Doc |

## 9. Interactive dialogs

### 9.1 Permission request for a tool
| Item | Detail | Verified |
|---|---|---|
| Typical options | **Yes** (one-time) · **Yes, don't ask again** (saves a rule: forever for repo+command on Bash/WebFetch, until end of session for file edits) · **No** (denies, optionally with a reason) | Doc |
| Navigation | `Up`/`Down` to move between options, `Enter` confirms (`confirm:yes`), `Esc` denies (`confirm:no`), `Tab` advances field (`confirm:nextField`), `Space` toggles selection (`confirm:toggle`) | Doc |
| Comment on the response | With **Yes**/**No** selected, `Tab` opens a comment field (not available on WebFetch/browser nor on the "for the rest of the session"/saved rule options). `Enter` sends the response+comment; `Tab` closes the field without responding (the text remains, it will be sent if you later confirm); `Shift+Tab` on a file prompt closes the field (before v2.1.235 it selected "allow for the rest of the session", discarding the comment) | Doc |
| Delivery of the comment | **Yes**: the action starts, then the comment reaches Claude after the result. **No**: the comment arrives as the reason for the denial; if **No** without a comment on the main conversation's prompt, the turn stops | Doc |
| Mode cycling from the prompt | `Shift+Tab` closes an open comment field; with the field closed, if offered, it selects the "allow for the rest of the session" option | Doc |
| Emergency close | `Ctrl+C`/`Ctrl+D` twice close the dialog instead of exiting Claude Code (hint after the first press) | Doc |
| Bug fixed in 2.1.280 | Before v2.1.280 a "stray" `y`/`n` could close/confirm a dialog by mistake; now only `Enter`/`Esc` accept/cancel (you can restore `y`/`n` by binding them to `confirm:yes`/`confirm:no` in keybindings.json) | Doc+Chg |
| `/permissions` | Management dialog: lists allow/ask/deny rules and the settings.json file they come from; editable even while Claude is working (v2.1.234+ applies from the next tool call in the same turn) | Doc |

### 9.2 Folder trust (workspace trust)
| Item | Detail | Verified |
|---|---|---|
| When it appears | On the first interactive opening of a folder/repo not yet trusted, or on the first `/cd`/`claude --bg` toward an untrusted folder | Doc |
| Content | Lists the allow rules, additionalDirectories, hooks, and items that the folder would activate, before accepting | Doc |
| Scope | In a git repo: the entire repo (root) is trusted, excluding nested repos (submodules); outside a repo: the starting folder and its subfolders are trusted (excluding nested repos); if started in the home directory: trust applies only for the current session, not saved to disk | Doc |
| Interactive sessions only | `claude -p` and SDK sessions never show the dialog | Doc |
| Exact dialog text/keys | **Not reported verbatim in this source** (functional description only) | Uncertain (textual detail) |

### 9.3 `AskUserQuestion` (Claude's multiple-choice questions)
| Item | Detail | Verified |
|---|---|---|
| Function | Claude asks multiple-choice questions for decisions/clarifications | Doc |
| Response | You choose an option, or type free text via the **Other** row or a notes field | Doc |
| Free text | Claude Code forwards it with neutral wording (including requests to wait/for an explanation) | Doc |
| Auto-continue timeout | Configurable (`askUserQuestionTimeout`: 60s/5m/10m, also from `/config` → "Question auto-continue timeout"). After the time elapses, the dialog closes itself: it sends the options already selected and tells Claude the user might be away; a countdown is visible in the last 20s; pressing any key restarts it (as does window focus, on terminals that report it) | Doc |
| Timeout exclusions | It applies only to AskUserQuestion's multiple-choice questions; permission prompts (including plan approval) never auto-resolve due to inactivity | Doc |
| Single/multiple selection, previews | Tool schema (verified from the tool definition as seen by the model): 1–4 questions per dialog; each question has a `header` (chip, max 12 characters) and 2–4 options (`label` + `description`); `multiSelect` per question; "Other" (free text) is always added automatically; an optional `preview` per option (mockup/code in a monospace box, side-by-side layout) only for single-selection questions; free notes per question are returned as `annotations` | Tool schema |

### 9.4 Plan approval (exiting plan mode)
| Item | Detail | Verified |
|---|---|---|
| Entering plan mode | `Shift+Tab` (mode cycle) or the `/plan` prefix on a single prompt, or `claude --permission-mode plan` | Doc |
| Exiting without approving | `Shift+Tab` again | Doc |
| Approval dialog | When the plan is ready, Claude presents it and asks how to proceed, with options: **Yes, and use auto mode** (approves and switches to auto mode; if auto mode is not available it becomes **Yes, auto-accept edits**; if the session has bypass permissions enabled it becomes **Yes, and switch to BYPASS PERMISSIONS...**) · **Yes, manually approve edits** (approves and reviews every change) · **No, keep planning** (stays in plan mode) | Doc |
| Editing the plan | `Ctrl+G` opens the proposed plan in the default text editor to modify it before Claude proceeds | Doc |
| Extra option | With `showClearContextOnPlanAccept` active, a first option appears that approves the plan and clears the planning context | Doc |
| Session title | Approving a plan generates an automatic title for the session (if not already renamed) | Doc |

### 9.5 Rewind / checkpoint menu
| Item | Detail | Verified |
|---|---|---|
| Opening | `/rewind`, or `Esc` `Esc` with an empty prompt | Doc |
| Content | List of prompts sent in the session (excluding messages queued during a turn); you select a point and then an action | Doc |
| Available actions | **Restore code and conversation** · **Restore conversation** · **Restore code** · **Summarize from here** · **Summarize up to here** · **Never mind**. The two "restore code" options appear only if there are tracked file changes to revert | Doc |
| Guiding a summary | By highlighting "Summarize..." with the arrows you can type an instruction where "add context (optional)" appears, then `Enter`; selecting the option with the number key summarizes immediately without instructions | Doc |
| Extra entry after `/clear` | At the top of the list, `/resume <session-id> (previous session)` appears to return to the conversation prior to the `/clear` | Doc |
| Limits | Does not track changes made by Bash commands, subagent edits (except foreground-forked skills), external changes, symlinks/hardlinks (shows a "skipped N files" warning) | Doc |

### 9.6 Diff viewer / diff panel (`/diff`)
| Item | Detail | Verified |
|---|---|---|
| Classic renderer | The diff viewer replaces the prompt: `Left`/`Right` changes view (Current/turns), `Up`/`Down` selects a file, `Enter` opens the file's diff (then scroll with Up/Down or PageUp/PageDown), `Esc` goes back to the list or closes | Doc |
| Fullscreen | `/diff` opens a **side panel** that stays open and updates live; it also opens on its own if the terminal is ≥144 columns (requires a terminal ≥110 columns, a git repo, Claude Code v2.1.260+); closing it with `✕` in the header or re-running `/diff` keeps it closed until you reopen it | Doc |
| Panel interactions | Click a file row to open it; scroll with the wheel; a long file list is scrollable with `Alt+Up/Down` or `Ctrl+Up/Down`; select lines with the mouse to attach them to the next prompt (removable with `Backspace` after the indicator, v2.1.271+); `Ctrl+X B` cycles the comparison base (current session → uncommitted changes → everything since the branch diverged from the default) | Doc |

### 9.7 Theme selector (`/theme`)
| Item | Detail | Verified |
|---|---|---|
| Options | Auto (follows the terminal's light/dark background), light/dark variants, colorblind themes, ANSI themes (terminal palette), custom themes from `~/.claude/themes/` or plugins | Doc |
| Creating a custom theme | A **New custom theme…** entry at the bottom of the list: you name the theme and interactively override individual color tokens; `Ctrl+E` on a highlighted custom theme opens it for editing | Doc |
| Syntax toggle | `Ctrl+T` (`theme:toggleSyntaxHighlighting`) active only inside the `/theme` menu | Doc |
| File format | JSON in `~/.claude/themes/<slug>.json` with fields `name`, `base` (dark/light/dark-daltonized/light-daltonized/dark-ansi/light-ansi), `overrides` (token→color map); hot-reloaded if the folder already existed at startup | Doc |

### 9.8 MCP, onboarding, login
| Item | Detail | Verified |
|---|---|---|
| `/login` | Command to log in with the Anthropic account | Doc |
| `/setup-bedrock`, `/setup-vertex` | Interactive wizards for Amazon Bedrock / Google Cloud Vertex, hidden from the menu until the relevant env var is set (or accessible from the login screen for first-time users) | Doc |
| Specific MCP dialogs (server approval, `/mcp`) | **Not investigated in depth in this research**: `/mcp` as a list with paging/scrollbar (v2.1.281+) and `.mcp.json` server approval tied to workspace trust (§9.2) are mentioned, but the exact text of the MCP connection/error dialog was not retrieved | Uncertain |
| First-run login/onboarding screen | **Not verified in this session** (no official source consulted describes it in detail); the local file only confirms the existence of `.credentials.json` and flags like `skipDangerousModePermissionPrompt` | Uncertain |
| "Update available" dialog | Mentioned indirectly (`DISABLE_AUTOUPDATER` is set to 1 in the user's local environment, so the update dialog is disabled in this installation); the exact prompt text was not verified | Uncertain |

## 10. On-screen elements

| Element | Description | Verified |
|---|---|---|
| Prompt box | Fixed input box at the bottom (always fixed in fullscreen; if it no longer moves while output scrolls, fullscreen is active) | Doc |
| Footer | Row of badges below the prompt: clickable PR/MR link (color = review status), mode indicators, keyboard hints (`esc to interrupt`, `? for shortcuts`, `hold space to speak` for voice dictation) — the latter disappear if a custom status line is configured | Doc |
| Status line | Customizable row above the footer badges, fed by a script that receives JSON on stdin (model, cwd, git, cost, context, rate limit, cache, vim mode, PR/MR, worktree, etc.); updated on events (new assistant message, end of `/compact`, permission mode change, vim toggle, optional refreshInterval) | Doc |
| Mode indicators | `⏸ manual mode on` (default), `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, `⏵⏵ bypass permissions on` | Doc |
| Spinner / verbs | **Spinner verbs and hints not verified in this research** (no official list of verbs like "Pondering…", "Cogitating…" etc. found in the sources consulted) | Uncertain |
| To-do list (Claude's checklist) | Toggle `Ctrl+T`, max 5 visible items, persists across compactions, shareable between sessions with `CLAUDE_CODE_TASK_LIST_ID` | Doc |
| Background tasks | Separate `/tasks` view (running shells and subagents) | Doc |
| Collapsed/expandable tool output | In fullscreen: clicking a collapsed tool result expands it (again to collapse it); same for `!` command output in progress or truncated (v2.1.257+); clicking a dim `Message from @<sender>` row from a teammate/other agent expands it | Doc |
| Transcript mode | `Ctrl+O` toggles between normal/transcript view; in fullscreen it adds `less`-style navigation (`/` search, `n`/`N` next/previous match, `j`/`k` line scroll, `g`/`G` start/end, `{`/`}` previous/next prompt, `Ctrl+u`/`Ctrl+d` half page, `Ctrl+b`/`Ctrl+f` full page, `Ctrl+o`/`Esc`/`q` exits); `[` writes out the terminal's entire native scrollback (searchable with Cmd+F/tmux copy-mode); `v` opens the conversation in `$VISUAL`/`$EDITOR` | Doc |
| `/focus` | "Quiet" view: only the last prompt, tool diffstat summary, final response. Persists across sessions | Doc |
| Session recap | Automatic one-line summary after ≥3 minutes of absence with the terminal unfocused (or `/recap` on request), max 400 characters | Doc |

## 11. Mouse and clicks (requires fullscreen rendering, `/tui fullscreen`)

| Mouse action | Effect | Verified |
|---|---|---|
| Click in the prompt | Positions the cursor | Doc |
| Click on a `/` or `@` suggestion | Accepts the entry (hover highlights the row) | Doc |
| Click on an option in a single-selection menu | Chooses the option (permissions, `/model`, `/config`, etc.) | Doc |
| Click on a multi-select option | Toggles it; clicking the submit button confirms; clicking a free-text row (e.g. **Other**) focuses the field (requires v2.1.208+) | Doc |
| Click on a value in `/config` | Changes the setting; the wheel scrolls the list (v2.1.271+) | Doc |
| Wheel on a select/multi-select menu with overflow | Scrolls the list (e.g. `/model` in a short terminal) (v2.1.280+) | Doc+Chg |
| Scrollbar in lists (`/skills`, `/mcp`, `/plugin` Installed) | Appears when rows exceed the available space; clicking the bar jumps to that point, dragging the thumb scrolls (v2.1.281+) | Doc+Chg |
| Click on a collapsed tool result | Expands/collapses (see §10) | Doc |
| `Cmd`+click (macOS) / `Ctrl`+click (Linux/Windows) on a URL or file path | Opens the URL in the browser or the file in the default app. UNC paths (`\\server\share\...`) remain plain text to avoid sending credentials. Some macOS terminals intercept `Cmd`+click: Ghostty and Warp also let a plain click work | Doc |
| Click-and-drag | Selects text anywhere in the conversation; double click selects a word (or a whole URL); triple click selects a line | Doc |
| Automatic copy on selection | Selected text goes to the clipboard when the mouse is released (can be disabled: **Copy on select** toggle in `/config`) | Doc |
| `Ctrl+Shift+C` (or `Cmd+C` on terminals with the Kitty keyboard protocol) | Manual copy if "Copy on select" is disabled; `Ctrl+C` with an active selection copies instead of cancelling | Doc |
| `Shift`+arrows with an active selection | Extends the selection from the keyboard; `Shift+Home/End` extends to the start/end of the line | Doc |
| Mouse wheel | Scrolls the conversation (requires the terminal to forward mouse events; in iTerm2 "Enable mouse reporting" must be enabled; in tmux it requires `set -g mouse on`) | Doc |
| `PgUp`/`PgDn` | Scrolls half a screen | Doc |
| `Ctrl+Home` / `Ctrl+End` | Jumps to the start/end of the conversation (re-enables auto-follow) | Doc |
| "Jump to bottom" button | Appears while scrolled up, shows a count of new messages; clicking it, `Ctrl+End`, or scrolling to the bottom closes it | Doc |
| PR/MR link in the footer | `Cmd`+click (macOS) / `Ctrl`+click (Win/Linux) opens the PR/MR in the browser | Doc |
| Status line links (OSC 8) | Clickable if the terminal supports hyperlinks (iTerm2, Kitty, WezTerm); not on Terminal.app | Doc |
| `owner/repo#123` issue references | Clickable (link built based on the git remote's host: GitHub, GitLab; not linked for Bitbucket/Codeberg/Gitea) | Doc |
| Disabling the mouse while keeping fullscreen | `CLAUDE_CODE_DISABLE_MOUSE=1` (loses click/hover/wheel, keeps PgUp/PgDn/Ctrl+Home/End); `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` keeps only the wheel | Doc |
| "On demand" native terminal selection | Holding a specific key during the drag (Terminal.app: `Fn`; iTerm2: `Option`; VS Code/Cursor/Devin: `Shift` or `Option` with a dedicated option; others: `Shift`) gives the terminal's native selection instead of Claude Code's | Doc |

## 12. Notifications, sounds, window title

| Item | Detail | Verified |
|---|---|---|
| Default desktop notification | Only in Ghostty, Kitty, iTerm2 (they receive the "notification" event when Claude finishes or is waiting for a permission and the user seems away) | Doc |
| Terminal bell | On other terminals, set `preferredNotifChannel:"terminal_bell"` in settings.json to use the bell instead of the desktop notification | Doc |
| iTerm2 | You need to enable Settings → Profiles → Terminal → "Notification Center Alerts" + "Filter Alerts" → "Send escape sequence-generated alerts" | Doc |
| `Notification` hook | Allows running a custom command/sound (e.g. `afplay` on macOS) when Claude needs attention; runs in addition to the native notification, useful on terminals without desktop notifications (Warp, integrated VS Code) | Doc |
| tmux | By default in tmux, desktop notifications and the progress bar do not reach the outer terminal: you need `set -g allow-passthrough on`, `set -s extended-keys on`, `set -as terminal-features 'xterm*:extkeys'` in `~/.tmux.conf` | Doc |
| Audible bell on Apple Terminal | `/terminal-setup` disables the audible bell by default (except in screen reader mode, where it leaves it intact from v2.1.211+) | Doc |
| Window title | **Not described in detail in the sources consulted**, but the user's local environment has `CLAUDE_CODE_DISABLE_TERMINAL_TITLE:"1"` in `~/.claude/settings.json`, which confirms that Claude Code normally **sets the terminal window title** (a feature that can be disabled with that env var); the exact title content was not found in the documentation | Doc (env var) + Uncertain (content) |
| Mobile system push notifications | The user has `agentPushNotifEnabled:true` locally — a push notification feature tied to sessions/agents, not investigated in depth in the general official sources consulted | Local (not from general official docs) |

## 13. Contexts and actions of the keybindings.json file (`/keybindings` to create/open)

File structure: an object with a `bindings` array, each block specifies a `context` and a key→action map (`null` to disable a default). Example:
```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+e": "chat:externalEditor", "ctrl+s": null } }
  ]
}
```
Changes to the file are detected and applied automatically, without restarting.

### List of available contexts
`Global`, `Chat`, `Autocomplete`, `Settings`, `Confirmation`, `Tabs`, `Help`, `Transcript`, `HistorySearch`, `Task`, `ThemePicker`, `Attachments`, `Footer`, `MessageSelector`, `DiffDialog`, `DiffPanel`, `ModelPicker`, `EffortSlider`, `Select`, `Plugin`, `Agents`, `Scroll`. (Before v2.1.205 there was also `Doctor` with the `doctor:fix` action, later removed.)

### Actions per context (action name — default key — brief description)

**Global (`app:*`)**: `app:interrupt` Ctrl+C · `app:exit` Ctrl+D · `app:redraw` (unassigned) · `app:toggleTodos` Ctrl+T · `app:toggleTranscript` Ctrl+O · `app:toggleReplTab` (unassigned, opens/closes the diff panel = `/diff`) · `app:cycleDiffBase` Ctrl+X B (`DiffPanel` context) · `app:diffFileListUp`/`app:diffFileListDown` Ctrl+Up/Meta+Up and Ctrl+Down/Meta+Down · `app:toggleDiffNoiseFilter` (unassigned) · `app:toggleDiffPreSession` (unassigned).

**History**: `history:search` Ctrl+R · `history:previous` Up · `history:next` Down.

**Chat**: `chat:cancel` Escape · `chat:clearInput` Ctrl+L · `chat:clearScreen` Cmd+K · `chat:killAgents` Ctrl+X Ctrl+K · `chat:cycleMode` Shift+Tab (Meta+M on Windows without VT) · `chat:modelPicker` Meta+P · `chat:fastMode` Meta+O · `chat:thinkingToggle` Meta+T · `chat:submit` Enter · `chat:queueSubmit` Ctrl+X Enter (requires v2.1.247+) · `chat:sendNow` Ctrl+Enter / Ctrl+X Ctrl+S (requires v2.1.275+) · `chat:newline` Ctrl+J · `chat:undo` Ctrl+_ / Ctrl+Shift+- · `chat:externalEditor` Ctrl+G, Ctrl+X Ctrl+E · `chat:stash` Ctrl+S · `chat:imagePaste` Ctrl+V (Alt+V on Windows/WSL).

**Autocomplete**: `autocomplete:accept` Tab · `autocomplete:dismiss` Escape · `autocomplete:previous` Up · `autocomplete:next` Down.

**Confirmation**: `confirm:yes` Enter · `confirm:no` Escape · `confirm:previous` Up · `confirm:next` Down · `confirm:nextField` Tab · `confirm:previousField` (unassigned) · `confirm:toggle` Space · `confirm:cycleMode` Shift+Tab. (Removed before v2.1.257: `confirm:toggleExplanation` Ctrl+E, command explanation on Bash/PowerShell prompts.) Double `Ctrl+C`/`Ctrl+D` close the dialog (reserved). Before v2.1.280, `y`/`n` were bound by default to `confirm:yes`/`confirm:no` (removed; if the file was created earlier with `/keybindings`, they remain until you delete them).

**Permission (`Confirmation` context)**: `permission:toggleDebug` (unassigned; previously Ctrl+D, removed in v2.1.146 because it conflicted with `app:exit`).

**Transcript**: `transcript:toggleShowAll` Ctrl+E (classic renderer only) · `transcript:exit` q, Ctrl+C, Escape.

**HistorySearch**: `historySearch:next` Ctrl+R · `historySearch:accept` Escape, Tab · `historySearch:cancel` Ctrl+C · `historySearch:execute` Enter · `historySearch:cycleScope` Ctrl+S (fullscreen only).

**Task**: `task:background` Ctrl+B, Ctrl+X Ctrl+B.

**ThemePicker**: `theme:toggleSyntaxHighlighting` Ctrl+T.

**Help**: `help:dismiss` Escape.

**Tabs**: `tabs:next` Tab, Right · `tabs:previous` Shift+Tab, Left.
**Attachments**: `attachments:next` Right · `attachments:previous` Left · `attachments:remove` Backspace, Delete · `attachments:exit` Down, Escape.

**Footer**: `footer:next` Right · `footer:previous` Left · `footer:up` Up · `footer:down` Down · `footer:openSelected` Enter · `footer:clearSelection` Escape · `footer:dismiss` (unassigned; before v2.1.281 Backspace/Delete removed the selected artifact link from the footer).

**MessageSelector**: no actions of its own (uses the `Select` actions in the rewind menu's message list; before v2.1.283 it had its own actions: `messageSelector:up/down/top/bottom/select`, still recognized for compatibility).

**DiffDialog**: `diff:dismiss` Escape · `diff:previousSource` Left · `diff:nextSource` Right · `diff:previousFile` Up, K · `diff:nextFile` Down, J · `diff:back` (unassigned). Plus the scroll actions `scroll:pageUp` PageUp, `scroll:pageDown` PageDown, `scroll:fullPageUp` Shift+Space/B, `scroll:fullPageDown` Space, `scroll:top` G/Home, `scroll:bottom` Shift+G/End (in the detail view). It also uses `select:previous`/`select:next`/`select:accept` on the file list (before v2.1.283: a dedicated `diff:viewDetails` action, now an alias of `select:accept`).

**DiffPanel**: `app:toggleReplTab`, `app:cycleDiffBase` Ctrl+X B, `app:diffFileListUp`/`Down`, `app:toggleDiffNoiseFilter`, `app:toggleDiffPreSession` (requires the panel, v2.1.260+).

**ModelPicker**: `modelPicker:decreaseEffort` Left · `modelPicker:increaseEffort` Right · `modelPicker:thisSessionOnly` s.

**EffortSlider** (opened by `/effort` with no arguments): `effortSlider:decreaseEffort` Left (v2.1.284+) · `effortSlider:increaseEffort` Right (v2.1.284+) · `effortSlider:toggleUltracode` Tab (v2.1.284+) · `effortSlider:thisSessionOnly` s (v2.1.257+). The slider's Enter/Escape are not remappable.

**Select** (generic, lists/menus): `select:next` Down, J, Ctrl+N · `select:previous` Up, K, Ctrl+P · `select:pageUp` PageUp · `select:pageDown` PageDown · `select:first` Home · `select:last` End · `select:accept` Enter · `select:cancel` Escape.

**Plugin**: `plugin:toggle` Space · `plugin:install` I · `plugin:favorite` F.

**Settings**: `settings:search` / · `settings:retry` R · (reuses `select:accept` Enter/Space and `confirm:no` Escape with specific semantics: changes apply immediately, so Escape closes without "undoing").

**Agents** (agent view, `claude agents`, requires v2.1.257+): `agents:switchView` Ctrl+S · `agents:togglePin` Ctrl+T. In agent view, `Agents` bindings take priority over `Chat`/`Global` on the same key.

**Voice** (`Chat` context, with voice dictation active): `voice:pushToTalk` Space (hold or tap depending on `/voice` mode).

**Scroll** (requires fullscreen): `scroll:lineUp`/`scroll:lineDown` wheel · `scroll:pageUp` PageUp · `scroll:pageDown` PageDown · `scroll:top` Ctrl+Home · `scroll:bottom` Ctrl+End · `scroll:halfPageUp`/`halfPageDown` (unassigned, for vi-style rebinding) · `scroll:fullPageUp`/`fullPageDown` (unassigned) · `selection:copy` Ctrl+Shift+C / Cmd+C · `selection:clear` (unassigned) · `selection:extendLeft/Right/Up/Down` Shift+arrows · `selection:extendLineStart`/`extendLineEnd` Shift+Home/End.

### Key syntax
- Modifiers: `ctrl`/`control`, `shift`, `alt`/`opt`/`option`/`meta` (Alt on Win/Linux, Option on macOS), `cmd`/`command`/`super`/`win` (detected only on terminals that report the Super modifier, e.g. the Kitty keyboard protocol; use `ctrl`/`meta` for universal bindings).
- Case: parsing is case-insensitive (`K` = `k`); for Shift+letter write `shift+k`.
- Non-US layouts: Ctrl keys must be written in Latin characters; on non-Latin layouts (e.g. Cyrillic) matching uses the physical US position if the terminal uses the Kitty keyboard protocol and reports it; on layouts that reorder Latin letters (e.g. AZERTY) matching uses the letter the key types.
- Chords: sequences separated by a space (e.g. `ctrl+k ctrl+s`), each key within 3 seconds of the previous one, otherwise the chord cancels with a warning.
- Special keys: `escape`/`esc`, `enter`/`return`, `tab`, `space`, `up`/`down`/`left`/`right`, `pageup`/`pagedown`, `home`/`end`, `backspace`/`delete`, `wheelup`/`wheeldown`.

### Unlocking defaults and reserved chords on `ctrl+x`
Assigning `null` disables a default (chords too). Default chords on the `ctrl+x` prefix: `ctrl+x ctrl+k`, `ctrl+x ctrl+e`, `ctrl+x enter` (v2.1.247+), `ctrl+x ctrl+a`, `ctrl+x ctrl+s` (v2.1.275+), `ctrl+x tab` (these last three v2.1.260+) in `Chat`; `ctrl+x ctrl+b` in `Task`; `ctrl+x b` in `DiffPanel`. To reuse `ctrl+x` as a single key, all of these must be explicitly disabled.

### Non-remappable shortcuts (reserved)
| Key | Reason |
|---|---|
| `Ctrl+C` | Interrupt/cancel hardcoded |
| `Ctrl+D` | Exit hardcoded |
| `Ctrl+M` | Always received as Enter |
| `Ctrl+[` | Always received as Escape (requires v2.1.242+ on Kitty protocol terminals) |
| `Ctrl+I` | Always received as Tab |
| `Ctrl+H` | Sends the ASCII backspace byte; behavior depends on the terminal and on `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE` |
| `Caps Lock` | Not delivered to terminal applications |

### Known conflicts with terminal multiplexers
`Ctrl+B` = tmux prefix (press twice) · `Ctrl+A` = GNU screen prefix · `Ctrl+Z` = Unix process suspension (SIGTSTP).

### Text fields
If you assign a bare letter/digit/Space, it remains typeable in a text field (e.g. a question's **Other** row): with the field focused, a printable key without Ctrl/Alt/Cmd goes to the field, not to the binding. These remain active: non-printable keys (Enter/Escape/Tab/arrows), any key with Ctrl/Alt/Cmd, the second key of an already-started chord.

### Validation
Claude Code validates the file and writes warnings to the debug log for: JSON parsing errors, incorrect modifiers (e.g. `ctl+k`: before v2.1.283 it was silently accepted, discarding the unrecognized part and applying the binding to the remaining key; after v2.1.283 it warns and suggests the correction), invalid context names, invalid action values, unknown action names (before v2.1.246 they silently disabled the key, now skipping it keeps the default), conflicts with reserved shortcuts, duplicate bindings in the same context. `claude --debug` shows the details.

## 14. Summary of macOS / Windows / Linux differences

| Area | macOS | Windows | Linux |
|---|---|---|---|
| Option keys (`Alt+B/F/D/Y`, `Alt+P`) | Require "Option as Meta" configured in the terminal (Apple Terminal: Settings→Profiles→Keyboard; iTerm2: Settings→Profiles→Keys→General→Esc+; VS Code: `terminal.integrated.macOptionIsMeta`) | Work as `Alt+...` normally | Work as `Alt+...` normally |
| Paste image | `Ctrl+V` or `Cmd+V` (iTerm2) | `Alt+V` (also `Ctrl+V` on WSL) | `Ctrl+V` |
| Permission mode cycle | `Shift+Tab` | `Shift+Tab`, or `Alt+M` if Node/Bun does not enable VT input mode | `Shift+Tab` |
| Cmd+click / Ctrl+click on a link | `Cmd`+click | `Ctrl`+click | `Ctrl`+click |
| Copy with Kitty protocol | `Cmd+C` | — | — |
| Delete previous word | `Option+Delete` | `Ctrl+Backspace` | (not explicitly specified, presumably Ctrl+Backspace) |
| Backspace that deletes a whole word (known bug) | Reads as normal Backspace | May read `^H` as Ctrl+Backspace unless `TERM_PROGRAM=mintty`/`TERM=cygwin`; fix with `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE=0` | Reads as normal Backspace |
| Process suspension (`Ctrl+Z`) | Yes | No | Yes |
| "On demand" native selection in fullscreen | `Fn` (Terminal.app) / `Option` (iTerm2) | `Shift` (VS Code/Cursor/Devin) | `Shift` |
| PgUp/PgDn/Home/End keys on a keyboard without dedicated keys (MacBook) | `Fn+↑/↓/←/→` (note: `Ctrl+Fn+→` does not reach Claude Code, no default jump-to-bottom chord) | N/A | N/A |

## 15. Recent relevant changes (from the changelog / web research, versions 2.1.280–2.1.283)

| Version | Change | Source |
|---|---|---|
| 2.1.280 | Extended mouse support in fullscreen: the wheel scrolls the `/skills` list, a skill's status options in `/plugin` are clickable | Doc+Chg (web research) |
| 2.1.280 | Fix: a click that only served to bring the terminal window to the foreground should no longer also activate the element under the pointer (search picker, tab bar, agent/workflow rows, slash command links, suggestion dropdown) | Doc+Chg |
| 2.1.280 | Fix: a "stray" `n` or `y` no longer closes/confirms dialogs by mistake; only `Enter`/`Esc` accept/cancel (restorable by binding `y`/`n` to `confirm:yes`/`confirm:no`) | Doc+Chg |
| 2.1.281 | Scrollbar added to the `/skills`, `/mcp`, `/plugin` Installed lists in fullscreen (as already on `/workflows`): appears when the mouse is over the list, clickable/draggable | Doc+Chg |
| 2.1.281 | Fix: a click on an agent panel row no longer left the keyboard cursor on the previously selected row | Doc+Chg |
| 2.1.283 | Fix: `keybindings.json` no longer silently accepts a misspelled modifier (e.g. `ctl+k`); it now warns in the debug log and suggests the correction | Doc+Chg |

Note: these entries come from web research (third-party results summarizing the official changelog), not from directly reading the raw `CHANGELOG.md` file (the direct fetch of that file was not successfully retried in this session due to time/attempt limits); they should therefore be considered **Doc+Chg** but not "verified byte-for-byte against the CHANGELOG".

## 16. Local files inspected

| File | Outcome |
|---|---|
| `~/.claude/keybindings.json` | **Does not exist** — the user has never run `/keybindings` to create it; all combinations are at the documented defaults |
| `~/.claude/settings.json` | Exists. Relevant for interaction: `"tui": "fullscreen"` (fullscreen renderer active), `"voice": {"enabled": true, "mode": "hold"}` (voice dictation in "hold" mode → `Space` = `voice:pushToTalk`), `"env": {"CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT": "1"}` (mitigation for ConPTY/Windows Terminal rendering glitches), `"CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"` (disables setting the window title, confirming that Claude Code normally sets it), `"DISABLE_AUTOUPDATER": "1"` (disables the auto-update dialog), `"skipDangerousModePermissionPrompt": true`, `"agentPushNotifEnabled": true`, `"model": "opus"`, multiple hooks on Stop/PreToolUse/SessionStart/SessionEnd/UserPromptSubmit |
| `claude --version` | `2.1.280 (Claude Code)` — confirms the census's target version |

## 17. Points explicitly uncertain / not verified in this research

1. **The `#` prefix for memory** at the start of the prompt: its existence is hinted at (a `memoryBackgroundColor` theme token exists for "`#` memory entries in the transcript") but the detailed behavior (whether it adds to CLAUDE.md, what submenus it offers) was not retrieved from a dedicated page in this session.
2. **The `&` prefix**: no reference found in the official pages consulted (interactive-mode, commands, keybindings); it might not exist in version 2.1.280 or might not be publicly documented.
3. **File drag & drop** in the terminal: not found as a mechanism distinct from pasting images/text.
4. **The AskUserQuestion dialog**: not confirmed in detail whether each question supports single *and* multiple selection at the same time, nor the presence of "previews" per option (beyond the generic mouse toggle behavior already documented in fullscreen.md).
5. **Exact text/keys of the folder trust dialog**: the function and scope are documented, but not the literal wording of the on-screen options.
6. **MCP dialogs** (connection, server errors, tool approval with `requiresUserInteraction`): behavior inferred from permissions.md/mcp.md but not inspected in a dialog-specific page.
7. **First-ever-launch onboarding/login screen** and **initial theme selection**: not verified in this session (no "getting started"/"onboarding" page was consulted).
8. **Spinner verbs** ("Pondering…", etc.) and any random rotation of micro-hints: not found in this research.
9. **The raw CHANGELOG.md** (`raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`): was not retrieved directly in this session (replaced by third-party web research); the entries in §15 should therefore be treated cautiously as a secondary source.
10. **The exact title** set on the terminal window (e.g. whether it includes project name, model, status): inferred only indirectly from the existence of the env var that disables it.

---

## Sources consulted

- https://code.claude.com/docs/en/interactive-mode (full content extracted)
- https://code.claude.com/docs/en/keybindings (full content extracted)
- https://code.claude.com/docs/en/terminal-config (full content extracted)
- https://code.claude.com/docs/en/checkpointing (full content extracted)
- https://code.claude.com/docs/en/fullscreen (full content extracted)
- https://code.claude.com/docs/en/permissions (full content extracted)
- https://code.claude.com/docs/en/statusline (full content extracted)
- https://code.claude.com/docs/en/settings (partially consulted — mainly the precedence table, not relevant to interaction)
- https://code.claude.com/docs/en/commands (partially consulted, via targeted grep)
- https://code.claude.com/docs/en/permission-modes (partially consulted, via targeted grep on the plan mode / protected paths / modes sections)
- https://code.claude.com/docs/en/tools-reference (partially consulted, AskUserQuestion section and subagent permission prompts)
- Web research on the Claude Code 2.1.280/2.1.281/2.1.283 changelog (results aggregated from third parties: marckrenn/claude-code-changelog on GitHub, ClaudeCodeLog on X) — **the raw CHANGELOG.md of anthropics/claude-code was not read directly**
- `claude --version` run locally → `2.1.280 (Claude Code)`
- User's local files: `~/.claude/settings.json` (read), verification of the absence of `~/.claude/keybindings.json`


---

# Part C — CLI, settings, hooks, SDK protocol


Document prepared as a specification for a GUI app that wraps Claude Code. Verification: **[LOCAL]** = run on this machine (`claude --version` → 2.1.280, via `claude --help` and `claude <subcommand> --help`); **[DOC]** = verified on code.claude.com/docs; **[UNCERTAIN]** = not directly verified, inferred, or not reached in this session.

---

## 1. CLI commands and flags

### 1.1 Global flags (`claude --help`) [LOCAL] + additions from [DOC] (`claude --help` does not list every existing flag)

| Flag | Description |
|---|---|
| `--add-dir <dirs...>` | Additional directories to grant file access to (does not load `.claude/` config from them, unless skills if also passed to `--add-dir`) |
| `--advisor <model>` | [DOC] Enables the server-side advisor tool with a model (`fable`, `opus`, `sonnet`, or a full ID) |
| `--agent <agent>` | Agent for the current session (overrides the `agent` setting) |
| `--agents <json>` | JSON defining custom subagents; with `--print` it can be a path to a JSON file (requires v2.1.281+) |
| `--allow-dangerously-skip-permissions` | Adds `bypassPermissions` to the Shift+Tab cycle without enabling it by default |
| `--allowedTools` / `--allowed-tools <tools...>` | Tools executed without a prompt (permission rule syntax) |
| `--append-subagent-system-prompt` / `-file` | [DOC] Appends text to every subagent's system prompt (only `-p`) |
| `--append-system-prompt <prompt>` / `--append-system-prompt-file <path>` | Appends text to the default system prompt |
| `--autocompact <auto\|tokens>` | Auto-compact window (auto, or 100k–1M tokens) |
| `--ax-screen-reader` | Flat output for screen readers |
| `--bare` | Minimal mode: skips hooks, LSP, plugin sync, attribution, auto-memory, prefetch, keychain, CLAUDE.md auto-discovery; sets `CLAUDE_CODE_SIMPLE=1` |
| `--betas <betas...>` | Additional beta headers for API requests (API key users only) |
| `--bg`, `--background` | Starts the session in the background and returns immediately; prints the ID |
| `--brief` | Enables the `SendUserMessage` tool for agent→user communication |
| `--channels` | [DOC] (research preview) MCP servers whose channels to listen to |
| `--chrome` / `--no-chrome` | Enables/disables the Claude in Chrome integration |
| `--cloud [description\|session_id\|url]` | Creates/attaches a cloud session |
| `-c`, `--continue` | Continues the most recent conversation in the current directory |
| `--dangerously-load-development-channels` | [DOC] Enables channels not on the allowlist, for local development |
| `--dangerously-skip-permissions` | Bypasses all permission checks (equivalent to `--permission-mode bypassPermissions`) |
| `-d`, `--debug [filter]` | Debug with an optional category filter (e.g. `api,hooks` or `!1p,!file`) |
| `--debug-file <path>` | Writes debug logs to a specific file |
| `--disable-slash-commands` | Disables all skills/commands |
| `--disallowedTools` / `--disallowed-tools <tools...>` | Denied tools |
| `--effort <level>` | Effort level: `low`, `medium`, `high`, `xhigh`, `max` ([DOC] also `ultracode`) |
| `--environment <environment_id>` | Creates a cloud session on a self-hosted environment (`ccpool_...`) |
| `--exclude-dynamic-system-prompt-sections` | Moves per-machine sections (cwd, env, memory, git status) from the system prompt to the first user message |
| `--exec` | [DOC] Executes a shell command as a background PTY job instead of starting a session (with `--bg`) |
| `--fallback-model <model>` | Fallback model(s) in case of overload |
| `--file <specs...>` | File resources to download at startup (`file_id:path`) |
| `--fork-session` | On resume, creates a new session ID instead of reusing the original |
| `--forward-subagent-text` | Forwards subagent text/thinking as assistant/user messages with `parent_tool_use_id` (only with `--print --output-format=stream-json`) |
| `--from-pr [value]` | Resumes a session linked to a PR (number/URL) |
| `-h`, `--help` | Help |
| `--ide` | Automatic connection to an IDE if exactly one is available |
| `--include-hook-events` | Includes all hook events in the output stream |
| `--include-partial-messages` | Includes partial message chunks (only `--print` + `stream-json`) |
| `--init` / `--init-only` | [DOC] Runs the Setup hook (matcher `init`/`maintenance`) before the session; `--init-only` exits without starting a conversation |
| `--input-format <text\|stream-json>` | Input format (only `--print`) |
| `--json-schema <schema>` | JSON Schema for validated structured output (print mode only) |
| `--maintenance` | [DOC] Runs the Setup hook with matcher `maintenance` (print mode) |
| `--max-budget-usd <amount>` | Spending cap in $ for API calls (print mode only) |
| `--max-turns <n>` | Limits agentic turns (print mode only) |
| `--mcp-config <configs...>` | Loads MCP servers from JSON files or strings |
| `--model <model>` | Model (alias `sonnet`/`opus`/`haiku`/`fable` or full name) |
| `-n`, `--name <name>` | Session's display name |
| `--no-session-persistence` | Disables session persistence (print mode only) |
| `--output-format <text\|json\|stream-json>` | Output format (print mode only) |
| `--permission-mode <mode>` | `acceptEdits`, `auto`, `bypassPermissions`, `manual`/`default`, `dontAsk`, `plan` |
| `--permission-prompt-tool <tool>` | MCP tool to handle permission prompts in non-interactive mode |
| `--permission-prompts <host\|none>` | Who answers permission prompts in print mode |
| `--plugin-dir <path>` (repeatable) | Loads a plugin from a directory/.zip for the session |
| `--plugin-url <url>` (repeatable) | Downloads a plugin .zip from a URL for the session |
| `-p`, `--print` | Prints the response and exits (non-interactive) |
| `--prompt-suggestions [value]` | Emits a `prompt_suggestion` message after every turn |
| `--ref <branch>` | [DOC] With `--environment`, bases the checkout on a ref instead of the local `HEAD` |
| `--remote` | [DOC] Deprecated alias of `--cloud` |
| `--remote-control [name]`, `--rc` | Starts a session with Remote Control enabled |
| `--remote-control-session-name-prefix <prefix>` | Prefix for auto-generated Remote Control session names |
| `--replay-user-messages` | Re-emits user messages from stdin to stdout (requires stream-json in/out) |
| `--restricted` | Restricted mode: removes tools that execute commands/code + WebFetch unless listed in `--tools`; ignores user/project/local settings; confines file tools to the working directories; rejects bypassPermissions |
| `-r`, `--resume [value]` | Resumes a session by ID/name, or opens the picker |
| `--safe-mode` | Disables all customizations (CLAUDE.md, skills, plugins, hooks, MCP, custom commands, output style, themes, keybindings); sets `CLAUDE_CODE_SAFE_MODE` |
| `--session-id <uuid>` | Specific session ID (must be a valid UUID) |
| `--setting-sources <sources>` | Comma-separated list: `user`, `project`, `local` |
| `--settings <file-or-json>` | Path or JSON string with additional settings (max 2 MiB) |
| `--strict-mcp-config` | Uses only MCP servers from `--mcp-config` |
| `--system-prompt <prompt>` / `--system-prompt-file <path>` | Replaces the entire system prompt |
| `--system-prompt-snapshot <on\|off>` | Records the system prompt once per conversation and reuses it (on=default) or rebuilds it on every request (off) |
| `--teleport [session]` | Resumes a cloud session in the local terminal |
| `--teammate-mode <in-process\|auto\|tmux\|iterm2>` | [DOC] Display mode for agent team teammates |
| `--tmux[=classic]` | Creates a tmux session for the worktree (requires `--worktree`) |
| `--tools <tools...>` | List of available built-in tools (`""` disables all, `"default"` default set) |
| `--verbose` | Detailed logging (overrides the `viewMode` setting) |
| `-v`, `--version` | Version |
| `-w`, `--worktree [name]` | Creates an isolated git worktree for the session |

### 1.2 System prompt flags (summary) [DOC]

5 flags: `--system-prompt`, `--system-prompt-file` (replace), `--append-system-prompt`, `--append-system-prompt-file` (append), `--system-prompt-snapshot` (controls whether the recorded prompt is reused). `--system-prompt`/`--system-prompt-file` are mutually exclusive with each other; the append flags can be combined with both. The `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` marker separates the static (cacheable) part from the dynamic part (requires v2.1.275+).

### 1.3 Subcommands (`claude <cmd> --help`) [LOCAL]

| Subcommand | Description | Main options |
|---|---|---|
| `agents [options]` | Manages background agents (agent view) | `--add-dir`, `--agent`, `--all`, `--allow-dangerously-skip-permissions`, `--cwd <path>`, `--dangerously-skip-permissions`, `--effort`, `--json`, `--mcp-config`, `--model`, `--permission-mode`, `--plugin-dir`, `--restricted`, `--setting-sources`, `--settings`, `--strict-mcp-config` |
| `attach <id>` | Opens a background session in the current terminal | — |
| `auth` | Authentication management | subcommands: `login`, `logout`, `status`, `help` |
| `auth login [options]` | Login | `--claudeai` (default), `--console`, `--email <email>`, `--sso` |
| `auth logout` | Logout | — |
| `auth status [options]` | Authentication status | `--json` (default), `--text` |
| `auto-mode` | Inspect/reset the auto mode classifier config | subcommands: `config`, `critique`, `defaults`, `reset`, `help` |
| `auto-mode config` | Prints the effective auto mode config as JSON | — |
| `auto-mode critique [options]` | AI feedback on custom rules | `--model <model>` |
| `auto-mode defaults [options]` | Prints default rules (environment/allow/soft_deny/hard_deny) | `--label <prefix>` |
| `auto-mode reset [options]` | Restores the default config by removing the `autoMode` section from user settings | `-y`, `--yes` |
| `doctor [options]` | Diagnoses installation/settings (reads config files without a trust prompt) | — |
| `gateway [options]` | Starts the enterprise auth/telemetry gateway | `--config <path>` |
| `import [options] [source]` | Imports config from another AI agent (`codex`, `gemini`, `cursor`) | `--dry-run`, `--yes[=<digest>]` |
| `install [options] [target]` | Installs a native Claude Code build (`stable`/`latest`/version) | `--force` |
| `logs <id>` | Prints recent output of a background session | — |
| `mcp` | Configures/manages MCP servers | see 1.4 |
| `plugin` \| `plugins` | Manages plugins | see 1.5 |
| `project` | Manages project state | subcommands: `purge`, `help` |
| `project purge [options] [path]` | Deletes all local state for a project (transcripts, tasks, file history, config entry) | `--all`, `--dry-run`, `-i`/`--interactive`, `-y`/`--yes` |
| `respawn [options] [id]` | Restarts a background session (or all of them with `--all`) to use the current binary | `--all` |
| `rm <id>` | Deletes a background session (and its worktree if safe) | `--discard-unpushed <commit>@<worktree-id>`, `--force-remove-worktree <worktree-id>` |
| `setup-token [options]` | Generates a long-lived OAuth token (requires a subscription) | — |
| `stop` \| `kill <id>` | Stops a background session (conversation preserved) | — |
| `ultrareview [options] [target]` | Cloud-hosted multi-agent code review on the current branch/PR | `--json`, `--no-post` (default), `--post`, `--timeout <minutes>` (default 45) |
| `update` \| `upgrade [options]` | Checks/installs updates | — |

Commands documented but **not present** in the local v2.1.280 help (probably introduced in later doc versions, or feature-flagged) [DOC, not verified locally]: `claude daemon status`, `claude daemon stop --any`, `claude remote-control`, `claude self-hosted-runner [setup|doctor|orchestrator]`. There is no `claude config` subcommand (configuration happens only via interactive `/config` or by directly editing the settings.json files) [LOCAL — verified that `claude config --help` falls back to the main help].

### 1.4 `claude mcp` — subcommands [LOCAL]

| Subcommand | Description | Options |
|---|---|---|
| `add [options] <name> <commandOrUrl> [args...]` | Adds an MCP server | `--callback-port`, `--client-id`, `--client-secret`, `-e/--env`, `-H/--header`, `-s/--scope <local\|user\|project>` (default local), `-t/--transport <stdio\|sse\|http>` |
| `add-from-claude-desktop [options]` | Imports servers from Claude Desktop (Mac/WSL) | `-s/--scope` |
| `add-json [options] <name> <json>` | Adds a server via a JSON string | `--client-secret`, `-s/--scope` |
| `get <name>` | Server details | — |
| `list` | Lists configured servers | — |
| `login [options] <name>` | OAuth authenticates with a server (HTTP/SSE/connector) | `--no-browser` |
| `logout <name>` | Removes saved OAuth credentials | — |
| `remove [options] <name>` | Removes a server | `-s/--scope` |
| `reset-project-choices` | Resets approved/rejected choices for the project's `.mcp.json` | — |
| `serve [options]` | Starts Claude Code as an MCP server | `-d/--debug`, `--verbose` |

### 1.5 `claude plugin`/`plugins` — subcommands [LOCAL]

| Subcommand | Description | Key options |
|---|---|---|
| `marketplace` | Manages marketplaces | sub-subcommands: `add`, `list`, `remove`/`rm`, `update`, `help` |
| `install`/`i <plugin>` | Installs a plugin from a marketplace (`plugin@marketplace`) | `--accept-command <sha256>`, `--config <k=v>`, `--json`, `--registry <url>`, `-s/--scope <user\|project\|local>` (default user), `-y/--yes` |
| `uninstall`/`remove <plugin>` | Uninstalls | `--json`, `--keep-data`, `--prune`, `-s/--scope`, `-y/--yes` |
| `list [options]` | Lists installed plugins | `--available`, `--json` |
| `enable <plugin>` | Enables a disabled plugin | `--json`, `-s/--scope` |
| `disable [plugin]` | Disables a plugin | `-a/--all`, `--json`, `-s/--scope` |
| `details <name>` | Component inventory and estimated token cost | — |
| `validate <path>` | Validates a plugin/marketplace manifest or skills/agents/commands | `--json`, `--strict` |
| `init`/`new <name>` | Creates a plugin scaffold in `~/.claude/skills/<name>/` | `--author`, `--author-email`, `--description`, `-f/--force`, `--with <components...>` (skills, agents, hooks, mcp, lsp, output-style, channel) |
| `tag [path]` | Creates a `{name}--v{version}` git tag for a release | `--dry-run`, `-f/--force`, `-m/--message`, `--push`, `--remote` |
| `eval [options] [command] [target]` | Runs an eval suite on a plugin | `--ablation`, `--allow-real-servers`, `--allow-tools`, `--case`, `-j/--concurrency`, `--eval-dir`, `--json [path]`, `--judge-model`, `--keep-temp`, `--max-cost-usd`, `--mocks <record\|off>`, `--model`, `--no-publish`, `--no-scaffold`, `--output-dir`, `--publish-report`, `--report`, `--runs`, `--scaffold`, `--tag`, `--threshold`, `--trust-plugin`, `--verbose`; subcommand `init [name]` |
| `update <plugin>` | Updates a plugin (requires restart) | `--accept-command`, `--json`, `-s/--scope <user\|project\|local\|managed>`, `-y/--yes` |
| `prune`/`autoremove` | Removes auto-installed dependencies that are no longer needed | `--dry-run`, `-s/--scope`, `-y/--yes` |

---

## 2. Headless mode and the Agent SDK

### 2.1 Basic usage [DOC]

`claude -p "prompt"` runs in non-interactive mode. Not composable with `-p`: `--bg`; `--cloud` with a task description (with a session-id it instead queues a message). Exit code 0 for success, non-zero for failure. `--bare` reduces startup time by skipping hooks/skills/custom commands/subagents/plugins/MCP/auto-memory/CLAUDE.md (recommended for scripts/CI, will become the future default for `-p`).

### 2.2 Output formats [DOC/LOCAL]

- `text` (default): plain text
- `json`: a single JSON with `result`, `session_id`, metadata, `total_cost_usd`, a per-model cost breakdown, optional `structured_output` (with `--json-schema`)
- `stream-json`: NDJSON event by event, last line of type `result`

### 2.3 stream-json message schema — event types [DOC]

| Type (`type`) | Description |
|---|---|
| `system` (subtype `init`) | First event (except for earlier startup events); reports the model, tools, MCP servers, loaded plugins, an optional `capabilities` field (e.g. `interrupt_receipt_v1`), `plugins`/`plugin_errors` fields, `mcp_servers`/`mcp_server_errors` |
| `system` (subtype `api_retry`) | Emitted on retries of failed API requests: `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `no_response`, `error` (category), `uuid`, `session_id` |
| `system` (subtype `plugin_install`) | With `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`: `status` (`started`/`installed`/`failed`/`completed`), `name`, `error`, `uuid`, `session_id` |
| `assistant` | The model's message; with a subagent it carries `parent_tool_use_id` (the ID of the Agent/Skill tool call that generated it) |
| `user` | User message (including a subagent's first prompt when in the foreground); with `--replay-user-messages` it is re-emitted on stdout |
| `tool_use` / `tool_result` | Tool call/result blocks (always present for subagents, even without `--forward-subagent-text`) |
| `stream_event` | With `--include-partial-messages`: granular events (e.g. `delta.type == "text_delta"`) |
| `result` | Last line: final text, cost, session metadata; subtype `error_during_execution` with `errors[]` and `startup_failure_reason` (e.g. `worktree_unverified`, `worktree_resume_refused`) on a startup error |
| `prompt_suggestion` | With `--prompt-suggestions`: the predicted next prompt |
| Hook events (`hook_started`, `hook_progress`, `hook_response`) | With `--include-hook-events`; always present for `SessionStart`/`Setup` even without the flag |
| `permission_denied` | With `--permission-prompts none`: a denial notification; the final `result` includes `permission_denials` |

The `parent_tool_use_id` field is `null` for main conversation messages, otherwise the ID of the Agent/Skill call that generated the subagent (allows reconstructing the nesting tree). **[UNCERTAIN]**: no explicit `control_request`/`control_response` mechanism was found in the documentation on the headless CLI side (that appears to be a concept internal to the Agent SDK protocol / query object, not publicly documented in detail in this session — see 2.4).

### 2.4 What the Agent SDK (TypeScript/Python) offers beyond `claude -p` [DOC]

The Agent SDK is a library that starts the Claude Code binary in-process and offers, beyond what the headless CLI exposes via stdout JSON:

- **`canUseTool` callback**: intercepts permission requests on the application side, instead of an external MCP tool (`--permission-prompt-tool`)
- **In-process hooks**: JS/Python handlers instead of external shell/HTTP commands
- **`interrupt()`**: interrupts an in-progress turn (a "soft" equivalent of SIGINT, preferable to SIGTERM, which instead terminates the process without recording a `result`)
- **`setPermissionMode()`** and **`setModel()`**: change the permission mode/model at runtime without restarting the process
- The **`query`** object: a programmatic interface to a stream of typed messages (native message objects) instead of having to parse NDJSON
- **Streaming input**: programmatic sending of messages (equivalent to `--input-format stream-json` but with a typed API)
- Typed session/resume handling, cumulative cost tracking (`accumulate costs across multiple calls`)
- **Subagent/plugin/skill/MCP** support with the same rules as the CLI but configurable via typed options (`additionalDirectories`, `add_dirs`, etc.)
- `SDKInformationalMessage`, `SDKSystemMessage`, `SDKHookStartedMessage` messages as native TypeScript types

The headless CLI (`claude -p --output-format stream-json`) remains the only way to drive the agent loop from languages other than Python/TS (by running it as a subprocess). **[UNCERTAIN]**: the exact detail of the SDK's bidirectional control protocol (query cancellation, internal message queue) was not reached due to a network error during research (the `agent-sdk/typescript` page was not successfully retrieved).

### 2.5 Permission handling in automation [DOC]

- `--permission-prompts none`: nobody answers prompts → anything that would require a prompt is denied (unless a `PermissionRequest` hook decides otherwise); removes tools like `AskUserQuestion`
- `--permission-mode dontAsk`: denies every call that would otherwise prompt, useful for CI lock-down
- `--allowedTools`/`--disallowedTools`: granular per-session allowlist/denylist
- `--dangerously-skip-permissions` (`bypassPermissions`): bypasses all checks except hard-coded exceptions (critical paths, cross-session messaging safeguards, tools that require user interaction)

### 2.6 Bare mode [DOC]

`--bare`: skips hooks, LSP, plugin sync, attribution, auto-memory, background prefetch, keychain reads, CLAUDE.md auto-discovery; sets `CLAUDE_CODE_SIMPLE=1`. Auth only via `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings` (OAuth and keychain are never read in bare mode). Skills still resolve via `/skill-name`. Context must be passed explicitly with `--system-prompt[-file]`, `--append-system-prompt[-file]`, `--add-dir`, `--mcp-config`, `--settings`, `--agents`, `--plugin-dir`.

### 2.7 Special headless behaviors [DOC]

- **Background tasks at the end of `-p`**: a background Bash task is terminated ~5s after the final result (stdin closed); background subagents/workflows instead keep `claude -p` open (default: up to 10 minutes idle, configurable with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, `0` = unlimited)
- **SIGTERM**: terminates immediately, the in-progress turn is not recorded (exit code 143); **SIGINT** (or the SDK's `interrupt()`) closes the turn gracefully
- **Unreadable stdin**: a warning on stderr, proceeds with the command-line prompt
- **Piped stdin**: 10 MB cap
- **`--continue`/`--resume` in `-p`**: resume finished sessions (including terminated background ones on v2.1.257+), not ones still running

---

## 3. `settings.json` keys

### 3.1 File hierarchy and precedence [DOC]

Order of precedence (from highest to lowest):

1. **Managed settings** (`managed-settings.json`, MDM, or server-managed from the claude.ai panel) — nothing overrides it except for security exceptions
2. **Command line** (`claude --settings <file-or-json>`) — for one session
3. **Project local** (`.claude/settings.local.json`) — personal, per project (auto-excluded from git)
4. **Shared project** (`.claude/settings.json`) — shared via VCS
5. **User** (`~/.claude/settings.json`) — personal, for every project

**Lists** (e.g. `permissions.allow`) are merged across files instead of overwriting each other; exceptions: `fallbackModel` (entire chain from the highest file), `modelPicker` (whole value, not `project`/`local`), `availableModels` (not merged across managed sources), `modelSettings` (resolved model by model). There are also some **security exceptions** where the most restrictive value wins regardless of level: `disableClaudeAiConnectors`, `enableArtifact` (false wins), `isolatePeerMachines`, `remoteControlAtStartup` (false from project/local wins), `crossSessionInbound` (the tightest value), `useAutoModeDuringPlan` (false wins), `syncClaudeAiSkills`/`syncClaudeAiPlugins` (false wins), `maxEffortLevel` (the lower cap wins).

A fifth system file, **`~/.claude.json`**, is written by Claude Code itself (login session, MCP config, per-project state, global config keys) and should not be edited by hand.

### 3.2 List of main keys (full index table, ~230+ entries) [DOC]

> Note: the official "settings-index" table lists every key with a Scope column (`Any file` = any settings file, `User or managed`, `Managed`, `Global config` = `~/.claude.json` only, etc.). Below are the entries collected in this session, grouped by area. The list is not guaranteed to be 100% complete due to fetch truncation (the source reports "433 keys" total according to the automatic extraction, likely including nested sub-keys counted individually).

**Permissions and sandbox**
`permissions`, `permissions.defaultMode`, `permissions.allow`, `permissions.ask`, `permissions.deny`, `permissions.additionalDirectories`, `permissions.blockReadsOutsideWorkingDirectories`, `permissions.disableBypassPermissionsMode`, `allowManagedPermissionRulesOnly`, `skipDangerousModePermissionPrompt`, `sandbox.enabled`, `sandbox.failIfUnavailable`, `sandbox.filesystem` (+`.allowRead`, `.allowWrite`, `.denyRead`, `.denyWrite`, `.disabled`, `.allowManagedReadPathsOnly`), `sandbox.network` (+`.allowedDomains`, `.deniedDomains`, `.allowLocalBinding`, `.allowMachLookup`, `.allowAllUnixSockets`, `.allowUnixSockets`, `.httpProxyPort`, `.socksProxyPort`, `.strictAllowlist`, `.tlsTerminate`, `.allowManagedDomainsOnly`), `sandbox.credentials` (+`.allowPlaintextInject`, `.awsPairs`, `.envVars`, `.files`, `.sigv4`), `sandbox.autoAllowBashIfSandboxed`, `sandbox.allowUnsandboxedCommands`, `sandbox.excludedCommands`, `sandbox.ignoreViolations`, `sandbox.enableWeakerNestedSandbox`, `sandbox.enableWeakerNetworkIsolation`, `sandbox.bwrapPath`, `sandbox.socatPath`, `sandbox.ripgrep`, `sandbox.allowAppleEvents`.

**Model and effort**
`model`, `modelOverrides`, `modelPicker`, `modelPricing`, `modelSettings`, `availableModels`, `availableModelsMatch`, `deniedModels`, `effortLevel`, `maxEffortLevel`, `fallbackModel`, `switchModelsOnFlag`, `enforceAvailableModels`, `advisorModel`.

**Hooks, MCP, plugins, skills**
`hooks`, `disableAllHooks`, `allowManagedHooksOnly`, `allowedHttpHookUrls`, `httpHookAllowedEnvVars`, `managedMcpServers`, `allowedMcpServers`, `deniedMcpServers`, `disabledMcpjsonServers`, `enabledMcpjsonServers`, `enableAllProjectMcpServers`, `allowManagedMcpServersOnly`, `strictMcpConfig` (via flag), `extraKnownMarketplaces`, `strictKnownMarketplaces`, `blockedMarketplaces`, `disableCommandPluginSources`, `enabledPlugins`, `pluginConfigs`, `pluginSuggestionMarketplaces`, `pluginTrustMessage`, `disableBundledSkills`, `skillOverrides`, `skillListingBudgetFraction`, `skillListingMaxDescChars`, `syncClaudeAiSkills`, `syncClaudeAiPlugins`, `disableSkillShellExecution`, `strictPluginOnlyCustomization` (+`.agents`, `.hooks`, `.mcp`, `.skills`), `disableSideloadFlags`, `disableWorkflows`, `enableWorkflows`, `workflowKeywordTriggerEnabled`, `workflowSizeGuideline`, `ultracode`.

**Memory / CLAUDE.md**
`claudeMd`, `claudeMdExcludes`, `autoMemoryEnabled`, `autoMemoryDirectory`, `cleanupPeriodDays`, `desktopSessionCleanupPeriodDays`.

**Authentication / network**
`apiKeyHelper`, `forceLoginMethod`, `forceLoginOrgUUID`, `forceLoginGatewayUrl`, `gatewayInternalNetworks`, `awsAuthRefresh`, `awsCredentialExport`, `gcpAuthRefresh`, `otelHeadersHelper`, `disableClaudeAiConnectors`, `policyHelper` (+`.path`, `.refreshIntervalMs`, `.timeoutMs`), `parentSettingsBehavior`, `managedSourcesBehavior`, `wslInheritsWindowsSettings`.

**UI / terminal experience**
`theme`, `editorMode`, `spellcheck`, `viewMode`, `verbose`, `tui`, `axScreenReader`, `spinnerTipsEnabled`, `spinnerTipsOverride`, `spinnerVerbs`, `showThinkingSummaries`, `showTurnDuration`, `showClearContextOnPlanAccept`, `maxProseWidth`, `prefersReducedMotion`, `syntaxHighlightingDisabled`, `terminalProgressBarEnabled`, `terminalTitleFromRename`, `timeFormat`, `timeZone`, `footerLinksRegexes`, `promptSuggestionEnabled`, `emojiCompletionEnabled`, `copyOnSelect`, `copyFullResponse` (global config), `diffTool` (global config), `autoConnectIde` (global config), `autoInstallIdeExtension` (global config), `defaultToAgentsView` (global config), `leftArrowOpensAgents` (global config), `externalEditorContext` (global config), `keybindingFlavor` (deprecated), `vimInsertModeRemaps`, `wheelScrollAccelerationEnabled`, `autoScrollEnabled`, `prStatusFooterEnabled` (global config), `prUrlTemplate`.

**Session / workflow**
`agent`, `agentPushNotifEnabled`, `inputNeededNotifEnabled`, `preferredNotifChannel`, `awaySummaryEnabled`, `autoContinueAtUsageLimit`, `askUserQuestionTimeout`, `dialogExpiry`, `fileCheckpointingEnabled`, `plansDirectory`, `respondToBashCommands`, `respectGitignore`, `fileSuggestion`, `bashOutputMaxChars`, `bashEditDiffEnabled`, `defaultShell`, `crossSessionInbound`, `isolatePeerMachines`, `remoteControlAtStartup`, `disableRemoteControl`, `teammateMode`, `remote.defaultEnvironmentId`, `worktree` (+`.baseRef`, `.bgIsolation`, `.sparsePaths`, `.symlinkDirectories`), `voice`, `voiceEnabled`, `feedbackDrafts`, `feedbackSurveyRate`, `disableAgentView`, `disableDesktopLocalSessions` (managed), `disableMobileSimulatorTools` (managed), `browserExternalPageTools` (managed), `disableBrowserExternalNavigation` (managed), `channelsEnabled` (managed), `allowedChannelPlugins` (managed), `sshConfigs`, `sshHostAllowlist` (managed).

**Autocompact / prompt cache / output**
`autoCompactEnabled`, `autoCompactWindow`, `promptCacheTtl`, `subagentPromptCacheTtl`, `subagentStatusLine`, `statusLine`, `outputStyle`, `alwaysThinkingEnabled`, `fastMode`, `fastModePerSessionOptIn`.

**Attribution / git / versions**
`attribution` (+`.commit`, `.pr`, `.sessionUrl`), `includeCoAuthoredBy` (deprecated), `includeGitInstructions`, `minimumVersion`, `requiredMinimumVersion` (managed), `requiredMaximumVersion` (managed), `autoUpdatesChannel`, `forceRemoteSettingsRefresh` (managed), `companyAnnouncements`.

**Env and generic**
`env`, `language`, `disableAutoMode`, `autoMode` (+`.classifyAllShell`), `skipAutoPermissionPrompt`, `useAutoModeDuringPlan`, `processWrapper`, `taskOutputMaxChars` (removed v2.1.277), `teammateDefaultModel` (removed v2.1.234), `permissionExplainerEnabled` (removed v2.1.257), `disableArtifact` (deprecated → `enableArtifact`), `enableArtifact`, `claudeInChromeDefaultEnabled` (global config), `disableDeepLinkRegistration`.

### 3.3 Settings file scopes [DOC]

| File | Who touches it | Typical use |
|---|---|---|
| `~/.claude/settings.json` | You, in every project | Personal preferences |
| `.claude/settings.json` | Everyone in the project (via VCS) | Team permissions/hooks/plugins/env |
| `.claude/settings.local.json` | You, only in this project (auto-gitignored) | Personal overrides, not committed |
| `managed-settings.json` / MDM / server-managed | The whole organization | Security/compliance policy |
| `~/.claude.json` | Written by Claude Code itself | Login, MCP config, project state, global config keys |

A change to `permissions`, `hooks`, a credential helper is applied "hot" without a restart; some keys (e.g. `model`, `effortLevel`) require `/model`/`/effort` for a clean runtime change.

---

## 4. Environment variables

Exhaustive list collected from `env-vars` [DOC] (verbatim names). Grouped by prefix.

### 4.1 Authentication / provider (`ANTHROPIC_*`)
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_AWS_BASE_URL`, `ANTHROPIC_AWS_WORKSPACE_ID`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`, `ANTHROPIC_BEDROCK_REGION_PREFIX`, `ANTHROPIC_BEDROCK_SERVICE_TIER`, `ANTHROPIC_BETAS`, `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_CUSTOM_MODEL_OPTION[_DESCRIPTION/_NAME/_SUPPORTED_CAPABILITIES]`, `ANTHROPIC_DEFAULT_FABLE_MODEL[_DESCRIPTION/_NAME/_SUPPORTED_CAPABILITIES]`, `ANTHROPIC_DEFAULT_HAIKU_MODEL[...]`, `ANTHROPIC_DEFAULT_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL[...]`, `ANTHROPIC_DEFAULT_SONNET_MODEL[...]`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_MODEL`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_PROFILE`, `ANTHROPIC_SMALL_FAST_MODEL` (deprecated), `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_VERTEX_PROJECT_ID`, `ANTHROPIC_WORKSPACE_ID`.

### 4.2 Generic API/network
`API_FORCE_IDLE_TIMEOUT`, `API_TIMEOUT_MS`, `AWS_BEARER_TOKEN_BEDROCK`, `BETA_TRACING_ENDPOINT`.

### 4.3 Bash/PowerShell
`BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_OUTPUT_LENGTH`, `BASH_MAX_TIMEOUT_MS`, `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`, `CLAUDE_CODE_BASH_EDIT_DIFF`, `CLAUDE_CODE_USE_POWERSHELL_TOOL`, `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY`, `CLAUDE_CODE_DISABLE_POWERSHELL_CMD_RM_DENY`, `CLAUDE_CODE_DISABLE_WINDOWS_SHELL_LAUNCHER`, `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_SHELL`, `CLAUDE_CODE_SHELL_PREFIX`, `CLAUDE_CODE_TOOL_MEMORY_LIMIT` **[UNCERTAIN exact variant name]**, `CLAUDE_CODE_TOOL_MEMORY_CGROUP_EXCLUDE`.

### 4.4 `CLAUDECODE`/`CLAUDE_CODE_*` — general behavior (large list, verbatim)
`CLAUDECODE`, `CLAUDE_AFK_COUNTDOWN_MS`, `CLAUDE_AFK_TIMEOUT_MS`, `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS`, `CLAUDE_AGENT_SDK_MCP_NO_PREFIX`, `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, `CLAUDE_AUTO_BACKGROUND_TASKS`, `CLAUDE_AX_PREPARK_MS`, `CLAUDE_AX_SCREEN_READER`, `CLAUDE_AX_STARTUP_QUIET_MS`, `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS`, `CLAUDE_CLIENT_PRESENCE_FILE`, `CLAUDE_CODE_ACCESSIBILITY`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT`, `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`, `CLAUDE_CODE_ARTIFACT_AUTO_OPEN`, `CLAUDE_CODE_ARTIFACT_COMMENTS`, `CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT`, `CLAUDE_CODE_ATTRIBUTION_HEADER`, `CLAUDE_CODE_AUTO_BACKGROUND_WORKER_CHECKIN_SECONDS`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_CODE_AUTO_CONNECT_IDE`, `CLAUDE_CODE_AUTO_MODE_SERVER`, `CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS`, `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE`, `CLAUDE_CODE_CERT_STORE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE`, `CLAUDE_CODE_CONNECT_TIMEOUT_MS` (removed v2.1.186), `CLAUDE_CODE_DEBUG_LOGS_DIR`, `CLAUDE_CODE_DEBUG_LOG_LEVEL`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`, `CLAUDE_CODE_DISABLE_ADMIN_ENV_UNION`, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, `CLAUDE_CODE_DISABLE_AGENT_VIEW`, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `CLAUDE_CODE_DISABLE_ARTIFACT`, `CLAUDE_CODE_DISABLE_ATTACHMENTS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, `CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT`, `CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD`, `CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF`, `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`, `CLAUDE_CODE_DISABLE_CFC_PROMPT`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_CRON`, `CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS`, `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS`, `CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP`, `CLAUDE_CODE_DISABLE_MOUSE`, `CLAUDE_CODE_DISABLE_MOUSE_CLICKS`, `CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`, `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK`, `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`, `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS`, `CLAUDE_CODE_DISABLE_POLICY_SKILLS`, `CLAUDE_CODE_DISABLE_SUBSTITUTION_RM_PROMPT`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, `CLAUDE_CODE_DISABLE_THINKING`, `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT`, `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`, `CLAUDE_CODE_DISABLE_WORKFLOWS`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_ENABLE_AUTO_MODE` (compat, no effect), `CLAUDE_CODE_ENABLE_AWAY_SUMMARY`, `CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH`, `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL`, `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` (removed v2.1.142), `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION`, `CLAUDE_CODE_ENABLE_TASKS`, `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`, `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_EXTRA_BODY`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`, `CLAUDE_CODE_FORCE_STRIKETHROUGH`, `CLAUDE_CODE_FORCE_SYNC_OUTPUT`, `CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`, `CLAUDE_CODE_GATEWAY_HINT_HEADERS`, `CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS`, `CLAUDE_CODE_GLOB_HIDDEN`, `CLAUDE_CODE_GLOB_NO_IGNORE`, `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS`, `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, `CLAUDE_CODE_HIDE_CWD`, `CLAUDE_CODE_IDE_HOST_OVERRIDE`, `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL`, `CLAUDE_CODE_IDE_SKIP_VALID_CHECK`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_RETRIES`, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` (removed v2.1.224), `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`, `CLAUDE_CODE_MAX_TURNS`, `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, `CLAUDE_CODE_MCP_ALLOWLIST_ENV`, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`, `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_NATIVE_CURSOR`, `CLAUDE_CODE_NEW_INIT`, `CLAUDE_CODE_NONBLOCKING_STDOUT`, `CLAUDE_CODE_NO_FLICKER`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_OAUTH_SCOPES`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` (removed v2.1.160), `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`, `CLAUDE_CODE_OTEL_DIAG_STDERR`, `CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS`, `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS`, `CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS`, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE`, `CLAUDE_CODE_PERFORCE_MODE`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`, `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE`, `CLAUDE_CODE_PLUGIN_PREFER_HTTPS`, `CLAUDE_CODE_PLUGIN_SEED_DIR`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, `CLAUDE_CODE_PROCESS_WRAPPER`, `CLAUDE_CODE_PROJECT_DIR_NAME`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_PROPAGATE_TRACEPARENT`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, `CLAUDE_CODE_PROXY_RESOLVES_HOSTS`, `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDE_CODE_RESTRICTED`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS`, `CLAUDE_CODE_RESUME_PROMPT`, `CLAUDE_CODE_RETRY_WATCHDOG`, `CLAUDE_CODE_SAFE_MODE`, `CLAUDE_CODE_SCRIPT_CAPS`, `CLAUDE_CODE_SCROLL_SPEED`, `CLAUDE_CODE_SEND_FEEDBACK`, `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_SIMPLE` (set by `--bare`), `CLAUDE_CODE_SKIP_CLEAR_LOCK`, `CLAUDE_CODE_STATUS_LINE_COMPLETION_MIN_CHARS`, `CLAUDE_CODE_STREAM_FIRST_BYTE_TIMEOUT_MS`, `CLAUDE_CODE_STREAM_IDLE_TIMEOUT_MS`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`, `CLAUDE_CODE_SYNC_SKILLS`, `CLAUDE_CODE_TASK_CREATE_TAGS`, `CLAUDE_CODE_TLS_NO_VALIDATE_CERT`, `CLAUDE_CODE_TMUX_TRUECOLOR`, `CLAUDE_CODE_TOOLTIP_ENABLED`, `CLAUDE_CODE_URL_HANDLER_TIMEOUT_MS`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_VERSION`, `CLAUDE_CODE_WEB_CONTAINER_PORT`, `CLAUDE_CODE_WRITE_TIMEOUT_MS`, `CLAUDE_CODE_WRITEABLE_SKIP_LOCK_CHECK`, `CLAUDE_DISABLE_ADOPT`, `CLAUDE_STREAM_IDLE_TIMEOUT_MS`, `CLAUDE_ENV_FILE`, `CLAUDE_CONFIG_DIR`, `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX`.

### 4.5 Generic / third-party
`CONTINUE_RETRY_REASONING`, `DEBUG`, `DISABLE_DOCTOR_COMMAND`, `DISABLE_ERROR_REPORTING`, `DISABLE_FEEDBACK_COMMAND`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `ENABLE_PROMPT_CACHING_1H`, `ENABLE_TOOL_SEARCH`, `FALLBACK_FOR_ALL_PRIMARY_MODELS`, `FORCE_HYPERLINK`, `FORCE_PROMPT_CACHING_5M`, `IS_DEMO`, `MAX_MCP_OUTPUT_TOKENS`, `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `CCR_FORCE_BUNDLE`.

**Note on precedence**: environment variables are NOT a level in the settings precedence scale — precedence between a variable and the equivalent key is decided case by case (e.g. `ANTHROPIC_MODEL` always beats the `model` key of any file; `ANTHROPIC_DEFAULT_MODEL` applies only when no file sets `model`) [DOC].

---

## 5. Hooks

### 5.1 Available events [DOC — summary from WebFetch, the full "hooks" page was not found due to a network error on some later lookups; general structure also confirmed by cross-references in other pages (skills, worktrees, sessions)]

| Event | When it fires | Matcher | Can block |
|---|---|---|---|
| `SessionStart` | New session or resume | `startup`, `resume`, `clear`, `compact`, `fork` | No |
| `Setup` | `--init-only` or `-p --init`/`--maintenance` | `init`, `maintenance` | No |
| `SessionEnd` | End of session | `clear`, `resume`, `logout`, `prompt_input_exit`, `other` | No |
| `UserPromptSubmit` | User submits a prompt | — | Yes |
| `UserPromptExpansion` | Slash command/skill expansion | command/skill names | Yes |
| `Stop` | Claude finishes the response | — | Yes |
| `StopFailure` | Turn ends due to an API error | `rate_limit`, `overloaded`, `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown` | No |
| `PreToolUse` | Before every tool call | tool name (e.g. `Bash`, `mcp__.*__.*`) | Yes |
| `PermissionRequest` | Permission decision request | tool name | Partial |
| `PermissionDenied` | Auto mode denies a tool call | tool name | No |
| `PostToolUse` | After a successful tool call | tool name | No (but `additionalContext`) |
| `PostToolUseFailure` | After a failed tool call | tool name | No |
| `PostToolBatch` | After a batch of parallel tool calls | — | Yes |
| `SubagentStart` | Subagent started | agent type | No |
| `SubagentStop` | Subagent finishes | agent type | Yes |
| `TaskCreated` / `TaskCompleted` | Task creation/completion | — | Yes |
| `InstructionsLoaded` | Loading CLAUDE.md/.claude/rules | `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` | No |
| `ConfigChange` | Settings file changed at runtime | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` | Yes |
| `CwdChanged` | Working directory change | — | No |
| `DirectoryAdded` | Directory added via `/add-dir` | `slash_command`, `register_repo_root` | No |
| `FileChanged` | A monitored file changes on disk | literal file names | No |
| `PreCompact` / `PostCompact` | Before/after context compaction | `manual`, `auto` | Yes (Pre) |
| `PreModelSwitch` / `PostModelSwitch` | Before/after model switch | canonical model name | Yes (Pre) |
| `WorktreeCreate` / `WorktreeRemove` | Worktree creation/removal | — | Yes |
| `Notification` | Claude Code notification | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_*`, `agent_*`, `quota_*` | No |
| `MessageDisplay` | Display of assistant text | — | No |
| `TeammateIdle` | Agent team teammate idle | — | Yes |
| `Elicitation` / `ElicitationResult` | An MCP server requests user input | MCP server name | Yes |

### 5.2 Configuration schema [PARTIALLY UNCERTAIN — general structure confirmed, exact fields to be verified against the official hooks.md doc]

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "pattern",
        "hooks": [
          {
            "type": "command|http|mcp_tool|prompt|agent",
            "if": "ToolName(arg_pattern)",
            "timeout": 600,
            "command": "script.sh", "args": [], "async": false, "shell": "bash|powershell",
            "url": "http://...", "headers": {}, "allowedEnvVars": [],
            "server": "...", "tool": "...", "input": {},
            "prompt": "...", "model": "..."
          }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```

Input fields common to every hook (JSON on stdin): `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort.level`, `hook_event_name`, `agent_id`, `agent_type`.

Main output decision patterns: generic `decision: "block"/"allow"`; for `PreToolUse` → `hookSpecificOutput.permissionDecision` (`allow`/`deny`/`ask`/`defer`) + `permissionDecisionReason` + `updatedInput` + `additionalContext`; for `PermissionRequest` → `hookSpecificOutput.decision.behavior`; for `SessionStart` → `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`. Exit code 2 = forced block (takes precedence over JSON output); other non-zero exit codes = non-blocking error.

### 5.3 Hook configuration scope [DOC]

Hooks can be defined in: `~/.claude/settings.json` (user), `.claude/settings.json` (project), `.claude/settings.local.json` (project local), managed settings, plugins (`hooks/hooks.json`), skill/subagent frontmatter (`hooks` field, scoped to their execution). They merge across levels, they do not overwrite each other; `disableAllHooks: true` disables those at your own settings level (not the managed ones).

---

## 6. Permission modes and rules

### 6.1 Modes [DOC]

| Mode (config value) | What runs without asking | Notes |
|---|---|---|
| `default` (UI label: **Manual**) | Reads only | CLI alias `manual` accepted (v2.1.200+) |
| `acceptEdits` | Reads, file edits, common filesystem commands (`mkdir`, `touch`, `mv`, `cp`) | — |
| `plan` | Reads, + commands approved by the classifier if auto mode is available | Blocks edits until a plan is approved (`ExitPlanMode`) |
| `auto` | Everything, with background safety checks from a classifier (a second model) | Default starting mode in terminal/VS Code from v2.1.283 (before: Pro/Max/Team plans only) |
| `dontAsk` | Reads + pre-approved tools; everything else is denied (not prompted) | For CI/script lock-down |
| `bypassPermissions` | Everything | Isolated containers/VMs only; requires explicit activation (flag or setting), not in the default cycle |

Actions **never** auto-approved in any mode (including `bypassPermissions`): explicit `ask` rules, tools with `requiresUserInteraction` (incl. `AskUserQuestion`), `rm`/`rmdir` removals on critical paths, cross-session messaging safeguards, reads outside the working directory with `permissions.blockReadsOutsideWorkingDirectories` active.

Shift+Tab cycle (default): `default` → `acceptEdits` → `plan` → back to `default`; `bypassPermissions` and `auto` are added to the cycle only if explicitly enabled; `dontAsk` is never in the cycle (flag only).

### 6.2 Permission rule syntax [DOC]

General format: `ToolName(specifier)` used in `permissions.allow/ask/deny`, `--allowedTools/--disallowedTools`, SDK options, the skill frontmatter's `allowed-tools`, hooks' `if` condition.

| Rule format | Applies to | Example |
|---|---|---|
| `Bash(cmd *)` | Bash, Monitor | `Bash(git log *)` — prefix match (the space before `*` matters) |
| `PowerShell(cmd *)` | PowerShell | `PowerShell(Get-ChildItem *)` |
| `Read(path/**)` | Read, Grep, Glob, LSP | `Read(~/secrets/**)` |
| `Edit(path/**)` | Edit, Write, NotebookEdit | `Edit(/src/**)` |
| `Skill(name *)` | Skill | `Skill(deploy *)` |
| `Agent(Type)` | Agent | `Agent(Explore)` |
| `WebFetch(domain:example.com)` | WebFetch | — |
| `WebSearch` | WebSearch | no specifier, on/off |

An `Edit(...)` allow also grants implicit read access on the same path; a `Read(...)` deny also blocks Edit/Write on the same path.

---

## 7. Extensions and infrastructure

### 7.1 Memory (hierarchical CLAUDE.md) [DOC]

Loading order (from most general to most specific, concatenated not overwritten):
1. Managed policy CLAUDE.md (`/Library/Application Support/ClaudeCode/CLAUDE.md` macOS, `/etc/claude-code/CLAUDE.md` Linux/WSL, `C:\Program Files\ClaudeCode\CLAUDE.md` Windows) — also via the `claudeMd` key in managed settings
2. `~/.claude/CLAUDE.md` (user)
3. `./CLAUDE.md` or `./.claude/CLAUDE.md` (project, every directory from the filesystem root down to the working directory)
4. `./CLAUDE.local.md` (local, personal, per-project, auto-gitignored)

Import syntax: `@path/to/file.md` (relative to the importing file's directory, or absolute); maximum depth of 4 recursive hops; external imports (outside the working directory) require approval the first time. `.claude/rules/*.md` organizes modular instructions, with `paths: [...]` frontmatter for scoping to specific glob patterns (loaded only when Claude reads matching files). `AGENTS.md` is read as an alternative/complement (v2.1.277+), controllable with the `instructionFiles` setting of the `agents-md@builtin` plugin (`claude-md-or-agents-md` default, `claude-md-and-agents-md`, `claude-md`, `managed-only`).

**Auto memory**: files written autonomously by Claude in `~/.claude/projects/<project>/memory/` (index `MEMORY.md`, max 200 lines/25KB loaded every session + topic files loaded on-demand); 4 types: `user`, `feedback`, `project`, `reference`. Enabled/disabled with `autoMemoryEnabled` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

### 7.2 Subagents [DOC]

Markdown files with YAML frontmatter in `.claude/agents/` (project), `~/.claude/agents/` (user), managed settings (org), plugins (`agents/`), or via the `--agents` flag (JSON). Frontmatter fields: `name` (required), `description` (recommended-required), `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`fable`/full ID/`inherit`), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory` (`user`/`project`/`local`), `background`, `omitClaudeMd`, `effort`, `isolation` (`worktree`), `color`, `initialPrompt`, `experimental.cacheTtl`. The Markdown body = the subagent's system prompt (entirely replaces Claude Code's, does not extend it). Validation: `claude plugin validate .claude/agents`.

### 7.3 Skills [DOC]

`SKILL.md` with YAML frontmatter + Markdown body. Paths: enterprise (managed dir), `~/.claude/skills/<name>/` (personal), `.claude/skills/<name>/` (project, including nested), additional directories (`--add-dir`), plugins (`skills/<name>/`), claude.ai account (sync). Main fields: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork` (runs in a subagent), `agent`, `background`, `hooks`, `paths` (glob scoping), `shell` (`bash`/`powershell`), `metadata`, `license`, `compatibility`. Available substitutions: `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N`, `$name` (named args), `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`. Dynamic context injection: `` !`command` `` (runs the shell and substitutes the output) or a ` ```! ` block. Legacy commands in `.claude/commands/*.md` remain supported (same frontmatter minus `name`/`paths`).

### 7.4 Plugins and marketplaces [DOC]

A plugin = a directory with a `.claude-plugin/plugin.json` manifest + components (skills, agents, hooks, MCP servers, output styles). A marketplace = a repo/dir with a `.claude-plugin/marketplace.json` that lists plugins and their sources. Installation scope: `user` (every project on the machine), `project` (via a committed `.claude/settings.json`, every collaborator still installs locally), `local` (just you, this project). Commands: `claude plugin marketplace add/list/remove/update`, `claude plugin install/uninstall/enable/disable/list/details/validate/init/tag/eval/update/prune`. Inside a session: `/plugin`.

### 7.5 Output styles [DOC]

Markdown files in `~/.claude/output-styles` (user), `.claude/output-styles` (project, every nesting level up to the root), the managed policy dir, or provided by plugins (`output-styles/`). Frontmatter: `name`, `description`, `keep-coding-instructions` (bool, keeps the default software engineering instructions), `force-for-plugin` (bool, applied automatically when the plugin is enabled). 4 built-in styles: Proactive, Concise, Explanatory, Learning (+ Default = no style). Activation: `/output-style <name>`, `/config`, or the `outputStyle` key in settings.json (case-sensitive for built-in names).

### 7.6 Status line [DOC]

A custom (shell) command that receives JSON on stdin and prints text for the status row. Configuration: `/statusline`, or the `statusLine` key in settings.json. Main input JSON fields (exhaustive list collected): `model.id`, `model.display_name`, `cwd`, `workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs`, `workspace.git_worktree`, `workspace.repo.host/owner/name`, `cost.total_cost_usd`, `cost.total_duration_ms`, `cost.total_api_duration_ms`, `cost.total_lines_added/removed`, `context_window.total_input_tokens/total_output_tokens`, `context_window.context_window_size`, `context_window.used_percentage`, `context_window.remaining_percentage`, `context_window.current_usage`, `exceeds_200k_tokens`, `fast_mode`, `effort.level`, `thinking.enabled`, `rate_limits.five_hour.used_percentage/resets_at`, `rate_limits.seven_day.used_percentage/resets_at`, `rate_limits.spend_limit.used_percentage/resets_at`, `prompt_cache.*` (warm, caching_observed, ttl, expires_at, requests, misses, expected_rebuilds, hit_ratio, cache_write_tokens, miss_recache_tokens, last_miss_at, last_miss_cause, miss_causes, recache_tokens_if_cold), `session_id`, `session_name`, `prompt_id`, `transcript_path`, `version`, `output_style.name`, `vim.mode`, `agent.name`, `pr.number/url/review_state/kind`, `worktree.name/path/branch/original_cwd/original_branch`.

### 7.7 MCP (Model Context Protocol) [DOC]

**Scope**: `local` (default, `~/.claude.json`, current project only, not shared), `project` (`.mcp.json` at the root, shared via git, requires per-project approval), `user` (`~/.claude.json`, all projects). Precedence in case of the same name: local > project > user > plugin-provided > claude.ai connectors.

**Transports**: `stdio` (local process, `command`+`args`+`env`), `http`/`streamable-http` (recommended), `sse` (deprecated, automatic fallback from http), `ws`/websocket (JSON config only, no OAuth, header auth only).

**OAuth**: standard flow via `/mcp` → Authenticate; pre-configured credentials with `--client-id`/`--client-secret`/`--callback-port`; from the CLI: `claude mcp login <name> [--no-browser]` / `claude mcp logout <name>`. Custom metadata discovery and restricted OAuth scopes configurable in `.mcp.json` (`oauth.authServerMetadataUrl`, `oauth.scopes`).

**Custom authentication**: `headersHelper` (a script that returns a JSON of headers, for Kerberos/internal SSO/short-lived tokens).

**Resources and prompts**: MCP servers can expose `prompts/list` (invokable as commands, excluding "MCP Apps UI" resources) and `resources/list` (read with `ReadMcpResourceTool`, listed with `ListMcpResourcesTool`); `list_changed` notifications for dynamic updates.

**Limits**: `MAX_MCP_OUTPUT_TOKENS` (default 25000), `MCP_TIMEOUT` (startup, default ~30s in `-p`), `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (default 5 min HTTP / 30 min stdio), `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (default 120000, automatic backgrounding of long calls). Plugin-provided tool names: `mcp__plugin_<plugin>_<server>__<tool>`.

**Managed**: `managedMcpServers` in managed settings has the highest precedence over every scope.

### 7.8 Checkpoint / rewind [DOC]

Automatic capture of file state before every prompt that starts a turn (up to the 100 most recent checkpoints per session, saved with the conversation, survive resume). `/rewind` (or double `Esc` on an empty prompt) opens the menu: **Restore code and conversation**, **Restore conversation**, **Restore code**, **Summarize from here**, **Summarize up to here**. Limitations: does not track changes made by Bash commands (`rm`, `mv`, `cp`), does not restore subagent edits run in the background, does not track changes external to the session, does not restore symlink/hard-link paths, is not a substitute for version control. Can be disabled with `fileCheckpointingEnabled: false` or `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING=1`.

### 7.9 Sessions: where they are saved [DOC]

JSONL transcript: `~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` = the working directory with non-alphanumeric characters replaced by `-` (truncated to 200 chars + hash if longer). Each line = a JSON object (message/tool use/metadata); the internal format is not stable across versions (for scripting, prefer `/export` or structured interfaces like `--output-format json`). Configurable: `CLAUDE_CONFIG_DIR` (moves the storage root), `CLAUDE_CODE_PROJECT_DIR_NAME` (custom project folder name), `cleanupPeriodDays` (retention, default ~30 days), `CLAUDE_CODE_SKIP_PROMPT_HISTORY` / `--no-session-persistence` (does not save). Resume: `--continue`, `--resume [id|name|path.jsonl]`, `--from-pr`, `/resume`, `/branch` (creates a copy + new session ID), `--fork-session`.

### 7.10 Sandbox [DOC]

Built-in Bash filesystem+network isolation, on macOS (Seatbelt) and Linux/WSL2 (bubblewrap + seccomp); native Windows is not supported (WSL2 required). Configuration via `/sandbox` (Mode, Filesystem, Network, Dependencies tabs) or `sandbox.*` keys in settings. Configurable sandbox command approval modes; `sandbox.filesystem.allowRead/allowWrite/denyRead/denyWrite`, `sandbox.network.allowedDomains/deniedDomains/strictAllowlist`. `sandbox.failIfUnavailable` to refuse startup if the sandbox is unavailable instead of running without it.

### 7.11 Built-in tools available to the model [DOC]

| Tool | Description | Permission required |
|---|---|---|
| `Agent` | Spawns a subagent with its own context window (or a teammate with agent teams) | No |
| `Artifact` | Publishes an HTML/Markdown page on claude.ai | Yes |
| `AskUserQuestion` | Multiple-choice questions to the user | No |
| `Bash` | Executes shell commands | Yes (but a built-in read-only set without a prompt) |
| `CronCreate`/`CronDelete`/`CronList` | Scheduled tasks within the session | No |
| `Edit` | Targeted file edits (exact string replacement) | Yes |
| `EndConversation` | Ends the session (extreme cases only) | No (cannot be disabled if other tools remain) |
| `EnterPlanMode` / `ExitPlanMode` | Enters/exits plan mode | No / Yes |
| `EnterWorktree` / `ExitWorktree` | Enters/exits an isolated git worktree | Yes / No |
| `Glob` | Searches files by pattern | No (absent by default on macOS/Linux/WSL) |
| `Grep` | Searches content (ripgrep) | No (absent by default on macOS/Linux/WSL) |
| `ListAgents` | Lists agents reachable for messaging | No |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | Lists/reads MCP resources | No |
| `LSP` | Code intelligence (definitions, references, types) | No |
| `Monitor` | Runs a command/websocket in the background and reacts to its output | Yes |
| `NotebookEdit` | Edits Jupyter cells | Yes |
| `PowerShell` | Executes native PowerShell commands | Yes |
| `PushNotification` | Desktop/mobile notification | No |
| `Read` | Reads file content (+images, PDFs, notebooks) | No |
| `RemoteTrigger` | Manages Routines on claude.ai | No |
| `ReportFindings` | Reports structured code review findings | No |
| `ScheduleWakeup` | Reschedules a self-paced `/loop` iteration | No |
| `SendFeedback` | Drafts feedback on Claude Code | No |
| `SendMessage` | Message to another agent/session | No |
| `SendUserFile` | Sends a file to the user (Remote Control/cloud) | No |
| `ShareOnboardingGuide` | Uploads ONBOARDING.md and returns a link | Yes |
| `Skill` | Runs a skill in the main conversation | Yes |
| `SubagentHandback` | Delivers the subagent's final report (auto mode only) | No |
| `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`/`TaskOutput`/`TaskStop` | Task tracking management (or background tasks) | No |
| `TodoWrite` | Legacy task checklist (disabled by default in favor of Task*) | No |
| `ToolSearch` | Searches/loads deferred tools (MCP tool search) | No |
| `WaitForMcpServers` | Waits for MCP servers still connecting | No |
| `WebFetch` | Fetches content from a URL | Yes |
| `WebSearch` | Web search | Yes |
| `Workflow` | Runs a dynamic workflow (orchestration of multiple subagents) | Yes |
| `Write` | Creates/overwrites files | Yes |

Glob/Grep are absent by default on macOS/Linux/WSL (Claude uses `find`/`grep` via Bash); they become available again if explicitly named in `--tools`/`--allowedTools`, if Bash is removed, or if a subagent lists them explicitly.

---

## 8. Recent / remote features

### 8.1 Background tasks / Agent view [DOC]

`claude --bg "task"` starts a background session and returns immediately, printing an ID; `claude agents` opens the agent view (list, dispatch, monitoring of parallel sessions, also via `--json` for scripting); shell management: `claude attach <id>`, `claude logs <id>`, `claude stop|kill <id>`, `claude rm <id>` (with `--discard-unpushed`/`--force-remove-worktree`), `claude respawn <id>|--all`. Background sessions use a git worktree for file isolation; a supervisor process keeps them alive even with the interface closed (idle timeout ~1h). From an interactive session: `/bg`, `/background`, the left arrow on an empty prompt, `/fork`.

### 8.2 Remote/cloud sessions [DOC]

`--cloud [description|session_id|url]` creates/attaches a cloud session (claude.ai/code), run on remote infrastructure rather than the local machine; `--environment <ccpool_id>` runs it on a self-hosted environment. `--teleport [session]` brings a cloud session back into the local terminal.

### 8.3 Remote Control [DOC]

`--remote-control [name]` / `--rc`: starts an interactive session with control enabled from claude.ai/code or the mobile app (iOS/Android), keeping execution/filesystem local. Synchronizes the conversation and subagent/workflow progress across all connected devices; supports sending images/files from phone/browser; automatic reconnection after network/laptop suspension. `remoteControlAtStartup` in settings for automatic connection. Limitations: only built-in output styles are selectable remotely **[UNCERTAIN on the exhaustive list of limitations, page truncated]**.

### 8.4 Worktree [DOC]

`-w`/`--worktree [name]`: creates an isolated git worktree at `<repo>/.claude/worktrees/<name>/` on a new `worktree-<name>` branch; supports branching from a PR/MR (`#number`, GitHub/GitLab URL). Claude can create/enter a worktree at runtime with the `EnterWorktree`/`ExitWorktree` tool. `.worktreeinclude` copies gitignored files (e.g. `.env`) into every new worktree. Automatic cleanup on exit if clean; periodic sweep for subagent/background session worktrees. Configurable: `worktree.baseRef` (`fresh`/`head`), `WorktreeCreate`/`WorktreeRemove` hooks for non-git VCS.

### 8.5 IDE integration [DOC — not investigated in depth in this session, cross-references only]

`--ide`: automatic connection to an IDE if exactly one is available. Dedicated extensions for VS Code and JetBrains (mentioned but not surveyed in detail: `/docs/en/vs-code`, `/docs/en/jetbrains`). **[UNCERTAIN]** — pages not directly consulted in this session.

### 8.6 Claude in Chrome [DOC — not investigated in depth]

`--chrome`/`--no-chrome`: enables/disables Chrome integration for browser automation (`mcp__claude-in-chrome__*` tools, deferred, to be loaded via ToolSearch). `claudeInChromeDefaultEnabled` setting. **[UNCERTAIN]** — the `/docs/en/chrome` page was not directly consulted in this session, details inferred from the current environment's system prompt.

---

## Sources

**Local (verified by running the commands on this machine, Claude Code 2.1.280, Windows)**:
- `claude --version`, `claude --help`
- `claude agents|auth|auto-mode|doctor|gateway|import|install|mcp|plugin|project|respawn|setup-token|ultrareview|update|attach|logs|rm|stop --help` and their sub-subcommands (`mcp add/add-json/add-from-claude-desktop/get/remove/login/serve`, `plugin marketplace/install/uninstall/list/enable/disable/details/validate/init/tag/eval/update/prune`, `auth login/logout/status`, `auto-mode config/critique/reset/defaults`, `project purge`)
- `claude config --help` (verified that the subcommand does not exist)

**Official documentation (code.claude.com/docs/en/, web fetch in this session)**:
- `/cli-reference`, `/settings`, `/settings-reference` (partial/truncated), `/hooks` (summary from fetch, not the full raw page), `/mcp`, `/sub-agents`, `/plugins/overview`, `/skills`, `/memory`, `/iam` → resolved to `/authentication` (redirect), `/permission-modes`, `/sandboxing`, `/headless`, `/agent-sdk/overview`, `/output-styles`, `/env-vars`, `/tools-reference`, `/sessions`, `/checkpointing`, `/statusline`, `/agent-view`, `/worktrees`, `/remote-control`

**Not reached due to a network error (ENOTFOUND) during the session**, therefore not directly verified: `/agent-sdk/typescript` (detailed schema of SDK messages/control protocol), `/settings-reference` (fetch succeeded only on the second attempt, table marked as partially incomplete by the source itself), the raw GitHub changelog was not consulted.

## Count per section

1. CLI commands and flags: ~68 global flags + 5 system-prompt flags + 18 top-level subcommands (of which 2 with help not found locally: `daemon`, `remote-control`, `self-hosted-runner` — documented but not present in the v2.1.280 help) + 10 `mcp` sub-subcommands + 12 `plugin` sub-subcommands
2. Headless/Agent SDK: 3 output formats, ~9 stream-json event types, 6 distinctive SDK features
3. Settings: 5 precedence levels + ~230 keys listed (source declares 433 total, not all extracted)
4. Environment variables: ~180 variables listed
5. Hooks: 27 events + configuration schema
6. Permissions: 6 modes + 8 rule formats
7. Extensions: memory (4 levels + auto memory), subagents (17 frontmatter fields), skills (~20 frontmatter fields), plugins/marketplaces (3 scopes), output styles (4 built-in + 4 frontmatter fields), statusline (~35 JSON fields), MCP (3 scopes × 4 transports), checkpoint (5 rewind actions), sessions (storage + resume), sandbox, built-in tools (~38 tools)
8. Recent features: 6 areas (background tasks, cloud/teleport, remote control, worktree, IDE, Chrome — the last 2 not investigated in depth)

## Uncertain points (summary)

- The SDK-side `control_request`/`control_response` protocol: not documented in detail publicly in this session (likely an internal mechanism not exposed as a stable API in the headless CLI).
- The exact hook JSON schema (per-event specific fields, e.g. `PreToolUse` for each tool) is drawn from a fetch summary, not from the full raw `/hooks` page — recommended to verify directly before implementing strict parsing.
- `settings-reference` key list: the source itself declares "433 keys" but the extraction in this session collected ~230 (grouped); very specific sub-keys may be missing.
- The `/agent-sdk/typescript`, `/chrome`, `/vs-code`, `/jetbrains` pages, GitHub changelog: not directly consulted (network errors or out of time scope), so sections 2.4 (SDK protocol detail) and 8.5/8.6 (IDE/Chrome) are less in-depth than the others.
- The `claude daemon`, `claude remote-control`, `claude self-hosted-runner` subcommands: documented on code.claude.com but not present in the installed v2.1.280's local help — possibly available only in more recent builds or behind a feature flag.


---

# Part D — SDK Protocol (from sdk.d.ts 0.3.285)


_Source: `@anthropic-ai/claude-agent-sdk` 0.3.285 (`claudeCodeVersion: 2.1.285`), file `sdk.d.ts` (9867 lines), `sdk-tools.d.ts`, runtime `sdk.mjs`. The "line" numbers refer to `sdk.d.ts`._
_Legend: **[V]** = verified in the file (with line number); **[R]** = verified only in the minified `sdk.mjs` runtime (no line number, untyped API = internal, unstable); **[D]** = inferred._

## 0. Key points
- The CLI binary bundled with the SDK is **2.1.285**, while the installed CLI is 2.1.280. The app's effective engine is therefore 2.1.285 **[V package.json]**.
- `Query`'s control methods work **only with streaming input**, i.e. with `prompt` as an `AsyncIterable<SDKUserMessage>` **[V 2833-2838]**.
- The prompt text passes through the CLI's **slash command dispatcher and `@path` expansion**, unless `client_composed: true` or `Options.verbatimPrompts` is used **[V 6209, 1864-1886]**.
- `system/init.capabilities` is used for feature detection (`interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `mcp_read_resource_v1`, ...) **[V 5912-5914]**.
- **V2 API (`unstable_v2_*`, session API): absent** in this version (null grep on `.d.ts` and `.mjs`) **[V]**.
- The `side_question` request (/btw) is cited in a comment **[V 4938]**, is missing from the typed union, and exists in the runtime as `askSideQuestion()` **[R]**.

## 1. Protocol envelope
| Type | Line | Direction | Notes |
|---|---|---|---|
| `control_request` `{request_id, request}` | 4924 | both | a request is matched by a response with the same `request_id` |
| `control_response` `{response: success\|error}` | 4975 (`ControlResponse` 402, `ControlErrorResponse` 378) | both | the response to `initialize` (≥2.1.268) also contains the pending `can_use_tool` / `request_user_dialog` (~388-418) |
| `control_cancel_request` `{request_id}` | 3873 | both | withdraws one's own request; no response is expected |
| `keep_alive` | 5206 | both | to be ignored |
| `system/control_request_progress` | 4940 | CLI→client | progress of long requests (currently only `side_question`) |
| `StdoutMessage` (channel union) | 9465 | CLI→client | = `SDKMessage` + `SDKActiveGoalMessage` + control_* + keep_alive |

## 2. Typed subtypes of `control_request` (39, union `SDKControlRequestInner` line 4935)
### 2.1 CLI → client (the SDK routes these to callbacks)
| subtype | Line | Purpose | Main payload | SDK side |
|---|---|---|---|---|
| `can_use_tool` | 4728 | permission request for a tool | `tool_name`, `input`, `permission_suggestions`, `blocked_path`, `decision_reason(_type)`, `classifier_approvable`, `suppress_always_allow_rule`, `default_to_no`, `matched_ask_rule`, `title`, `display_name`, `description`, `tool_use_id`, `agent_id`, `requires_user_interaction` | `Options.canUseTool` (type `CanUseTool` 213, result `PermissionResult` 2494) |
| `hook_callback` | 5133 | invokes a hook registered by the host | `callback_id`, `input: HookInput`, `tool_use_id` | `Options.hooks` 1723 |
| `elicitation` | 3884 | an MCP server asks the user for input | `mcp_server_name`, `message`, `mode: form\|url`, `url`, `elicitation_id`, `requested_schema`, `title`, `display_name`, `description` | `Options.onElicitation` 1744 (type 1478) |
| `request_user_dialog` | 4959 | a blocking dialog requested by a tool | `dialog_kind` (open union; the only known value is `refusal_fallback_prompt`), `payload`, `tool_use_id` | `Options.onUserDialog` 1758 + `supportedDialogKinds` 1780 (without declaring it the dialog is not emitted) |
| `mcp_message` | 4647 | JSON-RPC to/from an in-process MCP server (bidirectional) | `server_name`, `message` | automatic with `createSdkMcpServer` 608 |

### 2.2 client → CLI
| subtype | Line (response) | Purpose | Payload | Typed `Query` method |
|---|---|---|---|---|
| `initialize` | 4421 (4501) | handshake: hooks, SDK MCP servers, system prompt, agents, title, skills, dialog kinds, `perTaskStopAffordance`, plugins | see line | automatic; `initializationResult()` 2962, `reinitialize()` 2988 |
| `interrupt` | 4547 (4559) | interrupts the turn; `cancel_queued` also clears the queue | `cancel_queued?` | `interrupt()` 2847 (no parameters) |
| `set_permission_mode` | 5033 | changes the permission mode | `mode` | `setPermissionMode()` 2854 |
| `set_model` | 5021 | changes the model | `model` (`null`/`'default'` = reset) | `setModel()` 2883 |
| `set_max_thinking_tokens` | 5012 | thinking budget and display | `max_thinking_tokens`, `thinking_display` | `setMaxThinkingTokens()` 2910 (deprecated → `Options.thinking`) |
| `apply_flag_settings` | 3846 | merges into the session's "flag" layer | `settings` | `applyFlagSettings()` 2938 |
| `update_settings` | 5053 | writes to a file via the CLI's writer (allowlist: local→`outputStyle`, user→`effortLevel`) | `source`, `settings` | `updateSettings()` 2953 |
| `get_settings` | 4190 | effective settings + raw per source | — | ❌ (runtime `getSettings()` [R]) |
| `get_context_usage` | 3924 (3935) | context breakdown (= /context) | `detail: summary\|full` | `getContextUsage()` 3023 |
| `get_usage` | 4197 (4208) | /usage data: cost and plan rate limits | `skip_behaviors` | `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` 3043 |
| `get_session_cost` | 4183 | session cost | — | ❌ |
| `list_models` | 4573 | model catalog (remote thin client) | — | ❌ (`supportedModels()` 3000 [D: reads from the initialize]) |
| `get_binary_version` | 3917 | binary version (for remote /version) | — | ❌ (version in `init.claude_code_version` 5853) |
| `rename_session` | 4908 | live session title | `title`, `source`, `session_id` | ❌ (runtime `renameSession()` [R]; file-level function `renameSession()` 3244) |
| `set_color` | 5004 | accent color (= /color) | `color` | ❌ |
| `mcp_status` | 4712 | MCP server status | — | `mcpServerStatus()` 3012 (type `McpServerStatus` 1226) |
| `mcp_reconnect` | 4693 | reconnects a server | `serverName` | `reconnectMcpServer()` 3144 |
| `mcp_toggle` | 4719 | enables/disables a server | `serverName`, `enabled` | `toggleMcpServer()` 3152 |
| `mcp_set_servers` | 4701 | replaces the dynamic servers | `servers` | `setMcpServers()` 3194 (result 1295) |
| `mcp_call` | 4597 | calls an MCP tool without a model turn | `tool`, `arguments`, `timeout_ms`, `input_files`/`output_files` | ❌ |
| `mcp_read_resource` | 4659 (4674) | reads a `ui://` UI resource (MCP Apps) | `serverName`, `uri` | `readMcpResource()` 3165 (@alpha; untrusted HTML → sandbox) |
| `file_suggestions` | 3909 | `@` autocomplete like in the TUI | `query` | ❌ |
| `rewind_files` | 4986 (`RewindFilesResult` 3339) | restores files to a user message | `user_message_id`, `dry_run` | `rewindFiles()` 3116 (requires `enableFileCheckpointing` 1686) |
| `seed_read_state` | 4995 | reseeds the Read cache | `path`, `mtime` | `seedReadState()` 3129 |
| `read_file` | 4801 (4814) | reads a file with the Read tool's rules | `path`, `max_bytes`, `encoding` | `readFile()` 3064 |
| `cancel_async_message` | 3865 | removes a message from the queue | `message_uuid` | ❌ (runtime `cancelAsyncMessage()` [R]) |
| `register_repo_root` | 4827 | adds a working root (subfolder of cwd/add-dir) | `directory`, `reload_*` | ❌ |
| `reload_plugins` | 4852 (4863) | reloads plugins (= /reload-plugins) | `hold_on_cache_impact` | `reloadPlugins()` 3083 |
| `reload_skills` | 4894 (4901) | reloads skills | — | `reloadSkills()` 3091 |
| `reload_output_styles` | 4838 (4845) | reloads output styles | — | `reloadOutputStyles()` 3101 |
| `stop_task` | 5045 | stops a background task | `task_id` | `stopTask()` 3206 |
| `background_tasks` | 3854 | = Ctrl+B | `tool_use_id?` | `backgroundTasks()` 3221 |
| `get_hooks_listing` | 4034 (4041) | data for the /hooks panel | — | ❌ (runtime `getHooksListing()` [R]) |
| `list_permission_rules` | 4580 (4587, state 4781) | data for the /permissions panel (rules + source, working directory) | — | ❌ (runtime `listPermissionRules()` [R]) |

Note: `setMcpPermissionModeOverride()` 2871 is typed as a method, but its `set_mcp_permission_mode_override` subtype is not in the union [R].

## 3. Untyped subtypes found in the `sdk.mjs` runtime [R]
Methods present on `Query` at runtime but absent from `sdk.d.ts`. Their purpose is inferred from name and arguments **[D]**.

| Runtime method | subtype | Probable purpose / CLI equivalent |
|---|---|---|
| `askSideQuestion(q,{history})` | `side_question` | /btw |
| `setCwd(path,{trustAccepted,trustedDirectory})` | `set_cwd` | /cd + folder trust |
| `getStatus()` | `get_status` | /status panel |
| `getMemoryDialog()` | `get_memory_dialog` | /memory panel |
| `getSkillsDialog()` | `get_skills_dialog` | /skills panel |
| `getSandboxDialog()` | `get_sandbox_dialog` | /sandbox panel |
| `getChromeDialog()`, `getChromeBrowsers()`, `selectChromeBrowser()`, `setChromeBrowserHints()` | `get_chrome_dialog`, `get_chrome_browsers`, `select_chrome_browser`, `set_chrome_browser_hints` | /chrome |
| `getPlan()` | `get_plan` | plan content (plan mode) |
| `exportConversation()` | `export_conversation` | /export |
| `generateSessionTitle(desc,{persist})` | `generate_session_title` | automatic title / /rename without an argument |
| `renameSession(title,id)` | `rename_session` | /rename |
| `cancelAsyncMessage(uuid)` | `cancel_async_message` | withdrawal from the queue |
| `getSettings()`, `getHooksListing()`, `listPermissionRules()` | see §2.2 | /config, /hooks, /permissions |
| `submitFeedback(desc,{…})`, `messageRated(…)` | `submit_feedback`, `message_rated` | /bug, /feedback, message rating |
| `launchUltrareview(args,{confirm})` | `ultrareview_launch` | /ultrareview |
| `mcpAuthenticate(server,redirectUri)`, `mcpSubmitOAuthCallbackUrl()`, `mcpClearAuth()` | `mcp_authenticate`, `mcp_oauth_callback_url`, `mcp_clear_auth` | MCP OAuth in /mcp |
| `claudeAuthenticate(loginWithClaudeAi)`, `claudeOAuthCallback(code,state)`, `claudeOAuthWaitForCompletion()` | `claude_authenticate`, … | /login (**ToS constraint**, see architecture) |
| `enableChannel(server)` | `channel_enable` | --channels |
| `setPromptSuggestionsPaused(bool)` | `set_prompt_suggestions_paused` | suggestion pause |
| `claimSession(…)` | `claim_session` | pre-started process (prewarm) |
| (remote control method) | `remote_control` | /remote-control |

Untyped **inbound** requests (CLI→client), handled by the runtime [R]: `oauth_token_refresh` (hidden `getOAuthToken` callback), `host_auth_token_refresh`, `remote_control_work_secret`, `ui_copy`, `ui_prompt_read`, `ui_prompt_fill`, `ui_prompt_suggest` (hidden `uiHost` option: clipboard copy and reading/writing the host's prompt).

Count: 39 typed + about 27 untyped client→CLI + 7 untyped inbound ≈ **73 subtypes**.

## 4. `SDKMessage` (union line 5273, 39 members) + `active_goal`
| type / subtype | Line | Key fields | GUI use |
|---|---|---|---|
| `assistant` | 3598 | `message: BetaMessage`, `parent_tool_use_id`, `error`, `aborted`, `supersedes`, `context_usage`, `usage_report` | response bubble, thinking / tool_use blocks |
| `user` | 6158 | `message`, `tool_use_result` (the tool's structured output), `priority`, `shouldQuery`, `uuid`, `pasted_content`, `inline_pastes` | tool_result, prompt |
| `user` + `isReplay:true` | 6246 | as above + `file_attachments` | echo / replay |
| `result` success | 5672 | `result`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, `local_command`, `structured_output` | end of turn, cost |
| `result` error_* | 5611 | `subtype: error_during_execution\|error_max_turns\|error_max_budget_usd\|error_max_structured_output_retries`, `errors[]`, `startup_failure_reason` (5824) | error banner |
| `stream_event` | 5423 | `event: BetaRawMessageStreamEvent`, `ttft_ms` | token-by-token streaming (`includePartialMessages`) |
| `system/init` | 5843 | `model`, `tools`, `mcp_servers`, `permissionMode`, `slash_commands`, `terminal_slash_commands`, `skills`, `plugins`, `plugin_errors`, `output_style`, `apiKeySource`, `effort`, `view_mode`, `capabilities`, `claude_code_version`, `cwd` | tab's initial state |
| `system/status` | 5828 | `status: compacting\|requesting\|null`, `permissionMode`, `compact_result` | spinner, mode indicator |
| `system/compact_boundary` | 3725 | `compact_metadata` (trigger, pre/post tokens) | "compacted conversation" divider |
| `system/api_retry` | 3576 | `attempt`, `max_retries`, `retry_delay_ms`, `error` | "retrying…" |
| `system/control_request_progress` | 4940 | `request_id`, `status` | /btw progress |
| `system/model_refusal_fallback` | 5355 | `original_model`, `fallback_model`, `content` | fallback notice |
| `system/model_refusal_no_fallback` | 5392 | `content` | refusal notice |
| `system/local_command_output` | 5213 | `content` | output of local slash commands (/usage, /context, …) |
| `system/hook_started` / `hook_progress` / `hook_response` | 5170 / 5142 / 5155 | `hook_name`, `hook_event`, `stdout`, `stderr`, `outcome` | hook log (`includeHookEvents`) |
| `system/plugin_install` | 5551 | `status`, `name` | plugin installation progress |
| `tool_progress` | 6053 | `tool_use_id`, `elapsed_time_seconds`, `subagent_retry` | timer on the tool |
| `auth_status` | 3681 | `isAuthenticating`, `output`, `error` | login status |
| `system/task_started` / `task_progress` / `task_updated` / `task_notification` | 5982 / 5957 / 6018 / 5927 | `task_id`, `description`, `subagent_type`, `workflow_name`, `usage`, `summary`, `status`, `output_file` | task / subagent / workflow panel |
| `system/background_tasks_changed` | 3693 | `tasks[]` | background task badge |
| `system/thinking_tokens` | 6040 | `estimated_tokens` | thinking counter |
| `system/session_state_changed` | 5795 | `state: idle\|running\|requires_action` | tab badge, notifications |
| `system/worker_shutting_down` | 6322 | `reason` | process shutdown |
| `system/commands_changed` | 3717 | `commands: SlashCommand[]` (9254) | updates the command palette |
| `system/notification` | 5408 | `key`, `text`, `priority`, `timeout_ms` | toast |
| `system/files_persisted` | 5102 | `files`, `failed` | — |
| `tool_use_summary` | 6074 | `summary`, `preceding_tool_use_ids` | summary row (focus view) |
| `system/memory_recall` | 5248 | `mode`, `memories[]` | "memory used" chip |
| `rate_limit_event` | 5574 | `rate_limit_info` (5587: status, resetsAt, rateLimitType, utilization) | plan limits bar |
| `system/elicitation_complete` | 5093 | `elicitation_id` | closes the MCP form |
| `system/permission_denied` | 5457 | `tool_name`, `decision_reason`, `message` | auto mode denials |
| `prompt_suggestion` | 5564 | `suggestion` (arrives AFTER `result`) | suggested text in the composer |
| `system/mirror_error` | 5339 | `error` | only with `sessionStore` |
| `system/informational` | 5183 | `content`, `level`, `prevent_continuation` | system messages |
| `conversation_reset` | 5065 | `new_conversation_id`, `trigger: clear\|plan_mode_exit\|…` | new conversation in the same tab (/clear) |
| `active_goal` (outside the union, inside `StdoutMessage`) | 3560 | `value.condition`, `iterations` | /goal indicator [D: comes from the generator] |

Untyped wire types observed in the runtime [R], to be ignored: `session_metadata`, `post_turn_summary`, `task_summary`, `agent_metadata`, `transcript_mirror`, `autocompact_state`, `queued_command`, `fork_briefing`.

## 5. Typed public methods of `Query` (interface line 2833, extends `AsyncGenerator<SDKMessage>`)
`interrupt` 2847 · `setPermissionMode` 2854 · `setMcpPermissionModeOverride` 2871 · `setModel` 2883 · `setMaxThinkingTokens` 2910 · `applyFlagSettings` 2938 · `updateSettings` 2953 · `initializationResult` 2962 · `reinitialize` 2988 · `supportedCommands` 2994 · `supportedModels` 3000 · `supportedAgents` 3006 · `mcpServerStatus` 3012 · `getContextUsage` 3023 · `usage_EXPERIMENTAL_…` 3043 · `readFile` 3064 · `reloadPlugins` 3083 · `reloadSkills` 3091 · `reloadOutputStyles` 3101 · `accountInfo` 3107 · `rewindFiles` 3116 · `seedReadState` 3129 · `reconnectMcpServer` 3144 · `toggleMcpServer` 3152 · `readMcpResource` 3165 · `setMcpServers` 3194 · `streamInput` 3201 · `stopTask` 3206 · `backgroundTasks` 3221 · `close` 3230. **Total: 30.**

## 6. Exported functions
| Function | Line | Use |
|---|---|---|
| `query({prompt, options})` | 3233 | starts a session (one CLI process) |
| `startup()` → `WarmQuery` | 9457 / 9836 | pre-started process, then `.query(prompt)` |
| `prewarm()` → `SpareProcess.claim()` | 2812 / 9283 (@alpha) | spare process to open tabs faster |
| `listSessions({dir,limit,offset,includeWorktrees})` | 1090 (options 1095) | /resume picker |
| `getSessionInfo(id)` | 865 | session metadata (`SDKSessionInfo` 5749) |
| `getSessionMessages(id,{limit,offset,includeSystemMessages})` | 895 | history to show on resume (`SessionMessage` 6377) |
| `listSubagents(id)` / `getSubagentMessages(id,agentId)` | 1145 / 932 | subagent transcripts |
| `renameSession` / `tagSession` / `deleteSession` | 3244 / 9575 / 665 | file-level session management |
| `forkSession(id,{upToMessageId,title})` | 831 | /branch, /fork |
| `resolveSettings()` | 3300 (@alpha) | merged settings + provenance per key (`ProvenanceEntry` 2821) |
| `filterEscalatingDefaultMode()` | 792 | default mode filter |
| `tool()`, `createSdkMcpServer()` | 9644, 608 | the app's in-process tools |
| `importSessionToStore`, `foldSessionSummary`, `InMemorySessionStore` | 993, 813, 1030 | external store (not needed) |
| Constants `HOOK_EVENTS` (33 events), `EXIT_REASONS`, `USAGE_*_PREFIXES`, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | 952, 759, 9739-9757, 9567 | — |

## 7. Main options (type line 1514)
| Option | Line | CLI equivalent |
|---|---|---|
| `cwd`, `additionalDirectories`, `projectConfigRoot` | 1591, 1524, 1534 | cwd, `--add-dir` |
| `model`, `fallbackModel`, `effort`, `thinking`, `maxThinkingTokens` | 1955, 1677, 1906, 1899, 1915 | `--model`, `--effort` |
| `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`, `permissionPromptToolName`, `permissionPrompts` | 1981, 1993, 1582, 1998, 2007 | `--permission-mode` & co. |
| `allowedTools`, `disallowedTools`, `tools`, `toolAliases`, `toolConfig` | 1577, 1597, 1633, 1623, 1697 (`ToolConfig` 9654: `askUserQuestion.previewFormat`) | `--allowedTools`, `--tools` |
| `resume`, `continue`, `forkSession`, `sessionId`, `resumeSessionAt`, `resumeDropsTurn` | 2074, 1587, 1702, 2080, 2088, 2139 | `-r`, `-c`, `--fork-session` |
| `persistSession`, `sessionStore` | 1810, 1822 | `--no-session-persistence` |
| `enableFileCheckpointing` | 1686 | required for `rewindFiles` |
| `includePartialMessages`, `includeHookEvents`, `forwardSubagentText`, `agentProgressSummaries`, `promptSuggestions` | 1855, 1850, 1862, 2069, 2059 | streaming flags |
| `hooks`, `onElicitation`, `onUserDialog`, `supportedDialogKinds`, `perTaskStopAffordance` | 1723, 1744, 1758, 1780, 1800 | — |
| `agent`, `agents`, `skills`, `plugins`, `pluginDelivery` | 1553, 1569, 2262, 2022, 2037 | `--agent(s)`, `--plugin-dir` |
| `mcpServers`, `strictMcpConfig` | 1950, 2288 | `--mcp-config` |
| `settings`, `managedSettings`, `settingSources` | 2199, 2228, 2239 (without `'project'` it does not load CLAUDE.md) | `--settings`, `--setting-sources` |
| `systemPrompt` (string \| custom \| preset `claude_code` + `append`/`excludeDynamicSections`/`snapshot`), `planModeInstructions`, `title` | 2390, 1988, 2409 | `--system-prompt` & co., `-n` |
| `sandbox` | 2181 | `/sandbox` |
| `env`, `extraArgs`, `pathToClaudeCodeExecutable`, `spawnClaudeCodeProcess`, `executable` | 1653, 1670, 1972, 2431, 1660 | env, arbitrary flags, binary |
| `debug`, `debugFile`, `stderr` | 2270, 2275, 2280 | `--debug` |
| `maxTurns`, `maxBudgetUsd`, `taskBudget`, `outputFormat`, `betas`, `verbatimPrompts` | 1920, 1925, 1933, 1968, 1709, 1886 | print mode |

## 8. Callbacks and response types
- `CanUseTool` 213: receives `signal`, `suggestions`, `blockedPath`, `decisionReason`, `title`, `displayName`, `description`, `defaultToNo`, `suppressAlwaysAllowRule`, `toolUseID`, `agentID`, `requestId`, `matchedAskRule`, `mcpServer`. Returns `PermissionResult` 2494:
  - `allow{updatedInput, updatedPermissions}`;
  - `deny{message, interrupt}`;
  - `null` only if the response has already been sent out-of-band.
- `PermissionUpdate` 2513: `addRules`/`replaceRules`/`removeRules`/`setMode`/`addDirectories`/`removeDirectories`, destination `userSettings|projectSettings|localSettings|session|cliArg` (2542).
- `AskUserQuestion` goes through `canUseTool`. Answers must be returned in `updatedInput.answers` (`sdk-tools.d.ts` 2662-2666; output 3926).
- `ExitPlanMode` goes through `canUseTool` (input `sdk-tools.d.ts` 835).
- `OnUserDialog` 1500 → `UserDialogResult` 9785 (`completed{result}` \| `cancelled`).
- `HookCallback` 957, `HookCallbackMatcher` 964.

## 9. Slash commands in SDK mode — verified against the 2.1.280 binary
Grep on `claude.exe` 2.1.280, `supportsNonInteractive` field **[V binary]**. Many commands have two variants: `local-jsx` (TUI) and `local` (text, available via SDK).
- **Executable by passing them as a prompt** (`local` + `supportsNonInteractive:!0`, or type `prompt`): `compact`, `add-dir`, `auto-mode-setup`, `clear`, `color`, `autocompact`, `config`, `output-style`, `context`, `pause-memory`, `import`, `design-consent`, `design-revoke`, `mcp`, `rename`, `usage`, `skill-doctor`, `fast`, `agents`, `plugin-types`, `reload-plugins`, `reload-skills`, `advisor`, `exit`, `model`, `workflow-launch-exec`, `usage-credits`, `extra-usage`, `effort`, `stop`, `list-agents`, `recap`, `goal`; prompt type: `init`, `insights`, `team-onboarding`. The bundled skills (/simplify, /code-review, …) are prompts [D].
- **Explicitly non-interactive = false**: `install-slack-app`, `stickers`, `radio`, `update`, `rewind`.
- **`local-jsx` only (not available via SDK)**: `web-setup`, `artifacts`, `autofix-pr`, `btw`, `feedback`, `bug`, `cd`, `copy`, `desktop`, `diff`, `memory`, `help`, `ide`, `design-login`, `login`, `logout`, `install-github-app`, `mobile`, `powerup`, `resume`, `setup-bedrock`, `setup-vertex`, `session`, `scroll-speed`, `skills`, `status`, `tasks`, `teleport`, `terminal-setup`, `ultraplan`, `theme`, `tui`, `permissions`, `plan`, `passes`, `privacy-settings`, `hooks`, `branch`, `fork`, `subtask`, `plugin`, `export`, `remote-env`, `upgrade`, `rate-limit-options`, `focus`, `background`, `workflows`, `remote-control`.
- **To be re-checked at runtime**: the engine is 2.1.285. Compare `init.slash_commands`, `init.terminal_slash_commands` (5871) and `supportedCommands()` in Phase 0.
