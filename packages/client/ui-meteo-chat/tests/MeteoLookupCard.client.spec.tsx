// @vitest-environment jsdom
/**
 * The `meteo_station_lookup` card: the candidate list a clarification offers,
 * its count or empty summary, and the generic fallback for a result whose
 * metadata is missing or foreign.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MeteoLookupCard, type MeteoLookupCardProps } from '../src/client/MeteoLookupCard.tsx'
import type { MeteoLookupStationMeta } from '../src/client/meteo-meta.ts'
import { zh } from '../src/client/locales.ts'
import { preTexts, rowOf, running, sectionOf, settled, t, textOf } from './fixtures.client.ts'

const STATION: MeteoLookupStationMeta = {
  id: 'st-1', name: '北京站', county: '海淀区', township: '西三旗', lon: 116.4, lat: 39.9, altitudeM: 44,
}
const OTHER: MeteoLookupStationMeta = { ...STATION, id: 'st-2', name: '天津站' }

const cardProps = (block: ToolCallBlock, inspect?: () => void): MeteoLookupCardProps =>
  ({ block, inspect, t }) as unknown as MeteoLookupCardProps

/** The card's state attribute, or a failure naming the missing card. */
function cardState(container: HTMLElement): string | null {
  const card = container.querySelector('[data-tool="meteo_station_lookup"]')
  if (card === null) throw new Error('expected a station lookup card')
  return card.getAttribute('data-state')
}

afterEach(cleanup)

describe('MeteoLookupCard candidates', () => {
  it('counts the candidates and lists each identity with its coordinates', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: [STATION, OTHER] } }))} />)
    expect(cardState(view.container)).toBe('ok')
    expect(view.getByText(t('lookup.count', { n: '2' }))).toBeTruthy()

    fireEvent.click(rowOf(view.container))
    expect(textOf(sectionOf(view.container, zh['lookup.title']))).toContain('北京站 (st-1) — 海淀区 西三旗 · 116.4/39.9 · 海拔 44 米')
    expect(view.getByText(new RegExp('天津站'))).toBeTruthy()
  })

  it('says no station matched, and shows an empty list rather than the fallback', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: [] } }))} />)
    expect(view.getByText(zh['lookup.none'])).toBeTruthy()
    fireEvent.click(rowOf(view.container))
    expect(view.getByText(zh['lookup.title'])).toBeTruthy()
    expect(view.queryByText(zh['generic.input'])).toBeNull()
  })

  it('expands on Space and collapses again', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: [STATION] } }))} />)
    fireEvent.keyDown(rowOf(view.container), { key: ' ' })
    expect(view.getByText(new RegExp('北京站'))).toBeTruthy()
    fireEvent.keyDown(rowOf(view.container), { key: 'Enter' })
    expect(view.queryByText(new RegExp('北京站'))).toBeNull()
  })
})

describe('MeteoLookupCard fallback and lifecycle', () => {
  it('stays a bare running row until the call settles', () => {
    const view = render(<MeteoLookupCard {...cardProps(running('{"name":"北京"}'))} />)
    expect(cardState(view.container)).toBe('running')
    expect(view.getByText(zh['lookup.running'])).toBeTruthy()
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('falls back to the generic body when the metadata is unreadable', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: 'st-1' } }))} />)
    expect(view.queryByText(zh['lookup.none'])).toBeNull()
    fireEvent.click(rowOf(view.container))
    expect(view.getByText(zh['generic.input'])).toBeTruthy()
    expect(preTexts(view.container)).toEqual(['{\n  "question": "明天能打药吗"\n}', '完成'])
  })

  it('summarizes a failure by its first line, keeping the generic error body', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({
      isError: true, content: [{ type: 'text', text: '查询失败\n细节' }],
    }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['lookup.failed'])).toBeTruthy()
    expect(view.getByText('查询失败')).toBeTruthy()
    fireEvent.click(rowOf(view.container))
    expect(view.container.querySelector('pre[data-error="true"]')?.textContent).toBe('查询失败\n细节')
  })

  it('shows an interrupted lookup as stopped and offers no body for a blank failure', () => {
    const stopped = render(<MeteoLookupCard {...cardProps(settled({
      isError: true, error: { name: 'ToolError', code: 'interrupted' }, content: [],
    }))} />)
    expect(cardState(stopped.container)).toBe('stopped')
    expect(stopped.getByText(zh['lookup.stopped'])).toBeTruthy()

    const blank = render(<MeteoLookupCard {...cardProps(settled({ call: null, content: [] }))} />)
    expect(blank.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('leaves the summary blank when a failure carried no readable text', () => {
    const view = render(<MeteoLookupCard {...cardProps(settled({ isError: true, content: [] }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['lookup.failed'])).toBeTruthy()
    expect(rowOf(view.container).lastElementChild?.textContent).toBe('')
  })

  it('offers the inspect handle only when the owner supplied one', () => {
    const inspect = vi.fn()
    const expanded = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: [STATION] } }), inspect)} />)
    fireEvent.click(rowOf(expanded.container))
    fireEvent.click(expanded.getByRole('button', { name: zh['card.inspect'] }))
    expect(inspect).toHaveBeenCalledTimes(1)
    cleanup()

    const bare = render(<MeteoLookupCard {...cardProps(settled({ meta: { stations: [STATION] } }))} />)
    fireEvent.click(rowOf(bare.container))
    expect(bare.queryByRole('button', { name: zh['card.inspect'] })).toBeNull()
  })
})
