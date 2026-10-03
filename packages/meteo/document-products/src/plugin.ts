/** Cordis service registration for live document product workflows. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import type { MeteoData } from '@deepseek-ai/dsh-meteo-data'
import type { Config as ProductConfig } from './config.ts'
import { assertConfig } from './config.ts'
import { generateFromResolvedHazard, generateProduct } from './generate.ts'
import type { GenerateProductInput, ProductComposer, ResolvedHazard } from './generate.ts'
import { appendProductCreated, transitionInSession } from './events.ts'
import type { DocumentProduct, ProductAction, ProductId, ReleaseArtifact } from './product.ts'
/** Session-owned access to generated products, releases, and legal state transitions. */
export class DocumentProductService {
  private readonly bySession = new Map<Session, { products: Map<ProductId, DocumentProduct>; releases: ReleaseArtifact[] }>()
  private readonly hazardProducts = new Map<Session, Map<string, Promise<DocumentProduct>>>()
  constructor(private readonly data: MeteoData, private readonly corpus: CorpusStore, private readonly config: Required<ProductConfig>) {}
  /** Generate and retain a manually requested draft in a session. @param session - owning session. @param input - explicit product fields. @param compose - optional professional wording adapter. @returns verified draft. */
  async generate(session: Session, input: GenerateProductInput, compose?: ProductComposer): Promise<DocumentProduct> {
    const product = await generateProduct(this.data, this.corpus, { ...input, forecastHours: input.forecastHours ?? this.config.forecastHours, citationLimit: input.citationLimit ?? this.config.citationLimit }, compose)
    appendProductCreated(session, product)
    this.records(session).products.set(product.id, product)
    return product
  }
  /**
   * Generate one warning draft after a rule engine resolves a hazard grade.
   * Identical station/hazard/grade/period requests within the same session share
   * the same in-flight or completed product; a failed attempt is evicted, so a
   * later manual or automatic request can retry without a partial event.
   * @param session - owning session.
   * @param grading - resolved station hazard and inclusive data period.
   * @param compose - optional professional wording adapter.
   * @returns the verified warning draft for this grading.
   */
  async hazardResolved(session: Session, grading: ResolvedHazard, compose?: ProductComposer): Promise<DocumentProduct> {
    let products = this.hazardProducts.get(session)
    if (!products) { products = new Map(); this.hazardProducts.set(session, products) }
    const key = JSON.stringify([grading.stationId, grading.hazard, grading.grade, grading.from, grading.to])
    const existing = products.get(key)
    if (existing) return existing
    const generated = generateFromResolvedHazard(this.data, this.corpus, { ...grading, forecastHours: this.config.forecastHours, citationLimit: this.config.citationLimit }, compose)
    const pending = generated.then(product => {
      appendProductCreated(session, product)
      this.records(session).products.set(product.id, product)
      return product
    }).catch(error => {
      products.delete(key)
      throw error
    })
    products.set(key, pending)
    return pending
  }
  /** List products retained for a session. @param session - owning session. @returns products in insertion order. */
  list(session: Session): readonly DocumentProduct[] { return [...this.records(session).products.values()] }
  /** List immutable releases for a session. @param session - owning session. @returns releases in publication order. */
  releases(session: Session): readonly ReleaseArtifact[] { return this.records(session).releases }
  /** Validate, apply, and record an explicit actor's state transition. @param session - owning session. @param id - product identity. @param action - requested transition. @param actor - responsible user or service. @param at - ISO timestamp. @returns updated product and optional release. */
  act(session: Session, id: ProductId, action: ProductAction, actor: string, at: string): { readonly product: DocumentProduct; readonly release?: ReleaseArtifact } {
    const records = this.records(session)
    const current = records.products.get(id)
    if (!current) throw new Error(`Unknown document product: ${id}`)
    const result = transitionInSession(session, current, action, actor, at)
    records.products.set(id, result.product)
    if (result.release) records.releases.push(result.release)
    return result
  }
  private records(session: Session): { products: Map<ProductId, DocumentProduct>; releases: ReleaseArtifact[] } {
    let records = this.bySession.get(session)
    if (!records) { records = { products: new Map(), releases: [] }; this.bySession.set(session, records) }
    return records
  }
}
/** Cordis plugin identifier. */
export const name = 'meteo-document-products'
/** Data and corpus capability services required to provide generation. */
export const inject = ['meteoData', 'corpus']
declare module '@deepseek-ai/cordis' { interface Context { documentProducts: DocumentProductService } }
/** Register the scoped product API and remove it when the plugin is disposed. @param ctx - context providing the shared data seams. @param config - validated deployment limits. */
export function apply(ctx: Context, config: ProductConfig): void {
  const resolved = config as Required<ProductConfig>
  assertConfig(resolved)
  ctx.effect(() => ctx.provide('documentProducts', new DocumentProductService(ctx.meteoData, ctx.corpus, resolved)))
}
