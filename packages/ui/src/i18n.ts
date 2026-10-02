import { en, type MessageKey } from './i18n/en.ts'
import { it } from './i18n/it.ts'

const DICTIONARIES = { en, it }

export type Language = keyof typeof DICTIONARIES
export type Translate = (key: MessageKey, params?: Record<string, string>) => string

// Chooses the UI language from a locale tag (e.g. navigator.language). Returns 'it' for it-*, else 'en'.
export function pickLanguage(locale: string): Language {
  return locale.toLowerCase().startsWith('it') ? 'it' : 'en'
}

// Builds t(key, params) for one language; {name} placeholders are replaced by params[name].
export function createTranslator(language: Language): Translate {
  const dictionary = DICTIONARIES[language]
  return (key, params = {}) => dictionary[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] ?? placeholder)
}

// Translator of the UI, in the system language (a user override comes with the settings).
export const t: Translate = createTranslator(pickLanguage(globalThis.navigator?.language ?? 'en'))
