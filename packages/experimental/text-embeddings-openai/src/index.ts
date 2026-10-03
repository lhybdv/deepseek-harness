/** OpenAI-compatible `/v1/embeddings` provider. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EmbeddingProvider, EmbeddingProviderId } from '@deepseek-ai/dsh-text-embeddings'

/** Validated deployment settings; apiKeyEnv names an environment variable, never its value. */
export interface Config { providerId: string; model: string; baseURL: string; apiKeyEnv: string }
/** OpenAI-compatible embedding response shape. */
interface ResponseBody { data: { index: number; embedding: number[] }[] }
/** Validate untrusted OpenAI-compatible response payload before indexing vectors. @param value - parsed JSON body. @returns true for a response with indexed finite numeric vectors. */
function isResponseBody(value: unknown): value is ResponseBody {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data)) return false
  return value.data.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('index' in item) || !('embedding' in item)) return false
    return typeof item.index === 'number'
      && Number.isInteger(item.index)
      && Array.isArray(item.embedding)
      && item.embedding.length > 0
      && item.embedding.every((number: unknown) => typeof number === 'number' && Number.isFinite(number))
  })
}

/** Register a remote embeddings API provider. */
export const name = 'experimental-text-embeddings-openai'
export const inject = ['textEmbeddings']
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('openai-compatible'),
  model: z.string().min(1).required(),
  baseURL: z.string().min(1).default('https://api.openai.com/v1'),
  apiKeyEnv: z.string().min(1).default('OPENAI_API_KEY'),
})
/** Register provider; requests resolve credentials on demand. @param ctx - Host registry owner. @param config - API endpoint and model configuration. */
export function apply(ctx: Context, config: Config): void {
  const provider: EmbeddingProvider = {
    info: { id: config.providerId as EmbeddingProviderId, name: config.model, location: 'remote', model: config.model },
    embedDocuments: (texts, signal) => embed(config, texts, signal),
    embedQueries: (texts, signal) => embed(config, texts, signal),
  }
  ctx.effect(() => ctx.textEmbeddings.register(provider))
}
/** Send a batch and reorder vectors by API indexes. @param config - endpoint settings. @param texts - ordered input strings. @param signal - operation lifetime. @returns vectors in input order. */
export async function embed(config: Config, texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
  if (texts.length === 0) return []
  const key = process.env[config.apiKeyEnv]
  if (!key) throw new Error(`Embedding credential environment variable is missing: ${config.apiKeyEnv}`)
  const response = await fetch(`${config.baseURL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: texts }),
  })
  if (!response.ok) throw new Error(`Embedding request failed (${response.status})`)
  const payload: unknown = await response.json()
  if (!isResponseBody(payload)) throw new Error('Embedding response is malformed')
  if (payload.data.length !== texts.length) throw new Error('Embedding response has an unexpected vector count')
  const ordered: number[][] = Array.from({ length: texts.length }, () => [])
  for (const item of payload.data) {
    if (item.index < 0 || item.index >= texts.length || ordered[item.index]!.length !== 0) {
      throw new Error('Embedding response contains an invalid or duplicate index')
    }
    ordered[item.index] = item.embedding
  }
  return ordered
}
