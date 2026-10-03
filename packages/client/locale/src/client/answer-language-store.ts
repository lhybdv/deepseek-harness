/** Snapshot store for the model-answer language settings row. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** State mirrored from the accepted user-settings document. */
export interface AnswerLanguageState {
  /** Selected language id. */
  active: 'zh' | 'en'
  /** Last accepted Host-settings revision. */
  revision: number
}

/** Answer-language row store handle. */
export type AnswerLanguageStore = EngineStoreHandle<AnswerLanguageState, {
  sync: (draft: AnswerLanguageState, language: 'zh' | 'en', revision: number) => void
}>

/** Create the answer-language row store.
 * @returns the store handle.
 */
export function createAnswerLanguageStore(): AnswerLanguageStore {
  return defineStore({
    init: (): AnswerLanguageState => ({ active: 'zh', revision: -1 }),
    actions: {
      sync: (draft, language, revision) => {
        if (revision < draft.revision) return
        draft.active = language
        draft.revision = revision
      },
    },
  })
}
