/** Remote controller for meteorological document product lifecycle operations. @module */
import { Context } from '@deepseek-ai/cordis'
import { legalProductActions, type DocumentProduct as StoredDocumentProduct } from '@deepseek-ai/dsh-document-products'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActRequest, ActResponse, DocumentProduct, GenerateRequest, ReleaseArtifact } from './types.ts'
export type * from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { /** Remote document products controller. */ documentProductsController: DocumentProductsController } }
/** Add the actions allowed by a product's current lifecycle state.
 * @param product - product as the lifecycle seam stores it.
 * @returns the product with its legal actions.
 */
function withLegalActions(product: StoredDocumentProduct): DocumentProduct {
  return { ...product, legalActions: legalProductActions(product.state) }
}
/** Remote facade for session-owned document product operations. */
export default class DocumentProductsController extends TypertRemoteService {
  static inject = ['documentProducts', 'typert']
  constructor(ctx: Context) { super(ctx, 'documentProductsController', { namespace: 'documentProducts' }) }
  /** Generate a verified draft in the caller session.
   * @param request - product generation fields.
   * @returns generated product with the actions its state allows.
   */
  @Remote
  generate(request: GenerateRequest): Promise<DocumentProduct> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (!session) throw new Error(`Unknown session: ${request.sessionId}`)
    return this.ctx.documentProducts.generate(session, request.input)
      .then(product => withLegalActions(product))
  }
  /** List caller-session products.
   * @param sessionId - owning session.
   * @returns retained products, each with the actions its state allows.
   */
  @Remote
  list(sessionId: SessionId): readonly DocumentProduct[] {
    const session = this.ctx.sessions.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return this.ctx.documentProducts.list(session).map(product => withLegalActions(product))
  }
  /** Apply an actor-attributed lifecycle action.
   * @param request - product, action, actor, timestamp, and replacement body for edit.
   * @returns updated product with the actions its state allows and any release.
   */
  @Remote
  act(request: ActRequest): ActResponse {
    const session = this.ctx.sessions.get(request.sessionId)
    if (!session) throw new Error(`Unknown session: ${request.sessionId}`)
    let product: DocumentProduct
    let release: ReleaseArtifact | undefined
    if (request.action === 'edit') {
      if (request.body === undefined) throw new Error('documentProducts.act edit needs body')
      product = withLegalActions(this.ctx.documentProducts.edit(session, request.id, request.body, request.actor, request.at))
    } else {
      const result = this.ctx.documentProducts.act(session, request.id, request.action, request.actor, request.at)
      product = withLegalActions(result.product)
      release = result.release
    }
    return { product, ...(release === undefined ? {} : { release }) }
  }
  /** List immutable publication releases. @param sessionId - owning session. @returns releases in publication order. */
  @Remote
  releases(sessionId: SessionId): readonly ReleaseArtifact[] { const session = this.ctx.sessions.get(sessionId); if (!session) throw new Error(`Unknown session: ${sessionId}`); return this.ctx.documentProducts.releases(session) }
}
