/** Locale-owned copy for the meteorological document product panel. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Locale dictionary namespace. */
export const NS = 'meteo-document-products'
/** Chinese strings. */
export const zh = { title: '气象文档产品', empty: '暂无文档产品', citations: '引用依据', history: '状态历史', actor: '操作人', actions: '可执行操作', sections: '正文', edit: '编辑正文', editBody: '编辑后的正文', save: '保存修改', cancel: '取消', submit: '提交审核', approve: '审核通过', reject: '退回修改', revise: '重新编辑', publish: '发布', archive: '归档', draft: '草稿', in_review: '审核中', approved: '已通过', rejected: '已退回', published: '已发布', archived: '已归档', pending: '处理中…', generate: '生成文档', session: '会话', noSession: '请先选择或创建会话', version: '版本' } as const
/** Keys accepted by the panel translator. */
export type ProductPanelKey = keyof typeof zh
/** English strings with identical keys. */
export const en: Record<ProductPanelKey, string> = { title: 'Meteorological documents', empty: 'No document products', citations: 'Citations', history: 'State history', actor: 'Actor', actions: 'Available actions', sections: 'Document body', edit: 'Edit body', editBody: 'Edited body', save: 'Save changes', cancel: 'Cancel', submit: 'Submit for review', approve: 'Approve', reject: 'Return for revision', revise: 'Revise', publish: 'Publish', archive: 'Archive', draft: 'Draft', in_review: 'In review', approved: 'Approved', rejected: 'Returned', published: 'Published', archived: 'Archived', pending: 'Processing…', generate: 'Generate document', session: 'Session', noSession: 'Select or create a session first', version: 'Version' }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'meteo-document-products': ProductPanelKey } }
