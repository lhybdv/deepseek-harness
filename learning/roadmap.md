# 分阶段学习路线

- **学习对象**：`deepseek-harness`（`dsh`）—— 全插件化的 Cordis Agent Harness
- **目标层级**：`standard`（系统掌握）
- **前提**：会写 TypeScript；用过或写过插件式框架；**不需要**熟悉 agent 领域
- **总时长估计**：约 40–60 小时（Stage 1–6；可选 Stage 7 另计 8–12 小时。按每阶段末尾的验收标准是否通过来判断是否可以推进）

每个阶段都遵循同一结构：**目标 → 核心概念 → 任务 → 验收标准 → 常见失败模式**。验收标准一律是**可执行命令或可观察现象**，不是"感觉理解了"。

> 阶段之间是硬依赖。跳阶段最常见的后果不是"看不懂"，而是"看懂了但结论是错的"——例如没读完 Stage 2 就去读 `agent-loop`，会把 effect 回滚当成普通清理逻辑，从而误解工具注册的生命周期。

---

## Stage 1 — 跑起来，并建立全局地图

**目标**：让 `dsh` 在你的机器上真正运行，并能在 30 秒内说出"我要找的能力在 `packages/` 的哪一组"。

**核心概念**：仓库分组布局（`packages/<group>/<pkg>`）、唯一启动入口 `dsh`、Harness home（`$DSH_HOME`）、profile 概念的第一印象。

**任务**

