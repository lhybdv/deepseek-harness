// @vitest-environment jsdom
/**
 * The `meteo_consult` card: the step trace and its findings, the clarification
 * question, the citation list, and the generic fallback for a result whose
 * metadata is missing, foreign, or unreadable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  MeteoConsultBody, MeteoConsultCard, type MeteoConsultCardProps,
} from '../src/client/MeteoConsultCard.tsx'
import type {
  MeteoCitationMeta, MeteoConsultMeta, MeteoConsultStepMeta, MeteoCriterionMeta, MeteoSeriesRowMeta,
  MeteoSuitabilityDayMeta, MeteoStationMeta,
} from '../src/client/meteo-meta.ts'
import { zh } from '../src/client/locales.ts'
import { ARGS_RAW, preTexts, rowOf, running, sectionOf, settled, t, textOf } from './fixtures.client.ts'

const STATION: MeteoStationMeta = { id: 'st-1', name: '北京站', county: '海淀区', township: '西三旗' }
const CRITERION: MeteoCriterionMeta = {
  disaster: 'drought', element: 'precipitation', op: '<=', value: 2, durationH: 24,
  level: 'high', hoursHeld: 30, firstTime: '2026-09-29T00:00:00Z',
}
const ROW: MeteoSeriesRowMeta = { time: '2026-09-30T00:00:00Z', entries: [{ element: 'precipitation', value: 12 }] }
const DAY: MeteoSuitabilityDayMeta = {
  day: '2026-09-30', crop: '小麦', activity: '打药', verdict: 'suitable', criteria: [CRITERION],
}
const STEP: MeteoConsultStepMeta = { step: 'observation', status: 'done', detail: '读到 1 条', count: 1 }
const CITATION: MeteoCitationMeta = {
  docId: 'doc-1', ordinal: 2, docTitle: '手册', headingPath: '第三章', charStart: 0, charEnd: 10, snippet: '片段',
}

/** One well-formed consultation metadata value, overridable at the top level. */
function meta(over: Partial<MeteoConsultMeta> = {}): MeteoConsultMeta {
  return {
    steps: [STEP],
    results: {
      observation: [ROW], forecast: [ROW], suitability: [DAY], hazard: { level: 'high', basis: [CRITERION] },
    },
    citations: [CITATION],
    truncated: false,
    ...over,
  }
}

const cardProps = (block: ToolCallBlock, inspect?: () => void): MeteoConsultCardProps =>
  ({ block, inspect, t }) as unknown as MeteoConsultCardProps

/** The card's state attribute, or a failure naming the missing card. */
function cardState(container: HTMLElement): string | null {
  const card = container.querySelector('[data-tool="meteo_consult"]')
  if (card === null) throw new Error('expected a consultation card')
  return card.getAttribute('data-state')
}

afterEach(cleanup)

