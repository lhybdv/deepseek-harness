/**
 * The model-facing `meteo_consult` tool: one deterministic pipeline that turns a
 * farmer's question into the published evidence that bears on it.
 *
 * The pipeline is the product. A consultation resolves the slots the model
 * understood, reads the station's observations and its forecast horizon, judges
 * the published crop windows against the criteria currently in force, grades the
 * asked disaster against the same reading series, and retrieves the indexed
 * professional chunks — then returns all six answers with a trace of how each was
 * produced. It deliberately stops at evidence: no sentence it returns is part of
 * an answer, because composing the answer for the farmer is the model's job and
 * the model is the only party in the loop that knows what was actually asked.
 *
 * Every step that cannot produce an answer says so. A station that is ambiguous
 * stops the consultation before a single reading is read rather than guessing a
 * place; a criterion whose element the series never carries is unverifiable; a
 * grade no criterion supports is reported as `unknown`.
 *
 * @module @deepseek-ai/dsh-tool-meteo/consult
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { Station } from '@deepseek-ai/dsh-meteo-data'
import type { CorpusHit } from '@deepseek-ai/dsh-meteo-corpus'
import type { MeteoLimits } from './config.ts'
import { capSnippet, consultViewFromResult } from './presentation.ts'
import { evaluateHazard, evaluateSuitability } from './rules.ts'
import type { DaySuitability, FiredCriterion, HazardLevel } from './rules.ts'
import type {} from '@deepseek-ai/dsh-document-products'
import type { ResolvedHazard } from '@deepseek-ai/dsh-document-products'
import { nonEmpty, stationRef } from './slots.ts'

/** Which slots the model filled, resolved to one consultation shape. */
export type ConsultIntent = 'station-conditions' | 'activity-suitability' | 'disaster-risk'

/** Why a consultation refused to read any data. */
export type ClarificationReason = 'station-not-found' | 'station-ambiguous' | 'station-missing'

/** One pipeline step of the consultation. */
export type ConsultStepName = 'slots' | 'observation' | 'forecast' | 'suitability' | 'hazard' | 'corpus'

/** How one pipeline step ended. */
export type ConsultStepStatus = 'done' | 'unknown' | 'skipped'

/** Where the consultation's station came from. */
export type StationOrigin = 'argument' | 'focus'

/** One station a client or model can name back. */
export interface StationRef {
  /** Stable station identifier. */
  id: string
  /** Display name a farmer recognises. */
  name: string
  /** County-level division the station belongs to. */
  county: string
  /** Township the station represents. */
  township: string
}

/** One element reading of one series row. */
export interface SeriesElement {
  /** Element name as published, e.g. `precipitation`. */
  element: string
  /** Reported value in the element's unit. */
  value: number
}

/** One observation or forecast row, with its elements ordered by name. */
export interface SeriesRow {
  /** ISO-8601 instant of the row. */
  time: string
  /** Reported elements, sorted by element name for a stable rendering. */
  entries: SeriesElement[]
}

/** One retrieved chunk, with the coordinates a citation must carry. */
export interface ConsultCitation {
  /** Index identity to hand `corpus_read` for the verbatim chunk. */
  docId: string
  /** Zero-based position of the chunk inside its document. */
  ordinal: number
  /** Title of the document the chunk came from. */
  docTitle: string
  /** Heading trail above the chunk; empty when the document has no headings. */
  headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  charStart: number
  /** Character offset one past the chunk's last character. */
  charEnd: number
  /** Chunk text as stored, verbatim. */
  text: string
}

/** The place a consultation could not settle, and what it could have meant. */
export interface Clarification {
  /** Why no station was settled. */
  reason: ClarificationReason
  /** Stations the deployment offers as the likely meaning, capped by config. */
  candidates: StationRef[]
}

/** One pipeline step's record in the trace. */
export interface ConsultStep {
  /** Which step this is. */
  step: ConsultStepName
  /** How it ended. */
  status: ConsultStepStatus
  /** One-line account of what it read and what that produced. */
  detail: string
  /** Records it produced; zero for a step that ran and found nothing. */
  count: number
}

