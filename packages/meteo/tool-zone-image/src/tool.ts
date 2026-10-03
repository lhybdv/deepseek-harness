/** Cordis registration for the zoning-image comparison tool. @module */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import { compareZones } from './diff.ts'
import type { ZoneRaster } from './diff.ts'
import { validateZoneModelOutput } from './model.ts'
import { escapeXml, renderZoneComparisonSvg } from './svg.ts'

interface ImageRefInput {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

interface ToolArgs {
  before: ZoneRaster & { image: ImageRefInput }
  after: ZoneRaster & { image: ImageRefInput }
  interpretationJson: string
}

/** Register the tool that validates interpretations and returns both images for a follow-up model request. @param ctx - Cordis context with tools and durable attachments. */
export function applyZoneImageTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'meteo_zone_image_compare',
    description: 'Compare two uploaded images of the same type of zoning map. Inspect both images attached in this conversation. For before.image and after.image, copy the attachmentId, mediaType, byte count, dimensions, and name from the image handles shown in the conversation. Supply each image’s categorical raster (row-major labels and source pixel size), plus interpretationJson shaped as {"images":[{"classification":"...","features":{"areaShares":[{"category":"...","share":0.0}],"dominantCategories":["..."],"legend":[{"category":"...","color":"#RRGGBB"}]},"semantics":"..."},{...}]}. Do not invent legend colors. The host validates references and model JSON, compares the categories, then sends both image blocks with the results in the next model request.',
    parameters: {
      before: { type: 'object', required: true, additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, pixelSizeM: { type: 'number', required: true }, categories: { type: 'array', required: true, items: { type: 'string' } }, image: imageSchema } },
      after: { type: 'object', required: true, additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, pixelSizeM: { type: 'number', required: true }, categories: { type: 'array', required: true, items: { type: 'string' } }, image: imageSchema } },
      interpretationJson: { type: 'string', required: true, description: 'JSON with exactly two image interpretations; validated by the host.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { analysis: { type: 'string', required: true }, svg: { type: 'string', required: true }, beforeImage: imageSchema, afterImage: imageSchema } },
      render: (_args, result) => [
        { type: 'text', text: `${result.analysis}\n\n${result.svg}` },
        { type: 'image', attachment: imageRef(result.beforeImage) },
        { type: 'image', attachment: imageRef(result.afterImage) },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args: ToolArgs, exec) {
      await ctx.attachments.readImage(imageRef(args.before.image), exec.signal)
      await ctx.attachments.readImage(imageRef(args.after.image), exec.signal)
      const interpretation = validateZoneModelOutput(args.interpretationJson)
      const diff = compareZones(args.before, args.after)
      const colorMap: Record<string, string> = {}
      for (const image of interpretation.images) for (const item of image.features.legend) colorMap[item.category] = item.color
      const stats = Object.entries(diff.categoryShifts).map(([category, shift]) => `${category}: ${shift > 0 ? '+' : ''}${shift}`).join('；') || '无类别净变化'
      const components = diff.regions.map(region => `区域${region.id}（网格${region.bounds.x},${region.bounds.y}，${region.bounds.width}×${region.bounds.height}，${region.cells}格）：${Object.entries(region.transitions).map(([label, cells]) => `${label} ${cells}格`).join('、')}`).join('；') || '未检出变化区域'
      const analysis = `分类：图像一 ${interpretation.images[0].classification}；图像二 ${interpretation.images[1].classification}\n特征：图像一 ${interpretation.images[0].features.dominantCategories.join('、')}；图像二 ${interpretation.images[1].features.dominantCategories.join('、')}\n语义：图像一 ${interpretation.images[0].semantics}；图像二 ${interpretation.images[1].semantics}\n归一化：最近邻映射到 ${diff.width}×${diff.height} 共同网格，像元 ${diff.pixelSizeM}m（取较粗源分辨率）\n变化面积占比：${(diff.changedAreaShare * 100).toFixed(2)}%\n类别净变化：${stats}\n变化区域研判：${components}`
      const svg = renderZoneComparisonSvg(diff, colorMap)
      const clientResult = escapeXml(JSON.stringify({ images: interpretation.images, judgment: analysis, changedAreaShare: diff.changedAreaShare }))
      const resultSvg = svg.replace(/(<svg\b[^>]*>)/, `$1<metadata id="dsh-zone-image-result">${clientResult}</metadata>`)
      return { analysis, svg: resultSvg, beforeImage: imageRef(args.before.image), afterImage: imageRef(args.after.image) }
    },
  }))
}

const imageSchema = {
  type: 'object',
  required: true,
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
} as const

function imageRef(image: ImageRefInput): ImageAttachmentRef {
  return { ...image, attachmentId: AttachmentId(image.attachmentId) }
}
