/**
 * The staged-form vocabulary behind the aggregated-search card — the shell
 * every plugin card shares plus the minimal observable store, both faithful
 * subsets of the shipped `ui-settings-plugins` card model. Bundled locally
 * because external client bundles cannot value-import `@deepseek-ai/*`
 * packages.
 *
 * Unlike the shipped flat CardForm, this card's main value is ONE structured
 * field (the `providers` queue), so its controller stages the whole array;
 * these shared types keep the chrome and the snapshot contract identical.
 *
 * @module dsh-web-search-aggregation/client/form
 */

/** Form state every plugin card shares. */
export interface CardShell {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** Minimal observable snapshot source (structural clone of the runtime contract). */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
}

/** Credential presence facts for one reference, as the credentials domain reports them. */
export interface CredentialBadge {
  /** Whether any layer supplies a value for the reference. */
  configured: boolean | undefined
  /** Whether `credentials.set` can affect it. */
  writable: boolean | undefined
}

/** One scalar control as the card renders it. */
export interface CardFieldState {
  /** Draft string the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}
