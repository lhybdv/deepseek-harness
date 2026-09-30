/**
 * Shared row chrome for the meteo conversation cards: the 24px disclosure
 * row (state icon, title, separator, summary), the lifecycle copy, the
 * expanded input/output fallback body, and the inspect affordance — the same
 * geometry the generic Tool row uses, so the three meteo cards stay one
 * visual family.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MeteoCardState } from './meteo-card-model.ts'
import type { MeteoChatKey } from './locales.ts'
import css from './MeteoCard.module.css'

/** The locale translate seat every meteo card shares. */
export type MeteoT = PropsLocale<'meteoChat'>['t']

/** The three non-ok lifecycle words one card's dictionaries carry. */
export interface MeteoStateKeys {
  readonly running: MeteoChatKey
  readonly failed: MeteoChatKey
  readonly stopped: MeteoChatKey
}

/**
 * The lifecycle word for the visually hidden state span; null while ok.
 * @param state - derived card state.
 * @param keys - this card's running/failed/stopped dictionary keys.
 * @param t - meteoChat translate seat.
 * @returns the word to announce, or null while the call settled successfully.
 */
export function stateStatus(state: MeteoCardState, keys: MeteoStateKeys, t: MeteoT): string | null {
  switch (state) {
    case 'running': return t(keys.running)
    case 'error': return t(keys.failed)
    case 'stopped': return t(keys.stopped)
    default: return null
  }
}

/**
 * The collapsed leading slot: the ongoing/error/stopped dots for the
 * non-ok states, the tool glyph at rest.
 * @param state - derived card state.
 * @param icon - the tool's resting glyph.
 * @returns the leading node.
 */
export function leadingFor(state: MeteoCardState, icon: ReactNode): ReactNode {
  switch (state) {
    case 'running': return <StateDot state="ongoing" />
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return icon
  }
}

/**
 * The leading slot with the hover chevron crossfade for expandable rows.
 * @param state - derived card state.
 * @param open - whether the body is expanded.
 * @param expandable - whether the row carries a body at all.
 * @param icon - the tool's resting glyph.
 * @returns the leading node.
 */
export function disclosureLeading(state: MeteoCardState, open: boolean, expandable: boolean, icon: ReactNode): ReactNode {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  const iconNode = leadingFor(state, icon)
  if (!expandable) return iconNode
  return (
    <>
      <span className={css.iconIdle}>{iconNode}</span>
      <IconChevronDownOutline14 className={`${css.chevron} ${css.chevronHover}`} />
    </>
  )
}

/**
 * Disclosure expansion state plus the toggle that flips it.
 * @param expandable - whether the row carries a body at all.
 * @returns the open flag and the toggle handler.
 */
export function useDisclosure(expandable: boolean): { open: boolean; toggle: () => void } {
  const [expanded, setExpanded] = useState(false)
  const open = expanded && expandable
  const toggle = (): void => {
    setExpanded(value => !value)
  }
  return { open, toggle }
}

/**
 * The interactive props for one disclosure row: button semantics plus the
 * Enter/Space keyboard contract; empty when the row is not expandable.
 * @param open - whether the body is expanded.
 * @param expandable - whether the row carries a body at all.
 * @param toggle - the expansion flip.
 * @returns the props to spread on the row element.
 */
export function disclosureProps(open: boolean, expandable: boolean, toggle: () => void): {
  role?: 'button' | undefined
  tabIndex?: number | undefined
  'aria-expanded'?: boolean | undefined
  onClick?: (() => void) | undefined
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined
} {
  if (!expandable) return {}
  return {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggle,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    },
  }
}

/**
 * The generic expanded body for the non-metadata fallback: the call's
 * formatted arguments and its flattened durable result text.
 * @param props.argsText - formatted call arguments, or null to omit.
 * @param props.output - flattened result text, or null to omit.
 * @param props.error - whether the result text is the failure line.
 * @param props.t - meteoChat translate seat.
 * @returns the input/output card.
 */
export function MeteoGenericBody({ argsText, output, error, t }: {
  argsText: string | null
  output: string | null
  error: boolean
  t: MeteoT
}): ReactNode {
  return (
    <div className={css.ioCard}>
      {argsText !== null ? (
        <section className={css.section} aria-label={t('generic.input')}>
          <div className={css.ioLabel}>{t('generic.input')}</div>
          <pre className={css.ioText}>{argsText}</pre>
        </section>
      ) : null}
      {output !== null ? (
        <section className={css.section} aria-label={t('generic.output')}>
          <div className={css.ioLabel}>{t('generic.output')}</div>
          <pre className={css.ioText} data-error={error || undefined}>{output}</pre>
        </section>
      ) : null}
    </div>
  )
}

/**
 * The trajectory inspect affordance, present only when the owner supplied
 * an inspect handle.
 * @param props.inspect - the owner's inspect callback, or none.
 * @param props.t - meteoChat translate seat.
 * @returns the inspect button, or null.
 */
export function MeteoInspectButton({ inspect, t }: {
  inspect: (() => void) | undefined
  t: MeteoT
}): ReactNode {
  if (inspect === undefined) return null
  return (
    <button type="button" className={css.inspectButton} onClick={inspect}>
      <IconInspectOutline12 />
      {t('card.inspect')}
    </button>
  )
}
