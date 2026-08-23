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
  | 'kindAnysearch' | 'kindTinyfish' | 'kindTavily' | 'kindBrave' | 'kindExa' | 'kindFirecrawl' | 'kindJina'
  | 'providerKind' | 'entryEnabled' | 'entryEnabledHint'
  | 'moveUp' | 'moveDown' | 'removeEntry'
  | 'keysLabel'
  | 'keyConfigured' | 'keyUnset' | 'keyStaged' | 'addKey' | 'removeKey'
  | 'kindAlreadyQueued' | 'duplicateKind'
  | 'baseURL'
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
  description: 'Serves web search through a prioritized queue of AnySearch / TinyFish / Tavily / Brave / Exa / Firecrawl / Jina.',
  attemptTimeout: 'Per-provider attempt timeout (ms)',
  attemptTimeoutHint: 'One attempt is cut off after this long and the queue moves to the next provider or key. 1000–60000.',
  queueLabel: 'Provider queue',
  queueHint: 'A web search tries the entries top-down: the first one that returns wins, a failed entry falls through to the next. Keys within one provider rotate and fall through the same way. Each provider can be queued once.',
  kindAnysearch: 'AnySearch',
  kindTinyfish: 'TinyFish',
  kindTavily: 'Tavily',
  kindBrave: 'Brave Search',
  kindExa: 'Exa',
  kindFirecrawl: 'Firecrawl',
  kindJina: 'Jina Search',
  providerKind: 'Provider',
  entryEnabled: 'Enabled',
  entryEnabledHint: 'A disabled entry stays configured but is skipped.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  removeEntry: 'Remove entry',
  keysLabel: 'API keys',
  keyConfigured: 'configured',
  keyUnset: 'not set',
  keyStaged: 'pending save',
  addKey: 'Add key',
  removeKey: 'Remove key',
  kindAlreadyQueued: 'Already queued',
  duplicateKind: 'This provider is already queued; each provider can appear once.',
  baseURL: 'Endpoint base URL',
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
  description: '按优先级队列依次调用 AnySearch / TinyFish / Tavily / Brave / Exa / Firecrawl / Jina 完成网页搜索',
  attemptTimeout: '单个提供商尝试超时（毫秒）',
  attemptTimeoutHint: '一次调用超过该时长即被切断，队列转向下一个 key 或下一个提供商。范围 1000–60000。',
  queueLabel: '提供商队列',
  queueHint: '网页搜索按自上而下的顺序逐个尝试：第一个返回结果的生效，失败的自动落到下一个。同一提供商的多个 key 同样轮转回退。每个提供商只能加入一次。',
  kindAnysearch: 'AnySearch',
  kindTinyfish: 'TinyFish',
  kindTavily: 'Tavily',
  kindBrave: 'Brave Search',
  kindExa: 'Exa',
  kindFirecrawl: 'Firecrawl',
  kindJina: 'Jina Search',
  providerKind: '提供商',
  entryEnabled: '启用',
  entryEnabledHint: '停用的条目保留配置但会被跳过。',
  moveUp: '上移',
  moveDown: '下移',
  removeEntry: '删除条目',
  keysLabel: 'API keys',
  keyConfigured: '已配置',
  keyUnset: '未设置',
  keyStaged: '待保存',
  addKey: '添加 key',
  removeKey: '移除 key',
  kindAlreadyQueued: '已在队列中',
  duplicateKind: '该提供商已在队列中，每个提供商只能出现一次。',
  baseURL: '接口地址（Base URL）',
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
