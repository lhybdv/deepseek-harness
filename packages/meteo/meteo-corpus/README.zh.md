---
description: "面向 harness 气象工具的语料检索能力：ctx.corpus 接缝提供什么，以及 SQLite provider 如何为中文本建索引与检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-meteo-corpus

[English](README.md) | 中文

## 概述

`dsh-meteo-corpus` 把上传的文档摄取为按标题分块的片段，并检索出最能回答某个提问的片段，每段都带文档 id、序号与引用所需的字符偏移。给它一个独立的 SQLite 文件，并以 `ctx.corpus` 挂载即可。中文召回决定了它的形态：SQLite 的 `unicode61` 分词器会把一整段连续汉字当成一个 token，因此用原文检索 `对流` 一无所获，而 `明天下午在临河镇打药行不行` 这类口语问句在任何 AND 连接的查询下都返回空结果。索引存储 bigram 词形，检索时把提问 token 与调用方给出的词做 OR 并集。

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

### 选择索引文件

请给语料一个独立的数据库文件。同类的派生索引会拒绝 `application_id` 属于他人的文件，并在 `user_version` 变化时清空所有表；本 store 反向施加同样的规则：被其他应用持有的文件，或声明无主的非空文件，都是硬错误，而不是静默接管。

### 提供扩展词

`search` 分别接收提问，以及调用方从提问中推导出的领域词。召回把两者取并集。气象工具传入来自意图解析与同义词表的词，这正是口语问句得以越过"专业语料里不存在的词"的原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

`text.ts` 同时拥有 token 契约的两半——用于建索引的 `chunkText` 与用于存储和查询词形的 `bigrams`——因为两侧一旦分歧，召回会被静默摧毁。`indexTokens` 写出存储列；`match.ts` 抵达同一个函数并把带引号的 token 做 OR 连接，且优先取提问自身的 token，使表达式被截断时保留提问的主语、丢弃扩展词。

切块器遍历"恰好铺满原文"的源跨度——一句（含句末标点）或一个裸换行——并把连续的若干跨度打包成块。因为跨度铺满原文，块的 `charStart`/`charEnd` 精确指向原文（包含行间换行），这正是由块渲染出的引用能与原文对上的原因。

`ingest` 先写文档的 chunk 行与 FTS 行，最后写 `docs` 行。该行是可见性闸门：检索经由它连接，因此被中断的摄取只留下任何查询都取不到的 chunk 行，而不会留下一个报告了它并不拥有的块数的文档。失败按源隔离——一个被拒的文档绝不中断同批其他文档。

`search` 在 `chunks_fts`、`chunks`、`docs` 上发出一条连接查询，按 FTS5 自带的 `bm25()` 排序。这里直接使用 BM25——而会话检索索引不用——因为单一语料使分数在一次运行内可比，而这正是会话索引无法在其持久表与活动表之间依赖的性质。

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

- 检索是词汇级的。没有向量索引与 embedding；BM25 之上的排序由调用方负责，气象工具会用模型对候选重排。
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
