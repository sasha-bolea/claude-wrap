// The page that runs a chat widget (packages/ui/widget-frame.html), served by the PWA server and the desktop app under
// this path with its own policy. The chat loads it in an iframe sandboxed without allow-same-origin: an opaque origin
// with no access to the app, its storage or its connection. The policy lets the widget run inline scripts and styles
// and show data:/blob: images, and nothing else: no network, no external scripts, no forms, no nested frames.
// Kept free of imports: the Vite plugin that emits the page loads it in the build config.

export const WIDGET_FRAME_PATH = '/widget-frame.html'

export const WIDGET_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self'"
