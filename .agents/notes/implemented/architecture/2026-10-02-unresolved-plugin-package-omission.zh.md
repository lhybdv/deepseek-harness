# Agent Note：解析不到的插件包身份记录一次并跳过，而非致命

Status: implemented

[English](2026-10-02-unresolved-plugin-package-omission.md) | 中文

## 问题

`dsh-plugin-package-inventory-deepseek` 需要解析每个活跃 Loader 条目的 npm 身份，解析基准为条目所属树的 base、可选的 `ctx.pluginPackages` 服务、宿主 base URL 与该插件自身的模块 URL。meteo 演示组合了八个工作区包（例如 `@deepseek-ai/dsh-meteo-corpus`），Loader 是通过**源码平面**（tsx + tsconfig `paths` 指向工作区）抵达它们的，而 profile 安装树里根本没有 `node_modules`。于是这些条目全部解析不到 manifest，解析器抛出，DeepSeek 适配器把任何扩展准备失败统一报成 `REQUEST_EXTENSION: DeepSeek request extension preparation failed`——该组合下的每一轮模型请求都失败，而消息里没有任何包名。

## 决定

活跃条目的裸包名解析不到 manifest 时，它不贡献任何包身份：解析器通过插件日志按包名记录一次并跳过该条目，与它此前的行为（跳过没有归属 manifest 的散装模块）一致。能解析到但元数据损坏的 manifest 仍然是致命的；字段冲突与投递确认记录同样保持致命。

## 理由

Loader 本身就容忍同一情形：它解析不到的条目只产生警告，因为源码平面启动本就会抵达产物平面索引之外的包，且配置错误的条目不应阻止组合的其余部分启动。为一个这样的条目让请求准备失败，等于让两个子系统互相矛盾；而清单是诊断元数据——它的用途是告诉 provider 工程师某个请求由哪些包版本产生，不是给请求设闸。既定决定（见[当时的记录](2026-08-21-deepseek-llm-api-request-extensions.zh.md)）反对的是**静默**丢弃元数据，而记录一次的日志让这次省略保持可见，因此该决定的意图得以保留，其代价（一个解析不到的名字否决每一轮对话）被去掉。

## 考虑过的替代方案

**继续抛出。** 否决：在源码平面启动下这是结构性情形而非配置错误；失败在任何用户可见面上都不指出包名，却否决一个本来可用组合的每一轮对话。

**静默丢弃该条目。** 否决：既定决定对静默丢弃的反对依然成立；日志报告为每个活跃条目每进程一行。

**改用 Loader 自身的映射来解析身份。** 此处否决：清单刻意采样权威的运行时解析服务，使其身份与导入一致；让它在插件里复刻 Loader 的源码平面映射，等于把 Loader 内部实现复制到插件中。

## 影响

`dsh_plugin_packages` 字段会省略 manifest 解析不到的条目，每个这类活跃条目产生一条指名该包的警告。meteo 演示不再需要关闭该贡献。测试改为钉住字段内容与"每个条目只记录一次"，取代此前的拒绝行为。
