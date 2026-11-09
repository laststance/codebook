import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  groupedShortcutItems,
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

// Value: protects=every group listing its shortcuts with keys and a detail that starts with the group name; fails_when=an entry is dropped, loses its keys, or its detail loses the group name the host's re-sorting would otherwise hide; no_claim=how the host renders the items
test('each group lists its shortcuts with keys and a detail that starts with the group name', () => {
  // Arrange
  const items = keyboardShortcutItems('linux')
  const shortcutsOf = (heading: string, next?: string): ShortcutListItem[] => {
    const start = items.findIndex((item) => item.label === heading)
    const end = next
      ? items.findIndex((item) => item.label === next)
      : items.length
    return items.slice(start + 1, end)
  }

  // Act
  const views = shortcutsOf('Codebook views', 'Learning replay')
  const replay = shortcutsOf('Learning replay', 'DeepWiki reader')
  const reader = shortcutsOf('DeepWiki reader')

  // Assert
  assert.deepEqual(views, [
    {
      kind: 'shortcut',
      label: 'Keyboard shortcuts',
      description: 'Shift+/',
      detail:
        "Codebook views · In a Codebook view of the Activity Bar, outside its filter box; the ? key; Codebook's default key",
    },
    {
      kind: 'shortcut',
      label: 'Close keyboard shortcuts',
      description: 'Esc',
      detail: 'Codebook views · Keyboard shortcuts list',
    },
  ])
  assert.deepEqual(reader, [
    {
      kind: 'shortcut',
      label: 'Keyboard shortcuts',
      description: '?',
      detail: 'DeepWiki reader · DeepWiki, outside text inputs',
    },
    {
      kind: 'shortcut',
      label: 'Close keyboard shortcuts',
      description: 'Esc',
      detail: 'DeepWiki reader · Keyboard shortcuts dialog',
    },
  ])
  assert.deepEqual(
    replay.find((item) => item.label === 'Seek backward one second'),
    {
      kind: 'shortcut',
      label: 'Seek backward one second',
      description: '← / ↓',
      detail: 'Learning replay · Focused recording timeline',
    },
  )
})

// Value: protects=a repeated shortcut appearing once per group while two features keep their own copy; fails_when=a tuple repeated inside a group is listed twice, or the same tuple in two groups is collapsed; no_claim=which real shortcuts repeat
test('a shortcut repeated within a group is listed once, and the same shortcut in two groups stays in both', () => {
  // Arrange
  const entry = { action: 'Open', keys: 'Enter', context: 'List' }

  // Act
  const items = groupedShortcutItems([
    { heading: 'First', entries: [entry, entry] },
    { heading: 'Second', entries: [entry] },
  ])

  // Assert
  assert.deepEqual(
    items.map((item) => [item.kind, item.label]),
    [
      ['separator', 'First'],
      ['shortcut', 'Open'],
      ['separator', 'Second'],
      ['shortcut', 'Open'],
    ],
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

// Value: protects=search by label, by key description and by group name, and the padded and blank queries; fails_when=a query by label, description or group finds nothing, a padded no-match query keeps its padding, or a blank query narrows the list; no_claim=the host's own filter
test('a search finds shortcuts by label, key and group name, trims its text and treats blanks as empty', () => {
  // Arrange
  const items = keyboardShortcutItems('darwin')
  const labelsOf = (query: string): string[] =>
    itemsForQuery(items, query).map((item) => item.label)

  // Act
  const byLabel = labelsOf('seek backward')
  const byDescription = itemsForQuery(items, 'page up')
  const byGroup = labelsOf('deepwiki')
  const padded = labelsOf('  zzz ')
  const blank = itemsForQuery(items, '   ')

  // Assert
  assert.ok(byLabel.includes('Seek backward one second'))
  assert.ok(byDescription.some((item) => item.kind === 'shortcut'))
  assert.deepEqual(byGroup, [
    'DeepWiki reader',
    'Keyboard shortcuts',
    'Close keyboard shortcuts',
  ])
  assert.deepEqual(padded, ['No shortcuts match "zzz"'])
  assert.deepEqual(blank, items)
})
