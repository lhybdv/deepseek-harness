---
description: "以每次录音一条签名 WebSocket 会话调用讯飞 RTASR 云端识别。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-speech-to-text-rtasr

[English](README.md) | 中文

## 概述

此云端 Provider 使用讯飞实时转写服务（RTASR）识别语音。Host 为每次录音签名一条 WebSocket 会话，按真实时间投递录音的 PCM 帧，并返回服务报告的文字。它不下载模型、不在磁盘上准备任何资源；识别器由服务提供。

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

它与[语音服务](../speech-to-text/README.zh.md)组合使用：在组合中加入一次 Provider 注册，并配置部署自己的凭据。它以 `providerId` 注册（默认 `iflytek-rtasr`），接受 `auto`、`zh`、`en` 三种语言提示，并分别映射到服务的 `autodialect`、`cn`、`en` 参数。

`appId` 与 `accessKeyId` 优先取配置节中的值，未设置时分别读取 `IFLYTEK_RTASR_APP_ID` 和 `IFLYTEK_RTASR_ACCESS_KEY_ID`。`accessKeySecretRef` 指定存放 Access Key Secret 的凭据引用，默认为 `IFLYTEK_RTASR_ACCESS_KEY_SECRET`；该值在每次录音开始时通过 `ctx.credentials` 解析，并回退到启动环境，因此 Host 启动后再写入的密钥对下一次录音立即生效，无需重启。缺少标识或密钥时该次录音直接失败，并指明缺失字段，绝不静默改用其他识别器。

`baseWsUrl` 默认为文档中的端点，也接受 `ws` 源，便于对本地服务做测试。`maxAudioBytes` 与 `maxResponseBytes` 分别限制单次录音和单条已解码的服务消息。`connectTimeoutMs` 限制建立会话的时间，`drainTimeoutMs` 限制发出最后一帧后等待最终结果的时间。

该 Provider 无需准备，因此语音 UI 将其视为立即可用，不会显示只有本机识别器才需要的准备与下载界面。

它公布 `streaming`，因此调用方可以在仍在采集音频时逐批投递，而不必等待完整录音。报告随即以服务自身的延迟到达，两侧都不必把整段录音保存在一个缓冲区里。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

签名遵循服务约定：会话参数按名称排序并做百分号编码，用 Access Key Secret 做 HMAC-SHA1 签名，签名的参数集中包含带 `+0800` 偏移的北京时间 `utc`。帧大小（1280 字节：16 kHz、16 位、单声道、40 毫秒）与投递节奏（每 40 毫秒一帧，使音频按真实时间到达服务）属于服务协议常量，不是部署选项。超过各自截止时间的等待由调用方取消收束，取消会关闭连接。

转写文本由服务的句子流拼装：最终句追加到已有文字，中间句替换仍在识别的那一句，因此服务在未给出最终句时停止，最后一句仍会计入结果。发出结束标记后，Provider 等待服务关闭连接；排空截止时间结束该等待但不丢弃已拼装的文本，调用方取消则原样向外传播。服务错误帧、传输失败，或在录音投递完成前关闭连接，都会让该次录音失败，而不是把截断的文本当作完整结果返回；连接始终在本次调用结束前关闭。

服务的帧流已直接观测：`action: "started"` 帧在 `data.sessionId` 中携带会话 id；结果帧以 JSON 字符串标注句子类型（`"0"` 为最终句、`"1"` 为中间句）；最终句按分句逐条到达并自带标点，因此文本按原样追加。`st.ed` 是毫秒偏移量而非结束标志，把它当作结束标志会使转写文本在每一帧被重置。

流式录音复用同一个会话：调用方的音频帧到达即投递，不需要完整录音路径上的 40 毫秒节奏，因为调用方本就按真实时间产生音频。拼装文本一有变化就上报一次，发出结束标记并收到结果、或排空截止时间到期后，本次录音以最终文本收束。

服务收到的是去掉规范 WAV 头的原始 PCM，输入校验在剥离头部的同时校验头部、字节上限与语言提示。音频必须由 `ArrayBuffer` 承载，这是连接的二进制发送所要求的。

本包不发布运行时不变式伴随模块，因为它不持有可独立观测的状态：它唯一持久的事实是语音服务已经跟踪的注册项。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为录音不进入模型请求；之后的文字由普通用户提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 识别是一次云端调用：录音会离开 Host 发往服务，因此服务必须可从 Host 访问，且部署账号须已开通相应能力。
- 只有收束后的最终文本会进入输入框；用户在说话过程中，录音行会显示服务产生的报告。中间句参与拼装，并随服务修正而相互替换。
- `auto` 选择服务的方言模式，其准确度取决于账号已购买的能力，Provider 无法探测账号具体开通了哪些能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
