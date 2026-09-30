/**
 * The model-facing `meteo_set_focus` tool: the one write in the consultation.
 *
 * A farmer does not repeat which field they mean on every turn, so the place and
 * crop a conversation settles have to outlive the turn that settled them.
 * `meteo_consult` reads that anchor; this tool is what writes it, once, when a
 * clarification has been answered or a question named its subject outright.
 *
 * The write is a merge and a verification. Naming only the crop keeps the station
 * already held, naming only the station keeps the crop; naming nothing releases the
 * focus, which is how a conversation says it has stopped being about one place. A
 * station the deployment does not publish is refused outright, because a focus that
 * names a place with no data behind it will silently mislead every later turn.
 *
 * @module @deepseek-ai/dsh-tool-meteo/focus-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MeteoLimits } from './config.ts'
import { appendFocus, readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { StationRef } from './consult.ts'
import { nonEmpty, stationRef } from './slots.ts'

/** The focus this call wrote: what the session is now about. */
export interface FocusResult {
  /** Station the session now answers about, verified against the published network. */
  station?: StationRef
  /** Crop the session now answers about. */
  crop?: string
  /** Epoch milliseconds the focus was recorded at; absent when the focus was released. */
  updatedAt?: number
}

/**
 * Format a focus write as the model-facing text block.
 * @param result - the focus this call wrote.
 * @returns what the session is now about, or that it is no longer about one place.
 */
export function formatFocusResult(result: FocusResult): string {
  if (result.updatedAt === undefined) {
    return 'Session focus released: a consultation in this session will ask which place the farmer means instead of assuming one.'
  }
  const held: string[] = []
  if (result.station !== undefined) {
    held.push(`station ${result.station.name} (${result.station.id}), ${result.station.county} ${result.station.township}`)
  }
  if (result.crop !== undefined) held.push(`crop ${result.crop}`)
  return `Session focus now holds ${held.join(' and ')}. A consultation in this session answers about these unless it names otherwise.`
}

/**
 * Register the `meteo_set_focus` tool.
 * @param ctx - context whose `tools` registry receives the tool and whose `meteoData`
 *   seam verifies the station; the registration is effect-scoped.
 * @param limits - the deployment's bound on how long one write may run.
 */
export function applyMeteoSetFocusTool(ctx: Context, limits: MeteoLimits): void {
  ctx.tools.register(defineTool({
    name: 'meteo_set_focus',
    description: 'Record the place and crop this session is about, so later turns answer about them without being told again. Naming only one slot keeps whatever the session already held for the other; naming neither releases the focus. The station must be an identifier this deployment publishes — call meteo_station_lookup first, and ask the farmer which station they mean before recording one.',
    parameters: {
      stationId: { type: 'string', description: 'Station identifier to anchor the session to, as returned by meteo_station_lookup. Omit to keep the station the focus already holds.' },
      crop: { type: 'string', description: 'Crop to anchor the session to, e.g. 冬小麦. Omit to keep the crop the focus already holds.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          station: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              county: { type: 'string', required: true },
              township: { type: 'string', required: true },
            },
          },
          crop: { type: 'string' },
          updatedAt: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatFocusResult(value) }],
    },
    timeoutMs: limits.timeoutMs,
    // This tool appends to the session log, so two writes must not interleave.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('meteo_set_focus needs an agent session to record the focus on')
      const agent = exec.agent
      const named = nonEmpty(args.stationId)
      const namedCrop = nonEmpty(args.crop)
      if (named === undefined && namedCrop === undefined) {
        appendFocus(agent.session, null)
        return {}
      }
      const focus = readFocus(ctx, agent)
      const crop = namedCrop ?? focus?.crop
      const stationId = named ?? focus?.stationId
      const record = stationId === undefined ? undefined : await ctx.meteoData.station(stationId)
      if (named !== undefined && record === undefined) {
        throw new Error(`station ${named} is not a station this deployment publishes`)
      }
      const updatedAt = Date.now()
      appendFocus(agent.session, {
        ...(record === undefined ? {} : { stationId: record.id }),
        ...(crop === undefined ? {} : { crop }),
        updatedAt,
      })
      return {
        ...(record === undefined ? {} : { station: stationRef(record) }),
        ...(crop === undefined ? {} : { crop }),
        updatedAt,
      }
    },
  }))
}
