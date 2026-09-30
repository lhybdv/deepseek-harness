---
description: "面向模型的语料工具（corpus_ingest、corpus_search、corpus_read）与 ctx.corpus：部署如何挂载、配置并观察模型看到的检索工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-corpus

[English](README.md) | 中文

## 概述

`dsh-tool-corpus` 在 `@deepseek-ai/dsh-meteo-corpus` 挂载的语料 seam 之上为模型提供三个工具：`corpus_ingest` 索引部署方提供的文档，`corpus_search` 返回排序后的片段，`corpus_read` 逐字重开某个片段。每个结果都携带结论必须引用的文档标题、片段序号与字符区间，因此回答既能指明支撑它的已索引段落，也能在语料未覆盖问题时直说没有索引到，而不是编造出处。检索深度、摘要长度与索引预算是部署配置，不是模型参数。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经挂载语料提供方的组合中加载本包；它注册 `corpus_ingest`、`corpus_search`、`corpus_read`，并把相应指引加入系统提示词。

### 何时选择

当答案必须可追溯到部署自有文档——作物因灾减产标准、施药窗口、灾害预案——而不是模型记忆时，选择本包。三个工具一起注册：只检索不索引会让索引为空，只索引不检索则让模型无从查阅。需要按 agent 隐藏单个工具时，使用工具注册表的按作用域限制；工具被隐藏后指引也随之消失。

### 最小配置

加载语料提供方与本包。提供方是一个 `CorpusStore` 插件，例如 SQLite FTS5 后端；工具不接受路径或数据库参数。

```yaml
- name: '@deepseek-ai/dsh-meteo-corpus'
- name: '@deepseek-ai/dsh-tool-corpus'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultLimit` | `8` | 模型未要求 limit 时，一次 `corpus_search` 调用返回的片段数 |
| `maxLimit` | `20` | 一次 `corpus_search` 调用可接受的最大 `limit`；更大值被拒绝 |
| `maxSnippetChars` | `280` | 检索引用传给客户端的摘要长度上限 |
| `maxIngestDocuments` | `10` | 一次 `corpus_ingest` 调用可接受的最大 `documents` 元素数 |
| `maxIngestChars` | `200000` | 一次 `corpus_ingest` 调用可接受的字符总数上限 |
| `timeoutMs` | `30000` | 附加到三个工具的协作式工具调用超时预算（毫秒） |

[配置目录](../../../docs/config-catalog.zh.md)是每个受支持字段及其 JSDoc 的穷尽来源。边界在调用提供方之前检查，因此被拒绝的调用既不索引也不检索；非正整数的值，或 `defaultLimit` 大于 `maxLimit`，会在加载时失败。

### 使用 corpus_search

`corpus_search` 接收必填 `query` 与可选 `terms`、`limit`，并把 query 自身分词与额外 term 求并集，使调用方能补上问题隐含的词汇。每个命中都是一个带文档标题、序号、标题路径与字符区间的片段，结果文本同时要求模型引用这三项。空结果会明说没有命中，并指出两条可行的下一步。

```text
Matched 1 chunks (most relevant first).

[1] 病虫害防治气象指标 | docId doc-1 | chunk 0 | chars 12-240 | heading 施药适宜气象条件
风速低于 3 米每秒
```

### 使用 corpus_ingest

`corpus_ingest` 索引本次调用中的文档，最多 `maxIngestDocuments` 篇、总计最多 `maxIngestChars` 字符。每篇文档需要 `title` 与非空 `text`；`source` 记录来源。能否接受由提供方决定，因此被拒的文档会以带标题的失败码与已接受的文档并列返回，而不是让整个调用失败。

### 使用 corpus_read

`corpus_read` 接收 `docId` 与 `ordinal`，逐字返回该片段，这是模型在落到具体数字前核验引用的方式。若索引已不再持有该片段，返回的消息会点出缺失的这一对坐标，并把模型送回 `corpus_search`。

