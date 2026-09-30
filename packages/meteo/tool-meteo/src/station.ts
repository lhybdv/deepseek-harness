/**
 * The model-facing `meteo_station_lookup` tool: the published observing network,
 * so a consultation can name a station instead of guessing at one.
 *
 * A consultation refuses to guess a place, which is right but leaves the model
 * with a question it cannot answer from its own knowledge: which stations does this
 * deployment actually have, and what are they called locally? This tool answers
 * that, narrowed by county or by the place word the farmer used, and returns the
 * identifiers the consultation's station slot accepts. It reads and filters only —
 * it never resolves a station on the model's behalf, because choosing between two
 * stations is a question for the farmer.
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
 * Format a station lookup as the model-facing text block: one line per station,
 * identifier first because that is what the next call has to carry.
 * @param stations - the matching stations, in the order the seam published them.
 * @param scope - what the lookup was narrowed to, echoed so an empty result is not
 *   mistaken for an empty network.
 * @returns the rendered list, or the absence the lookup found.
 */
export function formatStationLookup(stations: readonly StationRecord[], scope: string): string {
  if (stations.length === 0) return `No published station matches ${scope}.`
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
    description: 'List the meteorological stations this deployment publishes, narrowed to one county or to a place word. Returns each station\'s identifier, name, county, township, and siting. Call it when a place could mean more than one station, then ask the farmer which one; pass the identifier you settle on as the station slot of meteo_consult.',
    parameters: {
      county: { type: 'string', description: 'County-level division to list, e.g. 新乡县. Omit to list the whole network.' },
      text: { type: 'string', description: 'Place word to match against station names and townships, e.g. 小冀.' },
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
        },
      },
      render: (args, value) => [{ type: 'text', text: formatStationLookup(value.stations, lookupScope(args)) }],
      presentationMeta: (_args, value) => ({ stations: value.stations }),
    },
    timeoutMs: limits.timeoutMs,
    // A lookup reads the published network and writes nothing, so any number may overlap.
    isConcurrencySafe: () => true,
    async execute(args) {
      const county = nonEmpty(args.county)
      const text = nonEmpty(args.text)
      const stations = await ctx.meteoData.stations({
        ...(county === undefined ? {} : { county }),
        ...(text === undefined ? {} : { text }),
      })
      return {
        stations: stations.map(station => ({
          id: station.id,
          name: station.name,
          county: station.county,
          township: station.township,
          lon: station.lon,
          lat: station.lat,
          altitudeM: station.altitudeM,
        })),
      }
    },
    presentCall: presentLookupCall,
    presentResult: presentLookupResult,
  }))
}
