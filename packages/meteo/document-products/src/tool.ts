/**
 * The model-facing `meteo_document` tool: the 编–审–发–存 loop over one session's
 * document products.
 *
 * The service this package provides is session-owned and, before this tool, reachable
 * only from a client panel through the generated Remote face. This tool is the second
 * seam onto the same service: the agent generates a draft (or lists what the session
 * already holds, including the warning product a resolved hazard grade writes
 * automatically) and applies the transitions the current state allows, each carrying
 * the actor responsible for it and the instant it happened.
 *
 * Every operation is scoped to the calling agent's session, so a product id from one
 * conversation is never visible in another. A transition the current state forbids is
 * refused before the service is called, naming the state the product is in and the
 * actions that state allows: a silent no-op would leave a reviewer believing a product
 * had moved when it had not.
 *
 * @module @deepseek-ai/dsh-document-products/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Config as ProductConfig } from './config.ts'
import type { MeteoData } from './types.ts'
import type { DocumentProduct, ProductAction, ProductId, ProductKind, ProductState } from './product.ts'
import { legalProductActions } from './product.ts'

import type { Session } from '@deepseek-ai/dsh-session'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
/** Product categories the tool generates, as its schemas constrain them. */
const KIND_VALUES = ['灾害预警产品', '农业气象服务简报'] as const

/** Durable product states, as the tool's schemas constrain them. */
const STATE_VALUES = ['draft', 'in_review', 'approved', 'rejected', 'published', 'archived'] as const

/** Lifecycle transitions, as the tool's schemas constrain them. */
const ACTION_VALUES = ['edit', 'submit', 'approve', 'reject', 'revise', 'publish', 'archive'] as const

/** Reviewer notes retained for the next revision result within the same session. */
const rejectionNotes = new WeakMap<Session, Map<string, string>>()
/** Every action the tool's `action` argument accepts. */
const DOCUMENT_ACTION_VALUES = ['generate', 'list', ...ACTION_VALUES] as const

/** Lifecycle actions the tool offers: the service's transitions, draft generation, and listing. */
export type DocumentToolAction = ProductAction | 'generate' | 'list'

/** One corpus citation as the tool's result carries it. */
export interface DocumentCitationView {
  /** Identity of the cited document. */
  readonly documentId: string
  /** Zero-based position of the cited chunk in that document. */
  readonly ordinal: number
  /** Offset of the cited chunk's first character in the source document. */
  readonly charStart: number
  /** Offset one past the cited chunk's last character. */
  readonly charEnd: number
  /** Heading trail the citation supports, or the document title when it has no headings. */
  readonly claim: string
  /** Verbatim text of the cited chunk. */
  readonly text: string
}

/** One recorded lifecycle transition as the tool's result carries it. */
export interface DocumentTransitionView {
  /** State the product was in. */
  readonly from: ProductState
  /** State the transition moved it to. */
  readonly to: ProductState
  /** Action that was applied. */
  readonly action: ProductAction
  /** Person or service responsible for the transition. */
  readonly actor: string
  /** ISO instant the transition was recorded at. */
  readonly at: string
}

/** One product as the tool's result carries it. */
export interface DocumentProductView {
  /** Opaque product identity, what later calls must pass back. */
  readonly id: string
  /** Product category. */
  readonly kind: ProductKind
  /** Document title. */
  readonly title: string
  /** Durable state the product is in now. */
  readonly state: ProductState
  /** Number of releases published from this product. */
  readonly version: number
  /** Cited corpus chunks supporting the body. */
  readonly citations: DocumentCitationView[]
  /** Every transition recorded for this product, oldest first. */
  readonly transitions: DocumentTransitionView[]
  /** Rendered title, ordered sections, body, and citations, explicitly capped for tool output. */
  readonly document: string
}

