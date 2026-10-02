# Procedures — claude-wrap

_Runbook of multi-step or rare procedures. One-liners used often live in CLAUDE.md §5._

## SDK update (probe)
**When:** every time `@anthropic-ai/claude-agent-sdk` is bumped.
1. Update the exact version in `packages/core/package.json` (pinned, no `^`).
2. `npm install`, then `npm run probe`.
3. Compare the new probe output with `docs/reference/sdk-probe.json`: `system/init` fields, `supportedCommands()`, capabilities, CLI version, new `Settings` keys.
4. A new settings key containing command / Helper / url / path / hooks makes the probe fail until it is classified in the trust gate.
5. Re-check the verified facts listed in `personale/claude wrap/docs/handoff-ripartenza.md` §4 that the bump might change (streaming-input control methods, `init` only at the first turn, no confirmation for `setPermissionMode`, `close()` on win32).
6. Commit the refreshed `sdk-probe.json` with the bump.

**Warnings:** untyped runtime methods (census Part D §3) can change or disappear at any release; keep them behind feature detection.

## End-to-end tests
_Filled in Phase 1b when the e2e suites exist._ Rules already fixed:
- every run sets `CLAUDE_WRAP_STATE_DIR` to a temp folder (never the real app state);
- deterministic suites use `CLAUDE_WRAP_FAKE_SDK=<scenario>` (zero quota);
- the real-CLI smoke suite uses `/model haiku` and zero-token local commands (`/context`, `/model`) to save quota.
