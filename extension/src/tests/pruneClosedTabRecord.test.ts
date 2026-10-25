import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pruneClosedTabRecord } from '../utils/pruneClosedTabRecord'
import { replacedTabAddresses } from '../utils/replacedTabAddresses'

type FakeTab = { address?: string }

const addressOf = (tab: FakeTab): string | undefined => tab.address

// Value: protects=a closed tab object ending its own entry in a record of tabs; fails_when=the entry stays and a later close by address picks a tab opened afterwards; why_new=Cycle 0052 task 15 (shared by the retired browser replay's tabs and the slot tabs waiting for the editor area); seam=none; no_claim=the editor's tab events
test('a closed tab object leaves the record', () => {
  // Arrange
  const tab: FakeTab = { address: 'codebook-source://key/a' }
  const record = new Map([[tab, 'codebook-source://key/a']])

  // Act
  const pruned = pruneClosedTabRecord(record, [tab], new Set(), addressOf)

  // Assert
  assert.deepEqual([...pruned], [])
})

// Value: protects=a tab object Cursor rebuilt and the learner then closed ending the entry its address stands for (F494); fails_when=the rebuilt object matches no entry and the old entry stays; why_new=Cycle 0052 task 15; seam=none; no_claim=Cursor's rebuild itself
test('a closed rebuilt tab ends the entry of its address when no live tab shows that address', () => {
  // Arrange
  const recorded: FakeTab = { address: 'codebook-source://key/a' }
  const rebuilt: FakeTab = { address: 'codebook-source://key/a' }
  const record = new Map([[recorded, 'codebook-source://key/a']])

  // Act
  const pruned = pruneClosedTabRecord(record, [rebuilt], new Set(), addressOf)

  // Assert
  assert.deepEqual([...pruned], [])
})

// Value: protects=a closed rebuilt tab leaving the entry in place while another live tab still shows its address; fails_when=closing one of two tabs at an address ends the record of the other; why_new=Cycle 0052 task 15; seam=none; no_claim=none beyond protects
test('a closed rebuilt tab keeps the entry while another live tab shows the address', () => {
  // Arrange
  const recorded: FakeTab = { address: 'codebook-source://key/a' }
  const rebuilt: FakeTab = { address: 'codebook-source://key/a' }
  const stillShown: FakeTab = { address: 'codebook-source://key/a' }
  const record = new Map([[recorded, 'codebook-source://key/a']])

  // Act
  const pruned = pruneClosedTabRecord(
    record,
    [rebuilt],
    new Set([stillShown]),
    addressOf,
  )

  // Assert
  assert.equal(pruned, record)
})

// Value: protects=the address of a recorded tab object the editor rebuilt standing for that tab when the record's tabs are closed; fails_when=a rebuilt tab matches nothing and stays open; why_new=Cycle 0052 task 15 (replacedTabAddresses, shared by both records); seam=none; no_claim=Cursor's rebuild itself
test('a recorded tab object the editor no longer shows gives its address', () => {
  // Arrange
  const shown: FakeTab = { address: 'codebook-source://key/a' }
  const rebuilt: FakeTab = { address: 'codebook-source://key/b' }
  const record = new Map([
    [shown, 'codebook-source://key/a'],
    [rebuilt, 'codebook-source://key/b'],
  ])

  // Act
  const addresses = replacedTabAddresses(record, new Set([shown]))

  // Assert
  assert.deepEqual([...addresses], ['codebook-source://key/b'])
})

// Value: protects=a closed rebuilt tab ending every stale entry of its address, so an entry the record took twice for one address (once per rebuilt object) never survives to close a tab opened later there; fails_when=only one of two stale entries of the address is removed (local CodeRabbit round 6, minor); why_new=Cycle 0052 task 15; seam=none; no_claim=Cursor's rebuild itself
test('a closed rebuilt tab ends every stale entry of its address', () => {
  // Arrange
  const first: FakeTab = { address: 'codebook-source://key/a' }
  const second: FakeTab = { address: 'codebook-source://key/a' }
  const closedRebuilt: FakeTab = { address: 'codebook-source://key/a' }
  const record = new Map([
    [first, 'codebook-source://key/a'],
    [second, 'codebook-source://key/a'],
  ])

  // Act
  const pruned = pruneClosedTabRecord(
    record,
    [closedRebuilt],
    new Set(),
    addressOf,
  )

  // Assert
  assert.deepEqual([...pruned], [])
})
