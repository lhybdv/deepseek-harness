# 实践任务清单

20 个任务，覆盖 **理解 → 修改 → 创造** 三个层次。每个任务都给出可执行的验收标准，**不接受"看起来对了"**。

通用规则：

- 在 `tmp/` 下做实验（已被 gitignore），不要把练习产物提交进仓库。
- 无 API key 时用 `pnpm run mock:llm` 起一个可脚本化的 OpenAI 兼容端点，把适配器 base URL 指向它即可完成所有需要模型的任务（支持脚本化故障序列：断开、限流、畸形块、工具调用）。
- 「交付物」是你自己的笔记或 `tmp/` 下的代码，**不是**仓库文件。
- 做完任何练习后，若你改了仓库里的真实文件，至少跑一次 `pnpm run typecheck`。

图例：★☆☆ ≈ 30 分钟内，★★☆ ≈ 半天内，★★★ ≈ 一天以上。

---

## Stage 1 · 建立全局地图

### 练习 1.1 · 说出"东西在哪" ★☆☆

- **层次**：理解
- **前置**：完成安装且 `pnpm run typecheck` 通过

**描述**：不查文档，先凭 `packages/` 的分组名写出你的猜测，然后逐一核对。

**要求**

1. 为每个分组写一句"它拥有什么"。
2. 给出 10 个 `ctx.<key>` 键，写出它由哪个包声明（**先别看** [concepts.md](concepts.md) 的表格）。
3. 核对后记录错误项——错误项就是你的知识边界。

**验收标准**

- 10 个键里至少 7 个包名正确。
- 能解释 `core/` 与 `bundle/` 的区别：一个拥有行为，一个拥有组合。

**提示**：`grep -rn "declare module '@deepseek-ai/cordis'" --include=index.ts packages/*/*/src` 能一次性列出全部服务键声明。

**交付物**：一份"分组 → 职责"表，标注错误项。

---

### 练习 1.2 · 解读 `--dump-config` ★☆☆

- **层次**：理解
- **前置**：练习 1.1

**描述**：`--dump-config` 打印"这台机器实际会挂载什么"，是理解组合层最快的入口。

**要求**

1. 跑 `pnpm dsh --profile web --dump-config > tmp/web.dump.yml`。
2. 找出 `ctx.llm` 的 provider row、`ctx.shell` 的 provider row，以及 `dsh-base` 贡献的任一行，各自标注来源注释。
3. 对比 `pnpm dsh --profile sdk-minimal --dump-config`，列出至少 5 条差异。

**验收标准**

- 能指出输出里每一段分别来自哪个 bundle 或哪个 patch 文件。
- 能说出 `sdk-minimal` 为什么不包含 `dsh-base` 的行。

**注意**：`renderConfigDump` 明确**不承诺**跨版本字节稳定，所以不要把输出当作可编程接口去断言（见 `packages/boot/app-boot/README.md` 的 Dev Note）。

**交付物**：`tmp/web.dump.yml` + 差异表。

---

## Stage 2 · Cordis 底座

### 练习 2.1 · effect 的反转 ★☆☆

- **层次**：理解
- **前置**：完成 [docs/cordis-tutorial/02-lifecycle-and-effects.md](../docs/cordis-tutorial/02-lifecycle-and-effects.md)

**描述**：亲手证明"注册即副作用"。

**要求**

1. 写一个插件，在 `apply(ctx)` 中通过 `ctx.effect()` 注册 3 个资源，每个 disposer 打印自己的名字。
2. 把该插件行从 `cordis.yml` 注释掉后重启，观察 disposer 的**调用顺序**。
3. 写一个变体：让第 2 个注册抛异常，观察第 1 个是否被回滚。

**验收标准**

- 你能写出观察到的释放顺序，并解释它是否印证了"顺序敏感就放进同一个 effect"。
- 变体结论明确：注册过程中抛异常时，已完成的注册是否被回收。

**提示**：`vendor/cordis/src/fiber.ts:415-418` 是 `effect()` 的三个重载，注意"同步返回 disposer"与"异步返回"的差别。

---

### 练习 2.2 · 短路一个 waterfall ★☆☆

- **层次**：理解
- **前置**：练习 2.1

**描述**：亲手制造一次静默短路，体会"忘记 `next()`"为什么危险。

**要求**

