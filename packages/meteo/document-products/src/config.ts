/** Deployment bounds for product generation and the model-facing tool. @module */
import z from '@deepseek-ai/schemastery'
/** Defaults for the forecast window and corpus search. */
export const DEFAULT_FORECAST_HOURS = 72
export const DEFAULT_CITATION_LIMIT = 5
/** Default cooperative tool-call budget (ms) for `meteo_document`. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000
/** Default cap (code points) on the citation excerpt rendered by `meteo_document`. */
export const DEFAULT_SNIPPET_CHARS = 200
/** Default cap (code points) on the product text rendered by `meteo_document`. */
export const DEFAULT_DOCUMENT_CHARS = 8_000
/** Default directory for immutable Markdown publication artifacts. */
export const DEFAULT_ARTIFACT_DIR = 'outputs/meteo-document-products'
/** Validated product service and tool settings. */
/** Requested settings; every deployment bound may be omitted to use its default. */
export interface Config {
  readonly forecastHours?: number
  readonly citationLimit?: number
  readonly timeoutMs?: number
  readonly snippetChars?: number
  readonly documentChars?: number
  readonly artifactDir?: string
}
/** Fully resolved settings consumed by the product service and model-facing tool. */
export type ResolvedConfig = Required<Config>
/** Schema used by the loader and by direct callers to resolve deployment defaults. */
export const Config: z<Config> = z.object({
  forecastHours: z.number().default(DEFAULT_FORECAST_HOURS),
  citationLimit: z.number().default(DEFAULT_CITATION_LIMIT),
  timeoutMs: z.number().default(DEFAULT_TOOL_TIMEOUT_MS),
  snippetChars: z.number().default(DEFAULT_SNIPPET_CHARS),
  documentChars: z.number().default(DEFAULT_DOCUMENT_CHARS),
  artifactDir: z.string().default(DEFAULT_ARTIFACT_DIR),
})
/** Apply the same schema defaults used by loader-supplied configuration.
 * @param request - supplied deployment settings.
 * @returns settings with every default resolved.
 */
export function resolve(request: Config): ResolvedConfig {
  const resolved = Config(request)
  if (resolved.forecastHours === undefined
    || resolved.citationLimit === undefined
    || resolved.timeoutMs === undefined
    || resolved.snippetChars === undefined
    || resolved.documentChars === undefined
    || resolved.artifactDir === undefined) {
    throw new Error('meteo-document-products: configuration defaults did not resolve')
  }
  return resolved as ResolvedConfig
}
/** Reject limits outside supported positive integer bounds. @param config - values with defaults resolved. */
export function assertConfig(config: ResolvedConfig): void {
  for (const [key, value] of Object.entries(config)) if (key !== 'artifactDir' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) throw new Error(`meteo-document-products: ${key} must be a positive integer`)
  if (config.artifactDir.trim().length === 0) throw new Error('meteo-document-products: artifactDir must not be empty')
}
