---
description: "面向 harness 气象工具的语料检索能力：ctx.corpus 接缝提供什么，以及 SQLite provider 如何为中文本建索引与检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-meteo-corpus

[English](README.md) | 中文

## 概述

`dsh-meteo-corpus` 把上传文档摄取为带标题路径的片段，并检索最能回答问题的内容；每段都带文档 ID、序号和引用所需的字符偏移。请提供独立 SQLite 文件并挂载为 `ctx.corpus`。挂载了 embedding 提供方时，检索把稠密语义召回与中文双字 bigram FTS5 索引结合；未挂载时语料同样可以摄取与作答，只是走词法检索，并就此报告一次。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包作为插件行挂载，它即注册为 `ctx.corpus`。

### 何时选它

当部署持有能回答"某地、某活动、某灾种"问题的专业文本，且答案必须标明出处时选它。本 store 是单持有者的本地索引：多进程或多机器需共享一份语料时，应改选远端检索服务。语料只是少量短文档、且能整体放进上下文时，直接用文件系统与模型自带的 `read`/`grep` 更合适。

### 最小配置

```yaml
- id: meteo-corpus
  name: '@deepseek-ai/dsh-meteo-corpus'
  config:
    path: !!js `${process.env.DSH_HOME}/meteo/corpus.v1.sqlite`
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 索引文件。`:memory:` 表示不落盘运行索引。 |
| `journalMode` | `wal` | 索引文件的 SQLite journal 模式。 |
| `defaultLimit` | `8` | 检索未指定 `limit` 时返回的命中数。 |
| `maxLimit` | `50` | 显式 `limit` 被钳制的上限。 |
| `maxMatchTokens` | `64` | MATCH 表达式的去重 token 数上限，用于限界表达式规模。 |
| `maxChunkChars` | `800` | 单块字符数的软上限。 |
| `maxDocumentBytes` | `4000000` | 单文档可接受的 UTF-8 字节上限。 |
| `embeddingBatchSize` | `32` | 一次发送给 embedding 提供方的最大分块数。 |
| `candidateLimit` | `100` | 每次查询参与融合的词法和语义候选上限。 |

### 选择索引文件

请给语料一个独立的数据库文件。同类的派生索引会拒绝 `application_id` 属于他人的文件，并在 `user_version` 变化时清空所有表；本 store 反向施加同样规则。其 schema 将每个 chunk 的向量与正文、FTS 行一起保存。schema 版本变化会重建派生数据库，因此需在版本或 embedding 模型变化后重新摄取来源文档。
### Embedding 提供方

语义检索是可选的同类依赖，而非加载期依赖：语料在使用点解析 `ctx.get('textEmbeddings')`，因此挂载顺序无关紧要，且完全不在场时同样能启动、摄取与作答。

挂载 `@deepseek-ai/dsh-text-embeddings` 与一个提供方即可启用：此时 `ingest` 为每个片段存一条向量，`search` 把向量召回与 BM25 融合。什么都不挂载时，`ingest` 不写任何向量，`search` 只在中文双字 bigram 索引上做词法检索，且 store 会就 `textEmbeddings` 报告一次——它绝不伪造向量，也绝不在本地做 embedding。

建索引和查询必须使用同一模型；模型变化后需重新摄取。模型文件随 Host 部署时选本地 ONNX 提供方；已有 embeddings API 时选 OpenAI 兼容提供方。

### 提供扩展词

`search` 分别接收提问，以及调用方从提问中推导出的领域词。召回把两者取并集。气象工具传入来自意图解析与同义词表的词，这正是口语问句得以越过"专业语料里不存在的词"的原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

`text.ts` 同时拥有 token 契约的两半——用于建索引的 `chunkText` 与用于存储和查询词形的 `bigrams`——因为两侧一旦分歧，召回会被静默摧毁。`indexTokens` 写出存储列；`match.ts` 抵达同一个函数并把带引号的 token 做 OR 连接，且优先取提问自身的 token，使表达式被截断时保留提问的主语、丢弃扩展词。

切块器遍历"恰好铺满原文"的源跨度——一句（含句末标点）或一个裸换行——并把连续的若干跨度打包成块。因为跨度铺满原文，块的 `charStart`/`charEnd` 精确指向原文（包含行间换行），这正是由块渲染出的引用能与原文对上的原因。

`ingest` 先写文档的 chunk 行与 FTS 行，最后写 `docs` 行；挂载了 embedding 提供方时，每个 chunk 还写一行向量。`docs` 行是可见性闸门：检索经由它连接，因此被中断的摄取只留下任何查询都取不到的 chunk 行，而不会留下一个报告了它并不拥有的块数的文档。失败按源隔离——一个被拒的文档绝不中断同批其他文档。

`search` 收集至多 `candidateLimit` 个 BM25 候选和至多 `candidateLimit` 个向量余弦候选，再以 reciprocal-rank fusion 融合排序：每份列表贡献 `1 / (60 + rank)`（rank 从 1 开始）。融合分数为贡献之和；候选按文档与 chunk 唯一化。融合保留精确术语信号，并让纯语义结果可被召回。没有 embedding 提供方时向量这一半被整个跳过——既不计算查询向量，也不读取向量表——同一套排序因此退化为 BM25 顺序。即使命中只来自语义召回，`matchExpression` 仍报告 FTS 查询。

数据库句柄在首次使用时惰性打开，并通过 fiber effect 关闭：只挂载本插件却不摄取、不检索的组合不付出代价，重载组合也不会泄漏文件锁。`node:sqlite` 正是出于同样原因在那次打开内部动态导入。

**Runtime invariant：** 不发布伴生包。索引是 store 端到端持有的可丢弃派生产物——片段的身份、偏移与 token 列在同一 store schema 版本下一起写入——因此不存在能与它产生分歧的独立观测。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-session-query-sqlite`](../../session-query/session-query-sqlite/README.zh.md) —— 本 store 镜像其所有权守卫、且绝不能与之共用文件的同类派生索引。
- [能力接缝](../../../docs/capability-seams.zh.md) —— Service Definition 与其 provider、consumer 之间的关系位置。