/** The slots a consultation was asked with, as the model named them. */
export interface ConsultSlots {
  /** The question, in the caller's own words. */
  question: string
  /** Station as the model named it: an id, a station name, or a place word. */
  station?: string
  /** Crop the question is about. */
  crop?: string
  /** Farming activity the question is about. */
  activity?: string
  /** Period the question is about, carried through for the answer to name. */
  period?: string
  /** Disaster the question asks about. */
  disaster?: string
}

/** The disaster reading a consultation returns. */
export interface ConsultHazard {
  /** Strongest grade among the criteria that held, or `unknown` when none did. */
  level: HazardLevel | 'unknown'
  /** Every criterion that held, in published order; empty when the level is `unknown`. */
  basis: FiredCriterion[]
  /** Revision of the criteria dataset consulted; absent when it was never read. */
  ruleVersion?: string
  /** Inclusive sample-time endpoints actually evaluated; absent when no usable samples exist. */
  evaluated?: { from: string; to: string }
}

/** Canonical `meteo_consult` output value. */
export interface ConsultOutput {
  /** Slot shape the question arrived in. */
  intent: ConsultIntent
  /** Slots the consultation was asked with, including those it did not resolve. */
  slots: ConsultSlots
  /** Station the consultation actually read, when one was settled. */
  resolvedStation?: StationRef
  /** Why the consultation stopped before reading any data. */
  needsClarification?: Clarification
  /** Station observations, oldest first. */
  observations: SeriesRow[]
  /** Forecast rows within the configured horizon, soonest first. */
  forecast: SeriesRow[]
  /** Per-day activity judgements, oldest day first. */
  suitability: DaySuitability[]
  /** Disaster grade the reading series supports. */
  hazard: ConsultHazard
  /** Retrieved chunks, most relevant first, with verbatim text. */
  citations: ConsultCitation[]
  /** Revision of the criteria dataset consulted; absent when it was never read. */
  ruleVersion?: string
  /** The six pipeline steps, in the order they ran. */
  stepTrace: ConsultStep[]
  /** Whether the chunk list filled the retrieval window, so more may exist. */
  truncated: boolean
}

/** Model-facing `meteo_consult` arguments. */
interface ConsultArgs {
  question: string
  station?: string
  crop?: string
  activity?: string
  period?: string
  disaster?: string
  limit?: number
}

/** A station settled well enough to read data about. */
interface ResolvedStation {
  readonly station: Station
  readonly origin: StationOrigin
}

/** A station the consultation refuses to guess. */
interface UnresolvedStation {
  readonly clarification: Clarification
}

/** Outcome of resolving the station slot. */
type StationResolution = ResolvedStation | UnresolvedStation

/** What each clarification reason says about the question it came from. */
const REASON_TEXT: Readonly<Record<ClarificationReason, string>> = {
  'station-not-found': 'this deployment has no station matching the place that was named',
  'station-ambiguous': 'the place that was named matches more than one station',
  'station-missing': 'neither the question nor the session names a place',
}

/** The five steps a consultation skips when it has no station. */
const SKIPPED_STEPS: readonly ConsultStepName[] = ['observation', 'forecast', 'suitability', 'hazard', 'corpus']

/**
 * Sort a reading's elements by name, so the same row renders identically twice.
 * @param time - ISO-8601 instant of the row.
 * @param elements - elements as the dataset published them.
 * @returns the row with its elements ordered by element name.
 */
function seriesRow(time: string, elements: Readonly<Record<string, number>>): SeriesRow {
  return {
    time,
    entries: Object.entries(elements).sort((left, right) => left[0].localeCompare(right[0]))
      .map(([element, value]) => ({ element, value })),
  }
}

/**
 * Settle the station slot, or say why it cannot be settled.
 *
 * An explicit station is tried as an id first, because an id is what the previous
 * turn handed back, then as a whole station name, then as a partial place name that
 * must be unique to count. A name that matches nothing is not treated as the focus
 * station: the question named a place this deployment does not have, and answering
 * it about a different place would be the one error a farmer cannot detect. With no
 * station named at all the session focus speaks, and when the focus names a station
 * this deployment no longer publishes the consultation asks instead of reading the
 * wrong one.
 * @param ctx - context whose `meteoData` seam answers the station queries.
 * @param raw - the station slot as the model named it, if it named one.
 * @param focusStationId - station the session focus holds, if it holds one.
 * @param limits - deployment bound on how many candidates a clarification may name.
 * @returns the station to read data about, or the clarification to hand back.
 */
