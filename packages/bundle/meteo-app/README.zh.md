---
description: "气象咨询 bundle：部署通过堆叠它启用哪些接缝、工具与 Remote 表面，以及它对部署发布了什么的要求。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-meteo-app

[English](README.md) | 中文

## 概述

堆叠本 bundle 会为部署装上气象咨询表面：一条读取部署自有已发布数据包的数据接缝、一条把上传文档索引进单个 SQLite 文件的语料接缝、基于这两条接缝回答乡镇级农事与灾害问题的模型工具，以及浏览器面板调用的 Remote 命名空间。它自身不添加任何行为——每一行都是配置——并期望部署发布一份数据包，并提供它希望答案扎根其中的专业语料。

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

把本包加进某个 profile 的 bundle 列表，或用 `--patch` 堆叠它。

### 何时选它

当 agent 给出的答案必须来自某个具体部署的站点、阈值与专业文本，而不是通用知识时选它。它不是通用天气能力：没有已发布的数据包，接缝什么也答不出；没有已摄取的语料，工具给出答案时也没有引用。

### 最小配置

profile 把它列在基础 bundle 与 Web 应用 bundle 之后：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-meteo-app"
      ]
    }
  }
}
```

它插入的行携带随部署变化的值，后续层可按 id 覆盖其中任意一个：

| 行 | 字段 | 部署需提供 |
|---|---|---|
| `meteo-corpus` | `path` | 索引文件。默认位于 Harness home 之下；请给它一个专用文件。 |
| `meteo-corpus` | 各项上限 | 检索窗口、分块大小与可接受的文档大小。 |
| `meteo-data` | `source` | `fixture` 读一个目录；`http` 读一个源站根。 |
| `meteo-data` | `fixtureDir` / `baseUrl` | 该部署的数据包发布在哪里。 |
| `tool-meteo` | 各项上限 | 检索窗口、预报时长、澄清广度与超时。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

bundle 是 Cordis 配置行及其所挂载代码的分发格式，自身绝不是一种行为：`package.json` 声明 `dsh.bundle.patch`，Loader 按 profile 列出 bundle 的顺序应用 `cordis.patch.yml`。本 bundle 唯一的源文件是一个空的 `apply`，它存在的理由是让本包与其他 bundle 形态一致。

这些行的顺序让消费方在其所需之后激活。`meteo-corpus` 与 `meteo-data` 提供两条服务；`tool-corpus` 与 `tool-meteo` 注册等待它们的工具；`meteo-controller` 提供浏览器调用的 Remote 命名空间。Cordis 的服务注入自身就会排出这个次序，因此运维人员调整这些行的顺序不会有任何影响。

两条接缝都是刻意由配置驱动而非代码驱动的。把数据包发布在 HTTP 上的部署把 `meteo-data.source` 从 `fixture` 改为 `http` 并设置 `baseUrl`；想要多份语料的部署运行多个索引文件。两条接缝之上什么都不变，正是这一性质让同一批工具与同一套面板服务于另一个地区。

**Runtime invariant：** 不发布伴生包。bundle 只贡献配置，它命名的那些行拥有全部关系，而 Loader 自身的条目树就是可观测状态。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [气象咨询](../../../docs/subsystems/meteo.zh.md) —— 本 bundle 挂载的接缝。
- [气象组](../../meteo/README.zh.md) —— 这些行所命名的包。
- [Profile 与 bundle](../../../docs/architecture.zh.md) —— profile 如何堆叠 bundle 并覆盖其行。

<a id="model-experience"></a>
## 模型体验

### 咨询表面

#### 模型看到什么

它所挂载的那些行所贡献的一切：`tool-meteo` 的三个工具 schema 与其 `tool:meteo` 提示词段落，以及 `tool-corpus` 的三个语料 schema 与其自己的段落。本包不添加任何自己的 schema、段落或工具，因此隐藏任一工具就恰好移除那一个工具的表面。

#### Token 影响

没有直接影响。每一行的开销都属于拥有它的包；挂载本 bundle 的部署只为其命名的工具付费。

#### KV Cache 影响

无直接失效。bundle 只决定存在哪些行，各行的提示词前缀行为由它们自己负责。

## Known Limitations and Deferred Work

- 本 bundle 期望存在一份已发布的数据包，自身不提供。因此没有数据包就堆叠它的部署会得到一条以"数据集不可用"作答的接缝，而不是在加载时失败。
- 一个语料索引就是一个文件。多份语料，或多个进程共享一份，不在本 bundle 的组合范围内。
- `http` 数据源读取与 `fixture` 源相同的结构；词汇不同的业务 API 需要自己的 provider，而不是换一个 `baseUrl`。
- 演示用 fixture 留在仓库中，不随其包发布，这正是示例 overlay（而非 bundle）把 `fixtureDir` 指向它们的原因。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
