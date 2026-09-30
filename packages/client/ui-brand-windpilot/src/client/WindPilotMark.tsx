/**
 * The WindPilot mark: a cloud, drawn here rather than imported.
 *
 * The shared icon set carries no cloud, and adding one there would ship a new
 * primitive to every client to serve one brand. A brand mark is drawn where it
 * is used, which is also what lets this package be removed by removing its
 * Loader row.
 *
 * @module @deepseek-ai/dsh-client-ui-brand-windpilot/WindPilotMark
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** Material's `cloud` silhouette, in a 24×24 view box. */
const CLOUD_PATH = 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z'

/** What a brand mark seat passes: the requested square edge, and the hero's class. */
export interface WindPilotMarkProps {
  /** Requested square edge in pixels. */
  readonly size: number
  /** Host class preserving the surrounding mark geometry, when the seat supplies one. */
  readonly className?: string | undefined
}

/** The mark's props as a seat occupant: geometry plus this namespace's copy. */
export type WindPilotMarkOccupantProps = WindPilotMarkProps & PropsLocale<'windpilotBrand'>

/**
 * Draw the WindPilot cloud at the edge the host surface asks for.
 * @param props - the requested edge, the host class, and the brand namespace's copy.
 * @returns the mark, labelled for assistive technology.
 */
export function WindPilotMark({ size, className, t }: WindPilotMarkOccupantProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={t('brand.markLabel')}
      fill="currentColor"
    >
      <path d={CLOUD_PATH} />
    </svg>
  )
}
