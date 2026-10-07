---
description: "远程访问气象文档产品。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-document-products

[English](README.md) | 中文

## 摘要

`documentProducts` Remote 命名空间提供会话范围内的生成、列表、生命周期操作和不可变发布版本。

## 使用

与 `@deepseek-ai/dsh-document-products` 一同挂载 Host 贡献。客户端可生成草稿、提交审核、批准或驳回、发布版本化产品并归档已发布产品。转换保留调用方提供的责任人和时间戳。命名空间返回的每个产品都携带当前状态允许的操作，由拥有状态机的转换表给出，客户端据此渲染控件，无需自行推算合法性。