/** One immutable release a publishing call produced. */
export interface DocumentReleaseView {
  /** Product the release was published from. */
  readonly productId: string
  /** Release number. */
  readonly version: number
  /** ISO instant of publication. */
  readonly publishedAt: string
  /** Person or service that published. */
  readonly actor: string
  /** Title frozen into the release. */
  readonly title: string
  /** Openable Markdown release artifact path. */
  readonly artifactPath: string
}

/** The data period a generated product covers. */
export interface DocumentPeriod {
  /** Inclusive lower bound of the covered period. */
  readonly from: string
  /** Inclusive upper bound of the covered period. */
  readonly to: string
}

/** Canonical `meteo_document` result: what this call did and what the session holds now. */
export interface DocumentResultValue {
  /** Action this call performed. */
  readonly action: DocumentToolAction
  /** Products the call reports: the newly generated or changed one, or every session product for `list`. */
  readonly products: DocumentProductView[]
  /** Transitions this call recorded, oldest first; empty for `generate` and `list`. */
  readonly performed: DocumentTransitionView[]
  /** Period a `generate` call covers, after both bounds or neither were supplied. */
  readonly period?: DocumentPeriod
  /** Release a `publish` call issued. */
  readonly release?: DocumentReleaseView
  /** Reviewer's or revisor's note this call carried, when it carried one. */
  readonly note?: string
}

/** One citation as the tool's replayable presentation metadata carries it. */
export interface DocumentCitationMeta {
  /** Identity of the cited document. */
  readonly documentId: string
  /** Zero-based position of the cited chunk in that document. */
  readonly ordinal: number
  /** Offset of the cited chunk's first character. */
  readonly charStart: number
  /** Offset one past the cited chunk's last character. */
  readonly charEnd: number
  /** Heading trail the citation supports. */
  readonly claim: string
  /** Leading excerpt of the cited chunk, capped for a card. */
  readonly excerpt: string
}

/** One transition as the tool's replayable presentation metadata carries it. */
export interface DocumentTransitionMeta {
  /** State the product was in. */
  readonly from: string
  /** State the transition moved it to. */
  readonly to: string
  /** Action that was applied. */
  readonly action: string
  /** Person or service responsible for the transition. */
  readonly actor: string
  /** ISO instant the transition was recorded at. */
  readonly at: string
}

/** One product as the tool's replayable presentation metadata carries it. */
export interface DocumentProductMeta {
  /** Opaque product identity. */
  readonly id: string
  /** Product category. */
  readonly kind: string
  /** Document title. */
  readonly title: string
  /** Durable state the product is in. */
  readonly state: string
  /** Number of releases published from this product. */
  readonly version: number
  /** Cited corpus chunks with capped excerpts. */
  readonly citations: readonly DocumentCitationMeta[]
  /** Every transition recorded for this product. */
  readonly transitions: readonly DocumentTransitionMeta[]
}

/** The `meteo_document` result fields a renderer may read without a guard. */
export interface DocumentResultMeta {
  /** Action the call performed. */
  readonly action: string
  /** Label the card shows for that action, resolved against the known actions. */
  readonly actionLabel: string
  /** Products the call reports. */
  readonly products: readonly DocumentProductMeta[]
  /** Transitions the call recorded. */
  readonly performed: readonly DocumentTransitionMeta[]
}

/** `meteo_document` arguments as the model sent them; the enum shapes are validated before execute. */
interface DocumentToolArgs {
  /** Action to perform. */
  action: DocumentToolAction
  /** Product category, required by `generate`. */
  kind?: ProductKind
  /** Station the generated product is about, required by `generate`. */
  stationId?: string
  /** Inclusive lower bound of the covered period; omit together with `to`. */
  from?: string
  /** Inclusive upper bound of the covered period; omit together with `from`. */
  to?: string
  /** Disaster the product addresses. */
  hazard?: string
  /** Crop the product addresses. */
  crop?: string
  /** Resolved hazard grade the product carries. */
  grade?: string
  /** Product a transition applies to. */
  productId?: string
  /** Person or service responsible for a transition. */
  actor?: string
  /** Reviewer's reason for returning a product, required by `reject`. */
  /** Replacement body required by `edit`. */
  body?: string
}

