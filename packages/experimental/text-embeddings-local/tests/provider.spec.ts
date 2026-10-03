/** Local model deployment validation and deterministic tokenizer behavior. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, Config, resolveEngineSpecifier, run, validateModelDirectory, wordPieceTokenizer } from '../src/index.ts'
import type { EmbeddingProvider } from '@deepseek-ai/dsh-text-embeddings'
let temporary: string | undefined
afterEach(async () => { if (temporary !== undefined) await rm(temporary, { recursive: true, force: true }) })

describe('deployment-supplied embedding engine', () => {
  it('requires engine module, model directory, and valid sequence length', () => {
    expect(() => Config({})).toThrow()
    expect(() => Config({ engineModule: 'engine', modelDir: '/model', maxTokens: 1 })).toThrow()
    expect(() => Config({ engineModule: '  ', modelDir: '/model' })).toThrow()
    expect(Config({ engineModule: 'onnxruntime-node', modelDir: '/model' }))
      .toMatchObject({ engineModule: 'onnxruntime-node', modelDir: '/model', maxTokens: 512 })
  })

  it('resolves configured package names and filesystem module paths', () => {
    expect(resolveEngineSpecifier('onnxruntime-node')).toBe('onnxruntime-node')
    expect(resolveEngineSpecifier('./engine.mjs')).toContain('engine.mjs')
    expect(() => resolveEngineSpecifier('invalid engine')).toThrow('engineModule')
    expect(() => resolveEngineSpecifier('file:bad')).toThrow('engineModule')
  })

  it('fails model validation when deployment files are absent', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'embedding-model-'))
    await expect(validateModelDirectory(temporary)).rejects.toThrow('supply model.onnx and vocab.txt')
  })

  it('accepts deployment-provided model and vocabulary files', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'embedding-model-'))
    await writeFile(join(temporary, 'model.onnx'), 'model')
    await writeFile(join(temporary, 'vocab.txt'), '[UNK]\n[CLS]\n[SEP]\nhello\n##s')
    await expect(validateModelDirectory(temporary)).resolves.toEqual({
      modelPath: join(temporary, 'model.onnx'), vocabPath: join(temporary, 'vocab.txt'),
    })
  })

  it('tokenizes WordPiece segments, unknown words, and sequence boundaries', () => {
    const tokenizer = wordPieceTokenizer('[UNK]\n[CLS]\n[SEP]\nhello\n##s')
    expect(tokenizer.encode('hellos unknown', 8)).toEqual([1, 3, 4, 0, 2])
    expect(tokenizer.encode('hellos', 3)).toEqual([1, 3, 2])
    expect(() => wordPieceTokenizer('hello')).toThrow('[UNK]')
  })
  it('normalizes file URLs and tokenizes whitespace-only input', () => {
    expect(resolveEngineSpecifier('file:///tmp/embedding-engine.mjs')).toBe('file:///tmp/embedding-engine.mjs')
    expect(() => resolveEngineSpecifier(' ')).toThrow('engineModule')
    const tokenizer = wordPieceTokenizer('[UNK]\n[CLS]\n[SEP]')
    expect(tokenizer.encode(' \t\n', 8)).toEqual([1, 2])
  })

  it('handles empty batches, cancellation, and malformed engine output', async () => {
    const tokenizer = wordPieceTokenizer('[UNK]\n[CLS]\n[SEP]\nhello')
    const session = {
      embedBatch: async ({ batchSize, sequenceLength }: { batchSize: number; sequenceLength: number }) => ({
        dims: [batchSize, sequenceLength, 1] as const,
        data: new Float32Array(batchSize * sequenceLength),
      }),
      dispose: async () => {},
    }
    await expect(run(session, tokenizer, 8, [])).resolves.toEqual([])
    const aborted = new AbortController()
    aborted.abort()
    await expect(run(session, tokenizer, 8, ['hello'], aborted.signal)).rejects.toThrow()
    const malformed = { ...session, embedBatch: async () => ({ dims: [0, 1, 1] as const, data: new Float32Array(0) }) }
    await expect(run(malformed, tokenizer, 8, ['hello'])).rejects.toThrow('malformed batch dimensions')
    const during = new AbortController()
    const aborting = {
      ...session,
      embedBatch: async ({ batchSize, sequenceLength }: { batchSize: number; sequenceLength: number }) => {
        during.abort()
        return { dims: [batchSize, sequenceLength, 1] as const, data: new Float32Array(batchSize * sequenceLength) }
      },
    }
    await expect(run(aborting, tokenizer, 8, ['hello'], during.signal)).rejects.toThrow()
  })

  it('loads the configured fixture engine, embeds a batch, and disposes its session', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'embedding-model-'))
    await writeFile(join(temporary, 'model.onnx'), 'fixture')
    await writeFile(join(temporary, 'vocab.txt'), '[UNK]\n[CLS]\n[SEP]\nhello\n##s')
    const engineModule = fileURLToPath(new URL('./fixtures/engine.mjs', import.meta.url))
    const fixture = await import(engineModule) as { state: { batchCalls: number; disposed: boolean; modelPath: string } }
    fixture.state.batchCalls = 0
    fixture.state.disposed = false
    let registered: EmbeddingProvider | undefined
    const ctx = new Context()
    ctx.provide('textEmbeddings', {
      register(provider: EmbeddingProvider) {
        registered = provider
        return async () => { registered = undefined }
      },
    } as never)
    const config = Config({ engineModule, modelDir: temporary })
    await apply(ctx, config)
    expect(registered?.info.location).toBe('local')
    await expect(registered?.embedQueries(['hello'])).resolves.toEqual([[1, 2]])
    await expect(registered?.embedDocuments(['hellos', 'hello'])).resolves.toEqual([[1, 2], [1, 2]])
    expect(fixture.state.batchCalls).toBe(2)
    expect(fixture.state.modelPath).toBe(join(temporary, 'model.onnx'))
    await ctx.fiber.dispose()
    expect(registered).toBeUndefined()
    expect(fixture.state.disposed).toBe(true)
  })

  it('reports an unavailable configured engine module without fallback', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'embedding-model-'))
    await writeFile(join(temporary, 'model.onnx'), 'fixture')
    await writeFile(join(temporary, 'vocab.txt'), '[UNK]\n[CLS]\n[SEP]')
    const ctx = new Context()
    ctx.provide('textEmbeddings', { register: () => async () => {} } as never)
    await expect(apply(ctx, Config({ engineModule: 'missing-embedding-engine', modelDir: temporary })))
      .rejects.toThrow('engineModule "missing-embedding-engine"')
  })
  it('rejects modules without a usable createSession export', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'embedding-engine-contract-'))
    await writeFile(join(temporary, 'model.onnx'), 'fixture')
    await writeFile(join(temporary, 'vocab.txt'), '[UNK]\n[CLS]\n[SEP]')
    const ctx = new Context()
    ctx.provide('textEmbeddings', { register: () => async () => {} } as never)
    const engineModule = join(temporary, 'invalid-engine.mjs')
    await writeFile(engineModule, 'export const invalid = true')
    await expect(apply(ctx, Config({ engineModule, modelDir: temporary }))).rejects.toThrow('does not export createSession')
    const stringEngine = join(temporary, 'string-engine.mjs')
    await writeFile(stringEngine, 'export async function createSession() { throw "engine failure" }')
    await expect(apply(ctx, Config({ engineModule: stringEngine, modelDir: temporary }))).rejects.toThrow('engine failure')
  })
})
