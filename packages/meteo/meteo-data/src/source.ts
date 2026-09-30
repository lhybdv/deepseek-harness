/**
 * The transport behind the local provider: where the bundle's bytes come from.
 *
 * This seam is internal. A source answers three questions — read one dataset,
 * expand a term, report revisions — and knows nothing about stations, windows,
 * or disasters. Everything that gives the bytes meaning lives in `./datasets.ts`
 * and the provider above, so adding a third origin (an object store, a vendor
 * API with its own shape) means writing a source and nothing else.
 *
 * @module @deepseek-ai/dsh-meteo-data/source
 */

import type { DatasetVersions, MeteoDatasetKind } from './types.ts'

/** One origin's worth of meteorological bytes. */
export interface MeteoSource {
  /** Origin identity, quoted in every failure this source reports. */
  readonly id: string

  /**
   * Read one dataset verbatim, cached for the life of the source.
   *
   * A bundle dataset yields its parsed JSON value. A per-station dataset
   * (`observations`, `forecast`) yields the rows keyed by station id, so the
   * caller never addresses a file of its own.
   * @param kind - which dataset to read.
   * @returns the dataset's JSON value.
   * @throws {MeteoDataError} `METEO_DATASET_UNAVAILABLE` or `METEO_SOURCE_ERROR` when the bytes cannot be obtained.
   */
  load(kind: MeteoDatasetKind): Promise<unknown>

  /**
   * Expand a term against this origin's synonym and taxonomy datasets.
   * @param term - the term as a person wrote it.
   * @returns related terms, or an empty list when the term is unknown.
   */
  expandTerm(term: string): Promise<readonly string[]>

  /**
   * Read the bundle's revision manifest.
   * @returns the bundle revision and the revision of every dataset.
   */
  versions(): Promise<DatasetVersions>
}
