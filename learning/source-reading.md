# 源码导读

**15 个核心文件**（分 6 组，标注为必读）+ 8 个标注「（补充）」的按需文件，共 23 个，按**阅读顺序**排列。补充文件不影响阶段推进，卡住时再回来看。这个顺序不是按目录树的顺序，而是按"读懂下一个文件所依赖的知识"排序：先 Cordis 底座 → 再最小契约 → 再会话日志 → 再循环 → 再缝模板 → 最后组合与产品行。

每个条目给出四件事：**为什么读**（它解决什么问题）、**读什么**（具体行段）、**读完应能回答什么**（验收）、**现在跳过什么**（避免在第一次读时陷入细节）。

- 阅读阶段对应 [roadmap.md](roadmap.md) 的 Stage 编号。
- 行号以当前检出为准；重构后行号会漂移，请用符号名（类名/函数名）搜索定位。

---

## 组 A：Cordis 底座（Stage 2）

### A1. `vendor/cordis/src/context.ts` — 约 400 行

- **为什么读**：`Context` 是"服务容器"这个抽象的唯一实现。整个 harness 的 API 表面（`ctx.tools`、`ctx.llm`……）都源自这里，不读它就只能靠猜。
- **读什么**：
  - `class Context`（`:42`）的字段与方法清单——重点是它如何持有服务和 fiber。
  - `ctx.plugin()` 的装载/卸载路径。
  - 声明合并的挂载点（`interface Context` 扩展处）。
- **读完应能回答**：`ctx` 的一个属性是什么时候变成可用服务的？插件卸载时它的属性去哪了？
- **先跳过**：reflect 相关的元数据细节。

### A2. `vendor/cordis/src/events.ts` — 约 100 行（短，全读）

- **为什么读**：五种派发模式的类型契约在这里，而不是在文档里。类型签名本身就说明了"能否等待、是否有返回值"。
- **读什么**：
  - `parallel`（`:44`，返回 `Promise<void>`）、`emit`（`:53`，返回 `void`）。
  - `serial`（`:63`）、`bail`（`:73`）、`waterfall`（`:86`）。
  - 对比它们的返回类型差异，这就是"模式决定能力"的机器可读证明。
- **读完应能回答**：为什么 `waterfall` 能被包装（around-middleware），而 `emit` 不能？
- **先跳过**：`thisArg` 的重载——那是作用域派发的细节，Stage 3 之后再看。

### A3. `vendor/cordis/src/fiber.ts` — 定位 `effect`

- **为什么读**：**注册即副作用**这条全仓规则在这里落地。`ctx.effect()` 返回 disposer，这是"HMR 安全"的根本原因。
- **读什么**：
  - `effect()` 的三个重载（`:415`、`:417`、`:418`）——注意"执行体同步返回 disposer"与"异步返回"两类。
  - 卸载时 disposer 的调用顺序（是否逆序、是否等待）。
- **读完应能回答**：如果一个插件注册了 3 个 effect 后抛异常，这 3 个注册的最终状态是什么？
- **先跳过**：fiber 的调度与 HMR 重载细节（Stage 5 再回来看）。

### A4. `docs/cordis-tutorial/` + `vendor/cordis/bin.js`（补充）

- **为什么读**：这是仓库自带的可执行教程，比任何二手解读都准。`vendor/cordis/bin.js` 只有几十行，是"一个 Context + 一个 Loader + 一个 cordis.yml"的最小完整启动。
- **读什么**：7 章按顺序做，在 `tmp/cordis-tutorial/` 里真跑；重点看第 2 章（effect 生命周期）与第 4 章（事件与 waterfall 短路）。
- **读完应能回答**：`inject` 如何让装载顺序与 YAML 行顺序解耦？
- **先跳过**：第 6 章的 HMR 诊断细节。

---

## 组 B：最小契约与日志（Stage 3）

### B1. `packages/core/agent/src/types.ts` — 95 行（全读）

