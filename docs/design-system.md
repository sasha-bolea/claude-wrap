# Design system — AtHome

_Living catalogue: updated at the same moment a UI element is added or changed. One UI (`packages/ui`) serves the desktop app and the mobile PWA._

## Binding rules
1. **Colours and spacing only from tokens** (`var(--…)`): never hex values or "magic" px in components.
2. **No inline `style={{…}}`**: a new layout gets a class here and in the stylesheet.
3. **Reuse before creating**: button = `.button`, field = `.field`, button row = `.actions`, screen container = `.screen`. Class names are English.
4. **Palettes only, no light/dark theme**: every colour comes from the palette on the device; a new colour token is derived from the 6 palette colours in `paletteTokens` and must read well on the light and the dark presets.
5. **Accessibility**: every dialog is a `<section>` with `aria-label`; every `select` has `aria-label`; the visible focus (`:focus-visible`) is never removed; animations respect `prefers-reduced-motion`.
6. **Focus is never stolen and never lands on a button that grants something.** A panel that appears by itself (a request from Claude, the trust dialog of a restored tab) does not use `autoFocus`: it has `tabIndex={-1}` and takes focus on the **container**, and only if focus is free (`isFocusFree()`). So Enter or Space can never approve by mistake. Focus moves on tab change skip a user who is typing (`isTyping()`). `autoFocus` is allowed only on elements opened by a user action (rename field, delete confirmation). A handled key that moves focus calls `preventDefault`. **Multi-client**: when a request is answered from another device and its panel disappears, focus moves to the tab panel, never to `body`.
7. **Important state changes are announced** to screen readers with `.sr-only` + `aria-live`, one region per message type (read only when its text changes): request and mode of the active tab, requests in inactive tabs; errors with `role="alert"`, waits with `role="status"`. Exactly one announcement per request.
8. **All UI text goes through `t()`**, and the English and Italian dictionaries are always complete (a missing key fails the typecheck). Direct tone. Free text sent to Claude as a reason always has a sensible default.
9. **Touch** (mobile): every keyboard-only action has a visible control (Stop instead of Esc, mode selector instead of Shift+Tab, history button instead of Up/Ctrl+R, photo/file picker instead of drag). Targets at least 44×44 px.
10. **Untrusted content** (assistant markdown, tool output, MCP resources): no raw HTML, no `dangerouslySetInnerHTML`; remote images render as links.

## Tokens
Defined in [packages/ui/src/touch.css](../packages/ui/src/touch.css) (the old `style.css` of the first desktop UI is gone since C2.5); its `:root` holds the default palette's colours (shown until the app knows the device's palette). A colour palette (Settings → Palette colori, [palette.ts](../packages/ui/src/palette.ts)) overrides the 12 colour tokens inline on `<html>` from 6 chosen colours (background, surface, text, accent, danger, success); the others are mixed from them, so **a new colour token must also be derived in `paletteTokens`**.

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

## Touch app (every host) — the approved prototype
Every host (PWA, desktop) renders [`TouchApp`](../packages/ui/src/touch/TouchApp.tsx) with one stylesheet,
[packages/ui/src/touch.css](../packages/ui/src/touch.css): the prototype's CSS ported as it is (prototype delivery:
`NOTE-CONSEGNA.md` §1 screens, §3 rules, §5 desktop). One screen at a time on a phone, three columns from 1024 px (see
Wide arrangement). Components live in `packages/ui/src/touch/`; the first desktop UI (tab bar, start screen, old chat
and composer, `style.css`) was removed in C2.5.

**Touch tokens** (same names as the prototype; on `:root` the default palette's values, overridden inline by the palette on
the device):
`--background`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-text`,
`--danger`, `--success`, `--frame` (around the device box on a wide screen), `--scrim`, `--radius`, `--space`, `--font`,
`--font-mono`.
`--danger` is a vivid red (`#c62828` on light presets, `#ff6b5e` on dark ones), never a pale one that reads as pink, with at least
4.5:1 contrast on `--background`, `--surface` and `--surface-2` and for `--surface` text on it ([touch.css](../packages/ui/src/touch.css)).

**Touch rules** (binding, on top of the general ones):
1. **One screen at a time from a stack** (`go` / `back` / `backTo` / `reset` in the `Touch` context); screens stay
   mounted, so going back finds them as they were. A screen that goes back inside itself first (up a folder in Home
   and File) registers `useBackHandler`. **Swipe from the left edge = Back** (the screen follows the finger, the one
   below shows; none while a sheet is open).
2. **Sheets from the bottom for every menu and confirmation** (`openSheet({ title, path?, body, field? })`): slide up
   with a fade, drag down (by the head, or by the content once it is at its top; not from fields) / scrim / × / Esc close; a sheet opened from another goes back to it; a screen entered from
   a sheet (the session menu) opens it again, without animation, when you come back. Focus goes to the sheet's title
   (or its first field when `field`), **never to a button**. The body is an element that reads live state from the
   context.
3. **Claude's requests are part of the conversation** (`.request` card): the field for a reason, "Other…" or "what to
   change" appears only after choosing the answer that needs it; nothing focuses a granting button.
4. **Very little text; the state is shown** (badges, chips, the dot on back and on the Sessions button). Every
   icon-only button has an `aria-label`; state changes go to the `aria-live` region (`announce`).
