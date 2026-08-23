/**
 * The aggregated-search plugin-configuration card: the prioritized provider
 * queue (one entry block per provider — kind, enabled, the single API-key
 * credential, endpoint), the per-attempt timeout, and the queue-level reset —
 * staged and saved through the controller like the built-in plugin cards.
 * Each provider kind can be queued once; its one credential holds all its
 * keys joined by `,`.
 *
 * @module dsh-web-search-aggregation/client/card
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { PluginCard } from './PluginCard.tsx'
import { CheckboxField, KeysField, SectionHead, SelectField, ValueField } from './fields.tsx'
import type { AggregatedCardFace, AggregatedCardState, EntryView, ProviderKind } from './controller.ts'
import { KIND_CREDENTIAL_REF, KIND_DEFAULT_BASE_URL, KIND_KEY_PLACEHOLDER, PROVIDER_KINDS } from './controller.ts'
import type { AggregationLocaleKey } from './locales.ts'
import css from './fields.module.css'

/** Props the renderer binds for the aggregated-search card. */
export type AggregatedCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'web-search-aggregation'>
  & InjectFace<AggregatedCardFace>

/** Locale key naming one provider kind. */
const KIND_KEY: Record<ProviderKind, AggregationLocaleKey> = {
  anysearch: 'kindAnysearch',
  tinyfish: 'kindTinyfish',
  tavily: 'kindTavily',
  brave: 'kindBrave',
  exa: 'kindExa',
  firecrawl: 'kindFirecrawl',
  jina: 'kindJina',
  serpapi: 'kindSerpapi',
  serper: 'kindSerper',
}

/** The card's actions as the entry sub-component consumes them. */
type CardFaceProps = Omit<AggregatedCardFace, 'hooks'>

/** One queue entry's block. */
function EntryBlock(props: {
  t: (key: AggregationLocaleKey) => string
  entry: EntryView
  availableKinds: readonly ProviderKind[]
  total: number
  index: number
  disabled: boolean
  face: CardFaceProps
}) {
  const { t, entry, index, total, disabled, face } = props
  const kindLabel = t(KIND_KEY[entry.kind])
  return (
    <div className={entry.enabled ? css.entryBox : `${css.entryBox} ${css.entryBoxDisabled}`}>
      <div className={css.entryHead}>
        <span className={css.entryIndex} aria-hidden="true">{String(entry.position)}</span>
        <SelectField
          id={`agg-entry-kind-${String(index)}`}
          label={t('providerKind')}
          value={entry.kind}
          options={props.availableKinds.map(kind => ({ value: kind, label: t(KIND_KEY[kind]) }))}
          disabled={disabled}
          onEdit={(value) => { face.setKind(index, value as ProviderKind) }}
        />
        <div className={css.entryControls}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={`${t('moveUp')}: ${kindLabel}`}
            disabled={disabled || index === 0}
            onClick={() => { face.moveEntry(index, -1) }}
          >
            ↑
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={`${t('moveDown')}: ${kindLabel}`}
            disabled={disabled || index === total - 1}
            onClick={() => { face.moveEntry(index, 1) }}
          >
            ↓
          </button>
          <button
            type="button"
            className={`${css.iconButton} ${css.iconButtonDanger}`}
            aria-label={`${t('removeEntry')}: ${kindLabel}`}
            disabled={disabled}
            onClick={() => { face.removeEntry(index) }}
          >
            ✕
          </button>
        </div>
      </div>
      <CheckboxField
        id={`agg-entry-enabled-${String(index)}`}
        label={t('entryEnabled')}
        hint={t('entryEnabledHint')}
        checked={entry.enabled}
        disabled={disabled}
        onEdit={(checked) => { face.setEnabled(index, checked) }}
      />
      {entry.invalidReason === undefined ? null : <p className={css.invalid}>{t('duplicateKind')}</p>}
      <KeysField
        view={entry.keys}
        label={t('keysLabel')}
        placeholder={KIND_KEY_PLACEHOLDER[entry.kind]}
        configuredLabel={t('keyConfigured')}
        unsetLabel={t('keyUnset')}
        stagedLabel={t('keyStaged')}
        addLabel={t('addKey')}
        removeLabel={t('removeKey')}
        disabled={disabled}
        onAdd={(literal) => { face.addKey(index, literal) }}
        onRemove={(keyIndex) => { face.removeKey(index, keyIndex) }}
        onReset={() => { face.resetKeys(index) }}
      />
      <div className={css.fieldEmbedded}>
        <div className={css.head}>
          <label className={css.label} htmlFor={`agg-entry-baseurl-${String(index)}`}>{t('baseURL')}</label>
        </div>
        <input
          id={`agg-entry-baseurl-${String(index)}`}
          className={css.keyFormInput}
          type="text"
          placeholder={KIND_DEFAULT_BASE_URL[entry.kind]}
          value={entry.baseURL}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => { face.setBaseURL(index, event.target.value) }}
        />
      </div>
    </div>
  )
}

/**
 * Render the aggregated-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function AggregatedCard(props: AggregatedCardProps) {
  const { t } = props
  const state = props.useAggregatedCard(snapshot => snapshot)
  const disabled = !state.writable
  const queuedKinds = new Set(state.entries.map(entry => entry.kind))
  return (
    <PluginCard
      copy={{
        expand: t('expand'),
        collapse: t('collapse'),
        unsaved: t('unsaved'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        discard: t('discard'),
        save: t('save'),
        saving: t('saving'),
      }}
      title={t('title')}
      description={t('description')}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-aggregated-timeout"
        label={t('attemptTimeout')}
        hint={t('attemptTimeoutHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        text={state.timeout.text}
        overridden={state.timeout.overridden}
        invalid={state.timeout.invalid}
        onEdit={(text) => { props.editTimeout(text) }}
        onReset={() => { props.resetTimeout() }}
      />
      <SectionHead label={t('queueLabel')}>
        {state.queueOverridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{t('overridden')}</span>
              <button
                type="button"
                className={css.reset}
                disabled={disabled}
                onClick={props.resetQueue}
              >
                {t('reset')}
              </button>
            </span>
          )
          : null}
      </SectionHead>
      <p className={css.hint}>{t('queueHint')}</p>
      <div className={css.queue}>
        {state.entries.map((entry, index) => (
          <EntryBlock
            key={`${String(index)}-${entry.kind}`}
            t={t}
            entry={entry}
            availableKinds={PROVIDER_KINDS.filter(kind => kind === entry.kind || !queuedKinds.has(kind))}
            total={state.entries.length}
            index={index}
            disabled={disabled}
            face={props}
          />
        ))}
      </div>
      <div className={`${css.chips} ${css.addRow}`}>
        {PROVIDER_KINDS.map(kind => (
          <button
            key={kind}
            type="button"
            className={css.ghostButton}
            disabled={disabled || queuedKinds.has(kind)}
            title={queuedKinds.has(kind) ? t('kindAlreadyQueued') : KIND_CREDENTIAL_REF[kind]}
            onClick={() => { props.addEntry(kind) }}
          >
            + {t(KIND_KEY[kind])}
          </button>
        ))}
      </div>
    </PluginCard>
  )
}