- **为什么读**：这是扩展插件唯一允许依赖的 agent 接口。**先读接口，再读实现**，否则会被 600 行的驱动淹没。
- **读什么**：整个 `Agent` 接口。重点：
  - `send(message, target, wakeup)` 与 `followup`/`steer`/`inject` 的关系（后三者是固定预设的别名）。
  - `cancel()` 的 `keepInbox` 语义与"首个原因胜出"。
  - `whenIdle()` 与 `runMaintenance()` 的区别——后者是从真正空闲相位起跑的一次性维护任务。
- **读完应能回答**：`cancel()` 在没有活跃活动时是 no-op 还是"预埋取消"？（答案：no-op，不预埋。）
- **先跳过**：`ctx.agents` 的 registry 细节。

### B2. `packages/core/agent/src/index.ts` — 690 行（补充）

- **为什么读**：`AgentHandle` 的"句柄即能力"语义、创建/恢复的事务回滚，都在这里。
- **读什么**：
  - `AgentHandle`（`:160`）：为什么只有持有者能拆卸，`ctx.agents.get()` 为什么只返回裸 `Agent`。
  - `CreateAgentOptions`（`:62`）/ `ResumeAgentOptions`（`:125`）：`setup` 窗口的输入到底是什么。
  - `AgentFactory`（`:171`）：loop 如何把自己注册进 registry。
  - `AgentRegistry`（`:245`）的 `create`/`resume`：进入 registry 的顺序、`session/created` 与 `agent/created` 的发布时机。
- **读完应能回答**：创建过程中 `setup` 抛异常，会不会留下一个半注册的 session？
- **先跳过**：`dispatch.ts` 的作用域派发载体（Stage 6 再看）。

### B3. `packages/core/session/src/types.ts` — 495 行

- **为什么读**：`SessionEventMap`（`:269`）是整个产品的事件字典；`SESSION_FORMAT_VERSION`（`:88`）是持久格式的唯一手工维护数字。
- **读什么**：
  - 顶部的事件信封（含 `version` 字段，`:98`）。
  - `SessionEventMap` 的成员分组：`turn/*`、`step/*`、`message` 类、`tool/*`、`request/*`。
  - 品牌 id（`Branded<B>`）的使用位置——为什么会话 id 不能是裸 `string`。
- **读完应能回答**：新增一个事件，什么情况下必须 bump `SESSION_FORMAT_VERSION`，什么情况下只需 `ignorable: true`？
- **先跳过**：`seq-ranges.ts` 的压缩编码（需要时再查）。

### B4. `packages/core/session/src/surface.ts` — 约 520 行

- **为什么读**：这是"模型历史如何从日志投影出来"的核心。不理解 surface 折叠，就会把 `deriveMessages()` 误解成内存数组。
- **读什么**：
  - `deriveEventMessage()`（`:92`）——**每个节点一条投影规则**，事件如何变成消息。
  - `isAppendSurfaceEvent` / `isReplacementSurfaceEvent`（`:60` / `:73`）——追加与替换的区别。
  - `foldSurface()`（`:487`）与 `SurfaceManager`（`:504`）——替换事件如何**遮蔽**（而非删除）旧节点。
- **读完应能回答**：压缩（compaction）之后，被遮蔽的历史还在日志里吗？`deriveMessages()` 会返回它们吗？
- **先跳过**：`validateSurfaceMetadata` 的校验细节。

### B5. `packages/core/session/src/index.ts` — 1284 行（分段读）（补充）

- **为什么读**：`Session` 类与 `SessionStore` 是 `ctx.sessions` 的实现。
- **读什么**：
  - `Session`（`:446`）的字段与公开方法清单。
  - `append()`（`:710`）——注意它如何同时服务于内存折叠与持久化路由。
  - `deriveMessages()`（`:832`）——它会缓存投影；缓存与 `append` 的关系是关键。
  - `SessionStore`（`:899`）与 `adoptSessionEvent` / `snapshotSessionEvent`（`:166` / `:194`）。
