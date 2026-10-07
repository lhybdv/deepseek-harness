/**
 * Tests for the HTTP data source: the URL shape a static bundle must answer, the
 * per-station omission a partial origin causes, and the four ways an origin can
 * fail a consultation — a missing file, a failed status, an unparsable body, and
 * silence.
 *
 * Every case drives the seam with `source: "http"` so the provider and the source
 * are proven together; `fetch` is stubbed, so no test reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalMeteoData, MeteoDataError } from '@deepseek-ai/dsh-meteo-data'
import type { MeteoDataConfig } from '@deepseek-ai/dsh-meteo-data'

const BASE = 'https://meteo.example.test/bundle'

const STATIONS = [
  {
    id: 'hl-wc-01',
    name: '五常市五常镇自动站',
    county: '五常市',
    township: '五常镇',
    lon: 127.16,
    lat: 44.93,
    altitudeM: 150,
  },
  {
    id: 'jl-ys-02',
    name: '榆树市五棵树镇自动站',
    county: '榆树市',
    township: '五棵树镇',
    lon: 126.31,
    lat: 44.96,
    altitudeM: 185,
  },
]

const OBSERVATION_ROWS = [
  { time: '2026-09-23T00:00:00Z', elements: { temperature: 5.2, precipitation: 0 } },
  { time: '2026-09-23T01:00:00Z', elements: { temperature: 4.8, precipitation: 0 } },
]

const FORECAST_POINTS = [
  { time: '2026-09-24T00:00:00Z', elements: { temperature: 2.1, windSpeed: 3.4 } },
  { time: '2026-09-24T03:00:00Z', elements: { temperature: 1.5, windSpeed: 3.2 } },
  { time: '2026-09-24T06:00:00Z', elements: { temperature: 2.8, windSpeed: 3.8 } },
]

const RAIN_CRITERION = {
  disaster: '暴雨',
  element: 'precipitation',
  op: '>=',
  value: 25,
  durationH: 12,
  level: 'low',
}

const DROUGHT_CRITERION = {
  disaster: '春旱',
  element: 'soilMoisture',
  op: '<=',
  value: 40,
  durationH: 72,
  level: 'medium',
}

/** A catalogue row is one criterion plus the crops it is issued for. */
const RAIN_ROW = { ...RAIN_CRITERION, crops: ['玉米'] }
const DROUGHT_ROW = { ...DROUGHT_CRITERION, crops: ['大豆'] }

const SOWING_WINDOW = {
  crop: '玉米',
  activity: '播种',
  windowStart: '04-25',
  windowEnd: '05-15',
  criteria: [RAIN_CRITERION],
}

const VERSIONS = {
  version: '2026.09-origin.1',
  datasets: {
    stations: 'r1',
    observations: 'r1',
    forecast: 'r1',
    thresholds: 'r1',
    cropCalendar: 'r1',
    synonyms: 'r1',
    taxonomy: 'r1',
  },
}

/** The bundle an origin publishes; the cases below take paths away from it. */
function published(): Record<string, unknown> {
  return {
    'stations.json': STATIONS,
    'observations/hl-wc-01.json': OBSERVATION_ROWS,
    'observations/jl-ys-02.json': OBSERVATION_ROWS,
    'forecast/hl-wc-01.json': FORECAST_POINTS,
    'forecast/jl-ys-02.json': FORECAST_POINTS,
    'thresholds.json': [RAIN_ROW, DROUGHT_ROW],
    'crop-calendar.json': [SOWING_WINDOW],
    'synonyms.json': { 暴雨: ['强降水', '大雨'] },
    'taxonomy.json': {
      disasters: [{ id: 'rainstorm', name: '暴雨', aliases: ['强降水'], elements: ['precipitation'] }],
      elements: [{ id: 'precipitation', name: '降水量', unit: 'mm' }],
    },
    'meta.json': VERSIONS,
  }
}

const urls: string[] = []
const contexts: Context[] = []

/** One answer an origin gives to a bundle path. */
type Transport = (input: string, init?: RequestInit) => Promise<Response>

/** Reply to bundle paths out of an exported bundle; every other path answers 404. */
function serving(routes: Record<string, unknown>): Transport {
  return async (input: string) => {
    urls.push(input)
    const path = input.slice(`${BASE}/`.length)
    if (!(path in routes)) return new Response('missing', { status: 404 })
    return new Response(JSON.stringify(routes[path]), { headers: { 'content-type': 'application/json' } })
  }
}

