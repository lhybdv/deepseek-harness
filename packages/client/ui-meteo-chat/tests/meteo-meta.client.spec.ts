/**
 * The total narrowing over the meteo tools' presentation metadata.
 *
 * The metadata reaches a card from a live result, a replayed log, or a foreign
 * producer, so every rejection path matters: a malformed value must yield null
 * (the generic fallback) rather than a half-parsed verdict. The success cases
 * pin the reconstructed shape field by field.
 */
import { describe, expect, it } from 'vitest'
import {
  narrowConsultMeta, narrowFields, narrowLookupMeta, narrowRecords, type MetaFields,
} from '../src/client/meteo-meta.ts'

const STATION = { id: 'st-1', name: '北京站', county: '海淀区', township: '西三旗' }
const LOOKUP_STATION = { ...STATION, lon: 116.4, lat: 39.9, altitudeM: 44 }
const ENTRY = { element: 'precipitation', value: 12 }
const ROW = { time: '2026-09-30T00:00:00Z', entries: [ENTRY] }
const CRITERION = {
  disaster: 'drought', element: 'precipitation', op: '<=', value: 2, durationH: 24,
  level: 'high', hoursHeld: 30, firstTime: '2026-09-29T00:00:00Z',
}
const DAY = { day: '2026-09-30', crop: '小麦', activity: '打药', verdict: 'suitable', criteria: [CRITERION] }
const STEP = { step: 'observation', status: 'done', detail: '读到 1 条', count: 1 }
const CITATION = {
  docId: 'doc-1', ordinal: 2, docTitle: '手册', headingPath: '第三章', charStart: 0, charEnd: 10, snippet: '片段',
}

const RESULTS = {
  observation: [ROW], forecast: [ROW], suitability: [DAY], hazard: { level: 'high', basis: [CRITERION] },
}

/** One well-formed consult metadata value, overridable at the top level. */
function consult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { steps: [STEP], results: RESULTS, citations: [CITATION], truncated: false, ...over }
}

/** The well-formed findings map, overridable per key. */
function results(over: Record<string, unknown>): Record<string, unknown> {
  return { ...RESULTS, ...over }
}

describe('narrowFields', () => {
  const FIELDS: MetaFields = { a: 'string', b: 'number' }

  it('returns the record when every required field carries its scalar kind', () => {
    const value = { a: 'x', b: 1, extra: true }
    expect(narrowFields(value, FIELDS)).toBe(value)
  })

  it.each([
    ['a string', 'x'],
    ['a number', 7],
    ['null', null],
    ['an array', []],
    ['undefined', undefined],
    ['a boolean', false],
  ])('rejects %s: not an object', (_label, value) => {
    expect(narrowFields(value, FIELDS)).toBeUndefined()
  })

  it('rejects a missing field and a mistyped field', () => {
    expect(narrowFields({ a: 'x' }, FIELDS)).toBeUndefined()
    expect(narrowFields({ a: 1, b: 1 }, FIELDS)).toBeUndefined()
    expect(narrowFields({ a: 'x', b: '1' }, FIELDS)).toBeUndefined()
    expect(narrowFields({ a: 'x', b: null }, FIELDS)).toBeUndefined()
  })

  it('accepts any object when no field is required', () => {
    expect(narrowFields({}, {})).toEqual({})
    expect(narrowFields([], {})).toBeUndefined()
  })
})

describe('narrowRecords', () => {
  const FIELDS: MetaFields = { a: 'string' }

  it('returns the records in list order', () => {
    expect(narrowRecords([{ a: 'x' }, { a: 'y' }], FIELDS)).toEqual([{ a: 'x' }, { a: 'y' }])
  })

  it('returns an empty list for an empty list', () => {
    expect(narrowRecords([], FIELDS)).toEqual([])
  })

  it('rejects a non-array and any list holding a bad element', () => {
    expect(narrowRecords(undefined, FIELDS)).toBeUndefined()
    expect(narrowRecords({ a: 'x' }, FIELDS)).toBeUndefined()
    expect(narrowRecords([{ a: 'x' }, { a: 1 }], FIELDS)).toBeUndefined()
    expect(narrowRecords([null], FIELDS)).toBeUndefined()
  })
})

describe('narrowLookupMeta', () => {
  it('rejects a value that is not an object carrying a station list', () => {
    expect(narrowLookupMeta(null)).toBeNull()
    expect(narrowLookupMeta('stations')).toBeNull()
    expect(narrowLookupMeta([])).toBeNull()
    expect(narrowLookupMeta({})).toBeNull()
    expect(narrowLookupMeta({ stations: 'st-1' })).toBeNull()
  })

  it('rejects a station missing an identity field or its coordinates', () => {
    expect(narrowLookupMeta({ stations: [{ ...LOOKUP_STATION, township: 5 }] })).toBeNull()
    expect(narrowLookupMeta({ stations: [{ ...LOOKUP_STATION, altitudeM: '44' }] })).toBeNull()
    expect(narrowLookupMeta({ stations: [{ ...LOOKUP_STATION, lon: null }] })).toBeNull()
  })

  it('reconstructs the published stations with their coordinates', () => {
    expect(narrowLookupMeta({ stations: [LOOKUP_STATION] })).toEqual({ stations: [LOOKUP_STATION] })
    expect(narrowLookupMeta({ stations: [] })).toEqual({ stations: [] })
  })
})

