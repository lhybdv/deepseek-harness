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
    const out = await call('meteo_set_focus', { stationId: 'ha-xx-02', crop: '冬小麦' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'ha-xx-02', crop: '冬小麦' })
    expect(modelText(out)).toContain('Session focus now holds station 新乡县翟坡自动站 (ha-xx-02), 新乡县 翟坡镇 and crop 冬小麦.')
    expect(modelText(out)).toContain('unless it names otherwise')
  })

  it('keeps the crop the session already held when only the station is named', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { crop: '冬小麦', updatedAt: 1_759_000_000_000 })
    await call('meteo_set_focus', { stationId: 'ha-yc-03' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'ha-yc-03', crop: '冬小麦' })
  })

  it('keeps the station the session already held when only the crop is named', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-01', updatedAt: 1_759_000_000_000 })
    const out = await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'ha-xx-01', crop: '玉米' })
    expect(data.stationLookups).toEqual(['ha-xx-01'])
    expect(modelText(out)).toContain('station 新乡县城关自动站 (ha-xx-01)')
    expect(modelText(out)).toContain('crop 玉米')
  })

  it('writes only the crop when the station the focus held has gone unpublished', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-09', crop: '冬小麦', updatedAt: 1_759_000_000_000 })
    await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { crop: '玉米' })
    expect(data.stationLookups).toEqual(['ha-xx-09'])
  })

  it('refuses a station this deployment does not publish', async () => {
    const { agent, call } = await mountTools()
    const out = await call('meteo_set_focus', { stationId: 'ha-xx-09' })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain('station ha-xx-09 is not a station this deployment publishes')
    expect(readFocus(agent.ctx, agent)).toBeNull()
  })

  it('releases the focus when it is given neither slot', async () => {
    const { agent, data, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-01', crop: '冬小麦', updatedAt: 1_759_000_000_000 })
    const out = await call('meteo_set_focus', {})
    expect(readFocus(agent.ctx, agent)).toBeNull()
    expect(modelText(out)).toBe('Session focus released: a consultation in this session will ask which place the farmer means instead of assuming one.')
    expect(data.stationLookups).toEqual([])
    const consultation = await call('meteo_consult', { question: '现在能打药吗' })
    expect(modelText(consultation)).toContain('neither the question nor the session names a place')
  })

  it('refuses to record a focus for a call that carries no session', async () => {
    const { callWithoutAgent } = await mountTools()
    const out = await callWithoutAgent('meteo_set_focus', { crop: '冬小麦' })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain('meteo_set_focus needs an agent session to record the focus on')
  })

  it('treats blank slots as nothing named, and releases on them', async () => {
    const { agent, call } = await mountTools()
    appendFocus(agent.session, { stationId: 'ha-xx-01', crop: '冬小麦', updatedAt: 1_759_000_000_000 })
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
    expect(formatFocusResult({ crop: '冬小麦', updatedAt: 1 })).toBe(
      'Session focus now holds crop 冬小麦. A consultation in this session answers about these unless it names otherwise.')
    expect(formatFocusResult({
      station: { id: 'ha-xx-01', name: '新乡县城关自动站', county: '新乡县', township: '城关镇' },
      updatedAt: 1,
    })).toContain('station 新乡县城关自动站 (ha-xx-01), 新乡县 城关镇')
  })

  it('records a station alone when the session held no crop', async () => {
    const { agent, call } = await mountTools()
    const out = await call('meteo_set_focus', { stationId: 'ha-xx-02' })
    expectFocus(readFocus(agent.ctx, agent), { stationId: 'ha-xx-02' })
    expect(modelText(out)).toContain('Session focus now holds station 新乡县翟坡自动站 (ha-xx-02), 新乡县 翟坡镇')
  })

  it('records a crop alone when the session held no station', async () => {
    const { agent, data, call } = await mountTools()
    const out = await call('meteo_set_focus', { crop: '玉米' })
    expectFocus(readFocus(agent.ctx, agent), { crop: '玉米' })
    expect(data.stationLookups).toEqual([])
    expect(modelText(out)).toContain('crop 玉米')
  })
})
