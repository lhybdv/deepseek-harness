/**
 * The `meteo_station_lookup` conversation card: the candidate list a
 * clarification offers, so a reader can see what the deployment knows before
 * answering the model. A result whose metadata is missing or foreign falls
 * back to the generic input/output body, so a replay never breaks.
 */
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { meteoCallArgsFormatted, meteoLookupModel } from './meteo-card-model.ts'
import type { MeteoLookupStationMeta } from './meteo-meta.ts'
import {
  MeteoGenericBody, MeteoInspectButton, disclosureLeading, disclosureProps,
  stateStatus, useDisclosure, type MeteoStateKeys, type MeteoT,
} from './meteo-chrome.tsx'
import css from './MeteoCard.module.css'

/** Full props of the station-lookup card. */
export type MeteoLookupCardProps = ToolCallViewProps & PropsLocale<'meteoChat'>

const STATE_KEYS: MeteoStateKeys = {
  running: 'lookup.running',
  failed: 'lookup.failed',
  stopped: 'lookup.stopped',
}

/**
 * The candidate stations, one row each: the identity a reader recognises and
 * the coordinates that tell two same-named townships apart.
 * @param props.stations - the narrowed candidates.
 * @param props.t - meteoChat translate seat.
 * @returns the section.
 */
function MeteoStationList({ stations, t }: {
  stations: readonly MeteoLookupStationMeta[]
  t: MeteoT
}) {
  return (
    <section className={css.section} aria-label={t('lookup.title')}>
      {stations.map(station => (
        <div className={css.candidate} key={station.id}>
          {station.name} <span className={css.candidateId}>({station.id})</span> — {station.county} {station.township}
          {' · '}
          <span className={css.criterionMuted}>
            {t('lookup.coords', {
              lon: String(station.lon), lat: String(station.lat), altitude: String(station.altitudeM),
            })}
          </span>
        </div>
      ))}
    </section>
  )
}

/**
 * Render one `meteo_station_lookup` call as the candidate-list card.
 * @param props - keyed toolview payload plus the meteoChat locale seat.
 * @returns the dedicated lookup row.
 */
export function MeteoLookupCard({ block, inspect, t }: MeteoLookupCardProps) {
  const model = meteoLookupModel(block)
  const argsText = model.state === 'running' || model.stations !== null ? null : meteoCallArgsFormatted(block)
  const expandable = model.state !== 'running'
    && (model.stations !== null || model.output !== null || argsText !== null)
  const { open, toggle } = useDisclosure(expandable)
  const status = stateStatus(model.state, STATE_KEYS, t)
  const summary = model.state === 'error'
    ? model.errorSummary ?? ''
    : model.stations === null
      ? ''
      : model.stations.length === 0
        ? t('lookup.none')
        : t('lookup.count', { n: String(model.stations.length) })
  const leading = disclosureLeading(model.state, open, expandable, <IconGlobeOutlineRegular size={14} />)
  return (
    <div className={css.card} data-tool="meteo_station_lookup" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps(open, expandable, toggle)}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>{t('lookup.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.state === 'error' ? `${css.summary} ${css.errorSummary}` : css.summary}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          {model.state === 'ok' && model.stations !== null
            ? <MeteoStationList stations={model.stations} t={t} />
            : <MeteoGenericBody argsText={argsText} output={model.output} error={model.state === 'error'} t={t} />}
          <MeteoInspectButton inspect={inspect} t={t} />
        </div>
      ) : null}
    </div>
  )
}
