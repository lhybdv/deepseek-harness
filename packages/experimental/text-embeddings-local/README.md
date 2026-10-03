# @deepseek-ai/dsh-text-embeddings-local
English | [中文](README.zh.md)

Local text embeddings use a deployment-supplied engine module; the provider has no native runtime dependency of its own. Configure `engineModule` as a package specifier, `file:` URL, or filesystem path to a module exporting `createSession({ modelPath, vocabPath })`. The returned session implements `embedBatch({ inputIds, attentionMask, batchSize, sequenceLength })`, returning `{ dims: [batch, tokens, dimensions], data }`, and `dispose()`. The engine can be `onnxruntime-node` behind a small adapter module that satisfies this interface.

```yaml
- name: '@deepseek-ai/dsh-text-embeddings-local'
  config:
    providerId: local-onnx
    engineModule: /srv/meteo/embedding-onnx-engine.mjs
    model: bge-small-zh-v1.5
    modelDir: /srv/models/bge-small-zh-v1.5-onnx
    maxTokens: 512
```

The deployment installs the engine module and supplies `model.onnx` and uncased WordPiece `vocab.txt` in `modelDir`. The vocabulary must contain `[UNK]`, `[CLS]`, and `[SEP]`; the engine maps padded int64 token ids/masks to a token-state tensor whose dimensions match the input batch and sequence. Missing model files, an invalid module specifier, or an unavailable engine fail loudly at activation; there is no lexical fallback. The deployment owns model provenance and licensing, and no model is downloaded implicitly.
