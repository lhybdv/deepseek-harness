/**
 * The `meteo_set_focus` conversation card: the place and crop the session just
 * committed to, straight from the call's arguments — the host publishes no
 * presentation metadata for this tool, and the logged arguments are the
 * authoritative record of what was written.
 *
 * A call head the log no longer carries (truncation) is reported as such
 * rather than shown as an empty focus: "the session named nothing" and "this
 * frame cannot say" are different facts.
 */
import { IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { meteoCallArgsFormatted, meteoFocusModel } from './meteo-card-model.ts'
import type { MeteoFocusModel } from './meteo-card-model.ts'
import {
  MeteoGenericBody, MeteoInspectButton, disclosureLeading, disclosureProps,
  stateStatus, useDisclosure, type MeteoStateKeys, type MeteoT,
} from './meteo-chrome.tsx'
import css from './MeteoCard.module.css'

/** Full props of the session-focus card. */
export type MeteoFocusCardProps = ToolCallViewProps & PropsLocale<'meteoChat'>

const STATE_KEYS: MeteoStateKeys = {
  running: 'focus.running',
  failed: 'focus.failed',
  stopped: 'focus.stopped',
}

/**
 * The focus line for one derived model: both slots, one of them, or a released
 * focus, which is what a call naming neither slot means.
 * @param model - the derived focus model.
 * @param t - meteoChat translate seat.
 * @returns the summary line.
 */
export function focusSummary(model: MeteoFocusModel, t: MeteoT): string {
  const { stationId, crop } = model
  if (stationId !== null && crop !== null) return t('focus.both', { station: stationId, crop })
  if (stationId !== null) return t('focus.stationOnly', { station: stationId })
  if (crop !== null) return t('focus.cropOnly', { crop })
  return t('focus.released')
}

/**
 * Render one `meteo_set_focus` call as the session-focus card.
 * @param props - keyed toolview payload plus the meteoChat locale seat.
 * @returns the dedicated focus row.
 */
export function MeteoFocusCard({ block, inspect, t }: MeteoFocusCardProps) {
  const model = meteoFocusModel(block)
  const argsText = model.state === 'running' ? null : meteoCallArgsFormatted(block)
  const expandable = model.state !== 'running' && (model.output !== null || argsText !== null)
  const { open, toggle } = useDisclosure(expandable)
  const status = stateStatus(model.state, STATE_KEYS, t)
  const summary = model.state === 'error'
    ? model.errorSummary ?? ''
    : model.headReadable
      ? focusSummary(model, t)
      : ''
  const leading = disclosureLeading(model.state, open, expandable, <IconGoalOutline16 size={14} />)
  return (
    <div className={css.card} data-tool="meteo_set_focus" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps(open, expandable, toggle)}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>{t('focus.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.state === 'error' ? `${css.summary} ${css.errorSummary}` : css.summary}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          <MeteoGenericBody argsText={argsText} output={model.output} error={model.state === 'error'} t={t} />
          <MeteoInspectButton inspect={inspect} t={t} />
        </div>
      ) : null}
    </div>
  )
}
