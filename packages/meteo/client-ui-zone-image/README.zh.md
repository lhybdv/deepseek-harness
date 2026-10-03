# 区划图像对比面板
[English](README.md) | 中文

`@deepseek-ai/dsh-client-ui-zone-image` 提供 `ZoneImagePanel`，会将选择的两张图像作为一条用户提示发送到当前会话。智能体调用 `meteo_zone_image_compare`；面板读取持久化的工具结果，并展示两张图像的结构化解读、定量特征、语义描述、基于统计的研判以及 SVG 对比图。

宿主必须在智能体运行时启用会话控制器和 `@deepseek-ai/dsh-tool-zone-image`。面板使用现有提示图像准入路径，不创建独立上传传输机制。