1. 定义一个自有事件并用 `waterfall` 派发。
2. 注册三个监听器：第一个 mutate 后 `next()`，第二个**不**调用 `next()` 直接返回，第三个打印自己。
3. 确认第三个**不会**被调用；修好第二个后确认恢复调用。

**验收标准**

- 能说清 `emit` / `waterfall` / `parallel` / `serial` / `bail` 在"是否等待、是否有返回值"上的差异（对照 `vendor/cordis/src/events.ts:44-88` 的类型签名）。
- 能举出 harness 中三个真实 waterfall：`agent/pre-step`、`agent/request`、`tools/pre-execute`。

---

### 练习 2.3 · 带配置校验的服务 ★★☆

- **层次**：修改
- **前置**：完成 tutorial 第 3、5 章

**描述**：写一对"声明服务 / 消费服务"的插件，配置非法时在**加载期**失败。

**要求**

1. 插件 A 用 `Service` 子类声明 `ctx.greeter`，字段来自 `cordis.yml`。
2. 用 schemastery 校验：一个必填字符串 + 一个有范围限制的数字。
3. 插件 B 用 `inject` 依赖 `ctx.greeter` 并调用它。
4. 给一个越界数字，确认加载**失败并指出原因**，而不是静默取默认值。

**验收标准**

- 非法配置下进程非零退出，错误信息指出来源。
- 注释掉插件 A 后，插件 B 不崩溃而是等待（`inject` 的语义）。

**提示**：「误配置要在能自洽解析的最早时点大声失败」是本仓硬规则（根 [AGENTS.md](../AGENTS.md)）。

---

### 练习 2.4 · 从零写一个可装载插件 ★★☆

- **层次**：创造
- **前置**：练习 2.3

**描述**：不看 tutorial，独立走完"定义 → 配置 → 服务 → 事件 → 装载"。

**要求**

1. 在 `tmp/` 下新建插件包（含 `cordis.yml`），实现一个统计"某事件被派发次数"的服务。
2. 通过 `ctx.effect()` 注册监听器，保证卸载后计数与监听器一起消失。
3. 装载后触发若干次事件并打印计数。

**验收标准**

- 卸载插件后再派发事件，计数不再增长（监听器真的没了）。
- 能说出该插件的 `inject` 是必需还是可选，以及原因。

**交付物**：`tmp/` 下的插件目录 + 一段说明。

---

## Stage 3 · 核心循环

### 练习 3.1 · 追踪一次真实的 turn ★★☆

- **层次**：理解
- **前置**：能创建一个真实会话（真实 key 或 `pnpm run mock:llm`）

**描述**：把日志当作事实来源，验证你对 turn/step 的理解。

**要求**

1. 发一条会触发工具调用的提示（例如让 agent 写一个文件）。
2. 找到该会话的 JSONL 文件（`session.v3.jsonl` 或未压缩版），按顺序列出事件类型。
3. 标出 `turn/start`、`step/start`、`system/message`、`user/message`、`request/header`、`assistant/message`、`tool/call`、`tool/result`、`step/end`、`turn/end`。
4. 用 mock server 的 `partial_disconnect,success` 序列制造一次失败重试，确认出现 `assistant/attempt`，且**失败尝试不进模型历史**。

**验收标准**

- 每个 `tool/result` 之前都有对应的 `tool/call`；`tool/result` 数量与工具调用块数量一致。
- 能解释为什么失败尝试必须落盘却不进模型历史。

**提示**：`packages/core/session/src/surface.ts:92` 的 `deriveEventMessage` 决定哪些事件变成消息，可用它校对你的直觉。

---

### 练习 3.2 · 0 个 step 的 turn ★★★

- **层次**：理解
- **前置**：练习 3.1，读过 `packages/core/agent-loop/src/agent.ts`

**描述**：harness 允许一个 turn 不产生任何 step。亲手制造一次。

**要求**

1. 注册一个 `agent/pre-step` waterfall 监听器，在特定条件下 reject。
2. 触发它：日志应出现 `turn/start` 与 `turn/end`，但**没有** `step/start`。
3. 做变体：把首个 enter 的 messages 改写成空，确认同样不产生 step。
4. 解释为什么这是"关闭一个持久 turn"，而不是"什么都没发生"。

**验收标准**

- `turn/end` 的原因字段能解释这次关闭。
- 能说出 `startsRequestSeries` 在哪种 pre-step 决策下会被设置。

