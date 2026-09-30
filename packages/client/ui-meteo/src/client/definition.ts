/**
 * Stage one of this package's registration: what the citation tab type IS.
 *
 * The type claims this package's own address scheme and nothing else, so it
 * competes with no viewer over a file address: `canOpen` is unnecessary because
 * no other type declares a pattern under `dsh-resource://meteo/`. It is a
 * resource type rather than a page type — every citation tab is opened by the
 * address its consultation row carries, which is what makes two opens of one
 * chunk the same tab.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo/definition
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { CITATION_PREFIX, parseCitationAddress } from './address.ts'

/** The tab kind this package owns. */
export const CITATION_KIND = 'meteo-citation'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const CITATION_ID = '@deepseek-ai/dsh-client-ui-meteo/citation'

/**
 * The citation type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function citationDefinition(t: TranslateNS<'meteo'>): SidebarRightTabDefinition {
  return {
    id: CITATION_ID,
    kind: CITATION_KIND,
    patterns: [`${CITATION_PREFIX}**`],
    priority: 'builtin',
    // The chip names the chunk, so two citations of one document stay
    // distinguishable in the strip; an address that will not parse is not one
    // this type's pattern should have claimed, and the label alone still reads.
    title: (address) => {
      const target = parseCitationAddress(address)
      return target === null ? t('citation.label') : t('citation.chunk', { ordinal: target.ordinal })
    },
    guide: [{
      id: 'citation',
      order: 30,
      title: () => t('citation.label'),
      description: () => t('citation.guide'),
    }],
  }
}