async function resolveStation(
  ctx: Context,
  raw: string | undefined,
  focusStationId: string | undefined,
  limits: MeteoLimits,
): Promise<StationResolution> {
  if (raw === undefined) {
    const focused = focusStationId === undefined ? undefined : await ctx.meteoData.station(focusStationId)
    if (focused !== undefined) return { station: focused, origin: 'focus' }
    const all = await ctx.meteoData.stations()
    return {
      clarification: {
        reason: 'station-missing',
        candidates: all.slice(0, limits.maxClarificationCandidates).map(stationRef),
      },
    }
  }
  const exact = await ctx.meteoData.station(raw)
  if (exact !== undefined) return { station: exact, origin: 'argument' }
  const matches = await ctx.meteoData.stations({ text: raw })
  if (matches.length === 0) return { clarification: { reason: 'station-not-found', candidates: [] } }
  const named = matches.find(candidate => candidate.name === raw)
  const unique = matches.length === 1 ? matches[0] : undefined
  const match = named ?? unique
  if (match !== undefined) return { station: match, origin: 'argument' }
  return {
    clarification: {
      reason: 'station-ambiguous',
      candidates: matches.slice(0, limits.maxClarificationCandidates).map(stationRef),
    },
  }
}

/**
 * Describe one step's readings in the words the trace shows.
 * @param subject - the rows as a noun phrase, e.g. `observations for station ha-xx-01`.
 * @param rows - the rows the step read, oldest first.
 * @returns the count and span when the step read something, the absence when it did not.
 */
function spanDetail(subject: string, rows: readonly SeriesRow[]): string {
  const times = rows.map(row => row.time)
  return times.length === 0
    ? `no ${subject}`
    : `${String(times.length)} ${subject}: ${times[0]} to ${times[times.length - 1]}`
}

/**
 * Format a consultation as the model-facing text block: the trace of how the
 * findings were built, the readings themselves, the per-day judgements, the
 * disaster grade and its basis, the retrieved chunks verbatim, and the standing
 * rule about what the model may now say.
 * @param value - the canonical consultation output.
 * @param maxSeriesRows - rows of each series the text lists.
 * @returns the rendered blocks, joined by blank lines.
 */
