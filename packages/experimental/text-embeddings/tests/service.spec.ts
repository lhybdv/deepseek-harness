/** Provider selection, batched execution, validation, and disposer behavior. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import TextEmbeddings from '../src/index.ts'
import type { EmbeddingProvider } from '../src/types.ts'

function provider(id: string, overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    info: { id: id as never, name: id, location: 'local', model: 'fixture' },
    embedDocuments: async texts => texts.map(() => [1, 0]),
    embedQueries: async texts => texts.map(() => [0, 1]),
    ...overrides,
  }
}

describe('text embedding registry', () => {
  it('routes document and query batches through an explicitly resolved provider', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextEmbeddings, { defaultProvider: 'fixture' })
    try {
      const remove = ctx.textEmbeddings.register(provider('fixture'))
      expect(ctx.textEmbeddings.listProviders()).toMatchObject([{ id: 'fixture', location: 'local' }])
      const documentSpec = ctx.textEmbeddings.resolve({ texts: ['a', 'b'], kind: 'documents' })
      const querySpec = ctx.textEmbeddings.resolve({ texts: ['q'], kind: 'queries' })
      await expect(ctx.textEmbeddings.embed(documentSpec)).resolves.toEqual([[1, 0], [1, 0]])
      await expect(ctx.textEmbeddings.embed(querySpec, new AbortController().signal)).resolves.toEqual([[0, 1]])
      await remove()
      await remove()
      expect(ctx.textEmbeddings.listProviders()).toEqual([])
      expect(() => ctx.textEmbeddings.resolve({ texts: ['x'], kind: 'queries' })).toThrow('unavailable')
      await expect(ctx.textEmbeddings.embed(querySpec)).rejects.toThrow('no longer registered')
    } finally { await fiber.dispose() }
  })

  it('uses a request-level provider override and rejects duplicate ids', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextEmbeddings, { defaultProvider: 'missing' })
    try {
      ctx.textEmbeddings.register(provider('alternate'))
      expect(ctx.textEmbeddings.resolve({ providerId: 'alternate' as never, texts: ['q'], kind: 'queries' }).provider.info.id).toBe('alternate')
      expect(() => ctx.textEmbeddings.register(provider('alternate'))).toThrow('already registered')
      expect(() => ctx.textEmbeddings.resolve({ texts: ['q'], kind: 'queries' })).toThrow('unavailable')
    } finally { await fiber.dispose() }
  })

  it('rejects wrong vector counts and malformed vector dimensions', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextEmbeddings, { defaultProvider: 'wrong-count' })
    try {
      ctx.textEmbeddings.register(provider('wrong-count', { embedQueries: async () => [[1, 2]] }))
      await expect(ctx.textEmbeddings.embed(ctx.textEmbeddings.resolve({ texts: ['a', 'b'], kind: 'queries' })))
        .rejects.toThrow('vector count')
    } finally { await fiber.dispose() }
    const malformed = new Context()
    const other = await malformed.plugin(TextEmbeddings, { defaultProvider: 'bad-vector' })
    try {
      malformed.textEmbeddings.register(provider('bad-vector', { embedQueries: async () => [[1], [Number.NaN]] }))
      await expect(malformed.textEmbeddings.embed(malformed.textEmbeddings.resolve({ texts: ['a', 'b'], kind: 'queries' })))
        .rejects.toThrow('malformed vectors')
    } finally { await other.dispose() }
  })

  it('cancels and joins a pending call when its provider is disposed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextEmbeddings, { defaultProvider: 'slow' })
    try {
      let settled = (): void => {}
      const providerResult = new Promise<readonly (readonly number[])[]>(resolve => { settled = () => resolve([[1]]) })
      const remove = ctx.textEmbeddings.register(provider('slow', { embedQueries: async () => await providerResult }))
      const running = ctx.textEmbeddings.embed(ctx.textEmbeddings.resolve({ texts: ['q'], kind: 'queries' }))
      const disposal = remove()
      settled()
      await disposal
      await expect(running).rejects.toThrow('unloaded')
    } finally { await fiber.dispose() }
  })
})
