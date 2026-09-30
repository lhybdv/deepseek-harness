/**
 * The corpus panel's glyph in the global Sidebar's panel list.
 *
 * A panel row supplies only the requested edge length and whether the panel is
 * selected, so the component is that input and nothing else: the glyph takes the
 * size, and the selection rides a data attribute the row's own styling reads.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo/MeteoPanelIcon
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Draw the corpus panel's glyph at the size the panel row asks for.
 * @param props - the row's icon share: requested square edge, and selection state.
 * @returns the glyph, wrapped so the row can style the selected state.
 */
export function MeteoPanelIcon({ size, active }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <span data-active={active}>
      <IconGaugeOutlineRegular size={size} />
    </span>
  )
}