5. **Targets ≥ 44 px, safe areas** (`env(safe-area-inset-*)`), **fields at 16 px** (`input, textarea, select`: smaller
   text makes iOS zoom in on focus), **no zoom** (viewport `maximum-scale=1`, `touch-action: manipulation` on `html`,
   pinch gestures cancelled by the PWA host), **both orientations** (manifest `orientation: any`; `text-size-adjust: 100%` on `html`, otherwise iOS
   enlarges text in landscape and keeps it after turning back), `prefers-reduced-motion` turns animations off.
6. **iPhone keyboard** (decision 10): the composer floats over the chat (`.dock`, its height in `--dock-h`), the field
   takes focus on `touchend` with `preventScroll`, the keyboard height comes from `visualViewport`
   ([keyboard.ts](../packages/ui/src/touch/keyboard.ts)) and `.device.kb-open` drops the bottom safe area; drags on the
   dock never scroll the page. A field that must open the keyboard from a tap on another screen is focused in the same
   tap (`flushSync` then `focus`), as in New note.
7. **Toasts and the undo bar**: `toast(text)` for outcomes; `snack(text, undo)` with Restore for deletions that can be
   undone (5 s). Failures: `fail(error)` (toast with the reason).
8. **Nothing leaves the screen; text wraps** (2026-10-04, Sasha): `.device` breaks long words, paths and links
   anywhere (`overflow-wrap: anywhere`), every box may shrink below its content (`:where(.device *) { min-width: 0 }`;
   icons `flex: none`), images fit. No ellipsis and no sideways scrolling: titles, rows, chips, toasts, tables and code
   (chat blocks, file viewer with a hanging indent under the line number) wrap. Only the fixed-height stack cards (queue,
   tool stack) and the command line of a tool card keep one line, their full text one tap away; previews with a line clamp (ghost, note cards) stay
   clamped; top bar titles (screen and chat) wrap to two lines at most. A grid of one column uses `minmax(0, 1fr)`. The PWA e2e checks no element ends outside the screen.

**Splash screens** of the installed app: the accent "@~" mark on `--background`, one PNG per iPhone screen size, in
the default palette's colours, generated by [apps/mobile/scripts/icons.ts](../apps/mobile/scripts/icons.ts).