/** Chinese state labels, matching the review panel's vocabulary. */
const STATE_TEXT: Readonly<Record<ProductState, string>> = {
  draft: '草稿',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已退回',
  published: '已发布',
  archived: '已归档',
}

/** Chinese action labels, matching the review panel's vocabulary. */
const ACTION_TEXT: Readonly<Record<ProductAction, string>> = {
  edit: '编辑正文',
  submit: '提交审核',
  approve: '审核通过',
  reject: '退回修改',
  revise: '重新编辑',
  publish: '发布',
  archive: '归档',
}

/** Action labels as the tool's own headings name them. */
const TOOL_ACTION_TEXT: Readonly<Record<DocumentToolAction, string>> = { ...ACTION_TEXT, generate: '生成草稿', list: '会话产品' }

/** The same labels keyed by string, so replayed metadata is validated rather than trusted. */
const TOOL_ACTION_LABEL: Readonly<Record<string, string>> = { ...TOOL_ACTION_TEXT }

/** Required scalar kinds one metadata field may carry. */
type MetaField = 'boolean' | 'number' | 'string'

/** Required field names mapped to the scalar kind each must carry. */
type MetaFields = Readonly<Record<string, MetaField>>

const CITATION_FIELDS: MetaFields = { documentId: 'string', ordinal: 'number', charStart: 'number', charEnd: 'number', claim: 'string', excerpt: 'string' }
const TRANSITION_FIELDS: MetaFields = { from: 'string', to: 'string', action: 'string', actor: 'string', at: 'string' }
const PRODUCT_FIELDS: MetaFields = { id: 'string', kind: 'string', title: 'string', state: 'string', version: 'number' }

/**
 * Trim a slot down to what it actually says.
 * @param value - the argument as it arrived, if it arrived.
 * @returns the trimmed text, or `undefined` when it carries nothing.
 */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/**
 * Cut a citation excerpt to a length a card can hold, on a code-point boundary so a
 * surrogate pair is never split.
 * @param text - verbatim chunk text.
 * @param maxChars - largest number of code points the excerpt may carry.
 * @returns `text` unchanged when it already fits, else its leading excerpt.
 */
function capSnippet(text: string, maxChars: number): string {
  const points = Array.from(text)
  if (points.length <= maxChars) return text
  return `${points.slice(0, maxChars - 1).join('')}…`
}

/** List the actions a state allows, or say that it allows none. */
function allowedText(state: ProductState): string {
  const legal = legalProductActions(state)
  return legal.length === 0 ? '无（已归档，生命周期结束）' : legal.map(action => `${ACTION_TEXT[action]}（${action}）`).join('、')
}

/** Render one recorded transition with its actor and instant. */
function transitionText(transition: DocumentTransitionView): string {
  return `${ACTION_TEXT[transition.action]}（${transition.action}）：${STATE_TEXT[transition.from]}（${transition.from}） → ${STATE_TEXT[transition.to]}（${transition.to}）｜操作人 ${transition.actor}｜时间 ${transition.at}`
}

/** Render the complete product in reading order, truncating its document text explicitly. */
function documentText(product: DocumentProduct, maxChars: number): string {
  const content = [
    `# ${product.title}`,
    ...product.sections.flatMap(section => [`## ${section.heading}`, section.body]),
    '## 正文',
    product.body,
    '## 引用',
    ...product.citations.map(citation => `- ${citation.claim}｜${citation.documentId} #${String(citation.ordinal)}｜字符 ${String(citation.charStart)}-${String(citation.charEnd)}｜${citation.text}`),
  ].join('\n\n')
  const points = Array.from(content)
  return points.length <= maxChars ? content : `${points.slice(0, maxChars - 1).join('')}…（文档文本已截断，完整发布件见发布路径）`
}