describe('MeteoConsultBody findings', () => {
  it('renders the pipeline trace, the station, the readings, and the citations', () => {
    const view = render(<MeteoConsultBody meta={meta({ resolvedStation: STATION })} t={t} />)
    expect(view.getByText(zh['consult.steps'])).toBeTruthy()
    expect(view.getByText(zh['consult.step.observation'])).toBeTruthy()
    expect(view.getByText(zh['consult.step.status.done'])).toBeTruthy()
    expect(view.getByText('读到 1 条')).toBeTruthy()
    // The step dot carries the outcome: done, attention, or quiet idle.
    expect(view.container.querySelectorAll('[data-state="done"]')).toHaveLength(1)

    expect(sectionOf(view.container, zh['consult.findings.station'])).toBeTruthy()
    expect(textOf(sectionOf(view.container, zh['consult.findings.station']))).toContain('北京站 (st-1) — 海淀区 西三旗')

    expect(view.container.querySelectorAll(`section[aria-label="${zh['consult.findings.observations']}"]`)).toHaveLength(1)
    expect(view.container.querySelectorAll(`section[aria-label="${zh['consult.findings.forecast']}"]`)).toHaveLength(1)
    expect(view.getAllByText('precipitation=12')).toHaveLength(2)
    expect(view.getAllByText('2026-09-30T00:00:00Z')).toHaveLength(2)

    expect(view.getByText(zh['consult.findings.suitability'])).toBeTruthy()
    expect(view.getByText(new RegExp('2026-09-30 · 小麦/打药'))).toBeTruthy()
    expect(view.getByText(zh['consult.verdict.suitable'])).toBeTruthy()
    // The day's criterion fires both under the suitability verdict and as the
    // hazard reading's basis, so each line is asserted inside its own section.
    const suitability = sectionOf(view.container, zh['consult.findings.suitability'])
    expect(within(suitability).getByText(new RegExp('drought precipitation<=2'))).toBeTruthy()

    const hazard = sectionOf(view.container, zh['consult.findings.hazard'])
    expect(within(hazard).getByText('high')).toBeTruthy()
    expect(within(hazard).getByText(new RegExp('drought precipitation<=2'))).toBeTruthy()
    expect(within(hazard).getByText(new RegExp('持续 30 小时，自 2026-09-29T00:00:00Z 起'))).toBeTruthy()

    expect(view.getByText('手册')).toBeTruthy()
    expect(view.getByText(new RegExp('块 2 · 第三章'))).toBeTruthy()
    expect(view.getByText('片段')).toBeTruthy()
    expect(view.queryByText(zh['consult.findings.truncated'])).toBeNull()
    expect(view.queryByText(zh['consult.hazard.none'])).toBeNull()
  })

  it('omits the empty findings sections rather than showing bare headings', () => {
    const view = render(<MeteoConsultBody meta={meta({
      results: {
        observation: [], forecast: [], suitability: [], hazard: { level: 'unknown', basis: [] },
      },
      citations: [],
    })} t={t} />)
    expect(view.queryByText(zh['consult.findings.observations'])).toBeNull()
    expect(view.queryByText(zh['consult.findings.forecast'])).toBeNull()
    expect(view.queryByText(zh['consult.findings.suitability'])).toBeNull()
    expect(view.queryByText(zh['consult.findings.citations'])).toBeNull()
    expect(view.queryByText(zh['consult.findings.station'])).toBeNull()
    // The hazard reading always shows, with the quiet note when nothing held.
    expect(view.getByText(zh['consult.findings.hazard'])).toBeTruthy()
    expect(view.getByText(zh['consult.hazard.none'])).toBeTruthy()
    expect(view.container.querySelector('[data-level="unknown"]')?.textContent).toBe('unknown')
  })

  it('shows the truncation note alone when nothing was retrieved but more may exist', () => {
    const view = render(<MeteoConsultBody meta={meta({ citations: [], truncated: true })} t={t} />)
    expect(view.getByText(zh['consult.findings.citations'])).toBeTruthy()
    expect(view.getByText(zh['consult.findings.truncated'])).toBeTruthy()
  })

  it('keeps a foreign step name, outcome, and verdict verbatim', () => {
    const view = render(<MeteoConsultBody meta={meta({
      steps: [{ step: 'weird-step', status: 'odd-status', detail: '别的', count: 0 }],
      results: {
        observation: [], forecast: [],
        suitability: [{ ...DAY, verdict: 'odd-verdict', criteria: [] }],
        hazard: { level: 'weird-level', basis: [] },
      },
    })} t={t} />)
    expect(view.getByText('weird-step')).toBeTruthy()
    expect(view.getByText('odd-status')).toBeTruthy()
    expect(view.getByText('odd-verdict')).toBeTruthy()
    expect(view.getByText('weird-level')).toBeTruthy()
    expect(view.container.querySelector('[data-verdict="unknown"]')).toBeTruthy()
    expect(view.container.querySelector('[data-level="unknown"]')).toBeTruthy()
    expect(view.container.querySelector('[data-state="idle"]')).toBeTruthy()
  })

  it.each([
    ['unknown', zh['consult.step.status.unknown'], 'warning'],
    ['skipped', zh['consult.step.status.skipped'], 'idle'],
  ])('localizes the %s step outcome and its dot', (status, label, dot) => {
    const view = render(<MeteoConsultBody meta={meta({
      steps: [{ ...STEP, status }], results: { observation: [], forecast: [], suitability: [], hazard: { level: 'medium', basis: [] } },
    })} t={t} />)
    expect(view.getByText(label)).toBeTruthy()
    expect(view.container.querySelector(`[data-state="${dot}"]`)).toBeTruthy()
  })

  it.each([
    ['low', 'low'], ['medium', 'medium'], ['high', 'high'],
  ])('tones a %s hazard reading with its own level', (level, tone) => {
    const view = render(<MeteoConsultBody meta={meta({
      results: {
        observation: [], forecast: [], suitability: [], hazard: { level, basis: [CRITERION] },
      },
    })} t={t} />)
    expect(view.container.querySelector(`[data-level="${tone}"]`)?.textContent).toBe(level)
  })

  it('localizes every verdict and names the chunk of a citation with no heading trail', () => {
    const view = render(<MeteoConsultBody meta={meta({
      results: {
        observation: [], forecast: [],
        suitability: [{ ...DAY, verdict: 'unsuitable' }, { ...DAY, verdict: 'unknown' }],
        hazard: { level: 'high', basis: [] },
      },
      citations: [{ ...CITATION, ordinal: 0, headingPath: '' }],
    })} t={t} />)
    expect(view.getByText(zh['consult.verdict.unsuitable'])).toBeTruthy()
    expect(view.getByText(zh['consult.verdict.unknown'])).toBeTruthy()
    expect(view.getByText(new RegExp(`${zh['consult.citation.chunk'].replace('{n}', '0')}$`))).toBeTruthy()
  })
})

