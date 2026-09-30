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
    id: 'ha-xx-01',
    name: '新乡县城关自动站',
    county: '新乡县',
    township: '城关镇',
    lon: 113.8,
    lat: 35.05,
    altitudeM: 42,
  },
  {
    id: 'ha-xx-02',
    name: '新乡县翟坡自动站',
    county: '新乡县',
    township: '翟坡镇',
    lon: 113.9,
    lat: 35.1,
    altitudeM: 45,
  },
]

const OBSERVATION_ROWS = [
  { time: '2026-09-23T00:00:00Z', elements: { temperature: 18.5, precipitation: 0 } },
  { time: '2026-09-23T01:00:00Z', elements: { temperature: 18.1, precipitation: 0.4 } },
]

const FORECAST_POINTS = [
  { time: '2026-09-24T00:00:00Z', elements: { temperature: 20.2, windSpeed: 3.4 } },
  { time: '2026-09-24T03:00:00Z', elements: { temperature: 21.6, windSpeed: 2.8 } },
  { time: '2026-09-24T06:00:00Z', elements: { temperature: 23.1, windSpeed: 2.1 } },
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
  disaster: '干旱',
  element: 'soilMoisture',
  op: '<=',
  value: 40,
  durationH: 72,
  level: 'medium',
}

/** A catalogue row is one criterion plus the crops it is issued for. */
const RAIN_ROW = { ...RAIN_CRITERION, crops: ['冬小麦'] }
const DROUGHT_ROW = { ...DROUGHT_CRITERION, crops: ['夏玉米'] }

const SOWING_WINDOW = {
  crop: '冬小麦',
  activity: '播种',
  windowStart: '10-15',
  windowEnd: '10-25',
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
    'observations/ha-xx-01.json': OBSERVATION_ROWS,
    'observations/ha-xx-02.json': OBSERVATION_ROWS,
    'forecast/ha-xx-01.json': FORECAST_POINTS,
    'forecast/ha-xx-02.json': FORECAST_POINTS,
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
    expect(await data.station('ha-xx-02')).toEqual(STATIONS[1])
    expect(await data.observations({ stationId: 'ha-xx-01' })).toEqual([
      { stationId: 'ha-xx-01', time: '2026-09-23T00:00:00Z', elements: { temperature: 18.5, precipitation: 0 } },
      { stationId: 'ha-xx-01', time: '2026-09-23T01:00:00Z', elements: { temperature: 18.1, precipitation: 0.4 } },
    ])
    expect(await data.forecast({ stationId: 'ha-xx-01', hours: 3 })).toEqual([FORECAST_POINTS[0], FORECAST_POINTS[1]])
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
    await data.observations({ stationId: 'ha-xx-01' })
    await data.observations({ stationId: 'ha-xx-01' })
    expect(urls).toEqual([
      `${BASE}/stations.json`,
      `${BASE}/observations/ha-xx-01.json`,
      `${BASE}/observations/ha-xx-02.json`,
    ])
  })

  it('answers nothing for a station the origin has no file for', async () => {
    const routes = published()
    delete routes['forecast/ha-xx-02.json']
    const data = seam(serving(routes))
    expect(await data.forecast({ stationId: 'ha-xx-02' })).toEqual([])
    expect(await data.forecast({ stationId: 'ha-xx-01' })).toHaveLength(3)
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