### 失败与恢复

JSON schema 无法表达的参数规则——空白 `query`、空的 `terms` 元素、超出 `1..maxLimit` 的 `limit`、负数 `ordinal`、超预算的索引批次——会在提供方运行前被拒绝，注册表把消息渲染回模型，模型可用合法参数重试。提供方失败以同样方式呈现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

本包只拥有面向模型的那层：把模型参数转换成 seam 请求，把结果转换成文本加结构化元数据，并声明 schema 无法表达的规则。索引、分词、排序与片段切分归 `ctx.corpus`，因此替换 SQLite 提供方不会改变模型可观察到的工具行为，除提供方自己产出的文本之外。

### 源码地图

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：配置断言、`tool:corpus` 提示词分节、三次注册 |
| `src/config.ts` | `Config` schema、默认值与 `assertCorpusLimits` |
| `src/search.ts` | `corpus_search` 注册、输出 schema、呈现器 |
| `src/ingest.ts` | `corpus_ingest` 注册、输出 schema、呈现器 |
| `src/read.ts` | `corpus_read` 注册、输出 schema、呈现器 |
| `src/presentation.ts` | 三个呈现器共用的元数据收窄与摘要截断 |

### 检索流程

检索调用校验 `query`、`terms`、`limit`，不做任何钳制，直接转发请求；提供方排序后的命中变成一个文本块与一个 `citations` 数组，其中摘要被截断到 `maxSnippetChars`。`truncated` 记录的是窗口被填满，而非语料已经取尽，这才是提供方真正支撑得起的弱断言。BM25 分数留在提供方内部：排名就是数组顺序，而裸露的分数会诱导模型去比较跨查询并不可比的数量。

### 呈现

每个工具都注册 `presentCall` 与 `presentResult`，客户端因此能从已记录的回放中重建卡片而无需重跑调用；`output.presentationMeta` 则让结构化元数据在调用发生的那一刻被记录。呈现器会校验参数与元数据形状，不匹配时返回 `undefined`，于是重放的旧参数得到通用兜底呈现，而不是抛异常。

**Runtime invariant：** 不发布伴生包。这些工具只是从 `ctx.corpus` 到线上结果的薄映射，自身不持有持久关系；一次摄取或检索的产出由记录在会话日志中的工具结果重建。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时，阅读这些页面。

- [dsh-meteo-corpus](../meteo-corpus/README.zh.md)——语料 seam、其 SQLite FTS5 提供方、片段切分与错误码。
- [meteo 包映射](../README.zh.md)——本组的 seam 与消费方。
- [dsh-tools](../../core/tools/README.zh.md)——校验参数并执行超时预算的注册表。
- [生成工具目录](../../../docs/tool-catalog.zh.md)——实际注册的精确 schema。
- [生成配置目录](../../../docs/config-catalog.zh.md)——每个受支持配置字段及其源声明。
- [新增一个工具](../../../docs/cookbook/adding-a-tool.zh.md)——本包遵循的 `defineTool` 指南。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到的内容

当 `ctx.tools.get('corpus_search', scope)` 在调用方作用域内可解析时，`tool:corpus` 这一个分节才会渲染，因此隐藏了检索工具的作用域同样失去指引。文本依据解析后的配置，写明默认与最大检索窗口、索引预算以及引用义务。

##### 默认配置下的语料指引

```markdown
Use corpus_search when an answer must come from documents indexed by this deployment: pass the question as query and add the terms you derive from it (disaster type, crop, activity, weather element), because recall unions both. It returns 8 chunks by default and 20 at the most, ranked, each with a document title, a chunk ordinal, and a character range. A chunk is an excerpt: when an excerpt is not enough, call corpus_read with the docId and ordinal of that hit to reopen the whole chunk. Every conclusion drawn from a chunk must cite the document title, the chunk ordinal, and the character range. When nothing matches, say the indexed documents do not cover the question instead of inventing a citation. Index new documents with corpus_ingest, at most 10 documents and 200000 characters in total per call.
```

