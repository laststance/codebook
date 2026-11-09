import { DEEP_WIKI_SHORTCUTS, STUDY_SHORTCUTS } from '../ui/constants'

import type { ShortcutHelpEntry } from './installShortcutHelp'

/** The title of the native Keyboard shortcuts list. */
export const KEYBOARD_SHORTCUTS_TITLE = 'Keyboard shortcuts'
/** The key label of Codebook's native entry on macOS, where the editor shows Shift as a symbol. */
const DARWIN_HELP_KEYS = '⇧/'
/** The key label of Codebook's native entry on Windows and Linux. */
const OTHER_HELP_KEYS = 'Shift+/'
/** The description of the item that tells a search matched nothing; accepting it clears the search. */
export const CLEAR_SEARCH_DESCRIPTION = 'Clear search'
/** The context the native entry states, including that the key shown is Codebook's default, not the learner's binding. */
const NATIVE_HELP_CONTEXT =
  "In a Codebook view of the Activity Bar, outside its filter box; the ? key; Codebook's default key"
/** The context of the native list's close key. */
const NATIVE_CLOSE_CONTEXT = 'Keyboard shortcuts list'

/** One row of the native list: a group separator, a shortcut, or the item that tells a search matched nothing. */
export type ShortcutListItem =
  | { kind: 'separator'; label: string }
  | { kind: 'shortcut'; label: string; description: string; detail: string }
  | { kind: 'no-match'; label: string; description: 'Clear search' }

/** A feature's heading and its shortcuts, before they become list items. */
export interface ShortcutGroup {
  heading: string
  entries: readonly ShortcutHelpEntry[]
}

/**
 * Builds the native list's groups in feature order.
 *
 * @param platform - The editor host's `process.platform`; decides the notation of the native entry's key.
 * @returns The Codebook views, Learning replay and DeepWiki reader groups.
 */
function shortcutGroups(platform: NodeJS.Platform): ShortcutGroup[] {
  return [
    {
      heading: 'Codebook views',
      entries: [
        {
          action: KEYBOARD_SHORTCUTS_TITLE,
          keys: platform === 'darwin' ? DARWIN_HELP_KEYS : OTHER_HELP_KEYS,
          context: NATIVE_HELP_CONTEXT,
        },
        {
          action: 'Close keyboard shortcuts',
          keys: 'Esc',
          context: NATIVE_CLOSE_CONTEXT,
        },
      ],
    },
    { heading: 'Learning replay', entries: STUDY_SHORTCUTS },
    { heading: 'DeepWiki reader', entries: DEEP_WIKI_SHORTCUTS },
  ]
}

/**
 * Lists a group's entries as shortcut items, an entry whose (action, keys, context) tuple repeats within the group once.
 *
 * Each item's detail starts with the group's name, so the group stays visible when the host re-sorts a filtered list and drops the separators.
 *
 * @param heading - The group's name.
 * @param entries - One group's entries.
 * @returns The group's shortcut items.
 */
function dedupedShortcuts(
  heading: string,
  entries: readonly ShortcutHelpEntry[],
): ShortcutListItem[] {
  const seenIdentities = new Set<string>()
  const shortcuts: ShortcutListItem[] = []
  for (const { action, keys, context } of entries) {
    const identity = JSON.stringify([action, keys, context])
    // A repeat within one group is the same shortcut.
    if (seenIdentities.has(identity)) continue
    seenIdentities.add(identity)
    shortcuts.push({
      kind: 'shortcut',
      label: action,
      description: keys,
      detail: `${heading} · ${context}`,
    })
  }
  return shortcuts
}

/**
 * Builds the native Keyboard shortcuts list's items in feature order. Called by {@link showKeyboardShortcuts} each time the list opens.
 *
 * The same tuple in two groups stays in both, because it belongs to each feature.
 *
 * @param platform - The editor host's `process.platform`.
 * @returns A separator per group followed by that group's shortcuts.
 * @example
 * ```ts
 * keyboardShortcutItems('darwin')[1] // { kind: 'shortcut', label: 'Keyboard shortcuts', description: '⇧/', detail: '…' }
 * ```
 */
export function keyboardShortcutItems(
  platform: NodeJS.Platform,
): ShortcutListItem[] {
  return groupedShortcutItems(shortcutGroups(platform))
}

/**
 * Turns groups into list items: a separator per group followed by that group's deduplicated shortcuts.
 *
 * @param groups - The groups in display order.
 * @returns The list items.
 */
export function groupedShortcutItems(
  groups: readonly ShortcutGroup[],
): ShortcutListItem[] {
  return groups.flatMap(({ heading, entries }) => [
    { kind: 'separator' as const, label: heading },
    ...dedupedShortcuts(heading, entries),
  ])
}

/**
 * Tells whether a list item shows the search text.
 *
 * @param item - A list item.
 * @param needle - The trimmed, lower-cased search text.
 * @returns True when label, description or detail contains the needle.
 */
function matchesNeedle(item: ShortcutListItem, needle: string): boolean {
  if (item.kind === 'separator') return false
  const parts = [item.label, item.description]
  if (item.kind === 'shortcut') parts.push(item.detail)
  return parts.some((part) => part.toLowerCase().includes(needle))
}

/**
 * Codebook's own filter for the native list, so the shown list and the no-match decision always agree (the editor's filter is off).
 * Called by {@link showKeyboardShortcuts} on every change of the search text.
 *
 * @param items - Every item of the list, as {@link keyboardShortcutItems} built them.
 * @param query - The search text; matched case-insensitively as a substring of label, description and detail.
 * @returns
 * - every item for an empty query;
 * - the matching shortcuts with the separators of the groups that keep a match;
 * - the one no-match item when nothing matches.
 * @example
 * ```ts
 * itemsForQuery(items, 'zzz') // [{ kind: 'no-match', label: 'No shortcuts match "zzz"', description: 'Clear search' }]
 * ```
 */
export function itemsForQuery(
  items: readonly ShortcutListItem[],
  query: string,
): ShortcutListItem[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...items]
  const kept: ShortcutListItem[] = []
  let heldSeparator: ShortcutListItem | undefined
  for (const item of items) {
    if (item.kind === 'separator') {
      heldSeparator = item
      continue
    }
    if (!matchesNeedle(item, needle)) continue
    // A group's separator joins the list with its first match.
    if (heldSeparator) kept.push(heldSeparator)
    heldSeparator = undefined
    kept.push(item)
  }
  if (kept.length > 0) return kept
  return [
    {
      kind: 'no-match',
      label: `No shortcuts match "${query.trim()}"`,
      description: CLEAR_SEARCH_DESCRIPTION,
    },
  ]
}
