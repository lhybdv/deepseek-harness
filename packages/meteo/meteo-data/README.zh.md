---
description: "面向 harness 气象会商的数据能力：ctx.meteoData 接缝提供什么，两种传输如何读取同一份已发布数据包，以及会话如何跨轮次携带焦点。"
kind: "package-reference"
---

# @deepseek-ai/dsh-meteo-data

[English](README.md) | 中文

## 概述

`dsh-meteo-data` 把气象会商所依赖的数字收敛为一个接缝：站点目录、逐时观测、预报点子、预警指标、农事时段与词形扩展。包内自带两种 provider——从目录读取数据包，或从静态 HTTP 源读取同一份数据包——因此接入真实数据源只是换一个同名 provider。它还携带会商的焦点，即本次会话正在讨论的站点与作物，以 `meteo/focus` 会话事件写入并折叠进 `meteoFocus` 投影：第三轮无需复述第二轮。

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

把本包作为一行插件挂载，它便注册为 `ctx.meteoData`。加载它同时注册 `meteoFocus` 会话投影，因此某一流中写入的焦点在下一流依然可读。

### 何时选它

当会商要基于一份已发布的数字回答关于某地某作物的问题，而这些数字今天来自目录、明天可能来自数据源时，选它。当问题需要专业文本、且回答必须给出出处时，改用 [`dsh-meteo-corpus`](../meteo-corpus/README.zh.md)；两个接缝回答的是不同问题。当上游是查询接口而非已发布的数据包时，直接扩展 `MeteoData`：过滤与焦点都在接缝里，而不在传输层。

### 最小配置

```yaml
- id: meteo-data
  name: '@deepseek-ai/dsh-meteo-data'
  config:
    source: fixture
    fixtureDir: !!js `${process.env.DSH_HOME}/meteo/bundle`
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `source` | `fixture` | 传输方式：`fixture` 读目录，`http` 读数据源。 |
| `fixtureDir` | `fixture` 必填，`http` 拒绝 | 存放数据包的目录。 |
| `baseUrl` | `http` 必填，`fixture` 拒绝 | 数据包发布的源根地址；末尾斜杠会被拒绝。 |
| `timeoutMs` | `15000` | 应用于每一个 HTTP 请求的时限。 |

### 数据包布局

两种传输读取同一套布局，因此数据包只需导出一次，两种方式使用：

```text
stations.json
observations/<stationId>.json
forecast/<stationId>.json
thresholds.json
crop-calendar.json
synonyms.json
taxonomy.json
meta.json
```

`thresholds.json` 与 `crop-calendar.json` 承载农户被评判的预警指标以及这些指标适用的时段；本示例共发布 33 个站点：黑龙江五常市、吉林榆树市、辽宁昌图县各 8 个乡镇站，另有哈尔滨市（道里区、松北区、阿城区）、长春市（朝阳区、南关区、九台区）、沈阳市（和平区、沈北新区、辽中区）各 3 个市区站。33 个站点对应 33 个观测文件和 33 个预报文件；每个新增市区站均有 24 行观测（2026-09-23 00:00–23:00 UTC）和 24 行预报（2026-09-24 00:00 至 2026-09-26 21:00 UTC）。作物为玉米、大豆与水稻，灾害判据包括春旱、低温冷害、初霜、暴雨与内涝。`synonyms.json` 与 `taxonomy.json` 负责把口语里的灾种别名归到指标登记所用的灾种名；`meta.json` 发布每个数据集的版本号，回答因此能说清自己用的数字有多新。

### 跨轮次携带焦点

```ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { appendFocus, readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { Session } from '@deepseek-ai/dsh-session'

declare const ctx: Context
declare const session: Session
declare const agent: Agent

appendFocus(session, { stationId: 'hl-wc-01', crop: '玉米', updatedAt: Date.now() })
const focus = readFocus(ctx, agent)
```

一次写入替换整个快照，所以只换作物的那一轮仍要给出它指的站点；`appendFocus(session, null)` 释放焦点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>传输层、已发布形状，以及每个回答在哪里算出。</summary>

两种传输实现同一个内部 `MeteoSource` 接口——`load(kind)`、`expandTerm(term)`、`versions()`——各自缓存自己读过的原始 JSON，每进程一次。`FixtureMeteoSource` 列举并读取目录；`HttpMeteoSource` 在 `baseUrl` 下按同样的名字取，带 `Accept: application/json` 与 `AbortSignal.timeout(timeoutMs)` 时限。位于其上的 `LocalMeteoData` 拥有全部答案：一次查询保留哪些行、预报时长从哪里起算、一次坏查询意味着什么。

逐站点数据集（`observations`、`forecast`）是每站点一个文件。对二者的首次读取会遍历站点目录展开，把该数据集的整个目录或整个源读一次，此后所有站点都由这一份快照服务；源上缺某个站点的文件时答案是空序列而非错误，因为覆盖缺口是数据包自身的事实。

每个文件在读取时都按 zod schema 校验。与已发布形状不符的数据包会以 `METEO_DATASET_UNAVAILABLE` 被拒绝，消息里点明是哪个数据集，而不是半解析后交付。接缝自身的失败是带 code 的 `MeteoDataError`，供调用方分支：观测或预报查询点名了目录里没有的站点是 `METEO_STATION_NOT_FOUND`；不可用的时刻或时长（`from`、`to`、`hours`）是 `METEO_INVALID_QUERY`；源不可达、返回非成功状态、返回的不是 JSON、或超出时限，是 `METEO_SOURCE_ERROR`。

`meteoFocus` 是状态为 `FocusSnapshot | null` 的会话投影：`init` 是 `null`，`apply` 在 `meteo/focus` 事件上整体替换状态，在其它任何会话事件上原样保留。因此答案永远来自折叠会话日志，而非 provider 内存，这也是同一进程里两场会商绝不会看到彼此焦点的原因。

**Runtime invariant：** 不发布伴生包。该接缝读取已发布的数据包，并折叠一个由投影注册表本身校验的会话投影；除 `meteo/focus` 事件外，它不持有数据集的第二份拷贝，也不持有可变关系。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-meteo-corpus`](../meteo-corpus/README.zh.md) —— 从专业文本作答并携带回答所需出处的姊妹接缝。
- [`dsh-session-projection`](../../session/session-projection/README.zh.md) —— `meteoFocus` 折叠经过的注册表，投影状态在此存储与版本化。
- [能力接缝](../../../docs/capability-seams.zh.md) —— Service Definition 与其 provider、consumer 之间的关系位置。

