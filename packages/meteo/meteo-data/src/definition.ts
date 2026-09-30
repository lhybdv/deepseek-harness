/**
 * Service Definition for the meteorological data seam (`ctx.meteoData`): an
 * abstract service defining WHAT reading a deployment's weather data means —
 * stations, observations, forecast guide, disaster thresholds, farming windows,
 * term expansion, dataset versions — without saying where the bytes live.
 *
 * The shipped implementation is {@link LocalMeteoData} (`./local.ts`), which
 * answers from a local fixture directory or an HTTP origin that mirrors the same
 * file layout. Consumers never see the transport: they see the shapes in
 * `./types.ts`.
 *
 * The seam owns no judgement. It reports what a station measured, what the
 * guide expects, and which criteria a farming activity is graded against; it
 * never decides whether spraying or sowing is advisable, never ranks stations by
 * closeness, and never rewrites a query the caller did not ask for. That
 * reasoning belongs to the model-facing tools above this seam.
 *
 * @module @deepseek-ai/dsh-meteo-data
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CropWindow,
  DatasetVersions,
  ForecastPoint,
  ForecastQuery,
  Observation,
  ObservationQuery,
  Station,
  StationQuery,
  Threshold,
  ThresholdQuery,
} from './types.ts'

export type {
  CropWindow,
  DatasetVersions,
  ForecastPoint,
  ForecastQuery,
  MeteoDatasetKind,
  Observation,
  ObservationQuery,
  Station,
  StationQuery,
  Threshold,
  ThresholdQuery,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    meteoData: MeteoData
  }
}

/** Machine-readable reason a {@link MeteoDataError} was raised. */
export type MeteoDataErrorCode =
  | 'METEO_STATION_NOT_FOUND'
  | 'METEO_DATASET_UNAVAILABLE'
  | 'METEO_SOURCE_ERROR'
  | 'METEO_INVALID_QUERY'

/**
 * Failure raised by the data seam itself. Configuration mistakes are not this
 * error: they throw a plain `Error` while the plugin is loading, because a
 * mis-deployed seam must fail the boot, not a tool call.
 */
export class MeteoDataError extends Error {
  /** Stable code a consumer can branch on without matching messages. */
  readonly code: MeteoDataErrorCode

  /**
   * Raise a seam failure.
   * @param code - machine-readable reason.
   * @param message - human-readable detail, safe to log, not to branch on.
   * @param options - standard error options; `cause` carries the underlying failure.
   */
  constructor(code: MeteoDataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MeteoDataError'
    this.code = code
  }
}

/**
 * Abstract meteorological data seam. Subclass, implement every method, and load
 * the subclass as a plugin — it registers as `ctx.meteoData` (one implementation
 * per context; loading a second throws, cordis' standard duplicate-service
 * behavior).
 *
 * Semantics every implementation must honor:
 * - Every method is read-only and idempotent: the same query returns the same
 *   answer until a dataset revision changes.
 * - An empty list is a legitimate answer for a station that exists but has no
 *   data in the requested window; an unknown station id is not, and rejects
 *   with `METEO_STATION_NOT_FOUND`.
 * - Times are ISO-8601 instants and window bounds are inclusive, so two
 *   consumers asking about the same period read the same rows.
 * - A dataset that cannot be read or does not match its published shape
 *   rejects with `METEO_DATASET_UNAVAILABLE`; the seam never substitutes
 *   plausible numbers.
 */
export abstract class MeteoData extends Service {
  constructor(ctx: Context) {
    super(ctx, 'meteoData')
  }

  /**
   * List the stations this deployment covers.
   * @param query - county filter and free-text filter over name, township, county.
   * @returns the matching stations, in dataset order.
   */
  abstract stations(query?: StationQuery): Promise<readonly Station[]>

  /**
   * Resolve one station by id.
   * @param id - the station identifier to look up.
   * @returns the station, or `undefined` when no station carries that id.
   */
  abstract station(id: string): Promise<Station | undefined>

  /**
   * Read observed weather for one station.
   * @param query - the station and an inclusive time window.
   * @returns the observations in the window, oldest first.
   */
  abstract observations(query: ObservationQuery): Promise<readonly Observation[]>

  /**
   * Read the forecast guide for one station.
   * @param query - the station, an inclusive start, and a horizon in hours.
   * @returns the forecast points in range, earliest first.
   */
  abstract forecast(query: ForecastQuery): Promise<readonly ForecastPoint[]>

  /**
   * List graded disaster criteria.
   * @param query - disaster name and crop filters.
   * @returns the criteria issued for the filter, in the order the dataset publishes them.
   */
  abstract thresholds(query?: ThresholdQuery): Promise<readonly Threshold[]>

  /**
   * List farming activity windows and the criteria that grade them.
   * @param query - crop filter, and a disaster filter over each window's criteria.
   * @returns the matching windows, in the order the dataset publishes them.
   */
  abstract cropCalendar(query?: ThresholdQuery): Promise<readonly CropWindow[]>

  /**
   * Expand a colloquial disaster or element term into the vocabulary the
   * datasets use, so a consumer can match a farmer's wording.
   * @param term - the term as a person wrote it.
   * @returns related terms, or an empty list when the term is unknown.
   */
  abstract expandTerm(term: string): Promise<readonly string[]>

  /**
   * Report the revision of the dataset bundle behind this seam.
   * @returns the bundle revision and the revision of every dataset.
   */
  abstract versions(): Promise<DatasetVersions>
}
