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
Examples: [packages/ui/src/App.tsx:104](../packages/ui/src/App.tsx#L104), [packages/ui/src/ChatView.tsx:94](../packages/ui/src/ChatView.tsx#L94).

### Screen container — `.screen`
Full-height page area with centred content; a `[role='alert']` inside it is shown in `--danger`. Use for whole-screen states (connecting, connection error).
Example: [packages/ui/src/App.tsx:137](../packages/ui/src/App.tsx#L137).

### Start screen — `.start` (+ `.subtitle`)
Narrow centred column with title, hint and the first action; `.subtitle` for its section headings. Use for "nothing open yet" screens.
Example: [packages/ui/src/StartScreen.tsx:60](../packages/ui/src/StartScreen.tsx#L60).

### Buttons — `.button`, `.button.primary`, `.button.danger`
`.button` secondary action; `.primary` the main action of a group (one per group); `.danger` destructive or stopping actions (Stop, No). Never auto-focused when they grant something (rule 6).
Examples: primary [packages/ui/src/Composer.tsx:232](../packages/ui/src/Composer.tsx#L232), danger [packages/ui/src/Composer.tsx:228](../packages/ui/src/Composer.tsx#L228), secondary [packages/ui/src/Composer.tsx:221](../packages/ui/src/Composer.tsx#L221).

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
Scrolling column of transcript items, each `.item` capped at `--content-width`. Kinds: `.item.user` (filled bubble; sent images above the text in `.user-images`, see Image thumbnail), `.item.assistant-text` (markdown, rule 10), `.item.thinking` (italic, left rule), `.item.tool` (see Tool card), `.item.turn-end` (right-aligned stats / "Interrupted", `.failed` in `--danger`), `.item.notice` (`.info` / `.warning` / `.error`), `.item.local-output` (preformatted block), `.item.shell` (see Shell item).
Examples: [packages/ui/src/ChatView.tsx:100](../packages/ui/src/ChatView.tsx#L100), [packages/ui/src/ItemView.tsx:74](../packages/ui/src/ItemView.tsx#L74), [packages/ui/src/ItemView.tsx:87](../packages/ui/src/ItemView.tsx#L87), [packages/ui/src/ItemView.tsx:96](../packages/ui/src/ItemView.tsx#L96), [packages/ui/src/ItemView.tsx:102](../packages/ui/src/ItemView.tsx#L102).

### Tool card — `.item.tool` (`<details>`)
Closed: `.tool-name`, `.tool-summary` (mono, ellipsized), `.tool-state`; open: `.tool-body` with input and result. `.failed` borders it in `--danger`.
Example: [packages/ui/src/ItemView.tsx:24](../packages/ui/src/ItemView.tsx#L24).

### Request panel — `.request-panel`
Accent-bordered `<section aria-label>` at the end of the conversation for permissions, questions and plan approvals. Takes focus on the container only when focus is free, never on a button (rule 6). Inside: `.preview` (input / plan), `.question` fieldsets with `.chip` headers and `.option` rows (`.option-description`).
Examples: [packages/ui/src/RequestPanel.tsx:22](../packages/ui/src/RequestPanel.tsx#L22), [packages/ui/src/RequestPanel.tsx:75](../packages/ui/src/RequestPanel.tsx#L75), [packages/ui/src/RequestPanel.tsx:80](../packages/ui/src/RequestPanel.tsx#L80).

### Chip — `.chip`
Small rounded label (e.g. a question header).
Example: [packages/ui/src/RequestPanel.tsx:77](../packages/ui/src/RequestPanel.tsx#L77).

### Composer — `.composer`, `.composer-inner`, `.composer-row`, `.composer.shell`
Footer: `.composer-inner` stacks (top to bottom) the Suggestion list, the Attachments and the shell hint over the
`.composer-row` (textarea, Image, History, Stop, Send). Shift+Tab switches mode only here (rule 6 of the first
attempt, kept). Keys: `/` commands, `@` files, Up/Down on the first/last line and Ctrl+R previous messages, Esc
closes the list before it interrupts (`preventDefault`). Every keyboard action has a button (rule 9): Image =
paste/drop, History = Up/Ctrl+R. Text starting with `!` turns the composer into `.composer.shell` (mono, accent
border; Send becomes Run). Long pastes become the CLI's `[Pasted text #N +L lines]` placeholder in the text (kept
verbatim for history compatibility, not translated); a trailing blank is trimmed on send.
Examples: [packages/ui/src/Composer.tsx:184](../packages/ui/src/Composer.tsx#L184), [packages/ui/src/Composer.tsx:200](../packages/ui/src/Composer.tsx#L200), [packages/ui/src/Composer.tsx:199](../packages/ui/src/Composer.tsx#L199).

### Suggestion list — `.suggestions`, `.suggestion` (`.active`), `.suggestion-label`, `.suggestion-detail`
`role="listbox"` floating above the composer for `/` commands, `@` files and previous messages. The textarea keeps
the focus and points at the active option with `aria-activedescendant` (+ `aria-controls`); a click picks on
`mousedown` with `preventDefault`, so focus never leaves the field. Label mono, detail muted and ellipsized; an
empty list says "No matches".
Examples: [packages/ui/src/Suggestions.tsx:22](../packages/ui/src/Suggestions.tsx#L22), [packages/ui/src/Composer.tsx:186](../packages/ui/src/Composer.tsx#L186).

### Attachments — `.attachments`, `.attachment`, `.attachment-thumb`
Row of images waiting to be sent, each a thumbnail (with `alt`) and a `.tab-close` × whose `aria-label` names the
image. Only images Claude can read (PNG, JPEG, GIF, WebP, within the protocol limits); refusals go to the chat's
error line.
Example: [packages/ui/src/Composer.tsx:188](../packages/ui/src/Composer.tsx#L188).

### Image thumbnail — `.image-thumb` (+ `.user-images`)
Image of a sent message, fetched from core (`blob.get`) when shown, as a `data:` URL (allowed by the CSP); a
`.chip` with the same label until it loads. Same size rules as `.attachment-thumb`.
Example: [packages/ui/src/ItemView.tsx:47](../packages/ui/src/ItemView.tsx#L47), [packages/ui/src/ItemView.tsx:76](../packages/ui/src/ItemView.tsx#L76).

### Queue — `.item.queue`, `.queue-list`, `.queue-entry`, `.queue-text`
`<section aria-label="Queued messages">` at the end of the conversation: one dashed row per waiting message (text
ellipsized, a `.chip` with the image count) with "Send now" (`.button`) and "Remove" (`.button.danger`).
Examples: [packages/ui/src/QueueList.tsx:14](../packages/ui/src/QueueList.tsx#L14), [packages/ui/src/ChatView.tsx:114](../packages/ui/src/ChatView.tsx#L114).

### Shell item — `.item.shell` (`.failed`), `.shell-command`
A `!` command in the conversation: `$ command` in bold mono, the output preformatted, "running…" while it runs and
the exit code when it failed (`.failed` adds a `--danger` left rule).
Example: [packages/ui/src/ItemView.tsx:53](../packages/ui/src/ItemView.tsx#L53).

### Screen-reader text — `.sr-only`
Invisible but accessible text for `aria-live` regions, one region per message type (rule 7).
Example: [packages/ui/src/ChatView.tsx:128](../packages/ui/src/ChatView.tsx#L128).

### Connection banner — `.connection-banner`
Thin status strip shown while the connection is being re-established.
Example: [packages/ui/src/App.tsx:125](../packages/ui/src/App.tsx#L125).

### Version line — `.version-line`
One line of technical versions in `--font-mono` / `--text-muted`, bottom right.
Example: [packages/ui/src/App.tsx:129](../packages/ui/src/App.tsx#L129).

### Tab bar — `.tab-bar`, `.tab`, `.tab-title`, `.tab-field`, `.tab-close`, `.new-tab`
`role="tablist"` row of open sessions. A `.tab` (`role="tab"`, `.active` when shown) holds a status badge, the
title (double click or F2 renames into a `.tab-field`, confirmed only with Enter; Esc cancels with
`preventDefault`) and a `.tab-close` ×. Ctrl+Shift+←/→ moves the focused tab. `.new-tab` opens the start
screen (`aria-pressed` while it is shown). The shown tab's content sits in a `.tab-panel` (`role="tabpanel"`).
Examples: [packages/ui/src/TabBar.tsx:100](../packages/ui/src/TabBar.tsx#L100), [packages/ui/src/TabBar.tsx:63](../packages/ui/src/TabBar.tsx#L63), [packages/ui/src/TabBar.tsx:70](../packages/ui/src/TabBar.tsx#L70), [packages/ui/src/TabBar.tsx:104](../packages/ui/src/TabBar.tsx#L104), [packages/ui/src/App.tsx:118](../packages/ui/src/App.tsx#L118).

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


## Touch layout (PWA, `layout: 'mobile'`)
One screen at a time instead of the tab bar; same tokens and the same binding rules (44 px targets, rule 9's
visible controls, safe areas of the notch and home bar via `env(safe-area-inset-*)`, fields at 16 px so iOS does
not zoom). Approved direction: the clickable prototype (artifact "claude-wrap mobile").

### Mobile frame — `.app.mobile`, `.m-topbar`, `.m-title`, `.m-subtitle`, `.m-scroll`, `.m-actions`
`.m-topbar`: 52 px bar with icon buttons left/right and a `.m-title` (title + muted `.m-subtitle`) in between.
`.m-scroll`: the scrolling body (gap-spaced sections). `.m-actions`: the bottom action bar (primary action, clears
the home bar).
Examples: [packages/ui/src/MobileApp.tsx:54](../packages/ui/src/MobileApp.tsx#L54), [packages/ui/src/MobileApp.tsx:63](../packages/ui/src/MobileApp.tsx#L63), [packages/ui/src/MobileApp.tsx:74](../packages/ui/src/MobileApp.tsx#L74).

### Icon button — `.icon-button` (`.glyph`), `.icon`, `.icon-dot`
44×44 borderless button holding an `Icon` (line icon in the text colour) or a mono glyph (`/`, `@`); always with an
`aria-label`. `.icon-dot` marks something waiting elsewhere (back button: another session waits).
Examples: [packages/ui/src/MobileChatHeader.tsx:47](../packages/ui/src/MobileChatHeader.tsx#L47), [packages/ui/src/MobileChatHeader.tsx:49](../packages/ui/src/MobileChatHeader.tsx#L49), [packages/ui/src/MobileComposerTools.tsx:28](../packages/ui/src/MobileComposerTools.tsx#L28), [packages/ui/src/Icon.tsx:17](../packages/ui/src/Icon.tsx#L17).

### Row list — `.m-list`, `.m-row`, `.m-row-main`, `.m-row-title`, `.m-row-sub`
Grouped rounded list of 56 px rows: optional status badge, a full-width `.m-row-main` button (bold title, muted
ellipsized subtitle) and an optional trailing icon button or action. Sessions, folders, devices.
Examples: [packages/ui/src/MobileApp.tsx:25](../packages/ui/src/MobileApp.tsx#L25), [packages/ui/src/FolderBrowser.tsx:35](../packages/ui/src/FolderBrowser.tsx#L35), [packages/ui/src/SettingsScreen.tsx:48](../packages/ui/src/SettingsScreen.tsx#L48).

### Bottom sheet — `.scrim`, `.sheet`, `.sheet-title`, `.menu` (`.menu-value`)
Dialog from the bottom over a scrim, opened only by a user action (`Sheet` component): focus on its first field or
on the sheet, never on a button; scrim tap or Esc closes. `.menu`: 50 px rows, `role="menuitemradio"` +
`aria-checked` shows the current choice with a ✓, `.danger` for closing actions, `.menu-value` for the current value.
Examples: [packages/ui/src/Sheet.tsx:18](../packages/ui/src/Sheet.tsx#L18), [packages/ui/src/MobileChatHeader.tsx:62](../packages/ui/src/MobileChatHeader.tsx#L62), [packages/ui/src/MobileComposerTools.tsx:34](../packages/ui/src/MobileComposerTools.tsx#L34).

### Request dock — `.request-dock`
On the phone Claude's request (the usual `.request-panel`) sits between the conversation and the composer, at most
55 % of the height, scrolling inside; the composer stays reachable. Answering does not focus the composer (the
keyboard would cover the conversation).
Example: [packages/ui/src/ChatView.tsx:124](../packages/ui/src/ChatView.tsx#L124).

### Touch composer — `.composer-tools`, `.mode-chip` (`.mode-swatch`), `.send-round` (`.stop`)
Under the field: Photo, History, `/`, `@` icon buttons and the mode chip (a dot coloured by risk: accept edits green,
plan accent, auto / don't ask danger) that opens the mode sheet. The round send button becomes Stop while Claude
works and nothing is typed. Enter adds a line on the phone.
Examples: [packages/ui/src/MobileComposerTools.tsx:21](../packages/ui/src/MobileComposerTools.tsx#L21), [packages/ui/src/MobileComposerTools.tsx:34](../packages/ui/src/MobileComposerTools.tsx#L34), [packages/ui/src/Composer.tsx:249](../packages/ui/src/Composer.tsx#L249).

### Folder browser — `.folder-browser`, `.folder-path`
Backend folder picker (remote server; desktop on a remote backend later): mono path, `..` row, subfolders, New
folder (inline field), and the primary "Use <path>". Used by the start screen whenever there is no native dialog.
Examples: [packages/ui/src/FolderBrowser.tsx:35](../packages/ui/src/FolderBrowser.tsx#L35), [packages/ui/src/StartScreen.tsx:74](../packages/ui/src/StartScreen.tsx#L74).

### Settings — `.settings-section`, `.toggle-row` (`.toggle`), `.pair-code`, `.pair-link`
Sections with an uppercase `.label` heading. `.toggle-row`: a whole-row label with a checkbox (push on/off) and its
state as subtitle. `.pair-code` / `.pair-link`: the one-time code (large mono) and its link, with Copy. Revoke and
Unpair use a two-step confirmation button, no browser dialog.
Examples: [packages/ui/src/SettingsScreen.tsx:46](../packages/ui/src/SettingsScreen.tsx#L46), [packages/ui/src/SettingsScreen.tsx:113](../packages/ui/src/SettingsScreen.tsx#L113), [packages/ui/src/SettingsScreen.tsx:76](../packages/ui/src/SettingsScreen.tsx#L76).

### Pairing screen — `.pair`, `.pair-mark`, `.pair-steps`, `.pair-error`
First screen of an unpaired PWA: accent monogram, title, explanation; in iPhone Safari the install steps (pairing
there would pair Safari, not the app), in the installed app the link-or-code field and Pair.
Examples: [packages/ui/src/PairScreen.tsx:36](../packages/ui/src/PairScreen.tsx#L36), [packages/ui/src/PairScreen.tsx:51](../packages/ui/src/PairScreen.tsx#L51).

### Backend switcher — `.shell`, `.backend-bar`, `.backend` (`[aria-pressed]`, `.add`), `.servers-panel`
Desktop with several backends: a 28 px pill row above the tab bar — "This PC", each paired server (a pulsing
`.badge.waiting` when that hidden backend has a session waiting; its label joins the button's name), and
"Servers…" on the right, which opens the `.servers-panel` (a `.request-panel` with `aria-label` "Servers": paste a
pairing link + optional name to add, Remove with a two-step confirmation). Every backend's connection stays open.
Examples: [packages/ui/src/DesktopShell.tsx:132](../packages/ui/src/DesktopShell.tsx#L132), [packages/ui/src/DesktopShell.tsx:134](../packages/ui/src/DesktopShell.tsx#L134), [packages/ui/src/DesktopShell.tsx:64](../packages/ui/src/DesktopShell.tsx#L64).