### Backend switch (desktop) — `.backend-switch`, `.backend-choices`, `.switch-dot`, `.core-failed`
On top of the Home when the host offers several backends (the desktop: `capabilities.backends` from `DesktopShell`):
a segmented switch **Questo PC | servers** (a dot on a backend where a session waits) and ⋯ "Server…" opening a sheet
to remove a paired server (asked first) or add one from a pairing link. This PC's Home is the list of added folders
with "Aggiungi cartella…" (the system's folder dialog) and "Togli dall'elenco" in a folder's menu; what is deleted there
goes to the system Trash (no "Eliminate di recente"). A local backend that crashed for good shows `.core-failed`.
Examples: [backends.tsx:28](../packages/ui/src/touch/backends.tsx#L28).

### Wide arrangement — `.device.wide` (`.with-panel`), `.col-left`, `.col-center`, `.col-right`, `.panel-tabs`, `.panel-tab`, `.panel-close`, `.window-scrim`, `.window`, `.no-chat`, `.row.current`
From 1024 px of width (desktop, large tablets) the same screens are arranged side by side (NOTE-CONSEGNA §5): the
Home in a 300 px column (with "Aperte", the backend's open sessions, on top — the one in the chat highlighted; its
folder sessions and trash open in the column itself), the chat in the middle without a back arrow, its conversation
padded to ~780 px of content and the composer as wide, **File** and **Note** in its top bar opening and closing a
380 px panel on the right (tabs File | Note and ×; the 🔜 panels, Contesto and Consumo open there too), Settings in a
window over the app (Back or a click outside closes it). A menu opened from a button is a **popover** by it
(`.sheet.popover`, 320 px, below a button in the upper half of the window, above one in the lower half — the composer —
re-placed when its content grows, over a clear scrim); typing sheets and sheets opened from a sheet (confirmations)
are centred dialogs. **Hardware keyboard and mouse** (where a pointer hovers): Enter
sends and Shift+Enter adds a line; Up on the first line / Down on the last browse previous messages and Ctrl+R lists
them (shared with the CLI; none on the phone); Shift+Tab in the field switches the permission mode (not with a request
open); Esc closes the photo, a sheet or popover, the Settings window, otherwise stops Claude in the chat on screen;
files dropped on the chat are attached, on the file explorer uploaded (`.dropping` outline while dragging); pasted
images are attached; right click on your message opens its actions. Each region
has its own Back; a new chat closes the panel; "Menziona in chat" / "Usa nel messaggio" leave the panel open. Below
1024 px the phone arrangement (one screen at a time) is used.
Examples: [TouchApp.tsx:24](../packages/ui/src/touch/TouchApp.tsx#L24), [TouchApp.tsx:468](../packages/ui/src/touch/TouchApp.tsx#L468).

### Device and screens — `.device`, `.screen-host`, `.screen` (`.enter`, `.dragging`), `.scroll`, `.pad` (`.tight`, `.settings`)
`.device`: the app box (full screen on a phone or touch device, a framed 410 px box on a wide screen). `.screen-host`
wraps each stack entry (`display: contents`, `hidden` below the top). `.screen`: one screen — top bar, `.scroll` body
with a `.pad` grid (16 px gaps; `.tight` 10 px; `.settings` 22 px), optional `.sticky-actions`.
Examples: [TouchApp.tsx:326](../packages/ui/src/touch/TouchApp.tsx#L326), [TouchApp.tsx:339](../packages/ui/src/touch/TouchApp.tsx#L339), [FilesScreen.tsx:226](../packages/ui/src/touch/FilesScreen.tsx#L226).

### Top bar — `.topbar`, `h1` (`.sub`, `.pad-left`), `.chat-bar` (`.bar-row`, `.chat-title`), `.model-btn`
52 px bar: back icon button, the title with its small `.sub` line (path, state), icon buttons on the right. The chat bar (`.topbar.chat-bar`, [ChatScreen.tsx:318](../packages/ui/src/touch/ChatScreen.tsx#L318)) has two `.bar-row`s. Row 1: back (phone only), state badge, then `.chat-title` (an `h1`, plain text, not a button, nothing opens on tap): "folder / title" on one line, 15 px, the folder muted and up to 45% of the width, the title in the text colour, each cut with "…" (the title first). Row 2: the `.model-btn` (model name ⌄, 13 px, cut with "…"; the effort is not shown here) on the left, then (wide only) Files and Note, Torna indietro and ⋯ on the right; the session menu opens only from ⋯. The model button that opens the model sheet (models only) as a popover below it. The effort is chosen at the top of the permission-mode sheet (`.segmented.effort`, only for a model with levels; stays open, then the modes; picking a mode closes it); the ⋯ menu has separate "Model" and "Effort" items.
Examples: [FilesScreen.tsx:219](../packages/ui/src/touch/FilesScreen.tsx#L219), [parts.tsx:47](../packages/ui/src/touch/parts.tsx#L47).

### Icon button — `.icon-btn` (`.dot`, `.count`, `.on`, `.dim`, `.accent`)
44×44 line icon ([icons.tsx](../packages/ui/src/touch/icons.tsx), class `.i`, the prototype's set) with `aria-label`.
`.dot`: something waits elsewhere; `.count`: a small number (queue, trash) or a small icon of the set (`countIcon`:
the queue's pause — never an emoji); `.on`: a mode is active (queue); `.dim`: not available now (Torna indietro while
Claude works); `.accent`: the screen's main action as an icon (Note: use in the message).
Examples: [parts.tsx:31](../packages/ui/src/touch/parts.tsx#L31), [ChatScreen.tsx:281](../packages/ui/src/touch/ChatScreen.tsx#L281).

### Row list — `.list`, `.row` (`.end-pad`, `.stacked`, `.uploading`), `.row-main`, `.row-title` (`.plain`), `.row-sub`, `.ficon` (`.dir`), `.chevron`
Rounded list of 56 px rows: an icon or badge, a full-width `.row-main` button (title, muted subtitle), then a chip,
a `⋯` icon button or an action button (`.end-pad`). Folders (`.ficon.dir` = project, accent), files, sessions,
devices, trash items. `.stacked`: a row holding a control under its title. A folder of the Home ends with a
plain row for the files right inside it ("12 file di cui 3 nascosti", never shown with 0 files) that opens the file
explorer on that folder.
Examples: [HomeScreen.tsx:47](../packages/ui/src/touch/HomeScreen.tsx#L47), [HomeScreen.tsx:146](../packages/ui/src/touch/HomeScreen.tsx#L146), [sessions.tsx:211](../packages/ui/src/touch/sessions.tsx#L211), [FilesScreen.tsx:238](../packages/ui/src/touch/FilesScreen.tsx#L238), [SettingsScreen.tsx:119](../packages/ui/src/touch/SettingsScreen.tsx#L119).

### Path — `.crumbs.path-bar` (`.sep`, `[aria-current]`)
The path from the root as mono buttons, scrolled to its end; a part jumps there (`Crumbs` component).
Examples: [parts.tsx:56](../packages/ui/src/touch/parts.tsx#L56), [FilesScreen.tsx:225](../packages/ui/src/touch/FilesScreen.tsx#L225).

### Bottom sheet — `.scrim`, `.sheet` (`.instant`), `.sheet-head`, `.menu` (`.right`, `.danger`, `role="radio"`), `.two-buttons`
`SheetHost` renders the stack of sheets (rule 2). `.menu`: 50 px rows, `.right` for the current value or a hint,
`.danger` for closing/deleting actions, `role="radio"` + `aria-checked` for a choice. `.two-buttons`: Cancel and the
action of a confirmation. A folder's menu starts a session in one tap ("Nuova sessione qui") or with a name ("Nuova
sessione con nome…": a sheet with the name `.field` and Crea): the name is the tab's title and the session's name for
the other sessions, kept; without one the tab takes the title the CLI gives after the first prompt.
Examples: [SheetHost.tsx:49](../packages/ui/src/touch/SheetHost.tsx#L49), [ChatScreen.tsx:350](../packages/ui/src/touch/ChatScreen.tsx#L350), [HomeScreen.tsx:298](../packages/ui/src/touch/HomeScreen.tsx#L298), [HomeScreen.tsx:252](../packages/ui/src/touch/HomeScreen.tsx#L252).

### Buttons and fields — `.button` (`.primary`, `.danger`, `.block`), `.link-btn`, `.field` (`.mono`), `.check-row`, `.segmented` (`.effort`, `.cols-N`), `.toggle-input`
Same roles as on the desktop; `.link-btn`: the light text actions under a list ("Sessioni passate · + Nuova
sessione"); `.segmented`: a radio group as one control (effort levels — `.cols-N` for N levels).
Examples: [HomeScreen.tsx:166](../packages/ui/src/touch/HomeScreen.tsx#L166), [HomeScreen.tsx:335](../packages/ui/src/touch/HomeScreen.tsx#L335), [SettingsScreen.tsx:167](../packages/ui/src/touch/SettingsScreen.tsx#L167), [modelSheets.tsx:91](../packages/ui/src/touch/modelSheets.tsx#L91).

### Cards, chips, badges — `.card` (`.compact`, `.bad`), `.chip` (`.changed`), `.badge` (`.waiting`, `.working`, `.error`, `.unseen`)
`.card`: a framed block (session info in the menu, error and trust notices, the 🔜 placeholder). `.chip`: small
state words (draft, queued, "this one"); `.chip.changed`: new / changed by Claude. `.badge`: the session state dot,
pulsing while it waits for you (`Badge` component, with its meaning for screen readers); `.unseen`: an idle dot in the accent colour, not pulsing, while Claude finished and nobody looked at the chat yet (core's `TabMeta.unseen`; the words stay "idle"). Folder rows take it too when one of their chats is unseen (`badgeClass` in [model.ts](../packages/ui/src/touch/model.ts)).
Examples: [ChatScreen.tsx:346](../packages/ui/src/touch/ChatScreen.tsx#L346), [FilesScreen.tsx:243](../packages/ui/src/touch/FilesScreen.tsx#L243), [parts.tsx:113](../packages/ui/src/touch/parts.tsx#L113).

### Conversation — `.chat-body`, `.conversation`, `.msg-user` (`.pending`, `.pressed`, `.pending-note`), `.msg-user-row`, `.send-now`, `.unsend`, `.msg-ai`, `.msg-peer` (`.from`), `.think`, `.tool`, `.working-line`, `.working-mini`, `.turn-end`
Your messages right in a bubble (a long press or right click opens their actions; "waiting" until Claude reads a
message sent while it works, then "read" for a few seconds); Claude's text as markdown; reasoning and tool calls as
`<details>`; the working line with seconds (see below). A waiting message sits in a `.msg-user-row` with `.send-now` on its left:
a 32 px accent-outlined circle with the send arrow (44 px to the touch) that asks the CLI to read it now — its own
send-now, not a Stop (the queue is not paused). Next to it, `.unsend` (same circle, the `unsend` icon, to the left of send-now): "Cancel send" withdraws the message before Claude reads it — it leaves the chat and its text and images go back into the composer after the draft (`useUnsend` in ChatScreen.tsx; the same action is in the long-press sheet of a waiting message). If Claude read it meanwhile, a toast says so. At the bottom of the chat new text is followed with an ease-out glide
(each frame a share of the way left; at once from farther than a screen, with reduced motion; a finger on the chat
stops it), so Claude's streaming never jerks the view. With the keyboard open, a quick drag on the chat (faster than
0.6 px/ms) closes it; a slow one, to read, leaves it open.
The working line (`.working-line`, dot + "Claude is working · 1 min 20 s") is plain scroll content: the last element of the
conversation's text, before the cards ([Conversation.tsx:375](../packages/ui/src/touch/Conversation.tsx#L375)), so it moves with the text.
Once it is out of view (scrolled below the visible area, or hidden behind the floating dock), `.working-mini` shows as a
tab sticking out of the input box's top left edge (same surface and border colour as the box, open at the bottom; passed to
`TouchComposer` as `tab` and rendered inside `.input-box`): it slides out from under the box, no fade. Dot and time only, the full
text as its accessible label, not interactive ([ChatScreen.tsx](../packages/ui/src/touch/ChatScreen.tsx), `tab=` on `TouchComposer`); it leaves when the line is back in view or
the turn ends. The chat finds out with an `IntersectionObserver` rooted on `.conversation` whose bottom edge is pulled
up by the dock's height, re-created when the line appears or the dock changes height
([ChatScreen.tsx:224](../packages/ui/src/touch/ChatScreen.tsx#L224)); it never writes `scrollTop`. Both read the same timer and text
(`useWorkingText` in [Conversation.tsx:323](../packages/ui/src/touch/Conversation.tsx#L323)).
A message from another Claude session (`SendMessage`; it starts a turn here by itself) is a `.msg-peer`: on the left,
on `--surface` framed by `--border` with a 3 px accent left edge, "Da @nome" on top in the accent with the chats icon
("Da un'altra sessione" when the sender gave no name; a message without text shows nothing),
its text as markdown like Claude's — never on the right, where your own messages are.
Examples: [Conversation.tsx:77](../packages/ui/src/touch/Conversation.tsx#L77), [Conversation.tsx:99](../packages/ui/src/touch/Conversation.tsx#L99), [Conversation.tsx:217](../packages/ui/src/touch/Conversation.tsx#L217), [Conversation.tsx:127](../packages/ui/src/touch/Conversation.tsx#L127), [Conversation.tsx:299](../packages/ui/src/touch/Conversation.tsx#L299), [Conversation.tsx:236](../packages/ui/src/touch/Conversation.tsx#L236).

### Tool stack — `.tool-group`, `.tool-stack` (`.m1`–`.m3`), `.tool-card` (`.k0`–`.k3`), `.tool-count`, `.tool-collapse`
Two or more tool calls in a row form a stack like the queue's: the last call in front (name, summary, state and the
count), up to three before it peeking out **above** it, 7 px each and a little narrower each. A tap spreads them out
into their `.tool` cards one under the other, each sliding from its place in the stack (measured before and after,
Web Animations; none with reduced motion); "Raggruppa i N comandi" (`.tool-collapse`, up arrow) stacks them again.
A single call stays a plain `.tool` card.
Examples: [Conversation.tsx:143](../packages/ui/src/touch/Conversation.tsx#L143), [Conversation.tsx:180](../packages/ui/src/touch/Conversation.tsx#L180).

### Request card — `.request` (`.preview`, `.grant-row`, `.reveal`)
Claude's permission, question or plan inside the conversation (rule 3); `.reveal` holds the field and the button
that appear after choosing "No…", "Other…" or "Keep planning…".
A form with several questions shows one at a time, like the CLI: a row of `.question-step` pills (`.question-steps`,
one per header; current = accent outline with `aria-current="step"`, answered = filled; tap = go to it) above the
question; choosing an answer of a single-choice question moves on, "Avanti" otherwise; "Rispondi" on the last step
sends them all. A single question shows no steps. Once answered (or skipped) the form stays in the chat as `.answered`
("Le tue risposte": each question with its header chip, `.answered-q`, and the answer given, `.answered-a`; `.none`
= "Nessuna risposta"), never inside a stack of tool calls. Examples: [Conversation.tsx:487](../packages/ui/src/touch/Conversation.tsx#L487), [Conversation.tsx:130](../packages/ui/src/touch/Conversation.tsx#L130).
Examples: [Conversation.tsx:354](../packages/ui/src/touch/Conversation.tsx#L354), [Conversation.tsx:364](../packages/ui/src/touch/Conversation.tsx#L364).

### Conversation scroll indicator — `.scroll-thumb` (`.on`)
On touch screens (`pointer: coarse`) the native indicator of `.conversation` is hidden (iOS draws it down behind the
dock's blur and cannot inset it); a thin thumb runs from the top of the chat to just above the dock, shows while
scrolling and fades out. Mouse screens keep the native scrollbar.
Examples: [ChatScreen.tsx:291](../packages/ui/src/touch/ChatScreen.tsx#L291).

### Ghost and jump — `.ghost` (`.ghost-bubble`, `.leaving`), `.jump` (`.ask`, `.dot`)
The ghost: your message whose answer you are reading, once it scrolled off the top and you scroll up from the bottom
(tap = back to it, drag up = put away; hidden at the bottom of the chat, with the keyboard open, and as soon as your next message touches it, so the two never overlap); it slides in from under the top bar and always leaves the same way (also after a drag, from where the finger left it). The jump button "Torna giù" when not at the bottom (a dot when something new
arrived; "Claude ti aspetta" with a request open).
Examples: [ChatScreen.tsx:294](../packages/ui/src/touch/ChatScreen.tsx#L294), [ChatScreen.tsx:307](../packages/ui/src/touch/ChatScreen.tsx#L307).

### Composer and dock — `.dock`, `.composer`, `.input-box`, `.input-tools`, `.mode-btn`, `.queue-btn`, `.send` (`.stop`), `.attachments`, `.doc-chip`, `.shell-hint`, `.suggest`
One box floating over the chat over a light veil (2 px blur, a slightly dark gradient, fading to the page colour only in the last line above the bottom: the chat stays readable under it): the text on top; below it the
+ (photos and files), the permission mode icon and the context gauge on the left; on the right, while Claude works or waits, Stop and the `.send.queue-btn` (a filled 38 px circle like Send and Stop, in the text colour — dark on light, light on dark — so the three actions weigh the same and stay told apart by colour; puts what is written straight into the queue and empties the field — no queue mode; dimmed while nothing is written; count or pause badge: a small 14 px accent circle on its rim; 6 px apart on each side so a tap does not hit the wrong one), then Send, which always sends (the model is in the top bar, the effort in the mode sheet). When Claude is done the queue button goes. A note brought in with "Usa nel messaggio" shows only as text in the field (no card above the box). Composer and box are one `minmax(0, 1fr)` column: a long
file name is cut with "…", never pushing Send off the screen.
Examples: [ChatScreen.tsx:314](../packages/ui/src/touch/ChatScreen.tsx#L314), [TouchComposer.tsx:315](../packages/ui/src/touch/TouchComposer.tsx#L315), [TouchComposer.tsx:308](../packages/ui/src/touch/TouchComposer.tsx#L308).

### Queue countdown — `.countdown`, `.countdown-text`, `.countdown-label`, `.countdown-stop`, `.countdown-ring`
While the chat is on screen, the next queued message does not go at once: the composer shows its text, "Dalla coda:
parte tra N s" and a danger Stop inside a ring that empties in 10 s (`role="status"`). Stop puts the message back into
the field (before what was being written) and the rest of the queue waits for ▶; at 0 it goes. With the chat not on
screen (another screen, the app hidden, nobody connected) the queue goes at once, as before.
Examples: [TouchComposer.tsx:38](../packages/ui/src/touch/TouchComposer.tsx#L38).

### Queue — `.queue-tray`, `.q-front`, `.q-remove`, `.q-stack`, `.q-card` (`.k0-3`, `.m0-3`), `.q-line`, `.q-play`, `.q-sheet-item`
The deck under the composer: the first card shows the next message, the others peek out on the right; ▶/⏸ beside
it. A bin (`.q-remove`, muted, 44 px) on the front card's right end removes the next message at once with a toast; it is
a sibling of the stack button inside `.q-front` (buttons do not nest), and the front card keeps 44 px free for it. A tap
elsewhere opens the queue sheet (edit, send now, move, remove).
Examples: [queue.tsx:28](../packages/ui/src/touch/queue.tsx#L28), [queue.tsx:29](../packages/ui/src/touch/queue.tsx#L29).

### Files — `.refresh-note`, `.file-meta`, `.code` (`.line`, `.ln`, `hljs-*`), `.md-view`, `.preview-img`, `.preview-empty`, `.sticky-actions.two`, `.at`
The file list says what Claude created or changed at the end of a turn (`.refresh-note`, chips on the rows). The
preview: code with line numbers coloured by highlight.js (loaded only when a file is opened; four colours from the
tokens), markdown, images (SVG only as `<img>`), "no preview" otherwise; Mention in chat and Download stay at the
bottom (`.at` is the mono "@" glyph).
Examples: [FilesScreen.tsx:229](../packages/ui/src/touch/FilesScreen.tsx#L229), [FilesScreen.tsx:485](../packages/ui/src/touch/FilesScreen.tsx#L485), [FilesScreen.tsx:414](../packages/ui/src/touch/FilesScreen.tsx#L414), [FilesScreen.tsx:446](../packages/ui/src/touch/FilesScreen.tsx#L446).

### Notes — `.note-list`, `.note-card` (`.note-open`, `.note-preview`, `.note-date`, `.note-actions`), `.note-editor`
Cards with the first line as title, two lines of preview, the date and "Usa nel messaggio"; the editor is a
full-height textarea saved as you type (down to the bottom safe area); in its top bar "Usa nel messaggio" is the
accent `to-chat` icon (a bubble with an arrow in, dimmed while the note is empty) beside the trash.
Examples: [NotesScreen.tsx:51](../packages/ui/src/touch/NotesScreen.tsx#L51), [NotesScreen.tsx:152](../packages/ui/src/touch/NotesScreen.tsx#L152).

### Terminal — `.terminal-screen`, `.terminal-host`, `.terminal-ended`, `.key-bar`, `.key` (`aria-pressed`)
A shell of the backend (xterm.js, loaded on demand; colours from the tokens, its sheet imported by touch.css). Opened
from the session menu ("Terminale": the session's live one, else a new one), from a folder's menu ("Terminale qui")
and, wide, from the Terminale tab of the right panel; the Home's Sessioni view (and the wide left column) lists the
open ones (`terminal` icon, "Terminale · attivo / terminato (codice N)"). On a touch screen the key bar under it
(on the keyboard while typing): Ctrl (lit until the next key), Esc, Tab, arrows, `|`, `~`, `/`; the keys never take
the focus. A shell that ended shows `.terminal-ended` with Chiudi; the ⋯ menu has Copia tutto (the whole output as
text, toast "Output copiato"), Incolla (the clipboard as a paste: bash waits for Enter) and Chiudi il terminale (red,
for every device). Links in the output open outside the app (`openExternal`, else a new tab). Leaving it
(Back, edge swipe; not on a wide window) asks "Chiudere il terminale?" — Lascialo aperto / Chiudi il terminale (red);
under the Home's list, "Chiudi tutti i terminali" (`.link-btn`) asks first, then ends them all.
Examples: [TerminalScreen.tsx:58](../packages/ui/src/touch/TerminalScreen.tsx#L58), [TerminalScreen.tsx:138](../packages/ui/src/touch/TerminalScreen.tsx#L138), [TerminalScreen.tsx:171](../packages/ui/src/touch/TerminalScreen.tsx#L171), [TouchApp.tsx:498](../packages/ui/src/touch/TouchApp.tsx#L498).

### Bars and notices — `.update-bar`, `.banner`, `.toast`, `.snack`, `.viewer`, `.empty-line`
`.update-bar`: "New version available · Update · ×" under the top bar of Home and chat. `.banner`: the server cannot
be reached. `.toast` / `.snack`: rule 7. `.viewer`: a photo full screen.
Examples: [parts.tsx:88](../packages/ui/src/touch/parts.tsx#L88), [parts.tsx:103](../packages/ui/src/touch/parts.tsx#L103), [TouchApp.tsx:359](../packages/ui/src/touch/TouchApp.tsx#L359), [TouchApp.tsx:381](../packages/ui/src/touch/TouchApp.tsx#L381).

### Settings → automatic compaction (existing `.list`, `.row.stacked`, `.segmented.cols-5`, `.row-sub.wrap`)
A row "Compatta quando la conversazione arriva a" with five segments: Standard (Claude Code's own setting), 100k,
200k, 500k, 1M — Claude Code's `autoCompactWindow` (as /autocompact) for every session — and a wrapping hint under
it. A change restarts the live processes (idle now, working at the end of their turn) with the conversations kept.
Examples: [SettingsScreen.tsx:215](../packages/ui/src/touch/SettingsScreen.tsx#L215).

### Settings → new sessions (existing `.list`, `.row.stacked`, `.segmented.effort`, `.menu` via `ModeMenu`)
"Nuove sessioni": a row "Sforzo" with six segments in two rows of three (Del modello, then the five levels) and a
wrapping hint, and a row "Modalità permessi" showing the chosen mode, which opens the same radio menu as the composer's
mode sheet (`ModeMenu`). Both apply to sessions created from then on (forks keep their source's); open ones keep theirs.
Examples: [SettingsScreen.tsx:167](../packages/ui/src/touch/SettingsScreen.tsx#L167), [modelSheets.tsx:75](../packages/ui/src/touch/modelSheets.tsx#L75).

### Settings → colour palettes — `.swatches`, `.swatch`, `.color-row`, `.color-hex`, `.color-pick` (existing `.list`, `.row.current`, `.sticky-actions`, `.two-buttons`)
A row "Palette colori" in the App group (subtitle: the palette on this device) opens the list: the backend's palettes
as radio rows (the 17 presets of [presets.ts](../packages/protocol/src/presets.ts) are added once by the core, then
edited and deleted like the others; a device that never picked one gets the default) (`.row.current` + `aria-checked`) with their 6 `.swatch` circles and a
`⋯` to edit; "Nuova palette" in the sticky bar. The editor: name field, one `.color-row` per colour (label, mono
`.color-hex` field typed by hand, 44 px round native `.color-pick`), the whole app previews the draft; Salva saves and
turns it on here, leaving without saving restores; the bin in the top bar deletes after a confirmation sheet.
With a palette on, the page's icon and manifest links point at their version in its accent (`?accent=`, drawn by the
server), and the PWA shows a `.link-btn` "Icona con questo colore" under the list: it copies a link that opens the app
with that icon, for adding it again to the Home screen (iOS keeps the icon it took when the app was added).
Examples: [SettingsScreen.tsx:141](../packages/ui/src/touch/SettingsScreen.tsx#L141), [PalettesScreen.tsx:46](../packages/ui/src/touch/PalettesScreen.tsx#L46), [PalettesScreen.tsx:54](../packages/ui/src/touch/PalettesScreen.tsx#L54), [PalettesScreen.tsx:81](../packages/ui/src/touch/PalettesScreen.tsx#L81).

### Composer gauge — `.gauge-btn` (`.high`), `.gauge-ring` (`.gauge-track`, `.gauge-fill`), `.gauge-bar`
Right of the model in the composer: a 20 px ring filled to the **highest** of three shares — context window (after the
last turn), the 5-hour and the weekly plan windows of the session's account — no number beside it (the share is in its label and
the sheet); accent, `--danger` from 90%; absent until core has read one. A tap opens a sheet "Contesto e limiti" with
one `.gauge-bar` each (name, `.usage-meter`, then the share in bold · tokens used / window for the context, "Si azzera
…" for the plan windows, which report shares only) and "Compatta ora" (sends `/compact` at once; disabled as
"Compatta quando Claude ha finito" while it works). Core keeps the values (`TabMeta.context`, `planLimits`), read from
the live process at each turn end (plan: the `/usage` call at most once a minute per account, plus every
`rate_limit_event`, the only source for accounts added with a token; saved across restarts) and when the sheet
opens (a dormant session reads the plan through a live one of its account); a window past its reset shows 0% "azzerata".
Examples: [gauge.tsx:24](../packages/ui/src/touch/gauge.tsx#L24), [gauge.tsx:56](../packages/ui/src/touch/gauge.tsx#L56).

### Context and usage panels — `.ctx-total` (`.ctx-percent`), `.ctx-bar` (`.shade0`–`.shade4`, `.reserve`), `.ctx-swatch` (`.free`, `.buffer`, `.deferred`), `.ctx-row`, `.ctx-num`, `.usage-row`, `.usage-head`, `.usage-meter` (`.high`)
Two screens from the session menu (rows without 🔜, above the panels to come). **Context**: a card with "48,5k / 200k
token" and the share in accent, the window as a bar (accent shades per category that fills it, the compaction reserve
in grey at the end, the free part empty), when it compacts by itself and "Compatta ora" (writes `/compact` into the
composer, back to the chat); then the categories as rows with their swatch, tokens and share, the memory files and
the MCP servers. **Usage and limits**: the account and plan in the top bar's sub line; plan windows as rows with a
`meter` (accent, `--danger` from 90%) and "Si azzera …" (time today, else day and time); extra usage; then this
session's cost (with "estimated" under a subscription), time, lines and tokens per model. Both ask again each time
they come back on top; "Lo chiedo a Claude Code…" while waiting.
Examples: [UsageScreens.tsx:55](../packages/ui/src/touch/UsageScreens.tsx#L55), [UsageScreens.tsx:21](../packages/ui/src/touch/UsageScreens.tsx#L21), [UsageScreens.tsx:174](../packages/ui/src/touch/UsageScreens.tsx#L174), [UsageScreens.tsx:153](../packages/ui/src/touch/UsageScreens.tsx#L153).

### Rewind (Torna indietro) — `.rewind-quote`, `.rewind-files`, `.rewind-diff` (`.added`, `.removed`)
Screen `rewind` (a right-panel root on a wide screen): your messages as a `.list` of rows (clamped text, photo count), the latest at the bottom and the list scrolled there; a tap opens a sheet with the message in a `.rewind-quote`, the preview `.card.compact` (files that would change in `.rewind-files`, totals in `.rewind-diff`; `.card.bad` with the CLI's reason when the code cannot be restored) and the `.menu` of actions (code and conversation / conversation / code, the last two only with file changes; Never mind). Every action asks again in a second sheet ("Are you sure?", `.two-buttons` with Cancel and the `.button.danger` action; a failure stays there as `.error-text` `role="alert"`). A conversation restore puts the prompt (and photos) in the chat's composer (`ComposerInsert.images`); a first-message rewind opens the new session's chat. Entry points: the chat's back-arrow icon button, the ⋯ menu, a long press on a message (its actions open at once), Esc twice in an empty field (hardware keyboard).
Examples: [RewindScreen.tsx:139](../packages/ui/src/touch/RewindScreen.tsx#L139), [RewindScreen.tsx:110](../packages/ui/src/touch/RewindScreen.tsx#L110), [RewindScreen.tsx:65](../packages/ui/src/touch/RewindScreen.tsx#L65), [RewindScreen.tsx:32](../packages/ui/src/touch/RewindScreen.tsx#L32), [TouchComposer.tsx:200](../packages/ui/src/touch/TouchComposer.tsx#L200).

### Placeholders to come — `.later-list`, `.later-skeleton` (`.w70`, `.w80`, `.w90`)
A 🔜 panel or settings page: what it will show, a grey skeleton, and the `/` command to use meanwhile.
Example: [LaterScreen.tsx:42](../packages/ui/src/touch/LaterScreen.tsx#L42).

### Claude accounts — Settings group, account sheet, limit card, continue card (existing `.list`/`.row`, `.menu` radios, `.card`; new: `.button.quiet`, `.card-actions`)
No new classes. **One account for every session**: Settings → "Account Claude" is a row list — "Login di Claude
Code" first (the backend's own login), then the added accounts; a tap makes one the account of every session (chip
"in uso"), ⋯ of an added one opens a `.menu` with "Rinomina" (a sheet with the name field, prefilled, and Salva; the
token stays) and "Rimuovi account" (after a confirmation sheet); "Aggiungi account" opens a sheet with a name and a **password-type mono token
field** (never shown again). The session menu has an "Account" row (current name on the right) opening a radio
`.menu`: picking one there switches every session too. While the account is at its usage limit, the conversation
shows a `.card` (`role="status"`) with until when, one quiet "Passa a …" button (`.button.quiet` in `.card-actions`)
per other added account (never Claude Code's login), each taking the row's width but the link beside it (or "Aggiungi un account") and "Annulla" (`.link-btn`: puts the card away for that limit on this device). In a session Claude stopped mid-work (usage limit, or a switch while it worked) the
conversation shows, once the account is free (after a switch, or when the limit resets), a `.card` with why it
stopped (or how many sessions stopped) and `.card-actions`: a quiet "Continua" / "Continua in tutte (N)" and "Non
ora" (`.link-btn`, takes the cards away) (sends "continua" to every stopped session; their queues go on after it).
Examples: [accounts.tsx:19](../packages/ui/src/touch/accounts.tsx#L19), [accounts.tsx:80](../packages/ui/src/touch/accounts.tsx#L80), [accounts.tsx:137](../packages/ui/src/touch/accounts.tsx#L137), [accounts.tsx:170](../packages/ui/src/touch/accounts.tsx#L170), [accounts.tsx:209](../packages/ui/src/touch/accounts.tsx#L209), [Conversation.tsx:327](../packages/ui/src/touch/Conversation.tsx#L327), [ChatScreen.tsx:373](../packages/ui/src/touch/ChatScreen.tsx#L373), [Conversation.tsx:326](../packages/ui/src/touch/Conversation.tsx#L326).

### Launch and pairing — `.splash` (`.splash-main`, `.splash-state` `.bad`, `.dots`), `.hero-mark` (`.big`), `.hero-title`, `.steps`, `.error-text`, `.code-box`
The launch screen until the server answers (same mark as the iOS splash). The pairing screen: install steps in iPhone
Safari (opened from "Icona con questo colore": only those, no "Continua nel browser", since pairing Safari would
waste the one-time code), the link-or-code field in the installed app; right after pairing a sheet offers the
notifications once.
`.code-box`: a one-time pairing code (Settings → Add device), with two copy buttons on the PWA — the link that pairs
the browser at once (`/?browser=1#pair=`) and the link that installs the app (`/?pair=`); the first one used spends the code.
The **setup page** (`SetupScreen`, the install link opened in the browser): the backend's palettes as radio rows with
`.swatches` (as in Settings → Palette colori) — the page previews the one picked and its address and manifest carry it,
with the code, into the installed app's start address — then the install `.steps`; it never pairs the browser. A used
or expired code shows `.error-text`.
Examples: [Splash.tsx:13](../packages/ui/src/touch/Splash.tsx#L13), [PairScreen.tsx:43](../packages/ui/src/PairScreen.tsx#L43), [SettingsScreen.tsx:273](../packages/ui/src/touch/SettingsScreen.tsx#L273), [SettingsScreen.tsx:334](../packages/ui/src/touch/SettingsScreen.tsx#L334), [SetupScreen.tsx:46](../packages/ui/src/SetupScreen.tsx#L46).
