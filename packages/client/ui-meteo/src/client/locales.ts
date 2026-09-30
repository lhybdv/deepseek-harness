/**
 * `meteo` namespace dictionaries, and the namespace's declaration.
 *
 * The corpus page's sections head the wire data the `meteo` namespace
 * answers with: a document list, one ingest outcome per refused file, a
 * ranked search, and one chunk read per citation tab. The failure lines keep
 * the wire's stable codes readable, and the per-file reasons here cover the
 * two refusals the page itself makes (a file that is not text, and one over
 * the length cap) alongside the index's own codes.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'meteo'>` or `PropsLocale<'meteo'>` needs only this file,
 * whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Corpus panel copy: the document list, upload form, search, citations, and focus. */
    meteo: MeteoKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'meteo'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'page.panel': '语料库',
  'page.title': '风引 WindPilot',
  'page.description': '可被引用检索的气象资料：在这里上传、查找和核对。',
  'page.listTitle': '已索引文档',
  'page.loading': '正在读取…',
  'page.empty': '语料库是空的。在下方上传文件即可开始索引。',
  'page.listError': '读取文档列表失败：{message}',
  'page.remove': '删除',
  'page.ingested': '索引于 {time}',
  'page.chunks': '{count} 段',
  'page.sourceLine': '来源 {source}',
  'page.size': '{size} 字节',
  'page.inspect': '查看分段',
  'page.collapse': '收起',
  'page.inspecting': '正在读取分段…',
  'page.inspectError': '读取分段失败：{message}',
  'page.chunkLine': '第 {ordinal} 段 · 字符 {start}–{end}',
  'page.reload': '重新读取',
  'ingest.title': '上传新资料',
  'ingest.pick': '选择文件',
  'ingest.hint': '支持 .md、.txt、.json、.csv 等文本文件，可多选',
  'ingest.staged': '待索引 {count} 个文件',
  'ingest.drop': '移除',
  'ingest.source': '来源',
  'ingest.source.placeholder': '来源（可选，应用于本批）',
  'ingest.submit': '索引',
  'ingest.busy': '正在索引…',
  'ingest.rejected': '{title}：{reason}',
  'ingest.reject.binary': '不是文本文件',
  'ingest.reject.empty': '内容为空',
  'ingest.reject.tooLarge': '超出单份文档长度上限',
  'ingest.error': '索引失败：{message}',
  'search.title': '检索语料',
  'search.placeholder': '按标题、来源或正文检索…',
  'search.submit': '检索',
  'search.busy': '正在检索…',
  'search.none': '没有命中“{query}”的结果。',
  'search.hit.chunk': '段落 {ordinal}',
  'search.hit.range': '字符 {start}–{end}',
  'search.open': '查看证据',
  'search.error': '检索失败：{message}',
  'citation.label': '引用证据',
  'citation.guide': '查看模型引用的气象资料段落',
  'citation.trail': '位置',
  'citation.chunk': '段落 {ordinal}',
  'citation.range': '字符 {start}–{end}',
  'citation.loading': '正在读取…',
  'citation.noAddress': '这个页面没有携带引用地址。',
  'citation.notFound': '这个段落不存在或已被删除。请关闭页面后重新选择。',
  'citation.error': '读取引用失败：{message}',
  'focus.title': '当前咨询对象',
  'focus.empty': '本会话还没有设置咨询对象。',
  'focus.station': '站点 {station}',
  'focus.crop': '作物 {crop}',
  'focus.error': '读取咨询对象失败：{message}',
} satisfies Record<string, string>

/** Meteo dictionary key union. */
export type MeteoKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'page.panel': 'Corpus',
  'page.title': 'WindPilot',
  'page.description': 'Weather and disaster material the model can cite, uploaded and searched here.',
  'page.listTitle': 'Indexed documents',
  'page.loading': 'Reading…',
  'page.empty': 'The corpus is empty. Upload files below to start indexing.',
  'page.listError': 'Reading the document list failed: {message}',
  'page.remove': 'Remove',
  'page.ingested': 'Indexed {time}',
  'page.chunks': '{count} chunks',
  'page.sourceLine': 'Source {source}',
  'page.size': '{size} bytes',
  'page.inspect': 'Inspect chunks',
  'page.collapse': 'Collapse',
  'page.inspecting': 'Reading chunks…',
  'page.inspectError': 'Reading chunks failed: {message}',
  'page.chunkLine': 'chunk {ordinal} · chars {start}–{end}',
  'page.reload': 'Reload',
  'ingest.title': 'Upload material',
  'ingest.pick': 'Choose files',
  'ingest.hint': 'Text files such as .md, .txt, .json, .csv; select several at once',
  'ingest.staged': '{count} file(s) staged',
  'ingest.drop': 'Remove',
  'ingest.source': 'Source',
  'ingest.source.placeholder': 'Source (optional, applied to this batch)',
  'ingest.submit': 'Index',
  'ingest.busy': 'Indexing…',
  'ingest.rejected': '{title}: {reason}',
  'ingest.reject.binary': 'not a text file',
  'ingest.reject.empty': 'empty text',
  'ingest.reject.tooLarge': 'over the per-document size limit',
  'ingest.error': 'Ingest failed: {message}',
  'search.title': 'Search the corpus',
  'search.placeholder': 'Search by title, source, or text…',
  'search.submit': 'Search',
  'search.busy': 'Searching…',
  'search.none': 'No hits for “{query}”.',
  'search.hit.chunk': 'chunk {ordinal}',
  'search.hit.range': 'chars {start}–{end}',
  'search.open': 'Open citation',
  'search.error': 'Search failed: {message}',
  'citation.label': 'Citation evidence',
  'citation.guide': 'Read the weather material paragraph the model cited',
  'citation.trail': 'Where',
  'citation.chunk': 'chunk {ordinal}',
  'citation.range': 'chars {start}–{end}',
  'citation.loading': 'Reading…',
  'citation.noAddress': 'This tab carries no citation address.',
  'citation.notFound': 'This paragraph is gone or was never written. Close the tab and pick another citation.',
  'citation.error': 'Reading the citation failed: {message}',
  'focus.title': 'Current consultation subject',
  'focus.empty': 'This session has no consultation subject yet.',
  'focus.station': 'Station {station}',
  'focus.crop': 'Crop {crop}',
  'focus.error': 'Reading the consultation subject failed: {message}',
} satisfies Record<MeteoKey, string>
