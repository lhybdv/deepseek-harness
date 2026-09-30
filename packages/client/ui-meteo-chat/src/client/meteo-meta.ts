/**
 * Client-side copies of the `meteo_*` tools' `presentationMeta` shapes, with
 * the total narrowing a card applies to a replayed tool result.
 *
 * The host packages (`dsh-tool-meteo`) are host-only: a browser program must
 * not pull their source into the Client module graph, so the shapes this card
 * reads are re-declared here from the host projection
 * (`consultMetaFromValue` in `tool-meteo/consult.ts`, the lookup metadata in
 * `tool-meteo/station.ts`) instead of imported. The narrowing mirrors the
 * host's own replay helpers and is total — metadata from any source, including
 * a truncated log or a foreign producer, either yields the fields a renderer
 * may read without a guard or returns null so the card falls back to the
 * generic result view. Nothing is parsed from the model-facing text.
 */

/** JSON scalar kinds the narrowing helpers accept as a required field type. */
export type MetaField = 'boolean' | 'number' | 'string'

/** Required field names mapped to the scalar kind each must carry. */
export type MetaFields = Readonly<Record<string, MetaField>>

/** One station identity a card can name. */
export interface MeteoStationMeta {
  /** Stable station identifier. */
  readonly id: string
  /** Display name a farmer recognises. */
  readonly name: string
  /** County-level division the station belongs to. */
  readonly county: string
  /** Township the station represents. */
  readonly township: string
}

/** One published station as `meteo_station_lookup` metadata carries it. */
export interface MeteoLookupStationMeta extends MeteoStationMeta {
  /** Longitude in degrees. */
  readonly lon: number
  /** Latitude in degrees. */
  readonly lat: number
  /** Altitude in metres. */
  readonly altitudeM: number
}

/** One element reading of one series row. */
export interface MeteoSeriesEntryMeta {
  /** Element name as published, e.g. `precipitation`. */
  readonly element: string
  /** Reported value in the element's unit. */
  readonly value: number
}

/** One observation or forecast row, with its elements ordered by name. */
export interface MeteoSeriesRowMeta {
  /** ISO-8601 instant of the row. */
  readonly time: string
  /** Reported elements, sorted by element name for a stable rendering. */
  readonly entries: readonly MeteoSeriesEntryMeta[]
}

/** One published criterion a suitability day or hazard reading fired. */
export interface MeteoCriterionMeta {
  /** Disaster the criterion guards, as published. */
  readonly disaster: string
  /** Element the criterion reads, e.g. `precipitation`. */
  readonly element: string
  /** Comparison the criterion applies: `>=` or `<=`. */
  readonly op: string
  /** Threshold value in the element's unit. */
  readonly value: number
  /** Required holding duration in hours. */
  readonly durationH: number
  /** Grade the criterion names when it holds. */
  readonly level: string
  /** Hours the reading actually held the criterion. */
  readonly hoursHeld: number
  /** ISO-8601 instant the criterion first held. */
  readonly firstTime: string
}

/** One per-day activity judgement from the suitability step. */
export interface MeteoSuitabilityDayMeta {
  /** Day the judgement covers. */
  readonly day: string
  /** Crop the window belongs to. */
  readonly crop: string
  /** Activity the window names. */
  readonly activity: string
  /** Verdict: `suitable`, `unsuitable`, or `unknown`. */
  readonly verdict: string
  /** Every criterion that fired for the day; empty when the verdict is `unknown`. */
  readonly criteria: readonly MeteoCriterionMeta[]
}

/** The disaster reading the hazard step returns. */
export interface MeteoHazardMeta {
  /** Strongest grade among the criteria that held, or `unknown` when none did. */
  readonly level: string
  /** Every criterion that held, in published order; empty when the level is `unknown`. */
  readonly basis: readonly MeteoCriterionMeta[]
}

