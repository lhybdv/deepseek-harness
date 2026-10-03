/** Session event contract for replaying product lifecycle transitions. @module */
import type { Session } from '@deepseek-ai/dsh-session'
import type { DocumentProduct, ProductAction, ProductId, ProductState, ProductTransitionResult, ReleaseArtifact } from './product.ts'
import { transitionProduct } from './product.ts'
/** Product creation event carrying the complete initial record for replay. */
export interface ProductCreatedEvent { readonly kind: 'meteo/product-created'; readonly version: 1; readonly product: DocumentProduct }
declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'meteo/product-created': ProductCreatedEvent } }
/** Append the complete generated product for session replay. @param session - owning session log. @param product - initial generated product. */
export function appendProductCreated(session: Session, product: DocumentProduct): void {
  session.append('meteo/product-created', { kind: 'meteo/product-created', version: 1, product })
}
/** Append-only lifecycle event. */
export interface ProductSessionEvent { readonly kind: 'meteo/product-transition'; readonly version: 1; readonly productId: ProductId; readonly action: ProductAction; readonly actor: string; readonly from: ProductState; readonly to: ProductState; readonly at: string; readonly release?: ReleaseArtifact }
declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'meteo/product-transition': ProductSessionEvent } }
/** Apply and record a transition in the owning session. @param session - session log. @param product - current product. @param action - requested transition. @param actor - actor responsible. @param at - ISO instant. @returns updated product with a release when published. */
export function transitionInSession(session: Session, product: DocumentProduct, action: ProductAction, actor: string, at: string): ProductTransitionResult {
  const result = transitionProduct(product, action, actor, at)
  const { transition } = result
  session.append('meteo/product-transition', { kind: 'meteo/product-transition', version: 1, productId: product.id, action, actor, from: transition.from, to: transition.to, at, ...(result.release ? { release: result.release } : {}) })
  return result
}
