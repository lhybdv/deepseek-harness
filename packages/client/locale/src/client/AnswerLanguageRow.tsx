/** General Settings row for choosing the language used in model answers. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnswerLanguageStore } from './answer-language-store.ts'
import css from './LanguageRow.module.css'

/** Injected preference write face. */
export interface AnswerLanguageRowInjected {
  /** Persist a supported model-answer language. */
  setAnswerLanguage: (language: 'zh' | 'en') => void
}

/** Full component props for the answer-language settings row. */
export type AnswerLanguageRowComponentProps = PropsRuntime<'settings.general.item'>
  & PropsStore<AnswerLanguageStore>
  & PropsLocale<'settings.locale'> & AnswerLanguageRowInjected
/** Render the selectable model-answer language row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AnswerLanguageRow({ t, setAnswerLanguage, useStore }: AnswerLanguageRowComponentProps) {
  const active = useStore(s => s.active)
  const [open, setOpen] = useState(false)
  const label = t(active === 'en' ? 'answerLanguage.english' : 'answerLanguage.chinese')
  return (
    <div className={css.row}>
      <div className={css.rowText}><div className={css.title}>{t('answerLanguage.title')}</div></div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'zh', label: t('answerLanguage.chinese') },
          { id: 'en', label: t('answerLanguage.english') },
        ]}
        selectedId={active}
        onSelect={(id) => {
          const language: 'zh' | 'en' = id === 'en' ? 'en' : 'zh'
          setAnswerLanguage(language)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            {label}<IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
