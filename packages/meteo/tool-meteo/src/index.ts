/**
 * Model-facing meteorological consultation over the harness data and corpus
 * seams: `meteo_consult` gathers the published evidence that bears on a farming
 * or disaster question, `meteo_station_lookup` lists the observing network the
 * question can be anchored to, and `meteo_set_focus` records the place and crop a
 * session has settled on so later turns need not ask again.
 *
 * This package is the Consumer of the M1 demonstration: it owns no data and
 * derives no verdict of its own beyond the published criteria it evaluates. The
 * answer a farmer hears is composed by the model from these findings, which is why
 * every tool here returns evidence with its provenance instead of a conclusion.
 *
 * @module @deepseek-ai/dsh-tool-meteo
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertMeteoLimits, Config, type MeteoLimits } from './config.ts'
import { applyMeteoConsultTool } from './consult.ts'
import { applyMeteoSetFocusTool } from './focus-tool.ts'
import { applyMeteoStationLookupTool } from './station.ts'

export { Config }
export type { MeteoLimits }
export {
  DEFAULT_CONSULT_LIMIT,
  DEFAULT_FORECAST_HOURS,
  DEFAULT_MAX_CLARIFICATION_CANDIDATES,
  DEFAULT_MAX_CONSULT_LIMIT,
  DEFAULT_MAX_SERIES_ROWS,
  DEFAULT_SNIPPET_CHARS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './config.ts'
export { assertMeteoLimits } from './config.ts'
export { consultMetaFromValue, formatConsultOutput, presentConsultCall, presentConsultResult } from './consult.ts'
export type {
  Clarification,
  ClarificationReason,
  ConsultCitation,
  ConsultHazard,
  ConsultIntent,
  ConsultOutput,
  ConsultSlots,
  ConsultStep,
  ConsultStepName,
  ConsultStepStatus,
  SeriesElement,
  SeriesRow,
  StationOrigin,
  StationRef,
} from './consult.ts'
export { capSnippet, consultViewFromResult } from './presentation.ts'
export type { ConsultCitationMeta, ConsultStepMeta, ConsultViewMeta, MetaField, MetaFields } from './presentation.ts'
export { evaluateHazard, evaluateSuitability } from './rules.ts'
export type {
  DaySuitability,
  FiredCriterion,
  HazardFinding,
  HazardInput,
  HazardLevel,
  RuleSample,
  SuitabilityInput,
  Verdict,
} from './rules.ts'
export { formatFocusResult } from './focus-tool.ts'
export type { FocusResult } from './focus-tool.ts'
export { formatStationLookup, lookupScope, presentLookupCall, presentLookupResult } from './station.ts'
export type { StationRecord } from './station.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-meteo'

/** Capability services the model-facing consumer needs. */
export const inject = ['tools', 'meteoData', 'corpus', 'systemPrompt', 'sessionProjections']

/**
 * Register the three consultation tools and the guidance that tells the model when
 * to reach for them. Config defaults are deployment policy: the corpus window, the
 * forecast horizon, how many candidates a clarification may name, and how much of a
 * chunk or reading series reaches the model are never model arguments. Each tool
 * carries `timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce,
 * and every registration is effect-scoped, so disposing the plugin removes the
 * three tools and the prompt section without manual teardown.
 * @param ctx - context whose `tools`, `meteoData`, `corpus`, `systemPrompt`, and
 *   `sessionProjections` services are used.
 * @param config - deployment bounds, with every defaulted field filled in by schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const limits = config as MeteoLimits
  assertMeteoLimits(limits)
  ctx.systemPrompt.section({
    name: 'tool:meteo',
    order: ctx.systemPrompt.getSectionOrder('TOOL_METEO_CONSULT'),
    text: ({ scope }) => ctx.tools.get('meteo_consult', scope) === undefined ? '' : consultGuidance(limits),
  })
  applyMeteoConsultTool(ctx, limits)
  applyMeteoStationLookupTool(ctx, limits)
  applyMeteoSetFocusTool(ctx, limits)
}

/**
 * The standing guidance the model reads before its first consultation. It states
 * the slot contract that lets a colloquial question resolve to one place, the
 * clarification protocol a `needsClarification` result obliges, and the citation
 * and restraint rules that keep a consultation from becoming a fabrication.
 * @param limits - the resolved bounds, because the text names the real numbers.
 * @returns the prompt text of the `tool:meteo` section.
 */
export function consultGuidance(limits: MeteoLimits): string {
  return 'Use meteo_consult before answering any question about conditions, crop work, or disaster risk: it reads the '
    + 'published observations, forecast, activity windows, criteria, and indexed documents for one place and returns '
    + 'their findings with a step trace. Pass every slot you understood (station, crop, activity, period, disaster); '
    + 'an omitted slot falls back to the session focus, so record what a turn settles with meteo_set_focus. When a '
    + 'station could mean more than one place, list the network with meteo_station_lookup and ask the farmer which '
    + 'one with ask_user_question instead of choosing. When the result carries needsClarification, ask that question '
    + 'and do not answer yet. Report only numbers and verdicts the result contains: a step marked unknown is a '
    + 'question the published data does not answer, and an unknown hazard grade means no published criterion held — '
    + 'do not name a level, a threshold, or a date the result did not give. Cite every conclusion drawn from a '
    + `corpus finding by document title, chunk ordinal, and character range; the window holds ${limits.defaultLimit} `
    + `chunks by default and ${limits.maxLimit} at the most.`
}
