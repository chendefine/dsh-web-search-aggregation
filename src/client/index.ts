/**
 * Browser half of `dsh-web-search-aggregation`: registers the locale
 * dictionary and the plugin-configuration card keyed by the
 * `web-search-aggregation` settings namespace, so the card pairs with the
 * Host section the plugin half registers — the shipped configurable-plugins
 * tab dispatches it with no changes.
 *
 * @module dsh-web-search-aggregation/client
 */

import type { Context } from 'cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ctx.locale / ctx.slots / ctx.settingsScope Context
// merges and the 'settings.plugin.item' SlotMap declaration from the owning
// client packages (type-only imports are erased before the purity gate).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AggregatedCardController, WEB_SEARCH_AGGREGATION_NS } from './controller.ts'
import { AggregatedCard } from './card.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'web-search-aggregation'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote']

/**
 * Mount the aggregated-search plugin-configuration card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-aggregation: card dictionary')

  const { api } = ctx.get('connection') as ConnectionHandle
  const controller = new AggregatedCardController(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_AGGREGATION_NS }),
    api,
  )

  // A key can be written from another surface (the credentials store, another
  // card); this is the only signal that a reference this card shows changed.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref: string) => {
      controller.refreshCredential(ref)
    }),
    'web-search-aggregation: credential invalidations',
  )

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: WEB_SEARCH_AGGREGATION_NS,
    locale: NS,
    inject: () => controller.inject(),
  }, AggregatedCard))
}
