import { useEffect, useState, type RefObject } from 'react'

// Shake to Undo (iOS): picking the phone up counts as a shake, and while a text field still has typing history the
// "Undo Typing" alert pops up when the app opens. No web API clears WebKit's undo stack; the editable element owns it,
// so the fields get this number as their `key`: it grows when the app goes to the background, the element is replaced
// and its history is gone (the value is React state, so the text stays). Returns the current number.
export function useUndoReset(): number {
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const reset = () => setGeneration((value) => value + 1)
    const hidden = () => document.visibilityState === 'hidden' && reset()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', reset)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', reset)
    }
  }, [])
  return generation
}

// Keyboard of the installed iPhone app (NOTE-CONSEGNA §4): iOS does not shrink the page when the keyboard opens, it
// scrolls it. The app follows the visual viewport instead (--app-h on the device), so the composer and a sheet being
// typed in sit right on the keyboard; .kb-open marks it open. From the second time on, the remembered keyboard height
// shrinks the app as soon as a field has focus, before iOS pans the page. Scrolled ancestors snap back. The app always
// comes back from the background (or opens) with the keyboard closed: iOS may keep a field focused, or the app shrunk,
// for a keyboard that is no longer there.
export function useKeyboard(device: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = device.current
    if (!viewport || !root) return
    const full = { width: 0, height: 0 }
    let keyboardHeight = 0
    const isField = (element: EventTarget | null) => element instanceof Element && element.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')

    // Follows the visual viewport: height, keyboard state, scrolled boxes put back. With no field focused there is no
    // keyboard: the app fills the screen (CSS height), whatever the visual viewport says — back from the background,
    // iOS can still report the height without the keyboard.
    const fit = () => {
      if (viewport.offsetTop) window.scrollTo(0, 0)
      const typing = isField(document.activeElement)
      if (typing) root.style.setProperty('--app-h', `${viewport.height}px`)
      else root.style.removeProperty('--app-h')
      root.style.transform = typing && viewport.offsetTop ? `translateY(${viewport.offsetTop}px)` : ''
      if (viewport.width !== full.width) Object.assign(full, { width: viewport.width, height: 0 })
      if (!typing) full.height = Math.max(full.height, viewport.height)
      // Open = a field has focus and the visible height is well below the full one (window.innerHeight shrinks with
      // the keyboard on some iOS versions: it cannot be the only reference).
      const open = typing && viewport.height < Math.max(full.height, window.innerHeight, window.screen.height * 0.6) - 120
      root.classList.toggle('kb-open', open)
      if (open) keyboardHeight = full.height - viewport.height
      for (const box of [root, ...root.querySelectorAll<HTMLElement>('.screen, .chat-body, .dock')]) if (box.scrollTop) box.scrollTop = 0
    }
    // Focus on a field with a known keyboard height: shrink now, check the real height a bit later.
    const early = (event: FocusEvent) => {
      if (!isField(event.target) || !keyboardHeight || !full.height) return
      root.style.setProperty('--app-h', `${full.height - keyboardHeight}px`)
      root.classList.add('kb-open')
      setTimeout(fit, 700)
    }
    const soon = () => setTimeout(fit, 50)
    // Leaving: the focused field lets go, so iOS puts the keyboard away. Back: same, and the height is measured again.
    const closed = () => {
      if (isField(document.activeElement)) (document.activeElement as HTMLElement).blur()
      root.classList.remove('kb-open')
      fit()
      setTimeout(fit, 300)
    }
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    document.addEventListener('focusin', early)
    document.addEventListener('focusin', soon)
    document.addEventListener('focusout', soon)
    document.addEventListener('visibilitychange', closed)
    window.addEventListener('pageshow', closed)
    closed()
    return () => {
      viewport.removeEventListener('resize', fit)
      viewport.removeEventListener('scroll', fit)
      document.removeEventListener('focusin', early)
      document.removeEventListener('focusin', soon)
      document.removeEventListener('focusout', soon)
      document.removeEventListener('visibilitychange', closed)
      window.removeEventListener('pageshow', closed)
    }
  }, [device])
}