**提示**：包装型监听器必须用 `{ ...decision, messages }` 保留下游声明，否则会弄丢 series 语义。

---

### 练习 3.3 · 审计型策略插件 ★★☆

- **层次**：创造
- **前置**：练习 3.1

**描述**：不改任何工具实现，给所有工具调用加一层可观察审计。

**要求**

1. 监听 `tools/pre-execute`，把工具名与参数摘要追加到 `tmp/audit.log`。
2. 必须只观察（调用 `next()`），不改变任何调用结果。
3. 再监听 `tools/result`，记录最终成功或失败。
4. 卸载插件后日志不再增长。

**验收标准**

- 日志条数与实际工具调用次数一致（用一次多工具调用的提示验证）。
- 移除插件后行为完全不变——这就是"策略不进工具实现"的价值。

**提示**：`docs/tool-execution-pipeline.md` 是权威管线图；`packages/core/tools/README.md#extension-points` 给出每个扩展点的输入输出契约。

---

## Stage 4 · 能力缝

### 练习 4.1 · 三角色辨认 ★☆☆

- **层次**：理解
- **前置**：读过 `packages/shell` 三件套

**描述**：任选 3 条缝，写出它们的三角色。

**要求**

对 `fs`、`subagent`、`web` 三条缝分别写出：

1. Service Definition 包与 `ctx` 键。
2. 至少两个 Provider 包，并说明行为差异。
3. Consumer（通常是 `tool-*`）及它在 prompt 里的表现。

**验收标准**

- 能解释 `fs` 与 `subprocess` 为什么共享"执行世界"，以及指向远端沙箱会连带搬走什么。
- 能说出 `subagents` 的 provider 差异有多大（从新建子 agent 到委派给另一个产品的一轮）。

**提示**：`docs/capability-seams.md` 是生成的能力图，但**优先用源码核对**；生成文件由 `pnpm run gen-doc-graphs` 产出。

---

### 练习 4.2 · 写一个最小工具 ★★☆

- **层次**：创造
- **前置**：练习 4.1，读过 [docs/cookbook/adding-a-tool.md](../docs/cookbook/adding-a-tool.md)

**描述**：实现一个模型可调用的工具，从 schema 走通到 UI 卡片。

**要求**

1. 用 `defineTool` 实现一个工具（建议：返回工作区 git 分支名与 HEAD 短哈希）。
2. 声明 `output.schema`（给程序的 API）与 `output.render`（给模型的文本），二者信息一致但形式不同。
3. 实现 `presentCall` 与 `presentResult`，返回 `card` 标记的渲染意图。
4. 用 profile patch 挂载，在 Web UI 中确认卡片显示正常。
5. 传一个类型错误的参数，确认在进入 `execute` 之前就被拒绝。

**验收标准**

- 工具 schema 自动出现在 system prompt 中（无需手工注册分节）。
- 卸载插件后，工具在 prompt 与执行两处同时消失。
- `presentCall` 内没有 I/O、时钟或随机数（录制与回放都会执行它）。

