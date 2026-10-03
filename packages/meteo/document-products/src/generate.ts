/** Data-backed template generation and optional prose composition. @module */
import type { CorpusStore, ProductDataValue, MeteoData, DocumentProduct, ProductCitation, ProductKind, ProductId } from './types.ts'
import { verifyProduct, verifyPolish } from './product.ts'
/** Inputs for a document generation request. */
export interface GenerateProductInput { readonly kind: ProductKind; readonly stationId: string; readonly from: string; readonly to: string; readonly hazard?: string; readonly crop?: string; readonly grade?: string; readonly forecastHours?: number; readonly citationLimit?: number }
/** Model-assisted wording adapter. Numeric facts and citations are immutable inputs. */
export type ProductComposer = (draft: DocumentProduct) => Promise<DocumentProduct>
/** Fill template fields from observed/forecast data and corpus citations. @param data - shared meteo data seam. @param corpus - shared corpus seam. @param input - explicit document request. @param compose - optional prose composition model. @returns verified draft product. */
export async function generateProduct(data: MeteoData, corpus: CorpusStore, input: GenerateProductInput, compose?: ProductComposer): Promise<DocumentProduct> {
  const query = { ...(input.hazard ? { disaster: input.hazard } : {}), ...(input.crop ? { crop: input.crop } : {}) }
  const station = await data.station(input.stationId)
  if (!station) throw new Error(`Unknown station: ${input.stationId}`)
  const [observations, forecast, thresholds, windows, search] = await Promise.all([
    data.observations({ stationId: input.stationId, from: input.from, to: input.to }),
    data.forecast({ stationId: input.stationId, from: input.from, ...(input.forecastHours === undefined ? {} : { hours: input.forecastHours }) }), data.thresholds(query),
    data.cropCalendar(query), corpus.search({ query: `${input.hazard ?? ''} ${input.crop ?? ''} ${input.kind}`, terms: [input.hazard, input.crop].filter((term): term is string => Boolean(term)), ...(input.citationLimit === undefined ? {} : { limit: input.citationLimit }) }),
  ])
  if (input.kind === '灾害预警产品' && thresholds.length === 0) throw new Error(`No threshold data for disaster warning at ${station.id}`)
  if (observations.length + forecast.length + thresholds.length + windows.length === 0) throw new Error(`No meteorological data available for ${station.id} in ${input.from}..${input.to}`)
  const values: ProductDataValue[] = []
  const add = (value: number, source: string, period: string) => values.push({ value, source, stationId: station.id, period })
  for (const row of observations) for (const [key, value] of Object.entries(row.elements)) add(value, `observation:${key}`, row.time)
  for (const row of forecast) for (const [key, value] of Object.entries(row.elements)) add(value, `forecast:${key}`, row.time)
  for (const item of thresholds) { add(item.value, `threshold:${item.disaster}:${item.element}`, input.from); add(item.durationH, `duration:${item.disaster}`, input.from) }
  const windowSummary = windows.map(window => {
    const startMonth = Number(window.windowStart.slice(0, 2))
    const startDay = Number(window.windowStart.slice(3))
    const endMonth = Number(window.windowEnd.slice(0, 2))
    const endDay = Number(window.windowEnd.slice(3))
    add(startMonth, `cropCalendar:${window.crop}:${window.activity}:startMonth`, input.from)
    add(startDay, `cropCalendar:${window.crop}:${window.activity}:startDay`, input.from)
    add(endMonth, `cropCalendar:${window.crop}:${window.activity}:endMonth`, input.from)
    add(endDay, `cropCalendar:${window.crop}:${window.activity}:endDay`, input.from)
    return `${window.crop}${window.activity}窗口${startMonth}月${startDay}日至${endMonth}月${endDay}日`
  }).join('；') || '暂无作物历窗口'
  const citations: ProductCitation[] = search.hits.map(hit => ({ claim: hit.headingPath || hit.docTitle, documentId: hit.docId, ordinal: hit.ordinal, charStart: hit.charStart, charEnd: hit.charEnd, text: hit.text }))
  const observation = observations[0]
  const forecastPoint = forecast[0]
  const summary = observation ? Object.entries(observation.elements).map(([key, value]) => { add(value, `observation:${key}`, observation.time); return `${key} ${value}` }).join('，') : '观测数据暂无'
  const forecastSummary = forecastPoint ? Object.entries(forecastPoint.elements).map(([key, value]) => { add(value, `forecast:${key}`, forecastPoint.time); return `${key} ${value}` }).join('，') : '预报数据暂无'
  const thresholdSummary = thresholds.map(item => { add(item.value, `threshold:${item.disaster}:${item.element}`, input.from); return `${item.disaster}${item.element}${item.op}${item.value}${item.level}` }).join('；') || '暂无匹配阈值'
  const subject = `${input.hazard ?? input.crop ?? input.kind}${input.grade ?? ''}`
  const body = `${station.county}${station.township}${subject}服务提示：${summary}。预报参考：${forecastSummary}。分级依据：${thresholdSummary}。农事窗口：${windowSummary}。`
  const initial: DocumentProduct = { id: crypto.randomUUID() as ProductId, kind: input.kind, title: `${station.township}${subject}${input.kind}`, sections: [{ heading: '监测与预报', body: `${summary}；${forecastSummary}` }, { heading: '阈值与建议', body: `${thresholdSummary}；${windowSummary}` }], body, citations, provenance: values, state: 'draft', history: [], version: 0 }
  verifyProduct([initial.body, ...initial.sections.map(section => section.body)].join(' '), values, citations)
  if (!compose) return initial
  const polished = await compose(initial)
  verifyPolish(initial, polished)
  verifyProduct([polished.body, ...polished.sections.map(section => section.body)].join(' '), polished.provenance, polished.citations)
  return polished
}
/** A resolved rule-engine grading that triggers a warning product automatically. */
export interface ResolvedHazard {
  readonly stationId: string
  readonly from: string
  readonly to: string
  readonly hazard: string
  readonly grade: string
  readonly forecastHours?: number
  readonly citationLimit?: number
}

/** Generate a warning product from a completed hazard grade. @param data - shared data seam. @param corpus - shared corpus seam. @param grading - resolved station hazard and period. @param compose - optional professional wording adapter. @returns verified warning draft. */
export function generateFromResolvedHazard(data: MeteoData, corpus: CorpusStore, grading: ResolvedHazard, compose?: ProductComposer): Promise<DocumentProduct> {
  return generateProduct(data, corpus, { kind: '灾害预警产品', stationId: grading.stationId, from: grading.from, to: grading.to, hazard: grading.hazard, grade: grading.grade, ...(grading.forecastHours === undefined ? {} : { forecastHours: grading.forecastHours }), ...(grading.citationLimit === undefined ? {} : { citationLimit: grading.citationLimit }) }, compose)
}