<a id="model-experience"></a>
## 模型体验

### 会话焦点

#### 模型看到什么

本包不直接抵达模型：它不注册工具，也不贡献任何提示文本。模型看到的是消费它的气象工具所返回的内容——站点行、观测与预报序列、某灾种被评判的指标，以及一旦有工具写入过焦点之后，作为「本次会商视为已知的地点与作物」被回读的焦点。`versions()` 给出的数据集版本让回答能说明数字有多新，而不必由模型猜测。

#### Token 影响

焦点快照只有三个可选字段，只有在工具选择回读它时才产生一次工具结果的开销，于是跨轮携带状态换掉的是用户复述、以及模型从更早轮次重新解析它的开销。序列长度才是真正的成本，且由查询约束：观测的 `from` 与 `to`、预报的 `hours`，两者都由调用工具决定。

#### KV Cache 影响

没有直接的失效。`meteo/focus` 事件延长会话日志，其产生的投影状态只在工具主动索取时被读取，因此本包不会自行重写任何提示前缀；决定是否在工具结果里点明焦点的消费方，承担随之而来的缓存行为。

## Known Limitations and Deferred Work

- 数据包不打进包内：`files` 只发布代码，因此 `fixtureDir` 是必填配置，每个部署把自己的数据包目录指给接缝。
- 逐站点读取会把该数据集的整个目录或整个源读一次（每进程）。站点很多的数据包，其首次读取要为没人询问的站点付费。
- 原始 JSON 快照永不失效。磁盘上或源上更新的数据包要靠重启生效，而不是靠后续读取。
- 演示数据包的预报不含土壤湿度，因此预报回答永不给出该要素，而观测回答会。
- 焦点是一个整体替换的快照，无合并、无过期、无历史。释放过期焦点靠写入 `null`，而何时写入属于会商逻辑。
- 查询只有精确相等与子串：没有半径或包围盒的站点检索，没有单位换算，也不对数字本身做质量控制或缺测填补。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
