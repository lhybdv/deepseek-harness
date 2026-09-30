/**
 * The three WindPilot brand occupants.
 *
 * Each is a thin adapter from one seat's own owner share to the one mark
 * component, because the seats disagree about what they pass: the Sidebar's mark
 * asks for an edge and nothing else, the blank-session hero adds the class that
 * keeps its larger mark geometry, and the Sidebar's name owns its own content and
 * width. Keeping the mapping here rather than in the mark is what lets the mark
 * stay a plain drawing.
 *
 * @module @deepseek-ai/dsh-client-ui-brand-windpilot/WindPilotBrand
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeroBrandMarkOwnerProps, HeroHeadlineOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './locales.ts'
import { WindPilotMark } from './WindPilotMark.tsx'
import css from './WindPilotBrand.module.css'

/** The Sidebar mark occupant's composed props. */
export type WindPilotSidebarMarkProps = SidebarBrandMarkOwnerProps & PropsLocale<'windpilotBrand'>

/** The blank-session hero mark occupant's composed props. */
export type WindPilotHeroMarkProps = HeroBrandMarkOwnerProps & PropsLocale<'windpilotBrand'>

/** The blank-session hero headline occupant's composed props. */
export type WindPilotHeadlineProps = HeroHeadlineOwnerProps & PropsLocale<'windpilotBrand'>

/** The Sidebar name occupant's composed props. */
export type WindPilotNameProps = SidebarBrandNameOwnerProps & PropsLocale<'windpilotBrand'>

/** The welcome-page footer occupant's composed props. */
export type WindPilotTeamFooterProps = PropsRuntime<'conversation.hero.footer'> & PropsLocale<'windpilotBrand'>

/**
 * Fill the Sidebar's brand mark.
 * @param props - the requested square edge, plus this namespace's copy for the mark's label.
 * @returns the WindPilot cloud at that edge.
 */
export function WindPilotSidebarMark({ size, t }: WindPilotSidebarMarkProps): ReactNode {
  return <WindPilotMark size={size} t={t} />
}

/**
 * Fill the blank-session hero's brand mark.
 * @param props - the requested square edge, the hero's geometry class, and the copy.
 * @returns the WindPilot cloud, carrying the hero's class through unchanged.
 */
export function WindPilotHeroMark({ size, className, t }: WindPilotHeroMarkProps): ReactNode {
  return <WindPilotMark size={size} className={className} t={t} />
}

/**
 * Fill the blank-session hero's headline.
 * @param props - this namespace's copy; the seat supplies no content of its own.
 * @returns the product name, which is what the hero shows beside the mark.
 */
export function WindPilotHeadline({ t }: WindPilotHeadlineProps): ReactNode {
  return <span>{t('brand.headline')}</span>
}

/**
 * Fill the Sidebar's brand name.
 * @param props - this namespace's copy; the seat supplies no content of its own.
 * @returns the wordmark above the platform tagline.
 */
export function WindPilotName({ t }: WindPilotNameProps): ReactNode {
  return (
    <span className={css.name}>
      <span className={css.wordmark}>{t('brand.wordmark')}</span>
      <span className={css.tagline}>{t('brand.tagline')}</span>
    </span>
  )
}

/**
 * Fill the welcome page's footer seat, centered at the column's bottom.
 * @param props - this namespace's copy; the seat supplies no content of its own.
 * @returns the team label.
 */
export function WindPilotTeamFooter({ t }: WindPilotTeamFooterProps): ReactNode {
  return <span className={css.teamFooter}>{t('team.footer')}</span>
}
