# @deepseek-ai/dsh-text-embeddings
English | [中文](README.zh.md)

Provider-neutral batched document and query embeddings. The service records each provider's local/remote location, exposes a disposer-returning registry, and separates caller `EmbeddingRequest` from explicitly resolved `EmbeddingSpec`. Mount the service before the provider and corpus index:

```yaml
- name: '@deepseek-ai/dsh-text-embeddings'
  config: { defaultProvider: openai-compatible }
- name: '@deepseek-ai/dsh-text-embeddings-openai'
  config: { providerId: openai-compatible, model: text-embedding-3-small, baseURL: http://127.0.0.1:8000/v1, apiKeyEnv: DEEPSEEK_API_KEY }
```

`resolve()` pins one exact provider; `embed()` sends the batch as documents or queries and rejects if the provider is removed, returns the wrong number of vectors, or returns non-finite/inconsistent dimensions. Providers must keep input order. This is an experimental capability; consumers should persist model identity with indexed vectors and rebuild after changing embedding models.
