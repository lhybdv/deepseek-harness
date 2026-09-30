# 气象演示 overlay

[English](README.md) | 中文

一个 `--patch` overlay，把气象咨询界面加进已发布的 Web 组合。它的存在是为了让演示能从源码检出直接运行、而不需要已发布的数据包，也让咨询 skill 随演示走、而不随某个包发布。

## 运行

```sh
pnpm run build
pnpm dsh web --patch ./apps/cli/config/examples/meteo/cordis.yml
```

打开启动器打印的 URL，**连同其中的 token 一起**，在 `http://127.0.0.1` 上。

请在仓库根目录运行：下面有两个取值是按进程工作目录解析的，因为演示用 fixtures 与 skills 都在仓库里，且刻意不随各自的包发布。

## 它加了什么

| 行 | 为什么 |
|---|---|
| `meteo-corpus` | 语料接缝与它自己持有的 SQLite FTS5 索引，位于 `<DSH_HOME>/meteo/corpus.v1.sqlite`。 |
| `meteo-data` | 数据接缝，读取 `packages/meteo/meteo-data/fixtures`。 |
| `tool-corpus` | `corpus_ingest` / `corpus_search` / `corpus_read`。 |
| `tool-meteo` | `meteo_consult` / `meteo_station_lookup` / `meteo_set_focus`。 |
| `meteo-controller` | 浏览器面板所调用的 `meteo` Remote 命名空间。 |
| `ui-meteo`、`ui-meteo-chat` | 语料库页面与会话卡片。 |
| `skill-filesystem`（打补丁） | 把 `customSkillDirs` 指向 `./skills`，并启用 `tool-skill`，使 agent 能加载它们。 |

已发布的 `web` profile 已经提供模型适配器、工具注册表、会话日志与浏览器应用；这个 overlay 只加气象相关的行。

## 与正式部署的差异

把本 overlay 换成已发布的 bundle 是一次 profile 变更，而非代码变更：在 profile 的 bundle 列表里加上 `@deepseek-ai/dsh-meteo-app`，并在它的 `meteo-data.fixtureDir` 所指处发布一个数据包。见
[`packages/bundle/meteo-app`](../../../../../packages/bundle/meteo-app/README.zh.md)。

## Skills

`skills/` 存放 agent 按需加载的咨询口径：

- `meteo-query-normalize` —— 如何把口语问题转成工具所取的槽位，以及何时该先问而不是猜。
- `meteo-consult-protocol` —— 按什么顺序读一份咨询结果，以及如何把数据支持的结论与不支持的结论分开。
- `meteo-citation-policy` —— 什么情况下结论必须引用语料片段，以及一条引用必须指明什么。

它们只承载过程与措辞。每一个数值阈值、作物判据、分类标签与模板都住在部署的版本化数据里，因此改一个阈值就会改变答案，而不必编辑任何 skill。
