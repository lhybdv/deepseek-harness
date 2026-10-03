# @deepseek-ai/dsh-text-embeddings
[English](README.md) | 中文

提供与提供方无关的文档与查询批量 embedding 能力。服务记录每个提供方的位置（本地或远端），提供返回 disposer 的注册表，并将调用方 `EmbeddingRequest` 与显式解析后的 `EmbeddingSpec` 分离。先挂载服务，再挂载提供方与语料索引：

```yaml
- name: '@deepseek-ai/dsh-text-embeddings'
  config: { defaultProvider: openai-compatible }
- name: '@deepseek-ai/dsh-text-embeddings-openai'
  config: { providerId: openai-compatible, model: text-embedding-3-small, baseURL: http://127.0.0.1:8000/v1, apiKeyEnv: DEEPSEEK_API_KEY }
```

`resolve()` 固定一个确切提供方；`embed()` 按文档或查询类型发送批次，并在提供方被移除、向量数量错误、维度不一致或含非有限数字时拒绝。提供方必须保持输入顺序。该能力处于实验阶段；调用方应随索引向量保存模型身份，并在更换模型后重建索引。
