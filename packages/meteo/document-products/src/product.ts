/** Typed meteorological document product and its auditable lifecycle. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque id for one generated document product. */
export type ProductId = Branded<'MeteoProductId'>
/** Product categories supported by the meteo bench. */
export type ProductKind = '灾害预警产品' | '农业气象服务简报'
/** Durable document state. */
export type ProductState = 'draft' | 'in_review' | 'approved' | 'rejected' | 'published' | 'archived'
/** Corpus coordinates supporting a claim. */
export interface ProductCitation { readonly claim: string; readonly documentId: string; readonly ordinal: number; readonly charStart: number; readonly charEnd: number; readonly text: string }
/** Numeric provenance used to ensure body values are data-backed. */
export interface ProductDataValue { readonly value: number; readonly source: string; readonly stationId: string; readonly period: string }
/** Generated document product. */
export interface DocumentProduct { readonly id: ProductId; readonly kind: ProductKind; readonly title: string; readonly sections: readonly { readonly heading: string; readonly body: string }[]; readonly body: string; readonly citations: readonly ProductCitation[]; readonly provenance: readonly ProductDataValue[]; readonly state: ProductState; readonly history: readonly ProductTransition[]; readonly version: number }
/** One explicit actor-attributed lifecycle transition. */
export interface ProductTransition { readonly from: ProductState; readonly to: ProductState; readonly actor: string; readonly action: ProductAction; readonly at: string }
/** Legal action names. */
export type ProductAction = 'submit' | 'approve' | 'reject' | 'revise' | 'publish' | 'archive'
/** Immutable publication artifact. */
export interface ReleaseArtifact { readonly productId: ProductId; readonly version: number; readonly publishedAt: string; readonly actor: string; readonly title: string; readonly body: string; readonly citations: readonly ProductCitation[] }
const allowed: Readonly<Record<ProductState, readonly ProductAction[]>> = { draft: ['submit'], in_review: ['approve', 'reject'], approved: ['publish'], rejected: ['revise'], published: ['publish', 'archive'], archived: [] }
/** List actions legal for a product's current state. @param state - current state. @returns legal actions. */
export function legalProductActions(state: ProductState): readonly ProductAction[] { return allowed[state] }
export interface ProductTransitionResult { readonly product: DocumentProduct; readonly transition: ProductTransition; readonly release?: ReleaseArtifact }
/** Apply an explicit lifecycle action, appending an actor-attributed event. @param product - product being changed. @param action - requested transition. @param actor - responsible person or system. @param at - ISO instant of transition. @returns updated product, transition, and optional immutable release. */
export function transitionProduct(product: DocumentProduct, action: ProductAction, actor: string, at: string): ProductTransitionResult {
  if (!actor.trim()) throw new Error('Product transition requires an actor')
  if (!allowed[product.state].includes(action)) throw new Error(`Illegal product transition: ${product.state} via ${action}`)
  const to: ProductState = action === 'submit' ? 'in_review' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'revise' ? 'draft' : action === 'publish' ? 'published' : 'archived'
  const version = action === 'publish' ? product.version + 1 : product.version
  const transition: ProductTransition = { from: product.state, to, actor, action, at }
  const next = { ...product, state: to, version, history: [...product.history, transition] }
  if (action !== 'publish') return { product: next, transition }
  const citations = Object.freeze(product.citations.map(citation => Object.freeze({ ...citation })))
  const release = Object.freeze({ productId: product.id, version, publishedAt: at, actor, title: product.title, body: product.body, citations })
  return { product: next, transition, release }
}
/** Ensure generated prose uses only filled numeric values. @param body - proposed prose. @param values - trusted populated data. @param citations - citation list. @returns void if the body is grounded. */
export function verifyProduct(body: string, values: readonly ProductDataValue[], citations: readonly ProductCitation[]): void {
  const known = new Set(values.map(item => String(item.value)))
  const numbers = body.match(/(?:\d+(?:\.\d+)?)/g) ?? []
  const permitted = new Set(known)
  for (const number of numbers) if (!permitted.has(number)) throw new Error(`Unverified number in product body: ${number}`)
  for (const citation of citations) if (!citation.documentId || citation.ordinal < 0 || citation.charStart < 0 || citation.charEnd < citation.charStart) throw new Error('Invalid corpus citation coordinates')
}
/** Verify polishing preserves every filled number, citation, and section heading. @param before - original filled product. @param after - polished product. @returns void when the contract is preserved. */
export function verifyPolish(before: DocumentProduct, after: DocumentProduct): void {
  const nums = (product: DocumentProduct) => [...product.body, ...product.sections.flatMap(section => section.body)].join(' ').match(/(?:\d+(?:\.\d+)?)/g)?.sort().join('|') ?? ''
  if (nums(before) !== nums(after)) throw new Error('Polish changed filled numbers')
  if (JSON.stringify(before.citations) !== JSON.stringify(after.citations)) throw new Error('Polish changed citations')
  if (JSON.stringify(before.provenance) !== JSON.stringify(after.provenance)) throw new Error('Polish changed data provenance')
  if (JSON.stringify(before.sections.map(section => section.heading)) !== JSON.stringify(after.sections.map(section => section.heading))) throw new Error('Polish changed section contract')
}
