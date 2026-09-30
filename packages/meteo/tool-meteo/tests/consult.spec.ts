/**
 * Behaviour tests for `meteo_consult`: what the model reads, what a client can
 * rebuild, which seam requests a call issues, and what the tool refuses to invent
 * when the published data has nothing to say.
 *
 * Fixtures are dated 2026-10-08/09, inside the 冬小麦 sowing window (10-05..10-20)
 * and outside the fertilising window (10-25..11-10). Eight hourly observations
 * carry wind at or above 13.9 m/s from 04:00Z to 10:00Z — a 6 h hold that fires the
 * 大风 criterion for that day — while the two 18:00Z forecast points hold it again
 * across the 24 h between them, which is the longer span the series-wide grade reports.
 */

import { describe, expect, it } from 'vitest'
import { appendFocus } from '@deepseek-ai/dsh-meteo-data'
import { presentConsultCall, presentConsultResult } from '@deepseek-ai/dsh-tool-meteo'
import { CHUNK, HIT, modelText, mountTools, resultFor, viewMeta } from './harness.ts'

const QUESTION = '这个风能播地吗'

describe('meteo_consult station slot', () => {
  it('reads the station named by id without searching the network for it', async () => {
    const { data, call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(meta.resolvedStation).toEqual({
      id: 'ha-xx-01',
      name: '新乡县城关自动站',
      county: '新乡县',
      township: '城关镇',
    })
    expect(meta.needsClarification).toBeUndefined()
    expect(meta.slots).toEqual({ question: QUESTION, station: 'ha-xx-01' })
    expect(meta.steps[0]).toEqual({
      step: 'slots',
      status: 'done',
      detail: 'station 新乡县城关自动站 (ha-xx-01) 新乡县 城关镇, from the station argument',
      count: 1,
    })
    expect(data.stationLookups).toEqual(['ha-xx-01'])
    expect(data.stationQueries).toEqual([])
  })

  it('resolves a whole station name and a unique partial place name', async () => {
    const byName = await mountTools()
    expect(viewMeta(await byName.call('meteo_consult', {
      question: QUESTION,
      station: '原阳县齐街自动站',
    })).resolvedStation?.id).toBe('ha-yc-03')
    expect(byName.data.calls.slice(0, 2)).toEqual(['station:原阳县齐街自动站', 'stations::原阳县齐街自动站'])
    const byPlace = await mountTools()
    expect(viewMeta(await byPlace.call('meteo_consult', {
      question: QUESTION,
      station: '翟坡',
    })).resolvedStation?.id).toBe('ha-xx-02')
    expect(byPlace.data.stationQueries).toEqual([{ text: '翟坡' }])
  })

  it('asks which station is meant rather than picking one of several', async () => {
    const { data, call } = await mountTools()
    const out = await call('meteo_consult', { question: QUESTION, station: '新乡县' })
    const meta = viewMeta(out)
    expect(meta.needsClarification).toEqual({
      reason: 'station-ambiguous',
      candidates: [
        { id: 'ha-xx-01', name: '新乡县城关自动站', county: '新乡县', township: '城关镇' },
        { id: 'ha-xx-02', name: '新乡县翟坡自动站', county: '新乡县', township: '翟坡镇' },
      ],
    })
    expect(meta.resolvedStation).toBeUndefined()
    expect(meta.ruleVersion).toBeUndefined()
    expect(meta.results).toEqual({ observation: [], forecast: [], suitability: [], hazard: { level: 'unknown', basis: [] } })
    expect(meta.steps.map(step => `${step.step}:${step.status}`)).toEqual([
      'slots:unknown',
      'observation:skipped',
      'forecast:skipped',
      'suitability:skipped',
      'hazard:skipped',
      'corpus:skipped',
    ])
    expect(meta.steps[0]?.detail).toBe('no station consulted: the place that was named matches more than one station; 2 candidates offered')
    expect(meta.steps[1]?.detail).toBe('not run: the consultation is not anchored to a station')
    expect(modelText(out)).toContain('ask_user_question')
    expect(modelText(out)).toContain('- 新乡县城关自动站 (ha-xx-01) — 新乡县 城关镇')
    expect(data.calls).toEqual(['station:新乡县', 'stations::新乡县'])
  })

  it('never falls back to the focus when the named place does not exist', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-01', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: '拉萨' }))
    expect(meta.needsClarification).toEqual({ reason: 'station-not-found', candidates: [] })
    expect(meta.steps[0]?.detail).toBe('no station consulted: this deployment has no station matching the place that was named')
    expect(data.calls).toEqual(['station:拉萨', 'stations::拉萨'])
  })

  it('consults the station and crop the session focus holds when the question names neither', async () => {
    const { agent, corpus, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-02', crop: '冬小麦', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION }))
    expect(meta.intent).toBe('activity-suitability')
    expect(meta.slots).toEqual({ question: QUESTION, crop: '冬小麦' })
    expect(meta.resolvedStation?.id).toBe('ha-xx-02')
    expect(meta.steps[0]?.detail).toContain('from the session focus')
    expect(data.calendarQueries).toEqual([{ crop: '冬小麦' }])
    expect(data.thresholdQueries).toEqual([{ crop: '冬小麦' }, {}])
    expect(data.observationQueries).toEqual([{ stationId: 'ha-xx-02' }])
    expect(data.forecastQueries).toEqual([{ stationId: 'ha-xx-02', hours: 72 }])
    expect(corpus.searchRequests).toEqual([{ query: QUESTION, terms: ['冬小麦'], limit: 6 }])
  })

  it('takes the crop the focus holds, or the station it holds, on its own', async () => {
    const stationOnly = await mountTools()
    appendFocus(stationOnly.agent.session, { stationId: 'ha-xx-01', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await stationOnly.call('meteo_consult', { question: QUESTION }))
    expect(meta.slots).toEqual({ question: QUESTION })
    expect(meta.intent).toBe('station-conditions')
    expect(meta.steps[0]?.detail).toBe('station 新乡县城关自动站 (ha-xx-01) 新乡县 城关镇, from the session focus')
    const cropOnly = await mountTools()
    appendFocus(cropOnly.agent.session, { crop: '冬小麦', updatedAt: 1_759_000_000_000 })
    const clarification = viewMeta(await cropOnly.call('meteo_consult', { question: QUESTION })).needsClarification
    expect(clarification?.reason).toBe('station-missing')
    expect(clarification?.candidates.length).toBeGreaterThan(0)
  })

  it('asks for a place when neither the question nor the session names one', async () => {
    const { data, callWithoutAgent } = await mountTools()
    const meta = viewMeta(await callWithoutAgent('meteo_consult', { question: QUESTION }))
    expect(meta.needsClarification?.reason).toBe('station-missing')
    expect(meta.needsClarification?.candidates).toHaveLength(3)
    expect(modelText(await callWithoutAgent('meteo_consult', { question: QUESTION })))
      .toContain('neither the question nor the session names a place')
    expect(data.calls).toEqual(['stations::', 'stations::'])
  })

  it('offers only the configured number of candidates when asking', async () => {
    const { callWithoutAgent } = await mountTools({ maxClarificationCandidates: 2 })
    expect(viewMeta(await callWithoutAgent('meteo_consult', { question: QUESTION }))
      .needsClarification?.candidates).toHaveLength(2)
  })

  it('asks again when the focus names a station this deployment no longer publishes', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-09', updatedAt: 1_759_000_000_000 })
    expect(viewMeta(await call('meteo_consult', { question: QUESTION })).needsClarification?.reason)
      .toBe('station-missing')
  })

  it('treats a blank station slot as a slot the model did not fill', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-02', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: '   ' }))
    expect(meta.resolvedStation?.id).toBe('ha-xx-02')
    expect(meta.slots).toEqual({ question: QUESTION })
    expect(data.stationLookups).toEqual(['ha-xx-02'])
  })

  it('refuses a limit outside the window its config opened', async () => {
    const { data, call } = await mountTools()
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01', limit: 0 })))
      .toContain('limit must be between 1 and 20')
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01', limit: 21 })))
      .toContain('limit must be between 1 and 20')
    expect(data.calls).toEqual([])
  })

  it('refuses a question that is only whitespace', async () => {
    const { data, call } = await mountTools()
    expect(modelText(await call('meteo_consult', { question: '   ' }))).toContain('question must be a non-empty string')
    expect(data.calls).toEqual([])
  })
})

