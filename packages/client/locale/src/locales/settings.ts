/** `settings.locale` namespace dictionaries (the Language row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'language.title': '语言',
  'answerLanguage.title': '回答语言',
  'answerLanguage.chinese': '中文',
  'answerLanguage.english': '英语',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'language.title': 'Language',
  'answerLanguage.title': 'Answer language',
  'answerLanguage.chinese': 'Chinese',
  'answerLanguage.english': 'English',
} satisfies Record<SettingsLocaleKey, string>