export function formatConsultOutput(value: ConsultOutput, maxSeriesRows: number): string {
  const parts: string[] = []
  if (value.needsClarification !== undefined) {
    const { reason, candidates } = value.needsClarification
    const lines = [`The consultation stopped before reading any data: ${REASON_TEXT[reason]}.`]
    for (const candidate of candidates) {
      lines.push(`- ${candidate.name} (${candidate.id}) — ${candidate.county} ${candidate.township}`)
    }
    lines.push('Ask which station the farmer means with the ask_user_question tool, then consult again naming that station. No observation, forecast, criteria, or corpus read was performed for this question.')
    return lines.join('\n')
  }
  parts.push(`Question: ${value.slots.question}`)
  parts.push(`Trace:\n${value.stepTrace.map(step => `- ${step.step} [${step.status}] ${step.detail}`).join('\n')}`)
  const series = [
    { label: 'Observations', all: value.observations, rows: value.observations.slice(Math.max(0, value.observations.length - maxSeriesRows)), edge: 'most recent' },
    { label: 'Forecast', all: value.forecast, rows: value.forecast.slice(0, maxSeriesRows), edge: 'earliest' },
  ]
  for (const section of series) {
    if (section.all.length === 0) {
      parts.push(`${section.label}: none published.`)
      continue
    }
    const rows = section.rows.map(row => `${row.time} ${row.entries.map(entry => `${entry.element}=${String(entry.value)}`).join(' ')}`)
    const cap = section.rows.length < section.all.length
      ? ` (listing the ${String(section.rows.length)} ${section.edge} of ${String(section.all.length)})`
      : ''
    parts.push(`${section.label} (${String(section.all.length)} rows${cap}):\n${rows.join('\n')}`)
  }
  if (value.suitability.length === 0) {
    parts.push('Suitability: no published activity window covers a day the readings carry.')
  } else {
    const lines = value.suitability.map((day) => {
      const held = day.criteria
        .map(criterion => `${criterion.disaster} ${criterion.element}${criterion.op}${String(criterion.value)} held ${String(criterion.hoursHeld)}h from ${criterion.firstTime}`)
        .join('; ')
      return `- ${day.day} ${day.crop}/${day.activity}: ${day.verdict}${held.length === 0 ? '' : ` — ${held}`}`
    })
    parts.push(`Suitability (one line per activity window):\n${lines.join('\n')}`)
  }
  const basis = value.hazard.basis
    .map(criterion => `- ${criterion.disaster} ${criterion.element}${criterion.op}${String(criterion.value)} (${criterion.level}) held ${String(criterion.hoursHeld)}h from ${criterion.firstTime}`)
    .join('\n')
  parts.push(`Hazard: ${value.hazard.level}${basis.length === 0 ? ' — no published criterion held across these readings.' : `\n${basis}`}`)
  if (value.citations.length === 0) {
    parts.push('Corpus: no indexed chunk matched this question.')
  } else {
    const chunks = value.citations.map((citation, index) => `[${String(index + 1)}] ${citation.docTitle} | docId ${citation.docId} | chunk ${String(citation.ordinal)}`
      + ` | chars ${String(citation.charStart)}-${String(citation.charEnd)}${citation.headingPath.length === 0 ? '' : ` | heading ${citation.headingPath}`}\n${citation.text}`)
    parts.push(`Corpus findings (most relevant first):\n${chunks.join('\n\n')}`)
  }
  parts.push('These are the findings, not an answer: say only what is above. A step marked unknown is a question the published data does not answer, and an `unknown` hazard grade means no published criterion held — do not name a risk level. Every conclusion drawn from a corpus finding must cite its document title, chunk ordinal, and character range.')
  if (value.truncated) {
    parts.push('The chunk window was filled: narrow the question or raise limit for more corpus evidence.')
  }
  return parts.join('\n\n')
}

/**
 * Project a validated consultation into its replayable presentation meta: the
 * trace, the readings and judgements behind each step, the hazard reading, and the
 * citation list a client renders as chips, so nothing is derived from the lossy
 * render text.
 * @param value - the canonical consultation output.
 * @param maxSnippetChars - the deployment's citation excerpt cap in code points.
 * @returns the consultation's client-facing projection.
 */
export function consultMetaFromValue(value: ConsultOutput, maxSnippetChars: number): JsonValue {
  return {
    intent: value.intent,
    slots: {
      question: value.slots.question,
      ...(value.slots.station === undefined ? {} : { station: value.slots.station }),
      ...(value.slots.crop === undefined ? {} : { crop: value.slots.crop }),
      ...(value.slots.activity === undefined ? {} : { activity: value.slots.activity }),
      ...(value.slots.period === undefined ? {} : { period: value.slots.period }),
      ...(value.slots.disaster === undefined ? {} : { disaster: value.slots.disaster }),
    },
    ...(value.resolvedStation === undefined ? {} : {
      resolvedStation: {
        id: value.resolvedStation.id,
        name: value.resolvedStation.name,
        county: value.resolvedStation.county,
        township: value.resolvedStation.township,
      },
    }),
    ...(value.needsClarification === undefined ? {} : {
      needsClarification: {
        reason: value.needsClarification.reason,
        candidates: value.needsClarification.candidates.map(candidate => ({
          id: candidate.id,
          name: candidate.name,
          county: candidate.county,
          township: candidate.township,
        })),
      },
    }),
    steps: value.stepTrace.map(step => ({ step: step.step, status: step.status, detail: step.detail, count: step.count })),
    results: {
      observation: value.observations.map(row => ({
        time: row.time,
        entries: row.entries.map(entry => ({ element: entry.element, value: entry.value })),
      })),
      forecast: value.forecast.map(row => ({
        time: row.time,
        entries: row.entries.map(entry => ({ element: entry.element, value: entry.value })),
      })),
      suitability: value.suitability.map(day => ({
        day: day.day,
        crop: day.crop,
        activity: day.activity,
        verdict: day.verdict,
        criteria: day.criteria.map(criterion => ({
          disaster: criterion.disaster,
          element: criterion.element,
          op: criterion.op,
          value: criterion.value,
          durationH: criterion.durationH,
          level: criterion.level,
          hoursHeld: criterion.hoursHeld,
          firstTime: criterion.firstTime,
        })),
      })),
      hazard: {
        level: value.hazard.level,
        basis: value.hazard.basis.map(criterion => ({
          disaster: criterion.disaster,
          element: criterion.element,
          op: criterion.op,
          value: criterion.value,
          durationH: criterion.durationH,
          level: criterion.level,
          hoursHeld: criterion.hoursHeld,
          firstTime: criterion.firstTime,
        })),
        ...(value.hazard.ruleVersion === undefined ? {} : { ruleVersion: value.hazard.ruleVersion }),
        ...(value.hazard.evaluated === undefined ? {} : { evaluated: value.hazard.evaluated }),
      },
    },
    ...(value.ruleVersion === undefined ? {} : { ruleVersion: value.ruleVersion }),
    citations: value.citations.map(citation => ({
      docId: citation.docId,
      ordinal: citation.ordinal,
      docTitle: citation.docTitle,
      headingPath: citation.headingPath,
      charStart: citation.charStart,
      charEnd: citation.charEnd,
      snippet: capSnippet(citation.text, maxSnippetChars),
    })),
    truncated: value.truncated,
  }
}

