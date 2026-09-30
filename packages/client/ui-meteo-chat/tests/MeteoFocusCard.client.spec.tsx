// @vitest-environment jsdom
/**
 * The `meteo_set_focus` card: the place and crop the session committed to,
 * read straight from the logged call head, and the explicit report when that
 * head is no longer in the window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MeteoFocusCard, focusSummary, type MeteoFocusCardProps } from '../src/client/MeteoFocusCard.tsx'
import type { MeteoFocusModel } from '../src/client/meteo-card-model.ts'
import { zh } from '../src/client/locales.ts'
import { preTexts, rowOf, running, settled, t } from './fixtures.client.ts'

const cardProps = (block: ToolCallBlock, inspect?: () => void): MeteoFocusCardProps =>
  ({ block, inspect, t }) as unknown as MeteoFocusCardProps

/** One derived focus model with the two slots named as given. */
function model(stationId: string | null, crop: string | null): MeteoFocusModel {
  return { state: 'ok', stationId, crop, headReadable: true, output: '已记录', errorSummary: null }
}

/** The card's state attribute, or a failure naming the missing card. */
function cardState(container: HTMLElement): string | null {
  const card = container.querySelector('[data-tool="meteo_set_focus"]')
  if (card === null) throw new Error('expected a session focus card')
  return card.getAttribute('data-state')
}

afterEach(cleanup)

describe('focusSummary', () => {
  it('names both slots when the call carried both', () => {
    expect(focusSummary(model('st-1', '小麦'), t)).toBe(t('focus.both', { station: 'st-1', crop: '小麦' }))
  })

  it('names the station alone and the crop alone', () => {
    expect(focusSummary(model('st-1', null), t)).toBe(t('focus.stationOnly', { station: 'st-1' }))
    expect(focusSummary(model(null, '小麦'), t)).toBe(t('focus.cropOnly', { crop: '小麦' }))
  })

  it('reads a call naming neither slot as a released focus', () => {
    expect(focusSummary(model(null, null), t)).toBe(zh['focus.released'])
  })
})

describe('MeteoFocusCard', () => {
  it('summarizes the written focus from the call head', () => {
    const view = render(<MeteoFocusCard {...cardProps(settled({
      call: { name: 'meteo_set_focus', argsRaw: '{"stationId":"st-1","crop":"小麦"}' },
    }))} />)
    expect(cardState(view.container)).toBe('ok')
    expect(view.getByText(t('focus.both', { station: 'st-1', crop: '小麦' }))).toBeTruthy()
    fireEvent.click(rowOf(view.container))
    expect(view.getByText(zh['generic.input'])).toBeTruthy()
    expect(preTexts(view.container)).toEqual(['{\n  "stationId": "st-1",\n  "crop": "小麦"\n}', '完成'])
  })

  it.each([
    ['{"stationId":"st-1"}', t('focus.stationOnly', { station: 'st-1' })],
    ['{"crop":"小麦"}', t('focus.cropOnly', { crop: '小麦' })],
    ['{}', zh['focus.released']],
  ])('summarizes the focus named by %s as an explicit line', (argsRaw, summary) => {
    const view = render(<MeteoFocusCard {...cardProps(settled({ call: { name: 'meteo_set_focus', argsRaw } }))} />)
    expect(view.getByText(summary)).toBeTruthy()
  })

  it('reports a call head the window no longer carries instead of an empty focus', () => {
    const view = render(<MeteoFocusCard {...cardProps(settled({ call: null, content: [] }))} />)
    expect(cardState(view.container)).toBe('ok')
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
    expect(view.getByText(zh['focus.title'])).toBeTruthy()
    expect(view.queryByText(zh['focus.released'])).toBeNull()
  })

  it('stays a bare running row until the call settles', () => {
    const view = render(<MeteoFocusCard {...cardProps(running('{"stationId":"st-1"}'))} />)
    expect(cardState(view.container)).toBe('running')
    expect(view.getByText(zh['focus.running'])).toBeTruthy()
    expect(view.getByText(t('focus.stationOnly', { station: 'st-1' }))).toBeTruthy()
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('summarizes a failure by its first line', () => {
    const view = render(<MeteoFocusCard {...cardProps(settled({
      call: { name: 'meteo_set_focus', argsRaw: '{"stationId":"st-1"}' },
      isError: true,
      content: [{ type: 'text', text: '写入失败\n细节' }],
    }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['focus.failed'])).toBeTruthy()
    expect(view.getByText('写入失败')).toBeTruthy()
  })

  it('shows an interrupted write as stopped', () => {
    const view = render(<MeteoFocusCard {...cardProps(settled({
      isError: true, error: { name: 'ToolError', code: 'interrupted' }, content: [],
    }))} />)
    expect(cardState(view.container)).toBe('stopped')
    expect(view.getByText(zh['focus.stopped'])).toBeTruthy()
  })

  it('leaves the summary blank when a failure carried no readable text', () => {
    const view = render(<MeteoFocusCard {...cardProps(settled({ isError: true, content: [] }))} />)
    expect(cardState(view.container)).toBe('error')
    expect(view.getByText(zh['focus.failed'])).toBeTruthy()
    expect(rowOf(view.container).lastElementChild?.textContent).toBe('')
  })

  it('offers the inspect handle only when the owner supplied one', () => {
    const inspect = vi.fn()
    const block = settled({ call: { name: 'meteo_set_focus', argsRaw: '{"crop":"小麦"}' } })
    const expanded = render(<MeteoFocusCard {...cardProps(block, inspect)} />)
    fireEvent.click(rowOf(expanded.container))
    fireEvent.click(expanded.getByRole('button', { name: zh['card.inspect'] }))
    expect(inspect).toHaveBeenCalledTimes(1)
    cleanup()

    const bare = render(<MeteoFocusCard {...cardProps(block)} />)
    fireEvent.click(rowOf(bare.container))
    expect(bare.queryByRole('button', { name: zh['card.inspect'] })).toBeNull()
  })
})
