/** Render an accessible, self-contained SVG comparison of two zoning grids. @module */

import type { ZoneDifference } from './diff.ts'

/** Escape untrusted text before placing it in SVG markup. @param value - source text. @returns XML-escaped text. */
export function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

/** Create a side-by-side SVG with changed cells outlined, legend, component summaries, and area statistics. @param diff - calculated zonal difference. @param colors - category-to-color mapping. @returns standalone SVG markup. */
export function renderZoneComparisonSvg(diff: ZoneDifference, colors: Readonly<Record<string, string>>): string {
  const cell = Math.max(2, Math.min(12, Math.floor(480 / Math.max(diff.width, diff.height))))
  const panelWidth = diff.width * cell
  const panelHeight = diff.height * cell
  const legend = Object.entries(colors).map(([name, color], index) => `<g transform="translate(${index * 150},0)"><rect width="14" height="14" fill="${escapeXml(color)}"/><text x="20" y="12">${escapeXml(name)}</text></g>`).join('')
  const panel = (data: readonly (string | null)[], xOffset: number, title: string) => {
    const tiles = data.map((category, index) => {
      const x = index % diff.width * cell, y = Math.floor(index / diff.width) * cell
      const color = category === null ? '#eeeeee' : colors[category] ?? '#888888'
      const changed = diff.before[index] !== diff.after[index]
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${escapeXml(color)}"${changed ? ' stroke="#d62728" stroke-width="1.5"' : ''}/>`
    }).join('')
    return `<g transform="translate(${xOffset},26)"><text x="0" y="-8">${escapeXml(title)}</text>${tiles}</g>`
  }
  const leftX = 20, rightX = leftX + panelWidth + 36
  const callouts = diff.regions.map(region => `<text x="${leftX}" y="${panelHeight + 48 + region.id * 19}">区域${region.id}：${region.cells}格，范围(${region.bounds.x},${region.bounds.y}) ${region.bounds.width}×${region.bounds.height}</text>`).join('')
  const legendY = panelHeight + 48 + diff.regions.length * 19 + 20
  const legendRow = `<g transform="translate(${leftX},${legendY})">${legend}</g>`
  const statistic = `共同网格 ${diff.width}×${diff.height}，像元 ${diff.pixelSizeM} m；变化面积占比 ${(diff.changedAreaShare * 100).toFixed(2)}%；变化区域 ${diff.regions.length} 处`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rightX + panelWidth + 20} ${legendY + 42}" role="img" aria-label="区划图像差异对比"><style>text{font:13px sans-serif;fill:#222}</style><text x="20" y="16">${escapeXml(statistic)}</text>${panel(diff.before, leftX, '图像一')}${panel(diff.after, rightX, '图像二')}${callouts}${legendRow}<text x="20" y="${legendY + 34}">${escapeXml(statistic)}</text></svg>`
}
