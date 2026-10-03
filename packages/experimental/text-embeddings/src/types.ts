/** Provider-neutral text embedding inputs, metadata, and vectors. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque registered provider identity. */
export type EmbeddingProviderId = Branded<'EmbeddingProviderId'>

/** Public provider facts; locality is explicit and no secrets are exposed. */
export interface EmbeddingProviderInfo {
  readonly id: EmbeddingProviderId
  readonly name: string
  readonly location: 'local' | 'remote'
  readonly model: string
}

/** Provider execution contract for document and query batches. */
export interface EmbeddingProvider {
  readonly info: EmbeddingProviderInfo
  embedDocuments(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>
  embedQueries(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>
}

/** Caller intent before service defaults are applied. */
export interface EmbeddingRequest {
  readonly providerId?: EmbeddingProviderId
  readonly texts: readonly string[]
  readonly kind: 'documents' | 'queries'
}

/** Explicitly resolved request pins the exact provider instance. */
export interface EmbeddingSpec {
  readonly provider: EmbeddingProvider
  readonly texts: readonly string[]
  readonly kind: 'documents' | 'queries'
}
