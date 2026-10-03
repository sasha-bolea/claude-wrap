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
Examples: [packages/ui/src/App.tsx:98](../packages/ui/src/App.tsx#L98), [packages/ui/src/ChatView.tsx:94](../packages/ui/src/ChatView.tsx#L94).

### Screen container — `.screen`
Full-height page area with centred content; a `[role='alert']` inside it is shown in `--danger`. Use for whole-screen states (connecting, connection error).
Example: [packages/ui/src/App.tsx:131](../packages/ui/src/App.tsx#L131).

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
Scrolling column of transcript items, each `.item` capped at `--content-width`. Kinds: `.item.user` (filled bubble; sent images above the text in `.user-images`, see Image thumbnail; `.pending` while Claude has not read it yet — sent mid-turn: faded, with a "waiting" chip), `.item.assistant-text` (markdown, rule 10), `.item.thinking` (italic, left rule), `.item.tool` (see Tool card), `.item.turn-end` (right-aligned stats / "Interrupted", `.failed` in `--danger`), `.item.notice` (`.info` / `.warning` / `.error`), `.item.local-output` (preformatted block), `.item.shell` (see Shell item).
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
Example: [packages/ui/src/App.tsx:119](../packages/ui/src/App.tsx#L119).

### Version line — `.version-line`
One line of technical versions in `--font-mono` / `--text-muted`, bottom right.
Example: [packages/ui/src/App.tsx:123](../packages/ui/src/App.tsx#L123).

### Tab bar — `.tab-bar`, `.tab`, `.tab-title`, `.tab-field`, `.tab-close`, `.new-tab`
`role="tablist"` row of open sessions. A `.tab` (`role="tab"`, `.active` when shown) holds a status badge, the
title (double click or F2 renames into a `.tab-field`, confirmed only with Enter; Esc cancels with
`preventDefault`) and a `.tab-close` ×. Ctrl+Shift+←/→ moves the focused tab. `.new-tab` opens the start
screen (`aria-pressed` while it is shown). The shown tab's content sits in a `.tab-panel` (`role="tabpanel"`).
Examples: [packages/ui/src/TabBar.tsx:100](../packages/ui/src/TabBar.tsx#L100), [packages/ui/src/TabBar.tsx:63](../packages/ui/src/TabBar.tsx#L63), [packages/ui/src/TabBar.tsx:70](../packages/ui/src/TabBar.tsx#L70), [packages/ui/src/TabBar.tsx:104](../packages/ui/src/TabBar.tsx#L104), [packages/ui/src/App.tsx:99](../packages/ui/src/App.tsx#L99).

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


## Touch layout (PWA, `layout: 'mobile'`) — the approved prototype
The PWA renders [`TouchApp`](../packages/ui/src/touch/TouchApp.tsx) with its own stylesheet,
[packages/ui/src/touch.css](../packages/ui/src/touch.css): the prototype's CSS ported as it is (prototype delivery:
`NOTE-CONSEGNA.md` §1 screens, §3 rules). The PWA loads **only** `touch.css`; the desktop keeps `style.css` until
sub-phase C2 moves it to the same elements. Components live in `packages/ui/src/touch/` and are used by the touch
layout only (the old mobile components are gone).

**Touch tokens** (same names as the prototype; light on `:root`, dark under `prefers-color-scheme` and again under
`:root[data-theme="dark"]` so the theme chosen in Settings wins both ways, `data-theme="light"` likewise):
`--background`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-text`,
`--danger`, `--success`, `--frame` (around the device box on a wide screen), `--scrim`, `--radius`, `--space`, `--font`,
`--font-mono`.

**Touch rules** (binding, on top of the general ones):
1. **One screen at a time from a stack** (`go` / `back` / `backTo` / `reset` in the `Touch` context); screens stay
   mounted, so going back finds them as they were. A screen that goes back inside itself first (up a folder in Home
   and File) registers `useBackHandler`. **Swipe from the left edge = Back** (the screen follows the finger, the one
   below shows; none while a sheet is open).
2. **Sheets from the bottom for every menu and confirmation** (`openSheet({ title, path?, body, field? })`): slide up
   with a fade, drag down / scrim / × / Esc close; a sheet opened from another goes back to it; a screen entered from
   a sheet (the session menu) opens it again, without animation, when you come back. Focus goes to the sheet's title
   (or its first field when `field`), **never to a button**. The body is an element that reads live state from the
   context.
3. **Claude's requests are part of the conversation** (`.request` card): the field for a reason, "Other…" or "what to
   change" appears only after choosing the answer that needs it; nothing focuses a granting button.
4. **Very little text; the state is shown** (badges, chips, the dot on back and on the Sessions button). Every
   icon-only button has an `aria-label`; state changes go to the `aria-live` region (`announce`).
5. **Targets ≥ 44 px, safe areas** (`env(safe-area-inset-*)`), **fields at 16 px** (`input, textarea, select`: smaller
   text makes iOS zoom in on focus), **no zoom** (viewport `maximum-scale=1`, `touch-action: manipulation` on `html`,
   pinch gestures cancelled by the PWA host), **portrait only** (manifest `orientation: portrait`, which iOS ignores:
   there a phone turned sideways gets `.rotate-notice`), `prefers-reduced-motion` turns animations off.
6. **iPhone keyboard** (decision 10): the composer floats over the chat (`.dock`, its height in `--dock-h`), the field
   takes focus on `touchend` with `preventScroll`, the keyboard height comes from `visualViewport`
   ([keyboard.ts](../packages/ui/src/touch/keyboard.ts)) and `.device.kb-open` drops the bottom safe area; drags on the
   dock never scroll the page. A field that must open the keyboard from a tap on another screen is focused in the same
   tap (`flushSync` then `focus`), as in New note.
7. **Toasts and the undo bar**: `toast(text)` for outcomes; `snack(text, undo)` with Restore for deletions that can be
   undone (5 s). Failures: `fail(error)` (toast with the reason).

**Splash screens** of the installed app: the accent "cw" mark on `--background`, light and dark, one PNG per iPhone
screen size, generated from the token colours by [apps/mobile/scripts/icons.ts](../apps/mobile/scripts/icons.ts).

### Device and screens — `.device`, `.screen-host`, `.screen` (`.enter`, `.dragging`), `.scroll`, `.pad` (`.tight`, `.settings`)
`.device`: the app box (full screen on a phone or touch device, a framed 410 px box on a wide screen). `.screen-host`
wraps each stack entry (`display: contents`, `hidden` below the top). `.screen`: one screen — top bar, `.scroll` body
with a `.pad` grid (16 px gaps; `.tight` 10 px; `.settings` 22 px), optional `.sticky-actions`.
Examples: [TouchApp.tsx:219](../packages/ui/src/touch/TouchApp.tsx#L219), [TouchApp.tsx:226](../packages/ui/src/touch/TouchApp.tsx#L226), [FilesScreen.tsx:218](../packages/ui/src/touch/FilesScreen.tsx#L218).

### Top bar — `.topbar`, `h1` (`.sub`, `.pad-left`), `.title-btn` (`.title-text`)
52 px bar: back icon button, the title with its small `.sub` line (path, state), icon buttons on the right. In the
chat the title is a `.title-btn` (badge + title + folder) that opens the session menu.
Examples: [FilesScreen.tsx:211](../packages/ui/src/touch/FilesScreen.tsx#L211), [ChatScreen.tsx:192](../packages/ui/src/touch/ChatScreen.tsx#L192), [parts.tsx:46](../packages/ui/src/touch/parts.tsx#L46).

### Icon button — `.icon-btn` (`.dot`, `.count`, `.on`, `.dim`)
44×44 line icon ([icons.tsx](../packages/ui/src/touch/icons.tsx), class `.i`, the prototype's set) with `aria-label`.
`.dot`: something waits elsewhere; `.count`: a small number (queue, trash) or a small icon of the set (`countIcon`:
the queue's pause — never an emoji); `.on`: a mode is active (queue); `.dim`: not available now (Torna indietro while
Claude works).
Examples: [parts.tsx:31](../packages/ui/src/touch/parts.tsx#L31), [ChatScreen.tsx:199](../packages/ui/src/touch/ChatScreen.tsx#L199).

### Row list — `.list`, `.row` (`.end-pad`, `.stacked`, `.uploading`), `.row-main`, `.row-title` (`.plain`), `.row-sub`, `.ficon` (`.dir`), `.chevron`
Rounded list of 56 px rows: an icon or badge, a full-width `.row-main` button (title, muted subtitle), then a chip,
a `⋯` icon button or an action button (`.end-pad`). Folders (`.ficon.dir` = project, accent), files, sessions,
devices, trash items. `.stacked`: a row holding a control under its title (theme). A folder of the Home ends with a
plain row for the files right inside it ("12 file di cui 3 nascosti", never shown with 0 files) that opens the file
explorer on that folder.
Examples: [HomeScreen.tsx:47](../packages/ui/src/touch/HomeScreen.tsx#L47), [HomeScreen.tsx:144](../packages/ui/src/touch/HomeScreen.tsx#L144), [sessions.tsx:88](../packages/ui/src/touch/sessions.tsx#L88), [FilesScreen.tsx:230](../packages/ui/src/touch/FilesScreen.tsx#L230), [SettingsScreen.tsx:164](../packages/ui/src/touch/SettingsScreen.tsx#L164).

### Path — `.crumbs.path-bar` (`.sep`, `[aria-current]`)
The path from the root as mono buttons, scrolled to its end; a part jumps there (`Crumbs` component).
Examples: [parts.tsx:56](../packages/ui/src/touch/parts.tsx#L56), [FilesScreen.tsx:217](../packages/ui/src/touch/FilesScreen.tsx#L217).

### Bottom sheet — `.scrim`, `.sheet` (`.instant`), `.sheet-head`, `.menu` (`.right`, `.danger`, `role="radio"`), `.two-buttons`
`SheetHost` renders the stack of sheets (rule 2). `.menu`: 50 px rows, `.right` for the current value or a hint,
`.danger` for closing/deleting actions, `role="radio"` + `aria-checked` for a choice. `.two-buttons`: Cancel and the
action of a confirmation.
Examples: [SheetHost.tsx:49](../packages/ui/src/touch/SheetHost.tsx#L49), [ChatScreen.tsx:266](../packages/ui/src/touch/ChatScreen.tsx#L266), [HomeScreen.tsx:275](../packages/ui/src/touch/HomeScreen.tsx#L275).

### Buttons and fields — `.button` (`.primary`, `.danger`, `.block`), `.link-btn`, `.field` (`.mono`), `.check-row`, `.segmented` (`.effort`, `.cols-N`), `.toggle-input`
Same roles as on the desktop; `.link-btn`: the light text actions under a list ("Sessioni passate · + Nuova
sessione"); `.segmented`: a radio group as one control (theme, effort levels — `.cols-N` for N levels).
Examples: [HomeScreen.tsx:164](../packages/ui/src/touch/HomeScreen.tsx#L164), [HomeScreen.tsx:312](../packages/ui/src/touch/HomeScreen.tsx#L312), [SettingsScreen.tsx:168](../packages/ui/src/touch/SettingsScreen.tsx#L168), [modelSheets.tsx:66](../packages/ui/src/touch/modelSheets.tsx#L66).

### Cards, chips, badges — `.card` (`.compact`, `.bad`), `.chip` (`.changed`), `.badge` (`.waiting`, `.working`, `.error`)
`.card`: a framed block (session info in the menu, error and trust notices, the 🔜 placeholder). `.chip`: small
state words (draft, queued, "this one"); `.chip.changed`: new / changed by Claude. `.badge`: the session state dot,
pulsing while it waits for you (`Badge` component, with its meaning for screen readers).
Examples: [ChatScreen.tsx:262](../packages/ui/src/touch/ChatScreen.tsx#L262), [FilesScreen.tsx:235](../packages/ui/src/touch/FilesScreen.tsx#L235), [parts.tsx:113](../packages/ui/src/touch/parts.tsx#L113).

### Conversation — `.chat-body`, `.conversation`, `.msg-user` (`.pending`, `.pressed`, `.pending-note`), `.msg-user-row`, `.send-now`, `.msg-ai`, `.think`, `.tool`, `.working-line`, `.turn-end`
Your messages right in a bubble (a long press or right click opens their actions; "waiting" until Claude reads a
message sent while it works, then "read" for a few seconds); Claude's text as markdown; reasoning and tool calls as
`<details>`; the working line with seconds. A waiting message sits in a `.msg-user-row` with `.send-now` on its left:
a 32 px accent-outlined circle with the send arrow (44 px to the touch) that asks the CLI to read it now — its own
send-now, not a Stop (the queue is not paused).
Examples: [Conversation.tsx:71](../packages/ui/src/touch/Conversation.tsx#L71), [Conversation.tsx:93](../packages/ui/src/touch/Conversation.tsx#L93), [Conversation.tsx:128](../packages/ui/src/touch/Conversation.tsx#L128), [Conversation.tsx:106](../packages/ui/src/touch/Conversation.tsx#L106), [Conversation.tsx:193](../packages/ui/src/touch/Conversation.tsx#L193).

### Request card — `.request` (`.preview`, `.grant-row`, `.reveal`)
Claude's permission, question or plan inside the conversation (rule 3); `.reveal` holds the field and the button
that appear after choosing "No…", "Other…" or "Keep planning…".
Examples: [Conversation.tsx:241](../packages/ui/src/touch/Conversation.tsx#L241), [Conversation.tsx:251](../packages/ui/src/touch/Conversation.tsx#L251).

### Conversation scroll indicator — `.scroll-thumb` (`.on`)
On touch screens (`pointer: coarse`) the native indicator of `.conversation` is hidden (iOS draws it down behind the
dock's blur and cannot inset it); a thin thumb runs from the top of the chat to just above the dock, shows while
scrolling and fades out. Mouse screens keep the native scrollbar.
Examples: [ChatScreen.tsx:209](../packages/ui/src/touch/ChatScreen.tsx#L209).

### Ghost and jump — `.ghost` (`.ghost-bubble`), `.jump` (`.ask`, `.dot`)
The ghost: your message whose answer you are reading, once it scrolled off the top and you scroll up from the bottom
(tap = back to it, drag up = put away; hidden at the bottom of the chat and with the keyboard open). The jump button "Torna giù" when not at the bottom (a dot when something new
arrived; "Claude ti aspetta" with a request open).
Examples: [ChatScreen.tsx:212](../packages/ui/src/touch/ChatScreen.tsx#L212), [ChatScreen.tsx:223](../packages/ui/src/touch/ChatScreen.tsx#L223).

### Composer and dock — `.dock`, `.composer` (`.queue-mode`), `.input-box`, `.input-tools`, `.model-btn`, `.mode-btn`, `.send` (`.stop`), `.attachments`, `.doc-chip`, `.linked-note`, `.shell-hint`, `.suggest`
One box floating over the chat behind a blurred fade: the text on top; + (photos and files), model · effort, the
permission mode icon, Stop (while Claude works or waits) and Send below. Queue mode: dashed border, Send adds to the
queue. A linked note shows above the box (× unlinks it).
Examples: [ChatScreen.tsx:230](../packages/ui/src/touch/ChatScreen.tsx#L230), [TouchComposer.tsx:215](../packages/ui/src/touch/TouchComposer.tsx#L215), [TouchComposer.tsx:208](../packages/ui/src/touch/TouchComposer.tsx#L208).

### Queue — `.queue-tray`, `.q-stack`, `.q-card` (`.k0-3`, `.m0-3`), `.q-line`, `.q-play`, `.q-sheet-item`
The deck under the composer: the first card shows the next message, the others peek out on the right; ▶/⏸ beside
it. A tap opens the queue sheet (edit, send now, move, remove).
Examples: [queue.tsx:28](../packages/ui/src/touch/queue.tsx#L28), [queue.tsx:29](../packages/ui/src/touch/queue.tsx#L29).

### Files — `.refresh-note`, `.file-meta`, `.code` (`.line`, `.ln`, `hljs-*`), `.md-view`, `.preview-img`, `.preview-empty`, `.sticky-actions.two`, `.at`
The file list says what Claude created or changed at the end of a turn (`.refresh-note`, chips on the rows). The
preview: code with line numbers coloured by highlight.js (loaded only when a file is opened; four colours from the
tokens), markdown, images (SVG only as `<img>`), "no preview" otherwise; Mention in chat and Download stay at the
bottom (`.at` is the mono "@" glyph).
Examples: [FilesScreen.tsx:221](../packages/ui/src/touch/FilesScreen.tsx#L221), [FilesScreen.tsx:477](../packages/ui/src/touch/FilesScreen.tsx#L477), [FilesScreen.tsx:406](../packages/ui/src/touch/FilesScreen.tsx#L406), [FilesScreen.tsx:438](../packages/ui/src/touch/FilesScreen.tsx#L438).

### Notes — `.note-list`, `.note-card` (`.note-open`, `.note-preview`, `.note-date`, `.note-actions`), `.note-editor`
Cards with the first line as title, two lines of preview, the date and "Usa nel messaggio"; the editor is a
full-height textarea saved as you type.
Examples: [NotesScreen.tsx:51](../packages/ui/src/touch/NotesScreen.tsx#L51), [NotesScreen.tsx:151](../packages/ui/src/touch/NotesScreen.tsx#L151).

### Bars and notices — `.update-bar`, `.banner`, `.toast`, `.snack`, `.viewer`, `.empty-line`, `.rotate-notice`
`.update-bar`: "New version available · Update · ×" under the top bar of Home and chat. `.banner`: the server cannot
be reached. `.toast` / `.snack`: rule 7. `.viewer`: a photo full screen. `.rotate-notice`: "Gira il telefono in
verticale" over the whole app while a phone is sideways (`html[data-landscape]`, set by the PWA host from the
screen's orientation, never the window's: the keyboard shrinks the window).
Examples: [parts.tsx:88](../packages/ui/src/touch/parts.tsx#L88), [parts.tsx:103](../packages/ui/src/touch/parts.tsx#L103), [TouchApp.tsx:233](../packages/ui/src/touch/TouchApp.tsx#L233), [TouchApp.tsx:248](../packages/ui/src/touch/TouchApp.tsx#L248), [apps/mobile/src/main.tsx:58](../apps/mobile/src/main.tsx#L58).

### Placeholders to come — `.later-list`, `.later-skeleton` (`.w70`, `.w80`, `.w90`)
A 🔜 panel or settings page: what it will show, a grey skeleton, and the `/` command to use meanwhile.
Example: [LaterScreen.tsx:42](../packages/ui/src/touch/LaterScreen.tsx#L42).

### Claude accounts — Settings group, account sheet, limit card (existing `.list`/`.row`, `.menu` radios, `.card`)
No new classes: Settings → "Account Claude" is a row list — "Login di Claude Code" first (the backend's own login),
then the added accounts; a tap makes one the account of new sessions (chip "sessioni nuove"), ⋯ removes an added
one; "Aggiungi account" opens a sheet with a name and a **password-type mono token field** (never shown again). The
session menu has an "Account" row (current name on the right) opening a radio `.menu`. While the session's
account is at its usage limit, the conversation shows a `.card` (`role="status"`) with until when and one
"Passa a …" primary button per other account (or "Aggiungi un account").
Examples: [accounts.tsx:19](../packages/ui/src/touch/accounts.tsx#L19), [accounts.tsx:113](../packages/ui/src/touch/accounts.tsx#L113), [accounts.tsx:143](../packages/ui/src/touch/accounts.tsx#L143), [ChatScreen.tsx:289](../packages/ui/src/touch/ChatScreen.tsx#L289), [Conversation.tsx:214](../packages/ui/src/touch/Conversation.tsx#L214).

### Launch and pairing — `.splash` (`.splash-main`, `.splash-state` `.bad`, `.dots`), `.hero-mark` (`.big`), `.hero-title`, `.steps`, `.error-text`, `.code-box`
The launch screen until the server answers (same mark as the iOS splash). The pairing screen: install steps in iPhone
Safari, the link-or-code field in the installed app; right after pairing a sheet offers the notifications once.
`.code-box`: a one-time pairing code (Settings → Add device).
Examples: [Splash.tsx:13](../packages/ui/src/touch/Splash.tsx#L13), [PairScreen.tsx:41](../packages/ui/src/PairScreen.tsx#L41), [SettingsScreen.tsx:284](../packages/ui/src/touch/SettingsScreen.tsx#L284).

## Desktop with several backends
### Backend switcher — `.shell`, `.backend-bar`, `.backend` (`[aria-pressed]`, `.add`), `.servers-panel`
Desktop with several backends: a 28 px pill row above the tab bar — "This PC", each paired server (a pulsing
`.badge.waiting` when that hidden backend has a session waiting; its label joins the button's name), and
"Servers…" on the right, which opens the `.servers-panel` (a `.request-panel` with `aria-label` "Servers": paste a
pairing link + optional name to add, Remove with a two-step confirmation). Every backend's connection stays open.
Examples: [packages/ui/src/DesktopShell.tsx:132](../packages/ui/src/DesktopShell.tsx#L132), [packages/ui/src/DesktopShell.tsx:134](../packages/ui/src/DesktopShell.tsx#L134), [packages/ui/src/DesktopShell.tsx:64](../packages/ui/src/DesktopShell.tsx#L64).
