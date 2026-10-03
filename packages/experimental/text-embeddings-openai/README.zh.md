# @deepseek-ai/dsh-text-embeddings-openai
[English](README.md) | 中文

OpenAI 兼容的 `/v1/embeddings` 提供方。`baseURL` 是 API 根地址（例如 `http://host:port/v1`），`model` 会原样发送，`apiKeyEnv` 指定每次请求时读取凭据值的环境变量名。请在部署中配置模型和端点；不要把密钥值放入 `cordis.yml`。

```yaml
- name: '@deepseek-ai/dsh-text-embeddings-openai'
  config:
    providerId: openai-compatible
    model: text-embedding-3-small
    baseURL: http://127.0.0.1:8000/v1
    apiKeyEnv: DEEPSEEK_API_KEY
```

提供方在一次请求中提交每个文档或查询批次，校验响应数量与索引，并按原始输入顺序返回向量。HTTP 错误与凭据缺失会使操作失败；不会静默回退到词法检索。
