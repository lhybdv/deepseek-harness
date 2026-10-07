/** Auditable meteorological document product generation and lifecycle. @module @deepseek-ai/dsh-document-products */
export { generateFromResolvedHazard, generateProduct } from './generate.ts'
export type { GenerateProductInput, ProductComposer, ResolvedHazard } from './generate.ts'
export { legalProductActions, transitionProduct, verifyPolish, verifyProduct } from './product.ts'
export type { DocumentProduct, ProductAction, ProductCitation, ProductDataValue, ProductId, ProductKind, ProductState, ProductTransition, ProductTransitionResult, ReleaseArtifact } from './product.ts'
export { transitionInSession } from './events.ts'
export type { ProductSessionEvent } from './events.ts'
export { assertConfig, Config, DEFAULT_ARTIFACT_DIR, DEFAULT_CITATION_LIMIT, DEFAULT_DOCUMENT_CHARS, DEFAULT_FORECAST_HOURS, DEFAULT_SNIPPET_CHARS, DEFAULT_TOOL_TIMEOUT_MS, resolve } from './config.ts'
export type { Config as ProductConfig, ResolvedConfig } from './config.ts'
export { apply, DocumentProductService, inject, name } from './plugin.ts'
export { applyDocumentProductTool, documentMetaFromValue, documentResultMetaFromResult, formatDocumentResult, presentDocumentCall, presentDocumentResult } from './tool.ts'
export type {
  DocumentCitationMeta,
  DocumentCitationView,
  DocumentPeriod,
  DocumentProductMeta,
  DocumentProductView,
  DocumentReleaseView,
  DocumentResultMeta,
  DocumentResultValue,
  DocumentToolAction,
  DocumentTransitionMeta,
  DocumentTransitionView,
} from './tool.ts'