/** Project a retained product into the fields the result and its metadata carry. */
function productView(product: DocumentProduct, documentChars: number): DocumentProductView {
  return {
    id: product.id,
    kind: product.kind,
    state: product.state,
    title: product.title,
    version: product.version,
    document: documentText(product, documentChars),
    citations: product.citations.map(citation => ({
      documentId: citation.documentId,
      ordinal: citation.ordinal,
      charStart: citation.charStart,
      charEnd: citation.charEnd,
      claim: citation.claim,
      text: citation.text,
    })),
    transitions: product.history.map(transition => ({
      from: transition.from,
      to: transition.to,
      action: transition.action,
      actor: transition.actor,
      at: transition.at,
    })),
  }
}

/** Render one product's identity, state, allowed actions, citations, and history. */
function productLines(product: DocumentProductView, snippetChars: number): string[] {
  const lines = [
    `- 产品 ${product.id}｜${product.kind}｜「${product.title}」`,
    `  状态：${STATE_TEXT[product.state]}（${product.state}）｜版本：v${String(product.version)}｜可执行操作：${allowedText(product.state)}`,
    `  文档内容：\n${product.document.split('\n').map(line => `    ${line}`).join('\n')}`,
  ]
  if (product.citations.length > 0) {
    lines.push(`  引用依据 ${String(product.citations.length)} 条：`)
    for (const citation of product.citations) {
      lines.push(`   · ${citation.claim}｜${citation.documentId} #${String(citation.ordinal)}｜字符 ${String(citation.charStart)}-${String(citation.charEnd)}｜${capSnippet(citation.text, snippetChars)}`)
    }
  }
  if (product.transitions.length > 0) {
    lines.push(`  状态历史 ${String(product.transitions.length)} 条：`)
    for (const transition of product.transitions) lines.push(`   · ${transitionText(transition)}`)
  }
  return lines
}

/**
 * Render one result as the model-facing text block: the product's kind, state, version,
 * and citations, the transitions this call recorded with their actor and instant, the
 * release a publication issued, and the actions the product's state allows next.
 * @param value - the canonical `meteo_document` result.
 * @param snippetChars - the deployment's citation excerpt cap in code points.
 * @returns the rendered block.
 */
export function formatDocumentResult(value: DocumentResultValue, snippetChars: number): string {
  const lines = [`气象文档产品（meteo_document）：${TOOL_ACTION_TEXT[value.action]}`]
  if (value.period !== undefined) lines.push(`数据时段：${value.period.from} ~ ${value.period.to}`)
  if (value.products.length === 0) lines.push('本次调用未返回文档产品。')
  for (const product of value.products) lines.push(...productLines(product, snippetChars))
  lines.push(value.performed.length === 0
    ? '本次调用未记录状态变更。'
    : `本次调用记录的状态变更 ${String(value.performed.length)} 条：\n${value.performed.map(transition => ` · ${transitionText(transition)}`).join('\n')}`)
  if (value.release !== undefined) {
    lines.push(`发布件：产品 ${value.release.productId}｜版本 v${String(value.release.version)}｜发布人 ${value.release.actor}｜发布时间 ${value.release.publishedAt}｜文件 ${value.release.artifactPath}`)
    lines.push(`发布文件路径：${value.release.artifactPath}`)
  }
  if (value.note !== undefined) lines.push(`意见：${value.note}`)
  return lines.join('\n')
}

/**
 * Project a validated result into the metadata a card renders, so a client never reads
 * the model-facing text.
 * @param value - the canonical `meteo_document` result.
 * @param snippetChars - the deployment's citation excerpt cap in code points.
 * @returns the replayable presentation payload.
 */
