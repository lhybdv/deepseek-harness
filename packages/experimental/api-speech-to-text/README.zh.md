---
description: "通过带认证的 Web Remote 提供有界临时转写。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-speech-to-text

[English](README.md) | 中文

## 概述

`speech` Remote 将浏览器录音连接至 `ctx.speechToText`，提供 Provider 发现、完整录音转写调用，以及面向「说话时即报文字」的 Provider 的一条实时流。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

与语音服务定义和 Typert 组合。`maxAudioBytes` 与 `maxDurationSeconds` 限制接收的录音。浏览器 UI 启用时挂载本包生成的 `/remote` 贡献。

`prepare(providerId, { downloadSource })` 将公布的一个下载源转发给提供方，省略时保留其配置策略。目录通过 `downloadSources` 提供选择器选项。提供方拒绝不可用的源，以及对进行中任务的源变更。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`catalog()` 暴露 Provider 标识、默认选择与录音限制。`transcribe()` 在解析指定 Provider 前校验规范 base64 与 16 kHz 单声道 PCM16 WAV。现有网关负责认证和取消传输。音频是临时数据，不成为 Session 事件或附件；只有用户之后的普通提交才记录识别文字。不发布运行时不变量伴随模块，因为校验无状态，准备属于 Provider。

`transcribeStream()` 把实时录音承载在同一条逻辑流上：Client 以其上行发送 base64 PCM16 音频批次，Host 沿同一条流向下产出识别器的报告。每个解码后的批次必须是规范 base64，且为整数个 PCM16 采样；累计音频受与完整录音相同的 `maxAudioBytes` 与 `maxDurationSeconds` 限制约束。被拒绝的批次以 `speech/invalid-audio` 结束该流，而不会到达识别器。识别失败以 `speech/transcription-failed` 返回，Client 取消则原样传播。

`follow()` 推送包含准备状态和当前偏好的完整目录。`prepare()` 启动或加入 Host 任务；`cancelPreparation()` 显式取消任务。`configure()` 持久化传入的偏好字段。观察连接断开不会取消准备。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为录音与准备不进入模型请求；之后的文字由普通用户提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不提供文件上传或持久化转写历史。Base64 会给两次调用都带来传输开销；录音受公布的限制约束。实时识别取决于所选 Provider 是否公布 `streaming`。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
