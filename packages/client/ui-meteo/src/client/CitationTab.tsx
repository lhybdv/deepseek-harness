/**
 * One chunk of indexed material, as the consultation's citation opened it.
 *
 * The tab draws a chunk and nothing else: the address carried the document and
 * the ordinal, so the body has no store, no selection, and no state that a
 * reload could disagree with. The chunk text is shown verbatim — the character
 * range and heading trail are what let a reader check a conclusion against the
 * passage the model cited.
 *
 * A read that answers with `meteo/chunk-not-found` is not an error to retry: the
 * document was removed, or the ordinal was never written, so the body says the
 * citation is gone rather than presenting an empty passage.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo/CitationTab
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MeteoChunk } from '@deepseek-ai/dsh-api-meteo-controller/types'
import type {} from './locales.ts'
import type { MeteoFace } from './face.ts'
import { parseCitationAddress } from './address.ts'
import css from './CitationTab.module.css'

/** The tab's injected business face, as the body receives it. */
export interface CitationTabInjected {
  /** Bound `meteo` calls, of which this body reads one chunk. */
  readonly meteo: MeteoFace
}

/** The tab body's composed props. */
export type CitationTabProps = PropsRuntime<'sidebar.right.pane.tab'> & CitationTabInjected & PropsLocale<'meteo'>

/**
 * Render one citation's evidence.
 * @param props - the tab's own information hook, the bound face, and its copy.
 * @returns the body.
 */
export function CitationTab({ useTabInfo, meteo, t }: CitationTabProps): ReactNode {
  const { tab } = useTabInfo()
  const target = useMemo(() => parseCitationAddress(tab.contentId), [tab.contentId])
  const [chunk, setChunk] = useState<MeteoChunk | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (target === null) return
    setFailure(null)
    const answer = await meteo.readChunk(target.docId, target.ordinal)
    if (answer.ok) {
      setChunk(answer.value)
      return
    }
    setChunk(null)
    setFailure(answer.error.code === 'meteo/chunk-not-found'
      ? t('citation.notFound')
      : t('citation.error', { message: answer.error.message }))
  }, [meteo, target, t])

  useEffect(() => {
    void load()
  }, [load])

  if (target === null) return <div className={css.notice}>{t('citation.noAddress')}</div>
  if (failure !== null) return <div className={css.error} role="alert">{failure}</div>
  if (chunk === null) return <div className={css.notice}>{t('citation.loading')}</div>

  return (
    <article className={css.chunk}>
      <header className={css.header}>
        <span className={css.trail}>{chunk.headingPath === '' ? t('citation.label') : chunk.headingPath}</span>
        <span className={css.range}>{t('citation.range', { start: chunk.charStart, end: chunk.charEnd })}</span>
      </header>
      <pre className={css.text}>{chunk.text}</pre>
    </article>
  )
}
