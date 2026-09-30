/**
 * Pure row-model derivation for the meteorology tool cards: lifecycle state,
 * the frozen call's arguments, the flattened result text, and each tool's
 * presentation metadata — the same raw-block contract the generic web cards
 * use, so a card stays a pure function of what the turn already knows.
 */
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { MeteoConsultMeta, MeteoLookupStationMeta } from './meteo-meta.ts'
import { narrowConsultMeta, narrowLookupMeta } from './meteo-meta.ts'

/** Card lifecycle derived solely from the durable call slice. */
export type MeteoCardState = 'running' | 'ok' | 'error' | 'stopped'

/** The frozen running-or-settled slice a card derives from. */
export type MeteoToolBlock = ToolCallViewProps['block']

/** Lifecycle and result text shared by every meteo card. */
export interface MeteoCardBase {
  readonly state: MeteoCardState
  /** Flattened durable result text for the expanded body; null while running. */
  readonly output: string | null
  /** First failure line for the collapsed error summary; null outside the error state. */
  readonly errorSummary: string | null
}

/** Derived consultation card. */
export interface MeteoConsultModel extends MeteoCardBase {
  /** The question the model asked, from the call's arguments. */
  readonly question: string | null
  /** The consultation metadata, or null for the generic fallback. */
  readonly meta: MeteoConsultMeta | null
}

/** Derived station-lookup card. */
export interface MeteoLookupModel extends MeteoCardBase {
  /** The candidates the lookup returned, or null for the generic fallback. */
  readonly stations: readonly MeteoLookupStationMeta[] | null
}

/** Derived session-focus card: the slots the logged call named. */
export interface MeteoFocusModel extends MeteoCardBase {
  /** Station identifier the call named, when it named one. */
  readonly stationId: string | null
  /** Crop the call named, when it named one. */
  readonly crop: string | null
  /** Whether the call head and its arguments were readable at all. */
  readonly headReadable: boolean
}

/**
 * Derive the card lifecycle from a frozen call slice.
 * @param block - running or settled Tool block.
 * @returns running, ok, error, or stopped (an interrupted call).
 */
export function meteoCardState(block: MeteoToolBlock): MeteoCardState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}
/**
 * Whether one frozen call slice is its settled result form.
 * @param block - running or settled Tool block.
 * @returns true for a settled result node.
 */
function isSettled(block: MeteoToolBlock): block is ToolResultNode {
  return 'kind' in block
}

/**
 * Parse the call head's arguments of one frozen Tool block.
 * @param block - running or settled Tool block.
 * @returns the object arguments, or null when the call head or a valid JSON
 *   object is unavailable (window truncation left the call outside).
 */
export function meteoCallArgs(block: MeteoToolBlock): Record<string, unknown> | null {
  const argsRaw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  if (argsRaw === undefined) return null
  try {
    const value: unknown = JSON.parse(argsRaw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    // Streaming can expose a truncated JSON prefix; the card falls back to
    // its durable result instead of rendering a half-parsed argument.
    return null
  }
}

/**
 * Render the call head's arguments as the generic body's input text:
 * pretty-printed when the JSON parses to an object, raw otherwise.
 * @param block - running or settled Tool block.
 * @returns the formatted arguments, or null when none are readable.
 */
export function meteoCallArgsFormatted(block: MeteoToolBlock): string | null {
  const args = meteoCallArgs(block)
  if (args !== null) return JSON.stringify(args, null, 2)
  const raw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  return raw === undefined || raw.trim() === '' ? null : raw
}

/**
 * Flatten a settled result's content blocks to display text: text blocks
 * verbatim, any other block as its JSON — the generic Tool-row text contract.
 * @param block - running or settled Tool block.
 * @returns the flattened text, or null while running or for an empty result.
 */
export function meteoResultText(block: MeteoToolBlock): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/**
 * First physical line of one text value, for the collapsed error summary.
 * @param text - full result text.
 * @returns the first line, or null for a blank value.
 */
function firstLine(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const newline = trimmed.indexOf('\n')
  return newline === -1 ? trimmed : trimmed.slice(0, newline)
}

/**
 * Derive the consultation card from a frozen call slice.
 * @param block - running or settled Tool block.
 * @returns the question, the narrowed metadata when the call settled
 *   successfully with readable metadata, and the durable result text.
 */
export function meteoConsultModel(block: MeteoToolBlock): MeteoConsultModel {
  const state = meteoCardState(block)
  const args = meteoCallArgs(block)
  const question = typeof args?.question === 'string' && args.question !== '' ? args.question : null
  const output = state === 'running' ? null : meteoResultText(block)
  return {
    state,
    question,
    meta: isSettled(block) && state === 'ok' ? narrowConsultMeta(block.meta ?? null) : null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
  }
}

/**
 * Derive the station-lookup card from a frozen call slice.
 * @param block - running or settled Tool block.
 * @returns the narrowed candidate list when the call settled successfully
 *   with readable metadata, and the durable result text.
 */
export function meteoLookupModel(block: MeteoToolBlock): MeteoLookupModel {
  const state = meteoCardState(block)
  const output = state === 'running' ? null : meteoResultText(block)
  return {
    state,
    stations: isSettled(block) && state === 'ok' ? narrowLookupMeta(block.meta ?? null)?.stations ?? null : null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
  }
}

/**
 * Derive the session-focus card from a frozen call slice.
 * @param block - running or settled Tool block.
 * @returns the focus slots the logged call named (the host publishes no
 *   presentation metadata for this tool) and the durable result text.
 */
export function meteoFocusModel(block: MeteoToolBlock): MeteoFocusModel {
  const state = meteoCardState(block)
  const args = meteoCallArgs(block)
  const stationId = typeof args?.stationId === 'string' && args.stationId !== '' ? args.stationId : null
  const crop = typeof args?.crop === 'string' && args.crop !== '' ? args.crop : null
  const output = state === 'running' ? null : meteoResultText(block)
  return {
    state,
    stationId,
    crop,
    headReadable: args !== null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
  }
}
