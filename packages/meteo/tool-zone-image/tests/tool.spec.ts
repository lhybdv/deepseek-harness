import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as ZoneImage from '../src/index.ts'

const limits: ImageAttachmentLimits = { maxImageBytes: 100, maxImagesPerMessage: 2, maxMessageImageBytes: 200, maxImagePixels: 100, maxImageDimension: 100, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }
const ref = (suffix: string): ImageAttachmentRef => ({ attachmentId: AttachmentId(`sha256:${suffix.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: `${suffix}.png` })
class TestAttachments extends AttachmentStore {
  readonly imageLimits = limits
  async validateImage(_input: SaveImageAttachment): Promise<void> {}
  async saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> { return ref('a') }
  async readImage(image: ImageAttachmentRef): Promise<StoredImageAttachment> { return { ref: image, data: new Uint8Array([1]) } }
}
const interpretation = { classification: '土地利用', features: { areaShares: [{ category: '耕地', share: 1 }], dominantCategories: ['耕地'], legend: [{ category: '耕地', color: '#00aa00' }] }, semantics: '农业用途' }

describe('meteo_zone_image_compare host tool', () => {
  it('returns statistics and SVG plus both durable image blocks to the next model request', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TestAttachments)
    await ctx.plugin(ZoneImage)
    const imageA = ref('a'), imageB = ref('b')
    const args = {
      before: { width: 2, height: 1, pixelSizeM: 10, categories: ['耕地', '耕地'], image: imageA },
      after: { width: 2, height: 1, pixelSizeM: 10, categories: ['耕地', '建设用地'], image: imageB },
      interpretationJson: JSON.stringify({ images: [interpretation, interpretation] }),
    }
    expect(ctx.tools.get('meteo_zone_image_compare')?.isConcurrencySafe?.(args)).toBe(true)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('zone-test'),
      name: 'meteo_zone_image_compare',
      arguments: args,
    })
    expect(result.content.filter(block => block.type === 'image')).toEqual([
      { type: 'image', attachment: imageA }, { type: 'image', attachment: imageB },
    ])
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('变化面积占比：50.00%') })
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('<svg') })
    const unchanged = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('zone-unchanged'),
      name: 'meteo_zone_image_compare',
      arguments: { ...args, after: { ...args.after, categories: ['耕地', '耕地'] } },
    })
    expect(unchanged.content[0]).toMatchObject({ text: expect.stringContaining('无类别净变化') })
    expect(unchanged.content[0]).toMatchObject({ text: expect.stringContaining('未检出变化区域') })
  })
})
