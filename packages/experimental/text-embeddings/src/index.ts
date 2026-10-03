/** Named embedding providers with explicit routing and disposable registration. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EmbeddingProvider, EmbeddingProviderId, EmbeddingProviderInfo, EmbeddingRequest, EmbeddingSpec } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { /** Batched embedding provider registry. */ textEmbeddings: TextEmbeddings } }

/** Registry selection defaults. */
export interface Config { defaultProvider: string }
interface Registration { provider: EmbeddingProvider; lifetime: AbortController; pending: Set<Promise<unknown>> }

/** Provider registry; callers resolve once, then execute the pinned provider. */
export default class TextEmbeddings extends Service {
  static Config = z.object({ defaultProvider: z.string().min(1).required() })
  private readonly providers = new Map<EmbeddingProviderId, Registration>()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'textEmbeddings')
    ctx.effect(() => async () => { await Promise.all([...this.providers.values()].map(reg => this.remove(reg))) })
  }
  /** Register one provider and return its disposer. @param provider - provider implementation. @returns idempotent removal operation. */
  register(provider: EmbeddingProvider): () => Promise<void> {
    if (this.providers.has(provider.info.id)) throw new Error(`Embedding provider already registered: ${provider.info.id}`)
    const registration: Registration = { provider, lifetime: new AbortController(), pending: new Set() }
    this.providers.set(provider.info.id, registration)
    return async () => { await this.remove(registration) }
  }
  private async remove(registration: Registration): Promise<void> {
    if (this.providers.get(registration.provider.info.id) !== registration) return
    this.providers.delete(registration.provider.info.id)
    registration.lifetime.abort(new Error('Embedding provider unloaded'))
    await Promise.allSettled(registration.pending)
  }
  /** List registered providers. @returns safe provider facts in registration order. */
  listProviders(): readonly EmbeddingProviderInfo[] { return [...this.providers.values()].map(({ provider }) => provider.info) }
  /** Apply the configured provider only at an explicit resolve boundary. @param request - caller intent. @returns provider-pinned embedding spec. */
  resolve(request: EmbeddingRequest): EmbeddingSpec {
    const id = request.providerId ?? this.config.defaultProvider as EmbeddingProviderId
    const provider = this.providers.get(id)?.provider
    if (!provider) throw new Error(`Embedding provider is unavailable: ${id}`)
    return { provider, texts: request.texts, kind: request.kind }
  }
  /** Embed a batch with the resolved provider and preserve input order. @param spec - resolved provider and batch. @param signal - optional caller cancellation. @returns one vector for each input text. */
  async embed(spec: EmbeddingSpec, signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    signal?.throwIfAborted()
    const registration = this.providers.get(spec.provider.info.id)
    if (registration?.provider !== spec.provider) throw new Error('Resolved embedding provider is no longer registered')
    const combined = signal === undefined ? registration.lifetime.signal : AbortSignal.any([signal, registration.lifetime.signal])
    const task = Promise.resolve().then(() => spec.kind === 'documents'
      ? spec.provider.embedDocuments(spec.texts, combined)
      : spec.provider.embedQueries(spec.texts, combined))
    registration.pending.add(task)
    try {
      const vectors = await task
      combined.throwIfAborted()
      if (vectors.length !== spec.texts.length) throw new Error('Embedding provider returned a vector count different from the input count')
      const dimension = vectors[0]?.length
      if (dimension === 0 || (dimension !== undefined && vectors.some(vector =>
        vector.length !== dimension || vector.some(value => !Number.isFinite(value))))) {
        throw new Error('Embedding provider returned malformed vectors')
      }
      return vectors
    } finally { registration.pending.delete(task) }
  }
}
