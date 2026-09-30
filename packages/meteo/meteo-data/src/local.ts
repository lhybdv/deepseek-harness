/**
 * The shipped provider of the meteorological data seam: one bundle, read from a
 * directory of JSON files or from an HTTP origin that publishes the same layout,
 * plus the session focus this deployment's consultation tools write.
 *
 * Loading this plugin does two things. It provides `ctx.meteoData`, and it
 * registers the `meteoFocus` session projection so a focus written in one turn is
 * readable in the next. The projection is registered only after the config below
 * has passed, so a mis-deployed seam fails the boot and leaves no half-mounted
 * projection behind.
 *
 * Filtering happens here and nowhere else: a provider hands over bytes, this
 * class answers a query. A deployment with its own transport extends
 * {@link MeteoData} instead and inherits the same answers.
 *
 * @module @deepseek-ai/dsh-meteo-data/local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MeteoData, MeteoDataError } from './definition.ts'
import {
  MILLIS_PER_HOUR,
  parseCropWindows,
  parseHorizon,
  parseInstant,
  parseStationSeries,
  parseStations,
  parseThresholdRows,
  parseObservationRows,
  parseForecastPoints,
} from './datasets.ts'
import { meteoFocusProjectionDefinition } from './focus.ts'
import { FixtureMeteoSource } from './fixture-source.ts'
import { HttpMeteoSource } from './http-source.ts'
import type { MeteoSource } from './source.ts'
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

/** Request deadline applied to a single HTTP request when the config sets none. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** Where the provider reads its bundle from. */
export type MeteoDataSourceKind = 'fixture' | 'http'

/** Declarative configuration of {@link LocalMeteoData}. */
export interface MeteoDataConfig {
  /** Which transport reads the bundle; defaults to the on-disk bundle. */
  readonly source: MeteoDataSourceKind
  /** Directory holding the bundle; required by `fixture`, refused by `http`. */
  readonly fixtureDir?: string
  /** Origin root the bundle is published under; required by `http`, refused by `fixture`. */
  readonly baseUrl?: string
  /** Deadline for every single HTTP request, in whole milliseconds. */
  readonly timeoutMs: number
}

/**
 * Build the transport the config describes.
 *
 * Every rule here is a deployment mistake rather than a runtime condition, so it
 * throws a plain `Error` while the plugin loads: a seam pointed at a directory
 * that does not exist must stop the boot, not answer an empty list later.
 * @param config - validated plugin configuration.
 * @returns the transport this provider will read through.
 */
function createSource(config: MeteoDataConfig): MeteoSource {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new Error(`meteo-data: timeoutMs must be a positive integer, got ${String(config.timeoutMs)}`)
  }
  if (config.source === 'http') {
    if (config.fixtureDir !== undefined) throw new Error('meteo-data: fixtureDir is only valid with source "fixture"')
    const baseUrl = config.baseUrl
    if (baseUrl === undefined || baseUrl === '') {
      throw new Error('meteo-data: source "http" requires a non-empty baseUrl')
    }
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      throw new Error(`meteo-data: baseUrl must be an http(s) URL, got "${baseUrl}"`)
    }
    if (baseUrl.endsWith('/')) throw new Error(`meteo-data: baseUrl must not end with a slash, got "${baseUrl}"`)
    return new HttpMeteoSource(baseUrl, config.timeoutMs)
  }
  if (config.baseUrl !== undefined) throw new Error('meteo-data: baseUrl is only valid with source "http"')
  const fixtureDir = config.fixtureDir
  if (fixtureDir === undefined || fixtureDir === '') {
    throw new Error('meteo-data: source "fixture" requires a non-empty fixtureDir')
  }
  return new FixtureMeteoSource(fixtureDir)
}

/**
 * The shipped provider of the seam: it reads one bundle through the transport
 * the configuration selects and answers every query against it. All filtering
 * lives here — county and free-text station matching, inclusive observation
 * windows, a forecast horizon measured from the query's own start or the first
 * published point, and criteria narrowed to the asked crop — so a deployment
 * with its own transport extends {@link MeteoData} and inherits the same
 * answers. Loading it also registers the `meteoFocus` session projection, after
 * the configuration has passed, so a mis-deployed seam fails the boot rather
 * than mounting a projection over a bundle it cannot read.
 */