describe('meteo_consult findings', () => {
  it('runs all six steps and reports the readings, verdicts, grade, and chunks it read', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(meta.steps.map(step => [step.step, step.status, step.detail, step.count])).toEqual([
      ['slots', 'done', 'station 新乡县城关自动站 (ha-xx-01) 新乡县 城关镇, from the station argument', 1],
      ['observation', 'done', '8 observations for station ha-xx-01: 2026-10-08T04:00:00Z to 2026-10-08T11:00:00Z', 8],
      ['forecast', 'done', '4 forecast points within 72 h for station ha-xx-01: 2026-10-08T12:00:00Z to 2026-10-09T18:00:00Z', 4],
      ['suitability', 'done', '2 day judgements: 1 suitable, 1 unsuitable, 0 unknown', 2],
      ['hazard', 'done', 'medium: 大风 windSpeed>=13.9 held 24h from 2026-10-08T18:00:00Z', 1],
      ['corpus', 'done', '1 chunks for 0 terms (window 6)', 1],
    ])
    expect(meta.ruleVersion).toBe('th-7')
    expect(meta.truncated).toBe(false)
    expect(meta.citations[0]).toEqual({
      docId: CHUNK.docId,
      ordinal: CHUNK.ordinal,
      docTitle: HIT.docTitle,
      headingPath: CHUNK.headingPath,
      charStart: CHUNK.charStart,
      charEnd: CHUNK.charEnd,
      snippet: CHUNK.text,
    })
    expect(meta.results.observation).toHaveLength(8)
    expect(meta.results.observation?.[0]).toEqual({
      time: '2026-10-08T04:00:00Z',
      entries: [
        { element: 'soilMoisture', value: 52.5 },
        { element: 'temperature', value: 21.4 },
        { element: 'windSpeed', value: 14.8 },
      ],
    })
  })

  it('judge each day the readings cover against the window that covers it', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '明天还能播种吗',
      station: 'ha-xx-01',
      crop: '冬小麦',
      activity: '播种',
    }))
    expect(meta.intent).toBe('activity-suitability')
    expect(meta.slots).toEqual({ question: '明天还能播种吗', station: 'ha-xx-01', crop: '冬小麦', activity: '播种' })
    const judgements = meta.results.suitability ?? []
    expect(judgements.map(judgement => [judgement.day, judgement.verdict])).toEqual([
      ['2026-10-08', 'unsuitable'],
      ['2026-10-09', 'suitable'],
    ])
    expect(judgements[0]?.criteria).toEqual([{
      disaster: '大风',
      element: 'windSpeed',
      op: '>=',
      value: 13.9,
      durationH: 6,
      level: 'medium',
      hoursHeld: 6,
      firstTime: '2026-10-08T04:00:00Z',
    }])
    expect(judgements[1]?.criteria).toEqual([])
  })

  it('says a day is fit for the activity when nothing held in a window that covers it', async () => {
    const { data, call } = await mountTools()
    data.forecastPoints = []
    data.observationRows = data.observationRows.map(observation => ({
      ...observation,
      elements: { ...observation.elements, soilMoisture: 90, windSpeed: 8.4 },
    }))
    const judgements = viewMeta(await call('meteo_consult', {
      question: '今天播种行吗',
      station: 'ha-xx-01',
      crop: '冬小麦',
      activity: '播种',
    })).results.suitability ?? []
    expect(judgements.map(judgement => [judgement.day, judgement.verdict])).toEqual([
      ['2026-10-08', 'suitable'],
    ])
  })

  it('grades the disaster it was asked about and echoes the criteria revision', async () => {
    const { corpus, data, call } = await mountTools()
    data.thresholdRows = data.thresholdRows.filter(criterion => criterion.disaster === '干旱')
    const meta = viewMeta(await call('meteo_consult', {
      question: '墒情够播种吗',
      station: 'ha-xx-01',
      disaster: '干旱',
    }))
    expect(meta.intent).toBe('disaster-risk')
    expect(data.thresholdQueries).toEqual([{}, { disaster: '干旱' }])
    expect(corpus.searchRequests[0]?.terms).toEqual(['干旱', '旱灾'])
    expect(data.expansions).toEqual(['干旱'])
    expect(meta.results.hazard).toEqual({ level: 'unknown', basis: [], ruleVersion: 'th-7' })
    expect(meta.steps[4]).toEqual({
      step: 'hazard',
      status: 'unknown',
      detail: 'no 干旱 criterion held across 12 readings',
      count: 0,
    })
  })

  it('names every criterion that held and grades by the strongest of them', async () => {
    const { data, call } = await mountTools()
    data.thresholdRows = [
      { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
      { disaster: '暴雨', element: 'precipitation', op: '>=', value: 20, durationH: 3, level: 'high' },
    ]
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(meta.results.hazard?.level).toBe('high')
    expect(meta.results.hazard?.basis?.map(criterion => [criterion.disaster, criterion.hoursHeld, criterion.firstTime])).toEqual([
      ['大风', 24, '2026-10-08T18:00:00Z'],
      ['暴雨', 24, '2026-10-08T18:00:00Z'],
    ])
    expect(meta.steps[4]?.detail).toBe(
      'high: 大风 windSpeed>=13.9 held 24h from 2026-10-08T18:00:00Z; 暴雨 precipitation>=20 held 24h from 2026-10-08T18:00:00Z')
  })

  it('sends the disaster, crop, and activity terms to the corpus and unions what they expand to', async () => {
    const { corpus, data, call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '大风天播种要紧吗',
      station: 'ha-xx-01',
      crop: '冬小麦',
      activity: '播种',
      disaster: '大风',
    }))
    expect(data.expansions).toEqual(['大风', '冬小麦', '播种'])
    expect(corpus.searchRequests).toEqual([{
      query: '大风天播种要紧吗',
      terms: ['大风', '狂风', '冬小麦', '播种'],
      limit: 6,
    }])
    expect(meta.steps[5]?.detail).toBe('1 chunks for 4 terms (window 6)')
  })

  it('says so when the corpus has nothing that matches the terms', async () => {
    const { corpus, call } = await mountTools()
    corpus.searchHits = []
    const out = await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01', disaster: '大风' })
    const meta = viewMeta(out)
    expect(meta.steps[5]).toEqual({ step: 'corpus', status: 'unknown', detail: 'no indexed chunk matched (2 terms)', count: 0 })
    expect(meta.citations).toEqual([])
    expect(meta.truncated).toBe(false)
    expect(modelText(out)).toContain('Corpus: no indexed chunk matched this question.')
  })

  it('reports a window that filled so the model knows to narrow the question', async () => {
    const { call } = await mountTools({ defaultLimit: 1 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(meta.citations).toHaveLength(1)
    expect(meta.truncated).toBe(true)
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' })))
      .toContain('The chunk window was filled')
  })

  it('says so when the station has neither readings nor a forecast', async () => {
    const { data, call } = await mountTools()
    data.observationRows = []
    data.forecastPoints = []
    const meta = viewMeta(await call('meteo_consult', {
      question: QUESTION,
      station: 'ha-xx-01',
      crop: '冬小麦',
    }))
    expect(meta.steps.slice(1).map(step => [step.step, step.status, step.detail])).toEqual([
      ['observation', 'unknown', 'no observations for station ha-xx-01'],
      ['forecast', 'unknown', 'no forecast points within 72 h for station ha-xx-01'],
      ['suitability', 'unknown', 'no published crop window covers a day the readings carry'],
      ['hazard', 'unknown', 'no published criterion held across 0 readings'],
      ['corpus', 'done', '1 chunks for 1 terms (window 6)'],
    ])
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(text).toContain('Observations: none published.')
    expect(text).toContain('Forecast: none published.')
  })

  it('narrows the calendar to a crop it was told about and says so when nothing is published', async () => {
    const { data, call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01', crop: '夏玉米' }))
    expect(data.calendarQueries).toEqual([{ crop: '夏玉米' }])
    expect(meta.steps[3]?.detail).toBe('no published crop window covers a day the readings carry')
  })

  it('narrow the calendar to the activity the question named', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '施肥时机',
      station: 'ha-xx-01',
      crop: '冬小麦',
      activity: '施肥',
    }))
    expect(meta.steps[3]?.detail).toBe('no published 施肥 activity window covers a day the readings carry')
    expect(meta.steps[3]?.status).toBe('unknown')
  })

  it('keeps every reading it consulted in the canonical result whatever the render lists', async () => {
    const { call } = await mountTools({ maxSeriesRows: 2 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(meta.results.observation).toHaveLength(8)
    expect(meta.results.forecast).toHaveLength(4)
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(text).toContain('Observations (8 rows (listing the 2 most recent of 8)):')
    expect(text).toContain('2026-10-08T10:00:00Z')
    expect(text).not.toContain('2026-10-08T04:00:00Z soilMoisture=52.5')
    expect(text).toContain('Forecast (4 rows (listing the 2 earliest of 4)):')
    expect(text).toContain('2026-10-08T12:00:00Z')
    expect(text).not.toContain('2026-10-09T18:00:00Z precipitation')
  })

  it('quotes the matched chunk verbatim with everything a citation needs', async () => {
    const { call } = await mountTools()
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(text).toContain(`[1] ${HIT.docTitle} | docId ${CHUNK.docId} | chunk ${String(CHUNK.ordinal)} | chars ${String(CHUNK.charStart)}-${String(CHUNK.charEnd)} | heading ${CHUNK.headingPath}\n${CHUNK.text}`)
    expect(text).toContain('These are the findings, not an answer')
  })

  it('reports a headingless chunk without an empty heading field', async () => {
    const { corpus, call } = await mountTools()
    corpus.searchHits = [{ ...HIT, headingPath: '' }]
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' }))
    expect(text).toContain(`chars ${String(CHUNK.charStart)}-${String(CHUNK.charEnd)}\n${CHUNK.text}`)
    expect(text).not.toContain('heading ')
  })

  it('cuts the citation excerpt it hands the client to the configured length', async () => {
    const { call } = await mountTools({ maxSnippetChars: 4 })
    expect(viewMeta(await call('meteo_consult', {
      question: QUESTION,
      station: 'ha-xx-01',
    })).citations?.[0]?.snippet).toBe('播种期…')
  })

  it('answers two consultations independently when they run together', async () => {
    const { call } = await mountTools()
    const [left, right] = await Promise.all([
      call('meteo_consult', { question: '一号地风大吗', station: 'ha-xx-01' }),
      call('meteo_consult', { question: '二号地风大吗', station: 'ha-xx-02' }),
    ])
    expect([
      viewMeta(left).resolvedStation?.id,
      viewMeta(right).resolvedStation?.id,
    ]).toEqual(['ha-xx-01', 'ha-xx-02'])
    expect(viewMeta(left).slots).toEqual({ question: '一号地风大吗', station: 'ha-xx-01' })
  })
})

