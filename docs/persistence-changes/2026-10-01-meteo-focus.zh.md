---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-01-meteo-focus

[English](2026-10-01-meteo-focus.md) | 中文

## 概述

新增 `meteo/focus` 事件根：整值形式的会商焦点——可选的站点 id、可选的作物，以及该轮记录它们的时刻——气象会商在确定本次会话所指的地方时写入这条事件。该事件携带完整取值而不是增量，因此从 `init` 折叠日志不依赖更早的写入。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-meteo-focus
baseline: false
changes:
  - root: "event:meteo/focus"
    previous: null
    after: "3ca5e246d02c806e0bfb8c55b11b7d7d3346a4c26406f4b44a385b2485beb804"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该根是纯新增：头部、信封与既有事件取值都不变，`SessionHeader.version` 保持不变。`meteo/focus` 在读取时是必需事件而非可忽略事件：它是后续每次会商工具调用都要读取的锚点，因此不认识该类型的构建会拒绝整份日志，而不是静默丢弃一条会改变后续步骤答案的事件。回放不含该事件的日志得到的正是投影的 `init` 值 `null`，也就是该包存在之前每个读取方所处的状态。`meteoFocus` 投影归 `dsh-meteo-data` 所有，因此没有挂载该插件的组合既不会写入也不会读取这个根。

<a id="verification"></a>
## 验证

pnpm run typecheck 两个编译面均通过。pnpm exec vitest run packages/meteo packages/api/meteo-controller packages/bundle/meteo-app 在 17 个文件中通过 321 个测试，覆盖焦点投影的折叠、释放与重放用例。pnpm run verify-persistence-changes 接受该根为同版本新增，pnpm run verify-persistence-formats 验证 v0 至 v4 参考。

<a id="dev-note"></a>
## 开发备注

无。
