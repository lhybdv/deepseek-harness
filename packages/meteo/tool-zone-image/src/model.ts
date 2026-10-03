/** Model-output contract and strict parser for zoning-image classification. @module */

/** Model interpretation of one zoning map. */
export interface ZoneInterpretation {
  /** Classification, such as land use or administrative zoning. */
  classification: string
  /** Quantitative shares, dominant labels, and image-read legend mapping. */
  features: { areaShares: { category: string; share: number }[]; dominantCategories: string[]; legend: { category: string; color: string }[] }
  /** Plain-language account of what this zoning expresses. */
  semantics: string
}

/** Both image interpretations returned by the vision model. */
export interface ZoneModelOutput { images: [ZoneInterpretation, ZoneInterpretation] }

/** Parse and validate model JSON, rejecting malformed structure and invalid shares/colors. @param value - raw completion JSON string. @returns validated two-image interpretation. */
export function validateZoneModelOutput(value: string): ZoneModelOutput {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Model output is not valid JSON') }
  if (!isRecord(parsed) || !Array.isArray(parsed.images) || parsed.images.length !== 2) throw new Error('Model output must contain exactly two images')
  return { images: [validateImage(parsed.images[0]), validateImage(parsed.images[1])] }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function validateImage(value: unknown): ZoneInterpretation {
  if (!isRecord(value) || typeof value.classification !== 'string' || !value.classification.trim() || typeof value.semantics !== 'string' || !value.semantics.trim() || !isRecord(value.features)) throw new Error('Each image requires classification, features, and semantics')
  const features = value.features
  if (!Array.isArray(features.areaShares) || !Array.isArray(features.dominantCategories) || !features.dominantCategories.every(item => typeof item === 'string') || !Array.isArray(features.legend)) throw new Error('Image features have an invalid shape')
  const areaShares = features.areaShares.map(item => {
    if (!isRecord(item) || typeof item.category !== 'string' || typeof item.share !== 'number' || !Number.isFinite(item.share) || item.share < 0 || item.share > 1) throw new Error('Area shares must be between zero and one')
    return { category: item.category, share: item.share }
  })
  const legend = features.legend.map(item => {
    if (!isRecord(item) || typeof item.category !== 'string' || typeof item.color !== 'string' || !/^#[\da-f]{6}$/i.test(item.color)) throw new Error('Legend entries require a category and six-digit hex color')
    return { category: item.category, color: item.color }
  })
  return { classification: value.classification, features: { areaShares, dominantCategories: [...features.dominantCategories], legend }, semantics: value.semantics }
}
