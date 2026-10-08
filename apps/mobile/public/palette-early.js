// Runs before the first paint (a blocking script in index.html's <head>): the page takes the saved palette's surface
// colour (the top bar's) at once. iOS keeps the page colour it sees at launch under the status bar for the whole run,
// before the app's own code has applied the palette. Same storage key as packages/ui/src/palette.ts (ACTIVE_KEY).
try {
  var saved = JSON.parse(localStorage.getItem('claude-wrap:palette') || 'null')
  var surface = saved && saved.colors && saved.colors.surface
  if (typeof surface === 'string' && /^#[0-9a-f]{6}$/i.test(surface)) document.documentElement.style.setProperty('--surface', surface)
} catch (error) {
  // No storage: the base colours of touch.css.
}
