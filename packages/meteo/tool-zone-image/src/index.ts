/** Host exports for zoning-image difference analysis and tool registration. @module */

import type { Context } from '@deepseek-ai/cordis'
import { applyZoneImageTool } from './tool.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-zone-image'

export const inject = ['tools', 'attachments']
/** Register the model-callable image comparison tool. @param ctx - tool registry context. */
export function apply(ctx: Context): void { applyZoneImageTool(ctx) }

export { compareZones, normalizeRaster } from './diff.ts'
export type { ChangedRegion, ZoneDifference, ZoneRaster } from './diff.ts'
export { validateZoneModelOutput } from './model.ts'
export type { ZoneInterpretation, ZoneModelOutput } from './model.ts'
export { escapeXml, renderZoneComparisonSvg } from './svg.ts'
