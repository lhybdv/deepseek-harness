/** Existing-session upload and durable tool-result flow for zoning maps. @module */
import type { PromptContentPart } from '@deepseek-ai/dsh-attachment'
import type { Session } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ZoneInterpretation } from '@deepseek-ai/dsh-tool-zone-image'
import type { ZoneImageResult } from './ZoneImagePanel.tsx'

/** Public session surface used by the image-comparison flow. */
export type ZoneImageComparisonSession = Pick<Session, 'prompt' | 'eventSource'>
const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Convert a browser File to the canonical base64 upload content accepted by Session.prompt. @param file - selected image. @returns one existing-session image part. */
async function promptImage(file: File): Promise<PromptContentPart> {
  const mediaType = imageTypes.find(type => type === file.type)
  if (mediaType === undefined) throw new Error('Unsupported zoning image type')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return { type: 'image', mediaType, data: btoa(binary), name: file.name }
}

/** Read the structured comparison payload embedded in the host-generated SVG metadata. @param text - durable tool result text. @returns the validated structured result. */
function resultFromToolText(text: string): ZoneImageResult {
  const start = text.indexOf('<svg')
  if (start < 0) throw new Error('The comparison tool did not return an SVG')
  const svg = text.slice(start)
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (document.querySelector('parsererror') !== null || document.documentElement.localName !== 'svg') throw new Error('The comparison tool returned invalid SVG')
  const metadata = document.getElementById('dsh-zone-image-result')?.textContent
  if (metadata === null || metadata === undefined) throw new Error('The comparison tool returned no structured result')
  const value: unknown = JSON.parse(metadata)
  if (!isZoneImageResult(value)) throw new Error('The comparison tool returned an invalid structured result')
  return { ...value, svg }
}

function isZoneImageResult(value: unknown): value is Omit<ZoneImageResult, 'svg'> {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return Array.isArray(result.images) && result.images.length === 2 && result.images.every(isInterpretation)
    && typeof result.judgment === 'string' && typeof result.changedAreaShare === 'number'
    && Number.isFinite(result.changedAreaShare) && result.changedAreaShare >= 0 && result.changedAreaShare <= 1
}

function isInterpretation(value: unknown): value is ZoneInterpretation {
  if (typeof value !== 'object' || value === null) return false
  const interpretation = value as Record<string, unknown>
  if (typeof interpretation.classification !== 'string' || !interpretation.classification.trim() || typeof interpretation.semantics !== 'string' || !interpretation.semantics.trim() || typeof interpretation.features !== 'object' || interpretation.features === null) return false
  const features = interpretation.features as Record<string, unknown>
  return Array.isArray(features.areaShares) && features.areaShares.every(item => {
    if (typeof item !== 'object' || item === null) return false
    const share = item as Record<string, unknown>
    return typeof share.category === 'string' && typeof share.share === 'number' && Number.isFinite(share.share) && share.share >= 0 && share.share <= 1
  })
    && Array.isArray(features.dominantCategories) && features.dominantCategories.every(item => typeof item === 'string')
    && Array.isArray(features.legend) && features.legend.every(item => {
      if (typeof item !== 'object' || item === null) return false
      const legend = item as Record<string, unknown>
      return typeof legend.category === 'string' && typeof legend.color === 'string' && /^#[\da-f]{6}$/i.test(legend.color)
    })
}

/** Submit two selected maps through the existing session prompt and await its durable comparison tool result. @param files - selected map files. @param session - active client session. @param prompt - localized comparison instruction. @returns model interpretations, statistics, and SVG emitted by the tool. */
export async function runZoneImageComparison(files: readonly [File | null, File | null], session: ZoneImageComparisonSession, prompt: string): Promise<ZoneImageResult | undefined> {
  const [before, after] = files
  if (before === null || after === null) return undefined
  const baselineSeq = Math.max(0, ...session.eventSource.getSnapshot().entries.flatMap(entry => entry.type === 'event' ? [entry.event.seq] : []))
  const [beforePart, afterPart] = await Promise.all([promptImage(before), promptImage(after)])
  const content: PromptContentPart[] = [{ type: 'text', text: prompt }, beforePart, afterPart]
  const { promise, resolve, reject } = Promise.withResolvers<ZoneImageResult | undefined>()
  const calls = new Set<string>()
  let startedTurn: number | undefined
  let settled = false
  const finish = (error?: Error, result?: ZoneImageResult) => {
    if (settled) return
    settled = true
    stop()
    if (error !== undefined) reject(error)
    else resolve(result)
  }
  const inspect = () => {
    for (const entry of session.eventSource.getSnapshot().entries) {
      if (entry.type !== 'event' || entry.event.seq <= baselineSeq) continue
      const event = entry.event
      if (event.type === 'turn/start') startedTurn = event.data.turn
      if (event.type === 'tool/call' && event.data.name === 'meteo_zone_image_compare') calls.add(String(event.data.callId))
      if (event.type === 'tool/result' && calls.has(String(event.data.message.toolCallId))) {
        if (event.data.message.isError === true) return finish(new Error('The zoning comparison tool failed'))
        const text = event.data.message.content.find(part => part.type === 'text')
        if (text?.type !== 'text') return finish(new Error('The zoning comparison tool returned no text result'))
        try { return finish(undefined, resultFromToolText(text.text)) } catch { return finish(new Error('Invalid comparison result')) }
      }
      if (event.type === 'turn/end' && startedTurn === event.data.turn) return finish(new Error('The session turn ended without a zoning comparison result'))
    }
  }
  const stop = session.eventSource.subscribe(inspect)
  void session.prompt(content, 'queue').then(result => {
    if (!result.ok) finish(new Error('The session rejected the zoning comparison prompt'))
    else inspect()
  }).catch(error => finish(error instanceof Error ? error : new Error('The zoning comparison prompt failed')))
  return promise
}
