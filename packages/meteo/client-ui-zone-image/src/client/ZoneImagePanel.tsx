/** Two-image upload surface and result rendering for zoning comparison. @module */

import { useState, type ChangeEvent, type ReactNode } from 'react'
import type { ZoneInterpretation } from '@deepseek-ai/dsh-tool-zone-image'
import type { ZoneImageComparisonSession } from './flow.ts'
import { runZoneImageComparison } from './flow.ts'
import css from './ZoneImagePanel.module.css'

/** Structured result returned by the durable comparison tool event. */
export interface ZoneImageResult {
  /** Both structured model interpretations. */
  images: [ZoneInterpretation, ZoneInterpretation]
  /** Statistics-based change assessment in Chinese. */
  judgment: string
  /** SVG comparison artifact. */
  svg: string
  /** Changed-area share from zero to one. */
  changedAreaShare: number
}

/** Panel labels and the active session whose tool result it displays. */
export interface ZoneImagePanelProps {
  /** Locale-owned label lookup. */
  t: (key: string) => string
  /** Current client session that admits uploads and streams durable events. */
  session: ZoneImageComparisonSession
}

/** Upload two zoning maps, submit both through the current session, and render the durable tool result. @param props - locale translator and active session. @returns accessible image comparison form and result panel. */
export function ZoneImagePanel({ t, session }: ZoneImagePanelProps) {
  const [files, setFiles] = useState<[File | null, File | null]>([null, null])
  const [result, setResult] = useState<ZoneImageResult | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const update = (slot: 0 | 1) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    setFiles(previous => slot === 0 ? [file, previous[1]] : [previous[0], file])
  }
  const run = async () => {
    setBusy(true); setError(false)
    try { setResult(await runZoneImageComparison(files, session, t('prompt'))) } catch { setError(true) } finally { setBusy(false) }
  }
  const imageResult = result === undefined ? null : <section className={css.results}>
    <p>{t('changed')}：{(result.changedAreaShare * 100).toFixed(2)}%</p>
    {result.images.map((image, index) => <article key={index} className={css.interpretation}>
      <h3>{index === 0 ? t('first') : t('second')}</h3>
      <p><strong>{t('classification')}：</strong>{image.classification}</p>
      <p><strong>{t('features')}：</strong>{image.features.dominantCategories.join('、')}</p>
      <ul>{image.features.areaShares.map(item => <li key={item.category}>{item.category}：{(item.share * 100).toFixed(1)}%</li>)}</ul>
      <p>{t('legend')}：{image.features.legend.map(item => <span key={item.category}><i style={{ backgroundColor: item.color }} />{item.category} </span>)}</p>
      <p><strong>{t('semantics')}：</strong>{image.semantics}</p>
    </article>)}
    <h3>{t('judgment')}</h3><p>{result.judgment}</p>
    <h3>{t('svg')}</h3><div className={css.svg}><img alt={t('svg')} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} /></div>
  </section>
  const input = (slot: 0 | 1, label: string): ReactNode => <label className={css.upload}>{label}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={update(slot)} /><span>{files[slot]?.name ?? t('upload')}</span></label>
  return <section className={css.panel}>
    <h2>{t('title')}</h2>
    <div className={css.inputs}>{input(0, t('first'))}{input(1, t('second'))}</div>
    <button type="button" disabled={busy || files[0] === null || files[1] === null} onClick={() => void run()}>{busy ? t('analyzing') : t('compare')}</button>
    {error && <p role="alert" className={css.error}>{t('error')}</p>}
    {imageResult}
  </section>
}