/**
 * Pending-call presentation: a consultation card titled by the question.
 * @param args - the raw tool arguments; only the question feeds the view.
 * @returns the generic card view shown while the six steps run.
 */
export function presentConsultCall(args: ConsultArgs): GenericCallView {
  return { card: 'generic', title: args.question, kind: 'other', rawInput: args.question }
}

/**
 * Completed-call presentation: the step trace and a compact citation list from
 * `meta`, without the readings or chunk texts the model already has.
 * @param args - the raw tool arguments; the question titles the card so a replay
 *   that dropped the call head still shows what was asked.
 * @param result - the final model-facing tool result; `meta` carries the trace.
 * @returns the generic result view, or `undefined` (generic fallback) on failure
 *   or malformed meta.
 */
export function presentConsultResult(args: ConsultArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const view = consultViewFromResult(result.meta)
  if (view === undefined) return undefined
  const lines = view.steps.map(step => `${step.step} [${step.status}] ${step.detail} (${String(step.count)})`)
  for (const citation of view.citations) {
    lines.push(`- ${citation.docTitle} | chunk ${String(citation.ordinal)} | chars ${String(citation.charStart)}-${String(citation.charEnd)}`)
  }
  return {
    card: 'generic',
    title: args.question,
    ...(lines.length === 0 ? {} : { content: [{ type: 'text' as const, text: lines.join('\n') }] }),
  }
}

/**
 * Register the `meteo_consult` tool.
 * @param ctx - context whose `tools` registry, `meteoData` seam, and `corpus` seam
 *   the pipeline calls; the registration is effect-scoped, so disposing the plugin
 *   unregisters the tool.
 * @param limits - the deployment's horizon, retrieval, clarification, and timeout bounds.
 */
