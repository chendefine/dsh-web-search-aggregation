/**
 * The aggregated-search card's controls: the shipped ValueField and
 * CheckboxField (faithful local copies), a select for the provider kind, and
 * the per-entry API-key editor (one fixed credential per provider; its keys
 * staged as masked, closable tags in storage order) — all styled on the same
 * tokens and rhythm as the built-in plugin-configuration fields.
 *
 * @module dsh-web-search-aggregation/client/fields
 */

import { useState, type ReactNode } from 'react'
import css from './fields.module.css'

/** A staged text field (copy of the shipped ValueField). */
export function ValueField(props: {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  invalid: boolean
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  disabled: boolean
  placeholder?: string
  onEdit: (text: string) => void
  onReset: () => void
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? css.inputInvalid : css.input}
        type="text"
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        spellCheck={false}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/** A staged checkbox: one entry's enabled toggle (hint inline after the label). */
export function CheckboxField(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onEdit: (checked: boolean) => void
}) {
  return (
    <div className={css.fieldEmbedded}>
      <div className={css.checkboxRow}>
        <input
          id={props.id}
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => { props.onEdit(event.target.checked) }}
        />
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <span className={css.checkboxHint}>{props.hint}</span>
      </div>
    </div>
  )
}

/** One option of the provider-kind select. */
export interface SelectOption {
  /** The stored value (`anysearch` | `tinyfish` | `tavily`). */
  value: string
  /** Option label. */
  label: string
}

/** A staged select: the provider-kind picker inside one entry. */
export function SelectField(props: {
  id: string
  label: string
  value: string
  options: readonly SelectOption[]
  disabled: boolean
  onEdit: (value: string) => void
}) {
  return (
    <span>
      <label>
        <span className={css.visuallyHidden}>{props.label}</span>
        <select
          id={props.id}
          className={css.select}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => { props.onEdit(event.target.value) }}
        >
          {props.options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </span>
  )
}

/** The per-entry API-key control's view: one fixed credential per provider. */
export interface KeysFieldView {
  /** The kind's fixed credential reference (`TAVILY_API_KEY`, …). */
  ref: string
  /** The staged keys as masked tags, in storage order. */
  tags: string[]
  /** Whether a save would write the credential. */
  staged: boolean
  /** Whether any layer supplies a value for the reference. */
  configured: boolean | undefined
}

/**
 * One entry's API-key editor: the kind's single fixed credential (shown as
 * a ref badge with its presence), the staged keys as masked closable tags,
 * and an input with a `+` button (Enter works too). Tag order is the order
 * a save writes and the runtime reads. The credentials API is value-free on
 * read, so stored literals are never echoed back — a save REPLACES the whole
 * stored value, and closing every tag makes it clear the credential.
 */
export function KeysField(props: {
  view: KeysFieldView
  label: string
  placeholder: string
  configuredLabel: string
  unsetLabel: string
  stagedLabel: string
  addLabel: string
  removeLabel: string
  disabled: boolean
  onAdd: (literal: string) => void
  onRemove: (keyIndex: number) => void
  onReset: () => void
}) {
  const [text, setText] = useState('')
  const { view } = props
  const add = () => {
    if (text.trim().length === 0) return
    props.onAdd(text)
    setText('')
  }
  return (
    <div className={css.fieldEmbedded}>
      <div className={css.head}>
        <label className={css.label}>{props.label}</label>
        <span className={css.badges}>
          <span className={css.badge}>
            <code>{view.ref}</code>
            {' '}
            {view.staged
              ? props.stagedLabel
              : view.configured === undefined
                ? ''
                : view.configured ? props.configuredLabel : props.unsetLabel}
          </span>
          {view.staged
            ? (
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                ×
              </button>
            )
            : null}
        </span>
      </div>
      {view.tags.length === 0 ? null : (
        <div className={css.chips}>
          {view.tags.map((masked, keyIndex) => (
            <span key={String(keyIndex)} className={css.chip}>
              <span className={css.chipKey}>{masked}</span>
              <button
                type="button"
                className={css.chipRemove}
                aria-label={`${props.removeLabel} ${String(keyIndex + 1)}`}
                disabled={props.disabled}
                onClick={() => { props.onRemove(keyIndex) }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={css.keyAddRow}>
        <input
          className={css.keyFormInput}
          type="password"
          placeholder={props.placeholder}
          value={text}
          disabled={props.disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => { setText(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            add()
          }}
        />
        <button
          type="button"
          className={css.ghostButton}
          aria-label={props.addLabel}
          title={props.addLabel}
          disabled={props.disabled || text.trim().length === 0}
          onClick={add}
        >
          +
        </button>
      </div>
    </div>
  )
}

/** A generic small header row with trailing content (used by the queue section). */
export function SectionHead(props: { label: string, children?: ReactNode }) {
  return (
    <div className={css.queueHead}>
      <span className={css.label}>{props.label}</span>
      {props.children}
    </div>
  )
}
