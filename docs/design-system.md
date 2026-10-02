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
_None yet: defined with the first UI work (Phase 1b), carried over from the first attempt's palette (`personale/claude wrap/src/renderer/src/stile.css`) with English names._

## Elements
_None yet. Each element added gets: name, classes, when to use it, and a link to a real usage example (file:line)._
