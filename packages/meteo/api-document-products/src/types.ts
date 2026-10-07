/**
 * Browser-safe wire vocabulary of the `documentProducts` Remote namespace.
 *
 * Every payload is declared here rather than re-exported from the lifecycle seam that produces it:
 * that seam reads the meteo data files and corpus index, so importing its module would drag host
 * code into the browser face. These declarations mirror the seam records, plus the derived
 * `legalActions` the controller adds to products it returns, so the Host can hand a seam record
 * straight to a Remote method while the Client imports only this module.
 *
 * @module @deepseek-ai/dsh-api-document-products/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identity of one generated document product, as the wire carries it. */
export type ProductId = Branded<'MeteoProductId'>
/** Product categories the bench generates and publishes. */
export type ProductKind = '灾害预警产品' | '农业气象服务简报'
/** Durable document state. */
export type ProductState = 'draft' | 'in_review' | 'approved' | 'rejected' | 'published' | 'archived'
/** Legal lifecycle action names. */
export type ProductAction = 'edit' | 'submit' | 'approve' | 'reject' | 'revise' | 'publish' | 'archive'

/** Corpus coordinates supporting one claim in a product. */
export interface ProductCitation {
  /** Claim the citation backs. */
  readonly claim: string
  /** Indexed document the claim quotes. */
  readonly documentId: string
  /** Zero-based position of the quoted chunk inside its document. */
  readonly ordinal: number
  /** Character offset of the quoted text's first character in the document. */
  readonly charStart: number
  /** Character offset one past the quoted text's last character. */
  readonly charEnd: number
  /** Quoted text, verbatim. */
  readonly text: string
}

/** Numeric provenance of one value quoted in a product body. */
export interface ProductDataValue {
  /** The number as the body quotes it. */
  readonly value: number
  /** Dataset and element the number came from. */
  readonly source: string
  /** Station the number belongs to. */
  readonly stationId: string
  /** Observation, forecast instant, or window the number describes. */
  readonly period: string
}

/** One titled part of a product. */
export interface ProductSection {
  /** Section title. */
  readonly heading: string
  /** Section prose, including only data-backed numbers. */
  readonly body: string
}

/** One explicit actor-attributed lifecycle transition. */
export interface ProductTransition {
  /** State the product was in. */
  readonly from: ProductState
  /** State the action moved the product to. */
  readonly to: ProductState
  /** Responsible person or system. */
  readonly actor: string
  /** Transition the actor requested. */
  readonly action: ProductAction
  /** ISO instant of the transition. */
  readonly at: string
}

/** Generated document product as a review panel lists it. */
export interface DocumentProduct {
  /** Product identity every later lifecycle call addresses. */
  readonly id: ProductId
  /** Product category. */
  readonly kind: ProductKind
  /** Human-facing title. */
  readonly title: string
  /** Titled parts, in presentation order. */
  readonly sections: readonly ProductSection[]
  /** Complete document text. */
  readonly body: string
  /** Corpus coordinates of every quoted claim. */
  readonly citations: readonly ProductCitation[]
  /** Provenance of every number the body quotes. */
  readonly provenance: readonly ProductDataValue[]
  /** Current durable state. */
  readonly state: ProductState
  /**
   * Actions legal for `state`, answered by the transition table that owns the state machine.
   * The Remote controller fills this in rather than storing it, and the Client renders only these actions instead of re-deriving legality.
   */
  readonly legalActions: readonly ProductAction[]
  /** Transitions applied so far, oldest first. */
  readonly history: readonly ProductTransition[]
  /** Publication counter; publishing is the only action that advances it. */
  readonly version: number
}

/** Immutable publication artifact. */
export interface ReleaseArtifact {
  /** Product the release froze. */
  readonly productId: ProductId
  /** Product version the release froze. */
  readonly version: number
  /** ISO instant of publication. */
  readonly publishedAt: string
  /** Actor that published the version. */
  readonly actor: string
  /** Title at publication time. */
  readonly title: string
  /** Body at publication time. */
  readonly body: string
  /** Citations at publication time. */
  readonly citations: readonly ProductCitation[]
}

/** Fields of one draft generation request. */
export interface GenerateProductInput {
  /** Product category to generate. */
  readonly kind: ProductKind
  /** Station the product describes. */
  readonly stationId: string
  /** Inclusive start of the data period, as the datasets spell it. */
  readonly from: string
  /** Inclusive end of the data period, as the datasets spell it. */
  readonly to: string
  /** Hazard the product warns about, when the caller picked one. */
  readonly hazard?: string
  /** Crop the product advises on, when the caller picked one. */
  readonly crop?: string
  /** Rule-engine grade the product must state, when a warning triggered it. */
  readonly grade?: string
  /** Forecast span in hours; the deployment default applies when omitted. */
  readonly forecastHours?: number
  /** Corpus citation budget; the deployment default applies when omitted. */
  readonly citationLimit?: number
}

/** Explicit fields for creating a verified draft in a session. */
export interface GenerateRequest {
  /** Session that owns the generated draft. */
  readonly sessionId: SessionId
  /** Product generation fields. */
  readonly input: GenerateProductInput
}

/** Explicit lifecycle transition request. */
export interface ActRequest {
  /** Session that owns the addressed product. */
  readonly sessionId: SessionId
  /** Product to transition. */
  readonly id: ProductId
  /** Transition to apply; it must be legal for the product's current state. */
  readonly action: ProductAction
  /** Replacement body, required when action is edit. */
  readonly body?: string
  /** Responsible person or system. */
  readonly actor: string
  /** ISO instant of the transition. */
  readonly at: string
}

/** Product action response including an optional immutable release. */
export interface ActResponse {
  /** Product after the transition. */
  readonly product: DocumentProduct
  /** Publication the transition created, present only for a publish action. */
  readonly release?: ReleaseArtifact
}