describe('MeteoConsultBody clarification', () => {
  it('asks which station was meant and lists the candidates', () => {
    const view = render(<MeteoConsultBody meta={meta({
      needsClarification: { reason: 'station-ambiguous', candidates: [STATION] },
    })} t={t} />)
    expect(view.getByText(zh['consult.clarification.title'])).toBeTruthy()
    expect(view.getByText(zh['consult.clarification.station-ambiguous'])).toBeTruthy()
    expect(view.getByText(zh['consult.clarification.candidates'])).toBeTruthy()
    expect(textOf(sectionOf(view.container, zh['consult.clarification.title']))).toContain('北京站 (st-1) — 海淀区 西三旗')
    // A consultation that read no data shows no findings beside the question.
    expect(view.queryByText(zh['consult.findings.observations'])).toBeNull()
    expect(view.queryByText(zh['consult.findings.hazard'])).toBeNull()
  })

  it('says the deployment offered no candidates', () => {
    const view = render(<MeteoConsultBody meta={meta({
      needsClarification: { reason: 'station-missing', candidates: [] },
    })} t={t} />)
    expect(view.getByText(zh['consult.clarification.station-missing'])).toBeTruthy()
    expect(view.getByText(zh['consult.clarification.none'])).toBeTruthy()
  })

  it('names the not-found reason the host emits', () => {
    const view = render(<MeteoConsultBody meta={meta({
      needsClarification: { reason: 'station-not-found', candidates: [] },
    })} t={t} />)
    expect(view.getByText(zh['consult.clarification.station-not-found'])).toBeTruthy()
  })
})

