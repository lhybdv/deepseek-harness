/**
 * Published shape of every dataset behind the seam, plus the reading rules both
 * providers share.
 *
 * A provider's only job is to hand over bytes; what those bytes must look like
 * is decided once, here. Bytes that are missing, unparseable, or carry a row
 * outside the published shape raise `METEO_DATASET_UNAVAILABLE` rather than
 * yield a partially-valid dataset: a wrong threshold or a miskeyed station
 * silently turns into a wrong answer to a farmer's question.
 *
 * @module @deepseek-ai/dsh-meteo-data/datasets
 */

import { z } from 'zod'
import { MeteoDataError } from './definition.ts'
import type {
  CropWindow,
  DatasetVersions,
  ForecastPoint,
  MeteoDatasetKind,
  Station,
  Threshold,
} from './types.ts'

/** Milliseconds in one hour, used to turn a forecast horizon into an instant bound. */
export const MILLIS_PER_HOUR = 3_600_000

/** Filename or directory name each dataset is published under, below the bundle root. */
export const DATASET_NAMES: Readonly<Record<MeteoDatasetKind, string>> = {
  stations: 'stations.json',
  observations: 'observations',
  forecast: 'forecast',
  thresholds: 'thresholds.json',
  cropCalendar: 'crop-calendar.json',
  synonyms: 'synonyms.json',
  taxonomy: 'taxonomy.json',
}

/** Name of the bundle's revision manifest. */
export const META_FILE = 'meta.json'

/** Suffix of every published JSON file. */
export const JSON_SUFFIX = '.json'

/** Datasets published as one file per station rather than one bundle file. */
export type PerStationDatasetKind = 'observations' | 'forecast'

/**
 * Whether a dataset is laid out as `<directory>/<stationId>.json`.
 * @param kind - the dataset being read.
 * @returns whether reaching its rows is a per-station matter.
 */
export function isPerStationKind(kind: MeteoDatasetKind): kind is PerStationDatasetKind {
  return kind === 'observations' || kind === 'forecast'
}

/** One published criterion together with the crops it was issued for. */
export interface ThresholdRow {
  /** The criterion a consumer compares measurements against. */
  readonly threshold: Threshold
  /** Crops this criterion is issued for; the crop filter reads this list. */
  readonly crops: readonly string[]
}

const instantSchema = z.string().refine(value => Number.isFinite(Date.parse(value)), {
  message: 'expected an ISO-8601 instant',
})

const elementsSchema = z.record(z.string(), z.number())

const pointSchema = z.object({
  time: instantSchema,
  elements: elementsSchema,
}).strict()

const pointBundleSchema = z.array(pointSchema)

const stationBundleSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  county: z.string().min(1),
  township: z.string().min(1),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  altitudeM: z.number(),
}).strict())

const opSchema = z.union([z.literal('>='), z.literal('<=')])

const levelSchema = z.union([z.literal('low'), z.literal('medium'), z.literal('high')])

const criterionSchema = z.object({
  disaster: z.string().min(1),
  element: z.string().min(1),
  op: opSchema,
  value: z.number(),
  durationH: z.number().int().positive(),
  level: levelSchema,
}).strict()

const thresholdBundleSchema = z.array(criterionSchema.extend({
  crops: z.array(z.string().min(1)).min(1),
}).strict())

const cropCalendarBundleSchema = z.array(z.object({
  crop: z.string().min(1),
  activity: z.string().min(1),
  windowStart: z.string().regex(/^\d{2}-\d{2}$/),
  windowEnd: z.string().regex(/^\d{2}-\d{2}$/),
  criteria: z.array(criterionSchema).min(1),
}).strict())

const synonymsBundleSchema = z.record(z.string(), z.array(z.string()))

const taxonomyBundleSchema = z.object({
  disasters: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    elements: z.array(z.string().min(1)),
  }).strict()).min(1),
  elements: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    unit: z.string().min(1),
  }).strict()).min(1),
}).strict()

const metaBundleSchema = z.object({
  version: z.string().min(1),
  datasets: z.object({
    stations: z.string().min(1),
    observations: z.string().min(1),
    forecast: z.string().min(1),
    thresholds: z.string().min(1),
    cropCalendar: z.string().min(1),
    synonyms: z.string().min(1),
    taxonomy: z.string().min(1),
  }).strict(),
}).strict()

const stationSeriesSchema = z.record(z.string(), z.unknown())

/** What one parse call is reading: a dataset, or the bundle manifest. */
export type PublishScope = MeteoDatasetKind | 'meta'

/**
 * Run bytes through one dataset's published shape.
 * @param scope - dataset being read, quoted in the failure.
 * @param parse - the schema pass over the provider's bytes.
 * @param value - the bytes a provider handed over.
 * @returns the validated rows.
 * @throws {MeteoDataError} `METEO_DATASET_UNAVAILABLE` when the bytes are outside the shape.
 */
