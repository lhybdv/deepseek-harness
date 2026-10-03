# Zoning image comparison panel
English | [中文](README.zh.md)

`@deepseek-ai/dsh-client-ui-zone-image` provides `ZoneImagePanel`, which sends two selected image files as a single user prompt to the current session. The agent invokes `meteo_zone_image_compare`; the panel reads the durable tool result and renders both structured image interpretations, quantitative features, semantic descriptions, the statistics-based assessment, and the returned SVG comparison.

The host must enable both the session controller and `@deepseek-ai/dsh-tool-zone-image` in the agent runtime. The panel uses the existing prompt-image admission path and does not create a separate upload transport.
