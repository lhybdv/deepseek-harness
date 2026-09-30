/**
 * Meteorological data source served over HTTP.
 *
 * The origin is expected to publish exactly the bundle the file source reads:
 * `<base>/stations.json`, `<base>/observations/<stationId>.json`, and so on, so a
 * directory of files exported to any static host becomes a live deployment
 * without a line of provider code. Each dataset is fetched once and held for the
 * life of the source; every request carries the configured timeout, so an origin
 * that stops answering fails the tool call instead of hanging the session.
 *
 * @module @deepseek-ai/dsh-meteo-data/http-source
 */

import { MeteoDataError } from './definition.ts'
import {
  DATASET_NAMES,
  JSON_SUFFIX,
  META_FILE,
  expandSynonymTerm,
  isPerStationKind,
  parseDatasetVersions,
  parseStations,
} from './datasets.ts'
import type { PerStationDatasetKind } from './datasets.ts'
import type { MeteoSource } from './source.ts'
import type { DatasetVersions, MeteoDatasetKind } from './types.ts'

/**
 * Reads a published bundle from an HTTP origin that serves the same layout a
 * directory holds, with an accept header and a per-request deadline. A missing
 * bundle file is reported as an unavailable dataset, a missing per-station file
 * as no data for that station, and a transport failure, non-success status,
 * malformed body, or expired deadline as a source error. Raw JSON is remembered
 * per process, so each dataset is fetched once however many queries it answers.
 */
export class HttpMeteoSource implements MeteoSource {
  readonly id: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly cache = new Map<MeteoDatasetKind, unknown>()

  /**
   * Serve a bundle from an HTTP origin.
   * @param baseUrl - origin root the bundle is published under, without a trailing slash.
   * @param timeoutMs - deadline for every single request, in milliseconds.
   */
  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
    this.id = `http:${baseUrl}`
  }

  async load(kind: MeteoDatasetKind): Promise<unknown> {
    const cached = this.cache.get(kind)
    if (cached !== undefined) return cached
    const value = isPerStationKind(kind)
      ? await this.readStationSeries(kind)
      : await this.require(DATASET_NAMES[kind])
    this.cache.set(kind, value)
    return value
  }

  async expandTerm(term: string): Promise<readonly string[]> {
    return expandSynonymTerm(term, await this.load('synonyms'), await this.load('taxonomy'))
  }

  async versions(): Promise<DatasetVersions> {
    return parseDatasetVersions(await this.require(META_FILE))
  }

  /**
   * Fetch one file per published station and key the results by station id.
   * @param kind - which station-keyed dataset to assemble.
   * @returns the rows each station published; a station with no file is absent.
   */
  private async readStationSeries(kind: PerStationDatasetKind): Promise<Record<string, unknown>> {
    const series: Record<string, unknown> = {}
    for (const station of parseStations(await this.load('stations'))) {
      const value = await this.request(`${DATASET_NAMES[kind]}/${station.id}${JSON_SUFFIX}`)
      if (value !== undefined) series[station.id] = value
    }
    return series
  }

  /**
   * Fetch one file the bundle must carry.
   * @param file - bundle-relative path below the origin root.
   * @returns the parsed JSON value.
   * @throws {MeteoDataError} `METEO_DATASET_UNAVAILABLE` when the origin answers 404.
   */
  private async require(file: string): Promise<unknown> {
    const value = await this.request(file)
    if (value === undefined) {
      throw new MeteoDataError('METEO_DATASET_UNAVAILABLE', `meteo source "${this.id}" has no "${file}" dataset`)
    }
    return value
  }

  /**
   * Fetch and parse one file.
   * @param file - bundle-relative path below the origin root.
   * @returns the parsed JSON value, or `undefined` when the origin answers 404.
   * @throws {MeteoDataError} `METEO_SOURCE_ERROR` on a transport failure, a timeout, or any other non-success status.
   */
  private async request(file: string): Promise<unknown> {
    const url = `${this.baseUrl}/${file}`
    let response: Response
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MeteoDataError('METEO_SOURCE_ERROR', `meteo source "${this.id}" cannot reach "${url}"`, { cause: error })
    }
    if (response.status === 404) return undefined
    if (!response.ok) {
      throw new MeteoDataError('METEO_SOURCE_ERROR', `meteo source "${this.id}" got status ${String(response.status)} from "${url}"`)
    }
    try {
      return await response.json() as unknown
    } catch (error) {
      throw new MeteoDataError('METEO_SOURCE_ERROR', `meteo source "${this.id}" got invalid JSON from "${url}"`, { cause: error })
    }
  }
}
