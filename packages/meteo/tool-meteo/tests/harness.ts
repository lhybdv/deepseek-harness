/**
 * Shared harness for the consultation tool tests: stubbed data and corpus seams
 * that record every request, a Northeast station and weather-series fixture, and
 * a mounted context whose agent, session log, and projection registry are live.
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
  { id: 'hl-wc-01', name: '五常市五常镇自动站', county: '五常市', township: '五常镇', lon: 127.16, lat: 44.93, altitudeM: 150 },
  { id: 'hl-wc-02', name: '五常市拉林满族镇自动站', county: '五常市', township: '拉林满族镇', lon: 127.27, lat: 45.27, altitudeM: 165 },
  { id: 'jl-ys-03', name: '榆树市弓棚镇自动站', county: '榆树市', township: '弓棚镇', lon: 126.8, lat: 44.93, altitudeM: 195 },
]

/** Hourly Northeast autumn readings: wind holds gale force for six hours. */
export const OBSERVATIONS: Observation[] = [
  { stationId: 'hl-wc-01', time: '2026-10-08T04:00:00Z', elements: { temperature: 2.4, windSpeed: 14.8, soilMoisture: 32.5 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T05:00:00Z', elements: { temperature: 1.9, windSpeed: 17.6, soilMoisture: 32.1 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T06:00:00Z', elements: { temperature: 2.3, windSpeed: 16.9, soilMoisture: 31.8 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T07:00:00Z', elements: { temperature: 3.1, windSpeed: 15.4, soilMoisture: 31.4 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T08:00:00Z', elements: { temperature: 4.2, windSpeed: 14.1, soilMoisture: 30.9 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T09:00:00Z', elements: { temperature: 5.6, windSpeed: 14.6, soilMoisture: 30.3 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T10:00:00Z', elements: { temperature: 6.8, windSpeed: 14.2, soilMoisture: 29.8 } },
  { stationId: 'hl-wc-01', time: '2026-10-08T11:00:00Z', elements: { temperature: 7.1, windSpeed: 13.2, soilMoisture: 29.4 } },
]

/** Three-hourly Northeast autumn points, the last one a day out, with no soil moisture. */
export const FORECAST: ForecastPoint[] = [
  { time: '2026-10-08T12:00:00Z', elements: { temperature: 8.4, windSpeed: 9.8, precipitation: 0 } },
  { time: '2026-10-08T15:00:00Z', elements: { temperature: 6.1, windSpeed: 12.4, precipitation: 6.2 } },
  { time: '2026-10-08T18:00:00Z', elements: { temperature: 3.8, windSpeed: 18.7, precipitation: 31.5 } },
  { time: '2026-10-09T18:00:00Z', elements: { temperature: 1.4, windSpeed: 21.3, precipitation: 52.8 } },
]

/** Two thresholds govern the early-frost window; the others cover rain and spring drought. */
export const THRESHOLDS: Threshold[] = [
  { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
  { disaster: '大风', element: 'windSpeed', op: '>=', value: 24.5, durationH: 6, level: 'high' },
  { disaster: '暴雨', element: 'precipitation', op: '>=', value: 50, durationH: 24, level: 'high' },
  { disaster: '春旱', element: 'soilMoisture', op: '<=', value: 30, durationH: 168, level: 'medium' },
  { disaster: '初霜', element: 'temperature', op: '<=', value: 2, durationH: 6, level: 'medium' },
]

export const WINDOWS: CropWindow[] = [
  {
    crop: '玉米',
    activity: '成熟收获',
    windowStart: '10-05',
    windowEnd: '10-20',
    criteria: [
      { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
      { disaster: '初霜', element: 'temperature', op: '<=', value: 2, durationH: 6, level: 'medium' },
    ],
  },
  {
    crop: '水稻',
    activity: '收获',
    windowStart: '10-05',
    windowEnd: '10-20',
    criteria: [{ disaster: '暴雨', element: 'precipitation', op: '>=', value: 50, durationH: 24, level: 'high' }],
  },
]

const DOC_ID = brandString<CorpusDocumentId>('guide-1')

export const CHUNK: CorpusChunk = {
  docId: DOC_ID,
  ordinal: 2,
  headingPath: '玉米成熟收获期初霜防御',
  charStart: 480,
  charEnd: 640,
  text: '玉米成熟收获期出现初霜时，应及时组织抢收并做好粮食晾晒和防潮。',
}

export const HIT: CorpusHit = { ...CHUNK, docTitle: '东北玉米初霜防御技术指南', score: 2.4 }

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
  stationRows: Station[] = STATIONS.map(station => ({ ...station }))
  observationRows: Observation[] = OBSERVATIONS
  forecastPoints: ForecastPoint[] = FORECAST
  thresholdRows: Threshold[] = THRESHOLDS
  windows: CropWindow[] = WINDOWS
  synonyms: Record<string, string[]> = { 大风: ['狂风'], 春旱: ['墒情不足', '春季缺墒'] }
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
