# Parity map — CLI census 2.1.280 → claude-wrap

_Translated from the Italian original (personale/claude wrap/docs/mappa-parita.md, 2026-10-02). Content otherwise unchanged._
_Category legend:_
- **D** = Direct SDK (existing method, option, or message). **D\*** = exists only as an untyped runtime method (see addendum §3): works today, but is unstable.
- **U** = UI over SDK data (the SDK provides the data, the component needs to be built). **U\*** = same as D\*.
- **R** = Rebuild (the CLI does it in the TUI, the SDK doesn't).
- **N** = Not applicable / replaced by a GUI equivalent.
- **B** = Impossible / blocked.

_"Prompt" column:_
- **✓b** = executable by passing it as prompt text (verified on binary 2.1.280, see addendum §9);
- **✓s** = skill or workflow (prompt, inferred from the skill mechanism);
- **✗** = TUI only (`local-jsx` or `supportsNonInteractive:!1`);
- **?** = undetermined.

Rows and methods refer to the addendum.

## Part A — Slash commands (115 rows; aliases are merged)
| Command (alias) | Cat. | Prompt | How |
|---|---|---|---|
| `/add-dir` | D | ✓b | `Options.additionalDirectories` at startup; mid-session via prompt |
| `/advisor` | D | ✓b | prompt; picker based on `supportedModels()` |
| `/agents` | U | ✓b | list from `supportedAgents()`; `.claude/agents` file editor in Part C |
| `/artifact-capabilities` | D | ✓s | prompt |
| `/artifact-diagramming` | D | ✓s | prompt |
| `/artifacts` | B | ✗ | requires the claude.ai account API, not exposed |
| `/auto-mode-setup` | D | ✓b | prompt |
| `/autocompact` | D | ✓b | prompt; or `applyFlagSettings({autoCompactWindow})` |
| `/autofix-pr` | B | ✗ | cloud session |
| `/background` (`/bg`) | N | ✗ | the tab stays alive as long as the app is open (tray); detaching to the CLI daemon is not exposed |
| `/batch` | D | ✓s | prompt |
| `/branch` | D | ✗ | `forkSession(id)` → new tab with `resume` |
| `/btw` | D\* | ✗ | `askSideQuestion()`; side panel |
| `/bug` (`/share`) | D\* | ✗ | `submitFeedback()` |
| `/cd` | D\* | ✗ | `setCwd(path,{trustAccepted})`; stable alternative: close and reopen with a new `cwd` + `resume` |
| `/chrome` | U\* | ? | `getChromeDialog/Browsers/selectChromeBrowser()` |
| `/claude-api` | D | ✓s | prompt |
| `/claude-in-chrome` | D | ✓s | prompt |
| `/clear` (`/reset`, `/new`) | D | ✓b | prompt → `conversation_reset` message (5065) |
| `/code-review` (`/review`) | D | ✓s | prompt |
| `/color` | D | ✓b | prompt; color picker in the UI |
| `/compact` | D | ✓b | prompt → `status: compacting` + `compact_boundary` |
| `/config` (`/settings`) | R | ✓b | `key=value` form via prompt. Panel: `resolveSettings()` (provenance) + `getSettings()`\*; JSON write per scope; `updateSettings`/`applyFlagSettings` where sufficient |
| `/context` | U | ✓b | `getContextUsage()` (`gridRows` grid, categories) |
| `/copy` | R | ✗ | copy button (Electron clipboard) |
| `/dataviz` | D | ✓s | prompt |
| `/debug` | D | ✓s | prompt; `Options.debug/debugFile` |
| `/deep-research` | D | ✓s | prompt (workflow) |
| `/design` | D | ? | prompt (`local` type in the binary, flag not found) |
| `/design-login` | B | ✗ | claude.ai OAuth |
| `/design-sync` | D | ✓s | prompt |
| `/desktop` (`/app`) | N | ✗ | we are already a desktop app |
| `/diff` | R | ✗ | `git diff` in the main process + `structuredPatch` of the Edit/Write tools (`sdk-tools` 3388) |
| `/doctor` (`/checkup`) | D | ✓s | prompt |
| `/effort` | D | ✓b | prompt / `applyFlagSettings({effortLevel})`; levels from `ModelInfo.supportedEffortLevels` (1408) |
| `/exit` (`/quit`) | N | ✓b | close tab → `query.close()` |
| `/export` | D\* | ✗ | `exportConversation()`; stable alternative: `getSessionMessages()` → save dialog |
| `/fast` | D | ✓b | prompt / `applyFlagSettings({fastMode})`; state in `init.fast_mode_state` |
| `/feedback` | D\* | ✗ | `submitFeedback()` |
| `/fewer-permission-prompts` | D | ✓s | prompt |
| `/focus` | R | ✗ | view mode in the UI (`tool_use_summary`, `init.view_mode`) |
| `/fork` | D | ✗ | `forkSession()` + background tab |
| `/goal` | D | ✓b | prompt; indicator from `active_goal` |
| `/heapdump` | N | ? | CLI process diagnostics; DevTools are enough for the app |
| `/help` | U | ✗ | palette from `supportedCommands()` + shortcuts |
| `/hooks` | U\* | ✗ | `getHooksListing()` |
| `/ide` | N | ✗ | IDE integration out of scope |
| `/import` | D | ✓b | prompt |
| `/init` | D | ✓b | prompt |
| `/insights` | D | ✓b | prompt |
| `/install-github-app` | R | ✗ | TUI wizard: opens an external terminal with `claude /install-github-app` |
| `/install-slack-app` | R | ✗ | same as above |
| `/keybindings` | R | ? | the app's own shortcut system; imports `~/.claude/keybindings.json` |
| `/list-agents` (`/peers`) | D | ✓b | prompt |
| `/login` | R | ✗ | `claude auth login` in a subprocess (personal use; ToS constraint in architecture) |
| `/logout` | R | ✗ | `claude auth logout` |
| `/loop` (`/proactive`) | D | ✓s | prompt (the session stays open) |
| `/mcp` | U | ✓b | `mcpServerStatus`/`reconnectMcpServer`/`toggleMcpServer`; OAuth with `mcpAuthenticate()`\* |
| `/memory` | U\* | ✗ | `getMemoryDialog()` + reading/writing CLAUDE.md from the main process |
| `/mobile` (`/ios`, `/android`) | N | ✗ | links to the stores |
| `/model` | D | ✓b | `setModel()`, `supportedModels()` |
| `/output-style` | D | ✓b | `initializationResult().available_output_styles`, `updateSettings('localSettings',{outputStyle})`, `reloadOutputStyles()` |
| `/passes` | B | ✗ | claude.ai account API |
| `/permissions` (`/allowed-tools`) | U\* | ✗ | `listPermissionRules()` (types 4587/4781) + settings write |
| `/plan` | D | ✗ | `setPermissionMode('plan')` + prompt; `getPlan()`\* |
| `/plugin` | R | ✗ | `claude plugin … --json` in a subprocess + `reloadPlugins()` |
| `/powerup` | N | ✗ | TUI tutorial |
| `/pr-comments` | N | — | removed |
| `/privacy-settings` | B | ✗ | claude.ai: opens the link |
| `/radio` | N | ✗ | just opens a URL |
| `/rate-limit-options` | U | ✗ | `rate_limit_event` + `usage_EXPERIMENTAL()`; actions = external links |
| `/recap` | D | ✓b | prompt |
| `/release-notes` | R | ? | CHANGELOG.md fetch |
| `/reload-plugins` | D | ✓b | `reloadPlugins({holdOnCacheImpact})` |
| `/reload-skills` | D | ✓b | `reloadSkills()` |
| `/remote-control` (`/rc`) | B | ✗ | claude.ai bridge; only the `remote_control` runtime method exists (unstable) |
| `/remote-env` | B | ✗ | cloud |
| `/rename` | D | ✓b | `renameSession()` (function on file) / prompt |
| `/resume` (`/continue`) | D | ✗ | `listSessions()` + `getSessionMessages()` + `Options.resume/continue` |
| `/rewind` (`/checkpoint`, `/undo`) | D | ✗ | code: `rewindFiles(uuid,{dryRun})` with `enableFileCheckpointing`; conversation: `resume` + `resumeSessionAt`/`forkSession`. "Summarize from/up to here" = **missing** (see B9.5) |
| `/run` | D | ✓s | prompt |
| `/run-skill-generator` | D | ✓s | prompt |
| `/sandbox` | U\* | ? | `getSandboxDialog()` + `Options.sandbox`; **not supported on native Windows** |
| `/schedule` (`/routines`) | B | ? | cloud routine |
| `/scroll-speed` | N | ✗ | native scroll |
| `/security-review` | D | ? | prompt [inferred: prompt-type command] |
| `/setup-bedrock` | R | ✗ | form that writes `env` (CLAUDE_CODE_USE_BEDROCK, …) in settings |
| `/setup-vertex` | R | ✗ | same as above |
| `/simplify` | D | ✓s | prompt |
| `/skill-doctor` | D | ✓b | prompt |
| `/skills` | U\* | ✗ | `getSkillsDialog()` + `supportedCommands()`; visibility via `skillOverrides` in settings |
| `/slides` | D | ✓s | prompt |
| `/status` | U\* | ✗ | `getStatus()` + `accountInfo()` + `system/init` |
| `/statusline` | N | ? | native status bar (model, cost, context); the user's `statusLine` script is optional (Phase 7) |
| `/stickers` | N | ✗ | link |
| `/stop` | N | ✓b | no attached background sessions; `stopTask()` is used for tasks |
| `/subtask` | B | ✗ | no equivalent; workaround: ask Claude for a background Agent |
| `/tasks` (`/bashes`) | U | ✗ | `task_*`, `background_tasks_changed`, `stopTask()`, `getSubagentMessages()` |
| `/team-onboarding` | D | ✓b | prompt |
| `/teleport` (`/tp`) | B | ✗ | cloud |
| `/terminal-setup` | N | ✗ | terminal-specific |
| `/theme` | N | ✗ | GUI theme (CSS variables); optional import of `~/.claude/themes/*.json` |
| `/tui` | N | ✗ | terminal renderer |
| `/ultraplan` | N | ✗ | removed |
| `/ultrareview` | D\* | ? | `launchUltrareview()`; stable alternative: `claude ultrareview --json` in a subprocess |
| `/update-config` | D | ✓s | prompt |
| `/upgrade` | R | ✗ | `shell.openExternal` |
| `/usage` (`/cost`, `/stats`) | U | ✓b | `usage_EXPERIMENTAL()` + `result.total_cost_usd`/`modelUsage` |
| `/usage-credits` | D | ✓b | prompt |
| `/verify` | D | ✓s | prompt |
| `/vim` | N | — | removed; vim mode is in Part B |
| `/voice` | N | ? | system dictation (Win+H); a dedicated solution comes later |
| `/web-setup` | B | ✗ | cloud |
| `/workflow-authoring` | D | ✓s | prompt |
| `/workflows` | U | ✗ | `task_started.workflow_name` + `task_progress` |
| _Mechanism_: custom commands and skills, plugin commands (`plugin:cmd`), MCP prompts (`/mcp__server__prompt`) | D | ✓ | listed by `supportedCommands()` and `commands_changed`; executed by passing them as a prompt [D for MCP prompts] |

**Part A counts (115 rows):** D 56 (of which D\* 6) · U 15 (of which U\* 7) · R 14 · N 19 · B 11.

## Part B — Shortcuts, dialogs, clicks (78 rows)
| # | Item | Cat. | How |
|---|---|---|---|
| 1 | Ctrl+C `app:interrupt` | D | `interrupt()` |
| 2 | Ctrl+D `app:exit` | N | close tab or window |
| 3 | Ctrl+X Ctrl+K `chat:killAgents` | U | `stopTask()` on every task from `background_tasks_changed` |
| 4 | Ctrl+G / Ctrl+X Ctrl+E external editor | R | temp file + `shell.openPath` + `fs.watch` |
| 5 | Ctrl+L, Cmd+K (redraw / clear) | N | — |
| 6 | Ctrl+O transcript | U | detailed view of the same `SDKMessage` |
| 7 | Ctrl+R history search | R | `~/.claude/history.jsonl` (fields `display`, `pastedContents`, `timestamp`, `project`, `sessionId`, verified) + the app's own history |
| 8 | Ctrl+V / Alt+V paste image | D | image block in `SDKUserMessage.message.content` (6163) |
| 9 | Ctrl+B `task:background` | D | `backgroundTasks()` |
| 10 | Ctrl+T todo | U | input of the TodoWrite / Task* tools (`sdk-tools`) |
| 11 | Ctrl+S stash | R | local composer state |
| 12 | Ctrl+Z | N | — |
| 13 | Left/Right between tabs | N | native tabs |
| 14 | Tab autocomplete | R | commands from `supportedCommands()`; files via `git ls-files` + fuzzy matching in the main process (`file_suggestions` has no method) |
| 15 | Up/Down history | R | same as #7 |
| 16 | Esc `chat:cancel` | D | `interrupt()` |
| 17 | Esc Esc → rewind | R | opens the Rewind panel |
| 18 | Ctrl+Enter `chat:sendNow` | D | `SDKUserMessage.priority:'now'` (6170) [D: semantics] |
| 19 | Shift+Tab `chat:cycleMode` | D | `setPermissionMode()` |
| 20 | Alt+P model picker | D | `setModel()` + `supportedModels()` |
| 21 | Alt+T thinking | D | `setMaxThinkingTokens()` / `Options.thinking` |
| 22 | Alt+O fast | D | `applyFlagSettings({fastMode})` |
| 23 | `?` shortcut help | R | overlay |
| 24 | §2 readline editing (Ctrl+A/E/K/U/W/Y, Alt+B/F/D/Y, Ctrl+_) | R | composer keymap (CodeMirror 6) |
| 25 | §3 multiline (Shift+Enter, `\`+Enter, Ctrl+J, Option+Enter) | R | textarea: native Shift+Enter, the rest as keymap |
| 26 | §3 collapsed long paste | D | `pasted_content` / `inline_pastes` (6229-6233) + chip in the UI |
| 27 | §4 `/` menu | U | `supportedCommands()` + `commands_changed` |
| 28 | §4 `!` shell mode | R | execution in the main process + `SDKUserMessage{shouldQuery:false}` (6199; this is the pattern the official app uses for bash mode, cited at 2119) |
| 29 | §4 `#` memory | R | appended to CLAUDE.md (behavior uncertain even in the CLI) |
| 30 | §4 `@` mention | R | file picker; `@path` expansion is done by the CLI (6209) |
| 31 | §4 `:` emoji | N | system emoji picker (Win+.) |
| 32 | §4 `&` | N | doesn't exist |
| 33 | §4 drag&drop | R | Electron drop → `@path` or image block |
| 34 | §5 full vim mode (modes, motions, operators, text objects, visual, `vimInsertModeRemaps`) | R | CodeMirror 6 + `@replit/codemirror-vim` |
| 35 | §6 history per working folder | R | same as #7, filtered by `project` |
| 36 | §7 background bash (Ctrl+B, automatic timeout, env) | D | `backgroundTasks()`; the CLI handles the rest |
| 37 | §7 `/tasks` view | U | see Part A |
| 38 | §8 queue messages while Claude is working | D | push onto `streamInput` with `uuid`; `interrupt()` returns `still_queued` |
| 39 | §8 recall or cancel the queue | R | UI state + `cancelAsyncMessage()`\* |
| 40 | §8 commands that run immediately (/model, /effort, /fast) | D | direct `setModel`/`applyFlagSettings` calls |
| 41 | §9.1 Yes / Yes-always / No permission | D | `canUseTool` → `allow` / `allow{updatedPermissions: suggestions}` / `deny` |
| 42 | §9.1 comment on Yes/No | R | No → `deny.message` (2502, D); Yes → no field exists, a `priority:'next'` message is sent instead [D] |
| 43 | §9.1 keyboard navigation, double Ctrl+C | N | buttons, focus, Esc |
| 44 | §9.1 `defaultToNo` / `suppressAlwaysAllowRule` / `requiresUserInteraction` flags | D | honored in the dialog (213-301, 4749-4772) |
| 45 | §9.2 folder trust | R | its own gate: in SDK sessions the dialog doesn't appear (doc); `setCwd({trustAccepted})`\*. **Security: see architecture** |
| 46 | §9.3 AskUserQuestion | D | `canUseTool('AskUserQuestion')` → `allow{updatedInput:{…, answers}}`; `toolConfig.askUserQuestion.previewFormat` |
| 47 | §9.3 auto-continue timeout | R | UI timer from `askUserQuestionTimeout` |
| 48 | §9.4 plan approval | D | `canUseTool('ExitPlanMode')` → `allow` + `setPermissionMode(choice)`; `getPlan()`\* |
| 49 | §9.4 plan editing / "clear context" | R | editor + `updatedInput` [D]; new session with the plan as the prompt |
| 50 | §9.5 Restore code | D | `rewindFiles(uuid,{dryRun})` for preview and apply |
| 51 | §9.5 Restore conversation | D | new query with `resume` + `resumeSessionAt` (+ `resumeDropsTurn`) or `forkSession({upToMessageId})` |
| 52 | §9.5 Summarize from here / up to here | B | no API; `/compact` with instructions only applies to the whole conversation |
| 53 | §9.5 "previous session" entry | U | `conversation_reset` + `listSessions()` |
| 54 | §9.6 diff viewer / panel | R | see `/diff` |
| 55 | §9.7 theme picker / custom themes | N | GUI theme |
| 56 | §9.8 MCP and OAuth dialog | U | `mcpServerStatus()` + `mcpAuthenticate()`\*; elicitation form with `onElicitation` |
| 57 | §9.8 login / onboarding | R | `claude auth status --json` / `login` in a subprocess |
| 58 | §9.8 Bedrock/Vertex wizard | R | form → `env` in settings |
| 59 | §9.8 update dialog | N | the binary ships with the SDK; the app updates itself |
| 60 | §10 prompt box / footer | R | components |
| 61 | §10 custom status line | N | native bar (user script optional) |
| 62 | §10 mode indicators | U | `init.permissionMode`, `status.permissionMode` (5832) |
| 63 | §10 spinner | U | `status` (5826), `stream_event`, `tool_progress`, `thinking_tokens` |
| 64 | §10 todo list | U | same as #10 |
| 65 | §10 collapsible tool output | U | tool_use / tool_result / `tool_use_result` / `tool_use_summary` |
| 66 | §10 transcript mode (less-style navigation) | U | view with search |
| 67 | §10 focus view | R | see `/focus` |
| 68 | §10 recap | D | `/recap` via prompt |
| 69 | §11 mouse, click, selection, scroll, copy-on-select, PgUp/Dn, jump-to-bottom | N | native DOM |
| 70 | §11 selecting diff lines → prompt | R | "attach to prompt" action |
| 71 | §11 Ctrl+click on URL / path | R | `shell.openExternal` / `openPath` (http(s) and local files only) |
| 72 | §12 desktop notifications / bell | R | Electron `Notification` on `can_use_tool`, `result`, `requires_action` when the window is not in the foreground |
| 73 | §12 `Notification` hook | D | executed by the CLI, no intervention needed |
| 74 | §12 window title | R | `BrowserWindow.setTitle` |
| 75 | §13 keybindings.json (contexts, actions, chords, validation) | R | own keybinding system, compatible on import |
| 76 | §13 reserved keys / multiplexer | N | — |
| 77 | §14 OS differences | N | Electron's `CmdOrCtrl` accelerators |
| 78 | §15 mouse/scrollbar news/y-n fix (2.1.280-283) | N | — |

**Part B counts (78):** D 21 · U 12 · R 30 · N 14 · B 1.

## Part C — CLI, settings, hooks, protocol (67 rows)
| # | Item | Cat. | How |
|---|---|---|---|
| 1 | `--add-dir` | D | `additionalDirectories` |
| 2 | `--agent`, `--agents` | D | `agent`, `agents` |
| 3 | `--allowedTools`, `--disallowedTools`, `--tools` | D | same names |
| 4 | `--system-prompt[-file]`, `--append-…`, `--system-prompt-snapshot`, `--exclude-dynamic-…` | D | `systemPrompt` (2390) |
| 5 | `--betas` | D | `betas` |
| 6 | `-c`, `-r`, `--fork-session`, `--session-id` | D | `continue`, `resume`, `forkSession`, `sessionId` |
| 7 | `--debug`, `--debug-file` (`--verbose` is N) | D | `debug`, `debugFile`, `stderr` |
| 8 | `--model`, `--effort`, `--fallback-model` | D | same names |
| 9 | `--include-partial-messages`, `--include-hook-events`, `--forward-subagent-text`, `--replay-user-messages` | D | same names (replay = `SDKUserMessageReplay`) |
| 10 | `--json-schema`, `--max-budget-usd`, `--max-turns` | D | `outputFormat`, `maxBudgetUsd`, `maxTurns` |
| 11 | `--mcp-config`, `--strict-mcp-config` | D | `mcpServers`, `strictMcpConfig` |
| 12 | `-n/--name` | D | `title` |
| 13 | `--no-session-persistence` | D | `persistSession:false` |
| 14 | `--permission-mode`, `--allow-dangerously-…`, `--dangerously-skip-…`, `--permission-prompt-tool`, `--permission-prompts` | D | same names |
| 15 | `--plugin-dir` (`--plugin-url` [D] via extraArgs) | D | `plugins` |
| 16 | `--prompt-suggestions` | D | `promptSuggestions` |
| 17 | `--settings`, `--setting-sources` | D | same names |
| 18 | `--advisor`, `--autocompact`, `--brief`, `--chrome`, `--bare`, `--restricted`, `--safe-mode`, `--file`, `--init`, `--maintenance` | D | `extraArgs` (1670) [D: to be tried flag by flag in print mode] |
| 19 | `--bg`, `--exec`, `--cloud`, `--environment`, `--ref`, `--remote`, `--teleport`, `--remote-control[-…]` | B | daemon / cloud |
| 20 | `-w/--worktree`, `--tmux` | R | `git worktree` in the main process + `cwd`; tmux is N |
| 21 | `--ide`, `--teammate-mode`, `--ax-screen-reader` | N | — |
| 22 | `--from-pr` | R | `gh pr view` → session selection [D] |
| 23 | `-p`, `--input-format`, `--output-format` | N | the SDK is already print mode |
| 24 | `-h`, `-v` | N | version from `init.claude_code_version` |
| 25 | `--channels`, `--dangerously-load-development-channels` | B | research preview; only the `enableChannel()`\* method exists |
| 26 | `claude agents / attach / logs / stop / kill / rm / respawn` | R | list with `claude agents --json`; attach is B |
| 27 | `claude auth login / logout / status` | R | subprocess (`--json`) |
| 28 | `claude auto-mode config / critique / defaults / reset` | R | subprocess |
| 29 | `claude doctor` | R | subprocess (text); `/doctor` as a skill |
| 30 | `gateway`, `install`, `update`, `setup-token` | N | out of GUI scope |
| 31 | `claude import` | D | `/import` via prompt |
| 32 | `claude project purge` | R | subprocess with `--dry-run` and confirmation |
| 33 | `claude ultrareview` | R | `--json` in a subprocess |
| 34 | `claude mcp add / add-json / add-from-claude-desktop / get / list / remove / login / logout / reset-project-choices` | R | subprocess + update with `mcpServerStatus()` |
| 35 | `claude mcp serve` | N | — |
| 36 | `claude plugin …` and `marketplace …` | R | `--json` subprocess + `reloadPlugins()` |
| 37 | §2.3 stream-json events | D | `SDKMessage` (addendum §4) |
| 38 | §2.5 permissions in automation | D | `permissionPrompts`, `permissionMode`, `allowedTools` |
| 39 | §2.7 headless behaviors (bg at end of turn, SIGTERM/SIGINT) | D | `close()`, `interrupt()`, `perTaskStopAffordance` |
| 40 | §3.1 settings precedence | U | `resolveSettings()` + `ProvenanceEntry` (@alpha) |
| 41 | §3.2 settings keys (~230) | R | per-scope editor on the JSON files; `applyFlagSettings` only for the session |
| 42 | §3.3 files and scopes, `~/.claude.json` | R | `~/.claude.json` read-only |
| 43 | §4 environment variables | D | `Options.env` per session; persistent ones in `settings.env` (R) |
| 44 | §5 user hooks (33 events, `HOOK_EVENTS` 952) | D | executed by the CLI |
| 45 | §5 in-process app hooks | D | `Options.hooks` |
| 46 | §5 hook display and events | U | `getHooksListing()`\* + `includeHookEvents` |
| 47 | §5 hook editing | R | write to settings |
| 48 | §6.1 permission mode | D | `setPermissionMode` / `permissionMode` |
| 49 | §6.2 permission rules | U | `listPermissionRules()`\*; write via settings or `PermissionUpdate` with `destination` |
| 50 | §7.1 CLAUDE.md, rules, auto memory | R | file from the main process + `getMemoryDialog()`\* |
| 51 | §7.2 subagent | D | `agents`, `supportedAgents()`; file editor (R) |
| 52 | §7.3 skill | D | `skills`, `supportedCommands()`, `reloadSkills()`; editor (R) |
| 53 | §7.5 output style | D | see `/output-style` |
| 54 | §7.6 status line | N | native bar |
| 55 | §7.7 MCP runtime (status, reconnect, toggle, set, UI resources) | U | `mcp*` methods, `readMcpResource()` in a sandboxed iframe |
| 56 | §7.7 MCP OAuth | D\* | `mcpAuthenticate()` / `mcpSubmitOAuthCallbackUrl()` / `mcpClearAuth()` |
| 57 | §7.8 checkpoint | D | `enableFileCheckpointing` + `rewindFiles()` |
| 58 | §7.9 sessions (storage and resume) | D | `listSessions`… `forkSession` functions |
| 59 | §7.10 sandbox | B | not available on native Windows (WSL2 only); `Options.sandbox` elsewhere |
| 60 | §7.11 built-in tools (~38) | U | one renderer per tool, `ToolInputSchemas`/`ToolOutputSchemas` types (`sdk-tools` 11/56) |
| 61 | §8.1 background tasks in the session | U | `task_*` + `stopTask()` / `backgroundTasks()` |
| 62 | §8.1 agent view / daemon | B | attach not exposed (list: #26) |
| 63 | §8.2 cloud | B | — |
| 64 | §8.3 Remote Control | B | internal runtime only |
| 65 | §8.4 worktree | R | UI + `EnterWorktree` tool used by the model |
| 66 | §8.5 IDE | N | — |
| 67 | §8.6 Chrome | U\* | `getChrome*()` |

**Part C counts (67):** D 32 (of which D\* 1) · U 7 · R 15 · N 7 · B 6.

## Total (260 entries)
| Category | A | B | C | Total |
|---|---|---|---|---|
| D Direct SDK | 56 | 21 | 32 | **109** (of which 7 D\*) |
| U UI over SDK data | 15 | 12 | 7 | **34** (of which 8 U\*) |
| R Rebuild | 14 | 30 | 15 | **59** |
| N Not applicable / replaced | 19 | 14 | 7 | **40** |
| B Blocked | 11 | 1 | 6 | **18** |

The blocked entries are almost all cloud, claude.ai account, daemon, or Remote Control. Then there's the sandbox on native Windows, and two genuine gaps remain: "Summarize from/up to here" and `/subtask`.
