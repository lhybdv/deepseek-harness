import { describe, expect, it } from 'vitest'
import { compareZones, normalizeRaster, renderZoneComparisonSvg, validateZoneModelOutput } from '../src/index.ts'
import type { ZoneRaster } from '../src/index.ts'

const raster = (width: number, height: number, pixelSizeM: number, categories: (string | null)[]): ZoneRaster => ({ width, height, pixelSizeM, categories })
const interpretation = { classification: '土地利用', features: { areaShares: [{ category: '耕地', share: 0.5 }], dominantCategories: ['耕地'], legend: [{ category: '耕地', color: '#00aa00' }] }, semantics: '表达土地利用结构' }

describe('categorical zoning comparison', () => {
  it('normalizes differing source resolutions and extracts connected transitions', () => {
    const result = compareZones(raster(2, 2, 10, ['耕地', '耕地', '林地', '林地']), raster(4, 4, 5, Array.from({ length: 16 }, (_, i) => i < 8 ? '耕地' : '建设用地')))
    expect(result.pixelSizeM).toBe(10)
    expect([result.width, result.height]).toEqual([2, 2])
    expect(result.changedAreaShare).toBe(0.5)
    expect(result.categoryShifts).toEqual({ 林地: -2, '建设用地': 2 })
    expect(result.regions).toEqual([{ id: 1, bounds: { x: 0, y: 1, width: 2, height: 1 }, cells: 2, transitions: { '林地 → 建设用地': 2 } }])
  })
  it('includes transitions to and from unclassified cells and separates disconnected regions', () => {
    const result = compareZones(raster(3, 1, 4, ['A', 'A', 'A']), raster(3, 1, 4, [null, 'A', 'B']))
    expect(result.changedAreaShare).toBeCloseTo(2 / 3)
    expect(result.categoryShifts).toEqual({ A: -2, B: 1 })
    expect(result.regions.map(region => region.transitions)).toEqual([{ 'A → 未分类': 1 }, { 'A → B': 1 }])
    const fromUnclassified = compareZones(raster(1, 1, 1, [null]), raster(1, 1, 1, ['B']))
    expect(fromUnclassified.regions[0]?.transitions).toEqual({ '未分类 → B': 1 })
    expect(fromUnclassified.categoryShifts).toEqual({ B: 1 })
  })
  it('uses nearest-neighbour sampling and rejects invalid dimensions, pixel sizes, and lengths', () => {
    expect(normalizeRaster(raster(2, 1, 1, ['A', 'B']), 4, 1)).toEqual(['A', 'A', 'B', 'B'])
    expect(() => normalizeRaster(raster(0, 1, 1, []), 1, 1)).toThrow('Raster dimensions')
    expect(() => normalizeRaster(raster(1, 1, 0, ['A']), 1, 1)).toThrow('Pixel size')
    expect(() => normalizeRaster(raster(1, 1, 1, []), 1, 1)).toThrow('Category count')
    expect(() => normalizeRaster(raster(1, 1, 1, ['A']), 0, 1)).toThrow('Target dimensions')
    expect(() => compareZones(raster(1, 1, 1, ['A']), raster(1, 1, 1, ['A']))).not.toThrow()
  })
})

describe('model boundary and SVG output', () => {
  it('validates exactly two structured interpretations and rejects invalid model JSON', () => {
    expect(validateZoneModelOutput(JSON.stringify({ images: [interpretation, interpretation] })).images).toHaveLength(2)
    for (const value of ['{', JSON.stringify({}), JSON.stringify({ images: [interpretation] }), JSON.stringify({ images: [{ ...interpretation, features: { ...interpretation.features, areaShares: [{ category: 'x', share: 1.1 }] } }, interpretation] }), JSON.stringify({ images: [{ ...interpretation, features: { ...interpretation.features, legend: [{ category: 'x', color: 'red' }] } }, interpretation] }), JSON.stringify({ images: [{ ...interpretation, classification: '' }, interpretation] }), JSON.stringify({ images: [{ ...interpretation, features: { areaShares: [], dominantCategories: 2, legend: [] } }, interpretation] })]) expect(() => validateZoneModelOutput(value)).toThrow()
  })
  it('renders both maps, escaped legend labels, component bounds, statistics, and transitions', () => {
    const diff = compareZones(raster(2, 1, 5, ['<耕地>', '林地']), raster(2, 1, 5, ['建设用地', '林地']))
    const svg = renderZoneComparisonSvg(diff, { '<耕地>': '#00aa00', '建设用地': '#cc0000' })
    expect(svg).toContain('图像一')
    expect(svg).toContain('图像二')
    expect(svg).toContain('&lt;耕地&gt;')
    expect(svg).toContain('变化区域 1 处')
    expect(svg).toContain('区域1：1格')
    expect(svg).toContain('stroke="#d62728"')
    const partial = compareZones(raster(1, 1, 5, [null]), raster(1, 1, 5, ['未登记']))
    const partialSvg = renderZoneComparisonSvg(partial, {})
    expect(partialSvg).toContain('fill="#eeeeee"')
    expect(partialSvg).toContain('fill="#888888"')
  })
})