/** One retrieved chunk a conclusion can be attributed to, as a card receives it. */
export interface MeteoCitationMeta {
  /** Index identity to hand `corpus_read` for the verbatim chunk. */
  readonly docId: string
  /** Zero-based position of the chunk inside its document. */
  readonly ordinal: number
  /** Document title, the label a chip shows. */
  readonly docTitle: string
  /** Heading trail above the chunk; empty when the document has no headings. */
  readonly headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  readonly charStart: number
  /** Character offset one past the chunk's last character. */
  readonly charEnd: number
  /** Leading excerpt of the chunk text, capped by the deployment. */
  readonly snippet: string
}

/** One pipeline step of a consultation, in the order the steps ran. */
export interface MeteoConsultStepMeta {
  /** Pipeline step: `slots`, `observation`, `forecast`, `suitability`, `hazard`, or `corpus`. */
  readonly step: string
  /** How the step ended: `done`, `unknown`, or `skipped`. */
  readonly status: string
  /** One-line account of what the step read and concluded. */
  readonly detail: string
  /** Records the step produced; zero for a step that ran and found nothing. */
  readonly count: number
}

/** Why a consultation refused to read any data, and what it could have meant. */
export interface MeteoClarificationMeta {
  /** Why no station was settled: `station-not-found`, `station-ambiguous`, or `station-missing`. */
  readonly reason: 'station-not-found' | 'station-ambiguous' | 'station-missing'
  /** Stations the deployment offers as the likely meaning, capped by config. */
  readonly candidates: readonly MeteoStationMeta[]
}

/** The per-step findings the consultation step trace reads from. */
export interface MeteoConsultResultsMeta {
  /** Station observations, oldest first. */
  readonly observation: readonly MeteoSeriesRowMeta[]
  /** Forecast rows within the configured horizon, soonest first. */
  readonly forecast: readonly MeteoSeriesRowMeta[]
  /** Per-day activity judgements, oldest day first. */
  readonly suitability: readonly MeteoSuitabilityDayMeta[]
  /** Disaster grade the reading series supports. */
  readonly hazard: MeteoHazardMeta
}

/**
 * The `meteo_consult` presentation metadata a card may read without a guard.
 * Mirrors the host projection in `dsh-tool-meteo` (`consultMetaFromValue`).
 */
export interface MeteoConsultMeta {
  /** Pipeline trace, in the order the steps ran. */
  readonly steps: readonly MeteoConsultStepMeta[]
  /** Per-step findings behind the trace. */
  readonly results: MeteoConsultResultsMeta
  /** Station the consultation actually read, when one was settled. */
  readonly resolvedStation?: MeteoStationMeta | undefined
  /** Present when the consultation stopped before reading any data. */
  readonly needsClarification?: MeteoClarificationMeta | undefined
  /** Retrieved chunks in result order, each with a capped excerpt. */
  readonly citations: readonly MeteoCitationMeta[]
  /** Whether the chunk list filled the retrieval window, so more may exist. */
  readonly truncated: boolean
}

/** The `meteo_station_lookup` presentation metadata a card may read. */
export interface MeteoLookupMeta {
  /** The matching stations, in the order the seam published them. */
  readonly stations: readonly MeteoLookupStationMeta[]
}

const STATION_FIELDS: MetaFields = { id: 'string', name: 'string', county: 'string', township: 'string' }
const LOOKUP_FIELDS: MetaFields = {
  id: 'string', name: 'string', county: 'string', township: 'string',
  lon: 'number', lat: 'number', altitudeM: 'number',
}
const STEP_FIELDS: MetaFields = { step: 'string', status: 'string', detail: 'string', count: 'number' }
const SERIES_ENTRY_FIELDS: MetaFields = { element: 'string', value: 'number' }
const CRITERION_FIELDS: MetaFields = {
  disaster: 'string', element: 'string', op: 'string', value: 'number', durationH: 'number',
  level: 'string', hoursHeld: 'number', firstTime: 'string',
}
const DAY_FIELDS: MetaFields = { day: 'string', crop: 'string', activity: 'string', verdict: 'string' }
const CITATION_FIELDS: MetaFields = {
  docId: 'string', ordinal: 'number', docTitle: 'string', headingPath: 'string',
  charStart: 'number', charEnd: 'number', snippet: 'string',
}