export function parseDataset<T>(scope: PublishScope, parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value)
  } catch (error) {
    throw new MeteoDataError(
      'METEO_DATASET_UNAVAILABLE',
      `meteo "${scope}" dataset does not match its published shape`,
      { cause: error },
    )
  }
}

/**
 * Read the bundle revision manifest.
 * @param value - parsed `meta.json`.
 * @returns the bundle revision and each dataset's revision.
 */
export function parseDatasetVersions(value: unknown): DatasetVersions {
  return parseDataset('meta', input => metaBundleSchema.parse(input), value)
}

/**
 * Read the station list.
 * @param value - parsed `stations.json`.
 * @returns every published station, in dataset order.
 */
export function parseStations(value: unknown): readonly Station[] {
  return parseDataset('stations', input => stationBundleSchema.parse(input), value)
}

/**
 * Read one station's observation rows. A row has the shape of a forecast point:
 * its station comes from the file it was read out of, not from the row.
 * @param value - the station's entry inside the `observations` bundle.
 * @returns the rows in file order.
 */
export function parseObservationRows(value: unknown): readonly ForecastPoint[] {
  return parseDataset('observations', input => pointBundleSchema.parse(input), value)
}

/**
 * Read one station's forecast points.
 * @param value - the station's entry inside the `forecast` bundle.
 * @returns the points in file order.
 */
export function parseForecastPoints(value: unknown): readonly ForecastPoint[] {
  return parseDataset('forecast', input => pointBundleSchema.parse(input), value)
}

/**
 * Read the criterion catalogue with its crop issuance.
 * @param value - parsed `thresholds.json`.
 * @returns each criterion together with the crops it is issued for.
 */
export function parseThresholdRows(value: unknown): readonly ThresholdRow[] {
  return parseDataset('thresholds', input => thresholdBundleSchema.parse(input).map(row => ({
    threshold: {
      disaster: row.disaster,
      element: row.element,
      op: row.op,
      value: row.value,
      durationH: row.durationH,
      level: row.level,
    },
    crops: row.crops,
  })), value)
}

/**
 * Read the farming activity calendar.
 * @param value - parsed `crop-calendar.json`.
 * @returns every activity window and the criteria that grade it.
 */
export function parseCropWindows(value: unknown): readonly CropWindow[] {
  return parseDataset('cropCalendar', input => cropCalendarBundleSchema.parse(input), value)
}

/**
 * Take the per-station map out of a per-station bundle.
 * @param value - the whole bundle a provider loaded.
 * @param kind - which per-station dataset the bundle came from.
 * @returns raw rows keyed by station id; a station with no data is absent.
 */
export function parseStationSeries(value: unknown, kind: PerStationDatasetKind): Readonly<Record<string, unknown>> {
  return parseDataset(kind, input => stationSeriesSchema.parse(input), value)
}

/**
 * Expand one term into the vocabulary the datasets use: its synonym list when
 * it has one, otherwise the taxonomy's own wording for the same disaster.
 * @param term - the term as a person wrote it.
 * @param synonyms - parsed `synonyms.json`.
 * @param taxonomy - parsed `taxonomy.json`.
 * @returns the related terms, or an empty list when neither dataset knows the term.
 */
export function expandSynonymTerm(term: string, synonyms: unknown, taxonomy: unknown): readonly string[] {
  const direct = parseDataset('synonyms', input => synonymsBundleSchema.parse(input), synonyms)[term]
  if (direct !== undefined) return direct
  const disasters = parseDataset('taxonomy', input => taxonomyBundleSchema.parse(input), taxonomy).disasters
  for (const disaster of disasters) {
    if (disaster.name === term || disaster.aliases.includes(term)) {
      return [disaster.name, ...disaster.aliases].filter(candidate => candidate !== term)
    }
  }
  return []
}

/**
 * Turn an ISO-8601 window bound into a comparable instant.
 * @param bound - the bound a caller supplied.
 * @returns epoch milliseconds.
 * @throws {MeteoDataError} `METEO_INVALID_QUERY` when the bound is not an instant.
 */
export function parseInstant(bound: string): number {
  const epoch = Date.parse(bound)
  if (!Number.isFinite(epoch)) {
    throw new MeteoDataError('METEO_INVALID_QUERY', `meteo time bound "${bound}" is not an ISO-8601 instant`)
  }
  return epoch
}

/**
 * Check a forecast horizon before it silently truncates an answer.
 * @param hours - the horizon a caller supplied.
 * @returns the horizon, unchanged.
 * @throws {MeteoDataError} `METEO_INVALID_QUERY` when the horizon is not a whole non-negative number of hours.
 */
export function parseHorizon(hours: number): number {
  if (!Number.isInteger(hours) || hours < 0) {
    throw new MeteoDataError('METEO_INVALID_QUERY', `meteo forecast horizon must be a whole number of hours, got ${String(hours)}`)
  }
  return hours
}
