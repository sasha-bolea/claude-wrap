// Runs before the first paint (a blocking script in index.html's <head>), with the palette saved on this device (same
// storage key as packages/ui/src/palette.ts, ACTIVE_KEY):
// - the page takes the palette's surface colour (the top bar's) at once;
// - iOS's status bar style, read once at launch: with a dark palette "black-translucent", so the app runs under the
//   status bar and the top bar itself (padded by the safe area) is the status bar's background, the same colour;
//   with a light palette or none "default" (black-translucent's text is always white, unreadable on light colours).
var statusBar = 'default'
try {
  var saved = JSON.parse(localStorage.getItem('claude-wrap:palette') || 'null')
  var colors = (saved && saved.colors) || {}
  var hex = /^#[0-9a-f]{6}$/i
  if (typeof colors.surface === 'string' && hex.test(colors.surface)) document.documentElement.style.setProperty('--surface', colors.surface)
  if (typeof colors.background === 'string' && hex.test(colors.background)) {
    // WCAG relative luminance of the background, dark under 0.4 (as paletteTokens in palette.ts).
    var value = parseInt(colors.background.slice(1), 16)
    var light = [value >> 16, (value >> 8) & 255, value & 255].map(function (channel) {
      var c = channel / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    if (0.2126 * light[0] + 0.7152 * light[1] + 0.0722 * light[2] < 0.4) statusBar = 'black-translucent'
  }
} catch (error) {
  // No storage: the base colours of touch.css and the default status bar.
}
var meta = document.createElement('meta')
meta.name = 'apple-mobile-web-app-status-bar-style'
meta.content = statusBar
document.head.appendChild(meta)
