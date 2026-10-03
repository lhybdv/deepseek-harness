# Agent Note: 云端语音识别作为默认关闭的 Provider

Status: implemented

[English](2026-10-01-cloud-speech-recognition-provider.md) | 中文

## Problem

[语音输入栈](2026-09-16-experimental-voice-input.zh.md)此前只提供一个识别器：Host 下载并在 CPU 上运行的本地 SenseVoice 模型。既不愿下载约 240 MB 权重、又已经拥有可用语音服务账号的部署，完全没有语音输入的落地路径。语音服务本身接受任意多个 Provider，但代码树中没有任何 Provider 注册到云端，而实验性能力只能通过 `OPTIONAL_BUNDLES` 中默认关闭的 bundle 进入安装。

## Decision

`packages/experimental/speech-to-text-rtasr/` 为 `ctx.speechToText` 注册第二个识别器，使用讯飞实时转写服务（RTASR）。每次录音独占一条签名的 WebSocket 会话：Provider 把会话参数按名称排序并做百分号编码，用 Access Key Secret 以 HMAC-SHA1 签名，附加北京时间 `utc`，再把录音的 PCM 按 1280 字节一帧、每 40 毫秒一帧的节奏投递，使音频按真实时间到达；结束标记中重复服务返回的 session id；最后把句子流拼装成一个 `Transcript`。最终句追加到已有文字，中间句替换仍在识别的那一句，因此服务在未给出最终句时停止，最后一句仍会计入结果。帧大小、投递节奏与端点族是协议常量；端点、字节上限与截止时间属于配置。

凭据无需写入配置文件：`appId` 与 `accessKeyId` 取自配置节或 `IFLYTEK_RTASR_APP_ID` / `IFLYTEK_RTASR_ACCESS_KEY_ID`，Access Key Secret 则是一个*引用*，在每次录音开始时通过 `ctx.credentials` 解析，并回退到启动环境。因此 Host 启动后再写入的密钥对下一次录音立即生效；缺少取值时只有该次录音失败并指明缺失字段，绝不回退到其他识别器。

该 Provider 随 `voice-input-bundle` 发布且**默认关闭**：其 manifest 声明该包为依赖，其 patch 以 `disabled: true` 插入该行，本地 SenseVoice 仍是被选中的识别器，因此启用语音输入不会带来任何变化，直到有人启用该行并选中它。`apps/cli/config/examples/meteo/cordis.yml` 正是为该演示这样做的，且只按 id 操作：`- id: speech-to-text-rtasr` 配 `disabled: false`，外加 `- id: speech-to-text` 设置 `defaultProvider`。两条补丁都不指定包名，因此组合门禁依然满足；在 bundle 关闭时，Loader 对每个缺失 id 各警告一次后继续启动。

## Alternatives considered

**像参考实现那样在浏览器中识别。** 页面需要自己签名请求，这意味着把 Access Key Secret 发给每个浏览器，并要求每个页面直接访问该服务。改为由 Host 签名并投递：密钥留在 Host，浏览器只负责麦克风采集与草稿插入，且同一个 Provider 同时服务 Web 与桌面客户端。

**在 bundle 中默认启用云端行。** 每个启用语音输入的安装都会公布一个在有人提供账号前始终失败的识别器，而组合出的插件清单——包括语音 Web 测试已记录的期望——会为从未需要云端识别的安装而改变。默认关闭的行让组合集合在部署选择加入之前保持不变。

**单独的云端识别 bundle。** 第二个可选 bundle 需要自己的图标与本地化元数据，并会重复语音 bundle 已包含的语音服务、Remote 与浏览器麦克风行；两者同时启用还可能互相冲突。云端识别器是既有接缝的一个 Provider，而不是第二项能力。

**把该 Provider 声明为 `apps/cli` 的依赖，并从示例 overlay 插入这些行。** 默认产品隔离门禁拒绝把实验性包放入安装的运行时依赖，而应用 overlay 解析的是 bundle 自身的依赖。把依赖挂在 bundle 上既保持安装的依赖面不变，也陈述了真实关系：识别器属于语音 bundle。

**把中间句流式回传浏览器。** 云端 Provider 发布时否决了这一点：当时接缝每次录音只返回一个 `Transcript`，Remote 也没有承载增量结果的通道，为纯展示收益而改动服务定义、Remote 与输入框状态机并不划算。[实时识别决策](2026-10-02-live-speech-recognition.zh.md)后来推翻了该结论——接缝、Remote 与客户端都增加了实时路径，服务本就在产生的中间文本如今正是用户说话时录音行显示的内容。

## Consequences

识别因此依赖 Host 必须可达的云端服务，录音也会离开 Host：部署必须获得账号授权，而服务方言模式的效果取决于该授权范围。该 Provider 还引入一次真实时间的往返：十秒的问题至少需要十秒投递，而本地推理更快给出结果。只有收束后的最终文本会进入输入框；服务在用户说话期间产生的报告留在录音行中，见[实时识别决策](2026-10-02-live-speech-recognition.zh.md)。

作为交换，既不愿承担本地模型权重、又已拥有讯飞账号的部署，得到同样的接缝、同样的麦克风界面、同样的草稿插入语义，且无需下载模型：该 Provider 不做准备即报告就绪，因此语音 UI 不会显示准备与下载界面。本地识别器保持默认地位，bundle 的既有使用者观察不到任何变化。

## Testing

`packages/experimental/speech-to-text-rtasr/tests/` 覆盖签名（固定 HMAC 向量、排序与百分号编码参数、北京时间戳）、报文解码（文档中的结果帧与错误帧、畸形帧、超长帧）与会话行为（投递节奏、结束标记中的 session id、仅有中间句的转写、排空截止时间、服务错误、传输失败、各类取消路径），全部针对脚本化的连接，且逐文件覆盖率 100%。默认的 WebSocket 适配器已对本地服务经真实套接字验证。该 Provider 还以合成中文语音对线上讯飞服务跑过：十一条服务帧逐字拼出了朗读的句子，其中 `st.type` 以字符串 `"1"` 表示中间句、`"0"` 表示最终句，这正是拼装所依据的规则。