1. 按 [docs/development.md](../docs/development.md#setup-tutorial) 完成安装；确认 `pnpm run typecheck` 通过。
2. 阅读 [README.md](../README.md)、[packages/README.md](../packages/README.md)、[AGENTS.md](../AGENTS.md) 的 `Repository layout` 与 `Commands` 两节。
3. 跑 `pnpm run build`，再跑 `pnpm dsh web`，在浏览器里发一条消息（需要 `DEEPSEEK_API_KEY`，或先用 `pnpm run mock:llm` 观察无 key 路径）。
4. 跑 `pnpm dsh --profile web --dump-config`，把输出存到你自己的笔记里。这是"这台机器实际会挂载什么"的权威答案。
5. 用 `read` 或编辑器浏览 `packages/` 的一级分组，为每组写一句"它拥有什么"。

**验收标准**

```sh
pnpm install && pnpm run typecheck          # 通过
pnpm run build                              # 产出 lib/ 与 Web 资产
pnpm dsh --profile web --dump-config         # 打印出可加载的 YAML 条目列表
```

能回答：`ctx.shell`、`ctx.subagents`、`ctx.sessionPersistence` 分别属于哪一组？（答案见 [docs/architecture.md](../docs/architecture.md#core-packages) 与各组 README。）

**常见失败模式**：在 Windows 上用原生工具链却把仓库放在 WSL 文件系统里（或反之）导致 I/O 极慢；跳过 `pnpm run build` 直接跑 profile，得到"缺少产物"的启动失败。见 [docs/development.md](../docs/development.md#windows-and-wsl-2)。

---

## Stage 2 — Cordis：插件、effect 与事件

**目标**：能独立写出一个可被 loader 装载、带配置、注册服务、派发事件的 Cordis 插件。

**核心概念**：Plugin / Context / Service、`inject` 依赖声明、**注册即副作用**、五种派发模式、waterfall 短路语义、`cordis.yml` 与 `!!js` 规则。

**任务**

1. 通读 [docs/cordis-primer.md](../docs/cordis-primer.md)（短，但每句都是契约）。
2. 逐章完成 [docs/cordis-tutorial/](../docs/cordis-tutorial/index.md) 的 7 章。在 `tmp/cordis-tutorial/` 里动手写，不要只读。

   ```sh
   mkdir -p tmp/cordis-tutorial && cd tmp/cordis-tutorial
   node --import tsx ../../vendor/cordis/bin.js
   ```

3. 精读 `vendor/cordis/` 的实现，至少覆盖：Context 与 effect 的实现、事件派发（`emit`/`waterfall` 的差异）、loader 如何把 YAML 条目变成挂载。
4. 做一次实验：故意写一个不调用 `next()` 的 waterfall 监听器，观察链被短路；再故意让 `cordis.yml` 里的 `!!js` 出现在 `config` 之外，观察加载失败。

**验收标准**

- 你写的插件能被 `cordis.yml` 装载，把它注释掉后服务消失（用 `ctx.<key>` 是否存在验证）。
- 你能解释：为什么 `inject` 能让装载顺序不依赖 YAML 里的行顺序。
- 你能指出 `vendor/` 中实现 effect 回滚的具体函数，并说明 disposer 的调用时机。

**常见失败模式**：把 `ctx.on()` 当成"全局单例订阅"（忘记它是 scope 化的、会随插件卸载消失）；把 declaration merging 当成运行时接线（它只改类型）。

---

## Stage 3 — 核心循环：session 日志、请求构造与工具管线

**目标**：能完整讲出"一条用户消息如何变成一个模型请求、模型回复如何落成持久事实"的全过程，并能定位每个环节的实现文件。

**核心概念**：turn / step、`SessionEvent` 与 append-only 日志、`deriveMessages()`、surface 折叠、system-prompt 装配、`prepareCall()` 与 request header、工具受保护管线。

**任务**

1. 读 [docs/architecture.md](../docs/architecture.md) 的 `Turn flow` 与 `Session log` 两节，配合 [docs/agent-lifecycle.md](../docs/agent-lifecycle.md) 的时序图。
2. 读 [packages/core/agent-loop/README.md](../packages/core/agent-loop/README.md) 的 `Understand the implementation`（尤其是 `Turn and step flow`、`Failure and cancellation`）。
3. 读 [docs/tool-execution-pipeline.md](../docs/tool-execution-pipeline.md)，把管线每个阶段与 [packages/core/tools/README.md](../packages/core/tools/README.md#extension-points) 的扩展点对上。
4. 源码精读（见 [source-reading.md](source-reading.md) 的 A 组）：`packages/core/session/src/index.ts`、`surface.ts`、`packages/core/agent-loop/src/agent.ts`、`tool-calls.ts`。
5. 做一次真实追踪：开一个 session，发一条会调用工具的提示，然后在 session 的 JSONL 文件里按顺序列出 `turn/start` → `step/start` → `user/message` → `assistant/message` → `tool/call` → `tool/result` → `step/end` → `turn/end`。

**验收标准**

- 能在不看代码的情况下画出 turn/step 状态机，并说出**哪一步在什么条件下不产生 step**（提示：`agent/pre-step` 的 reject 或首个 enter 被改写成空）。
- 能解释 `assistant/message` 与 `assistant/attempt` 的区别，以及为什么失败尝试也要落盘。
- 能说出 `tools/pre-execute`、`guard`、`ctx.approval` 三者的执行顺序与各自能否被后续撤销。

**常见失败模式**：把 `deriveMessages()` 当成"内存里的消息数组"（它是从日志折叠出来的投影）；以为 system prompt 作为请求的 `system` 字段发送（它只以 `system/message` 历史传输）。

---

## Stage 4 — 能力缝：设计 Definition / Provider / Consumer

**目标**：能为一条已存在的能力缝新增一个 provider 或 consumer，并说清"换掉 provider 之后产品里哪些行为会一起变"。

**核心概念**：三角色完备性、`ctx` 键的单复数约定、request/spec 显式拆分、provider 与"执行世界"的耦合、no-hardcoded-tunables。

**任务**

1. 用 `packages/shell` 三件套作为模板精读：`packages/shell/shell/src/index.ts`（Definition）、`packages/shell/bash-local/src/index.ts`（Provider）、`packages/shell/tool-bash/src/index.ts`（Consumer）。
2. 读 [docs/capability-seams.md](../docs/capability-seams.md)（生成的能力图），任选 5 条缝，写下各自的 Definition 包、已知 provider 与 consumer。
3. 对比 fs 与 subprocess 两条缝，解释为什么把它们指向远端沙箱会连带搬走 Bash、PTY 与 LSP。
4. 读 [docs/cookbook/adding-a-tool.md](../docs/cookbook/adding-a-tool.md)，把"最小形态""execute 契约""UI 呈现"三节读完。
5. 动手：写一个最小的 Consumer 工具（例如"读取当前 workspace 的 git 分支"），注册到 `ctx.tools`，用 profile patch 挂载，在 Web UI 里看到卡片。

**验收标准**

- 新工具的 schema 自动进入 system prompt 装配（无需手工注册分节）。
- 卸载插件后工具从 prompt 与执行两处同时消失（这是 effect 语义的直接验证）。
- 你能说出这条新工具的 `presentCall` / `presentResult` 为什么必须是纯函数。

**常见失败模式**：把部署策略写进工具实现（应该放进 `tools/pre-execute` 或 guard）；直接在 `run()` 里写 `?? default`（应该显式拆出 `resolve(request): Spec`）。

---

## Stage 5 — 组合：profile、bundle 与 patch 分层

**目标**：能解释"同一份代码如何启动出 web / headless / sdk / acp 四种不同产品"，并能安全地覆盖某一行配置。

**核心概念**：profile 与 bundle 的分工、`dsh.profile.bundles` / `dsh.bundle.patch` 两个 manifest 字段、四层 patch 的应用顺序、`patchReload: live | startup` 的生命周期差异、唯一启动入口规则。

**任务**

1. 读 [apps/cli/README.md](../apps/cli/README.md)（入口模式、profiles、app 参数交接）与 [docs/architecture.md](../docs/architecture.md#profiles-and-bundles)。
2. 读 [packages/boot/app-boot/README.md](../packages/boot/app-boot/README.md)；在源码里找到 `PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:105-125`）并核对五个 profile 的 bundle 列表。
3. 读 `packages/bundle/base/cordis.patch.yml`，找出它贡献的关键行（模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测）。
4. 做一次覆盖实验：写一个 `--patch` 覆盖层，改掉 base 里某一行的 config（例如把某个工具的默认值改掉），用 `--dump-config` 验证只有那一行变化，并确认出处注释标出了你的层。
5. 读 [scripts/verify-application-entrypoints.ts](../scripts/verify-application-entrypoints.ts) 的类表，理解"什么算合法启动路径"。

**验收标准**

- `dsh --profile web --dump-config` 的输出里，你能指出每一行来自哪个 bundle / 哪个 patch 文件。
- 你写的 patch 能生效；改坏它之后，**最后一次已知良好的应用继续运行**（`live` profile 的行为）。
- 能解释 `sdk-minimal` 为什么是"刻意的例外"。

**常见失败模式**：直接改 bundle 的 patch 文件而不是写覆盖层（会让你的改动被下一次同步冲掉）；在 `startup` profile 上期待热改生效。

---

## Stage 6 — 持久化、投影与双面载体

**目标**：理解会话数据的长期契约（格式版本、迁移链、投影）与 Host/Client 双面通信（Typert / Remote），能够安全地演进会话事件与前端能力。

**核心概念**：`SESSION_FORMAT_VERSION` 与 generation 文件命名、相邻迁移链、projection seam（`stateOf()` 与 `snapshot()`）、Host/Client 双聚合与 declaration merging 冲突、`@Remote` 生成物。

**任务**

1. 读 [docs/session-format-status.md](../docs/session-format-status.md) 与 [docs/subsystems/persistence.md](../docs/subsystems/persistence.md)。
2. 在 `packages/session/` 下定位：JSONL provider 的物理封装与 generation 选择、迁移包的 `vN -> vN+1` 单步实现、`sessionProjections` 注册点。
3. 读 [docs/cookbook/adding-a-session-format-version.md](../docs/cookbook/adding-a-session-format-version.md)，写出一份"若我要加一个结构性事件，需要动哪些文件"的清单（不实际改）。
4. 读 [docs/development.md](../docs/development.md#typescript-project-layout)，解释为什么 Host 与 Client 必须是两个 `ts.Program`。
5. 读 [docs/api-gateway.md](../docs/api-gateway.md) 与 [docs/subsystems/typert.md](../docs/subsystems/typert.md)，找一个真实 `@Remote` 方法，跟出它在客户端侧的生成调用。

**验收标准**

- 能说出 `stat`/`list`/`open` 三种会话消费路径各自加载了什么、是否发布后继 generation。
- 能解释为什么"已提交的 generation 永不重命名、覆盖或删除"。
- 能说出一个客户端 Chat 节点从 session 事件到渲染的完整链路（事件 → 投影 → snapshot → 客户端模型 → 渲染）。

**常见失败模式**：把投影当缓存（它是唯一的状态读取缝，缺注册要显式失败而不是默认值）；在 Client 侧 import Host 的 tool 实现。

---

## Stage 7（`deep` 深度可选）— 政策层与工程约束

**目标**：从"会用"变成"能改产品行为"，并理解这个仓库为什么能在这么大的规模上保持可维护。

**核心概念**：subagent 家族与 provider 差异、goal / Ralph / Agent Teams 三者的语义边界、compaction 两条触发路径、运行时 invariant、测试分层与快照机制、文档与生成的联动门。

**任务**

1. 读 [docs/subsystems/subagent.md](../docs/subsystems/subagent.md)、[docs/subsystems/agent-team.md](../docs/subsystems/agent-team.md)、[docs/glossary.md](../docs/glossary.md) 的 goal / Ralph 段。
2. 读 [docs/testing.md](../docs/testing.md)，跑通 `pnpm run test` 与 `pnpm run test:snapshot`（keyless）；找一个快照场景，读它的 `snapshot.yml` 与录制的 session 文件。
3. 读 [docs/defensive-patterns.md](../docs/defensive-patterns.md)，在源码里找到 3 个对应的防御模式实例。
4. 读 [.agents/notes/](../.agents/notes/README.md) 中的 3 篇 `implemented/architecture/` 笔记，理解"决策记录"这个层的写法与用途。
5. 挑一个真实的小需求（例如给某个工具加一个 guard 策略），走完整流程：改代码 → 改文档 → 加测试 → 跑 `pnpm run doc-sync` 与相关门。

**验收标准**

- 能说出 goal round、turn、Ralph round 三者的包含关系与各自的所有者。
- 能解释为什么"新增模型可见输入"必须同时更新 TypeScript 与 Python SDK 的预期输出。
- 你的那次真实改动通过：`pnpm run typecheck`、相关的 `pnpm run test`、以及 `pnpm run test:snapshot`。

---

## 阶段推进的判断规则

| 信号 | 含义 | 行动 |
|---|---|---|
| 验收命令通过，但自检清单答不上 | 只有操作记忆，没有模型 | 回读该阶段的概念表，别推进 |
| 能讲清机制，但命令失败 | 环境或产物问题 | 先修环境，见 Stage 1 的失败模式 |
| 能在源码里直接定位陌生概念 | 已建立索引 | 推进下一阶段 |
| 读完一个文件却说不清它的"拥有物" | 该文件属于更高阶段的层 | 记下路径，回到当前阶段的文件 |

## 与仓库既有教程的关系

仓库自带两条已成体系的路径，本路线图**不复述**它们，而是把它们编排进阶段：

| 既有资源 | 位置 | 对应阶段 |
|---|---|---|
| Cordis 7 章动手教程 | [docs/cordis-tutorial/](../docs/cordis-tutorial/index.md) | Stage 2 |
| Harness 插件开发入门 | [docs/user/develop/basic/](../docs/user/develop/basic/index.md) | Stage 2 → 4 |
| 框架机制（服务、事件） | [docs/user/develop/framework/](../docs/user/develop/framework/index.md) | Stage 2 |
| 实践（LLM 适配器、动态 Cordis） | [docs/user/develop/practice/](../docs/user/develop/practice/index.md) | Stage 4、6 |
| 能力缝与核心服务图 | [docs/capability-seams.md](../docs/capability-seams.md) | Stage 4 |
| cookbook（加包 / 加工具 / 加适配器 / 会话格式版本） | [docs/cookbook/](../docs/cookbook/adding-a-package.md) | Stage 4 → 6 |

> 本仓库绝大多数 `docs/*.md` 都有对应的 `*.zh.md` 中文版（例如 [docs/architecture.zh.md](../docs/architecture.zh.md)）。中文阅读体验更好时直接用中文版；但 **package README 的技术契约以英文版为准**，中文版是配对维护的译文。
