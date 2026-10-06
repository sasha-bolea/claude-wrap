# Brief — AtHome

## What
A graphical app for Claude Code (chat, panels, buttons) with **every** feature of the terminal CLI: slash commands, shortcuts, permission modes, rewind, subagents, MCP, hooks, sessions. Nothing Claude Code does not have: only native features, plus shortcuts that just simulate a native action at a chosen moment (e.g. the queued message, which sends an ordinary message later). Decision of 2026-10-06, see STATO.md.

It is made of **three applications** around one backend:
1. **Desktop app** (Electron): front and back separated in one package. It can switch between its own **local backend** and the **remote backend**; each backend has its own tabs.
2. **Remote backend** on the home server (Debian, reachable only through Tailscale): Node on the host, sessions in a root folder chosen at setup.
3. **Mobile front** (PWA served by the remote backend), no backend of its own: every feature except vim and keyboard shortcuts, each one redesigned for touch.

The **same session can be open on PC and phone at the same time**: both see the same stream, and a permission answered on one closes on the other.

## Why
The CLI is powerful but uncomfortable for daily use, and it cannot be used from the phone. The existing alternatives are not enough:
- the **official Claude Code app** is comfortable but does not expose everything the terminal does;
- **[claude-desk](../../claude-desk)** (earlier project) puts a real terminal (pty) in a window, so it keeps the terminal's discomfort;
- **mosh + tmux from the phone** works but is a terminal on a small screen.

The interface is native and the engine is the **Claude Agent SDK**: structured events (messages, tools, permissions) drawn as components, no terminal text parsing.

## Requirements
- Functional parity with the CLI: reference = [reference/cli-census.md](reference/cli-census.md), mapped in [reference/parity-map.md](reference/parity-map.md).
- Engine: `@anthropic-ai/claude-agent-sdk` (TypeScript).
- Authentication: Sasha uses their **subscription**; it must also work with an **API key** (publication constraints in [note-rilascio.md](note-rilascio.md)).
- Windows first for the desktop, Debian for the server; cross-platform core.
- Remote access without credentials: per-device tokens obtained by pairing, behind Tailscale.
- Future **open source** publication (MIT for our code).

## Out of scope (for now)
- Invented features: they come after CLI parity.
- Running sessions in the background after the desktop window closes (tray): later.
- Showing local and remote tabs side by side in one window: later (the core already allows it).

## Name
**AtHome**, mark **`@~`** (chosen 2026-10-06, replacing the working name claude-wrap). `@` is the remote host of
`ssh user@host`, `~` is home: read together, "at home" — the sessions live on the home server and every device
connects to them. A developer symbol on purpose; "Claude" stays out of the name because of Anthropic's trademark.
Only what is shown and the code identifiers changed; the infrastructure keeps `claude-wrap` (list and reason in
[CLAUDE.md](../CLAUDE.md#1-project--purpose)) until a planned migration.

## Previous attempt
The first attempt lives in `personale/claude wrap` (with a space) and is kept as read-only reference. Why it was restarted and what was learned: `personale/claude wrap/docs/handoff-ripartenza.md`.