- **读完应能回答**：`deriveMessages()` 为什么可以缓存？什么操作会让缓存失效？
- **先跳过**：fork 错误分类（`:867` 起）与 `seq-ranges` 重导出。

---

## 组 C：循环（Stage 3）

### C1. `packages/core/agent-loop/src/agent.ts` — 619 行（本清单最重要的一篇）

- **为什么读**：整个产品的"发动机"就在这里。读完之后，`docs/architecture.md` 的 `Turn flow` 会从"名词列表"变成"你见过的代码"。
- **读什么**：
  - `ReactLoopAgent`（`:72`）的构造与相位机 `setPhase`（`:119`）。
  - `send`/`followup`/`steer`/`inject`（`:128`–`:145`）：入队与唤醒的路由。
  - `wakeDriver`（`:187`）：取消收敛后仍要开 turn 的 latch 语义。
  - `kick()`（`:225`）→ `turn()`（`:269`）→ `step()`（`:352`）：主循环的三层。
  - `preStep()`（`:240`）：认领与 `agent/pre-step` 的 enter/reject 决策。
  - `prepareRequest()`（`:501`）与 `buildRequest()`（`:553`）：请求构造、header 记录、冻结。
- **读完应能回答**：
  - 一个 turn 在什么条件下产生 **0 个 step**？
  - 重试（retry）为什么不重复 `agent/pre-step`，也不重复 user 消息的提交？
  - 取消发生在 `prepareCall()` 期间，`system/message` 与 `user/message` 会不会各提交一半？
- **先跳过**：`runtime-context.ts` 的注入细节与 `invariant.ts`。

### C2. `packages/core/agent-loop/src/tool-calls.ts` — 定位 `executeToolCalls`（补充）

- **为什么读**：工具批次的调度策略（有界并发池 + exclusive 屏障）与结果排序都在这里。这是"分类是一元的"这条限制的直接来源。
- **读什么**：`executeToolCalls`（`:60`）——分类（`executionMode`）→ 屏障/池 → `tool/call` → 执行 → `tool/result` 的模型顺序保持。
- **读完应能回答**：为什么"安全性依赖兄弟调用比较"的工具必须保持 exclusive？
- **先跳过**：`assistant-stream.ts` 的帧结算细节（除非在查 UI 增量问题）。

---

## 组 D：请求构造与工具管线（Stage 3）

### D1. `packages/core/system-prompt/src/index.ts` — 约 630 行

- **为什么读**：模型看到的提示词是"装配"出来的，不是拼字符串拼出来的。装配是 waterfall，权威装配者要为协议一致性负责。
- **读什么**：
  - `AssembleContext`（`:42`）、`PromptSection`（`:53`）、`PromptAssembly`（`:114`）。
  - `SystemPrompt` 服务类（`:399`）的注册表与分节来源。
  - `renderPrompt()`（`:273`）与 `renderContextSections()`（`:312`）：渲染产物的边界。
- **读完应能回答**：一个插件注册的 prompt 分节，如何决定它出现在提示词的第几段？被 scoped 遮蔽时表现是什么？
- **先跳过**：`PromptLayer`（`:365`）的 scope 层实现细节（Stage 6 回看）。

### D2. `packages/llm/llm/src/types.ts` — 459 行

- **为什么读**：`Message` / `ContentBlock` / `StreamChunk` 是全仓共享的对话词汇。任何"模型能看到什么"的问题最终都落在这几个类型上。
- **读什么**：三个核心类型的定义与判别标签（switch 的 discriminant）；`StreamChunk` 的帧种类。
- **读完应能回答**：一次失败的流式响应在类型层面如何表达？为什么需要 `assistant/attempt`？
- **先跳过**：`attribution.ts` 与 `brand.ts`。

### D3. `packages/llm/llm/src/index.ts` — 定位适配器契约

