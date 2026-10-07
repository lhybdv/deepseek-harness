# 气象文档产品
[English](README.md) | 中文

本包使用统一的 `DocumentProduct` 类型表示灾害预警产品和农业气象服务简报。`generateProduct` 通过共享的 `MeteoData` 与 `CorpusStore` 接口读取观测、预报、灾害阈值、作物历窗口及带坐标的语料引用。可注入文案润色器，但会校验正文数值均来自已填充的数据来源，并保留引用和章节标题。

```yaml
- id: meteo-document-products
  name: '@deepseek-ai/dsh-document-products'
  config:
    forecastHours: 72
    citationLimit: 5
    timeoutMs: 30000
    snippetChars: 200
    documentChars: 8000
    artifactDir: outputs/meteo-document-products
```

`transitionProduct` 实现带操作人记录的草稿编辑、审核、通过、退回、发布和归档流程。`meteo_document` 的 `edit` 操作在产品处于草稿状态时接受产品 id、新正文 `body` 和操作人；它只替换正文。章节标题和引用列表由服务生成并保持不变。编辑后验证要求：（a）正文非空；（b）正文中的每个数字都由已填充数据支持；同一验证器也会检查引用坐标。编辑失败不会修改已保存产品；成功正文会连同操作人和时间写入会话事件。发布会从当前编辑后的正文生成版本递增且冻结的发布件。

Cordis service 注册后可通过 `ctx.documentProducts` 使用。进程内对象是会话产品/发布件投影，完整产品和每次状态变更都会写入会话事件日志作为重放存储。灾害等级解析完成后调用 `hazardResolved(session, grading)` 生成预警；`generate(session, explicitInput)` 支持人工生成。同一会话对相同站点、灾种、等级和时段重复调用时幂等返回同一产品（包括并发调用）。生成失败会清除去重记录，不写入半成品或创建事件，并向调用方抛错；随后仍可通过人工生成重试。

文案生成器由调用方注入：可连接真实模型，也可省略并使用确定性模板。模型返回的数值必须再次通过数据验证。

本包同时注册面向模型的 `meteo_document` 工具，使「编–审–发–存」全流程可在对话中看见：每次结果都包含标题、按顺序排列的章节、正文及带坐标的引用，受 `documentChars` 限制并在截断时明确提示。`list` 按标题和状态标识产品；`edit` 仅在草稿状态替换正文，展示操作人/时间及编辑后的版本状态，并保留服务生成的章节标题和引用。发布会在 `artifactDir` 写入不可变、带版本号的 Markdown 文件并报告绝对路径；再次发布会生成新版本且保留旧文件。所有操作均限定在调用方所在会话内。

`timeoutMs`、`snippetChars`、`documentChars` 分别约束调用预算、引用摘录和产品文本长度，`artifactDir` 配置 Markdown 发布件目录；插件 `inject` 除数据接缝外还声明 `tools`，因为注册工具需要工具注册表。
