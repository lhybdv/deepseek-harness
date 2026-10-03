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
| `speech-to-text-rtasr`、`speech-to-text`（打补丁） | 演示所用的语音识别器：启用并选中语音输入 Bundle 的云端行。 |
| `skill-filesystem`（打补丁） | 把 `customSkillDirs` 指向 `./skills`，并启用 `tool-skill`，使 agent 能加载它们。 |

已发布的 `web` profile 已经提供模型适配器、工具注册表、会话日志与浏览器应用；这个 overlay 只加气象相关的行。

## 语音输入

输入框旁的麦克风录制一个问题，并把转写文字作为普通文本插入草稿，因此语音提问与打字提问到达 agent 的方式完全一致。选中本 overlay 的云端识别器时，问题还在说出口的过程中文字就会出现，并随服务对每句话的修正而自我纠正；进入草稿的是修正完成后的转写。语音输入本身随「语音输入」Bundle 提供、而非随本 overlay：请在插件管理页启用它。下面两行只配置该 Bundle 所在的层——在它启用之前保持惰性（各产生一条 Loader 警告）——把演示切到云端识别并选中它。

识别器从 `IFLYTEK_RTASR_APP_ID` 与 `IFLYTEK_RTASR_ACCESS_KEY_ID` 读取应用标识与 Access Key ID，并从凭据引用 `IFLYTEK_RTASR_ACCESS_KEY_SECRET` 读取 Access Key Secret——可通过 `dsh` 凭据、环境变量或仓库 `.env` 提供。缺少取值时只有该次录音失败并指明缺失字段，演示其余部分不受影响，且录音开始前不会读取任何凭据。Host 必须能访问
`wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1`；处于代理之后的部署把 `baseWsUrl` 指向自己的端点。

## 与正式部署的差异

把本 overlay 换成已发布的 bundle 是一次 profile 变更，而非代码变更：在 profile 的 bundle 列表里加上 `@deepseek-ai/dsh-meteo-app`，并在它的 `meteo-data.fixtureDir` 所指处发布一个数据包。见
[`packages/bundle/meteo-app`](../../../../../packages/bundle/meteo-app/README.zh.md)。

## Skills

`skills/` 存放 agent 按需加载的咨询口径：

- `meteo-query-normalize` —— 如何把口语问题转成工具所取的槽位，以及何时该先问而不是猜。
- `meteo-consult-protocol` —— 按什么顺序读一份咨询结果，以及如何把数据支持的结论与不支持的结论分开。
- `meteo-citation-policy` —— 什么情况下结论必须引用语料片段，以及一条引用必须指明什么。

它们只承载过程与措辞。每一个数值阈值、作物判据、分类标签与模板都住在部署的版本化数据里，因此改一个阈值就会改变答案，而不必编辑任何 skill。
