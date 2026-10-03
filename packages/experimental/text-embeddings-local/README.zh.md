# @deepseek-ai/dsh-text-embeddings-local
[English](README.md) | 中文

本地文本 embedding 使用部署方提供的 engine module；本提供方自身不依赖 native runtime。`engineModule` 配置为包名、`file:` URL 或文件系统路径，模块需导出 `createSession({ modelPath, vocabPath })`。返回的 session 实现 `embedBatch({ inputIds, attentionMask, batchSize, sequenceLength })`，返回 `{ dims: [batch, tokens, dimensions], data }`，并实现 `dispose()`。可由 `onnxruntime-node` 实现符合该接口的轻量适配模块。

```yaml
- name: '@deepseek-ai/dsh-text-embeddings-local'
  config:
    providerId: local-onnx
    engineModule: /srv/meteo/embedding-onnx-engine.mjs
    model: bge-small-zh-v1.5
    modelDir: /srv/models/bge-small-zh-v1.5-onnx
    maxTokens: 512
```

部署必须安装兼容的 engine module，并在 `modelDir` 中提供 `model.onnx` 和 uncased WordPiece `vocab.txt`。词表必须含 `[UNK]`、`[CLS]`、`[SEP]`；engine 将补齐后的 int64 token ID 和 mask 映射为与输入批次及序列匹配的 token-state 张量。模型文件缺失、模块路径无效或 engine 无法加载时会在激活时明确失败；不会静默回退到词法检索。模型来源和许可由部署方负责，提供方不会隐式下载模型。
