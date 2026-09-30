---
description: "气象咨询界面的 Host Remote 持有者：meteo 命名空间在语料与数据两条接缝之上暴露什么，以及面板与模型为何最终读到同一个索引。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-meteo-controller

[English](README.md) | 中文

## 概述

`dsh-api-meteo-controller` 把 M1 气象演示的浏览器接缝以 Remote 命名空间 `meteo` 上线：语料列表、检索、块重开、移除、站点查询，以及会话焦点，均通过 `ctx.remote.meteo.*` 抵达。它不判断天气，也不存储任何东西。每个调用都落在已经回答模型的那两条接缝上，因此用户打开的引用就是模型引用的那一条。本包没有配置。它的限制是每请求配额，不是语料或数据集规模的天花板；拥有索引与站点数据集的部署才拥有那些尺度。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把它挂在其所前置的两条接缝旁边，`meteo` 命名空间即注册；浏览器经由 Client 装配包 `@deepseek-ai/dsh-api-remotes` 以 `ctx.remote.meteo.*` 调用它，该装配包是唯一导入本包生成的 Remote 贡献的包。

### 何时选它

当浏览器界面必须展示或更改 `dsh-meteo-data` 与 `dsh-meteo-corpus` 两条接缝已经替模型回答的内容——语料面板、引用阅读器、站点选择器、焦点条——并且部署希望两个平面背后是同一个索引时，选它。不要为它并不拥有的数据扩张它：需要其接缝所缺乏能力的界面，应在该拥有者之上建立自己的命名空间，而不是加宽 `meteo`，因为这里的每个方法都恰好是一次接缝调用，且本包除演示所需外不持任何策略。它以读为主并带一次语料写入，且绝不通过 Remote 发起会话提交：需要运行对话的界面通过 `dsh-api-session-controller` 提交一条消息，让模型去调用 `meteo_consult`。

### 最小配置

本包没有配置，除其一个服务外也不注册任何东西：一行插件，加上它所需的两条接缝。

