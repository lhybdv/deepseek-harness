/** Named speech synthesis providers with disposable registration. */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SpeechSynthesisProvider, SpeechSynthesisProviderId, SpeechSynthesisRequest } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { /** Experimental speech synthesis registry. */ speechSynthesis: SpeechSynthesis } }

/** Live provider selection. */
export interface Config { /** Registered provider selected by default. */ defaultProvider: string }
interface Registration { readonly provider: SpeechSynthesisProvider; readonly lifetime: AbortController; readonly pending: Set<Promise<unknown>> }

/** Registry shared by synthesis consumers in one Host composition. */
export default class SpeechSynthesis extends Service {
  static Config = z.object({ defaultProvider: z.string().min(1).required() })
  private readonly providers = new Map<SpeechSynthesisProviderId, Registration>()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speechSynthesis')
    ctx.effect(() => async () => { await Promise.all([...this.providers.values()].map(item => this.remove(item))) })
  }
  /** Register one provider; duplicate ids fail without replacing the original. @param provider - contributing provider. @returns idempotent disposer. */
  register(provider: SpeechSynthesisProvider): () => Promise<void> {
    if (this.providers.has(provider.info.id)) throw new Error(`Speech synthesis provider already registered: ${provider.info.id}`)
    const item = { provider, lifetime: new AbortController(), pending: new Set<Promise<unknown>>() }
    this.providers.set(provider.info.id, item)
    return async () => { await this.remove(item) }
  }
  private async remove(item: Registration): Promise<void> {
    if (this.providers.get(item.provider.info.id) !== item) return
    this.providers.delete(item.provider.info.id)
    item.lifetime.abort(new Error('Speech synthesis provider unloaded'))
    await Promise.allSettled(item.pending)
  }
  /** Synthesize through the configured provider. @param request - text to synthesize. @param signal - caller cancellation. @returns provider audio bytes. */
  async synthesize(request: SpeechSynthesisRequest, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    signal.throwIfAborted()
    const id = this.config.defaultProvider as SpeechSynthesisProviderId
    const item = this.providers.get(id)
    if (!item) throw new Error(`Speech synthesis provider is unavailable: ${id}`)
    const combined = AbortSignal.any([signal, item.lifetime.signal])
    const pending = Promise.resolve().then(() => { combined.throwIfAborted(); return item.provider.synthesize(request, combined) })
    item.pending.add(pending)
    try { const result = await pending; combined.throwIfAborted(); return result }
    finally { item.pending.delete(pending) }
  }
}
