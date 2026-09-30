/**
 * Browser half: the three meteorology conversation cards.
 *
 * Every card is one keyed registration into `tool.call.toolview`, dispatched by
 * the tool name the turn log carries, and every card is a pure function of the
 * frozen call slice: the same metadata the generic Tool row receives. A result
 * whose metadata is missing — an older log, a foreign producer, a truncated
 * window — falls back to the generic input/output body rather than rendering a
 * half-parsed verdict, so a replay never breaks.
 *
 * Composition is the off switch: without this row every meteo call renders as
 * the generic Tool row.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo-chat
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { MeteoConsultCard } from './MeteoConsultCard.tsx'
import { MeteoFocusCard } from './MeteoFocusCard.tsx'
import { MeteoLookupCard } from './MeteoLookupCard.tsx'
import { en, NS, zh } from './locales.ts'

export type { MeteoConsultCardProps } from './MeteoConsultCard.tsx'
export type { MeteoFocusCardProps } from './MeteoFocusCard.tsx'
export type { MeteoLookupCardProps } from './MeteoLookupCard.tsx'
export type { MeteoChatKey } from './locales.ts'
export type { MeteoT } from './meteo-chrome.tsx'
export type {
  MeteoCardBase, MeteoCardState, MeteoConsultModel, MeteoFocusModel, MeteoLookupModel, MeteoToolBlock,
} from './meteo-card-model.ts'
export type {
  MeteoCitationMeta, MeteoClarificationMeta, MeteoConsultMeta, MeteoConsultResultsMeta, MeteoConsultStepMeta,
  MeteoCriterionMeta, MeteoHazardMeta, MeteoLookupMeta, MeteoLookupStationMeta, MeteoSeriesEntryMeta,
  MeteoSeriesRowMeta, MeteoStationMeta, MeteoSuitabilityDayMeta,
} from './meteo-meta.ts'

/** Required browser services: the seat and the namespace's copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the one card per meteo tool.
 * @param ctx - client root context carrying the seat.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-meteo-chat: dictionaries')
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'meteo_consult', locale: NS },
    MeteoConsultCard,
  )), 'ui-meteo-chat: consultation card')
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'meteo_station_lookup', locale: NS },
    MeteoLookupCard,
  )), 'ui-meteo-chat: station lookup card')
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'meteo_set_focus', locale: NS },
    MeteoFocusCard,
  )), 'ui-meteo-chat: session focus card')
}
