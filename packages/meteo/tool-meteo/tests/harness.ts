/**
 * Shared harness for the consultation tool tests: a stubbed data seam and corpus
 * seam that record every request, the repository's Henan fixtures, and a mounted
 * context whose agent, session log, and projection registry are all live.
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  CorpusChunk,
  CorpusDocument,
  CorpusDocumentId,
  CorpusHit,
  IngestRequest,
  IngestResult,
  RemoveResult,
  SearchRequest,
  SearchResult,
} from '@deepseek-ai/dsh-meteo-corpus'
import { CorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import type {
  CropWindow,
  ForecastPoint,
  MeteoDatasetKind,
  Observation,
  Station,
  Threshold,
} from '@deepseek-ai/dsh-meteo-data'
import { MeteoData, meteoFocusProjectionDefinition } from '@deepseek-ai/dsh-meteo-data'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolMeteo from '@deepseek-ai/dsh-tool-meteo'
import type {
  Clarification,
  Config,
  ConsultCitationMeta,
  ConsultHazard,
  ConsultIntent,
  ConsultSlots,
  ConsultStepMeta,
  SeriesRow,
  StationRef,
} from '@deepseek-ai/dsh-tool-meteo'

export const STATIONS: Station[] = [
  { id: 'ha-xx-01', name: '新乡县城关自动站', county: '新乡县', township: '城关镇', lon: 113.82, lat: 35.18, altitudeM: 73.4 },
  { id: 'ha-xx-02', name: '新乡县翟坡自动站', county: '新乡县', township: '翟坡镇', lon: 113.75, lat: 35.22, altitudeM: 75.1 },
  { id: 'ha-yc-03', name: '原阳县齐街自动站', county: '原阳县', township: '齐街镇', lon: 114.02, lat: 35.05, altitudeM: 71.2 },
]

/** Hourly readings on a day inside the sowing window: wind holds gale force for six hours. */
export const OBSERVATIONS: Observation[] = [
  { stationId: 'ha-xx-01', time: '2026-10-08T04:00:00Z', elements: { temperature: 21.4, windSpeed: 14.8, soilMoisture: 52.5 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T05:00:00Z', elements: { temperature: 21.9, windSpeed: 17.6, soilMoisture: 52.1 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T06:00:00Z', elements: { temperature: 22.3, windSpeed: 16.9, soilMoisture: 51.8 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T07:00:00Z', elements: { temperature: 23.1, windSpeed: 15.4, soilMoisture: 51.4 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T08:00:00Z', elements: { temperature: 24.2, windSpeed: 14.1, soilMoisture: 50.9 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T09:00:00Z', elements: { temperature: 25.6, windSpeed: 14.6, soilMoisture: 50.3 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T10:00:00Z', elements: { temperature: 26.8, windSpeed: 14.2, soilMoisture: 49.8 } },
  { stationId: 'ha-xx-01', time: '2026-10-08T11:00:00Z', elements: { temperature: 27.1, windSpeed: 13.2, soilMoisture: 49.4 } },
]

/** Three-hourly points, the last one a day out, with no soil moisture at all. */
export const FORECAST: ForecastPoint[] = [
  { time: '2026-10-08T12:00:00Z', elements: { temperature: 27.4, windSpeed: 9.8, precipitation: 0 } },
  { time: '2026-10-08T15:00:00Z', elements: { temperature: 24.1, windSpeed: 12.4, precipitation: 6.2 } },
  { time: '2026-10-08T18:00:00Z', elements: { temperature: 21.8, windSpeed: 18.7, precipitation: 31.5 } },
  { time: '2026-10-09T18:00:00Z', elements: { temperature: 19.4, windSpeed: 21.3, precipitation: 52.8 } },
]

/** Two of these govern the sowing window; the third belongs to another disaster. */
export const THRESHOLDS: Threshold[] = [
  { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
  { disaster: '大风', element: 'windSpeed', op: '>=', value: 24.5, durationH: 6, level: 'high' },
  { disaster: '暴雨', element: 'precipitation', op: '>=', value: 50, durationH: 24, level: 'high' },
  { disaster: '干旱', element: 'soilMoisture', op: '<=', value: 30, durationH: 168, level: 'medium' },
]

export const WINDOWS: CropWindow[] = [
  {
    crop: '冬小麦',
    activity: '播种',
    windowStart: '10-05',
    windowEnd: '10-20',
    criteria: [
      { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
      { disaster: '干旱', element: 'soilMoisture', op: '<=', value: 40, durationH: 72, level: 'medium' },
    ],
  },
  {
    crop: '冬小麦',
    activity: '施肥',
    windowStart: '10-25',
    windowEnd: '11-10',
    criteria: [{ disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' }],
  },
]

const DOC_ID = brandString<CorpusDocumentId>('guide-1')

export const CHUNK: CorpusChunk = {
  docId: DOC_ID,
  ordinal: 2,
  headingPath: '播种期大风防御',
  charStart: 480,
  charEnd: 640,
  text: '播种期内出现 6 级以上持续大风时，应暂缓播种并做好耙压保墒。',
}

export const HIT: CorpusHit = { ...CHUNK, docTitle: '河南冬小麦栽培技术指南', score: 2.4 }

/** Data seam double that records every request the consultation issues. */
export class StubMeteoData extends MeteoData {
  readonly calls: string[] = []
  readonly observationQueries: { stationId: string }[] = []
  readonly forecastQueries: { stationId: string; hours: number }[] = []
  readonly thresholdQueries: { disaster?: string; crop?: string }[] = []
  readonly calendarQueries: { disaster?: string; crop?: string }[] = []
  readonly stationQueries: { county?: string; text?: string }[] = []
  readonly stationLookups: string[] = []
  readonly expansions: string[] = []
  stationRows: Station[] = STATIONS
  observationRows: Observation[] = OBSERVATIONS
  forecastPoints: ForecastPoint[] = FORECAST
  thresholdRows: Threshold[] = THRESHOLDS
  windows: CropWindow[] = WINDOWS
  synonyms: Record<string, string[]> = { 大风: ['狂风'], 干旱: ['旱灾'] }
  datasetVersions: Record<MeteoDatasetKind, string> = {
    stations: 'st-1',
    observations: 'obs-9',
    forecast: 'fct-4',
    thresholds: 'th-7',
    cropCalendar: 'cal-3',
    synonyms: 'syn-2',
    taxonomy: 'tax-1',
  }

  override async stations(query: { county?: string; text?: string } = {}): Promise<readonly Station[]> {
    this.stationQueries.push(query)
    this.calls.push(`stations:${query.county ?? ''}:${query.text ?? ''}`)
    const text = query.text ?? ''
    return this.stationRows.filter(station =>
      (query.county === undefined || station.county === query.county)
      && (station.id.includes(text) || station.name.includes(text) || station.county.includes(text) || station.township.includes(text)))
  }

  override async station(id: string): Promise<Station | undefined> {
    this.stationLookups.push(id)
    this.calls.push(`station:${id}`)
    return this.stationRows.find(station => station.id === id)
  }

  override async observations(query: { stationId: string; from?: string; to?: string }): Promise<readonly Observation[]> {
    this.observationQueries.push({ stationId: query.stationId })
    this.calls.push(`observations:${query.stationId}`)
    return this.observationRows.filter(observation => observation.stationId === query.stationId)
  }

  override async forecast(query: { stationId: string; from?: string; hours?: number }): Promise<readonly ForecastPoint[]> {
    this.forecastQueries.push({ stationId: query.stationId, hours: query.hours ?? 0 })
    this.calls.push(`forecast:${query.stationId}:${String(query.hours ?? 0)}`)
    return this.forecastPoints
  }

  override async thresholds(query: { disaster?: string; crop?: string } = {}): Promise<readonly Threshold[]> {
    this.thresholdQueries.push(query)
    this.calls.push(`thresholds:${query.disaster ?? ''}:${query.crop ?? ''}`)
    return this.thresholdRows.filter(threshold => query.disaster === undefined || threshold.disaster === query.disaster)
  }

  override async cropCalendar(query: { disaster?: string; crop?: string } = {}): Promise<readonly CropWindow[]> {
    this.calendarQueries.push(query)
    this.calls.push(`cropCalendar:${query.crop ?? ''}:${query.disaster ?? ''}`)
    return this.windows.filter(window =>
      (query.crop === undefined || window.crop === query.crop)
      && (query.disaster === undefined || window.criteria.some(criterion => criterion.disaster === query.disaster)))
  }

  override async expandTerm(term: string): Promise<readonly string[]> {
    this.expansions.push(term)
    this.calls.push(`expandTerm:${term}`)
    return this.synonyms[term] ?? []
  }

  override async versions(): Promise<{ version: string; datasets: Record<MeteoDatasetKind, string> }> {
    this.calls.push('versions')
    return { version: 'fixture-1', datasets: this.datasetVersions }
  }
}

/** Corpus seam double that records every ingest and retrieval request. */
export class StubCorpus extends CorpusStore {
  readonly ingestRequests: IngestRequest[] = []
  readonly searchRequests: SearchRequest[] = []
  searchHits: CorpusHit[] = [HIT]

  override async ingest(request: IngestRequest): Promise<IngestResult> {
    this.ingestRequests.push(request)
    return { documents: [], failures: [] }
  }

  override async search(request: SearchRequest): Promise<SearchResult> {
    this.searchRequests.push(request)
    return { hits: this.searchHits.slice(0, request.limit), matchExpression: '"大风" OR "狂风"' }
  }

  override async readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined> {
    return ordinal === 0 ? undefined : { ...CHUNK, docId }
  }

  override async listDocuments(): Promise<CorpusDocument[]> {
    return []
  }

  override async remove(docId: CorpusDocumentId): Promise<RemoveResult> {
    return { docId, removed: false }
  }
}

const testToolSignal = new AbortController().signal

export interface Harness {
  ctx: Context
  data: StubMeteoData
  corpus: StubCorpus
  agent: Agent
  call: (name: string, args: unknown) => Promise<ToolExecutionResult>
  callWithoutAgent: (name: string, args: unknown) => Promise<ToolExecutionResult>
}

let mounted = 0

/** Mount every seam this package consumes, without the consultation tools. */
export async function mountSeams(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(meteoFocusProjectionDefinition)
  await ctx.plugin(StubMeteoData)
  await ctx.plugin(StubCorpus)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Mount the real registry, prompt service, session log, and focus projection behind the tools. */
export async function mountTools(config: Config = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(meteoFocusProjectionDefinition)
  await ctx.plugin(StubMeteoData)
  await ctx.plugin(StubCorpus)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolMeteo, config)
  const session = ctx.sessions.create(SessionId(`tool-meteo-${String(++mounted)}`))
  const agent = { id: `agent-${String(mounted)}`, session, ctx, status: 'idle' } as unknown as Agent
  let counter = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${String(++counter)}`),
    name,
    arguments: args,
    agent,
  })
  const callWithoutAgent = (name: string, args: unknown) => ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-no-agent-${String(++counter)}`),
    name,
    arguments: args,
  })
  return { ctx, data: ctx.meteoData as StubMeteoData, corpus: ctx.corpus as StubCorpus, agent, call, callWithoutAgent }
}

/** One criterion a suitability judgement graded, with how long it held. */
export interface SuitabilityCriterion {
  disaster: string
  element: string
  op: '>=' | '<='
  value: number
  durationH: number
  level: 'low' | 'medium' | 'high'
  hoursHeld?: number
  firstTime?: string
}

/** One day's activity judgement as the result metadata carries it. */
export interface SuitabilityJudgement {
  day: string
  crop: string
  activity: string
  verdict: 'suitable' | 'unsuitable' | 'unknown'
  criteria: readonly SuitabilityCriterion[]
}

/** The `presentationMeta` a mounted `meteo_consult` call returned. */
export interface ConsultMeta {
  intent: ConsultIntent
  slots: ConsultSlots
  resolvedStation?: StationRef
  needsClarification?: Clarification
  steps: readonly ConsultStepMeta[]
  results: {
    observation: readonly SeriesRow[]
    forecast: readonly SeriesRow[]
    suitability: readonly SuitabilityJudgement[]
    hazard?: ConsultHazard
  }
  ruleVersion?: string
  citations: readonly ConsultCitationMeta[]
  truncated: boolean
}

/** The `presentationMeta` a consultation or lookup returned, as a test reads it. */
export function viewMeta(result: ToolExecutionResult): ConsultMeta {
  return result.meta as unknown as ConsultMeta
}

/** The final model-facing result, in the shape a presenter is handed. */
export function resultFor(result: ToolExecutionResult) {
  return { content: result.content, isError: result.isError, ...(result.meta === undefined ? {} : { meta: result.meta }) }
}

export const modelText = (result: ToolExecutionResult): string =>
  result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
