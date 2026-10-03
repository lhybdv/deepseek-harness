import { describe, expect, it } from 'vitest'
import { createAnswerLanguageStore } from '../src/client/answer-language-store.ts'

describe('answer-language row store', () => {
  it('adopts the newest settings snapshot and ignores stale revisions', () => {
    const store = createAnswerLanguageStore().create()
    store.actions.sync('en', 2)
    store.actions.sync('zh', 1)
    expect(store.getSnapshot()).toEqual({ active: 'en', revision: 2 })
    store.actions.sync('zh', 2)
    expect(store.getSnapshot()).toEqual({ active: 'zh', revision: 2 })
  })
})
