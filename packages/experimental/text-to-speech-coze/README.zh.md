---
description: "使用 Host 命名凭据的 Coze 云端语音合成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech-coze

[English](README.md) | 中文

## 摘要

将 Coze `/v1/audio/speech` 注册为实验性语音合成服务的云端提供方。

## 使用

配置 `credentialRef`、`baseUrl`、`voiceId` 和 `emotion`。在 Host 凭据服务中保存 bearer token；每次合成时按名称解析，绝不放入浏览器或配置文件。Coze 返回非空 `audio/mpeg` 字节；HTTP 错误及凭据缺失会拒绝请求。