export function documentMetaFromValue(value: DocumentResultValue, snippetChars: number): JsonValue {
  return {
    action: value.action,
    products: value.products.map(product => ({
      id: product.id,
      kind: product.kind,
      title: product.title,
      document: product.document,
      state: product.state,
      version: product.version,
      citations: product.citations.map(citation => ({
        documentId: citation.documentId,
        ordinal: citation.ordinal,
        charStart: citation.charStart,
        charEnd: citation.charEnd,
        claim: citation.claim,
        excerpt: capSnippet(citation.text, snippetChars),
      })),
      transitions: product.transitions.map(transition => ({
        from: transition.from,
        to: transition.to,
        action: transition.action,
        actor: transition.actor,
        at: transition.at,
      })),
    })),
    performed: value.performed.map(transition => ({
      from: transition.from,
      to: transition.to,
      action: transition.action,
      actor: transition.actor,
      at: transition.at,
    })),
  }
}

/**
 * Narrow an opaque value to an object carrying every field of `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each must carry.
 * @returns the record for further reads, or `undefined` when `value` is not an object
 *   or any required field is missing or mistyped.
 */
function narrowFields(value: unknown, fields: MetaFields): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const [key, kind] of Object.entries(fields)) if (typeof record[key] !== kind) return undefined
  return record
}

/**
 * Narrow an opaque value to a list of records that each carry `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each must carry.
 * @returns the records in list order, or `undefined` when `value` is not an array or any
 *   element lacks one of the fields.
 */
function narrowRecords(value: unknown, fields: MetaFields): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records: Record<string, unknown>[] = []
  for (const item of value) {
    const record = narrowFields(item, fields)
    if (record === undefined) return undefined
    records.push(record)
  }
  return records
}

/** Project one narrowed transition record into its typed view. */
function transitionMeta(record: Record<string, unknown>): DocumentTransitionMeta {
  return {
    from: record.from as string,
    to: record.to as string,
    action: record.action as string,
    actor: record.actor as string,
    at: record.at as string,
  }
}

/**
 * Narrow opaque `meteo_document` result metadata into what a renderer reads.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the action, product list, and recorded transitions, or `undefined` when any of
 *   them is malformed.
 */
export function documentResultMetaFromResult(meta: unknown): DocumentResultMeta | undefined {
  const record = narrowFields(meta, { action: 'string' })
  if (record === undefined) return undefined
  const action = record.action as string
  const actionLabel = TOOL_ACTION_LABEL[action]
  if (actionLabel === undefined) return undefined
  const products = narrowRecords(record.products, PRODUCT_FIELDS)
  if (products === undefined) return undefined
  const performed = narrowRecords(record.performed, TRANSITION_FIELDS)
  if (performed === undefined) return undefined
  const views: DocumentProductMeta[] = []
  for (const product of products) {
    const citations = narrowRecords(product.citations, CITATION_FIELDS)
    const transitions = narrowRecords(product.transitions, TRANSITION_FIELDS)
    if (citations === undefined || transitions === undefined) return undefined
    views.push({
      id: product.id as string,
      kind: product.kind as string,
      title: product.title as string,
      state: product.state as string,
      version: product.version as number,
      citations: citations.map(citation => ({
        documentId: citation.documentId as string,
        ordinal: citation.ordinal as number,
        charStart: citation.charStart as number,
        charEnd: citation.charEnd as number,
        claim: citation.claim as string,
        excerpt: citation.excerpt as string,
      })),
      transitions: transitions.map(transitionMeta),
    })
  }
  return { action, actionLabel, products: views, performed: performed.map(transitionMeta) }
}

/**
 * Pending-call presentation: a lifecycle card titled by the action.
 * @param args - the raw tool arguments; only the action feeds the view.
 * @returns the generic card view shown while the call runs.
 */
export function presentDocumentCall(args: DocumentToolArgs): GenericCallView {
  return { card: 'generic', title: `气象文档产品：${TOOL_ACTION_TEXT[args.action]}`, kind: args.action === 'list' ? 'read' : 'edit', rawInput: args.productId ?? args.stationId }
}

