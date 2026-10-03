/** OpenAI-compatible transport contract and deployment validation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingProvider } from '@deepseek-ai/dsh-text-embeddings'
import { Config, embed } from '../src/index.ts'

const originalKey = process.env.EMBEDDING_TEST_KEY
const originalFetch = globalThis.fetch
afterEach(() => {
  if (originalKey === undefined) delete process.env.EMBEDDING_TEST_KEY
  else process.env.EMBEDDING_TEST_KEY = originalKey
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const config = Config({ providerId: 'test', model: 'fixture', baseURL: 'http://localhost:8080/v1', apiKeyEnv: 'EMBEDDING_TEST_KEY' })

describe('OpenAI-compatible embeddings', () => {
  it('sends one batch and restores vectors in input order', async () => {
    process.env.EMBEDDING_TEST_KEY = 'secret'
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('http://localhost:8080/v1/embeddings')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' })
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'fixture', input: ['甲', '乙'] })
      return new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }))
    })
    globalThis.fetch = transport
    await expect(embed(config, ['甲', '乙'])).resolves.toEqual([[1, 0], [0, 1]])
    expect(transport).toHaveBeenCalledOnce()
  })

  it('fails at request time when the named credential is absent', async () => {
    delete process.env.EMBEDDING_TEST_KEY
    await expect(embed(config, ['x'])).rejects.toThrow('EMBEDDING_TEST_KEY')
  })

  it('rejects an HTTP error without leaking response content', async () => {
    process.env.EMBEDDING_TEST_KEY = 'secret'
    globalThis.fetch = vi.fn(async () => new Response('credential secret', { status: 503 }))
    await expect(embed(config, ['x'])).rejects.toThrow('503')
    await expect(embed(config, ['x'])).rejects.not.toThrow('credential secret')
  })

  it('rejects missing and duplicated response indexes', async () => {
    process.env.EMBEDDING_TEST_KEY = 'secret'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] })))
    await expect(embed(config, ['a', 'b'])).rejects.toThrow('duplicate index')
  })
  it('handles empty batches without transport and validates malformed responses', async () => {
    process.env.EMBEDDING_TEST_KEY = 'secret'
    const transport = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] })))
    globalThis.fetch = transport as typeof fetch
    await expect(embed(config, [])).resolves.toEqual([])
    expect(transport).not.toHaveBeenCalled()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [Number.NaN] }] })))
    for (const value of [
      null, 'not an object', {}, { data: null }, { data: [null] }, { data: [{}] },
      { data: [{ index: 0 }] }, { data: [{ index: '0', embedding: [1] }] },
      { data: [{ index: 0.5, embedding: [1] }] }, { data: [{ index: 0, embedding: 'x' }] },
      { data: [{ index: 0, embedding: [] }] }, { data: [{ index: 0, embedding: [Number.NaN] }] },
    ]) {
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(value)))
      await expect(embed(config, ['x'])).rejects.toThrow('malformed')
    }
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] })))
    await expect(embed(config, ['x'])).rejects.toThrow('vector count')
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 2, embedding: [1] }] })))
    await expect(embed(config, ['x'])).rejects.toThrow('invalid or duplicate index')
  })

  it('registers a provider and routes query batches', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { apply, inject } = await import('../src/index.ts')
    process.env.EMBEDDING_TEST_KEY = 'secret'
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) expect(init.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }))
    })
    globalThis.fetch = transport
    const ctx = new Context()
    let registered: EmbeddingProvider | undefined
    ctx.provide('textEmbeddings', {
      register(provider: EmbeddingProvider) {
        registered = provider
        return async () => { registered = undefined }
      },
    } as never)
    const fiber = await ctx.plugin(Object.assign(apply, { inject }), config)
    await expect(registered?.embedQueries(['q'])).resolves.toEqual([[1]])
    await expect(registered?.embedDocuments(['d'], new AbortController().signal)).resolves.toEqual([[1]])
    await fiber.dispose()
    expect(registered).toBeUndefined()
  })
})