```yaml
plugins:
  - '@deepseek-ai/dsh-api-meteo-controller'
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| 无 | 无 | 没有配置字段；每请求的边界是源文件里的常量。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

`src/index.ts` 就是一个类：`MeteoController extends TypertRemoteService`，`static inject = ['corpus', 'meteoData', 'sessionProjections', 'typert']`，构造函数调用 `super(ctx, 'meteoController', { namespace: 'meteo' })`。七个 `@Remote` 方法，每个恰好是一次接缝调用。

线格式无法从方法签名说清的东西，由方法体顶部一个 zod 表达式声明。生成的线 codec 只检查 JSON 数据的*形状*：字符串、整数、可选性。这里声明的约束更具体——非空的文档 id 与标签、非负的 `ordinal`、正的 `limit`、一批一到 `MAX_INGEST_SOURCES` 个源、至少带一个筛选条件的站点查询。被拒的载荷抛 `gateway/bad-request` 并携带 zod 的 issue 列表。`stationLookup` 的守卫值得单独一读：无筛选的站点查询会枚举整个数据集，而它的形状是完全合法的 JSON，因此只有领域规则能拒绝它。`corpusSearch` 刻意不声明 limit 上限——store 会把显式 limit 钳制到其自身配置的最大值，在此再加一道上限会静默地与那份配置冲突。

两种接缝类型被复用为线类型：来自语料接缝的 `CorpusDocument`、`IngestSource`、`IngestResult`、`CorpusChunk`、`RemoveResult`，来自数据接缝的 `Station` 与 `FocusSnapshot`。只有 `MeteoSearchHit` 是本地的，因为索引的 `CorpusHit` 携带整个块体，而面板要的是摘录；`hitView` 丢弃 `text`、压平空白、并在 `MAX_EXCERPT_CHARS` 处截断，使一次命中是一行而不是一段。读取块体的方法是 `corpusRead`，它重新打开该块并原样返回。

接缝的沉默在浏览器里会是错误的答案，因此本包为其命名。`readChunk` 对缺失的块返回 `undefined`；`corpusRead` 抛出带该地址的 `meteo/chunk-not-found`。`stations()` 抛 `MeteoDataError`；`stationLookup` 把其 code 作为 details 的 `reason` 搬进 `meteo/data-unavailable`，并把原错误留在 `cause` 上。其余一切原样重抛：Controller 不猜测接缝的意图。`corpusRemove` 把 `RemoveResult` *连同* `removed: false` 一并交回——文档本就不在，正是面板想要的世界状态，而非失败。两个 code 在 `src/types.ts` 里声明进协议的 `RemoteErrorDetailsMap`，于是类型化的 `ctx.remote.meteo.*` 调用方能 `catch` 并判别它们，而 `gateway/bad-request` 复用 Gateway 已拥有的那一个。

`focusGet` 示范了这条边界。`readFocus(ctx, agent)` 按*会话*读取投影，而浏览器只能把 id 放上线，于是生成的胶水从线上的 `SessionId` 解析出 `agent` 参数（其声明签名携带 `session`），面板传入的多余 `agent` 实参会被生成的代码丢弃。焦点无法经由本包被伪造。

**Runtime invariant：** 不发布伴生包。该命名空间投影两条接缝、自身不存储；方法的结果就是接缝自身的状态，客户端通过重读面板列表与会话焦点重建它。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-meteo-corpus`](../../meteo/meteo-corpus/README.zh.md) —— 五个语料方法所询问的检索接缝。
- [`dsh-meteo-data`](../../meteo/meteo-data/README.zh.md) —— 拥有站点数据集与会话焦点投影的数据接缝。
- [`dsh-tool-corpus`](../../meteo/tool-corpus/README.zh.md) —— 读取同一索引并把引用交还给模型的工具。
- [添加 Remote API](../../../docs/cookbook/adding-a-remote-api.zh.md) —— 本包遵循的生成 Remote 契约，含参数名守卫。
- [`@deepseek-ai/dsh-api-remotes`](../remotes/README.zh.md) —— 把生成的 Remote 贡献挂载为 `ctx.remote` 的浏览器装配。

-----

<a id="model-experience"></a>
## 模型体验

### 语料与站点读取

#### 模型看到什么

什么也看不到。`ctx.remote.meteo.*` 是浏览器界面；模型经由气象工具的结果抵达同一份数据，而那些结果携带的是引用字段，不是 Remote 信封。

#### Token 影响

零：这些调用绝不进入提示词，而 `MAX_EXCERPT_CHARS` 限定的是面板一行，不是工具结果。

#### KV Cache 影响

无——没有请求前缀被创建或被改写。把一次命中渲染进可见输入框的面板，只有在用户经由 Session Controller 的命名空间提交时才产生提示词。

## Known Limitations and Deferred Work

- 本包暴露的正是两条接缝已有的能力。语料文本的分块字节上传、流式结果、按数据版本判断站点数据集的陈旧度都被推迟；一个什么都不存储的 Controller 都不该拥有它们。
- 焦点在此只读，尽管 `meteo-focus` 会写它。模型应当看见、且必须在模型自己的写入之后存活的用户设定焦点，需要一个两个平面都能写的会话级 store 与一个两者都能读的投影——M1 的面板只镜像模型写下的内容。
- 没有 `meteo/*` 事件：面板在提交之后重新拉取焦点，而不是被推送。被推送的焦点需要把 `meteoFocus` 列入 `@deepseek-ai/dsh-api-remotes` 允许的转发事件。
- `corpusIngest` 在一次 Remote 请求里携带整篇文档文本，受 `MAX_INGEST_SOURCES` 约束。粘贴规模的指南放得下；扫描的 PDF 放不下，而那条上传路径不在这里。
- 授权是宿主的假设：任何能抵达某会话 Remote 的人都允许调用。M1 的演示主机是单用户的，因此线路解析出的 `SessionId` 与已认证用户之间的接缝是被推迟，而不是被伪造。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
