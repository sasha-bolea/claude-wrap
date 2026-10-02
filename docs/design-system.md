# Design system — claude-wrap

_Living catalogue: updated at the same moment a UI element is added or changed. One UI (`packages/ui`) serves the desktop app and the mobile PWA._

## Binding rules
1. **Colours and spacing only from tokens** (`var(--…)`): never hex values or "magic" px in components.
2. **No inline `style={{…}}`**: a new layout gets a class here and in the stylesheet.
3. **Reuse before creating**: button = `.button`, field = `.field`, button row = `.actions`, screen container = `.screen`. Class names are English.
4. **Automatic light/dark theme** (`prefers-color-scheme`): every new token is defined in both.
5. **Accessibility**: every dialog is a `<section>` with `aria-label`; every `select` has `aria-label`; the visible focus (`:focus-visible`) is never removed; animations respect `prefers-reduced-motion`.
6. **Focus is never stolen and never lands on a button that grants something.** A panel that appears by itself (a request from Claude, the trust dialog of a restored tab) does not use `autoFocus`: it has `tabIndex={-1}` and takes focus on the **container**, and only if focus is free (`isFocusFree()`). So Enter or Space can never approve by mistake. Focus moves on tab change skip a user who is typing (`isTyping()`). `autoFocus` is allowed only on elements opened by a user action (rename field, delete confirmation). A handled key that moves focus calls `preventDefault`. **Multi-client**: when a request is answered from another device and its panel disappears, focus moves to the tab panel, never to `body`.
7. **Important state changes are announced** to screen readers with `.sr-only` + `aria-live`, one region per message type (read only when its text changes): request and mode of the active tab, requests in inactive tabs; errors with `role="alert"`, waits with `role="status"`. Exactly one announcement per request.
8. **All UI text goes through `t()`**, and the English and Italian dictionaries are always complete (a missing key fails the typecheck). Direct tone. Free text sent to Claude as a reason always has a sensible default.
9. **Touch** (mobile): every keyboard-only action has a visible control (Stop instead of Esc, mode selector instead of Shift+Tab, history button instead of Up/Ctrl+R, photo/file picker instead of drag). Targets at least 44×44 px.
10. **Untrusted content** (assistant markdown, tool output, MCP resources): no raw HTML, no `dangerouslySetInnerHTML`; remote images render as links.

## Tokens
Defined in [packages/ui/src/style.css](../packages/ui/src/style.css), carried over from the first attempt's palette with English names; every colour token has a light and a dark value.

| Token | Use |
|---|---|
| `--background` | page background |
| `--surface`, `--surface-2` | panels; hovered or secondary panels |
| `--border` | borders and separators |
| `--text`, `--text-muted` | body text; secondary text |
| `--accent`, `--accent-text` | primary actions; text on accent |
| `--danger`, `--success` | errors and destructive actions; positive outcomes |
| `--radius`, `--space` | corner radius; base spacing unit (multiply with `calc`) |
| `--font`, `--font-mono` | UI font; code and technical values |
| `--content-width` | max width of conversation items, request panel and composer |

## Elements
_Each element added gets: name, classes, when to use it, and a link to a real usage example (file:line)._

