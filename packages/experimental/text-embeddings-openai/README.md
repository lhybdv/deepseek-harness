# @deepseek-ai/dsh-text-embeddings-openai
English | [中文](README.zh.md)

OpenAI-compatible `/v1/embeddings` provider. `baseURL` is the API root (for example `http://host:port/v1`), `model` is sent unchanged, and `apiKeyEnv` names the process environment variable whose value is read at request time. Configure the model and endpoint in the deployment; never place a key value in `cordis.yml`.

```yaml
- name: '@deepseek-ai/dsh-text-embeddings-openai'
  config:
    providerId: openai-compatible
    model: text-embedding-3-small
    baseURL: http://127.0.0.1:8000/v1
    apiKeyEnv: DEEPSEEK_API_KEY
```

The provider submits each document/query batch in one request, validates response count and indexes, then returns vectors in original input order. HTTP failures and missing credentials reject the operation; there is no silent lexical fallback.