#### Token 影响

每个可见作用域约一百二十 token 的一段，只有 `defaultLimit`、`maxLimit`、`maxIngestDocuments` 或 `maxIngestChars` 改变时才会增减；隐藏 `corpus_search` 的作用域不贡献任何内容。

#### KV Cache 影响

在分节可见且四项对外声明的边界不变时前缀稳定。改变某个边界，或注册、销毁本插件，都会重写该分节并从此处起令复用失效。

### 工具调用

#### 模型看到的内容

三个 schema：`corpus_ingest` 含必填 `documents` 数组，元素为 `title`、`text` 与可选 `source`；`corpus_search` 含必填 `query` 与可选 `terms`、`limit`；`corpus_read` 含必填 `docId` 与 `ordinal`。描述里带着配置解析出的数值边界，且没有任何 schema 暴露超时、路径或提供方名称。

#### Token 影响

开销随描述文本增长，因此调低 `maxLimit` 的部署同时也缩短了它在每个携带该工具的请求上要付费的检索描述。

#### KV Cache 影响

跨调用稳定；只有改变对外声明边界的配置变更，或可见工具集不同的作用域，才会改变序列化后的 schema。

### 检索到的片段

#### 模型看到的内容

一行表头，例如 `Matched 2 chunks (most relevant first).`，随后每个命中是一行出处信息加片段正文，最后是引用要求。窗口被填满会追加收窄提示，空结果则说明没有命中，并把 `corpus_search` 与 `corpus_ingest` 列为下一步。

#### Token 影响

由返回的片段正文主导：`defaultLimit` 个由提供方决定大小的整片段，外加约一百 token 的框架文字。`maxSnippetChars` 不限制模型看到的正文，只限制客户端摘要。

#### KV Cache 影响

除调用追加进转录的内容外没有影响；检索边界只通过指引与描述文字对外声明来影响缓存。

### 索引失败

#### 模型看到的内容

被接受的文档会带上片段数与字节数一并报告，被拒绝的列在 `Rejected documents (N):` 下并附提供方的码与消息，因此空文本或超大文档能按文档逐一看见。违反边界的批次则只返回拒绝消息，并且不索引任何内容。

#### Token 影响

与本次调用的文档数成正比：每篇被接受的文档一行，每个拒绝一行。

#### KV Cache 影响

除该调用追加的转录外没有其他影响；指引声明这些边界，本身并不随边界改变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了工具在何种情形下不完备或需要部署配合。它们是当前的包级约束。

- **索引文本只能经 `corpus_ingest` 进入**——工具从不读文件系统也不读 URL，因此希望预置文档的部署必须自行调用 `corpus_ingest`，或挂载一个自举播种的提供方。
- **片段切分由提供方决定**——工具不设置片段大小、重叠与标题深度，因此模型无法要求比所挂载提供方产出的更细或更粗的段落。
- **`truncated` 表示窗口填满，不表示语料取尽**——提供方返回命中时不给总数，所以填满的窗口只能支撑「可能还有更多」这一断言。
- **没有删除或列举工具**——seam 暴露 `listDocuments` 与 `remove`，本包未为其注册工具，因此模型无法查看或修改已索引内容；留存策略归部署。
- **引用是被要求而非被校验**——指引与结果文本都要求文档标题、序号与字符区间，但没有任何机制校验模型是否真的引用了它拿到的片段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

这份开发备注是维护者的工作上下文：未决问题与尚未确定的方向。它明确不具权威性——已发布的行为、限制与理由存在于上文与各链接页面中。

#### 未来：按文档子集检索

`ctx.corpus.search` 不接受文档过滤条件，因此拥有多份语料的部署无法把模型的检索限定在其中一份上。`docId` 或标签过滤需要提供方先行支持，这也是工具不对外声明此类参数的原因。

</details>
