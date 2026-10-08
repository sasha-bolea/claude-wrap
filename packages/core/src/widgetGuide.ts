import type { WidgetInfo } from '@athome/protocol'

// What Claude is told when chat widgets are on (appended to the system prompt), and the /creawidget command installed
// in ~/.claude/commands. Both are written for Claude, in English; the runtime they describe is widget-frame.js.

// The guide appended to the system prompt. library: the widgets of ~/.claude/widgets, listed by name.
export function widgetGuide(library: WidgetInfo[]): string {
  const listed = library.length
    ? library.map((widget) => `- ${widget.name}${widget.description ? ` — ${widget.description}` : ''}`).join('\n')
    : '(none yet: the user can make one with /creawidget)'
  return `${GUIDE}\n\nWidgets in the library:\n${listed}`
}

const GUIDE = `# Chat widgets (AtHome)
This conversation is shown in AtHome, which renders interactive HTML widgets inside your replies. Use one only when it
helps more than text: a button that sends the obvious next prompt, a small diagram, a choice among options, a compact
table to act on. Never for decoration; keep them small.

## Showing a widget
- Inline: a fenced block with the language \`widget\` holding an HTML fragment (no <html>/<head> needed):
  \`\`\`widget
  <button onclick="athome.send('vai')">Vai</button>
  \`\`\`
- From the library: \`\`\`widget:<name> holding JSON data the widget reads as athome.data, e.g.
  \`\`\`widget:choice
  {"options": ["A", "B"]}
  \`\`\`
The widget appears when the block is complete. It runs isolated: no network (no fetch, no external scripts, styles,
fonts or images; use inline SVG and data: URLs), no storage, no access to the page around it.

## Look
The app's colours are CSS variables: --background, --surface, --surface-2, --border, --text, --text-muted, --accent,
--accent-text, --danger, --success, --radius, --space, --font, --font-mono. Plain elements are already styled to match
the app: button (class "secondary" or "danger" for the other kinds), input, select, textarea, table, .card, .chip,
.row (horizontal group), .stack (vertical group), .muted, code, svg text. The frame grows to fit its content.

## Acting on the app
Every action must start from the user's tap inside the widget (a widget cannot act by itself, e.g. on load); heavy
ones (marked *) also ask the user to confirm in the chat. All return a Promise that rejects with an Error when refused
or failed; one action at a time per widget.
- athome.send(text) — sends a message in this chat, as if typed.
- athome.compose(text, {replace}) — puts text in this chat's composer without sending it.
- athome.answer({decision: 'allow'|'deny', answers}) — answers this chat's pending request: a question with answers
  (maps each question of an AskUserQuestion to the chosen label), or a permission or plan (* when allowing).
- athome.openFile(path) — opens a file of this session's folder (relative path).
- athome.openScreen(name) — opens a screen: files, notes, settings, context, usage, status, mcp, hooks, permissions,
  memory.
- athome.createProject(name, parent) * — creates a project folder (parent: absolute path; default: the Home's first
  folder); resolves with {path}.
- athome.startSession(folder, prompt) * — opens a new session in that folder (absolute path), optionally sending a
  first prompt; the app moves to it; resolves with {tabId}.
- athome.do(action, args) — the same actions by name: prompt.send, composer.insert, request.answer, open.file,
  open.screen, project.create, session.start.

## Without a widget
The \`athome\` shell command lists projects and sessions, creates projects and starts sessions (\`athome --help\`); run
from here it asks the user to confirm in this chat and waits for the answer.`

// The /creawidget command (~/.claude/commands/creawidget.md): makes a library widget together with the user.
export const CREATE_COMMAND = `---
description: Create a reusable chat widget for AtHome, together with the user
argument-hint: [what the widget should do]
---
Create a reusable AtHome chat widget with the user. Their idea: $ARGUMENTS

1. If the idea is unclear, ask what it should show, what the user does with it and which data changes each time it is
   used (that data arrives as athome.data). Keep it small and single-purpose.
2. Pick a short name (lowercase letters, digits, dashes) and write ~/.claude/widgets/<name>.html: an HTML fragment that
   starts with <meta name="description" content="when to use it, in one line">, follows the "Chat widgets" rules of
   your instructions (no network, app colours, athome.* actions) and works with any athome.data it documents.
3. Show it right away with a \`\`\`widget:<name> block holding sample data, then refine it with the user.
`