export class LocalMeteoData extends MeteoData {
  static Config: z<MeteoDataConfig> = z.object({
    source: z.union(['fixture', 'http'] as const).default('fixture'),
    fixtureDir: z.string(),
    baseUrl: z.string(),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  })

  private readonly source: MeteoSource

  constructor(
    ctx: Context,
    config: MeteoDataConfig,
  ) {
    super(ctx)
    this.source = createSource(config)
    ctx.inject(['sessionProjections'], (scope) => {
      scope.effect(
        () => scope.sessionProjections.register(meteoFocusProjectionDefinition),
        'meteoData.focusProjection()',
      )
    })
  }

  async stations(query: StationQuery = {}): Promise<readonly Station[]> {
    const stations = parseStations(await this.source.load('stations'))
    const { county, text } = query
    return stations.filter(station => (county === undefined || station.county === county)
      && (text === undefined || station.name.includes(text) || station.township.includes(text) || station.county.includes(text)))
  }

  async station(id: string): Promise<Station | undefined> {
    const stations = parseStations(await this.source.load('stations'))
    return stations.find(station => station.id === id)
  }

  async observations(query: ObservationQuery): Promise<readonly Observation[]> {
    const { stationId } = query
    await this.requireStation(stationId)
    const series = parseStationSeries(await this.source.load('observations'), 'observations')
    const rows = series[stationId]
    const points = rows === undefined ? [] : parseObservationRows(rows)
    const from = query.from === undefined ? undefined : parseInstant(query.from)
    const to = query.to === undefined ? undefined : parseInstant(query.to)
    return points
      .filter(point => (from === undefined || Date.parse(point.time) >= from)
        && (to === undefined || Date.parse(point.time) <= to))
      .map(point => ({ stationId, time: point.time, elements: point.elements }))
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  }

  async forecast(query: ForecastQuery): Promise<readonly ForecastPoint[]> {
    const { stationId } = query
    await this.requireStation(stationId)
    const series = parseStationSeries(await this.source.load('forecast'), 'forecast')
    const rows = series[stationId]
    const points = (rows === undefined ? [] : parseForecastPoints(rows))
      .slice()
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
    const from = query.from === undefined ? undefined : parseInstant(query.from)
    const horizon = query.hours === undefined ? undefined : parseHorizon(query.hours)
    const kept = from === undefined ? points : points.filter(point => Date.parse(point.time) >= from)
    if (horizon === undefined) return kept
    const first = kept[0]
    const origin = from ?? (first === undefined ? undefined : Date.parse(first.time))
    if (origin === undefined) return []
    const limit = origin + horizon * MILLIS_PER_HOUR
    return kept.filter(point => Date.parse(point.time) <= limit)
  }

  async thresholds(query: ThresholdQuery = {}): Promise<readonly Threshold[]> {
    const rows = parseThresholdRows(await this.source.load('thresholds'))
    const { disaster, crop } = query
    return rows
      .filter(row => (disaster === undefined || row.threshold.disaster === disaster)
        && (crop === undefined || row.crops.includes(crop)))
      .map(row => row.threshold)
  }

  async cropCalendar(query: ThresholdQuery = {}): Promise<readonly CropWindow[]> {
    const windows = parseCropWindows(await this.source.load('cropCalendar'))
    const { disaster, crop } = query
    return windows.filter(entry => (crop === undefined || entry.crop === crop)
      && (disaster === undefined || entry.criteria.some(criterion => criterion.disaster === disaster)))
  }

  async expandTerm(term: string): Promise<readonly string[]> {
    return this.source.expandTerm(term)
  }

  async versions(): Promise<DatasetVersions> {
    return this.source.versions()
  }

  /**
   * Refuse a query about a station this deployment does not publish.
   * @param stationId - the station a query names.
   */
  private async requireStation(stationId: string): Promise<void> {
    if (await this.station(stationId) === undefined) {
      throw new MeteoDataError('METEO_STATION_NOT_FOUND', `meteo station "${stationId}" is not published by this deployment`)
    }
  }
}
