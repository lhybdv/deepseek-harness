/** Grid normalization, category comparison, and changed-region statistics for zoning rasters. @module */

/** One categorical raster with per-cell pixel-size metadata. */
export interface ZoneRaster {
  /** Raster width in cells. */
  width: number
  /** Raster height in cells. */
  height: number
  /** Ground size represented by one source pixel, in metres. */
  pixelSizeM: number
  /** Row-major category labels; null represents unclassified pixels. */
  categories: readonly (string | null)[]
}

/** Connected changed component and its category transition. */
export interface ChangedRegion {
  /** Stable row-major component number. */
  id: number
  /** Bounding box in normalized-grid coordinates. */
  bounds: { x: number; y: number; width: number; height: number }
  /** Changed grid cells. */
  cells: number
  /** Category transition counts, encoded as `before → after`. */
  transitions: Record<string, number>
}

/** Aggregate comparison for two normalized rasters. */
export interface ZoneDifference {
  /** Chosen common pixel size, the coarser source resolution. */
  pixelSizeM: number
  /** Shared normalized raster dimensions. */
  width: number
  /** Shared normalized raster dimensions. */
  height: number
  /** Changed cells as a share of all grid cells. */
  changedAreaShare: number
  /** Per-category net cell-count change (after minus before). */
  categoryShifts: Record<string, number>
  /** Eight-connected changed components. */
  regions: ChangedRegion[]
  /** Normalized category grids. */
  before: readonly (string | null)[]
  /** Normalized category grids. */
  after: readonly (string | null)[]
}

function validateRaster(raster: ZoneRaster): void {
  if (!Number.isInteger(raster.width) || raster.width < 1 || !Number.isInteger(raster.height) || raster.height < 1) throw new Error('Raster dimensions must be positive integers')
  if (!Number.isFinite(raster.pixelSizeM) || raster.pixelSizeM <= 0) throw new Error('Pixel size must be positive')
  if (raster.categories.length !== raster.width * raster.height) throw new Error('Category count does not match raster dimensions')
}

/** Resample a raster to a shared grid using nearest-neighbour category sampling. @param raster - source category grid. @param width - target width. @param height - target height. @returns normalized categories. */
export function normalizeRaster(raster: ZoneRaster, width: number, height: number): (string | null)[] {
  validateRaster(raster)
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) throw new Error('Target dimensions must be positive integers')
  const result: (string | null)[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(raster.width - 1, Math.floor((x + 0.5) * raster.width / width))
    const sy = Math.min(raster.height - 1, Math.floor((y + 0.5) * raster.height / height))
    result.push(raster.categories[sy * raster.width + sx] ?? null)
  }
  return result
}

/** Compare categorical rasters after nearest-neighbour normalization onto their coarser-pixel common grid. @param left - earlier raster. @param right - later raster. @returns differences, transition counts, and connected regions. */
export function compareZones(left: ZoneRaster, right: ZoneRaster): ZoneDifference {
  validateRaster(left); validateRaster(right)
  const pixelSizeM = Math.max(left.pixelSizeM, right.pixelSizeM)
  const width = Math.max(1, Math.round(Math.min(left.width * left.pixelSizeM, right.width * right.pixelSizeM) / pixelSizeM))
  const height = Math.max(1, Math.round(Math.min(left.height * left.pixelSizeM, right.height * right.pixelSizeM) / pixelSizeM))
  const before = normalizeRaster(left, width, height)
  const after = normalizeRaster(right, width, height)
  const changed: boolean[] = before.map((category, index) => category !== after[index])
  const shifts: Record<string, number> = {}
  let changedCount = 0
  const transitionForIndex = (index: number): string => `${before[index] ?? '未分类'} → ${after[index] ?? '未分类'}`
  for (let index = 0; index < changed.length; index++) if (changed[index]) {
    changedCount++
    const oldCategory = before[index] ?? null
    const newCategory = after[index] ?? null
    if (oldCategory !== null) shifts[oldCategory] = (shifts[oldCategory] ?? 0) - 1
    if (newCategory !== null) shifts[newCategory] = (shifts[newCategory] ?? 0) + 1
  }
  const visited = new Set<number>()
  const regions: ChangedRegion[] = []
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || visited.has(start)) continue
    const queue = [start]; visited.add(start)
    let minX = width, minY = height, maxX = 0, maxY = 0
    const transitions: Record<string, number> = {}
    for (const index of queue) {
      const x = index % width, y = Math.floor(index / width)
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      const transition = transitionForIndex(index)
      transitions[transition] = (transitions[transition] ?? 0) + 1
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx
        if ((dx !== 0 || dy !== 0) && nx >= 0 && nx < width && ny >= 0 && ny < height && changed[next] && !visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    regions.push({ id: regions.length + 1, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, cells: queue.length, transitions })
  }
  return { pixelSizeM, width, height, changedAreaShare: changedCount / changed.length, categoryShifts: shifts, regions, before, after }
}