- **为什么读**：`LlmAdapter` 是所有模型 provider 的公共基类；`prepareCall()` 是"路由解析"与"默认值解析"的分界。
- **读什么**：
  - `LlmAdapter`（`:200`）的抽象方法。
  - `PreparedLlmCall`（`:163`）与 `AdapterRegistrationHandle`（`:288`）。
  - `LlmError`（`:91`）与 `assertUsableApiKey`（`:145`）——错误与密钥失败的边界。
- **读完应能回答**：`prepareCall()` 解析出的路由，为什么必须在同一次请求的日志记录与派发中保持同一个 adapter 实例？
- **先跳过**：`assembler.ts` 的 `BlockAssembler`（除非在调试流式拼接）。

### D4. `packages/core/tools/src/index.ts` + `types.ts` — 定位工具契约

- **为什么读**：`ToolDefinition` 与受保护管线的类型在这里；策略扩展点的输入输出契约在 `packages/core/tools/README.md#extension-points`。
- **读什么**：
  - `ToolDefinition`（`index.ts:214`）、`ToolResult`（`:283`）、`ToolExecution`（`:372`）。
  - `ToolExecutionMode`（`:337`）与 `ToolRuntimeScheduler`（`:444`）。
  - 常量 `TOOL_ABORTED`（`:462`）与 `TOOL_ABORTED_BEFORE_DISPATCH`（`:465`）。
- **读完应能回答**：一个被取消的工具调用会留下什么痕迹（事件 + 结果）？
- **先跳过**：`ptc.ts`、`ts-types.ts`、`py-types.ts` 的代码生成部分。

---

## 组 E：一条完整的缝（Stage 4）

这一组要**连着读**，它们是同一条能力缝的三个角色。读法的关键是不断问："这个角色知道什么、不知道什么？"

### E1. `packages/shell/shell/src/index.ts` — 102 行（全读，Definition）

- **为什么读**：这是全仓最干净的 Service Definition 模板。
- **读什么**：
  - `declare module` 里 `shell: ShellExecutor` 的声明（类型接线）。
  - `ShellExecutor` 抽象类的方法与其 JSDoc 语义条款（哪些情况 reject、哪些情况 resolve）。
  - 设置命名空间 `SHELL_SETTINGS_NAMESPACE`（`:20`）为什么归 Definition 包而不归 provider。
- **读完应能回答**：为什么"非零退出码"不是 reject，而"基础设施失败"是？

### E2. `packages/shell/bash-local/src/index.ts` — 342 行（Provider）

- **为什么读**：看一个 provider 如何**只**实现机制，把策略留给别处。
- **读什么**：
  - `ENV_OVERRIDES`（`:29`）：模型友好环境的构造（禁用颜色/分页器/交互特性）。
  - `Config` 接口与 `static Config`：可配置项如何做到"无硬编码 tunable"。
  - request → spec 的解析步骤（显式 defaulting 的位置），以及 `ctx.subprocess` 的使用方式。
- **读完应能回答**：为什么执行策略（超时/审批/沙箱）不该写在这个文件里？

### E3. `packages/shell/tool-bash/src/index.ts` — 393 行（Consumer）

- **为什么读**：这是模型真正看到的那一层：schema、`execute`、后台分支、UI 呈现。
- **读什么**：
  - 用 `defineTool` 声明的参数 schema 与 `output.schema`（programmatic API）的区分。
  - 后台工作如何通过 `ctx.jobs.start()` 发布（以及为什么成功后不能再用 `exec.signal`）。
  - `presentCall` / `presentResult` 的**纯函数**约束。
- **读完应能回答**：`output.render`（给模型看）与 UI 卡片（给人看）为什么是两件事？
- **先跳过**：`background.ts` 与 `render.ts` 的渲染细节。

---

## 组 F：组合与产品行（Stage 5）

### F1. `apps/cli/src/bin.ts` — 66 行（全读，唯一入口）

