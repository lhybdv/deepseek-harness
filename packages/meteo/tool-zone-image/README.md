# Zoning-image comparison
English | [中文](README.zh.md)

`@deepseek-ai/dsh-tool-zone-image` registers `meteo_zone_image_compare` and exports its analysis engine. The tool requires two same-type zoning images to already be present in the model conversation. Its structured JSON argument carries the model's image-by-image classification, area shares, dominant categories, color legend, semantic descriptions, and categorical raster labels; the host validates the model-output JSON boundary before calculating differences.

Raster categories are sampled with nearest-neighbour resampling onto a common grid at the coarser source pixel size; changed cells use eight-neighbour connectivity. The tool returns statistics and a self-contained SVG comparison in its model-facing result. The browser panel is a separate package.
