/**
 * The pure row-model derivation: lifecycle, the call head's arguments, the
 * flattened result text, and each tool's presentation metadata plus its
 * generic fallback.
 */
import { describe, expect, it } from 'vitest'
import {
  meteoCallArgs, meteoCallArgsFormatted, meteoCardState, meteoConsultModel, meteoFocusModel, meteoLookupModel,
  meteoResultText,
} from '../src/client/meteo-card-model.ts'
import { ARGS_RAW, running, settled } from './fixtures.client.ts'

const STEP = { step: 'slots', status: 'done', detail: '读到了槽位', count: 1 }
const CONSULT_META = {
  steps: [STEP],
  results: {
    observation: [], forecast: [], suitability: [],
    hazard: { level: 'unknown', basis: [] },
  },
  citations: [],
  truncated: false,
}

const LOOKUP_META = {
  stations: [{ id: 'st-1', name: '北京站', county: '海淀区', township: '西三旗', lon: 116.4, lat: 39.9, altitudeM: 44 }],
}

describe('meteoCardState', () => {
  it('is running while the call head has no settled result', () => {
    expect(meteoCardState(running(ARGS_RAW))).toBe('running')
  })

  it('is ok for a settled success, error for a failure, stopped for an interrupt', () => {
    expect(meteoCardState(settled())).toBe('ok')
    expect(meteoCardState(settled({ isError: true, content: [{ type: 'text', text: 'ENOENT' }] }))).toBe('error')
    expect(meteoCardState(settled({
      isError: true, error: { name: 'ToolError', code: 'interrupted' }, content: [],
    }))).toBe('stopped')
  })

  it('reads a settled success whose error carries another code as ok', () => {
    expect(meteoCardState(settled({ error: { name: 'ToolError', code: 'timeout' } }))).toBe('ok')
  })
})

describe('meteoCallArgs', () => {
  it('parses the running head and the settled head alike', () => {
    expect(meteoCallArgs(running('{"a":1}'))).toEqual({ a: 1 })
    expect(meteoCallArgs(settled({ call: { name: 'meteo_consult', argsRaw: '{"a":1}' } }))).toEqual({ a: 1 })
  })

  it('returns null when no call head is left in the window', () => {
    expect(meteoCallArgs(settled({ call: null }))).toBeNull()
  })

  it('returns null for a truncated JSON prefix', () => {
    expect(meteoCallArgs(running('{"question":"明天'))).toBeNull()
  })

  it('returns null for a non-object or array payload', () => {
    expect(meteoCallArgs(running('null'))).toBeNull()
    expect(meteoCallArgs(running('7'))).toBeNull()
    expect(meteoCallArgs(running('"text"'))).toBeNull()
    expect(meteoCallArgs(running('[1,2]'))).toBeNull()
  })
})

describe('meteoCallArgsFormatted', () => {
  it('pretty-prints object arguments', () => {
    expect(meteoCallArgsFormatted(running('{"a":1}'))).toBe('{\n  "a": 1\n}')
  })

  it('keeps an unparseable argument verbatim', () => {
    expect(meteoCallArgsFormatted(running('{"question":"明天'))).toBe('{"question":"明天')
    expect(meteoCallArgsFormatted(running('null'))).toBe('null')
  })

  it('returns null for absent or blank arguments', () => {
    expect(meteoCallArgsFormatted(settled({ call: null }))).toBeNull()
    expect(meteoCallArgsFormatted(running('   '))).toBeNull()
  })
})

describe('meteoResultText', () => {
  it('returns null while the call is running', () => {
    expect(meteoResultText(running(ARGS_RAW))).toBeNull()
  })

  it('joins text blocks verbatim and other blocks as their JSON', () => {
    expect(meteoResultText(settled({ content: [{ type: 'text', text: '第一行' }] }))).toBe('第一行')
    expect(meteoResultText(settled({
      content: [{ type: 'text', text: '第一行' }, { type: 'reasoning', text: '为什么' }],
    }))).toBe('第一行\n{\n  "type": "reasoning",\n  "text": "为什么"\n}')
  })

  it('falls back to the error name and code for an empty failure, and null for an empty success', () => {
    expect(meteoResultText(settled({ content: [] }))).toBeNull()
    expect(meteoResultText(settled({
      content: [], isError: true, error: { name: 'ToolError', code: 'interrupted' },
    }))).toBe('ToolError: interrupted')
  })
})