describe('narrowConsultMeta', () => {
  it('rejects a head that is not an object with a boolean truncated flag', () => {
    expect(narrowConsultMeta(null)).toBeNull()
    expect(narrowConsultMeta('trace')).toBeNull()
    expect(narrowConsultMeta([])).toBeNull()
    expect(narrowConsultMeta({})).toBeNull()
    expect(narrowConsultMeta(consult({ truncated: 'no' }))).toBeNull()
  })

  it('rejects a step list that is missing, non-array, or holding a mistyped step', () => {
    expect(narrowConsultMeta(consult({ steps: undefined }))).toBeNull()
    expect(narrowConsultMeta(consult({ steps: 'slots' }))).toBeNull()
    expect(narrowConsultMeta(consult({ steps: [null] }))).toBeNull()
    expect(narrowConsultMeta(consult({ steps: [{ ...STEP, count: '1' }] }))).toBeNull()
    expect(narrowConsultMeta(consult({ steps: [{ step: 'slots', status: 'done', detail: 'x' }] }))).toBeNull()
  })

  it('rejects findings that are not an object', () => {
    expect(narrowConsultMeta(consult({ results: null }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: [] }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: 'findings' }))).toBeNull()
  })

  it('rejects unreadable observation rows', () => {
    expect(narrowConsultMeta(consult({ results: results({ observation: 'rows' }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ observation: ['row'] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ observation: [{ entries: [] }] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ observation: [{ time: 't', entries: 'x' }] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ observation: [{ time: 't', entries: [null] }] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({
      results: results({ observation: [{ time: 't', entries: [{ element: 'p' }] }] }),
    }))).toBeNull()
  })

  it('rejects unreadable forecast rows', () => {
    expect(narrowConsultMeta(consult({ results: results({ forecast: undefined }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ forecast: [7] }) }))).toBeNull()
  })

  it('rejects unreadable suitability days and criteria', () => {
    expect(narrowConsultMeta(consult({ results: results({ suitability: 'days' }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ suitability: ['day'] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ suitability: [{ ...DAY, crop: 1 }] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ suitability: [{ ...DAY, criteria: undefined }] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ suitability: [{ ...DAY, criteria: [{ ...CRITERION, op: 1 }] }] }) }))).toBeNull()
  })

  it('rejects an unreadable hazard reading', () => {
    expect(narrowConsultMeta(consult({ results: results({ hazard: null }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ hazard: [] }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ hazard: 'high' }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ hazard: { basis: [] } }) }))).toBeNull()
    expect(narrowConsultMeta(consult({ results: results({ hazard: { level: 'high', basis: 1 } }) }))).toBeNull()
    expect(narrowConsultMeta(consult({
      results: results({ hazard: { level: 'high', basis: [{ ...CRITERION, hoursHeld: '30' }] } }),
    }))).toBeNull()
  })

  it('rejects an unreadable citation list', () => {
    expect(narrowConsultMeta(consult({ citations: undefined }))).toBeNull()
    expect(narrowConsultMeta(consult({ citations: 'chunks' }))).toBeNull()
    expect(narrowConsultMeta(consult({ citations: [{ ...CITATION, ordinal: '2' }] }))).toBeNull()
    expect(narrowConsultMeta(consult({ citations: [{ ...CITATION, charEnd: '10' }] }))).toBeNull()
  })

  it('rejects an unreadable resolved station', () => {
    expect(narrowConsultMeta(consult({ resolvedStation: 'st-1' }))).toBeNull()
    expect(narrowConsultMeta(consult({ resolvedStation: { ...STATION, name: 1 } }))).toBeNull()
  })

  it('rejects a clarification that is not a readable question', () => {
    expect(narrowConsultMeta(consult({ needsClarification: 'why' }))).toBeNull()
    expect(narrowConsultMeta(consult({ needsClarification: [] }))).toBeNull()
    expect(narrowConsultMeta(consult({ needsClarification: { reason: 'because' } }))).toBeNull()
    expect(narrowConsultMeta(consult({ needsClarification: { reason: 'station-missing', candidates: 'none' } }))).toBeNull()
    expect(narrowConsultMeta(consult({
      needsClarification: { reason: 'station-missing', candidates: [{ ...STATION, id: 1 }] },
    }))).toBeNull()
  })

  it('reconstructs the trace, findings, and citation list of a full result', () => {
    expect(narrowConsultMeta(consult())).toEqual({
      steps: [STEP],
      results: RESULTS,
      citations: [CITATION],
      truncated: false,
    })
  })

  it('carries the optional members only when the metadata holds them', () => {
    const without = narrowConsultMeta(consult())
    expect(without).not.toBeNull()
    expect(without?.resolvedStation).toBeUndefined()
    expect(without?.needsClarification).toBeUndefined()

    expect(narrowConsultMeta(consult({ resolvedStation: STATION, truncated: true }))).toEqual({
      steps: [STEP],
      results: RESULTS,
      citations: [CITATION],
      truncated: true,
      resolvedStation: STATION,
    })
    expect(narrowConsultMeta(consult({
      needsClarification: { reason: 'station-ambiguous', candidates: [STATION] },
    }))).toEqual({
      steps: [STEP],
      results: RESULTS,
      citations: [CITATION],
      truncated: false,
      needsClarification: { reason: 'station-ambiguous', candidates: [STATION] },
    })
  })

  it('accepts a clarification that offers no candidates', () => {
    expect(narrowConsultMeta(consult({
      needsClarification: { reason: 'station-not-found', candidates: [] },
    }))?.needsClarification).toEqual({ reason: 'station-not-found', candidates: [] })
  })

  it('accepts empty findings and an empty citation list', () => {
    const empty = narrowConsultMeta(consult({
      steps: [],
      results: {
        observation: [], forecast: [], suitability: [], hazard: { level: 'unknown', basis: [] },
      },
      citations: [],
    }))
    expect(empty?.results.observation).toEqual([])
    expect(empty?.results.suitability).toEqual([])
    expect(empty?.results.hazard).toEqual({ level: 'unknown', basis: [] })
    expect(empty?.citations).toEqual([])
  })
})
