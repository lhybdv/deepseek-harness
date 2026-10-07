/**
 * Tests for the two renderers that read opaque result metadata back — the one a
 * client rebuilds a consultation card from, and the one a station list renders
 * through — plus the slot echo that tells the model which question was consulted.
 */

import { describe, expect, it } from 'vitest'
import { consultViewFromResult, presentLookupResult } from '@deepseek-ai/dsh-tool-meteo'
import { mountTools, viewMeta } from './harness.ts'

const CITATION = {
  docId: 'guide-1',
  ordinal: 2,
  docTitle: '东北玉米初霜防御技术指南',
  headingPath: '玉米成熟收获期初霜防御',
  charStart: 480,
  charEnd: 640,
  snippet: '玉米成熟收获期初霜',
}

const STEP = { step: 'corpus', status: 'done', detail: '1 chunks for 1 terms (window 6)', count: 1 }

describe('consult view narrowing', () => {
  it.each([
    ['not an object at all', null],
    ['an array rather than a record', []],
    ['missing the window flag', { intent: 'disaster-risk' }],
    ['a trace that is not a list', { intent: 'disaster-risk', truncated: false, steps: {}, citations: [] }],
    ['a trace element missing a field', {
      intent: 'disaster-risk',
      truncated: false,
      steps: [{ step: 'slots', status: 'done' }],
      citations: [],
    }],
    ['a citation list that is not a list', {
      intent: 'disaster-risk',
      truncated: false,
      steps: [],
      citations: 'guide-1',
    }],
  ])('refuses metadata that is %s', (_label, meta) => {
    expect(consultViewFromResult(meta)).toBeUndefined()
  })

  it('reads back the trace and citations a well-formed result carries', () => {
    expect(consultViewFromResult({
      intent: 'activity-suitability',
      truncated: true,
      steps: [STEP],
      citations: [CITATION],
    })).toEqual({
      intent: 'activity-suitability',
      truncated: true,
      steps: [STEP],
      citations: [CITATION],
    })
  })
})

describe('station list view', () => {
  it('titles a lookup that matched nothing without a body to show', async () => {
    const { call } = await mountTools()
    const args = { text: '不存在的县' }
    expect(presentLookupResult(args, await call('meteo_station_lookup', args)))
      .toEqual({ card: 'generic', title: '0 published stations' })
  })

  it('shows nothing when a replayed result carries no station metadata', async () => {
    const { call } = await mountTools()
    const args = { text: '五常市' }
    const out = await call('meteo_station_lookup', args)
    expect(presentLookupResult(args, { ...out, meta: null })).toBeUndefined()
  })
})

describe('slot echo', () => {
  it('echoes the period and disaster the question named alongside crop and activity', async () => {
    const { call } = await mountTools()
    const meta = viewMeta(await call('meteo_consult', {
      question: '未来24小时初霜会影响玉米收获吗',
      station: 'hl-wc-01',
      crop: '玉米',
      activity: '成熟收获',
      period: '未来24小时',
      disaster: '初霜',
    }))
    expect(meta.slots.period).toBe('未来24小时')
    expect(meta.slots.disaster).toBe('初霜')
    expect(meta.steps[0]?.detail).toContain('period 未来24小时')
    expect(meta.steps[0]?.detail).toContain('disaster 初霜')
  })
})
