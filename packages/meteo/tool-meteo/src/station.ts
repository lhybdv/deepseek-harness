/**
 * The model-facing `meteo_station_lookup` tool: the published observing network,
 * so a consultation can name a station instead of guessing at one.
 *
 * It resolves a bare county-level place to that county's first published seat
 * station, and returns deployment coverage and published seat points when no
 * station matches. It never invents a station or administrative mapping.
 *
 * @module @deepseek-ai/dsh-tool-meteo/station
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { MeteoLimits } from './config.ts'
import { narrowRecordList } from './presentation.ts'
import type { MetaFields } from './presentation.ts'
import { nonEmpty } from './slots.ts'

/** One published station, with the siting a consultation may need to cite. */
export interface StationRecord {
  /** Stable station identifier — what the consultation's station slot accepts. */
  id: string
  /** Display name a farmer recognises. */
  name: string
  /** County-level division the station belongs to. */
  county: string
  /** Township the station represents. */
  township: string
  /** Longitude in degrees. */
  lon: number
  /** Latitude in degrees. */
  lat: number
  /** Altitude in metres. */
  altitudeM: number
}

/** Model-facing `meteo_station_lookup` arguments. */
interface LookupArgs {
  county?: string
  text?: string
}

/** Fields the result card reads out of `presentationMeta`. */
const LOOKUP_FIELDS: MetaFields = { id: 'string', name: 'string', county: 'string', township: 'string' }

/**
 * Format a station lookup as the model-facing text block.
 * @param stations - the matching stations, in the order the seam published them.
 * @param scope - what the lookup was narrowed to.
 * @param coveredCounties - county-level places this deployment publishes.
 * @param seatStations - first published station in each county, for uncovered-place fallback.
 * @returns the rendered matches, or a coverage summary when none matched.
 */
export function formatStationLookup(
  stations: readonly StationRecord[],
  scope: string,
  coveredCounties: readonly string[],
  seatStations: readonly StationRecord[],
): string {
  if (stations.length === 0) {
    const seats = seatStations.map(station => `${station.name} (${station.id}, ${station.lon}, ${station.lat})`).join('; ')
    return `No published station matches ${scope}. Coverage: ${coveredCounties.join('、')}. `
      + `Published county seat points (longitude, latitude): ${seats}. Do not claim a nearest point unless supported by geographic information.`
  }
  const lines = stations.map(station => `- ${station.id} ${station.name} — ${station.county} ${station.township}`
    + `, lon ${station.lon} lat ${station.lat} alt ${station.altitudeM} m`)
  return `${String(stations.length)} stations (${scope}):\n${lines.join('\n')}`
}

/**
 * How a lookup was narrowed, in the words both the text block and the card show.
 * @param args - the raw tool arguments; blank filters count as no filter.
 * @returns the filter this lookup speaks, as a noun phrase.
 */
export function lookupScope(args: LookupArgs): string {
  const text = nonEmpty(args.text)
  if (text !== undefined) return `place ${text}`
  const county = nonEmpty(args.county)
  return county === undefined ? 'whole network' : `county ${county}`
}

/**
 * Pending-call presentation: a search card titled by whatever the lookup was
 * narrowed to.
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the network is listed.
 */
export function presentLookupCall(args: LookupArgs): GenericCallView {
  return { card: 'generic', title: `Station lookup: ${lookupScope(args)}`, kind: 'search' }
}

/**
 * Completed-call presentation: the identity of each matching station, without the
 * siting numbers the model already has.
 * @param _args - unused; the card is titled by how many stations were found.
 * @param result - the final model-facing tool result; `meta` carries the records.
 * @returns the generic result view, or `undefined` (generic fallback) on failure
 *   or malformed meta.
 */
export function presentLookupResult(_args: LookupArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const stations = narrowRecordList(result.meta, 'stations', LOOKUP_FIELDS)
  if (stations === undefined) return undefined
  const lines = stations.map(station => `- ${station.id as string} ${station.name as string} — ${station.county as string} ${station.township as string}`)
  return {
    card: 'generic',
    title: `${String(stations.length)} published stations`,
    ...(lines.length === 0 ? {} : { content: [{ type: 'text' as const, text: lines.join('\n') }] }),
  }
}

