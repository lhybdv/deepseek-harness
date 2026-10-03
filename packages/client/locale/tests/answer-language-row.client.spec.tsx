// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AnswerLanguageRow } from '../src/client/AnswerLanguageRow.tsx'
import type { AnswerLanguageRowComponentProps } from '../src/client/AnswerLanguageRow.tsx'
import { createAnswerLanguageStore } from '../src/client/answer-language-store.ts'

afterEach(cleanup)

function mount(active: 'zh' | 'en' = 'zh') {
  const store = createAnswerLanguageStore().create()
  store.actions.sync(active, 0)
  const setAnswerLanguage = vi.fn()
  const props = {
    useStore: bindSnapshotSelector(store),
    t: (key: string) => ({
      'answerLanguage.title': 'Answer language',
      'answerLanguage.chinese': 'Chinese',
      'answerLanguage.english': 'English',
    }[key] ?? key),
    setAnswerLanguage,
  } as AnswerLanguageRowComponentProps
  render(<AnswerLanguageRow {...props} />)
  return { setAnswerLanguage }
}

describe('AnswerLanguageRow', () => {
  it('shows the selected setting and localized label', () => {
    mount('zh')
    expect(screen.getByText('Answer language')).toBeDefined()
    expect(screen.getByRole('button', { name: /Chinese/ })).toBeDefined()
  })

  it('displays English when the stored preference is English', () => {
    mount('en')
    expect(screen.getByRole('button', { name: /English/ })).toBeDefined()
  })

  it('closes an open language menu without changing the preference', () => {
    const { setAnswerLanguage } = mount('en')
    fireEvent.click(screen.getByRole('button', { name: /English/ }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Chinese' })).toBeNull()
    expect(setAnswerLanguage).not.toHaveBeenCalled()
  })
  it('offers Chinese and English and persists the selected value', () => {
    const { setAnswerLanguage } = mount('zh')
    fireEvent.click(screen.getByRole('button', { name: /Chinese/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    expect(setAnswerLanguage).toHaveBeenCalledExactlyOnceWith('en')
    expect(screen.queryByRole('menuitem', { name: 'Chinese' })).toBeNull()
  })

  it('persists Chinese when selected from English', () => {
    const { setAnswerLanguage } = mount('en')
    fireEvent.click(screen.getByRole('button', { name: /English/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chinese' }))
    expect(setAnswerLanguage).toHaveBeenCalledExactlyOnceWith('zh')
  })
})
