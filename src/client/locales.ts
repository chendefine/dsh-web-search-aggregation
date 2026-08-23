/**
 * Locale bundles for the aggregated-search card (the plugin's own dictionary
 * namespace, registered with the client locale service).
 *
 * @module dsh-web-search-aggregation/client/locales
 */

/** Locale keys this card renders. */
export type AggregationLocaleKey =
  | 'title' | 'description'
  | 'attemptTimeout' | 'attemptTimeoutHint'
  | 'queueLabel' | 'queueHint'
  | 'kindAnysearch' | 'kindTinyfish' | 'kindTavily'
  | 'providerKind' | 'entryEnabled' | 'entryEnabledHint'
  | 'moveUp' | 'moveDown' | 'removeEntry'
  | 'keysHint' | 'keyConfigured' | 'keyUnset' | 'keyStaged' | 'removeKey'
  | 'addKey' | 'keyRefLabel' | 'keyLiteralLabel' | 'keyLiteralPlaceholder'
  | 'baseURL' | 'baseURLHint' | 'baseURLPlaceholder'
  | 'invalidRef' | 'duplicateRef'
  | 'overridden' | 'reset' | 'invalidText' | 'invalidNumber'
  | 'expand' | 'collapse' | 'unsaved' | 'readOnly' | 'saveFailed'
  | 'discard' | 'save' | 'saving'

/** This plugin's dictionary namespace, merged into the locale key map. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'web-search-aggregation': AggregationLocaleKey
  }
}

/** English copy. */
export const en: Record<AggregationLocaleKey, string> = {
  title: 'Aggregated web search',
  description: 'Serves web_search through a prioritized queue of AnySearch / TinyFish / Tavily with per-provider API-key pools; the first provider that answers wins.',
  attemptTimeout: 'Per-provider attempt timeout (ms)',
  attemptTimeoutHint: 'One attempt is cut off after this long and the queue moves to the next provider or key. 1000–60000.',
  queueLabel: 'Provider queue',
  queueHint: 'A web search tries the entries top-down: the first one that returns wins, a failed entry falls through to the next. Keys within an entry rotate and fall through the same way.',
  kindAnysearch: 'AnySearch',
  kindTinyfish: 'TinyFish',
  kindTavily: 'Tavily',
  providerKind: 'Provider',
  entryEnabled: 'Enabled',
  entryEnabledHint: 'A disabled entry stays configured but is skipped.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  removeEntry: 'Remove entry',
  keysHint: 'API keys for this entry, by credential reference. Leave empty for AnySearch anonymous access.',
  keyConfigured: 'configured',
  keyUnset: 'not set',
  keyStaged: 'pending save',
  removeKey: 'Remove key',
  addKey: '+ Add key',
  keyRefLabel: 'Credential reference (environment-variable name)',
  keyLiteralLabel: 'API key literal (optional when the reference already exists)',
  keyLiteralPlaceholder: 'tvly-… / as_sk_… (leave blank to only name a reference)',
  baseURL: 'Endpoint base URL',
  baseURLHint: 'Overrides the provider default; leave blank for the official API.',
  baseURLPlaceholder: '(default endpoint)',
  invalidRef: 'Credential references must look like environment-variable names (letters, digits, underscore; not starting with a digit).',
  duplicateRef: 'The same credential reference appears twice in this entry.',
  overridden: 'overridden',
  reset: 'Reset',
  invalidText: 'Not a valid value.',
  invalidNumber: 'Enter a number.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  readOnly: 'Read-only',
  saveFailed: 'Saving failed; the edits are kept.',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
}

/** 中文文案。 */
export const zh: Record<AggregationLocaleKey, string> = {
  title: '聚合网页搜索',
  description: '按优先级队列依次调用 AnySearch / TinyFish / Tavily 完成网页搜索，每个提供商可配多个 API key，第一个成功者生效。',
  attemptTimeout: '单个提供商尝试超时（毫秒）',
  attemptTimeoutHint: '一次调用超过该时长即被切断，队列转向下一个 key 或下一个提供商。范围 1000–60000。',
  queueLabel: '提供商队列',
  queueHint: '网页搜索按自上而下的顺序逐个尝试：第一个返回结果的生效，失败的自动落到下一个。同一提供商的多个 key 同样轮转回退。',
  kindAnysearch: 'AnySearch',
  kindTinyfish: 'TinyFish',
  kindTavily: 'Tavily',
  providerKind: '提供商',
  entryEnabled: '启用',
  entryEnabledHint: '停用的条目保留配置但会被跳过。',
  moveUp: '上移',
  moveDown: '下移',
  removeEntry: '删除条目',
  keysHint: '该条目的 API key（以凭据引用表示）。AnySearch 留空即匿名访问。',
  keyConfigured: '已配置',
  keyUnset: '未设置',
  keyStaged: '待保存',
  removeKey: '移除 key',
  addKey: '+ 添加 key',
  keyRefLabel: '凭据引用（环境变量名）',
  keyLiteralLabel: 'API key 字面值（引用已存在时可留空）',
  keyLiteralPlaceholder: 'tvly-… / as_sk_…（留空表示仅登记引用）',
  baseURL: '接口地址（Base URL）',
  baseURLHint: '覆盖提供商默认地址；留空使用官方 API。',
  baseURLPlaceholder: '（默认端点）',
  invalidRef: '凭据引用需形如环境变量名（字母、数字、下划线，且不以数字开头）。',
  duplicateRef: '同一凭据引用在此条目中出现了两次。',
  overridden: '已覆盖',
  reset: '重置',
  invalidText: '不是有效值。',
  invalidNumber: '请输入数字。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  readOnly: '只读',
  saveFailed: '保存失败，编辑内容已保留。',
  discard: '放弃',
  save: '保存',
  saving: '保存中…',
}