/**
 * Completed-call presentation: each product's identity and state plus the transitions
 * this call recorded, without the citations and history the model already has.
 * @param _args - unused; the card is titled by what the result carries.
 * @param result - the final model-facing tool result; `meta` carries the projection.
 * @returns the generic result view, or `undefined` (generic fallback) on failure or
 *   malformed meta.
 */
export function presentDocumentResult(_args: DocumentToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const view = documentResultMetaFromResult(result.meta)
  if (view === undefined) return undefined
  const lines = view.products.map(product => `${product.id}｜${product.kind}｜${product.state}｜v${String(product.version)}｜引用 ${String(product.citations.length)} 条`)
  for (const transition of view.performed) lines.push(`${transition.action}: ${transition.from} → ${transition.to} · ${transition.actor} · ${transition.at}`)
  return {
    card: 'generic',
    title: `气象文档产品：${view.actionLabel}`,
    ...(lines.length === 0 ? {} : { content: [{ type: 'text' as const, text: lines.join('\n') }] }),
  }
}

/**
 * Resolve the period a generated product covers: the bounds the model supplied, or the
 * station's published observation span when it supplied neither.
 * @param data - shared meteo data seam, read only to resolve the span.
 * @param stationId - station the product is about.
 * @param from - lower bound the model supplied, if any.
 * @param to - upper bound the model supplied, if any.
 * @returns the inclusive period to generate over.
 */
async function resolvePeriod(
  data: MeteoData,
  stationId: string,
  from: string | undefined,
  to: string | undefined,
): Promise<DocumentPeriod> {
  if (from !== undefined && to !== undefined) return { from, to }
  if (from !== undefined || to !== undefined) throw new Error('meteo_document generate takes both from and to, or neither: with neither it covers the station\'s published observation span')
  const observations = await data.observations({ stationId })
  const times = observations.map(observation => observation.time).sort()
  const first = times.at(0)
  const last = times.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error(`meteo_document generate found no published observation for station ${stationId}: pass from and to explicitly`)
  }
  return { from: first, to: last }
}

/**
 * Register the `meteo_document` tool.
 * @param ctx - context whose `tools` registry receives the tool and whose
 *   `documentProducts` service owns the products; the registration is effect-scoped.
 * @param limits - the deployment's forecast horizon, citation window, and tool budget.
 */
