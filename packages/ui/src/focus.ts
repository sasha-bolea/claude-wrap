// Focus helpers behind design-system rule 6: focus is never stolen and never lands on a granting button.

// True if the user is typing in a field: their next keys must not end up elsewhere.
export function isTyping(): boolean {
  const active = document.activeElement as HTMLElement | null
  return Boolean(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable))
}

// True if no control has the focus: only then may a panel that appeared by itself take it.
export function isFocusFree(): boolean {
  return !document.activeElement || document.activeElement === document.body
}
