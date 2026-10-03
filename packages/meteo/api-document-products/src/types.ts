/** JSON-safe request and response contracts for document product Remote operations. */
import type { DocumentProduct, GenerateProductInput, ProductAction, ProductId, ReleaseArtifact } from '@deepseek-ai/dsh-document-products'
import type { SessionId } from '@deepseek-ai/dsh-session'
/** Explicit fields for creating a verified draft in a session. */
export interface GenerateRequest { readonly sessionId: SessionId; readonly input: GenerateProductInput }
/** Explicit lifecycle transition request. */
export interface ActRequest { readonly sessionId: SessionId; readonly id: ProductId; readonly action: ProductAction; readonly actor: string; readonly at: string }
/** Product action response including an optional immutable release. */
export interface ActResponse { readonly product: DocumentProduct; readonly release?: ReleaseArtifact }
