/**
 * Scripted frozen call slices and DOM helpers shared by the meteo
 * conversation-card specs: the two block forms the turn log hands a card, the
 * meteoChat translate seat, and the row/section lookups the card specs read.
 */
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { zh } from '../src/client/locales.ts'

/** The meteoChat translate seat over the zh dictionary. */
export const t = makeTranslate(zh)

/** The argsRaw the settled default call head carries. */
export const ARGS_RAW = '{"question":"明天能打药吗"}'

/** A dispatched block whose call head carries `argsRaw`. */
export function running(argsRaw: string, over: Partial<StartedToolCall> = {}): StartedToolCall {
  return {
    phase: 'start',
    callId: 'c1', name: 'meteo_consult', argsRaw, turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
  }
}

/** A settled success block; `over` replaces any field of the default shape. */
export function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 10,
    time: 2_000,
    callId: 'c1',
    call: { name: 'meteo_consult', argsRaw: ARGS_RAW },
    callTime: 1_000,
    content: [{ type: 'text', text: '完成' }],
    isError: false,
    subCalls: [],
    ...over,
  }
}

/** The expandable summary row, or a failure naming the missing attribute. */
export function rowOf(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>('[data-expandable]')
  if (row === null) throw new Error('expected an expandable summary row')
  return row
}

/** The labelled section of an expanded card, or a failure naming the label. */
export function sectionOf(container: HTMLElement, label: string): HTMLElement {
  const section = container.querySelector<HTMLElement>(`section[aria-label="${label}"]`)
  if (section === null) throw new Error(`expected the section labelled ${label}`)
  return section
}

/** One element's subtree text as a reader sees it, whitespace collapsed. */
export function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The text of every `<pre>` of a rendered card, in render order. */
export function preTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('pre'), pre => pre.textContent ?? '')
}
