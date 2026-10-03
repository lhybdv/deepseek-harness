/** Host registration for the browser locale preference. */
import type {} from '@deepseek-ai/dsh-settings'

import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Volatile, Context } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'
import { ANSWER_LANGUAGE_FIELD, LOCALE_PREFERENCE_FIELD, LocaleSettingsFields } from './locale-settings.ts'
import type { AnswerLanguage } from './locale-settings.ts'

export {
  ANSWER_LANGUAGES, ANSWER_LANGUAGE_FIELD, DEFAULT_ANSWER_LANGUAGE,
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type AnswerLanguage, type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Explicit locale; omission follows the browser. */
  preference: Volatile<string | undefined>
  /** Explicit language used for model answers. */
  answerLanguage: Volatile<AnswerLanguage>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [LOCALE_PREFERENCE_FIELD]: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile(),
  [ANSWER_LANGUAGE_FIELD]: LocaleSettingsFields[ANSWER_LANGUAGE_FIELD].volatile(),
})

/** Host preferences are consumed through configuration forms and prompt context.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings', 'systemPrompt'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    child.effect(() => child.systemPrompt.context({
      name: 'answer-language',
      order: 0,
      text: () => config.answerLanguage.get() === 'en'
        ? 'Answer in English.'
        : '请使用中文回答。',
    }))
  })
}