describe('meteoConsultModel', () => {
  it('reads the question from the call arguments', () => {
    expect(meteoConsultModel(running(ARGS_RAW)).question).toBe('明天能打药吗')
    expect(meteoConsultModel(running('{"question":"  "}')).question).toBe('  ')
  })

  it('reads no question from a blank, mistyped, or missing field', () => {
    expect(meteoConsultModel(running('{"question":""}')).question).toBeNull()
    expect(meteoConsultModel(running('{"question":7}')).question).toBeNull()
    expect(meteoConsultModel(running('{"other":1}')).question).toBeNull()
    expect(meteoConsultModel(running('not json')).question).toBeNull()
  })

  it('stays running, holding no output and no metadata', () => {
    const model = meteoConsultModel(running(ARGS_RAW))
    expect(model).toEqual({ state: 'running', question: '明天能打药吗', meta: null, output: null, errorSummary: null })
  })

  it('narrows the metadata of a settled success', () => {
    const model = meteoConsultModel(settled({ meta: CONSULT_META }))
    expect(model.state).toBe('ok')
    expect(model.meta?.steps).toEqual([STEP])
    expect(model.output).toBe('完成')
    expect(model.errorSummary).toBeNull()
  })

  it('falls back to no metadata when it is absent or foreign, and to none on a failure', () => {
    expect(meteoConsultModel(settled({ meta: undefined })).meta).toBeNull()
    expect(meteoConsultModel(settled({ meta: { steps: 'slots' } })).meta).toBeNull()
    expect(meteoConsultModel(settled({ meta: CONSULT_META, isError: true })).meta).toBeNull()
    expect(meteoConsultModel(settled({
      meta: CONSULT_META, isError: true, error: { name: 'ToolError', code: 'interrupted' },
    })).meta).toBeNull()
  })

  it('summarizes a failure by its first non-blank line', () => {
    const model = meteoConsultModel(settled({
      isError: true, content: [{ type: 'text', text: '\n  第一行\n第二行  ' }],
    }))
    expect(model.errorSummary).toBe('第一行')
  })

  it('holds no error summary for a blank failure or a failure with no text', () => {
    expect(meteoConsultModel(settled({
      isError: true, content: [{ type: 'text', text: '   ' }],
    })).errorSummary).toBeNull()
    expect(meteoConsultModel(settled({ isError: true, content: [] })).errorSummary).toBeNull()
  })
})

describe('meteoLookupModel', () => {
  it('reads the candidates of a settled success', () => {
    const model = meteoLookupModel(settled({ meta: LOOKUP_META }))
    expect(model.state).toBe('ok')
    expect(model.stations).toEqual(LOOKUP_META.stations)
    expect(model.output).toBe('完成')
  })

  it('keeps an empty candidate list distinct from the generic fallback', () => {
    expect(meteoLookupModel(settled({ meta: { stations: [] } })).stations).toEqual([])
    expect(meteoLookupModel(settled({ meta: {} })).stations).toBeNull()
    expect(meteoLookupModel(settled({ meta: undefined })).stations).toBeNull()
  })

  it('holds no candidates while running or after a failure', () => {
    expect(meteoLookupModel(running(ARGS_RAW)).stations).toBeNull()
    expect(meteoLookupModel(running(ARGS_RAW)).output).toBeNull()
    expect(meteoLookupModel(settled({ meta: LOOKUP_META, isError: true })).stations).toBeNull()
  })

  it('summarizes a failure by its first line', () => {
    expect(meteoLookupModel(settled({
      isError: true, content: [{ type: 'text', text: '查询失败' }],
    })).errorSummary).toBe('查询失败')
  })
})

describe('meteoFocusModel', () => {
  it('reads both named slots from the call arguments', () => {
    const model = meteoFocusModel(settled({ call: { name: 'meteo_set_focus', argsRaw: '{"stationId":"st-1","crop":"小麦"}' } }))
    expect(model).toEqual({
      state: 'ok', stationId: 'st-1', crop: '小麦', headReadable: true, output: '完成', errorSummary: null,
    })
  })

  it('reads a released focus as a readable head naming no slot', () => {
    const model = meteoFocusModel(settled({ call: { name: 'meteo_set_focus', argsRaw: '{}' } }))
    expect(model.stationId).toBeNull()
    expect(model.crop).toBeNull()
    expect(model.headReadable).toBe(true)
  })

  it('drops a blank or mistyped slot', () => {
    const model = meteoFocusModel(settled({
      call: { name: 'meteo_set_focus', argsRaw: '{"stationId":"","crop":5}' },
    }))
    expect(model.stationId).toBeNull()
    expect(model.crop).toBeNull()
    expect(model.headReadable).toBe(true)
  })

  it('reports an unreadable call head rather than an empty focus', () => {
    const model = meteoFocusModel(settled({ call: null, content: [] }))
    expect(model.headReadable).toBe(false)
    expect(model.stationId).toBeNull()
    expect(model.crop).toBeNull()
    expect(model.output).toBeNull()
  })

  it('stays running with no output until the call settles', () => {
    const model = meteoFocusModel(running('{"stationId":"st-1"}'))
    expect(model).toEqual({
      state: 'running', stationId: 'st-1', crop: null, headReadable: true, output: null, errorSummary: null,
    })
  })

  it('summarizes a failure by its first line', () => {
    expect(meteoFocusModel(settled({
      isError: true, content: [{ type: 'text', text: '写入失败' }],
    })).errorSummary).toBe('写入失败')
  })
})
