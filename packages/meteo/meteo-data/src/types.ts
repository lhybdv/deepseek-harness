/**
 * Public data contracts of the meteorological data seam.
 *
 * Every shape here is what a consumer — a model-facing tool, a controller, a
 * projection — sees when it reads through `ctx.meteoData`. The shapes carry no
 * provider vocabulary: a fixture directory and an HTTP origin both answer to
 * `stations.json`, `observations/<stationId>.json` and the rest of the layout
 * described in the package README, so a deployment swaps one for the other in
 * configuration alone.
 *
 * @module @deepseek-ai/dsh-meteo-data/types
 */

/** Every dataset the seam exposes, used as the version key of each. */
export type MeteoDatasetKind =
  | 'stations'
  | 'observations'
  | 'forecast'
  | 'thresholds'
  | 'cropCalendar'
  | 'synonyms'
  | 'taxonomy'

/** One township-level automatic weather station. */
export interface Station {
  /** Stable station identifier, used verbatim in per-station dataset paths. */
  readonly id: string
  /** Display name a model can quote back to a farmer. */
  readonly name: string
  /** County-level division the station belongs to. */
  readonly county: string
  /** Township the station represents, the granularity an answer is about. */
  readonly township: string
  /** Longitude in degrees east. */
  readonly lon: number
  /** Latitude in degrees north. */
  readonly lat: number
  /** Instrument height above sea level in metres. */
  readonly altitudeM: number
}

/** Filter for {@link MeteoData.stations}. */
export interface StationQuery {
  /** Keep only stations of this county-level division. */
  readonly county?: string
  /** Substring matched against the station name, township and county. */
  readonly text?: string
}

/** Filter for {@link MeteoData.observations}. */
export interface ObservationQuery {
  /** Station whose observations are wanted; an unknown id fails the call. */
  readonly stationId: string
  /** Inclusive lower bound, an ISO-8601 instant. */
  readonly from?: string
  /** Inclusive upper bound, an ISO-8601 instant. */
  readonly to?: string
}

/** One observation message from one station at one time. */
export interface Observation {
  /** Station that reported the message. */
  readonly stationId: string
  /** Observation time as an ISO-8601 instant. */
  readonly time: string
  /** Measured elements keyed by stable ASCII name, e.g. `temperature`. */
  readonly elements: Readonly<Record<string, number>>
}

/** Filter for {@link MeteoData.forecast}. */
export interface ForecastQuery {
  /** Station whose forecast is wanted; an unknown id fails the call. */
  readonly stationId: string
  /** Inclusive lower bound, an ISO-8601 instant; defaults to the first run. */
  readonly from?: string
  /** Horizon in whole hours kept from {@link ForecastQuery.from}. */
  readonly hours?: number
}

/** One forecast point of a station's deterministic guide. */
export interface ForecastPoint {
  /** Valid time as an ISO-8601 instant. */
  readonly time: string
  /** Forecast elements keyed by stable ASCII name, e.g. `temperature`. */
  readonly elements: Readonly<Record<string, number>>
}

/** Filter for {@link MeteoData.thresholds} and {@link MeteoData.cropCalendar}. */
export interface ThresholdQuery {
  /** Disaster name the criterion must belong to, e.g. `暴雨`. */
  readonly disaster?: string
  /** Crop the criterion is issued for, e.g. `冬小麦`. */
  readonly crop?: string
}

/** One graded disaster criterion: an element crossing a value for a duration. */
export interface Threshold {
  /** Disaster this criterion contributes to, e.g. `晚霜冻`. */
  readonly disaster: string
  /** Measured element the criterion reads, matching an elements key. */
  readonly element: string
  /** Comparison direction against {@link Threshold.value}. */
  readonly op: '>=' | '<='
  /** Element value the comparison runs against, in the element's unit. */
  readonly value: number
  /** Hours the condition must hold before the criterion counts. */
  readonly durationH: number
  /** Grade the criterion carries when it counts. */
  readonly level: 'low' | 'medium' | 'high'
}

/** One farming activity window and the disaster criteria it is judged by. */
export interface CropWindow {
  /** Crop the activity belongs to, e.g. `冬小麦`. */
  readonly crop: string
  /** Activity name, e.g. `拔节`. */
  readonly activity: string
  /** Annual window start as `MM-DD`. */
  readonly windowStart: string
  /** Annual window end as `MM-DD`, inclusive. */
  readonly windowEnd: string
  /** Criteria that decide whether the activity is advisable right now. */
  readonly criteria: readonly Threshold[]
}

/** Published revision of the whole dataset bundle. */
export interface DatasetVersions {
  /** Bundle revision a consumer can quote and pin. */
  readonly version: string
  /** Revision of each dataset, keyed by every kind the seam serves. */
  readonly datasets: Readonly<Record<MeteoDatasetKind, string>>
}

/** What the session is currently talking about, as one turn leaves it. */
export interface FocusSnapshot {
  /** Station the conversation is anchored to, once one is settled. */
  readonly stationId?: string
  /** Crop the conversation is about, once one is settled. */
  readonly crop?: string
  /** Epoch milliseconds of the write that produced this snapshot. */
  readonly updatedAt: number
}
