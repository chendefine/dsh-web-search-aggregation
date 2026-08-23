/**
 * The aggregated-search card's controls: the shipped ValueField and
 * CheckboxField (faithful local copies), a select for the provider kind, and
 * the key-chip list with its add-key form — all styled on the same tokens
 * and rhythm as the built-in plugin-configuration fields.
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

/** A staged checkbox: one entry's enabled toggle. */
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
      </div>
      <p className={css.hint}>{props.hint}</p>
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

/** One key chip as the entry renders it. */
export interface KeyChipView {
  ref: string
  configured: boolean | undefined
  staged: boolean
}

/** The key chips of one entry plus the remove control per chip. */
export function KeyChips(props: {
  chips: readonly KeyChipView[]
  configuredLabel: string
  unsetLabel: string
  stagedLabel: string
  removeLabel: string
  disabled: boolean
  onRemove: (ref: string) => void
}) {
  if (props.chips.length === 0) return null
  return (
    <div className={css.chips}>
      {props.chips.map(chip => (
        <span key={chip.ref} className={css.chip}>
          <span>{chip.ref}</span>
          <span className={css.chipState}>
            {chip.staged
              ? props.stagedLabel
              : chip.configured === undefined
                ? ''
                : chip.configured ? props.configuredLabel : props.unsetLabel}
          </span>
          <button
            type="button"
            className={css.chipRemove}
            aria-label={`${props.removeLabel}: ${chip.ref}`}
            disabled={props.disabled}
            onClick={() => { props.onRemove(chip.ref) }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

/** The add-key control: reference name plus optional literal, applied on click. */
export function AddKeyForm(props: {
  refLabel: string
  keyLabel: string
  applyLabel: string
  keyPlaceholder: string
  disabled: boolean
  suggestedRef: string
  onApply: (ref: string, literal: string) => void
}) {
  const [ref, setRef] = useState('')
  const [literal, setLiteral] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className={css.ghostButton} disabled={props.disabled} onClick={() => { setOpen(true) }}>
        {props.applyLabel}
      </button>
    )
  }
  const refValue = ref.length > 0 ? ref : props.suggestedRef
  const invalid = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(refValue.trim())
  return (
    <div className={css.keyForm}>
      <input
        className={invalid ? `${css.keyFormInput} ${css.keyFormInputInvalid}` : css.keyFormInput}
        type="text"
        aria-label={props.refLabel}
        placeholder={props.suggestedRef}
        value={ref}
        spellCheck={false}
        disabled={props.disabled}
        onChange={(event) => { setRef(event.target.value) }}
      />
      <input
        className={css.keyFormInput}
        type="password"
        aria-label={props.keyLabel}
        placeholder={props.keyPlaceholder}
        value={literal}
        disabled={props.disabled}
        onChange={(event) => { setLiteral(event.target.value) }}
      />
      <button
        type="button"
        className={css.ghostButton}
        disabled={props.disabled || invalid || refValue.trim().length === 0}
        onClick={() => {
          props.onApply(refValue.trim(), literal)
          setRef('')
          setLiteral('')
          setOpen(false)
        }}
      >
        {props.applyLabel}
      </button>
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
