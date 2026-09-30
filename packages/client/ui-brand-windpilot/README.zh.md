---
description: "dsh Web shell 通用品牌席位的 WindPilot 占用者：侧栏的标识与名称，以及空白会话英雄位的标识。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-windpilot

[English](README.md) | 中文

## 概述

WindPilot 的品牌，占用 shell 声明的四个通用席位：侧栏的标识与名称、空白会话英雄位的标识，以及欢迎页底部的团队页脚。标识是本包内自绘的云朵，名称是平台副标题之上的字标。把本插件的 Loader 行撤掉就是完整的去品牌化——shell 自带的鱼形与文本兜底会接管，因为品牌是一**占用者**，不是 shell 的行为。

## 目录

- [注册了什么](#what-it-registers)
- [标识](#the-mark)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

| 席位 | 占用者 | 呈现位置 |
|---|---|---|
| `sidebar.brand.mark` | 按请求边长绘制的云朵 | 面板列表旁、工作区区块之上。 |
| `sidebar.brand.name` | 平台副标题之上的字标 | 展开态侧栏的品牌文字；内容与宽度由占用者自己决定。 |
| `conversation.hero.brand.mark` | 同一朵云，按英雄位更大的边长 | 空白会话英雄位，宿主还会传入维持更大标识几何的类。 |
| `conversation.hero.headline` | 品牌标语 | 该标识旁的欢迎语，替换 shell 自带的那句。 |
| `conversation.hero.footer` | 团队页脚「风云 AI组」 | 空白会话欢迎页的最底部、输入框下方居中。 |
所有文案归 `windpilotBrand` 命名空间所有。`WindPilot` 与标语在两份词典里保持原样，因为它们是品牌自己的话；只有副标题会被翻译。

五个席位都是 `single`、root 作用域，且**由 shell 声明**——前两个由 `ui-sidebar` 声明并自带通用兜底，其余由 `ui-conversation` 声明并分别自带欢迎语与鱼形兜底。本包只负责填充，这也是品牌以插件而非 shell 选项形式存在的原因：把它从组合里去掉只是一次 `cordis.yml` 编辑，兜底仍在。

英雄位的**「预览版」徽标不是席位**，也不归本包管：shell 只在自己的构建上渲染它（`DSH_CLIENT_BUILD_PROFILE === 'official'`），因为那是对**构建**的声明，不是欢迎语。因此自建产品的部署不会显示它。

`src/client/`：`WindPilotMark.tsx`（绘制）、`WindPilotBrand.tsx`（每个席位一个薄占用者）、`locales.ts`（字标、副标题与标识的无障碍名）、`index.ts`（接线）。

<a id="the-mark"></a>
## 标识

云朵是内联自绘而非导入：共享图标集里没有云朵，而往那里加一个等于为单个品牌给每个客户端多发一个基元。品牌标识画在用它的人这里；边长由**席位**而非标识决定，所以标识本身只取一个尺寸，并把宿主的类原样透传。

四个占用者的存在是因为各席位传入的东西不同：侧栏标识只要一个边长；英雄位多传一个维持更大几何的类；名称席位完全不传内容；欢迎页页脚什么也不传，占用者只负责字号与低调配色。把这份映射放在占用者里，标识才能保持成一张纯粹的图。

所有文案归 `windpilotBrand` 命名空间所有。`WindPilot` 在两份词典里相同，因为它是专名；副标题会被翻译。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制品牌，不注册任何面向模型的内容。

#### KV Cache 影响

无；占用者在挂载时绘制，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只管侧栏与英雄位。**品牌只填 shell 今天声明的席位。没有品牌席位的界面——文档标题、favicon、邮件模板——不在覆盖范围内，而覆盖它们意味着**为它声明一个席位**，而不是从这里伸手进去改那个界面。
- **名称席位渲染的是文字而非字图。**shell 自带的兜底是一张字标图；本占用者把字标与副标题渲染成排版文字，好让副标题可被翻译。需要矢量字图的部署应自行注册占用者。
- **没有明暗两套图。**标识继承 `currentColor`，因此在两种主题下都能读，但没有按主题分开的图形。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

占用者放在 `WindPilotBrand.tsx`、绘制放在 `WindPilotMark.tsx`，是为了让绘制在没有席位的情况下也能被测——组件测试就是这样做的：直接断言云朵路径、请求边长与类透传。

</details>

**运行时不变量：** 不发布 companion。每个占用者都是其席位所传 props 的纯函数，本插件不持有任何状态；它没有以可能与另一插件不一致的方式观测他人状态。
