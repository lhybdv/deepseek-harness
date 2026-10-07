/**
 * Behaviour tests for `meteo_consult`: what the model reads, what a client can
 * rebuild, which seam requests a call issues, and what the tool refuses to invent
 * when the published data has nothing to say.
 *
 * Fixtures are dated 2026-10-08/09, inside the 玉米 mature-harvest window (10-05..10-20).
 * Eight hourly observations carry wind at or above 13.9 m/s from 04:00Z to 10:00Z — a
 * 6 h hold that fires the 大风 criterion for that day — while forecast points hold it again
 * across the 24 h between them, which is the longer span the series-wide grade reports.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DocumentProduct, ResolvedHazard } from '@deepseek-ai/dsh-document-products'
import { appendFocus } from '@deepseek-ai/dsh-meteo-data'
import { presentConsultCall, presentConsultResult } from '@deepseek-ai/dsh-tool-meteo'
import { CHUNK, HIT, modelText, mountTools, resultFor, viewMeta } from './harness.ts'

const QUESTION = '这个风能播地吗'

describe('meteo_consult station slot', () => {
  it('exposes the sample-time window actually evaluated by the hazard grading', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', disaster: '大风' }))
    expect(meta.results.hazard?.evaluated).toEqual({
      from: '2026-10-08T04:00:00Z',
      to: '2026-10-09T18:00:00Z',
    })
  })

  it('leaves the evaluated window absent when the grading reads no samples', async () => {
    const { data, call } = await mountTools()
    data.observationRows = []
    data.forecastPoints = []
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', disaster: '大风' }))
    expect(meta.results.hazard).not.toHaveProperty('evaluated')
  })

  it('generates a warning from the supported grade and exact sample window', async () => {
    const { ctx, agent, call } = await mountTools()
    const hazardResolved = vi.fn(async (_session: unknown, _grading: ResolvedHazard) => ({} as DocumentProduct))
    ctx.provide('documentProducts', { hazardResolved } as never)
    const result = await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', disaster: '大风' })
    expect(hazardResolved).toHaveBeenCalledTimes(1)
    expect(hazardResolved).toHaveBeenCalledWith(agent.session, {
      stationId: 'hl-wc-01',
      from: '2026-10-08T04:00:00Z',
      to: '2026-10-09T18:00:00Z',
      hazard: '大风',
      grade: 'medium',
      forecastHours: 72,
    })
    expect(viewMeta(result).results.hazard?.evaluated).toEqual({
      from: '2026-10-08T04:00:00Z',
      to: '2026-10-09T18:00:00Z',
    })
  })

  it('does not generate a warning when the grade is unknown', async () => {
    const { ctx, data, call } = await mountTools()
    data.thresholdRows = []
    const hazardResolved = vi.fn(async (_session: unknown, _grading: ResolvedHazard) => ({} as DocumentProduct))
    ctx.provide('documentProducts', { hazardResolved } as never)
    await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' })
    expect(hazardResolved).not.toHaveBeenCalled()
  })

  it('does not generate a warning without usable sample times', async () => {
    const { ctx, data, call } = await mountTools()
    data.observationRows = []
    data.forecastPoints = []
    const hazardResolved = vi.fn(async (_session: unknown, _grading: ResolvedHazard) => ({} as DocumentProduct))
    ctx.provide('documentProducts', { hazardResolved } as never)
    await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' })
    expect(hazardResolved).not.toHaveBeenCalled()
  })

  it('logs generation failure while preserving the consultation finding', async () => {
    const { ctx, call } = await mountTools()
    const cause = new Error('generation rejected')
    const hazardResolved = vi.fn(async () => { throw cause })
    const warning = vi.spyOn(ctx.logger, 'warn')
    ctx.provide('documentProducts', { hazardResolved } as never)
    const result = await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' })
    expect(result.isError).toBe(false)
    expect(viewMeta(result).results.hazard?.level).toBe('medium')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('generation rejected'))
  })

  it('reads the station named by id without searching the network for it', async () => {
    const { data, call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(meta.resolvedStation).toEqual({
      id: 'hl-wc-01',
      name: '五常市五常镇自动站',
      county: '五常市',
      township: '五常镇',
    })
    expect(meta.needsClarification).toBeUndefined()
    expect(meta.slots).toEqual({ question: QUESTION, station: 'hl-wc-01' })
    expect(meta.steps[0]).toEqual({
      step: 'slots',
      status: 'done',
      detail: 'station 五常市五常镇自动站 (hl-wc-01) 五常市 五常镇, from the station argument',
      count: 1,
    })
    expect(data.stationLookups).toEqual(['hl-wc-01'])
    expect(data.stationQueries).toEqual([])
  })

  it('resolves a whole station name and a unique partial place name', async () => {
    const byName = await mountTools()
    expect(viewMeta(await byName.call('meteo_consult', {
      question: QUESTION,
      station: '榆树市弓棚镇自动站',
    })).resolvedStation?.id).toBe('jl-ys-03')
    expect(byName.data.calls.slice(0, 2)).toEqual(['station:榆树市弓棚镇自动站', 'stations::榆树市弓棚镇自动站'])
    const byPlace = await mountTools()
    expect(viewMeta(await byPlace.call('meteo_consult', {
      question: QUESTION,
      station: '拉林',
    })).resolvedStation?.id).toBe('hl-wc-02')
    expect(byPlace.data.stationQueries).toEqual([{ text: '拉林' }])
  })

  it('asks which station is meant rather than picking one of several', async () => {
    const { data, call } = await mountTools()
    const out = await call('meteo_consult', { question: QUESTION, station: '五常市' })
    const meta = viewMeta(out)
    expect(meta.needsClarification).toEqual({
      reason: 'station-ambiguous',
      candidates: [
        { id: 'hl-wc-01', name: '五常市五常镇自动站', county: '五常市', township: '五常镇' },
        { id: 'hl-wc-02', name: '五常市拉林满族镇自动站', county: '五常市', township: '拉林满族镇' },
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
      'corpus:done',
    ])
    expect(meta.steps[0]?.detail).toBe('no station consulted: the place that was named matches more than one station; 2 candidates offered')
    expect(meta.steps[1]?.detail).toBe('not run: the consultation is not anchored to a station')
    expect(modelText(out)).toContain('ask_user_question')
    expect(modelText(out)).toContain('- 五常市五常镇自动站 (hl-wc-01) — 五常市 五常镇')
    expect(data.calls).toEqual(['station:五常市', 'stations::五常市'])
  })

  it('never falls back to the focus when the named place does not exist', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: '拉萨' }))
    expect(meta.needsClarification).toEqual({ reason: 'station-not-found', candidates: [] })
    expect(meta.steps[0]?.detail).toBe('no station consulted: this deployment has no station matching the place that was named')
    expect(data.calls).toEqual(['station:拉萨', 'stations::拉萨'])
  })

  it('consults the station and crop the session focus holds when the question names neither', async () => {
    const { agent, corpus, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-02', crop: '玉米', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION }))
    expect(meta.intent).toBe('activity-suitability')
    expect(meta.slots).toEqual({ question: QUESTION, crop: '玉米' })
    expect(meta.resolvedStation?.id).toBe('hl-wc-02')
    expect(meta.steps[0]?.detail).toContain('from the session focus')
    expect(data.calendarQueries).toEqual([{ crop: '玉米' }])
    expect(data.thresholdQueries).toEqual([{ crop: '玉米' }, {}])
    expect(data.observationQueries).toEqual([{ stationId: 'hl-wc-02' }])
    expect(data.forecastQueries).toEqual([{ stationId: 'hl-wc-02', hours: 72 }])
    expect(corpus.searchRequests).toEqual([{ query: QUESTION, terms: ['玉米'], limit: 6 }])
  })

  it('takes the crop the focus holds, or the station it holds, on its own', async () => {
    const stationOnly = await mountTools()
    appendFocus(stationOnly.agent.session, { stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await stationOnly.call('meteo_consult', { question: QUESTION }))
    expect(meta.slots).toEqual({ question: QUESTION })
    expect(meta.intent).toBe('station-conditions')
    expect(meta.steps[0]?.detail).toBe('station 五常市五常镇自动站 (hl-wc-01) 五常市 五常镇, from the session focus')
    const cropOnly = await mountTools()
    appendFocus(cropOnly.agent.session, { crop: '玉米', updatedAt: 1_759_000_000_000 })
    const clarification = viewMeta(await cropOnly.call('meteo_consult', { question: QUESTION })).needsClarification
    expect(clarification?.reason).toBe('station-missing')
    expect(clarification?.candidates.length).toBeGreaterThan(0)
  })

  it('asks for a place while still retrieving professional corpus evidence', async () => {
    const { data, corpus, callWithoutAgent } = await mountTools()
    const result = await callWithoutAgent('meteo_consult', { question: QUESTION })
    const meta = viewMeta(result)
    expect(meta.needsClarification?.reason).toBe('station-missing')
    expect(meta.citations).toHaveLength(1)
    expect(meta.steps.find(step => step.step === 'corpus')).toMatchObject({ status: 'done', count: 1 })
    expect(corpus.searchRequests).toHaveLength(1)
    expect(data.calls).toEqual(['stations::'])
  })

  it('retrieves and labels corpus evidence while station clarification is pending', async () => {
    const { data, corpus, callWithoutAgent } = await mountTools()
    const result = await callWithoutAgent('meteo_consult', { question: QUESTION, disaster: '大风' })
    expect(viewMeta(result).needsClarification?.reason).toBe('station-missing')
    expect(data.expansions).toEqual(['大风'])
    expect(viewMeta(result).steps.find(step => step.step === 'corpus')).toMatchObject({
      status: 'done',
      detail: '1 chunks for 2 terms (window 6)',
    })
    expect(corpus.searchRequests[0]?.terms).toEqual(['大风', '狂风'])
  })

  it('reports an empty corpus result while station clarification is pending', async () => {
    const { corpus, callWithoutAgent } = await mountTools()
    corpus.searchHits = []
    const result = await callWithoutAgent('meteo_consult', { question: QUESTION, disaster: '大风' })
    expect(viewMeta(result).steps.find(step => step.step === 'corpus')).toMatchObject({
      status: 'unknown',
      detail: 'no indexed chunk matched (2 terms)',
    })
  })

  it('offers only the configured number of candidates when asking', async () => {
    const { callWithoutAgent } = await mountTools({ maxClarificationCandidates: 2 })
    expect(viewMeta(await callWithoutAgent('meteo_consult', { question: QUESTION }))
      .needsClarification?.candidates).toHaveLength(2)
  })

  it('asks again when the focus names a station this deployment no longer publishes', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-09', updatedAt: 1_759_000_000_000 })
    expect(viewMeta(await call('meteo_consult', { question: QUESTION })).needsClarification?.reason)
      .toBe('station-missing')
  })

  it('treats a blank station slot as a slot the model did not fill', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-02', updatedAt: 1_759_000_000_000 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: '   ' }))
    expect(meta.resolvedStation?.id).toBe('hl-wc-02')
    expect(meta.slots).toEqual({ question: QUESTION })
    expect(data.stationLookups).toEqual(['hl-wc-02'])
  })

  it('refuses a limit outside the window its config opened', async () => {
    const { data, call } = await mountTools()
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', limit: 0 })))
      .toContain('limit must be between 1 and 20')
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', limit: 21 })))
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
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(meta.steps).toHaveLength(6)
    expect(meta.steps[0]).toMatchObject({ step: 'slots', status: 'done', count: 1 })
    expect(meta.steps[1]).toMatchObject({ step: 'observation', status: 'done', count: 8 })
    expect(meta.steps[2]).toMatchObject({ step: 'forecast', status: 'done', count: 4 })
    expect(meta.steps[3]).toMatchObject({ step: 'suitability', status: 'done' })
    expect(meta.steps[4]).toMatchObject({ step: 'hazard', status: 'done', count: 1 })
    expect(meta.steps[5]).toMatchObject({ step: 'corpus', status: 'done', count: 1 })
    expect(meta.steps[0]?.detail).toBe('station 五常市五常镇自动站 (hl-wc-01) 五常市 五常镇, from the station argument')
    expect(meta.steps[1]?.detail).toBe('8 observations for station hl-wc-01: 2026-10-08T04:00:00Z to 2026-10-08T11:00:00Z')
    expect(meta.steps[2]?.detail).toBe('4 forecast points within 72 h for station hl-wc-01: 2026-10-08T12:00:00Z to 2026-10-09T18:00:00Z')
    expect(meta.steps[3]?.detail).toBe('4 day judgements: 3 suitable, 1 unsuitable, 0 unknown')
    expect(meta.steps[4]?.detail).toBe('medium: 大风 windSpeed>=13.9 held 24h from 2026-10-08T18:00:00Z')
    expect(meta.steps[5]?.detail).toBe('1 chunks for 0 terms (window 6)')
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
        { element: 'soilMoisture', value: 32.5 },
        { element: 'temperature', value: 2.4 },
        { element: 'windSpeed', value: 14.8 },
      ],
    })
  })

  it('judge each day the readings cover against the window that covers it', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '明天还能收获吗',
      station: 'hl-wc-01',
      crop: '玉米',
      activity: '成熟收获',
    }))
    expect(meta.intent).toBe('activity-suitability')
    expect(meta.slots).toEqual({ question: '明天还能收获吗', station: 'hl-wc-01', crop: '玉米', activity: '成熟收获' })
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
      question: '今天收获行吗',
      station: 'hl-wc-01',
      crop: '玉米',
      activity: '成熟收获',
    })).results.suitability ?? []
    expect(judgements.map(judgement => [judgement.day, judgement.verdict])).toEqual([
      ['2026-10-08', 'suitable'],
    ])
  })

  it('grades the disaster it was asked about and echoes the criteria revision', async () => {
    const { corpus, data, call } = await mountTools()
    data.thresholdRows = data.thresholdRows.filter(criterion => criterion.disaster === '春旱')
    const meta = viewMeta(await call('meteo_consult', {
      question: '春季墒情够播种吗',
      station: 'hl-wc-01',
      disaster: '春旱',
    }))
    expect(meta.intent).toBe('disaster-risk')
    expect(data.thresholdQueries).toEqual([{}, { disaster: '春旱' }])
    expect(corpus.searchRequests[0]?.terms).toEqual(['春旱', '墒情不足', '春季缺墒'])
    expect(data.expansions).toEqual(['春旱'])
    expect(meta.results.hazard).toEqual({
      level: 'unknown',
      basis: [],
      ruleVersion: 'th-7',
      evaluated: { from: '2026-10-08T04:00:00Z', to: '2026-10-09T18:00:00Z' },
    })
    expect(meta.steps[4]).toEqual({
      step: 'hazard',
      status: 'unknown',
      detail: 'no 春旱 criterion held across 12 readings',
      count: 0,
    })
  })

  it('names every criterion that held and grades by the strongest of them', async () => {
    const { data, call } = await mountTools()
    data.thresholdRows = [
      { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' },
      { disaster: '暴雨', element: 'precipitation', op: '>=', value: 20, durationH: 3, level: 'high' },
    ]
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
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
      question: '大风天玉米收获要紧吗',
      station: 'hl-wc-01',
      crop: '玉米',
      activity: '成熟收获',
      disaster: '大风',
    }))
    expect(data.expansions).toEqual(['大风', '玉米', '成熟收获'])
    expect(corpus.searchRequests).toEqual([{
      query: '大风天玉米收获要紧吗',
      terms: ['大风', '狂风', '玉米', '成熟收获'],
      limit: 6,
    }])
    expect(meta.steps[5]?.detail).toBe('1 chunks for 4 terms (window 6)')
  })

  it('says so when the corpus has nothing that matches the terms', async () => {
    const { corpus, call } = await mountTools()
    corpus.searchHits = []
    const out = await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', disaster: '大风' })
    const meta = viewMeta(out)
    expect(meta.steps[5]).toEqual({ step: 'corpus', status: 'unknown', detail: 'no indexed chunk matched (2 terms)', count: 0 })
    expect(meta.citations).toEqual([])
    expect(meta.truncated).toBe(false)
    expect(modelText(out)).toContain('Corpus: no indexed chunk matched this question.')
  })

  it('reports a window that filled so the model knows to narrow the question', async () => {
    const { call } = await mountTools({ defaultLimit: 1 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(meta.citations).toHaveLength(1)
    expect(meta.truncated).toBe(true)
    expect(modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' })))
      .toContain('The chunk window was filled')
  })

  it('says so when the station has neither readings nor a forecast', async () => {
    const { data, call } = await mountTools()
    data.observationRows = []
    data.forecastPoints = []
    const meta = viewMeta(await call('meteo_consult', {
      question: QUESTION,
      station: 'hl-wc-01',
      crop: '玉米',
    }))
    expect(meta.steps.slice(1).map(step => [step.step, step.status, step.detail])).toEqual([
      ['observation', 'unknown', 'no observations for station hl-wc-01'],
      ['forecast', 'unknown', 'no forecast points within 72 h for station hl-wc-01'],
      ['suitability', 'unknown', 'no published crop window covers a day the readings carry'],
      ['hazard', 'unknown', 'no published criterion held across 0 readings'],
      ['corpus', 'done', '1 chunks for 1 terms (window 6)'],
    ])
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(text).toContain('Observations: none published.')
    expect(text).toContain('Forecast: none published.')
  })

  it('narrows the calendar to a crop it was told about and says so when nothing is published', async () => {
    const { data, call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01', crop: '大豆' }))
    expect(data.calendarQueries).toEqual([{ crop: '大豆' }])
    expect(meta.steps[3]?.detail).toBe('no published crop window covers a day the readings carry')
  })

  it('narrow the calendar to the activity the question named', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '施肥时机',
      station: 'hl-wc-01',
      crop: '玉米',
      activity: '施肥',
    }))
    expect(meta.steps[3]?.detail).toBe('no published 施肥 activity window covers a day the readings carry')
    expect(meta.steps[3]?.status).toBe('unknown')
  })

  it('keeps every reading it consulted in the canonical result whatever the render lists', async () => {
    const { call } = await mountTools({ maxSeriesRows: 2 })
    const meta = viewMeta(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(meta.results.observation).toHaveLength(8)
    expect(meta.results.forecast).toHaveLength(4)
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(text).toContain('Observations (8 rows (listing the 2 most recent of 8)):')
    expect(text).toContain('2026-10-08T10:00:00Z')
    expect(text).not.toContain('2026-10-08T04:00:00Z soilMoisture=52.5')
    expect(text).toContain('Forecast (4 rows (listing the 2 earliest of 4)):')
    expect(text).toContain('2026-10-08T12:00:00Z')
    expect(text).not.toContain('2026-10-09T18:00:00Z precipitation')
  })

  it('quotes the matched chunk verbatim with everything a citation needs', async () => {
    const { call } = await mountTools()
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(text).toContain(`[1] ${HIT.docTitle} | docId ${CHUNK.docId} | chunk ${String(CHUNK.ordinal)} | chars ${String(CHUNK.charStart)}-${String(CHUNK.charEnd)} | heading ${CHUNK.headingPath}\n${CHUNK.text}`)
    expect(text).toContain('These are the findings, not an answer')
  })

  it('reports a headingless chunk without an empty heading field', async () => {
    const { corpus, call } = await mountTools()
    corpus.searchHits = [{ ...HIT, headingPath: '' }]
    const text = modelText(await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' }))
    expect(text).toContain(`chars ${String(CHUNK.charStart)}-${String(CHUNK.charEnd)}\n${CHUNK.text}`)
    expect(text).not.toContain('heading ')
  })

  it('cuts the citation excerpt it hands the client to the configured length', async () => {
    const { call } = await mountTools({ maxSnippetChars: 4 })
    expect(viewMeta(await call('meteo_consult', {
      question: QUESTION,
      station: 'hl-wc-01',
    })).citations?.[0]?.snippet).toBe('玉米成…')
  })

  it('answers two consultations independently when they run together', async () => {
    const { call } = await mountTools()
    const [left, right] = await Promise.all([
      call('meteo_consult', { question: '一号地初霜吗', station: 'hl-wc-01' }),
      call('meteo_consult', { question: '二号地初霜吗', station: 'hl-wc-02' }),
    ])
    expect([
      viewMeta(left).resolvedStation?.id,
      viewMeta(right).resolvedStation?.id,
    ]).toEqual(['hl-wc-01', 'hl-wc-02'])
    expect(viewMeta(left).slots).toEqual({ question: '一号地初霜吗', station: 'hl-wc-01' })
  })
})

describe('meteo_consult cards', () => {
  it('titles the pending call by the question it was asked', async () => {
    expect(presentConsultCall({ question: '这个初霜会影响玉米收获吗', crop: '玉米' })).toEqual({
      card: 'generic',
      title: '这个初霜会影响玉米收获吗',
      kind: 'other',
      rawInput: '这个初霜会影响玉米收获吗',
    })
  })

  it('rebuilds the result card from the trace and citations without the chunk texts', async () => {
    const { call } = await mountTools()
    const out = await call('meteo_consult', { question: QUESTION, station: 'hl-wc-01' })
    expect(presentConsultResult({ question: QUESTION }, resultFor(out))).toEqual({
      card: 'generic',
      title: QUESTION,
      content: [{
        type: 'text',
        text: [
          'slots [done] station 五常市五常镇自动站 (hl-wc-01) 五常市 五常镇, from the station argument (1)',
          'observation [done] 8 observations for station hl-wc-01: 2026-10-08T04:00:00Z to 2026-10-08T11:00:00Z (8)',
          'forecast [done] 4 forecast points within 72 h for station hl-wc-01: 2026-10-08T12:00:00Z to 2026-10-09T18:00:00Z (4)',
          'suitability [done] 4 day judgements: 3 suitable, 1 unsuitable, 0 unknown (4)',
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
