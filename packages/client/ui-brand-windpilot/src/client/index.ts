/**
 * Browser half: the WindPilot brand occupants.
 *
 * Three seats, one brand. The Sidebar's mark and name are the brand a reader sees
 * beside the panel list; the blank-session hero's mark is the same cloud at the
 * larger edge, so the first thing a new session shows is already WindPilot. All
 * three are generic seats declared by the shell — this package fills them and can
 * be removed by removing its Loader row, which is what keeps branding out of the
 * shell.
 *
 * @module @deepseek-ai/dsh-client-ui-brand-windpilot
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { WindPilotHeadline, WindPilotHeroMark, WindPilotName, WindPilotSidebarMark, WindPilotTeamFooter } from './WindPilotBrand.tsx'
import { en, NS, zh } from './locales.ts'

export type { WindPilotBrandKey } from './locales.ts'
export type { WindPilotMarkOccupantProps, WindPilotMarkProps } from './WindPilotMark.tsx'
export type {
  WindPilotHeadlineProps, WindPilotHeroMarkProps, WindPilotNameProps, WindPilotSidebarMarkProps, WindPilotTeamFooterProps,
} from './WindPilotBrand.tsx'

/** Required browser services: the seats and the brand's copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the three brand occupants.
 * @param ctx - client root context carrying the seats.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-brand-windpilot: dictionaries')
  ctx.effect(() => ctx.slots.inject('conversation.hero.headline', () => ctx.slots.register(
    { name: 'conversation.hero.headline', locale: NS },
    WindPilotHeadline,
  )), 'ui-brand-windpilot: session hero headline')
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark', locale: NS },
    WindPilotSidebarMark,
  )), 'ui-brand-windpilot: sidebar mark')
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', locale: NS },
    WindPilotName,
  )), 'ui-brand-windpilot: sidebar name')
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
    { name: 'conversation.hero.brand.mark', locale: NS },
    WindPilotHeroMark,
  )), 'ui-brand-windpilot: session hero mark')
  ctx.effect(() => ctx.slots.inject('conversation.hero.footer', () => ctx.slots.register(
    { name: 'conversation.hero.footer', locale: NS },
    WindPilotTeamFooter,
  )), 'ui-brand-windpilot: welcome footer')
}
