import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEEP_WIKI_SHORTCUTS, STUDY_SHORTCUTS } from '../ui/constants'
import {
  itemsForQuery,
  keyboardShortcutItems,
  type ShortcutListItem,
} from '../utils/keyboardShortcutItems'

const separatorLabels = (items: ShortcutListItem[]): string[] =>
  items.flatMap((item) => (item.kind === 'separator' ? [item.label] : []))

// Value: protects=the list's groups in the order a learner reads them; fails_when=a group is missing, renamed or reordered; no_claim=how the host renders separators
test('the list holds the groups Codebook views, Learning replay and DeepWiki reader in that order', () => {
  // Arrange / Act
  const items = keyboardShortcutItems('darwin')

  // Assert
  assert.deepEqual(separatorLabels(items), [
    'Codebook views',
    'Learning replay',
    'DeepWiki reader',
  ])
})

// Value: protects=the key notation the editor's tooltip shows; fails_when=macOS shows Shift+/ or Windows and Linux show the symbol; no_claim=keyboard layouts where ? is not Shift and slash
test('the native entry reads ⇧/ on macOS and Shift+/ on Windows and Linux', () => {
  // Arrange / Act
  const keysOf = (platform: NodeJS.Platform): string[] =>
    keyboardShortcutItems(platform).flatMap((item) =>
      item.kind === 'shortcut' && item.detail.includes('Activity Bar')
        ? [item.description]
        : [],
    )

  // Assert
  assert.deepEqual(keysOf('darwin'), ['⇧/'])
  assert.deepEqual(keysOf('win32'), ['Shift+/'])
  assert.deepEqual(keysOf('linux'), ['Shift+/'])
})

// Value: protects=every Codebook shortcut being discoverable once per feature with keys; fails_when=an entry of STUDY_SHORTCUTS or DEEP_WIKI_SHORTCUTS is dropped, listed twice in its group, or lacks keys; no_claim=how the host renders the items
test('every Learning replay and DeepWiki reader shortcut appears once with its keys', () => {
  // Arrange
  const items = keyboardShortcutItems('linux')
  const replayStart = items.findIndex(
    (item) => item.label === 'Learning replay',
  )
  const readerStart = items.findIndex(
    (item) => item.label === 'DeepWiki reader',
  )
  const identities = (group: ShortcutListItem[]): string[] =>
    group.flatMap((item) =>
      item.kind === 'shortcut'
        ? [`${item.label}|${item.description}|${item.detail}`]
        : [],
    )
  const expected = (
    entries: Array<{ action: string; keys: string; context: string }>,
  ): string[] =>
    entries.map((entry) => `${entry.action}|${entry.keys}|${entry.context}`)

  // Act
  const replay = identities(items.slice(replayStart + 1, readerStart))
  const reader = identities(items.slice(readerStart + 1))

  // Assert
  assert.deepEqual(replay, [...new Set(expected(STUDY_SHORTCUTS))])
  assert.deepEqual(reader, expected(DEEP_WIKI_SHORTCUTS))
  assert.ok(
    items.every((item) => item.kind !== 'shortcut' || item.description !== ''),
  )
})

// Value: protects=a search that finds nothing telling the learner so; fails_when=the list goes empty, or the query is missing from the label; no_claim=the host's own filter
test('a search that matches nothing shows one item naming the search with Clear search', () => {
  // Arrange
  const items = keyboardShortcutItems('darwin')

  // Act
  const shown = itemsForQuery(items, 'zzz')

  // Assert
  assert.deepEqual(shown, [
    {
      kind: 'no-match',
      label: 'No shortcuts match "zzz"',
      description: 'Clear search',
    },
  ])
})

// Value: protects=the full list before the learner types and the case-insensitive match over label, description and detail, with the separators of the groups that keep a match; fails_when=an empty query drops items, the match is case-sensitive, ignores detail, or keeps the separator of a group without a match; no_claim=the host's own filter
test('an empty search shows every item and a search keeps matching items under their group separator', () => {
  // Arrange
  const items = keyboardShortcutItems('darwin')

  // Act
  const everything = itemsForQuery(items, '')
  const byDetail = itemsForQuery(items, 'ACTIVITY BAR')

  // Assert
  assert.deepEqual(everything, items)
  assert.deepEqual(
    byDetail.map((item) => item.label),
    ['Codebook views', 'Keyboard shortcuts'],
  )
})
