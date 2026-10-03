---
description: "面向浏览器客户端的认证实验性语音合成接口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

[English](README.md) | 中文

## 摘要

`speechSynthesis` Remote 命名空间将文本发送到 Host 提供方，并返回 base64 音频，不会激活 Agent 或写入 Session 事件。

## 使用

在 Client 挂载生成的 Remote，并在 Host 配置 `maxTextLength`。空文本或超长文本会在调用提供方前拒绝；提供方错误以类型化 Remote 错误返回。
