/**
 * Slot normalization shared by the three model-facing tools.
 *
 * A slot the model sent as whitespace is a slot the model did not fill. Treating
 * `''` or `'   '` as an answer would let a blank stand in for a place or a crop and
 * quietly suppress the session focus behind it, so every string slot of this
 * package passes through {@link nonEmpty} before it is consulted.
 *
 * @module @deepseek-ai/dsh-tool-meteo/slots
 */

import type { Station } from '@deepseek-ai/dsh-meteo-data'
import type { StationRef } from './consult.ts'

/**
 * Trim a slot down to what it actually says.
 * @param value - the argument as it arrived, if it arrived.
 * @returns the trimmed text, or `undefined` when it carries nothing.
 */
export function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/**
 * Project a station down to the fields a consultation shows a reader.
 * @param station - the station to project.
 * @returns the identity, name, county, and township a farmer reads.
 */
export function stationRef(station: Station): StationRef {
  return { id: station.id, name: station.name, county: station.county, township: station.township }
}