/** Build a seam whose every request goes through `transport`. */
function seam(transport: Transport, timeoutMs = 15_000): LocalMeteoData {
  vi.stubGlobal('fetch', transport)
  const ctx = new Context()
  contexts.push(ctx)
  const config: MeteoDataConfig = { source: 'http', baseUrl: BASE, timeoutMs }
  return new LocalMeteoData(ctx, config)
}

async function rejection(run: () => Promise<unknown>): Promise<MeteoDataError> {
  const reason = await run().then(
    () => {
      throw new Error('expected the seam to reject')
    },
    (failure: unknown) => failure,
  )
  expect(reason).toBeInstanceOf(MeteoDataError)
  return reason as MeteoDataError
}

beforeEach(() => {
  urls.length = 0
})

afterEach(async () => {
  vi.unstubAllGlobals()
  urls.length = 0
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('an origin serving the bundle', () => {
  it('answers every seam method over HTTP', async () => {
    const data = seam(serving(published()))
    expect(await data.stations()).toEqual(STATIONS)
    expect(await data.station('jl-ys-02')).toEqual(STATIONS[1])
    expect(await data.observations({ stationId: 'hl-wc-01' })).toEqual([
      { stationId: 'hl-wc-01', time: '2026-09-23T00:00:00Z', elements: { temperature: 5.2, precipitation: 0 } },
      { stationId: 'hl-wc-01', time: '2026-09-23T01:00:00Z', elements: { temperature: 4.8, precipitation: 0 } },
    ])
    expect(await data.forecast({ stationId: 'hl-wc-01', hours: 3 })).toEqual([FORECAST_POINTS[0], FORECAST_POINTS[1]])
    expect(await data.thresholds({ disaster: '暴雨' })).toEqual([RAIN_CRITERION])
    expect(await data.cropCalendar({ disaster: '暴雨' })).toEqual([SOWING_WINDOW])
    expect(await data.expandTerm('暴雨')).toEqual(['强降水', '大雨'])
    expect(await data.versions()).toEqual(VERSIONS)
    expect(urls[0]).toBe(`${BASE}/stations.json`)
  })

  it('asks the origin for each dataset once', async () => {
    const data = seam(serving(published()))
    await data.stations()
    await data.stations()
    await data.observations({ stationId: 'hl-wc-01' })
    await data.observations({ stationId: 'hl-wc-01' })
    expect(urls).toEqual([
      `${BASE}/stations.json`,
      `${BASE}/observations/hl-wc-01.json`,
      `${BASE}/observations/jl-ys-02.json`,
    ])
  })

  it('answers nothing for a station the origin has no file for', async () => {
    const routes = published()
    delete routes['forecast/jl-ys-02.json']
    const data = seam(serving(routes))
    expect(await data.forecast({ stationId: 'jl-ys-02' })).toEqual([])
    expect(await data.forecast({ stationId: 'hl-wc-01' })).toHaveLength(3)
  })

  it('refuses a dataset the origin does not carry', async () => {
    const routes = published()
    delete routes['thresholds.json']
    const error = await rejection(() => seam(serving(routes)).thresholds())
    expect(error.code).toBe('METEO_DATASET_UNAVAILABLE')
    expect(error.message).toContain('has no "thresholds.json" dataset')
  })
})

describe('an origin that fails', () => {
  it('reports a status that is not a success', async () => {
    const data = seam(async () => new Response('upstream exploded', { status: 500 }))
    const error = await rejection(() => data.stations())
    expect(error.code).toBe('METEO_SOURCE_ERROR')
    expect(error.message).toContain('got status 500')
  })

  it('reports a body that is not JSON', async () => {
    const data = seam(async () => new Response('<html>gate</html>', { status: 200 }))
    const error = await rejection(() => data.stations())
    expect(error.code).toBe('METEO_SOURCE_ERROR')
    expect(error.message).toContain('got invalid JSON')
  })

  it('reports an origin it cannot reach', async () => {
    const data = seam(async () => {
      throw new Error('ECONNREFUSED')
    })
    const error = await rejection(() => data.stations())
    expect(error.code).toBe('METEO_SOURCE_ERROR')
    expect(error.message).toContain(`cannot reach "${BASE}/stations.json"`)
  })

  it('gives up on an origin that stops answering within the configured deadline', async () => {
    const data = seam(async (input, init) => {
      urls.push(input)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('origin stopped answering'))
        })
      })
    }, 5)
    const error = await rejection(() => data.stations())
    expect(error.code).toBe('METEO_SOURCE_ERROR')
    expect(error.message).toContain(`cannot reach "${BASE}/stations.json"`)
    expect(urls).toEqual([`${BASE}/stations.json`])
  })
})