describe('meteo_consult cards', () => {
  it('titles the pending call by the question it was asked', async () => {
    expect(presentConsultCall({ question: '这个风能播地吗', crop: '冬小麦' })).toEqual({
      card: 'generic',
      title: '这个风能播地吗',
      kind: 'other',
      rawInput: '这个风能播地吗',
    })
  })

  it('rebuilds the result card from the trace and citations without the chunk texts', async () => {
    const { call } = await mountTools()
    const out = await call('meteo_consult', { question: QUESTION, station: 'ha-xx-01' })
    expect(presentConsultResult({ question: QUESTION }, resultFor(out))).toEqual({
      card: 'generic',
      title: QUESTION,
      content: [{
        type: 'text',
        text: [
          'slots [done] station 新乡县城关自动站 (ha-xx-01) 新乡县 城关镇, from the station argument (1)',
          'observation [done] 8 observations for station ha-xx-01: 2026-10-08T04:00:00Z to 2026-10-08T11:00:00Z (8)',
          'forecast [done] 4 forecast points within 72 h for station ha-xx-01: 2026-10-08T12:00:00Z to 2026-10-09T18:00:00Z (4)',
          'suitability [done] 2 day judgements: 1 suitable, 1 unsuitable, 0 unknown (2)',
          'hazard [done] medium: 大风 windSpeed>=13.9 held 24h from 2026-10-08T18:00:00Z (1)',
          'corpus [done] 1 chunks for 0 terms (window 6) (1)',
          `- ${HIT.docTitle} | chunk ${String(CHUNK.ordinal)} | chars ${String(CHUNK.charStart)}-${String(CHUNK.charEnd)}`,
        ].join('\n'),
      }],
    })
  })

  it('titles a consultation that ended in a question by what the caller asked', async () => {
    const { call } = await mountTools()
    const card = presentConsultResult({ question: '这地能播吗' },
      resultFor(await call('meteo_consult', { question: '这地能播吗', station: '拉萨' })))
    expect(card?.title).toBe('这地能播吗')
    expect(card?.content?.map(block => block.type)).toEqual(['text'])
  })

  it('leaves the card plain when the result failed or its metadata is not a consultation', async () => {
    const { call } = await mountTools()
    expect(presentConsultResult({ question: QUESTION }, { content: [], isError: true })).toBeUndefined()
    expect(presentConsultResult({ question: QUESTION }, { content: [], isError: false, meta: { steps: 'not a list' } })).toBeUndefined()
    expect(presentConsultResult({ question: QUESTION }, resultFor(await call('meteo_consult', { question: '   ' })))).toBeUndefined()
    expect(presentConsultResult({ question: QUESTION }, {
      content: [],
      isError: false,
      meta: { intent: 'station-conditions', slots: {}, hazard: { level: 'unknown', basis: [] }, steps: [], results: {}, citations: [], truncated: false },
    })).toEqual({ card: 'generic', title: QUESTION })
  })
})
