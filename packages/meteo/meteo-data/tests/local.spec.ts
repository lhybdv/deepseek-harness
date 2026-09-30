/**
 * Tests for the shipped meteorological data provider: the answers the demo
 * bundle gives through the seam, every configuration mistake the loader refuses,
 * and the failure of a bundle that is missing, unreadable, or outside its
 * published shape.
 *
 * The window and horizon cases pin the contract a consultation tool leans on:
 * bounds are inclusive on both ends, a horizon counts from the first point the
 * window still holds, and a station that exists but publishes nothing answers an
 * empty list rather than an error.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalMeteoData, MeteoDataError } from '@deepseek-ai/dsh-meteo-data'
import type { MeteoDataConfig } from '@deepseek-ai/dsh-meteo-data'

/** The bundle the package ships, which is the bundle the demo deploys. */
const SHIPPED = fileURLToPath(new URL('../fixtures/', import.meta.url))

const contexts: Context[] = []
const directories: string[] = []

/** Build a provider over the named bundle directory, on a context teardown disposes. */
function provider(fixtureDir = SHIPPED): LocalMeteoData {
  const ctx = new Context()
  contexts.push(ctx)
  const config: MeteoDataConfig = { source: 'fixture', fixtureDir, timeoutMs: 15_000 }
  return new LocalMeteoData(ctx, config)
}

/** A throwaway bundle directory holding exactly the files a case names. */
async function bundle(name: string, files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `meteo-data-${name}-`))
  directories.push(root)
  for (const [file, value] of Object.entries(files)) {
    const path = join(root, file)
    await mkdir(join(path, '..'), { recursive: true })
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    await writeFile(path, text, 'utf8')
  }
  return root
}