**提示**：`packages/shell/tool-bash` 是生产级参考；纯函数约束的踩坑点在 [docs/cookbook/adding-a-tool.md](../docs/cookbook/adding-a-tool.md#how-your-tool-renders-in-a-ui) 的 "Hard rules"。

---

### 练习 4.3 · 加一个 Provider ★★★

- **层次**：创造
- **前置**：练习 4.2

**描述**：不改任何 Consumer，替换一条缝的实现。

**要求**

1. 选一条缝（建议 `web` 的 fetch，或 `llm`），为它实现一个新的 Provider 包。
2. 严格遵守 Definition 的语义条款（哪些情况 resolve、哪些情况 reject）。
3. 用 profile patch 替换进去；同时挂载两个同键 Provider 必须大声失败。
4. 证明**零处 Consumer 改动**：原有工具与循环表现不变，只是底层换了。

**验收标准**

- 切换前后，同一提示的模型可见结果结构一致。
- 重复注册时启动失败并指出重复的服务注册。

**提示**：这是"能力缝"设计的核心价值测试——如果你需要改 Consumer，说明缝的位置选错了。

---

## Stage 5 · 组合层

### 练习 5.1 · 精确覆盖一行 ★★☆

- **层次**：修改
- **前置**：练习 1.2

**描述**：用覆盖层改一行配置，并证明只有那一行变了。

**要求**

1. 写一个 `--patch` 覆盖层，改掉某一行（例如 agent-loop 的 `maxParallelToolCalls`）。
2. 跑 `--dump-config`，与未加 patch 的版本 diff。
3. 确认 diff 只有目标行，且出处注释标出你的层。
4. 再写一个覆盖层，插入一个全新的 row。

**验收标准**

- diff 中除目标行外无其他变化（尤其要确认被命中行的**整个 config 被替换**，而不是字段级合并）。
- 能解释这条语义的后果。

**提示**：`vendor/include/src/index.ts:58` 的 `applyEntryPatches` 是语义权威。

---

### 练习 5.2 · 自定义 profile ★★☆

- **层次**：修改
- **前置**：练习 5.1

**描述**：创建并运行一个自己的 profile。

**要求**

1. 用 `dsh --profile myprof --from-default-profile headless` 从模板创建。
2. 检查 `$DSH_HOME/profiles/myprof/package.json` 里的 `dsh.profile`（`bundles` 与 `patchReload`）。
3. 在该 profile 的 `cordis.patch.yml` 加一层覆盖并重启验证。
4. 把 `patchReload` 改成 `live`，验证改 patch 文件后**无需重启**即生效。

**验收标准**

- 能说出 `live` 与 `startup` 各自的适用场景，以及为什么 shipped 的 `headless`/`sdk`/`acp` 选 `startup`。
- 写一个非法 patch（引用不存在的 bundle 或非法 config），确认启动大声失败而非静默跳过。

---

### 练习 5.3 · 打包一个 bundle ★★★

- **层次**：创造
- **前置**：练习 5.2

**描述**：把自己写的插件打成可安装的 bundle，并用它组合出一个应用。

**要求**

1. 新建包，在 `package.json` 声明 `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`。
2. patch 文件插入你的工具/策略 row。
3. 用 `dsh plugin --profile <name> <pnpm args>` 装进一个 profile，确认它出现在 `dsh.profile.bundles` 的正确位置。
4. 验证分层：上层 patch 可以覆盖你的 bundle 插入的行。

**验收标准**

- `--dump-config` 里能看到你的 bundle 贡献的行，出处标注正确。
- 你的 bundle 可被上层 patch 覆盖——这正是"bundle 是分发格式，不是不可变层"的含义。

---

## Stage 6 · 持久化与载体

### 练习 6.1 · 会话格式演进的书面推演 ★★☆

- **层次**：理解
- **前置**：读过 [docs/cookbook/adding-a-session-format-version.md](../docs/cookbook/adding-a-session-format-version.md)

**描述**：**不要真的改格式**，只做推演。

**要求**

假设要新增一个模型可见的输入（例如一条"系统注入的运行时提示"），写出改动清单：

1. `SessionEventMap` 的扩展位置。
2. 渲染到模型历史的投影位置。
3. 该用新事件还是复用既有事件。
4. 是否属于结构性变更（是否要 bump `SESSION_FORMAT_VERSION` 并新增 `v3 -> v4` 迁移包）。
5. 需要同步的 SDK 预期输出与快照。

**验收标准**

- 清单能区分"加一个 `ignorable: true` 事件"与"改事件信封结构"两种情形。
- 能说出写者常量（当前 `3`，见 `packages/core/session/src/types.ts:88`）与 [docs/session-format-status.md](../docs/session-format-status.md) 记录的关系。

**提示**：为什么已提交的 generation 永不重命名、覆盖、删除——答案在 `stat`/`list`/`open` 三条消费路径的加载语义里。

---

### 练习 6.2 · 注册一个投影 unit ★★★

- **层次**：创造
- **前置**：练习 3.1

**描述**：为"每会话工具调用次数"做一个可增量折叠的状态读取。

**要求**

1. 在 `ctx.sessionProjections` 注册 unit，增量折叠 committed 事件。
2. 写一个宿主消费者用 `stateOf()` 读出计数。
3. 验证重放同一份日志得到相同结果（投影必须是纯折叠）。
4. 故意不注册该 unit，确认读取方**显式失败**而不是拿到默认值。

**验收标准**

- 计数在会话进行中实时正确，不需要重扫全量日志。
- 缺少注册时，错误信息指出缺失的服务或键。

**提示**：宿主读取方要么在激活期要求该服务，要么显式失败——"静默兜底一个缺失的宿主值"在本仓被明确禁止。

---

### 练习 6.3 · 一条 Remote 通路 ★★★

- **层次**：创造
- **前置**：读过 [docs/api-gateway.md](../docs/api-gateway.md)

**描述**：加一个 Host 方法并让 Client 调到它。

**要求**

1. 在一个 Host 业务服务上声明 `@Remote` 方法。
2. 跑 Host 构建，找到生成的 Host-for-Client 类型与运行时贡献。
3. 在 Client 侧通过 `ctx.remote` 调用它，把结果显示到 UI。
4. 说明为什么不能把 Host 的工具实现 import 进浏览器 bundle。

**验收标准**

- 生成物位置与调用路径都能指出来。
- 能解释 Host 与 Client 为什么必须是两个 `ts.Program`（同键 declaration merging 的冲突只在单个 `ts.Program` 内出现）。

---

## Stage 7 · 工程约束（`deep`）

### 练习 7.1 · 加一个单调 guard ★★★

- **层次**：创造
- **前置**：练习 3.3

**描述**：实现一条"后续监听器无法撤销"的拒绝策略。

**要求**

1. 用 `ctx.tools.guard()` 注册一个拒绝策略（例如：拒绝写入工作区之外的路径）。
2. 证明单调性：再注册一个"放行一切"的 `tools/pre-execute` 监听器，无法让被 guard 拒绝的调用通过。
3. 对比实验：把同样的逻辑写在 `tools/pre-execute` 里，证明它**可以**被后续监听器影响。

**验收标准**

- 两个实验的差异可观察、可复现。
- 你能说出"身份受保护"指的是什么（guard 不能拒绝一个它不该管的调用）。

---

### 练习 7.2 · 走完一次真实改动 ★★★

- **层次**：创造
- **前置**：练习 7.1

**描述**：按仓库规则完成一次端到端的小改动。

**要求**

1. 挑一个小需求（给某工具加 guard 策略、给某包加一个扩展点、修一个明确的缺陷）。
2. 改代码时同步改文档：包 README 的契约、必要时 subsystem 页的 `type-equiv` 块。
3. 加测试：按 [docs/testing.md](../docs/testing.md) 的分层选择正确的层级；模型或用户可见的改动必须更新 keyless 录制会话快照。
4. 本地跑相关门：
   ```sh
   pnpm run typecheck
   pnpm run test
   pnpm run test:snapshot -t <你的场景名>
   pnpm run doc-sync
   ```
5. 写一篇 Agent Note 记录这次决策（非机械改动是必须的）。

**验收标准**

- 四个命令全绿，且你没有为了让它们变绿而放宽断言。
- 你能说出这次改动**为什么**必须放在你选择的扩展点上，而不是改 `agent-loop`。

**提示**：`pnpm run test:coverage` 是 CI 的覆盖率门（按文件 100%），但它不是你在本地每次都要跑的命令——按 [docs/AGENTS.md](../AGENTS.md) 的"跑与改动面相关的检查"。

---

## 提交与自评规则

做完一个练习后，用下面三个问题自评，**任何一个答不上就回到对应阶段**：

1. **我改的东西属于哪一层？**（脊柱 / 缝 / 组合 / 载体）——答不上说明还没建立分层模型。
2. **我的改动靠哪条机制生效？**（effect 回滚 / waterfall 委托 / patch 分层 / 投影折叠）——答不上说明是抄的。
3. **如果我把这个扩展点删掉，哪些行为会一起消失？**——答不上说明没有真正理解所有权。

## 建议的收尾项目（综合三阶段）

挑一个你能真正用上的小功能，走完 Stage 4 → 7：

| 方向 | 涉及层 | 为什么值得做 |
|---|---|---|
| 给某类命令加统一的超时与审计策略 | 缝（guard + pre-execute） | 一次写清"策略不进实现" |
| 为团队写一个自定义工具（部署检查、规范校验） | 缝（工具 + schema + 卡片） | 覆盖 schema/渲染/纯函数三条硬约束 |
| 把现有 profile 裁成"只读代码审查"组合 | 组合（bundle + patch） | 理解分层与不可变层的边界 |
| 加一个投影 unit + 一个 UI 面板 | 持久化 + 载体 | 走通事件 → 投影 → snapshot → 渲染 |