export function applyMeteoConsultTool(ctx: Context, limits: MeteoLimits): void {
  ctx.tools.register(defineTool({
    name: 'meteo_consult',
    description: 'Gather the published evidence that answers a farming or disaster question for one place. Runs six steps and returns their findings: the station resolve, its recent observations, its forecast horizon, per-day suitability verdicts for the crop windows in force, one disaster grade for the criteria in force, and the indexed corpus chunks that bear on the question. Pass every slot you understood; an omitted slot falls back to the session focus. It returns findings and a step trace, never an answer: you compose the answer from these.',
    parameters: {
      question: { type: 'string', required: true, description: "The question, in the caller's own words; it is also the corpus query." },
      station: { type: 'string', description: 'Station id, station name, or township the question is about. Defaults to the station the session focus holds.' },
      crop: { type: 'string', description: 'Crop the question is about, e.g. 冬小麦. Defaults to the crop the session focus holds.' },
      activity: { type: 'string', description: 'Farming activity the question is about, e.g. 播种. Narrows the suitability verdicts to that activity.' },
      period: { type: 'string', description: 'Period the question is about, in the caller\'s own words; carried through for the answer to name.' },
      disaster: { type: 'string', description: 'Disaster the question asks about, e.g. 倒伏. Selects the criteria the hazard grade is graded from.' },
      limit: { type: 'integer', description: `Corpus chunks to retrieve, 1-${String(limits.maxLimit)}. Defaults to ${String(limits.defaultLimit)}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent: { type: 'string', required: true, enum: ['station-conditions', 'activity-suitability', 'disaster-risk'] },
          slots: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              question: { type: 'string', required: true },
              station: { type: 'string' },
              crop: { type: 'string' },
              activity: { type: 'string' },
              period: { type: 'string' },
              disaster: { type: 'string' },
            },
          },
          resolvedStation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              county: { type: 'string', required: true },
              township: { type: 'string', required: true },
            },
          },
          needsClarification: {
            type: 'object',
            additionalProperties: false,
            properties: {
              reason: { type: 'string', required: true, enum: ['station-not-found', 'station-ambiguous', 'station-missing'] },
              candidates: {
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
                  },
                },
              },
            },
          },
          observations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                time: { type: 'string', required: true },
                entries: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      element: { type: 'string', required: true },
                      value: { type: 'number', required: true },
                    },
                  },
                },
              },
            },
          },
          forecast: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                time: { type: 'string', required: true },
                entries: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      element: { type: 'string', required: true },
                      value: { type: 'number', required: true },
                    },
                  },
                },
              },
            },
          },
          suitability: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                day: { type: 'string', required: true },
                crop: { type: 'string', required: true },
                activity: { type: 'string', required: true },
                verdict: { type: 'string', required: true, enum: ['suitable', 'unsuitable', 'unknown'] },
                criteria: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      disaster: { type: 'string', required: true },
                      element: { type: 'string', required: true },
                      op: { type: 'string', required: true, enum: ['>=', '<='] },
                      value: { type: 'number', required: true },
                      durationH: { type: 'number', required: true },
                      level: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
                      hoursHeld: { type: 'number', required: true },
                      firstTime: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          hazard: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              level: { type: 'string', required: true, enum: ['low', 'medium', 'high', 'unknown'] },
              basis: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    disaster: { type: 'string', required: true },
                    element: { type: 'string', required: true },
                    op: { type: 'string', required: true, enum: ['>=', '<='] },
                    value: { type: 'number', required: true },
                    durationH: { type: 'number', required: true },
                    level: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
                    hoursHeld: { type: 'number', required: true },
                    firstTime: { type: 'string', required: true },
                  },
                },
              },
              ruleVersion: { type: 'string' },
              evaluated: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  from: { type: 'string', required: true },
                  to: { type: 'string', required: true },
                },
              },
            },
          },
          citations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                ordinal: { type: 'integer', required: true },
                docTitle: { type: 'string', required: true },
                headingPath: { type: 'string', required: true },
                charStart: { type: 'integer', required: true },
                charEnd: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          ruleVersion: { type: 'string' },
          stepTrace: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                step: { type: 'string', required: true, enum: ['slots', 'observation', 'forecast', 'suitability', 'hazard', 'corpus'] },
                status: { type: 'string', required: true, enum: ['done', 'unknown', 'skipped'] },
                detail: { type: 'string', required: true },
                count: { type: 'integer', required: true },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatConsultOutput(value, limits.maxSeriesRows) }],
      presentationMeta: (_args, value) => consultMetaFromValue(value, limits.maxSnippetChars),
    },
    timeoutMs: limits.timeoutMs,
    // A consultation reads the seams and writes nothing, so two may overlap.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const question = nonEmpty(args.question)
      if (question === undefined) throw new Error('question must be a non-empty string')
      const stationArg = nonEmpty(args.station)
      const cropArg = nonEmpty(args.crop)
      const activity = nonEmpty(args.activity)
      const period = nonEmpty(args.period)
      const disaster = nonEmpty(args.disaster)
      const limit = args.limit ?? limits.defaultLimit
      if (limit < 1 || limit > limits.maxLimit) {
        throw new Error(`limit must be between 1 and ${String(limits.maxLimit)}`)
      }
      const focus = exec.agent === undefined ? null : readFocus(ctx, exec.agent)
      const crop = cropArg ?? focus?.crop
      const intent: ConsultIntent = disaster !== undefined
        ? 'disaster-risk'
        : crop !== undefined || activity !== undefined ? 'activity-suitability' : 'station-conditions'
      const slots: ConsultSlots = {
        question,
        ...(stationArg === undefined ? {} : { station: stationArg }),
        ...(crop === undefined ? {} : { crop }),
        ...(activity === undefined ? {} : { activity }),
        ...(period === undefined ? {} : { period }),
        ...(disaster === undefined ? {} : { disaster }),
      }
      const stepTrace: ConsultStep[] = []
      const resolution = await resolveStation(ctx, stationArg, focus?.stationId, limits)
      if ('clarification' in resolution) {
        const { reason, candidates } = resolution.clarification
        stepTrace.push({
          step: 'slots',
          status: 'unknown',
          detail: `no station consulted: ${REASON_TEXT[reason]}${candidates.length === 0 ? '' : `; ${String(candidates.length)} candidates offered`}`,
          count: candidates.length,
        })
        for (const step of SKIPPED_STEPS.filter(name => name !== 'corpus')) {
          stepTrace.push({ step, status: 'skipped', detail: 'not run: the consultation is not anchored to a station', count: 0 })
        }
        const terms = new Set<string>()
        for (const term of [disaster, crop, activity]) {
          if (term === undefined) continue
          terms.add(term)
          for (const synonym of await ctx.meteoData.expandTerm(term)) terms.add(synonym)
        }
        const retrieval = await ctx.corpus.search({ query: question, terms: [...terms], limit })
        const citations = retrieval.hits.map((hit: CorpusHit) => ({
          docId: hit.docId,
          ordinal: hit.ordinal,
          docTitle: hit.docTitle,
          headingPath: hit.headingPath,
          charStart: hit.charStart,
          charEnd: hit.charEnd,
          text: hit.text,
        }))
        stepTrace.push({
          step: 'corpus',
          status: citations.length === 0 ? 'unknown' : 'done',
          detail: citations.length === 0
            ? `no indexed chunk matched (${String(terms.size)} terms)`
            : `${String(citations.length)} chunks for ${String(terms.size)} terms (window ${String(limit)})`,
          count: citations.length,
        })
        const unresolved: ConsultOutput = {
          intent,
          slots,
          needsClarification: resolution.clarification,
          observations: [],
          forecast: [],
          suitability: [],
          hazard: { level: 'unknown', basis: [] },
          citations,
          stepTrace,
          truncated: citations.length === limit,
        }
        return unresolved
      }
      const { station, origin } = resolution
      const slotLines = [
        `station ${station.name} (${station.id}) ${station.county} ${station.township}, from the ${origin === 'argument' ? 'station argument' : 'session focus'}`,
        ...(crop === undefined ? [] : [`crop ${crop}`]),
        ...(activity === undefined ? [] : [`activity ${activity}`]),
        ...(period === undefined ? [] : [`period ${period}`]),
        ...(disaster === undefined ? [] : [`disaster ${disaster}`]),
      ]
      stepTrace.push({ step: 'slots', status: 'done', detail: slotLines.join('; '), count: slotLines.length })
      const observations = await ctx.meteoData.observations({ stationId: station.id })
      const observationRows = observations.map(row => seriesRow(row.time, row.elements))
      stepTrace.push({
        step: 'observation',
        status: observationRows.length === 0 ? 'unknown' : 'done',
        detail: spanDetail(`observations for station ${station.id}`, observationRows),
        count: observationRows.length,
      })
      const forecast = await ctx.meteoData.forecast({ stationId: station.id, hours: limits.forecastHours })
      const forecastRows = forecast.map(row => seriesRow(row.time, row.elements))
      stepTrace.push({
        step: 'forecast',
        status: forecastRows.length === 0 ? 'unknown' : 'done',
        detail: spanDetail(`forecast points within ${String(limits.forecastHours)} h for station ${station.id}`, forecastRows),
        count: forecastRows.length,
      })
      const calendarQuery = crop === undefined ? {} : { crop }
      const windows = await ctx.meteoData.cropCalendar(calendarQuery)
      const publishedCriteria = await ctx.meteoData.thresholds(calendarQuery)
      const scoped = activity === undefined ? windows : windows.filter(window => window.activity === activity)
      const judgements = evaluateSuitability({
        windows: scoped,
        criteria: publishedCriteria,
        samples: [...observations, ...forecast],
      })
      const verdictCount = (verdict: DaySuitability['verdict']) => judgements.filter(day => day.verdict === verdict).length
      stepTrace.push({
        step: 'suitability',
        status: judgements.length === 0 ? 'unknown' : 'done',
        detail: judgements.length === 0
          ? `no published ${activity === undefined ? 'crop' : `${activity} activity`} window covers a day the readings carry`
          : `${String(judgements.length)} day judgements: ${String(verdictCount('suitable'))} suitable, `
            + `${String(verdictCount('unsuitable'))} unsuitable, ${String(verdictCount('unknown'))} unknown`,
        count: judgements.length,
      })
      const hazardQuery = disaster === undefined ? {} : { disaster }
      const hazardCriteria = await ctx.meteoData.thresholds(hazardQuery)
      const ruleVersion = (await ctx.meteoData.versions()).datasets.thresholds
      const evaluatedSamples = [...observations, ...forecast]
      const hazardFinding = evaluateHazard({
        thresholds: hazardCriteria,
        samples: evaluatedSamples,
        ruleVersion,
      })
      const sampleTimes = evaluatedSamples.map(sample => sample.time).filter(time => time.length > 0).sort()
      const evaluated = sampleTimes.length === 0
        ? undefined
        : { from: sampleTimes[0]!, to: sampleTimes[sampleTimes.length - 1]! }
      const hazard = {
        ...hazardFinding,
        ...(evaluated === undefined ? {} : { evaluated }),
      }
      const generatedHazard = hazard.basis[0]?.disaster
      if (hazard.level !== 'unknown' && evaluated !== undefined && generatedHazard !== undefined
        && ctx.get('documentProducts') !== undefined && exec.agent !== undefined) {
        const grading: ResolvedHazard = {
          stationId: station.id,
          from: evaluated.from,
          to: evaluated.to,
          hazard: generatedHazard,
          grade: hazard.level,
          forecastHours: limits.forecastHours,
        }
        try {
          await ctx.documentProducts.hazardResolved(exec.agent.session, grading)
        } catch (error: unknown) {
          // Product generation is supplementary: log its cause and preserve the consultation findings.
          ctx.logger.warn(`meteo_consult: automatic warning product generation failed: ${String(error)}`)
        }
      }
      stepTrace.push({
        step: 'hazard',
        status: hazard.level === 'unknown' ? 'unknown' : 'done',
        detail: hazard.level === 'unknown'
          ? `no ${disaster ?? 'published'} criterion held across ${String(observations.length + forecast.length)} readings`
          : `${hazard.level}: ${hazard.basis
            .map(criterion => `${criterion.disaster} ${criterion.element}${criterion.op}${String(criterion.value)} held ${String(criterion.hoursHeld)}h from ${criterion.firstTime}`)
            .join('; ')}`,
        count: hazard.basis.length,
      })
      const terms = new Set<string>()
      for (const term of [disaster, crop, activity]) {
        if (term === undefined) continue
        terms.add(term)
        for (const synonym of await ctx.meteoData.expandTerm(term)) terms.add(synonym)
      }
      const retrieval = await ctx.corpus.search({ query: question, terms: [...terms], limit })
      const citations = retrieval.hits.map((hit: CorpusHit) => ({
        docId: hit.docId,
        ordinal: hit.ordinal,
        docTitle: hit.docTitle,
        headingPath: hit.headingPath,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        text: hit.text,
      }))
      stepTrace.push({
        step: 'corpus',
        status: citations.length === 0 ? 'unknown' : 'done',
        detail: citations.length === 0
          ? `no indexed chunk matched (${String(terms.size)} terms)`
          : `${String(citations.length)} chunks for ${String(terms.size)} terms (window ${String(limit)})`,
        count: citations.length,
      })
      return {
        intent,
        slots,
        resolvedStation: stationRef(station),
        observations: observationRows,
        forecast: forecastRows,
        suitability: judgements,
        hazard,
        citations,
        ruleVersion,
        stepTrace,
        truncated: citations.length === limit,
      }
    },
    presentCall: presentConsultCall,
    presentResult: presentConsultResult,
  }))
}
