/**
 * `windpilotBrand` dictionaries for the WindPilot brand occupants.
 *
 * The namespace is declared here because this package owns it: another package
 * typing `PropsLocale<'windpilotBrand'>` gets its `t` checked against exactly
 * these keys.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'windpilotBrand'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'brand.wordmark': 'WindPilot',
  'brand.headline': '向未知天气寻找答案',
  'brand.tagline': '气象智能体平台',
  'brand.markLabel': 'WindPilot 标识',
  // The team footer is the brand's own line, kept as written in every locale
  // like the headline; only descriptive copy is translated.
  'team.footer': '风云 AI组',
} satisfies Record<string, string>

/** Key set of this namespace, taken from the Chinese dictionary. */
export type WindPilotBrandKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'brand.wordmark': 'WindPilot',
  // The slogan is the brand's own line and stays as written in every locale,
  // like the wordmark; only descriptive copy is translated.
  'brand.headline': '向未知天气寻找答案',
  'brand.tagline': 'Meteorology agent platform',
  'brand.markLabel': 'WindPilot mark',
  'team.footer': '风云 AI组',
} satisfies Record<WindPilotBrandKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Brand copy: the platform tagline and the mark's accessible name. */
    windpilotBrand: WindPilotBrandKey
  }
}
