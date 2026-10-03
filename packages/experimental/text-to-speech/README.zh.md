---
description: "具名实验性语音合成服务及 Host 侧取消管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

[English](README.md) | 中文

## 摘要

此服务通过 `ctx.speechSynthesis` 选择语音合成提供方。注册由 Host 管理，注销时会取消并等待已接收的任务。

## 使用

配置 `defaultProvider` 并加载对应提供方插件。在 Host 侧使用 `synthesize({ text }, signal)`；浏览器不会接触凭据或提供方私有字段。
