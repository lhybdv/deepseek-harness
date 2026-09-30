/**
 * Meteorological data source served from a directory of JSON files on disk.
 *
 * This is the provider a deployment runs when its bundle is published as files:
 * the repository's own demo bundle and any export a weather service drops into a
 * shared directory both work unchanged. One dataset is read once and held for the
 * life of the source, so repeated tool calls in a session cost no further disk.
 *
 * @module @deepseek-ai/dsh-meteo-data/fixture-source
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MeteoDataError } from './definition.ts'
import {
  DATASET_NAMES,
  JSON_SUFFIX,
  META_FILE,
  expandSynonymTerm,
  isPerStationKind,
  parseDatasetVersions,
} from './datasets.ts'
import type { PerStationDatasetKind } from './datasets.ts'
import type { MeteoSource } from './source.ts'
import type { DatasetVersions, MeteoDatasetKind } from './types.ts'

/**
 * Reads a published bundle out of a directory on disk, one JSON file per
 * dataset and one per station for the station-keyed datasets. Raw JSON is
 * remembered per process, so a bundle is read from disk once per dataset
 * however many queries it answers; a bundle that changes on disk is picked up
 * by a restart rather than by a later read.
 */
export class FixtureMeteoSource implements MeteoSource {
  readonly id: string
  private readonly fixtureDir: string
  private readonly cache = new Map<MeteoDatasetKind, unknown>()

  /**
   * Serve a bundle from a directory.
   * @param fixtureDir - directory holding `meta.json`, the bundle datasets, and one directory per station-keyed dataset.
   */
  constructor(fixtureDir: string) {
    this.id = `fixture:${fixtureDir}`
    this.fixtureDir = fixtureDir
  }

  async load(kind: MeteoDatasetKind): Promise<unknown> {
    const cached = this.cache.get(kind)
    if (cached !== undefined) return cached
    const value = isPerStationKind(kind)
      ? await this.readStationSeries(kind)
      : await this.readJson(DATASET_NAMES[kind])
    this.cache.set(kind, value)
    return value
  }

  async expandTerm(term: string): Promise<readonly string[]> {
    return expandSynonymTerm(term, await this.load('synonyms'), await this.load('taxonomy'))
  }

  async versions(): Promise<DatasetVersions> {
    return parseDatasetVersions(await this.readJson(META_FILE))
  }

  /**
   * Read every station file of one station-keyed dataset into a station-keyed map.
   * @param kind - which station-keyed dataset to assemble.
   * @returns the rows each station file carries, keyed by station id.
   */
  private async readStationSeries(kind: PerStationDatasetKind): Promise<Record<string, unknown>> {
    const directory = DATASET_NAMES[kind]
    let names: string[]
    try {
      names = await readdir(join(this.fixtureDir, directory))
    } catch (error) {
      throw new MeteoDataError('METEO_DATASET_UNAVAILABLE', `meteo source "${this.id}" cannot list "${directory}"`, { cause: error })
    }
    const series: Record<string, unknown> = {}
    for (const name of names) {
      if (!name.endsWith(JSON_SUFFIX)) continue
      series[name.slice(0, -JSON_SUFFIX.length)] = await this.readJson(`${directory}/${name}`)
    }
    return series
  }

  /**
   * Read and parse one file below the bundle root.
   * @param file - bundle-relative path, separated by forward slashes.
   * @returns the parsed JSON value.
   */
  private async readJson(file: string): Promise<unknown> {
    let text: string
    try {
      text = await readFile(join(this.fixtureDir, file), 'utf8')
    } catch (error) {
      throw new MeteoDataError('METEO_DATASET_UNAVAILABLE', `meteo source "${this.id}" cannot read "${file}"`, { cause: error })
    }
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw new MeteoDataError('METEO_DATASET_UNAVAILABLE', `meteo source "${this.id}" got invalid JSON from "${file}"`, { cause: error })
    }
  }
}