### App frame — `.app`, `.page`
`.app`: full-height column holding the current screen. `.page`: a screen that fills the rest (header, scrolling body, footer). The chat panel is a `.page` with `tabIndex={-1}` so focus can land on it when a request panel disappears (rule 6).
Examples: [packages/ui/src/App.tsx:78](../packages/ui/src/App.tsx#L78), [packages/ui/src/ChatView.tsx:81](../packages/ui/src/ChatView.tsx#L81).

### Screen container — `.screen`
Full-height page area with centred content; a `[role='alert']` inside it is shown in `--danger`. Use for whole-screen states (connecting, connection error).
Example: [packages/ui/src/App.tsx:111](../packages/ui/src/App.tsx#L111).

### Start screen — `.start` (+ `.subtitle`)
Narrow centred column with title, hint and the first action; `.subtitle` for its section headings. Use for "nothing open yet" screens.
Example: [packages/ui/src/StartScreen.tsx:60](../packages/ui/src/StartScreen.tsx#L60).

### Buttons — `.button`, `.button.primary`, `.button.danger`
`.button` secondary action; `.primary` the main action of a group (one per group); `.danger` destructive or stopping actions (Stop, No). Never auto-focused when they grant something (rule 6).
Examples: primary [packages/ui/src/Composer.tsx:59](../packages/ui/src/Composer.tsx#L59), danger [packages/ui/src/Composer.tsx:55](../packages/ui/src/Composer.tsx#L55), secondary [packages/ui/src/ChatHeader.tsx:59](../packages/ui/src/ChatHeader.tsx#L59).

### Fields — `.field`, `.select`
`.field` for text inputs and textareas (full width), `.select` for pickers. Every field and select has an `aria-label` (rule 5).
Examples: [packages/ui/src/RequestPanel.tsx:37](../packages/ui/src/RequestPanel.tsx#L37), [packages/ui/src/ChatHeader.tsx:49](../packages/ui/src/ChatHeader.tsx#L49).

### Button row — `.actions`
Horizontal wrapping row of buttons, gap `--space`.
Example: [packages/ui/src/RequestPanel.tsx:38](../packages/ui/src/RequestPanel.tsx#L38).

### Header bar — `.bar` (+ `.title`)
Top bar of a screen: the `.title` takes the free space and ellipsizes, controls follow on the right.
Example: [packages/ui/src/ChatHeader.tsx:33](../packages/ui/src/ChatHeader.tsx#L33).

### Secondary text — `.muted`
Small `--text-muted` text for hints and metadata.
Example: [packages/ui/src/ChatHeader.tsx:37](../packages/ui/src/ChatHeader.tsx#L37).

### Conversation — `.conversation` and `.item` kinds
Scrolling column of transcript items, each `.item` capped at `--content-width`. Kinds: `.item.user` (filled bubble), `.item.assistant-text` (markdown, rule 10), `.item.thinking` (italic, left rule), `.item.tool` (see Tool card), `.item.turn-end` (right-aligned stats / "Interrupted", `.failed` in `--danger`), `.item.notice` (`.info` / `.warning` / `.error`), `.item.local-output` (preformatted block).
Examples: [packages/ui/src/ChatView.tsx:83](../packages/ui/src/ChatView.tsx#L83), [packages/ui/src/ItemView.tsx:44](../packages/ui/src/ItemView.tsx#L44), [packages/ui/src/ItemView.tsx:47](../packages/ui/src/ItemView.tsx#L47), [packages/ui/src/ItemView.tsx:56](../packages/ui/src/ItemView.tsx#L56), [packages/ui/src/ItemView.tsx:58](../packages/ui/src/ItemView.tsx#L58).

### Tool card — `.item.tool` (`<details>`)
Closed: `.tool-name`, `.tool-summary` (mono, ellipsized), `.tool-state`; open: `.tool-body` with input and result. `.failed` borders it in `--danger`.
Example: [packages/ui/src/ItemView.tsx:19](../packages/ui/src/ItemView.tsx#L19).

### Request panel — `.request-panel`
Accent-bordered `<section aria-label>` at the end of the conversation for permissions, questions and plan approvals. Takes focus on the container only when focus is free, never on a button (rule 6). Inside: `.preview` (input / plan), `.question` fieldsets with `.chip` headers and `.option` rows (`.option-description`).
Examples: [packages/ui/src/RequestPanel.tsx:22](../packages/ui/src/RequestPanel.tsx#L22), [packages/ui/src/RequestPanel.tsx:75](../packages/ui/src/RequestPanel.tsx#L75), [packages/ui/src/RequestPanel.tsx:80](../packages/ui/src/RequestPanel.tsx#L80).

### Chip — `.chip`
Small rounded label (e.g. a question header).
Example: [packages/ui/src/RequestPanel.tsx:77](../packages/ui/src/RequestPanel.tsx#L77).

### Composer — `.composer`, `.composer-inner`
Footer with the message textarea and the Stop / Send buttons. Shift+Tab switches mode only here (rule 6 of the first attempt, kept).
Example: [packages/ui/src/Composer.tsx:42](../packages/ui/src/Composer.tsx#L42).

### Screen-reader text — `.sr-only`
Invisible but accessible text for `aria-live` regions, one region per message type (rule 7).
Example: [packages/ui/src/ChatView.tsx:100](../packages/ui/src/ChatView.tsx#L100).

### Connection banner — `.connection-banner`
Thin status strip shown while the connection is being re-established.
Example: [packages/ui/src/App.tsx:99](../packages/ui/src/App.tsx#L99).

### Version line — `.version-line`
One line of technical versions in `--font-mono` / `--text-muted`, bottom right.
Example: [packages/ui/src/App.tsx:103](../packages/ui/src/App.tsx#L103).

### Tab bar — `.tab-bar`, `.tab`, `.tab-title`, `.tab-field`, `.tab-close`, `.new-tab`
`role="tablist"` row of open sessions. A `.tab` (`role="tab"`, `.active` when shown) holds a status badge, the
title (double click or F2 renames into a `.tab-field`, confirmed only with Enter; Esc cancels with
`preventDefault`) and a `.tab-close` ×. Ctrl+Shift+←/→ moves the focused tab. `.new-tab` opens the start
screen (`aria-pressed` while it is shown). The shown tab's content sits in a `.tab-panel` (`role="tabpanel"`).
Examples: [packages/ui/src/TabBar.tsx:100](../packages/ui/src/TabBar.tsx#L100), [packages/ui/src/TabBar.tsx:63](../packages/ui/src/TabBar.tsx#L63), [packages/ui/src/TabBar.tsx:70](../packages/ui/src/TabBar.tsx#L70), [packages/ui/src/TabBar.tsx:104](../packages/ui/src/TabBar.tsx#L104), [packages/ui/src/App.tsx:92](../packages/ui/src/App.tsx#L92).

### Status badge — `.badge` (`.working`, `.waiting`, `.error`, idle)
8 px dot with `role="img"` and an `aria-label`: idle (border colour), working (`--success`), waiting for the
user (`--accent`, pulses unless reduced motion), error (`--danger`).
Example: [packages/ui/src/TabBar.tsx:67](../packages/ui/src/TabBar.tsx#L67).

### Session list — `.session-list`, `.session-entry`, `.session-open`
Stored sessions of a folder: a full-width `.session-open` button (title, date, branch, `.chip` "open") and an
`.actions` row (Rename, Delete with a two-step confirmation; both disabled while a tab has the session open).
Examples: [packages/ui/src/SessionList.tsx:100](../packages/ui/src/SessionList.tsx#L100), [packages/ui/src/SessionList.tsx:42](../packages/ui/src/SessionList.tsx#L42), [packages/ui/src/SessionList.tsx:58](../packages/ui/src/SessionList.tsx#L58).

### Trust dialog — `.request-panel` + `.config-list`
The folder trust dialog reuses the request panel (`aria-label` "Folder trust"), with one `.config-list` per
category of project configuration. Like every self-appearing panel it never focuses "Yes".
Examples: [packages/ui/src/TrustDialog.tsx:39](../packages/ui/src/TrustDialog.tsx#L39), [packages/ui/src/TrustDialog.tsx:17](../packages/ui/src/TrustDialog.tsx#L17).

