---
description: "dsh Web 客户端的气象会话卡片：meteo_consult 的六步流水线及其发现与引用、气象站查询候选列表，以及会话焦点写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meteo-chat

[English](README.md) | 中文

## 概述

气象界面的会话侧：三张 `tool.call.toolview` 卡片——咨询的六步流水线及其发现与检索到的段落、气象站查询候选列表、以及会话焦点写入。每张都是冻结调用切片的纯函数，元数据缺失或来自外部时回落到通用输入/输出卡。

## 目录

- [注册了什么](#what-it-registers)
- [三张卡片](#the-three-cards)
- [元数据从哪来](#where-the-metadata-comes-from)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

每个气象工具一条以工具名为键的 `tool.call.toolview` 条目——`meteo_consult`、`meteo_station_lookup`、`meteo_set_focus`——外加本包的 `meteoChat` 词典。插件只注入席位与该命名空间的文案：卡片读的是交给它的那次调用，从不读服务，因此把这一行从 `cordis.yml` 里撤掉，所有气象调用就回到通用 Tool 行。

`src/client/`：`meteo-meta.ts`（工具 `presentationMeta` 的客户端副本与全量窄化）、`meteo-card-model.ts`（推导）、`meteo-chrome.tsx`（共享的折叠行）、`MeteoConsultCard.tsx` / `MeteoLookupCard.tsx` / `MeteoFocusCard.tsx`、`locales.ts`、`index.ts`。

<a id="the-three-cards"></a>
## 三张卡片

三张共用一条 24px 折叠行：左侧生命周期字形、工具标题、分隔符，以及随调用状态变化的一行摘要。进行中的调用显示进行中点；失败的调用显示失败信息的首行；被中断的调用显示警告点。摘要是模型提出的问题（`meteo_consult`）、候选数量（`meteo_station_lookup`）或该次调用写入的焦点（`meteo_set_focus`）。

| 卡片 | 折叠时 | 展开后 |
|---|---|---|
| `meteo_consult` | 问题，或失败信息的首行 | 按顺序的六个流水线步骤，各带结果与一行说明；随后要么是需要确认的提问与候选气象站，要么是解析出的气象站、实况与预报行、逐日农事判定及其触发判据、灾害等级及其依据，最后是检索到的段落。 |
| `meteo_station_lookup` | 候选数量，或没有匹配 | 每个候选一行：身份、行政区划与坐标。 |
| `meteo_set_focus` | 该次调用写入的气象站与作物，或焦点已被释放 | 该次调用自身的入参与结果，走通用正文。 |

词典认识的线上取值会被本地化，不认识的按原样呈现，因此更新的部署写下的日志仍然能画。步骤结果、适宜性判定与需要确认的原因各有一套词表；未收录的词按原样显示，而不是猜一个。

<a id="where-the-metadata-comes-from"></a>
## 元数据从哪来

每张卡片都从席位交给它的冻结 `ToolCallBlock` 推导：生命周期取自 `kind`/`isError`/`error.code`，入参取自调用头的原始 JSON，发现取自 `meta`。`meteo-meta.ts` 里的形状是**在客户端重新声明、而非导入的**：`dsh-tool-meteo` 是 host 包，其源码不得进入浏览器模块图，因此卡片改用自己的全量窄化来读 host 的投影。任何来源的元数据——更旧的日志、被截断的窗口、外部生产者——要么给出渲染器无需判空即可读取的字段，要么窄化为 `null`，而 `null` 会把卡片送去通用输入/输出正文。绝不从面向模型的文本里解析任何东西。

`meteo_set_focus` 完全不发布 `presentationMeta`，因此它的卡片读的是被记录的调用入参——那才是会话究竟写入了什么的权威记录。日志已不再携带的调用头会被如实说明，而不会显示成空焦点：「会话什么都没写」与「这一帧说不出来」是两回事。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制会话卡片，不注册任何面向模型的内容。

#### KV Cache 影响

无；卡片读的是会话日志本就携带的工具调用，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只负责呈现。**卡片不改变任何工具 schema、提示词段落或结果，而它们读取的元数据对工具契约而言是附带的：将来某个版本若去掉这份投影，这些卡片会停在通用正文上，而不是报错。
- **引用只展示、不打开。**咨询检索到的段落会连序号、标题层级与摘录一起呈现，但它们的行还不会在右栏打开 `meteo-citation` 查看器；这条接线与 `ui-meteo` 的引用类型一同暂缓。
- **没有展开记忆。**展开状态是按挂载计的；重新打开一个会话时每一行都是折叠的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

三张卡片保持为三个独立模块而不是一张参数化卡片，因为它们的展开正文没有共同结构：咨询正文从一条嵌套记录里渲染六个区块，另外两张则分别渲染一个列表和一个通用正文。只有折叠行是共享的（`meteo-chrome.tsx`），这正是该模块存在的原因。

</details>

**运行时不变量：** 不发布 companion。每张卡片都是交给它的调用块的纯函数，展开是组件状态；两者都没有以可能与另一插件不一致的方式观测他人状态。
