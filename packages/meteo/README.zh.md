---
description: "meteo 组地图：语料检索 seam、气象数据 seam，以及回答乡镇级灾害与农事问题的模型工具，供使用与维护本组的读者导航。"
kind: "package-group"
---

# meteo/ — 气象咨询

[English](README.md) | 中文

## Summary

meteo 组把部署自有的气象数据与专业语料，变成就某个乡镇可给出的回答：实况与预报怎么说、某项农事活动是否适宜、某段时间带什么灾害风险、以及哪些来源支撑该结论。每项能力都是一个 seam，其 provider 随包发布，因此更换数据源或语料后端只需改配置，工具与模型请求纹丝不动。请把它当作"部署领域系列"而非产品主干：seam 是稳定的，用于演示它们的 fixture 属于部署自身。

## Table of Contents

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## Packages

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`meteo-corpus/`](meteo-corpus/README.zh.md) | 语料检索 seam 及其 SQLite FTS5 提供方，按中文 bigram 建索引 | `ctx.corpus` |
| [`tool-corpus/`](tool-corpus/README.zh.md) | 面向模型的 `ctx.corpus` 工具 `corpus_ingest`、`corpus_search`、`corpus_read` | — |
| [`meteo-data/`](meteo-data/README.zh.md) | 面向单一已发布数据包的气象数据 seam，以及跨轮次的 `meteoFocus` 会话投影 | `ctx.meteoData` |
| [`tool-meteo/`](tool-meteo/README.zh.md) | 面向模型的咨询工具 `meteo_consult`、`meteo_station_lookup`、`meteo_set_focus`，并带确定性的适宜性与灾害规则引擎 | — |
| [`../api/meteo-controller/`](../api/meteo-controller/README.zh.md) | `meteo` 命名空间的 Host Remote 持有者：经由两条接缝提供语料面板的读写与会话焦点 | `ctx.meteoController` |

呈现本组结果的 UI 包各自随包到来。一项能力以一个 Service Definition 加上让它可用的 provider 或 consumer 进入本组，绝不以单一角色进入。

-----

<a id="related-documentation"></a>
## Related documentation

- [气象咨询](../../docs/subsystems/meteo.zh.md) —— 本组拥有的数据与语料接缝。
- [架构](../../docs/architecture.zh.md) —— 这些包挂接的扩展点地图。
- [能力接缝](../../docs/capability-seams.zh.md) —— Service Definition / Provider / Consumer 三种角色。
