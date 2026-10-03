/** Locale-owned copy for the zoning image comparison panel. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Locale dictionary namespace. */
export const NS = 'meteo-zone-image'
/** Chinese strings. */
export const zh = { title: '区划图像对比', first: '第一张区划图', second: '第二张区划图', compare: '开始对比', analyzing: '正在分析', classification: '分类', features: '核心特征', semantics: '语义说明', areaShares: '面积占比', legend: '图例颜色', judgment: '差异研判', svg: '可视化成果', error: '对比失败，请检查图像后重试', upload: '选择图像', changed: '变化面积占比', prompt: '请使用 meteo_zone_image_compare 比较本条消息附带的两张同类型区划图。根据图像提取行优先类别栅格、源像元大小，并填写每张图的分类、面积占比、主要类别、图例颜色和语义说明；不要臆造无法确认的类别或颜色。调用工具后依据统计结果说明变化。' } as const
/** Keys accepted by the panel translator. */
export type ZoneImagePanelKey = keyof typeof zh
/** English strings with identical keys. */
export const en: Record<ZoneImagePanelKey, string> = { title: 'Zoning image comparison', first: 'First zoning image', second: 'Second zoning image', compare: 'Compare images', analyzing: 'Analyzing', classification: 'Classification', features: 'Core features', semantics: 'Semantic description', areaShares: 'Area shares', legend: 'Legend colors', judgment: 'Difference assessment', svg: 'Visualization', error: 'Comparison failed; check the images and retry', upload: 'Choose image', changed: 'Changed area share', prompt: 'Use meteo_zone_image_compare to compare the two same-type zoning maps attached to this message. Extract a row-major category raster and source pixel size from each image, and provide its classification, area shares, dominant categories, legend colors, and semantic description. Do not invent categories or colors that cannot be confirmed. Explain the changes using the tool statistics.' }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'meteo-zone-image': ZoneImagePanelKey } }
