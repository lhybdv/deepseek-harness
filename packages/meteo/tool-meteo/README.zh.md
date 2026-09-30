---
description: "面向模型的咨询工具：它们基于气象数据与语料接缝，让 agent 能回答什么，以及如何配置其边界。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-meteo

[English](README.md) | 中文

## 概述

咨询工具把回答乡镇级农事或灾害问题所需的证据交给模型。`meteo_consult` 会解析被告知的——或会话已持有的——地点与作物，读取该站的实况与预报，按部署自身的阈值给逐日适宜性与一个灾害等级，并检索与该提问相关的已索引语料片段。它返回发现与步骤轨迹，从不返回答案：答案由模型撰写并引用片段。当答案需要可复现、可引用时选它；数据与阈值归部署所有。

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

在 `ctx.meteoData` 与 `ctx.corpus` 已被提供之后，把本包作为插件行挂载；它会注册三个工具与一个提示词段落。

### 何时选它

当 agent 必须就某个具体地点、基于某个具体部署的数据作答，且读者可能需要核对答案时选它。若问题足够泛化、要的就是教科书式答案，则不必——这些工具存在的意义是把本地结论绑定到本地证据，而每次咨询都要付出一次站点解析、两次序列读取、一次规则判定与一次语料查询。

### 最小配置

```yaml
- id: tool-meteo
  name: '@deepseek-ai/dsh-tool-meteo'
  config:
    defaultLimit: 6
    forecastHours: 72
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `defaultLimit` | `6` | 模型未给 `limit` 时，`meteo_consult` 检索的语料片段数。 |
| `maxLimit` | `20` | 可接受的最大 `limit`；超出即报错，而非静默钳制。 |
| `forecastHours` | `72` | 咨询读取的预报时长（整小时）。 |
| `maxClarificationCandidates` | `6` | 一次澄清结果最多列出的候选站点数。 |
| `maxSnippetChars` | `280` | 引用节选的长度上限（按码点计）。 |
| `maxSeriesRows` | `24` | 面向模型的文本中各自列出的实况与预报行数。 |
| `timeoutMs` | `30000` | 三个工具共用的协作式工具调用预算。 |

所有边界在加载时校验：非正数、小数，或 `defaultLimit` 大于 `maxLimit`，都会让插件失败，而不是等到第一次咨询才失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

`meteo_consult` 按固定顺序执行，并为每一步在其返回的轨迹中追加一条：slots、observation、forecast、suitability、hazard、corpus。每一步都是对 `ctx.meteoData` 或 `ctx.corpus` 的调用；工具自身不做任何 IO，也不持有任何数据。

站点槽位按部署已发布的站点解析——先精确标识、再精确名称、再唯一部分匹配——在放弃之前会回落到会话焦点。未解析出站点时返回携带候选的澄清结果，并**不再执行任何后续步骤**，这正是澄清零成本、且不会为错误的地点伪造结论的原因。

`rules.ts` 就是那份判断：纯且全的函数，接收阈值与样本记录，逐日返回 `suitable` / `unsuitable` / `unknown`，加上实际触发的判据及其持续小时跨度。读数从未达到其 `durationH` 的判据不会触发；没有匹配阈值的灾害报告 `unknown`，而不是给出等级。规则引擎读取部署的 `thresholds` 与 `cropCalendar` 记录，从不自带任何数字。

`presentation.ts` 构建面向模型的文本与结果元数据。元数据携带步骤轨迹、每步发现、引用清单与规则版本，因此客户端无需自行推导即可渲染子卡片与引用胶囊，后续答案也始终能与产生它的那版阈值对账。

`apply` 注册三个工具与一个提示词段落，该段落的文本在 `ctx.tools.get('meteo_consult', scope)` 未定义时渲染为空串，因此隐藏该工具的组合不会贡献关于它的任何指引。

**Runtime invariant：** 不发布伴生包。规则引擎是对接缝自有记录的纯函数，工具自身不持有持久关系；一次咨询产出的内容由结果元数据与会话日志重建，而非来自包内的事件流。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [气象咨询](../../../docs/subsystems/meteo.zh.md) —— 这些工具消费的数据与语料接缝。
- [`dsh-tool-corpus`](../tool-corpus/README.zh.md) —— 摄取与检索的姊妹 Consumer；本包经由 `ctx.corpus` 调用它，而不自行注册工具。
- [`dsh-meteo-data`](../meteo-data/README.zh.md) —— 这里每一步都要读取的站点、阈值与焦点契约。

<a id="model-experience"></a>
## 模型体验

### 咨询证据

#### 模型看到什么

三个工具 schema 加一个提示词段落（`tool:meteo`）。该段落规定工作顺序——回答农事或灾害问题前先咨询、把理解到的每个槽位都传进来、结论所依据的片段要引用、澄清结果返回时问清农民指的是哪个站——并在该作用域内 `meteo_consult` 不可见时渲染为空文本。`meteo_consult` 的结果是其发现的面向模型渲染：解析出的站点、列出的实况与预报行、带触发判据的逐日结论、一个带依据的灾害等级，以及引用节选。

#### Token 影响

每次咨询的开销形态固定：一次工具调用与一个结果，携带至多 `maxSeriesRows` 行实况、`maxSeriesRows` 行预报、适宜性各日、灾害，以及至多 `defaultLimit` 条受 `maxSnippetChars` 限制的引用节选。提示词段落是一个很短的块，因此隐藏该工具的组合会同时把它从 schema 列表与提示词中移除。

#### KV Cache 影响

无直接失效。该段落按分配的序号加入装配后的提示词，工具 schema 也像其他工具一样加入请求；把检索到的片段加入对话的消费者自负责由此产生的前缀行为。

## Known Limitations and Deferred Work

- 规则引擎只判定 `ctx.meteoData` 发布的内容。没有判据的作物窗口，或站点从不测量的判据要素，都会得到 `unknown` 而不是猜测。
- 适宜性按接缝返回的序列逐日历日判定；不在读数之间做插值。
- 一次咨询只给一个灾害等级。把多个灾种相互排序属于调用方的组合，而不是工具能力。
- 省略的槽位只有会话焦点这一个来源；除它以外没有按用户或按地点的默认值。
- 语料检索是词汇级的。工具把调用方的词原样传给 `ctx.corpus`，除 `ctx.meteoData.expandTerm` 的返回外不做重排或扩展。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
