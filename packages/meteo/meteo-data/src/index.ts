/**
 * `@deepseek-ai/dsh-meteo-data` — the meteorological data seam: an abstract
 * {@link MeteoData} Service Definition, the shipped {@link LocalMeteoData}
 * provider, and the session focus a multi-turn consultation writes.
 *
 * The package's default export is the provider, so a `cordis.yml` row names the
 * package directly. The Service Definition travels with it because a deployment's
 * consultation tools answer against one seam no matter where the bytes come from:
 * a real feed is a provider behind the same name.
 *
 * @module @deepseek-ai/dsh-meteo-data
 */

export { MeteoData, MeteoDataError } from './definition.ts'
export type { MeteoDataErrorCode } from './definition.ts'
export type {
  CropWindow,
  DatasetVersions,
  ForecastPoint,
  ForecastQuery,
  FocusSnapshot,
  MeteoDatasetKind,
  Observation,
  ObservationQuery,
  Station,
  StationQuery,
  Threshold,
  ThresholdQuery,
} from './types.ts'
export { appendFocus, meteoFocusProjectionDefinition, readFocus } from './focus.ts'
export type { MeteoFocusEvent } from './focus.ts'
export type { MeteoSource } from './source.ts'
export { FixtureMeteoSource } from './fixture-source.ts'
export { HttpMeteoSource } from './http-source.ts'
export { DEFAULT_TIMEOUT_MS, LocalMeteoData } from './local.ts'
export type { MeteoDataConfig, MeteoDataSourceKind } from './local.ts'
export { LocalMeteoData as default } from './local.ts'