/**
 * Register the `meteo_station_lookup` tool.
 * @param ctx - context whose `tools` registry receives the tool and whose `meteoData`
 *   seam answers the query; the registration is effect-scoped.
 * @param limits - the deployment's bound on how long one lookup may run.
 */
export function applyMeteoStationLookupTool(ctx: Context, limits: MeteoLimits): void {
  ctx.tools.register(defineTool({
    name: 'meteo_station_lookup',
    description: 'List or resolve published stations for this deployment. It covers 五常市, 榆树市, 昌图县, 哈尔滨市, 长春市 and 沈阳市. A bare covered county/city name resolves to its first published seat station; use the returned station directly rather than asking the farmer to choose. For an uncovered place, the result includes the coverage summary and published county-seat points; state coverage in one short sentence and offer the nearest point only when its proximity is supported by the question and published data. Never invent a station, reading, or administrative mapping.',
    parameters: {
      county: { type: 'string', description: 'Covered county-level division to list, e.g. 五常市, 榆树市, 昌图县, 哈尔滨市, 长春市, or 沈阳市. Omit to list the whole network.' },
      text: { type: 'string', description: 'Station, township, city, or county name to resolve, e.g. 五常镇, 哈尔滨市, or 五常市. Bare covered county names return that county’s first published seat station.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                county: { type: 'string', required: true },
                township: { type: 'string', required: true },
                lon: { type: 'number', required: true },
                lat: { type: 'number', required: true },
                altitudeM: { type: 'number', required: true },
              },
            },
          },
          coverage: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              coveredCounties: { type: 'array', required: true, items: { type: 'string' } },
              seatStations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    county: { type: 'string', required: true },
                    township: { type: 'string', required: true },
                    lon: { type: 'number', required: true },
                    lat: { type: 'number', required: true },
                    altitudeM: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatStationLookup(value.stations, lookupScope(args), value.coverage.coveredCounties, value.coverage.seatStations) }],
      presentationMeta: (_args, value) => ({ stations: value.stations }),
    },
    timeoutMs: limits.timeoutMs,
    // A lookup reads the published network and writes nothing, so any number may overlap.
    isConcurrencySafe: () => true,
    async execute(args) {
      const county = nonEmpty(args.county)
      const text = nonEmpty(args.text)
      const all = await ctx.meteoData.stations()
      const aliases = text === undefined ? [] : [text, ...await ctx.meteoData.expandTerm(text)]
      const matchingCounty = aliases.find(alias => all.some(station => station.county === alias
        && (county === undefined || station.county === county)))
      let matchingStation: typeof all[number] | undefined
      if (matchingCounty !== undefined) {
        matchingStation = all.find(station => station.county === matchingCounty)
      }
      const stations = matchingStation !== undefined
        ? [matchingStation]
        : county === undefined && text === undefined
          ? all
          : await ctx.meteoData.stations({
            ...(county === undefined ? {} : { county }),
            ...(text === undefined ? {} : { text }),
          })
      const coveredCounties = [...new Set(all.map(station => station.county))]
      const seatStations = coveredCounties.map((covered) => {
        const station = all.find(candidate => candidate.county === covered)
        if (station === undefined) throw new Error(`No station found for covered county: ${covered}`)
        return station
      })
      const stationRecords = (records: typeof all) => records.map(station => ({
        id: station.id,
        name: station.name,
        county: station.county,
        township: station.township,
        lon: station.lon,
        lat: station.lat,
        altitudeM: station.altitudeM,
      }))
      return {
        stations: stationRecords(stations),
        coverage: { coveredCounties, seatStations: stationRecords(seatStations) },
      }
    },
    presentCall: presentLookupCall,
    presentResult: presentLookupResult,
  }))
}
