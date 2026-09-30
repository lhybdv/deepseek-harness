/**
 * Behaviour tests for the rule engine: what counts as a criterion holding, how
 * long it held, which days are judgeable at all, and when the published data
 * supports no verdict rather than a guessed one.
 */

import { describe, expect, it } from 'vitest'
import type { CropWindow, Threshold } from '@deepseek-ai/dsh-meteo-data'
import { evaluateHazard, evaluateSuitability } from '@deepseek-ai/dsh-tool-meteo'
import type { RuleSample } from '@deepseek-ai/dsh-tool-meteo'

const gale: Threshold = { disaster: '大风', element: 'windSpeed', op: '>=', value: 13.9, durationH: 6, level: 'medium' }
const galeForce: Threshold = { disaster: '大风', element: 'windSpeed', op: '>=', value: 24.5, durationH: 6, level: 'high' }
const drought: Threshold = { disaster: '干旱', element: 'soilMoisture', op: '<=', value: 30, durationH: 24, level: 'medium' }
const lightFrost: Threshold = { disaster: '晚霜冻', element: 'temperature', op: '<=', value: 0, durationH: 0, level: 'low' }

const sowing: CropWindow = { crop: '冬小麦', activity: '播种', windowStart: '10-05', windowEnd: '10-20', criteria: [gale] }

/** Reading series of hourly wind speeds, one value per hour from 04:00. */
function wind(winds: number[], day = '2026-10-08'): RuleSample[] {
  return winds.map((speed, index) => ({
    time: `${day}T${String(index + 4).padStart(2, '0')}:00:00Z`,
    elements: { windSpeed: speed },
  }))
}

describe('evaluateSuitability', () => {
  it('judges each day the readings cover against each window that covers it', () => {
    const samples = [...wind([14.8, 15.2]), ...wind([14.8, 15.2], '2026-10-09')]
    expect(evaluateSuitability({ windows: [sowing], criteria: [gale], samples })).toEqual([
      { day: '2026-10-08', crop: '冬小麦', activity: '播种', verdict: 'suitable', criteria: [] },
      { day: '2026-10-09', crop: '冬小麦', activity: '播种', verdict: 'suitable', criteria: [] },
    ])
  })

  it('publishes no record for a day that falls outside every window', () => {
    expect(evaluateSuitability({ windows: [sowing], criteria: [gale], samples: wind([14.8], '2026-09-30') })).toEqual([])
  })

  it('judges a year-wrapping window at both ends of the year', () => {
    const overwinter: CropWindow = { ...sowing, activity: '越冬', windowStart: '12-15', windowEnd: '02-20' }
    const samples = [
      { time: '2026-12-20T04:00:00Z', elements: { windSpeed: 5 } },
      { time: '2026-01-05T04:00:00Z', elements: { windSpeed: 5 } },
      { time: '2026-06-01T04:00:00Z', elements: { windSpeed: 5 } },
    ]
    expect(evaluateSuitability({ windows: [overwinter], criteria: [gale], samples }).map(day => day.day))
      .toEqual(['2026-01-05', '2026-12-20'])
  })

  it('marks a day unsuitable and names the span the criterion held', () => {
    const samples = wind([14.8, 17.6, 16.9, 15.4, 14.1, 14.6, 14.2, 13.2])
    const [day] = evaluateSuitability({ windows: [sowing], criteria: [gale], samples })
    expect(day).toEqual({
      day: '2026-10-08',
      crop: '冬小麦',
      activity: '播种',
      verdict: 'unsuitable',
      criteria: [{ ...gale, hoursHeld: 6, firstTime: '2026-10-08T04:00:00Z' }],
    })
  })

  it('does not fire a criterion that held for less than the duration it demands', () => {
    const [day] = evaluateSuitability({ windows: [sowing], criteria: [gale], samples: wind([14.8, 17.6, 16.9, 15.4, 14.1]) })
    expect(day?.verdict).toBe('suitable')
    expect(day?.criteria).toEqual([])
  })

  it('counts the longest run, not the first one it meets', () => {
    const held = { ...gale, durationH: 2 }
    const samples = wind([14.8, 13.2, 14.8, 15.2, 15.6, 16.1, 13.2])
    const [day] = evaluateSuitability({ windows: [{ ...sowing, criteria: [] }], criteria: [], samples })
    expect(day?.verdict).toBe('unknown')
    expect(evaluateHazard({ thresholds: [held], samples, ruleVersion: 'th-7' }).basis)
      .toEqual([{ ...held, hoursHeld: 3, firstTime: '2026-10-08T06:00:00Z' }])
  })

  it('skips a reading that lacks the element without breaking the run', () => {
    const samples: RuleSample[] = [
      { time: '2026-10-08T04:00:00Z', elements: { windSpeed: 14.8 } },
      { time: '2026-10-08T05:00:00Z', elements: { temperature: 20 } },
      { time: '2026-10-08T06:00:00Z', elements: { windSpeed: 15.2 } },
    ]
    const held = { ...gale, durationH: 2 }
    const [day] = evaluateSuitability({ windows: [{ ...sowing, criteria: [held] }], criteria: [held], samples })
    expect(day?.criteria).toEqual([{ ...held, hoursHeld: 2, firstTime: '2026-10-08T04:00:00Z' }])
  })

  it('ends a run at the reading that fails the comparison', () => {
    const samples = wind([14.8, 15.2, 5.4, 16.1, 17.2])
    const held = { ...gale, durationH: 2 }
    const [day] = evaluateSuitability({ windows: [{ ...sowing, criteria: [held] }], criteria: [held], samples })
    expect(day?.verdict).toBe('suitable')
  })

  it('measures a lone qualifying reading as a zero-hour hold', () => {
    const samples: RuleSample[] = [{ time: '2026-10-08T04:00:00Z', elements: { temperature: -1.2 } }]
    const [day] = evaluateSuitability({ windows: [{ ...sowing, criteria: [lightFrost] }], criteria: [lightFrost], samples })
    expect(day?.criteria).toEqual([{ ...lightFrost, hoursHeld: 0, firstTime: '2026-10-08T04:00:00Z' }])
  })

  it('verifies a `<=` criterion the same way as a `>=` one', () => {
    const samples: RuleSample[] = [
      { time: '2026-10-08T04:00:00Z', elements: { soilMoisture: 28.4 } },
      { time: '2026-10-08T05:00:00Z', elements: { soilMoisture: 27.9 } },
      { time: '2026-10-08T06:00:00Z', elements: { soilMoisture: 27.1 } },
    ]
    const twoDayDrought = { ...drought, durationH: 2 }
    const [day] = evaluateSuitability({
      windows: [{ ...sowing, criteria: [twoDayDrought] }],
      criteria: [twoDayDrought],
      samples,
    })
    expect(day?.criteria).toEqual([{ ...drought, durationH: 2, hoursHeld: 2, firstTime: '2026-10-08T04:00:00Z' }])
  })

  it('refuses a suitable verdict while a window criterion the readings never carried is in force', () => {
    const [day] = evaluateSuitability({
      windows: [{ ...sowing, criteria: [gale, drought] }],
      criteria: [gale, drought],
      samples: wind([9.8]),
    })
    expect(day?.verdict).toBe('unknown')
    expect(day?.criteria).toEqual([])
  })

  it('marks the day unknown when the deployment no longer publishes the window criterion', () => {
    const [day] = evaluateSuitability({ windows: [sowing], criteria: [galeForce], samples: wind([9.8]) })
    expect(day?.verdict).toBe('unknown')
    expect(day?.criteria).toEqual([])
  })

  it('judges the readings in instant order whatever order they arrived in', () => {
    const samples = wind([13.2, 14.6, 14.1, 15.4, 16.9, 17.6, 14.8, 15.2]).reverse()
    const [day] = evaluateSuitability({ windows: [sowing], criteria: [gale], samples })
    expect(day?.criteria).toEqual([{ ...gale, hoursHeld: 6, firstTime: '2026-10-08T05:00:00Z' }])
  })
})

