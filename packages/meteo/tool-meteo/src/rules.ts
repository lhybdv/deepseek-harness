/**
 * The consultation's rule engine: a pure, total evaluation of published crop
 * windows and published disaster criteria against a published reading series.
 *
 * The engine reads nothing and writes nothing. It takes the records the data
 * seam already answered with, plus the caller's own filters, and answers three
 * questions and no others: did a criterion hold, for how long, and starting
 * when. Every judgement it can make is auditable from the numbers it returns,
 * and every judgement it cannot make is reported as `unknown` rather than
 * guessed: a criterion whose element the series never carries is unverifiable,
 * a window whose criteria the deployment no longer publishes has nothing to be
 * judged by, and a series in which no criterion held supports no disaster grade
 * at all.
 *
 * The input contract is the data seam's: every `time` is an ISO-8601 instant and
 * every element value is a number, so the engine neither re-validates nor
 * substitutes a value for a reading it cannot parse.
 *
 * @module @deepseek-ai/dsh-tool-meteo/rules
 */

import type { CropWindow, Threshold } from '@deepseek-ai/dsh-meteo-data'

/** Milliseconds in one hour: the unit every published duration and span counts in. */
const MILLIS_PER_HOUR = 3_600_000

/** How severe one graded criterion is, used to pick the strongest one that held. */
const LEVEL_RANK: Readonly<Record<Threshold['level'], number>> = { low: 1, medium: 2, high: 3 }

/** Whether one day is fit for the activity a crop window describes. */
export type Verdict = 'suitable' | 'unsuitable' | 'unknown'

/** Disaster grade a series supports; `unknown` when no published criterion held. */
export type HazardLevel = 'low' | 'medium' | 'high' | 'unknown'

/** One reading the engine may judge: an instant and the elements reported at it. */
export interface RuleSample {
  /** ISO-8601 instant of the reading, as the seam published it. */
  readonly time: string
  /** Reported elements keyed by stable ASCII name, e.g. `temperature`. */
  readonly elements: Readonly<Record<string, number>>
}

/** One criterion that held, with the span it held for and where that span began. */
export interface FiredCriterion {
  /** Disaster the criterion belongs to, quoted from the published record. */
  readonly disaster: string
  /** Element the criterion reads, quoted from the published record. */
  readonly element: string
  /** Comparison the criterion ran. */
  readonly op: '>=' | '<='
  /** Value the comparison ran against. */
  readonly value: number
  /** Hours the criterion required the condition to hold. */
  readonly durationH: number
  /** Grade the criterion carries when it counts. */
  readonly level: 'low' | 'medium' | 'high'
  /** Hours between the first and the last consecutive reading that met it. */
  readonly hoursHeld: number
  /** Instant of the first reading of that run, the span's opening edge. */
  readonly firstTime: string
}

/** One published activity window judged for one day the series covers. */
export interface DaySuitability {
  /** Calendar date as written in the readings themselves, `YYYY-MM-DD`. */
  readonly day: string
  /** Crop the judged window belongs to. */
  readonly crop: string
  /** Activity the judged window describes. */
  readonly activity: string
  /** Whether the day is fit for that activity on the evidence available. */
  readonly verdict: Verdict
  /** Criteria that held, in published order; empty unless the verdict is `unsuitable`. */
  criteria: FiredCriterion[]
}

/** The disaster reading for one series. */
export interface HazardFinding {
  /** Strongest grade among the criteria that held, or `unknown` when none did. */
  readonly level: HazardLevel
  /** Every criterion that held, in published order; empty when the level is `unknown`. */
  basis: FiredCriterion[]
  /** Revision of the criteria dataset the caller evaluated, echoed for citation. */
  readonly ruleVersion: string
}

/** Records the suitability evaluation reads: windows, in-force criteria, readings. */
export interface SuitabilityInput {
  /** Activity windows to judge, in published order. */
  readonly windows: readonly CropWindow[]
  /** Criteria the deployment currently publishes; a window criterion outside this set is unverifiable. */
  readonly criteria: readonly Threshold[]
  /** Readings to judge the windows against, in any order. */
  readonly samples: readonly RuleSample[]
}

/** Records the hazard evaluation reads: criteria, readings, and their revision. */
export interface HazardInput {
  /** Graded criteria to test, in published order. */
  readonly thresholds: readonly Threshold[]
  /** Readings to test them against, in any order. */
  readonly samples: readonly RuleSample[]
  /** Revision of the criteria dataset the caller read, echoed into the finding. */
  readonly ruleVersion: string
}

/**
 * Identity of one criterion across datasets: the calendar embeds criteria and
 * the thresholds dataset publishes them, so two records are the same rule only
 * when every field that decides an outcome agrees.
 * @param criterion - the criterion to key.
 * @returns a key no two different rules can share.
 */
function criterionKey(criterion: Threshold): string {
  return `${criterion.disaster}|${criterion.element}|${criterion.op}|${criterion.value}|${criterion.durationH}|${criterion.level}`
}

/**
 * Longest run of consecutive readings that all met one criterion.
 *
 * Readings are judged in instant order. A reading that does not carry the
 * element is skipped rather than counted: it neither continues nor breaks the
 * run. A reading that carries the element and fails the comparison ends the run,
 * and the next reading that meets it opens a new one. The span is elapsed time
 * between the first and the last reading of the longest run, so a run of one
 * reading spans zero hours and only a criterion that asks for no duration at all
 * can be met by it.
 * @param samples - readings in any order.
 * @param criterion - the criterion to test.
 * @returns the longest span and where it began, or `undefined` when no reading
 *   in the series carried the element at all.
 */
