// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react'
import { LlmAttemptId, ToolCallId, createMessage } from '@deepseek-ai/dsh-llm'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it, vi } from 'vitest'
import { en, NS, runZoneImageComparison, ZoneImagePanel, zh } from '../src/client/index.ts'
import type { ZoneImageComparisonSession, ZoneImageResult } from '../src/client/index.ts'
import { escapeXml } from '@deepseek-ai/dsh-tool-zone-image'

const interpretations = [0, 1].map(index => ({ classification: `土地利用${index + 1}`, features: { areaShares: [{ category: '耕地', share: 0.65 }], dominantCategories: ['耕地'], legend: [{ category: '耕地', color: '#00aa00' }] }, semantics: `图像语义${index + 1}` })) as ZoneImageResult['images']
const result: ZoneImageResult = {
  images: interpretations,
  judgment: '区域1建设用地增加，变化面积占比 25%',
  changedAreaShare: 0.25,
  svg: '',
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="dsh-zone-image-result">${escapeXml(JSON.stringify({ images: interpretations, judgment: result.judgment, changedAreaShare: result.changedAreaShare }))}</metadata><text>变化对比图</text></svg>`
result.svg = svg

function scriptedSession(toolText: string, options: { toolError?: boolean; noText?: boolean; withoutResult?: boolean; reject?: unknown } = {}) {
  const eventSource = new MutableSessionEventSource()
  const callId = ToolCallId('zone-call')
  const content = options.noText ? [] : [{ type: 'text' as const, text: toolText }]
  const message = createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content, ...(options.toolError === true ? { isError: true as const } : {}) })
  const event = (type: string, data: object, seq: number): SessionEventLikeEntry => ({
    type: 'event',
    event: { type, seq: seq as SessionEventLikeEntry['event']['seq'], time: 1, data } as SessionEventLikeEntry['event'],
  })
  const prompt = vi.fn(async (_content: Parameters<ZoneImageComparisonSession['prompt']>[0]) => {
    if (options.reject !== undefined) throw options.reject
    const entries = [event('turn/start', { turn: 0 }, 0), event('turn/start', { turn: 1 }, 1), event('tool/call', { turn: 1, step: 1, callId, name: 'meteo_zone_image_compare', arguments: '{}' }, 2)]
    if (options.withoutResult !== true) entries.push(event('tool/result', { turn: 1, step: 1, message }, 3))
    if (options.withoutResult === true) entries.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    eventSource.replace([transient, ...entries], false)
    return { ok: true as const, value: { accepted: true as const } }
  })
  const transient: SessionEventLikeEntry = { type: 'transient', event: { type: 'assistant/live-chunk', seq: 0 as SessionEventLikeEntry['event']['seq'], time: 1, data: { attemptId: LlmAttemptId('attempt'), turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '' } } } }
  eventSource.replace([transient, event('turn/start', { turn: 0 }, 0)], false)
  return { session: { prompt, eventSource } as ZoneImageComparisonSession, prompt }
}

describe('ZoneImagePanel session flow', () => {
  it('exports matching English and Chinese locale keys', () => {
    expect(NS).toBe('meteo-zone-image')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('does not prompt until both files exist', async () => {
    const { session, prompt } = scriptedSession('unused')
    const one = new File(['one'], 'one.png', { type: 'image/png' })
    await expect(runZoneImageComparison([null, null], session, 'compare')).resolves.toBeUndefined()
    await expect(runZoneImageComparison([one, null], session, 'compare')).resolves.toBeUndefined()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('submits both base64 images and reads the durable tool result', async () => {
    const { session, prompt } = scriptedSession(`analysis\n\n${svg}`)
    const before = new File(['before'], 'before.png', { type: 'image/png' })
    const after = new File(['after'], 'after.png', { type: 'image/png' })
    await expect(runZoneImageComparison([before, after], session, 'compare these maps')).resolves.toEqual(result)
    const [content, mode] = prompt.mock.calls[0]!
    expect(mode).toBe('queue')
    expect(content).toEqual([
      { type: 'text', text: 'compare these maps' },
      { type: 'image', mediaType: 'image/png', data: 'YmVmb3Jl', name: 'before.png' },
      { type: 'image', mediaType: 'image/png', data: 'YWZ0ZXI=', name: 'after.png' },
    ])
  })

  it('rejects unsupported uploads and failed durable tool results', async () => {
    const { session } = scriptedSession('unused')
    await expect(runZoneImageComparison([new File(['a'], 'a.bmp', { type: 'image/bmp' }), new File(['b'], 'b.png', { type: 'image/png' })], session, 'compare')).rejects.toThrow('Unsupported zoning image type')
    const { session: failed } = scriptedSession('tool failed', { toolError: true })
    await expect(runZoneImageComparison([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })], failed, 'compare')).rejects.toThrow('tool failed')
  })
  it('refuses malformed SVG, absent or invalid metadata, malformed tool content, and completed turns without results', async () => {
    const files: [File, File] = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]
    const base = { images: interpretations, judgment: result.judgment, changedAreaShare: result.changedAreaShare }
    const svgFor = (value: unknown) => `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="dsh-zone-image-result">${escapeXml(JSON.stringify(value))}</metadata></svg>`
    const malformedInterpretations: unknown[] = [
      null,
      { ...base, images: [null, null] },
      { ...base, images: [] },
      { ...base, images: [{ ...interpretations[0], features: null }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: null, dominantCategories: [], legend: [] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [null], dominantCategories: [], legend: [] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [{ category: 'x', share: 1.1 }], dominantCategories: [], legend: [] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [], dominantCategories: null, legend: [] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [], dominantCategories: [1], legend: [] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [], dominantCategories: [], legend: null } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [], dominantCategories: [], legend: [null] } }, interpretations[1]] },
      { ...base, images: [{ ...interpretations[0], features: { areaShares: [], dominantCategories: [], legend: [{ category: 'x', color: 'bad' }] } }, interpretations[1]] },
      { ...base, changedAreaShare: 2 },
    ]
    const toolTexts = ['no svg', '<svg><', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="dsh-zone-image-result">{</metadata></svg>', ...malformedInterpretations.map(svgFor)]
    for (const text of toolTexts) {
      const { session } = scriptedSession(text)
      await expect(runZoneImageComparison(files, session, 'compare')).rejects.toThrow()
    }
    const { session: noContent } = scriptedSession('', { noText: true })
    await expect(runZoneImageComparison(files, noContent, 'compare')).rejects.toThrow('no text result')
    const { session: noResult } = scriptedSession('', { withoutResult: true })
    await expect(runZoneImageComparison(files, noResult, 'compare')).rejects.toThrow('without a zoning comparison result')
    const { session: rejected } = scriptedSession('', { reject: 'network failure' })
    await expect(runZoneImageComparison(files, rejected, 'compare')).rejects.toThrow('prompt failed')
    const notAccepted = { eventSource: new MutableSessionEventSource(), prompt: vi.fn().mockResolvedValue({ ok: false, error: {} }) } as ZoneImageComparisonSession
    await expect(runZoneImageComparison(files, notAccepted, 'compare')).rejects.toThrow('rejected the zoning comparison prompt')
  })

  it('submits files from the panel and renders structured interpretations, assessment, and SVG', async () => {
    const { session, prompt } = scriptedSession(`analysis\n\n${svg}`)
    const { container } = render(<ZoneImagePanel t={key => key} session={session} />)
    const inputs = container.querySelectorAll('input[type="file"]')
    fireEvent.change(inputs[0]!, { target: { files: [new File(['image-one'], 'before.png', { type: 'image/png' })] } })
    fireEvent.change(inputs[1]!, { target: { files: [new File(['image-two'], 'after.png', { type: 'image/png' })] } })
    fireEvent.click(within(container).getByRole('button', { name: 'compare' }))
    expect(await within(container).findByText('土地利用1')).toBeTruthy()
    expect(within(container).getByText('图像语义2')).toBeTruthy()
    expect(within(container).getByText(/区域1建设用地增加/)).toBeTruthy()
    expect(within(container).getByRole('img', { name: 'svg' }).getAttribute('src')).toContain(encodeURIComponent('<svg'))
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('keeps the submit button disabled when an upload is cleared and exposes prompt failures', async () => {
    const broken = scriptedSession('unused').session
    const failing = { ...broken, prompt: vi.fn().mockRejectedValue(new Error('prompt failed')) } as ZoneImageComparisonSession
    const { container } = render(<ZoneImagePanel t={key => key} session={failing} />)
    const input = container.querySelector('input[type="file"]')
    fireEvent.change(input!, { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } })
    fireEvent.change(input!, { target: { files: null } })
    expect(within(container).getByRole('button', { name: 'compare' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(input!, { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } })
    const second = container.querySelectorAll('input[type="file"]')[1]!
    fireEvent.change(second, { target: { files: [new File(['y'], 'y.png', { type: 'image/png' })] } })
    fireEvent.click(within(container).getByRole('button', { name: 'compare' }))
    expect(await within(container).findByRole('alert')).toBeTruthy()
  })
})