/**
 * Narrow an opaque value to an object carrying every field of `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each must carry.
 * @returns the record for further reads, or undefined when `value` is not an
 *   object or any required field is missing or mistyped.
 */
export function narrowFields(value: unknown, fields: MetaFields): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const [key, kind] of Object.entries(fields)) {
    if (typeof record[key] !== kind) return undefined
  }
  return record
}

/**
 * Narrow an opaque value to a list of records that each carry `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each element must carry.
 * @returns the records in list order, or undefined when `value` is not an array
 *   or any element lacks one of the fields.
 */
export function narrowRecords(value: unknown, fields: MetaFields): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records: Record<string, unknown>[] = []
  for (const item of value) {
    const record = narrowFields(item, fields)
    if (record === undefined) return undefined
    records.push(record)
  }
  return records
}

/**
 * Whether one opaque string names a clarification reason the card can present.
 * @param value - the metadata's `needsClarification.reason`, however foreign.
 * @returns true for one of the three reasons the host emits.
 */
function isClarificationReason(value: unknown): value is MeteoClarificationMeta['reason'] {
  return value === 'station-not-found' || value === 'station-ambiguous' || value === 'station-missing'
}

/**
 * Narrow one station record (identity fields only) already passed through
 * {@link narrowFields} with {@link STATION_FIELDS}.
 * @param record - validated station record.
 * @returns the station identity.
 */
function stationOf(record: Record<string, unknown>): MeteoStationMeta {
  return {
    id: record.id as string,
    name: record.name as string,
    county: record.county as string,
    township: record.township as string,
  }
}

function narrowStation(value: unknown): MeteoStationMeta | undefined {
  const record = narrowFields(value, STATION_FIELDS)
  return record === undefined ? undefined : stationOf(record)
}

function narrowSeriesRow(value: unknown): MeteoSeriesRowMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.time !== 'string' || !Array.isArray(record.entries)) return undefined
  const entries: MeteoSeriesEntryMeta[] = []
  for (const item of record.entries) {
    const entry = narrowFields(item, SERIES_ENTRY_FIELDS)
    if (entry === undefined) return undefined
    entries.push({ element: entry.element as string, value: entry.value as number })
  }
  return { time: record.time, entries }
}

function narrowSeriesRows(value: unknown): MeteoSeriesRowMeta[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: MeteoSeriesRowMeta[] = []
  for (const row of value) {
    const narrowed = narrowSeriesRow(row)
    if (narrowed === undefined) return undefined
    rows.push(narrowed)
  }
  return rows
}

function criterionOf(record: Record<string, unknown>): MeteoCriterionMeta {
  return {
    disaster: record.disaster as string,
    element: record.element as string,
    op: record.op as string,
    value: record.value as number,
    durationH: record.durationH as number,
    level: record.level as string,
    hoursHeld: record.hoursHeld as number,
    firstTime: record.firstTime as string,
  }
}

function narrowCriterionList(value: unknown): MeteoCriterionMeta[] | undefined {
  const records = narrowRecords(value, CRITERION_FIELDS)
  if (records === undefined) return undefined
  return records.map(criterionOf)
}

function narrowSuitabilityDay(value: unknown): MeteoSuitabilityDayMeta | undefined {
  const record = narrowFields(value, DAY_FIELDS)
  if (record === undefined) return undefined
  const criteria = narrowCriterionList((value as Record<string, unknown>).criteria)
  if (criteria === undefined) return undefined
  return {
    day: record.day as string,
    crop: record.crop as string,
    activity: record.activity as string,
    verdict: record.verdict as string,
    criteria,
  }
}

/**
 * Copy one citation record already passed through {@link narrowRecords} with
 * {@link CITATION_FIELDS}.
 * @param record - validated citation record.
 * @returns the citation the card reads.
 */
