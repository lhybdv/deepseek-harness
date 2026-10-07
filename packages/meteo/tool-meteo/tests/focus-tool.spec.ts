/**
 * Behaviour tests for `meteo_set_focus`, the one write this package offers: how a
 * focus merges, what it refuses to record, and what releasing it costs a later
 * consultation.
 */

import { describe, expect, it } from 'vitest'
import { appendFocus, readFocus, type FocusSnapshot } from '@deepseek-ai/dsh-meteo-data'
import { formatFocusResult } from '@deepseek-ai/dsh-tool-meteo'
import { mountTools, modelText } from './harness.ts'

/**
 * Assert a recorded focus without pinning the write timestamp: the record must
 * hold exactly the expected slots, and `updatedAt` must be a real number.
 * @param focus - the focus read back from the session.
 * @param expected - the slots the test expects the focus to hold.
 */
function expectFocus(focus: FocusSnapshot | null, expected: { stationId?: string; crop?: string }): void {
  expect({ ...focus, updatedAt: 0 }).toEqual({ ...expected, updatedAt: 0 })
  expect(typeof focus?.updatedAt).toBe('number')
}

describe('meteo_set_focus', () => {
  it('records the station and crop it was given', async () => {
    const { agent, call } = await mountTools()
    const out = await call('meteo_set_focus', { stationId: 'hl-wc-02', crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'hl-wc-02', crop: '玉米' })
    expect(modelText(out)).toContain('Session focus now holds station 五常市拉林满族镇自动站 (hl-wc-02), 五常市 拉林满族镇 and crop 玉米.')
    expect(modelText(out)).toContain('unless it names otherwise')
  })

  it('keeps the crop the session already held when only the station is named', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { crop: '大豆', updatedAt: 1_759_000_000_000 })
    await call('meteo_set_focus', { stationId: 'jl-ys-03' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'jl-ys-03', crop: '大豆' })
  })

  it('keeps the station the session already held when only the crop is named', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    const out = await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'hl-wc-01', crop: '玉米' })
    expect(data.stationLookups).toEqual(['hl-wc-01'])
    expect(modelText(out)).toContain('station 五常市五常镇自动站 (hl-wc-01)')
    expect(modelText(out)).toContain('crop 玉米')
  })

  it('writes only the crop when the station the focus held has gone unpublished', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-09', crop: '大豆', updatedAt: 1_759_000_000_000 })
    await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { crop: '玉米' })
    expect(data.stationLookups).toEqual(['hl-wc-09'])
  })

  it('refuses a station this deployment does not publish', async () => {
    const { agent, call } = await mountTools()
    const out = await call('meteo_set_focus', { stationId: 'hl-wc-09' })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain('station hl-wc-09 is not a station this deployment publishes')
    expect(readFocus(agent.ctx, agent)).toBeNull()
  })

  it('releases the focus when it is given neither slot', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-01', crop: '玉米', updatedAt: 1_759_000_000_000 })
    const out = await call('meteo_set_focus', {})
    expect(readFocus(agent.ctx, agent)).toBeNull()
    expect(modelText(out)).toBe('Session focus released: a consultation in this session will ask which place the farmer means instead of assuming one.')
    expect(data.stationLookups).toEqual([])
    const consultation = await call('meteo_consult', { question: '现在能打药吗' })
    expect(modelText(consultation)).toContain('neither the question nor the session names a place')
  })

  it('refuses to record a focus for a call that carries no session', async () => {
    const { callWithoutAgent } = await mountTools()
    const out = await callWithoutAgent('meteo_set_focus', { crop: '玉米' })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain('meteo_set_focus needs an agent session to record the focus on')
  })

  it('treats blank slots as nothing named, and releases on them', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'hl-wc-01', crop: '玉米', updatedAt: 1_759_000_000_000 })
    await call('meteo_set_focus', { stationId: '  ', crop: '' })
    expect(readFocus(agent.ctx, agent)).toBeNull()
  })

  it('schedules the write alone because it appends to the session log', async () => {
    const { ctx } = await mountTools()
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: 'call-focus-mode' as never,
      name: 'meteo_set_focus',
      arguments: {},
    })).toEqual({ kind: 'exclusive' })
  })

  it('says what a focus holds without going through the tool runtime', () => {
    expect(formatFocusResult({})).toContain('Session focus released')
    expect(formatFocusResult({ crop: '玉米', updatedAt: 1 })).toBe(
      'Session focus now holds crop 玉米. A consultation in this session answers about these unless it names otherwise.')
    expect(formatFocusResult({
      station: { id: 'hl-wc-01', name: '五常市五常镇自动站', county: '五常市', township: '五常镇' },
      updatedAt: 1,
    })).toContain('station 五常市五常镇自动站 (hl-wc-01), 五常市 五常镇')
  })

  it('records a station alone when the session held no crop', async () => {
    const { agent, call } = await mountTools()
    const out = await call('meteo_set_focus', { stationId: 'hl-wc-02' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'hl-wc-02' })
    expect(modelText(out)).toContain('Session focus now holds station 五常市拉林满族镇自动站 (hl-wc-02), 五常市 拉林满族镇')
  })

  it('records a crop alone when the session held no station', async () => {
    const { agent, data, call } = await mountTools()
    const out = await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { crop: '玉米' })
    expect(data.stationLookups).toEqual([])
    expect(modelText(out)).toContain('crop 玉米')
  })
})