function longestHold(samples: readonly RuleSample[], criterion: Threshold): { hoursHeld: number; firstTime: string } | undefined {
  const ascending = [...samples].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  let bestHours = -1
  let bestStart = ''
  let runStart = 0
  let runStartTime = ''
  for (const sample of ascending) {
    const value = sample.elements[criterion.element]
    if (value === undefined) continue
    const instant = Date.parse(sample.time)
    if (criterion.op === '>=' ? value >= criterion.value : value <= criterion.value) {
      if (runStartTime === '') {
        runStart = instant
        runStartTime = sample.time
      }
      const hours = (instant - runStart) / MILLIS_PER_HOUR
      if (hours > bestHours) {
        bestHours = hours
        bestStart = runStartTime
      }
    } else {
      runStartTime = ''
    }
  }
  return bestHours < 0 ? undefined : { hoursHeld: bestHours, firstTime: bestStart }
}

/**
 * Test one criterion against one series.
 * @param criterion - the criterion to test.
 * @param samples - readings to test it against.
 * @returns the fired record when the condition held at least as long as the
 *   criterion demands, else `undefined`.
 */
function fireCriterion(criterion: Threshold, samples: readonly RuleSample[]): FiredCriterion | undefined {
  const hold = longestHold(samples, criterion)
  if (hold === undefined || hold.hoursHeld < criterion.durationH) return undefined
  return {
    disaster: criterion.disaster,
    element: criterion.element,
    op: criterion.op,
    value: criterion.value,
    durationH: criterion.durationH,
    level: criterion.level,
    hoursHeld: hold.hoursHeld,
    firstTime: hold.firstTime,
  }
}

/**
 * Keep the criteria that survived the filter.
 * @param criterion - a fired criterion, or nothing.
 * @returns whether the criterion is present.
 */
function isFired(criterion: FiredCriterion | undefined): criterion is FiredCriterion {
  return criterion !== undefined
}

/**
 * Whether an annual window covers one calendar date.
 *
 * A window is annual and inclusive at both ends. A window whose end precedes its
 * start wraps the year — `12-15` to `02-20` is the overwintering period — so it
 * covers the dates from its start to year end and from year start to its end.
 * @param window - the activity window to test.
 * @param day - calendar date as `YYYY-MM-DD`.
 * @returns whether that date falls inside the annual window.
 */
function coversDay(window: CropWindow, day: string): boolean {
  const monthDay = day.slice(5)
  return window.windowStart <= window.windowEnd
    ? monthDay >= window.windowStart && monthDay <= window.windowEnd
    : monthDay >= window.windowStart || monthDay <= window.windowEnd
}

/**
 * Judge every published activity window against every day the series covers.
 *
 * The output has one record per (day, window) pair whose annual window covers
 * that day, ordered by day and then in published window order; a day outside
 * every window is not a judgement about that window and produces no record. A day
 * is `unsuitable` when one of its window's in-force criteria held, `suitable`
 * when none held and every in-force criterion was verifiable on that day's
 * readings, and `unknown` when the window has no in-force criterion or the
 * readings left one unverifiable.
 * @param input - the windows to judge, the criteria in force, and the readings.
 * @returns the judgements, oldest day first; empty when nothing is judgeable.
 */
export function evaluateSuitability(input: SuitabilityInput): DaySuitability[] {
  const ascending = [...input.samples].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  const published = new Set(input.criteria.map(criterionKey))
  const days = [...new Set(ascending.map(sample => sample.time.slice(0, 10)))]
  const judgements: DaySuitability[] = []
  for (const day of days) {
    const daySamples = ascending.filter(sample => sample.time.slice(0, 10) === day)
    for (const window of input.windows) {
      if (!coversDay(window, day)) continue
      const inForce = window.criteria.filter(criterion => published.has(criterionKey(criterion)))
      const criteria = inForce.map(criterion => fireCriterion(criterion, daySamples)).filter(isFired)
      const verdict: Verdict = criteria.length > 0
        ? 'unsuitable'
        : inForce.length > 0
          && inForce.every(criterion => daySamples.some(sample => sample.elements[criterion.element] !== undefined))
          ? 'suitable'
          : 'unknown'
      judgements.push({ day, crop: window.crop, activity: window.activity, verdict, criteria })
    }
  }
  return judgements
}

/**
 * Grade the disaster risk one series carries.
 *
 * Every published criterion is tested against the whole series, and the finding
 * reports each one that held so a reader can audit the grade. The level is the
 * strongest grade among them; no criterion holding means no grade at all, because
 * a series that never met a published threshold does not support a risk statement.
 * @param input - the criteria to test, the readings, and their revision.
 * @returns the grade, its basis, and the revision it was graded against.
 */
export function evaluateHazard(input: HazardInput): HazardFinding {
  const basis = input.thresholds.map(threshold => fireCriterion(threshold, input.samples)).filter(isFired)
  if (basis.length === 0) return { level: 'unknown', basis: [], ruleVersion: input.ruleVersion }
  const strongest = basis.reduce((best, criterion) => LEVEL_RANK[criterion.level] > LEVEL_RANK[best.level] ? criterion : best)
  return { level: strongest.level, basis, ruleVersion: input.ruleVersion }
}
