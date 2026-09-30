/**
 * how it was narrowed, and what a client can rebuild from its metadata.
 */

import { describe, expect, it } from 'vitest'
import { formatStationLookup, lookupScope, presentLookupCall, presentLookupResult } from '@deepseek-ai/dsh-tool-meteo'
import { mountTools, modelText, resultFor, viewMeta } from './harness.ts'

const STATION = {
  id: 'ha-xx-01',
  name: '新乡县城关自动站',
  county: '新乡县',
  township: '城关镇',
  lon: 113.82,
  lat: 35.18,
  altitudeM: 73.4,
}

describe('meteo_station_lookup', () => {
  it('lists the whole network when the lookup named no filter', async () => {
    const { data, call } = await mountTools()
    const out = await call('meteo_station_lookup', {})
    expect(data.stationQueries).toEqual([{}])
    expect(viewMeta(out).citations).toBeUndefined()
    expect(modelText(out)).toContain('3 stations (whole network):')
    expect(modelText(out)).toContain('- ha-xx-01 新乡县城关自动站 — 新乡县 城关镇, lon 113.82 lat 35.18 alt 73.4 m')
  })

  it('narrows to a county, then to a place word, and says which it used', async () => {
    const county = await mountTools()
    expect(modelText(await county.call('meteo_station_lookup', { county: '原阳县' }))).toContain('1 stations (county 原阳县):')
    expect(county.data.stationQueries).toEqual([{ county: '原阳县' }])
    const place = await mountTools()
    expect(modelText(await place.call('meteo_station_lookup', { county: '新乡县', text: '翟坡' })))
      .toContain('1 stations (place 翟坡):')
    expect(place.data.stationQueries).toEqual([{ county: '新乡县', text: '翟坡' }])
  })

  it('echoes the filter it searched when the network has nothing to offer', async () => {
    const { data, call } = await mountTools()
    data.stationRows = []
    expect(modelText(await call('meteo_station_lookup', { text: '拉萨' }))).toBe('No published station matches place 拉萨.')
  })

  it('hands a client the identity of each station without the siting numbers', async () => {
    const { ctx, call } = await mountTools()
    const out = await call('meteo_station_lookup', { county: '新乡县' })
    expect(presentLookupResult({}, resultFor(out))).toEqual({
      card: 'generic',
      title: '2 published stations',
      content: [{
        type: 'text',
        text: '- ha-xx-01 新乡县城关自动站 — 新乡县 城关镇\n- ha-xx-02 新乡县翟坡自动站 — 新乡县 翟坡镇',
      }],
    })
    expect(ctx.tools.get('meteo_station_lookup')?.timeoutMs).toBe(30_000)
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: 'call-lookup-mode' as never,
      name: 'meteo_station_lookup',
      arguments: {},
    })).toEqual({ kind: 'parallel' })
  })

  it('falls back to the generic card when the metadata is not a station list', async () => {
    const failed = await mountTools()
    expect(presentLookupResult({}, { content: [], isError: true })).toBeUndefined()
    expect(presentLookupResult({}, resultFor(await failed.call('meteo_station_lookup', {})))).toBeDefined()
    expect(presentLookupResult({}, { content: [], isError: false, meta: { stations: [{ id: 1 }] } })).toBeUndefined()
  })

  it('titles the pending call by the filter the lookup is searching', async () => {
    expect(presentLookupCall({ county: '新乡县' })).toEqual({
      card: 'generic',
      title: 'Station lookup: county 新乡县',
      kind: 'search',
    })
    expect(presentLookupCall({ text: ' 翟坡 ' })).toEqual({
      card: 'generic',
      title: 'Station lookup: place 翟坡',
      kind: 'search',
    })
  })

  it('names the scope it was narrowed to whatever the arguments looked like', () => {
    expect(lookupScope({})).toBe('whole network')
    expect(lookupScope({ county: '   ' })).toBe('whole network')
    expect(lookupScope({ county: '新乡县' })).toBe('county 新乡县')
    expect(lookupScope({ county: '新乡县', text: '城关' })).toBe('place 城关')
  })

  it('formats a listing that never went through the tool runtime', () => {
    expect(formatStationLookup([STATION], 'whole network'))
      .toBe('1 stations (whole network):\n- ha-xx-01 新乡县城关自动站 — 新乡县 城关镇, lon 113.82 lat 35.18 alt 73.4 m')
    expect(formatStationLookup([], 'county 原阳县')).toBe('No published station matches county 原阳县.')
  })
})
