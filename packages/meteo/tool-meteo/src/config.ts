/**
 * Plugin configuration for the meteorological consultation tools: every bound
 * the model may not choose for itself — the corpus window a consultation pulls,
 * the forecast horizon it reads, how many candidate stations a clarification may
 * name, how much of a chunk or series row reaches the model, and the
 * cooperative tool-call budget the deployment owns.
 * @module
 */

import z from '@deepseek-ai/schemastery'

/** Corpus chunks one `meteo_consult` call retrieves when the model omits `limit`. */
export const DEFAULT_CONSULT_LIMIT = 6

/** Largest `limit` a model may ask `meteo_consult` for. */
export const DEFAULT_MAX_CONSULT_LIMIT = 20

/** Forecast horizon in whole hours that `meteo_consult` reads for a station. */
export const DEFAULT_FORECAST_HOURS = 72

/** Candidate stations one clarification result may name. */
export const DEFAULT_MAX_CLARIFICATION_CANDIDATES = 6

/** Longest citation excerpt `meteo_consult` hands a client, in code points. */
export const DEFAULT_SNIPPET_CHARS = 280

/** Series rows of each kind that the model-facing text lists. */
export const DEFAULT_MAX_SERIES_ROWS = 24

/** Cooperative tool-call budget (ms) attached to every consultation tool. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

/** Plugin config: retrieval, horizon, clarification, rendering, and timeout bounds. */
export interface Config {
  /** Chunks retrieved by one `meteo_consult` call that omits `limit`. Defaults to 6. */
  defaultLimit?: number
  /** Largest `limit` `meteo_consult` accepts; larger requests are rejected. Defaults to 20. */
  maxLimit?: number
  /** Forecast horizon in whole hours the consultation reads. Defaults to 72. */
  forecastHours?: number
  /** Candidate stations a clarification lists at most. Defaults to 6. */
  maxClarificationCandidates?: number
  /** Citation excerpt cap in code points. Defaults to 280. */
  maxSnippetChars?: number
  /** Observation and forecast rows each listed in the model-facing text. Defaults to 24. */
  maxSeriesRows?: number
  /** Cooperative tool-call budget (ms) for all three tools. Defaults to 30000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  defaultLimit: z.number().default(DEFAULT_CONSULT_LIMIT),
  maxLimit: z.number().default(DEFAULT_MAX_CONSULT_LIMIT),
  forecastHours: z.number().default(DEFAULT_FORECAST_HOURS),
  maxClarificationCandidates: z.number().default(DEFAULT_MAX_CLARIFICATION_CANDIDATES),
  maxSnippetChars: z.number().default(DEFAULT_SNIPPET_CHARS),
  maxSeriesRows: z.number().default(DEFAULT_MAX_SERIES_ROWS),
  timeoutMs: z.number().default(DEFAULT_TOOL_TIMEOUT_MS),
})

/** Every bound after schemastery has applied each field default. */
export type MeteoLimits = Required<Config>

/**
 * Validate the resolved bounds before any tool is registered, so a
 * misconfigured deployment fails at load instead of at the first consultation.
 * @param limits - config with every field default filled in.
 */
export function assertMeteoLimits(limits: MeteoLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`tool-meteo: ${name} must be a positive integer`)
    }
  }
  if (limits.defaultLimit > limits.maxLimit) {
    throw new Error('tool-meteo: defaultLimit must not exceed maxLimit')
  }
}
