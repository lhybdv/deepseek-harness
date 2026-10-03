/** Deployment bounds for product generation. @module */
import z from '@deepseek-ai/schemastery'
/** Defaults for the forecast window and corpus search. */
export const DEFAULT_FORECAST_HOURS = 72
export const DEFAULT_CITATION_LIMIT = 5
/** Validated product service settings. */
export interface Config { readonly forecastHours?: number; readonly citationLimit?: number }
/** Loader-validated configuration with explicit operational defaults. */
export const Config: z<Config> = z.object({ forecastHours: z.number().default(DEFAULT_FORECAST_HOURS), citationLimit: z.number().default(DEFAULT_CITATION_LIMIT) })
/** Reject limits outside supported positive integer bounds. @param config - values with defaults resolved. */
export function assertConfig(config: Required<Config>): void {
  for (const [key, value] of Object.entries(config)) if (!Number.isInteger(value) || value < 1) throw new Error(`meteo-document-products: ${key} must be a positive integer`)
}