describe('evaluateHazard', () => {
  it('grades by the strongest criterion that held and lists every one that held', () => {
    const samples = wind([14.8, 25.1, 26.4, 27.2, 25.8, 24.9, 26.6, 25.4])
    const finding = evaluateHazard({ thresholds: [gale, galeForce], samples, ruleVersion: 'th-7' })
    expect(finding).toEqual({
      level: 'high',
      basis: [
        { ...gale, hoursHeld: 7, firstTime: '2026-10-08T04:00:00Z' },
        { ...galeForce, hoursHeld: 6, firstTime: '2026-10-08T05:00:00Z' },
      ],
      ruleVersion: 'th-7',
    })
  })

  it('keeps the strongest grade when a milder criterion is published after it', () => {
    const samples = wind([25.1, 26.4, 27.2, 28.1, 26.5, 25.9, 26.2])
    expect(evaluateHazard({ thresholds: [galeForce, gale], samples, ruleVersion: 'th-7' }).level).toBe('high')
  })

  it('reports the mildest grade a lone criterion carries', () => {
    const samples: RuleSample[] = [{ time: '2026-10-08T04:00:00Z', elements: { temperature: -2 } }]
    expect(evaluateHazard({ thresholds: [lightFrost], samples, ruleVersion: 'th-7' })).toEqual({
      level: 'low',
      basis: [{ ...lightFrost, hoursHeld: 0, firstTime: '2026-10-08T04:00:00Z' }],
      ruleVersion: 'th-7',
    })
  })

  it('reports no grade when no published criterion held', () => {
    expect(evaluateHazard({ thresholds: [gale, drought], samples: wind([9.8, 8.4]), ruleVersion: 'th-7' }))
      .toEqual({ level: 'unknown', basis: [], ruleVersion: 'th-7' })
  })

  it('reports no grade when no reading carried the element a criterion is written on', () => {
    expect(evaluateHazard({ thresholds: [drought], samples: wind([9.8]), ruleVersion: 'th-7' }).level).toBe('unknown')
  })

  it('grades an empty criteria set as no risk statement at all', () => {
    expect(evaluateHazard({ thresholds: [], samples: wind([30]), ruleVersion: 'th-7' }))
      .toEqual({ level: 'unknown', basis: [], ruleVersion: 'th-7' })
  })
})