function citationOf(record: Record<string, unknown>): MeteoCitationMeta {
  return {
    docId: record.docId as string,
    ordinal: record.ordinal as number,
    docTitle: record.docTitle as string,
    headingPath: record.headingPath as string,
    charStart: record.charStart as number,
    charEnd: record.charEnd as number,
    snippet: record.snippet as string,
  }
}

/**
 * Narrow opaque `meteo_station_lookup` result metadata into the card's read.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the published stations, or null when the metadata is malformed.
 */
export function narrowLookupMeta(meta: unknown): MeteoLookupMeta | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const records = narrowRecords((meta as Record<string, unknown>).stations, LOOKUP_FIELDS)
  if (records === undefined) return null
  return {
    stations: records.map(item => ({
      ...stationOf(item),
      lon: item.lon as number,
      lat: item.lat as number,
      altitudeM: item.altitudeM as number,
    })),
  }
}

/**
 * Narrow opaque `meteo_consult` result metadata into the card's read.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the trace, findings, clarification, and citation list, or null when
 *   the metadata is missing or malformed.
 */
export function narrowConsultMeta(meta: unknown): MeteoConsultMeta | null {
  const head = narrowFields(meta, { truncated: 'boolean' })
  if (head === undefined) return null

  const stepRecords = narrowRecords(head.steps, STEP_FIELDS)
  if (stepRecords === undefined) return null
  const steps = stepRecords.map(record => ({
    step: record.step as string,
    status: record.status as string,
    detail: record.detail as string,
    count: record.count as number,
  }))

  const results = head.results
  if (typeof results !== 'object' || results === null || Array.isArray(results)) return null
  const resultRecord = results as Record<string, unknown>
  const observation = narrowSeriesRows(resultRecord.observation)
  if (observation === undefined) return null
  const forecast = narrowSeriesRows(resultRecord.forecast)
  if (forecast === undefined) return null

  const suitability: MeteoSuitabilityDayMeta[] = []
  const rawDays = resultRecord.suitability
  if (!Array.isArray(rawDays)) return null
  for (const day of rawDays) {
    const narrowed = narrowSuitabilityDay(day)
    if (narrowed === undefined) return null
    suitability.push(narrowed)
  }

  const hazard = resultRecord.hazard
  if (typeof hazard !== 'object' || hazard === null || Array.isArray(hazard)) return null
  const hazardRecord = hazard as Record<string, unknown>
  if (typeof hazardRecord.level !== 'string') return null
  const basis = narrowCriterionList(hazardRecord.basis)
  if (basis === undefined) return null

  const citationRecords = narrowRecords(head.citations, CITATION_FIELDS)
  if (citationRecords === undefined) return null
  const citations = citationRecords.map(citationOf)

  // Optional members are derived before the view is built: the narrowed
  // metadata is immutable once returned, so nothing is assigned into it.
  let resolvedStation: MeteoStationMeta | undefined
  if (head.resolvedStation !== undefined) {
    resolvedStation = narrowStation(head.resolvedStation)
    if (resolvedStation === undefined) return null
  }
  let needsClarification: MeteoClarificationMeta | undefined
  if (head.needsClarification !== undefined) {
    if (typeof head.needsClarification !== 'object' || head.needsClarification === null
      || Array.isArray(head.needsClarification)) {
      return null
    }
    const clarification = head.needsClarification as Record<string, unknown>
    if (!isClarificationReason(clarification.reason)) return null
    const candidateRecords = narrowRecords(clarification.candidates, STATION_FIELDS)
    if (candidateRecords === undefined) return null
    needsClarification = {
      reason: clarification.reason,
      candidates: candidateRecords.map(stationOf),
    }
  }

  return {
    steps,
    results: { observation, forecast, suitability, hazard: { level: hazardRecord.level, basis } },
    citations,
    truncated: head.truncated as boolean,
    ...resolvedStation === undefined ? {} : { resolvedStation },
    ...needsClarification === undefined ? {} : { needsClarification },
  }
}
