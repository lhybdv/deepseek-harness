/**
 * how it was narrowed, and what a client can rebuild from its metadata.
 */

import { describe, expect, it } from 'vitest'
import { formatStationLookup, lookupScope, presentLookupCall, presentLookupResult } from '@deepseek-ai/dsh-tool-meteo'
import { mountTools, modelText, resultFor, viewMeta } from './harness.ts'

const STATION = {
  id: 'hl-wc-01',
  name: '五常市五常镇自动站',
  county: '五常市',
  township: '五常镇',
  lon: 127.16,
  lat: 44.93,
  altitudeM: 150,
}
const HARBIN_STATION = {
  id: 'hl-hs-01',
  name: '哈尔滨市道里区自动站',
  county: '哈尔滨市',
  township: '道里区',
  lon: 126.63,
  lat: 45.75,
  altitudeM: 118,
}

describe('meteo_station_lookup', () => {
  it('lists the whole network when the lookup named no filter', async () => {
    const { data, call } = await mountTools()
    const out = await call('meteo_station_lookup', {})
    expect(data.stationQueries).toEqual([{}])
    expect(viewMeta(out).citations).toBeUndefined()
    expect(modelText(out)).toContain('3 stations (whole network):')
    expect(modelText(out)).toContain('- hl-wc-01 五常市五常镇自动站 — 五常市 五常镇, lon 127.16 lat 44.93 alt 150 m')
  })

  it('narrows to a county, then to a place word, and says which it used', async () => {
    const county = await mountTools()
    expect(modelText(await county.call('meteo_station_lookup', { county: '榆树市' }))).toContain('1 stations (county 榆树市):')
    expect(county.data.stationQueries).toEqual([{}, { county: '榆树市' }])
    const place = await mountTools()
    expect(modelText(await place.call('meteo_station_lookup', { county: '五常市', text: '拉林' })))
      .toContain('1 stations (place 拉林):')
    expect(place.data.stationQueries).toEqual([{}, { county: '五常市', text: '拉林' }])
  })

  it('resolves a bare city name to that city’s own first published station', async () => {
    const { data, call } = await mountTools()
    data.stationRows.push(HARBIN_STATION)
    data.synonyms['哈尔滨'] = ['哈尔滨市']
    const out = await call('meteo_station_lookup', { text: '哈尔滨' })
    expect(modelText(out)).toContain('1 stations (place 哈尔滨):')
    expect(modelText(out)).toContain('hl-hs-01 哈尔滨市道里区自动站')
    const filtered = await call('meteo_station_lookup', { county: '哈尔滨市', text: '哈尔滨' })
    expect(modelText(filtered)).toContain('1 stations (place 哈尔滨):')
    expect(data.stationQueries).toEqual([{}, {}])
  })

  it('resolves a bare Shenyang name to a Shenyang station', async () => {
    const { data, call } = await mountTools()
    data.stationRows.push({
      id: 'ln-sy-01',
      name: '沈阳市和平区自动站',
      county: '沈阳市',
      township: '和平区',
      lon: 123.42,
      lat: 41.79,
      altitudeM: 45,
    })
    data.synonyms['沈阳'] = ['沈阳市']
    const out = await call('meteo_station_lookup', { text: '沈阳' })
    expect(modelText(out)).toContain('1 stations (place 沈阳):')
    expect(modelText(out)).toContain('ln-sy-01 沈阳市和平区自动站')
  })

  it('returns structured coverage and published seat points for an uncovered place', async () => {
    const { data, call } = await mountTools()
    data.stationRows.push(HARBIN_STATION)
    const out = await call('meteo_station_lookup', { text: '广州' })
    expect(modelText(out)).toContain('Coverage: 五常市、榆树市、哈尔滨市.')
    expect(modelText(out)).toContain('五常市五常镇自动站 (hl-wc-01,')
    expect(data.stationQueries).toEqual([{}, { text: '广州' }])
  })

  it('hands a client the identity of each station without the siting numbers', async () => {
    const { ctx, call } = await mountTools()
    const out = await call('meteo_station_lookup', { county: '五常市' })
    expect(presentLookupResult({}, resultFor(out))).toEqual({
      card: 'generic',
      title: '2 published stations',
      content: [{
        type: 'text',
        text: '- hl-wc-01 五常市五常镇自动站 — 五常市 五常镇\n- hl-wc-02 五常市拉林满族镇自动站 — 五常市 拉林满族镇',
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
    expect(presentLookupCall({ county: '五常市' })).toEqual({
      card: 'generic',
      title: 'Station lookup: county 五常市',
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
    expect(lookupScope({ county: '榆树市' })).toBe('county 榆树市')
    expect(lookupScope({ county: '五常市', text: '五常镇' })).toBe('place 五常镇')
  })

  it('formats a listing or structured coverage summary outside the tool runtime', () => {
    expect(formatStationLookup([STATION], 'whole network', ['五常市'], [STATION]))
      .toBe('1 stations (whole network):\n- hl-wc-01 五常市五常镇自动站 — 五常市 五常镇, lon 127.16 lat 44.93 alt 150 m')
    expect(formatStationLookup([], 'place 广州', ['五常市'], [STATION]))
      .toBe('No published station matches place 广州. Coverage: 五常市. Published county seat points (longitude, latitude): 五常市五常镇自动站 (hl-wc-01, 127.16, 44.93). Do not claim a nearest point unless supported by geographic information.')
  })
})