export function applyDocumentProductTool(ctx: Context, limits: Required<ProductConfig>): void {
  ctx.tools.register(defineTool({
    name: 'meteo_document',
    description: 'Operate this session\'s meteorological document products through 编–审–发–存. action="generate" fills a 灾害预警产品 or 农业气象服务简报 draft from published observations, forecast, thresholds, crop calendar, and cited corpus chunks; action="list" reports every product and allowed action. action="edit" accepts productId and body (the replacement 正文 text), edits a draft only, records actor and instant, and rechecks all numbers and citation coordinates before retaining it; failed edits leave the product unchanged. submit (draft → 审核中), approve (审核中 → 已通过), reject (审核中 → 已退回, requires note), revise (已退回 → 草稿), publish (已通过 → 已发布, issuing a numbered release), archive (已发布 → 已归档). Every transition needs actor. Use only product ids from this conversation. Whenever a result contains 文档内容, show the document itself in your answer. After publish, state the returned release version and artifactPath. Never invent document content, citations, or numbers beyond what the result returned.',
    parameters: {
      action: { type: 'string', required: true, enum: DOCUMENT_ACTION_VALUES, description: 'Lifecycle action to perform.' },
      kind: { type: 'string', enum: KIND_VALUES, description: 'Product category; generate requires it.' },
      stationId: { type: 'string', description: 'Station the generated product is about, as meteo_station_lookup reports it; generate requires it.' },
      from: { type: 'string', description: 'Inclusive lower bound of the covered period, an ISO-8601 instant. Omit together with to to cover the station\'s published observation span.' },
      to: { type: 'string', description: 'Inclusive upper bound of the covered period, an ISO-8601 instant. Omit together with from.' },
      hazard: { type: 'string', description: 'Disaster the product addresses, e.g. 暴雨. Selects the thresholds and corpus terms it is built from.' },
      crop: { type: 'string', description: 'Crop the product addresses, e.g. 玉米, 大豆, or 水稻. Selects the crop-calendar windows it is built from.' },
      grade: { type: 'string', description: 'Resolved hazard grade the product carries, e.g. high. Omit for a brief that carries no grade.' },
      productId: { type: 'string', description: 'Product a lifecycle action applies to, as a previous call reported it.' },
      actor: { type: 'string', description: 'Person or service responsible for a lifecycle action; every action except generate and list requires it.' },
      body: { type: 'string', description: 'Replacement 正文 text; required by edit and must be non-empty. The service composes section headings and the citation list; post-edit verification requires (a) a non-empty body and (b) every number in it to be grounded in filled data.' },
      note: { type: 'string', description: 'Reason for returning a product, shown with the transition; reject requires it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: DOCUMENT_ACTION_VALUES },
          products: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: KIND_VALUES },
                title: { type: 'string', required: true },
                state: { type: 'string', required: true, enum: STATE_VALUES },
                document: { type: 'string', required: true },
                version: { type: 'integer', required: true },
                citations: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      documentId: { type: 'string', required: true },
                      ordinal: { type: 'integer', required: true },
                      charStart: { type: 'integer', required: true },
                      charEnd: { type: 'integer', required: true },
                      claim: { type: 'string', required: true },
                      text: { type: 'string', required: true },
                    },
                  },
                },
                transitions: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      from: { type: 'string', required: true, enum: STATE_VALUES },
                      to: { type: 'string', required: true, enum: STATE_VALUES },
                      action: { type: 'string', required: true, enum: ACTION_VALUES },
                      actor: { type: 'string', required: true },
                      at: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          performed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string', required: true, enum: STATE_VALUES },
                to: { type: 'string', required: true, enum: STATE_VALUES },
                action: { type: 'string', required: true, enum: ACTION_VALUES },
                actor: { type: 'string', required: true },
                at: { type: 'string', required: true },
              },
            },
          },
          period: {
            type: 'object',
            additionalProperties: false,
            properties: {
              from: { type: 'string', required: true },
              to: { type: 'string', required: true },
            },
          },
          release: {
            type: 'object',
            additionalProperties: false,
            properties: {
              productId: { type: 'string', required: true },
              version: { type: 'integer', required: true },
              publishedAt: { type: 'string', required: true },
              actor: { type: 'string', required: true },
              artifactPath: { type: 'string', required: true },
              title: { type: 'string', required: true },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDocumentResult(value, limits.snippetChars) }],
      presentationMeta: (_args, value) => documentMetaFromValue(value, limits.snippetChars),
    },
    timeoutMs: limits.timeoutMs,
    // Every action writes the session's product records and event log, so two calls must not overlap.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('meteo_document needs an agent session: every product operation is scoped to the session that asked for it')
      const session = exec.agent.session
      const service = ctx.documentProducts
      if (args.action === 'list') {
        return {
          action: args.action,
          products: service.list(session).map(product => productView(product, limits.documentChars)),
          performed: [],
        }
      }
      if (args.action === 'generate') {
        const kind = args.kind
        if (kind === undefined) throw new Error('meteo_document generate needs kind: 灾害预警产品 or 农业气象服务简报')
        const stationId = nonEmpty(args.stationId)
        if (stationId === undefined) throw new Error('meteo_document generate needs stationId: the station the product is generated for')
        const period = await resolvePeriod(ctx.meteoData, stationId, nonEmpty(args.from), nonEmpty(args.to))
        const hazard = nonEmpty(args.hazard)
        const crop = nonEmpty(args.crop)
        const grade = nonEmpty(args.grade)
        const product = await service.generate(session, {
          kind,
          stationId,
          from: period.from,
          to: period.to,
          ...(hazard === undefined ? {} : { hazard }),
          ...(crop === undefined ? {} : { crop }),
          ...(grade === undefined ? {} : { grade }),
        })
        return { action: args.action, products: [productView(product, limits.documentChars)], performed: [], period }
      }
      const action = args.action
      const productId = nonEmpty(args.productId)
      if (productId === undefined) throw new Error(`meteo_document ${action} needs productId: the product the transition applies to, as a previous generate or list call reported it`)
      const actor = nonEmpty(args.actor)
      if (actor === undefined) throw new Error(`meteo_document ${action} needs actor: the person or service responsible for the transition`)
      let editBody: string | undefined
      if (action === 'edit') {
        if (args.body === undefined) throw new Error('meteo_document edit needs body: the replacement document body')
        editBody = args.body
      }
      const note = nonEmpty(args.note)
      if (action === 'reject' && note === undefined) throw new Error('meteo_document reject needs note: the reviewer\'s reason for returning the product')
      const id = brandString<ProductId>(productId)
      const held = service.list(session)
      const current = held.find(product => product.id === id)
      if (current === undefined) {
        const known = held.map(product => product.id).join(', ')
        throw new Error(`Unknown document product for this session: ${productId}${known.length === 0 ? '; this session holds no document product yet, so generate one or run meteo_consult until a resolved hazard writes one' : `; products in this session: ${known}`}`)
      }
      const legal = legalProductActions(current.state)
      if (!legal.includes(action)) {
        throw new Error(`Illegal document transition: ${action} on product ${productId} in state ${current.state}; this state allows ${legal.length === 0 ? 'nothing (the product is archived and its lifecycle has ended)' : legal.join(', ')}`)
      }
      const sessionNotes = rejectionNotes.get(session) ?? new Map<string, string>()
      if (action === 'reject' && note !== undefined) {
        sessionNotes.set(productId, note)
        rejectionNotes.set(session, sessionNotes)
      }
      const resultNote = action === 'revise' ? sessionNotes.get(productId) ?? note : note
      const result = action === 'edit'
        ? { product: service.edit(session, id, editBody as string, actor, new Date().toISOString()) }
        : service.act(session, id, action, actor, new Date().toISOString())
      const performed = result.product.history.slice(current.history.length).map(transition => ({
        from: transition.from,
        to: transition.to,
        action: transition.action,
        actor: transition.actor,
        at: transition.at,
      }))
      let release: DocumentReleaseView | undefined
      if (result.release !== undefined) {
        const artifactPath = resolve(limits.artifactDir, `${result.release.productId}-v${String(result.release.version)}.md`)
        const markdown = [
          `# ${result.release.title}`,
          '',
          `版本：v${String(result.release.version)}  `,
          `发布人：${result.release.actor}  `,
          `发布时间：${result.release.publishedAt}`,
          '',
          ...result.product.sections.flatMap(section => [`## ${section.heading}`, '', section.body, '']),
          '## 正文',
          '',
          result.release.body,
          '',
          '## 引用',
          '',
          ...result.release.citations.map(citation => `- ${citation.claim}｜${citation.documentId} #${String(citation.ordinal)}｜字符 ${String(citation.charStart)}-${String(citation.charEnd)}｜${citation.text}`),
          '',
        ].join('\n')
        await mkdir(limits.artifactDir, { recursive: true })
        await writeFile(artifactPath, markdown, { encoding: 'utf8', flag: 'wx' })
        release = {
          productId: result.release.productId,
          version: result.release.version,
          publishedAt: result.release.publishedAt,
          actor: result.release.actor,
          title: result.release.title,
          artifactPath,
        }
      }
      return {
        action,
        products: [productView(result.product, limits.documentChars)],
        performed,
        ...(release === undefined ? {} : { release }),
        ...(resultNote === undefined ? {} : { note: resultNote }),
      }
    },
  }))
}
