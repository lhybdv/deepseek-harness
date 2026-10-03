# 气象文档产品面板

[English](README.md) | 中文

加载宿主半侧，使浏览器模块加载器发现声明的客户端面：

```yaml
- id: ui-meteo-document-products
  name: '@deepseek-ai/dsh-client-ui-document-products'
```

客户端导出 `@deepseek-ai/dsh-client-ui-document-products/client` 将面板注册到 `sidebar.panellist`，并在键控的 `main` 槽位注册界面。它挂载生成的 `@deepseek-ai/dsh-api-document-products` Remote 客户端面，按选中会话列出产品、生成草稿、执行合法的生命周期操作，并在每次操作后刷新。处理中和错误状态均会显示；所有界面文案由 `meteo-document-products` locale 命名空间管理。