/** A call that builds a provider from a configuration the loader must refuse. */
function refused(config: MeteoDataConfig): () => void {
  return () => new LocalMeteoData(new Context(), config)
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

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const STATION = {
  id: 'ha-xx-01',
  name: '新乡县城关自动站',
  county: '新乡县',
  township: '城关镇',
  lon: 113.8,
  lat: 35.05,
  altitudeM: 42,
}

describe('station catalogue', () => {
  it('lists every published station', async () => {
    expect(await provider().stations()).toHaveLength(24)
  })

  it('filters by county', async () => {
    const stations = await provider().stations({ county: '滑县' })
    expect(stations).toHaveLength(8)
    expect(stations.every(station => station.county === '滑县')).toBe(true)
  })

  it('matches the free text against the station name', async () => {
    expect(await provider().stations({ text: '自动站' })).toHaveLength(24)
  })

  it('matches the free text against the township the station sits in', async () => {
    expect(await provider().stations({ text: '瓦岗寨' })).toEqual([
      expect.objectContaining({ id: 'ha-hx-06', name: '滑县瓦岗自动站' }),
    ])
  })

  it('matches the free text against the county name', async () => {
    expect(await provider().stations({ text: '永城市' })).toHaveLength(8)
  })

  it('answers nothing for a place it does not publish', async () => {
    expect(await provider().stations({ text: '冰雹镇' })).toEqual([])
  })

  it('combines the county and the free text', async () => {
    expect(await provider().stations({ county: '永城市', text: '芒山' })).toEqual([
      expect.objectContaining({ id: 'ha-yc-01' }),
    ])
  })

  it('resolves one station by id', async () => {
    expect(await provider().station('ha-xx-01')).toEqual({
      id: 'ha-xx-01',
      name: '新乡县城关自动站',
      county: '新乡县',
      township: '城关镇',
      lon: 114,
      lat: 35.2,
      altitudeM: 37.3,
    })
  })

  it('answers undefined for an unknown station id', async () => {
    expect(await provider().station('ha-zz-99')).toBeUndefined()
  })
})

describe('observations', () => {
  it('reads a day of hourly rows, oldest first', async () => {
    const rows = await provider().observations({ stationId: 'ha-yc-03' })
    expect(rows).toHaveLength(24)
    expect(rows[0]).toEqual({
      stationId: 'ha-yc-03',
      time: '2026-09-23T00:00:00Z',
      elements: { temperature: 21, humidity: 93.2, precipitation: 0, windSpeed: 6.8, soilMoisture: 57.7 },
    })
    expect(rows.reduce((sum, row) => sum + (row.elements.precipitation ?? 0), 0)).toBeCloseTo(56.5, 1)
  })

  it('keeps the rows inside an inclusive window', async () => {
    const rows = await provider().observations({
      stationId: 'ha-xx-01',
      from: '2026-09-23T06:00:00Z',
      to: '2026-09-23T10:00:00Z',
    })
    expect(rows.map(row => row.time)).toEqual([
      '2026-09-23T06:00:00Z',
      '2026-09-23T07:00:00Z',
      '2026-09-23T08:00:00Z',
      '2026-09-23T09:00:00Z',
      '2026-09-23T10:00:00Z',
    ])
  })

  it('applies a start bound on its own', async () => {
    const rows = await provider().observations({ stationId: 'ha-xx-01', from: '2026-09-23T18:00:00Z' })
    expect(rows.map(row => row.time)).toEqual([
      '2026-09-23T18:00:00Z',
      '2026-09-23T19:00:00Z',
      '2026-09-23T20:00:00Z',
      '2026-09-23T21:00:00Z',
      '2026-09-23T22:00:00Z',
      '2026-09-23T23:00:00Z',
    ])
  })

  it('applies an end bound on its own', async () => {
    const rows = await provider().observations({ stationId: 'ha-xx-01', to: '2026-09-23T05:00:00Z' })
    expect(rows).toHaveLength(6)
    expect(rows.at(-1)?.time).toBe('2026-09-23T05:00:00Z')
  })

  it('refuses a station this deployment does not publish', async () => {
    const error = await rejection(() => provider().observations({ stationId: 'ha-zz-99' }))
    expect(error.code).toBe('METEO_STATION_NOT_FOUND')
    expect(error.message).toContain('ha-zz-99')
  })

  it('refuses a time bound that is not an instant', async () => {
    const error = await rejection(() => provider().observations({ stationId: 'ha-xx-01', from: 'last night' }))
    expect(error.code).toBe('METEO_INVALID_QUERY')
  })
})

describe('forecast guide', () => {
  it('reads the whole guide, earliest first', async () => {
    const points = await provider().forecast({ stationId: 'ha-xx-01' })
    expect(points).toHaveLength(24)
    expect(points[0]?.time).toBe('2026-09-24T00:00:00Z')
    expect(points[0]?.elements.soilMoisture).toBeUndefined()
    expect(Date.parse(points.at(-1)?.time ?? '')).toBeGreaterThan(Date.parse(points[0]?.time ?? ''))
  })

  it('cuts the guide at a horizon counted from its first point', async () => {
    const points = await provider().forecast({ stationId: 'ha-xx-01', hours: 12 })
    expect(points.map(point => point.time)).toEqual([
      '2026-09-24T00:00:00Z',
      '2026-09-24T03:00:00Z',
      '2026-09-24T06:00:00Z',
      '2026-09-24T09:00:00Z',
      '2026-09-24T12:00:00Z',
    ])
  })

  it('counts the horizon from the start bound when one is given', async () => {
    const points = await provider().forecast({
      stationId: 'ha-xx-01',
      from: '2026-09-25T00:00:00Z',
      hours: 6,
    })
    expect(points.map(point => point.time)).toEqual([
      '2026-09-25T00:00:00Z',
      '2026-09-25T03:00:00Z',
      '2026-09-25T06:00:00Z',
    ])
  })

  it('drops the points before a start bound', async () => {
    const points = await provider().forecast({ stationId: 'ha-xx-01', from: '2026-09-25T00:00:00Z' })
    expect(points).toHaveLength(16)
    expect(points[0]?.time).toBe('2026-09-25T00:00:00Z')
  })

  it('refuses a horizon that is not a whole number of hours', async () => {
    const data = provider()
    const half = await rejection(() => data.forecast({ stationId: 'ha-xx-01', hours: 2.5 }))
    const negative = await rejection(() => data.forecast({ stationId: 'ha-xx-01', hours: -1 }))
    expect(half.code).toBe('METEO_INVALID_QUERY')
    expect(negative.code).toBe('METEO_INVALID_QUERY')
  })

  it('refuses a station this deployment does not publish', async () => {
    const error = await rejection(() => provider().forecast({ stationId: 'ha-zz-99' }))
    expect(error.code).toBe('METEO_STATION_NOT_FOUND')
  })
})

describe('criteria and farming calendar', () => {
  it('lists the criteria in the order the catalogue publishes them', async () => {
    const thresholds = await provider().thresholds()
    expect(thresholds).toHaveLength(10)
    expect(thresholds[0]).toEqual({
      disaster: '暴雨',
      element: 'precipitation',
      op: '>=',
      value: 25,
      durationH: 12,
      level: 'low',
    })
  })

  it('filters criteria by disaster', async () => {
    const drought = await provider().thresholds({ disaster: '干旱' })
    expect(drought.map(threshold => threshold.element)).toEqual(['soilMoisture', 'soilMoisture', 'temperature'])
  })

  it('filters criteria by the crop they are issued for', async () => {
    const wheat = await provider().thresholds({ crop: '冬小麦' })
    expect(wheat).toHaveLength(9)
    const byTemperature = wheat.filter(threshold => threshold.element === 'temperature')
    expect(byTemperature.map(threshold => ({ disaster: threshold.disaster, level: threshold.level }))).toEqual([
      { disaster: '晚霜冻', level: 'low' },
      { disaster: '晚霜冻', level: 'high' },
    ])
  })

  it('combines the disaster and crop filters', async () => {
    const data = provider()
    expect(await data.thresholds({ disaster: '大风', crop: '夏玉米' })).toHaveLength(2)
    expect(await data.thresholds({ disaster: '晚霜冻', crop: '夏玉米' })).toEqual([])
  })

  it('lists the farming windows of the calendar', async () => {
    expect(await provider().cropCalendar()).toHaveLength(13)
  })

  it('filters the calendar by crop', async () => {
    const maize = await provider().cropCalendar({ crop: '夏玉米' })
    expect(maize).toHaveLength(6)
    expect(maize[0]).toEqual(expect.objectContaining({ crop: '夏玉米', activity: '播种', windowStart: '06-10' }))
  })

  it('filters the calendar by the disaster a window is graded against', async () => {
    const frosted = await provider().cropCalendar({ disaster: '晚霜冻' })
    expect(frosted.map(entry => entry.activity)).toEqual(['越冬', '返青', '抽穗'])
  })

  it('combines the calendar filters', async () => {
    const data = provider()
    expect(await data.cropCalendar({ crop: '冬小麦', disaster: '暴雨' })).toEqual([
      expect.objectContaining({ activity: '收获' }),
    ])
    expect(await data.cropCalendar({ crop: '夏玉米', disaster: '晚霜冻' })).toEqual([])
  })
})

describe('term expansion and revisions', () => {
  it('expands a term the synonym dataset carries', async () => {
    expect(await provider().expandTerm('暴雨')).toEqual(['强降水', '大雨', '特大暴雨'])
  })

  it('expands a term the taxonomy knows under its own wording', async () => {
    expect(await provider().expandTerm('晚霜冻')).toEqual(['倒春寒', '霜冻'])
  })

  it('expands an alias back to the disaster it names', async () => {
    expect(await provider().expandTerm('倒春寒')).toEqual(['晚霜冻', '霜冻'])
  })

  it('answers nothing for a term no dataset knows', async () => {
    expect(await provider().expandTerm('冰雹')).toEqual([])
  })

  it('reports the revision of the bundle and of every dataset', async () => {
    const versions = await provider().versions()
    expect(versions.version).toBe('2026.09-demo.1')
    expect(Object.keys(versions.datasets)).toEqual([
      'stations',
      'observations',
      'forecast',
      'thresholds',
      'cropCalendar',
      'synonyms',
      'taxonomy',
    ])
    expect(versions.datasets.forecast).toBe('2026.09-forecast.1')
  })
})

describe('bundle failures', () => {
  it('refuses a bundle whose files are missing', async () => {
    const root = await bundle('empty', {})
    const error = await rejection(() => provider(root).stations())
    expect(error.code).toBe('METEO_DATASET_UNAVAILABLE')
    expect(error.message).toContain('cannot read "stations.json"')
  })

  it('refuses a file that is not JSON at all', async () => {
    const root = await bundle('bad-json', { 'stations.json': '{ station' })
    const error = await rejection(() => provider(root).stations())
    expect(error.code).toBe('METEO_DATASET_UNAVAILABLE')
    expect(error.message).toContain('got invalid JSON')
  })

  it('refuses a dataset whose rows are outside the published shape', async () => {
    const root = await bundle('bad-shape', {
      'stations.json': [STATION],
      'thresholds.json': [{ disaster: '暴雨' }],
      'crop-calendar.json': [{
        crop: '冬小麦',
        activity: '播种',
        windowStart: '10-15',
        windowEnd: '10-25',
        criteria: [],
      }],
      'meta.json': { version: 'x', datasets: { stations: 'x' } },
    })
    const data = provider(root)
    expect((await rejection(() => data.thresholds())).message).toContain('"thresholds" dataset')
    expect((await rejection(() => data.cropCalendar())).message).toContain('"cropCalendar" dataset')
    const manifest = await rejection(() => data.versions())
    expect(manifest.code).toBe('METEO_DATASET_UNAVAILABLE')
    expect(manifest.message).toContain('"meta" dataset')
  })

  it('refuses a station row whose time is not an instant', async () => {
    const root = await bundle('bad-time', {
      'stations.json': [STATION],
      'observations/ha-xx-01.json': [{ time: 'yesterday', elements: { temperature: 20 } }],
    })
    const error = await rejection(() => provider(root).observations({ stationId: 'ha-xx-01' }))
    expect(error.code).toBe('METEO_DATASET_UNAVAILABLE')
  })

  it('reads a station directory that is partly filled, ignoring files that are not JSON', async () => {
    const root = await bundle('partial', {
      'stations.json': [STATION, { ...STATION, id: 'ha-xx-02', name: '新乡县翟坡自动站', township: '翟坡镇' }],
      'observations/ha-xx-01.json': [{ time: '2026-09-23T00:00:00Z', elements: { temperature: 21.4 } }],
      'observations/README.txt': 'draft bundle',
      'forecast/ha-xx-01.json': [{ time: '2026-09-24T00:00:00Z', elements: { temperature: 20.2 } }],
    })
    const data = provider(root)
    expect(await data.observations({ stationId: 'ha-xx-01' })).toEqual([
      { stationId: 'ha-xx-01', time: '2026-09-23T00:00:00Z', elements: { temperature: 21.4 } },
    ])
    expect(await data.observations({ stationId: 'ha-xx-02' })).toEqual([])
    expect(await data.forecast({ stationId: 'ha-xx-01' })).toEqual([
      { time: '2026-09-24T00:00:00Z', elements: { temperature: 20.2 } },
    ])
    expect(await data.forecast({ stationId: 'ha-xx-02', hours: 24 })).toEqual([])
  })

  it('refuses a bundle whose station directories are missing entirely', async () => {
    const root = await bundle('no-directory', { 'stations.json': [STATION] })
    const data = provider(root)
    const observations = await rejection(() => data.observations({ stationId: 'ha-xx-01' }))
    expect(observations.message).toContain('cannot list "observations"')
    const forecast = await rejection(() => data.forecast({ stationId: 'ha-xx-01' }))
    expect(forecast.message).toContain('cannot list "forecast"')
  })

  it('answers an empty guide for a station that publishes no points', async () => {
    const root = await bundle('offline', {
      'stations.json': [STATION],
      'forecast/ha-xx-01.json': [],
      'observations/ha-xx-01.json': [],
    })
    const data = provider(root)
    expect(await data.forecast({ stationId: 'ha-xx-01', hours: 12 })).toEqual([])
    expect(await data.observations({ stationId: 'ha-xx-01', from: '2026-09-23T00:00:00Z' })).toEqual([])
  })
})

describe('configuration', () => {
  it('refuses a request deadline that is not a whole positive number of milliseconds', () => {
    expect(refused({ source: 'fixture', fixtureDir: SHIPPED, timeoutMs: 0 }))
      .toThrow(/timeoutMs must be a positive integer/)
    expect(refused({ source: 'fixture', fixtureDir: SHIPPED, timeoutMs: 1.5 }))
      .toThrow(/timeoutMs must be a positive integer/)
  })

  it('refuses a file bundle with an origin configured', () => {
    expect(refused({
      source: 'fixture',
      fixtureDir: SHIPPED,
      baseUrl: 'https://meteo.example.test/bundle',
      timeoutMs: 15_000,
    })).toThrow(/baseUrl is only valid with source "http"/)
  })

  it('refuses a file bundle with no directory', () => {
    expect(refused({ source: 'fixture', timeoutMs: 15_000 }))
      .toThrow(/source "fixture" requires a non-empty fixtureDir/)
    expect(refused({ source: 'fixture', fixtureDir: '', timeoutMs: 15_000 }))
      .toThrow(/source "fixture" requires a non-empty fixtureDir/)
  })

  it('refuses an origin with a directory configured, or with no usable address', () => {
    expect(refused({
      source: 'http',
      fixtureDir: SHIPPED,
      baseUrl: 'https://meteo.example.test/bundle',
      timeoutMs: 15_000,
    })).toThrow(/fixtureDir is only valid with source "fixture"/)
    expect(refused({ source: 'http', baseUrl: '', timeoutMs: 15_000 }))
      .toThrow(/source "http" requires a non-empty baseUrl/)
    expect(refused({ source: 'http', baseUrl: 'ftp://meteo.example.test', timeoutMs: 15_000 }))
      .toThrow(/baseUrl must be an http\(s\) URL/)
    expect(refused({ source: 'http', baseUrl: 'https://meteo.example.test/', timeoutMs: 15_000 }))
      .toThrow(/baseUrl must not end with a slash/)
  })

  it('builds an origin provider without asking it for anything', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const data = new LocalMeteoData(ctx, {
      source: 'http',
      baseUrl: 'https://meteo.example.test/bundle',
      timeoutMs: 15_000,
    })
    expect(data).toBeInstanceOf(LocalMeteoData)
  })
})