<a id="model-experience"></a>
## 模型体验

### 检索到的片段

#### 模型看到什么

本包没有任何内容直接到达模型：它不注册工具，也不贡献提示词文本。模型看到的是消费它气象工具返回的东西——排序后的片段，每段标注其文档标题、块序号与上方的标题链，以及工具附上的引用清单。索引、存储的 token 列与本包配置对模型不可见。

#### Token 影响

片段文本只作为工具结果的一部分进入模型上下文，因此其开销就是该结果的大小，由调用工具自身的限额策略限定；`defaultLimit` 只限定检索返回量。

#### KV Cache 影响

无直接失效。检索到的片段作为工具结果内容追加到请求中，由决定纳入多少条的消费者负责由此产生的前缀行为。

## Known Limitations and Deferred Work

- 语义检索是可选的。本包不附带提供方，也不要求提供方：未挂载 embedding 提供方时，`ingest` 不存向量，检索为词法检索（中文双字 bigram 索引上的 BM25）。需要融合语义召回的部署需挂载 `@deepseek-ai/dsh-text-embeddings` 与一个提供方，见 [Embedding 提供方](#embedding-provider)。
- 切块只感知标题与句子。没有结构的文档回落为单条按句打包的流。
- 摄取解析只覆盖纯文本与 Markdown。Office 与 PDF 抽取已推迟；调用方须自行提供文本。
- `DatabaseSync` 是同步的，因此摄取会在单文档期间阻塞事件循环。超大语料应在实时会话之外摄取。
- 索引按文件、单持有者。没有多进程协调，也没有对已变更源文档的增量重建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