- **为什么读**：它是所有受支持应用的唯一入口，短到可以一次读完，却是"启动契约"的落地。
- **读什么**：`runCli()` 的 mode 分支（`profile` / `plugin` / …）与 `profile-boot.ts` 的延迟 import。
- **读完应能回答**：为什么 package bin 与 demo 不被允许各自做启动逻辑？

### F2. `apps/cli/src/profile-boot.ts` — 306 行（补充）

- **为什么读**：四层 patch 的应用顺序在这里被真正执行。
- **读什么**：入口收集（bundle patches → profile patch → home patch → overlays）与失败处理。
- **读完应能回答**：`--patch` 覆盖层能否插入一个全新的 row？能否替换已有 row 的整个 config？

### F3. `packages/boot/app-boot/src/profile.ts` — 848 行（分段读）（补充）

- **为什么读**：profile 模板、初始化、bundle 解析、依赖链接的完整实现。
- **读什么**：
  - `PROFILE_TEMPLATES`（`:105-125`）：五个 shipped profile 的 bundle 列表与 reload 策略。
  - `DEFAULT_PROFILE_PATCH_RELOAD`（`:137`）与 `:177` 写入 `dsh.profile` 的位置。
  - `loadProfileDirectory` 与 bundle 目录解析（`loadProfile` 附近）——理解 profile 的 `node_modules` 如何供给外部插件。
- **读完应能回答**：`sdk-minimal` 为什么不需要 `dsh-base`？profile 里安装的第三方插件放在哪里？

### F4. `vendor/include/src/index.ts` — 定位 `applyEntryPatches`（补充）

- **为什么读**：patch 的**语义**（按 id 命中、整行替换 config、插入新行）只有这里说了算。
- **读什么**：`applyEntryPatches`（`:58`）及 `:30-120` 区段：命中规则、未命中行的处理、`!!js` 表达式的保留。
- **读完应能回答**：一个 patch 命不中任何 row 时会发生什么？（在 dump 时会报出层标签。）

### F5. `packages/bundle/base/cordis.patch.yml`（补充）

- **为什么读**：这是"产品实际长什么样"的清单——模型适配器、工具、持久化、沙箱、审批、设置、凭据、遥测，一行一个决策。
- **读什么**：整份文件的 row 列表与注释；把每一行映射到你在 Stage 3/4 读过的包。
- **读完应能回答**：想给整个产品换一个 shell provider，需要改哪一行？

---

## 阅读节奏建议

| 组 | 建议时长 | 读法 |
|---|---|---|
| A（Cordis 底座） | 4–6 h | 动手为主，配合 tutorial 写代码 |
| B（契约与日志） | 3–4 h | 精读接口，日志实现可跳读 |
| C（循环） | 4–6 h | **不要跳**，这是核心 |
| D（请求与工具） | 3–4 h | 以"模型看到什么"为主线 |
| E（一条缝） | 2–3 h | 三角色连读，边读边对比职责边界 |
| F（组合） | 2–3 h | 配合 `--dump-config` 验证 |

**通用技巧**：读任何文件前先看它的 README（`packages/<group>/<pkg>/README.md`）。这个仓库的包 README 是按契约写的（purpose / config / extension points / Model Experience / Known Limitations），比源码注释更省时间。中文阅读更快时，多数 README 有 `README.zh.md` 配对版本。

## 读源码时不要做的事

- **不要**从 `packages/` 的字母序开始读——`api/`、`client/` 是大规模载体层，脱离脊柱层去读只会得到一堆无法解释的类型。
- **不要**先读 `packages/experimental/`——标注为未发布原型，随时会变。
- **不要**把生成文件当作事实来源手工修改：`docs/capability-seams.md`、`docs/module-graph.md`、`docs/tool-catalog.md`、`docs/config-catalog.md` 都由脚本生成并有新鲜度门。
- **不要**用行号硬编码引用——用符号名搜索，重构会让行号漂移。