describe('MeteoConsultCard lifecycle', () => {
  it('shows a running call with its lifecycle word and no body', () => {
    const view = render(<MeteoConsultCard {...cardProps(running(ARGS_RAW))} />)
    expect(cardState(view.container)).toBe('running')
    expect(view.getByText(zh['consult.running'])).toBeTruthy()
    expect(view.getByText('明天能打药吗')).toBeTruthy()
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('shows a successful call question until the reader expands the trace', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({ meta: meta({ resolvedStation: STATION }) }))} />)
    expect(cardState(view.container)).toBe('ok')
    expect(view.queryByText(zh['consult.running'])).toBeNull()
    expect(view.getByText('明天能打药吗')).toBeTruthy()
    expect(view.queryByText(zh['consult.steps'])).toBeNull()

    fireEvent.click(rowOf(view.container))
    expect(view.getByText(zh['consult.steps'])).toBeTruthy()
    expect(view.getByText(new RegExp('北京站'))).toBeTruthy()

    fireEvent.click(rowOf(view.container))
    expect(view.queryByText(zh['consult.steps'])).toBeNull()
  })

  it('expands on Enter and on Space, and ignores other keys', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({ meta: meta() }))} />)
    fireEvent.keyDown(rowOf(view.container), { key: 'Escape' })
    expect(view.queryByText(zh['consult.steps'])).toBeNull()
    fireEvent.keyDown(rowOf(view.container), { key: 'Enter' })
    expect(view.getByText(zh['consult.steps'])).toBeTruthy()
    fireEvent.keyDown(rowOf(view.container), { key: ' ' })
    expect(view.queryByText(zh['consult.steps'])).toBeNull()
  })

  it('falls back to the generic input and output for unreadable metadata', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({ meta: { steps: 'slots' } }))} />)
    expect(cardState(view.container)).toBe('ok')
    fireEvent.click(rowOf(view.container))
    expect(view.getByText(zh['generic.input'])).toBeTruthy()
    expect(view.getByText(zh['generic.output'])).toBeTruthy()
    expect(preTexts(view.container)).toEqual(['{\n  "question": "明天能打药吗"\n}', '完成'])
  })

  it('shows the failure line as the summary of a failed call', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({
      isError: true, content: [{ type: 'text', text: '读取失败\n更多细节' }],
    }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['consult.failed'])).toBeTruthy()
    expect(view.getByText('读取失败')).toBeTruthy()
    fireEvent.click(rowOf(view.container))
    expect(view.container.querySelector('pre[data-error="true"]')?.textContent).toBe('读取失败\n更多细节')
  })

  it('shows an interrupted call as stopped, with the interruption as its output', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({
      isError: true, error: { name: 'ToolError', code: 'interrupted' }, content: [],
    }))} />)
    expect(cardState(view.container)).toBe('stopped')
    expect(view.getByText(zh['consult.stopped'])).toBeTruthy()
    // A stopped call carries no failure summary; the interruption text lives
    // in the expanded output.
    expect(view.queryByText('ToolError: interrupted')).toBeNull()
    fireEvent.click(rowOf(view.container))
    expect(preTexts(view.container).at(-1)).toBe('ToolError: interrupted')
  })

  it('carries no body when there is nothing to show', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({ call: null, content: [] }))} />)
    expect(cardState(view.container)).toBe('ok')
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('leaves the summary blank when a failure carried no readable text', () => {
    const view = render(<MeteoConsultCard {...cardProps(settled({ isError: true, content: [] }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['consult.failed'])).toBeTruthy()
    expect(rowOf(view.container).lastElementChild?.textContent).toBe('')
  })

  it('offers the inspect handle only when the owner supplied one', () => {
    const inspect = vi.fn()
    const expanded = render(<MeteoConsultCard {...cardProps(settled({ meta: meta() }), inspect)} />)
    fireEvent.click(rowOf(expanded.container))
    fireEvent.click(expanded.getByRole('button', { name: zh['card.inspect'] }))
    expect(inspect).toHaveBeenCalledTimes(1)
    cleanup()

    const bare = render(<MeteoConsultCard {...cardProps(settled({ meta: meta() }))} />)
    fireEvent.click(rowOf(bare.container))
    expect(bare.queryByRole('button', { name: zh['card.inspect'] })).toBeNull()
  })
})
