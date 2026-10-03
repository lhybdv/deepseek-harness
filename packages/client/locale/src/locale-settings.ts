/** Locale preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Accepted BCP 47-style language ids. */
export const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** Locale identifiers shipped by the browser client. */
export const LOCALE_IDS = ['zh', 'en'] as const

/** Locale identifier shipped by the browser client. */
export type BuiltInLocaleId = typeof LOCALE_IDS[number]

/** Open locale identifier accepted from language-pack plugins. */
export type LocaleId = string

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit UI locale selection; absence delegates to the browser. */
  preference?: LocaleId
  /** Language required for model answers. */
  answerLanguage: AnswerLanguage
}

/** Supported model-answer languages. */
export const ANSWER_LANGUAGES = ['zh', 'en'] as const

/** Model-answer language id. */
export type AnswerLanguage = typeof ANSWER_LANGUAGES[number]

/** Field carrying the model-answer language preference. */
export const ANSWER_LANGUAGE_FIELD = 'answerLanguage'

/** Model-answer language when no explicit selection is stored. */
export const DEFAULT_ANSWER_LANGUAGE: AnswerLanguage = 'zh'

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsFields = {
  [LOCALE_PREFERENCE_FIELD]: z.string().pattern(LOCALE_ID_PATTERN).required(false),
  [ANSWER_LANGUAGE_FIELD]: z.union([...ANSWER_LANGUAGES]).default(DEFAULT_ANSWER_LANGUAGE),
}

/** Schema for the shared locale preference. */
export const LocaleSettingsSchema = z.object(LocaleSettingsFields)
