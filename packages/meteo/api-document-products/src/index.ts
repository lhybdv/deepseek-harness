/** Remote controller for meteorological document product lifecycle operations. @module */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ActRequest, GenerateRequest } from './types.ts'
import type { ActResponse } from './types.ts'
import type { DocumentProduct, ReleaseArtifact } from '@deepseek-ai/dsh-document-products'
export type * from './types.ts'
import type {} from '@deepseek-ai/dsh-document-products'
declare module '@deepseek-ai/cordis' { interface Context { /** Remote document products controller. */ documentProductsController: DocumentProductsController } }
/** Remote facade for session-owned document product operations. */
export default class DocumentProductsController extends TypertRemoteService {
  static inject = ['documentProducts', 'typert']
  constructor(ctx: Context) { super(ctx, 'documentProductsController', { namespace: 'documentProducts' }) }
  /** Generate a verified draft in the caller session. @param request - product generation fields. @returns generated product. */
  @Remote
  generate(request: GenerateRequest): Promise<DocumentProduct> { const session = this.ctx.sessions.get(request.sessionId); if (!session) throw new Error(`Unknown session: ${request.sessionId}`); return this.ctx.documentProducts.generate(session, request.input) }
  /** List caller-session products. @returns retained products. */
  @Remote
  list(sessionId: SessionId): readonly DocumentProduct[] { const session = this.ctx.sessions.get(sessionId); if (!session) throw new Error(`Unknown session: ${sessionId}`); return this.ctx.documentProducts.list(session) }
  /** Apply an actor-attributed lifecycle action. @param request - product, action, actor, and timestamp. @returns updated product and optional release. */
  @Remote
  act(request: ActRequest): ActResponse { const session = this.ctx.sessions.get(request.sessionId); if (!session) throw new Error(`Unknown session: ${request.sessionId}`); return this.ctx.documentProducts.act(session, request.id, request.action, request.actor, request.at) }
  /** List immutable publication releases. @returns releases in publication order. */
  @Remote
  releases(sessionId: SessionId): readonly ReleaseArtifact[] { const session = this.ctx.sessions.get(sessionId); if (!session) throw new Error(`Unknown session: ${sessionId}`); return this.ctx.documentProducts.releases(session) }
}
