/** Local ONNX embeddings provider with a deployment-supplied WordPiece model directory. */
import { readFile, access } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EmbeddingProvider, EmbeddingProviderId } from '@deepseek-ai/dsh-text-embeddings'

/** Configurable embedding engine, model location, and sequence bound. */
export interface Config { providerId: string; engineModule: string; modelDir: string; model: string; maxTokens: number }
/** WordPiece tokenization contract. */
interface Tokenizer { encode(text: string, max: number): number[] }
/** Dense token output returned by one engine inference batch. */
export interface EngineOutput { readonly dims: readonly [number, number, number]; readonly data: ArrayLike<number> }
/** Session adapter required from the deployment-supplied engine. */
export interface EngineSession {
  embedBatch(input: { inputIds: BigInt64Array; attentionMask: BigInt64Array; batchSize: number; sequenceLength: number }): Promise<EngineOutput>
  dispose(): Promise<void>
}
/** Module contract loaded from the validated deployment config. */
export interface EmbeddingEngineModule {
  createSession(paths: { modelPath: string; vocabPath: string }): Promise<EngineSession>
}
/** Validate model deployment files before registering the provider. @param modelDir - configured directory. @returns absolute model and vocabulary paths. */
export async function validateModelDirectory(modelDir: string): Promise<{ modelPath: string; vocabPath: string }> {
  const directory = resolve(modelDir)
  const modelPath = join(directory, 'model.onnx')
  const vocabPath = join(directory, 'vocab.txt')
  try { await access(modelPath); await access(vocabPath) }
  catch { throw new Error(`Local embedding model is incomplete at ${directory}; supply model.onnx and vocab.txt`) }
  return { modelPath, vocabPath }
}
/** Resolve a package, file URL, or local path to an importable engine module. @param configured - deployment engineModule value. @returns normalized import specifier. */
export function resolveEngineSpecifier(configured: string): string {
  const value = configured.trim()
  if (value.length === 0) throw new Error('engineModule must name a loadable module')
  if (value.startsWith('file:')) {
    if (!value.startsWith('file:///')) throw new Error(`engineModule is not a valid file URL: ${configured}`)
    return new URL(value).href
  }
  if (isAbsolute(value) || value.startsWith('./') || value.startsWith('../')) return pathToFileURL(resolve(value)).href
  if (/^[A-Za-z@][\w@./-]*$/.test(value)) return value
  throw new Error(`engineModule is not a valid package name, file URL, or path: ${configured}`)
}

/** Local provider plugin metadata. */
export const name = 'experimental-text-embeddings-local'
/** Capability registry dependency. */
export const inject = ['textEmbeddings']
/** Validated model engine, model directory, and sequence limit. */
export const Config = z.object({
  providerId: z.string().min(1).default('local-onnx'),
  engineModule: z.string().min(1).pattern(/\S/).required(),
  modelDir: z.string().min(1).required(),
  model: z.string().min(1).default('local-onnx'),
  maxTokens: z.natural().min(2).default(512),
})
/** Register provider after loading the configured engine and model. @param ctx - Host registry owner. @param config - engine module, model directory, and sequence bound. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const paths = await validateModelDirectory(config.modelDir)
  let engine: EmbeddingEngineModule
  let session: EngineSession
  try {
    engine = await import(resolveEngineSpecifier(config.engineModule)) as EmbeddingEngineModule
    if (typeof engine.createSession !== 'function') throw new Error('module does not export createSession')
    session = await engine.createSession(paths)
  } catch (error) {
    throw new Error(`Unable to load local embedding engine from engineModule "${config.engineModule}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const tokenizer = wordPieceTokenizer(await readFile(paths.vocabPath, 'utf8'))
  const provider: EmbeddingProvider = {
    info: { id: config.providerId as EmbeddingProviderId, name: config.model, location: 'local', model: config.model },
    embedDocuments: (texts, signal) => run(session, tokenizer, config.maxTokens, texts, signal),
    embedQueries: (texts, signal) => run(session, tokenizer, config.maxTokens, texts, signal),
  }
  ctx.effect(async () => {
    const unregister = ctx.textEmbeddings.register(provider)
    return async () => {
      await unregister()
      await session.dispose()
    }
  })
}
/** Build a basic uncased WordPiece tokenizer from vocab.txt. @param contents - one token per line. @returns tokenizer using CLS/SEP and UNK tokens. */
export function wordPieceTokenizer(contents: string): Tokenizer {
  const ids = new Map(contents.split(/\r?\n/).map((token, index) => [token, index]))
  const unk = ids.get('[UNK]')
  if (unk === undefined || ids.get('[CLS]') === undefined || ids.get('[SEP]') === undefined) throw new Error('Embedding vocab.txt must contain [UNK], [CLS], and [SEP]')
  return { encode(text, max) {
    const output = [ids.get('[CLS]')!]
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? []) {
      let start = 0, pieces: number[] = []
      while (start < word.length) {
        let end = word.length, piece: number | undefined
        while (end > start) { piece = ids.get(`${start === 0 ? '' : '##'}${word.slice(start, end)}`); if (piece !== undefined) break; end-- }
        if (piece === undefined) { pieces = [unk]; break }
        pieces.push(piece); start = end
      }
      output.push(...pieces.slice(0, Math.max(0, max - output.length - 1)))
      if (output.length >= max - 1) break
    }
    output.push(ids.get('[SEP]')!)
    return output
  } }
}
/** Run one padded provider batch and mean-pool token outputs. @param session - loaded embedding engine session. @param tokenizer - loaded WordPiece vocabulary. @param maxTokens - configured sequence bound. @param texts - ordered batch. @param signal - provider lifetime. @returns mean pooled vectors. */
export async function run(session: EngineSession, tokenizer: Tokenizer, maxTokens: number, texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
  signal?.throwIfAborted()
  if (texts.length === 0) return []
  const rows = texts.map(text => tokenizer.encode(text, maxTokens))
  const sequenceLength = Math.max(...rows.map(tokens => tokens.length))
  const inputIds = new BigInt64Array(rows.length * sequenceLength)
  const attentionMask = new BigInt64Array(rows.length * sequenceLength)
  rows.forEach((tokens, row) => tokens.forEach((token, column) => {
    inputIds[row * sequenceLength + column] = BigInt(token)
    attentionMask[row * sequenceLength + column] = 1n
  }))
  const tensor = await session.embedBatch({ inputIds, attentionMask, batchSize: rows.length, sequenceLength })
  signal?.throwIfAborted()
  const [batchSize, tokenCount, width] = tensor.dims
  if (batchSize !== rows.length || tokenCount < sequenceLength || width < 1 || tensor.data.length < batchSize * tokenCount * width) {
    throw new Error('Embedding engine returned malformed batch dimensions')
  }
  return rows.map((tokens, row) => {
    const length = Math.min(tokens.length, tokenCount)
    const vector = new Array<number>(width).fill(0)
    for (let token = 0; token < length; token++) {
      for (let dimension = 0; dimension < width; dimension++) {
        vector[dimension]! += tensor.data[(row * tokenCount + token) * width + dimension]! / length
      }
    }
    return vector
  })
}
