import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { isSealedEmptyHistory } from '../utils/isSealedEmptyHistory'

/** A seal as the writer stores it, recording the given entry count and journal size. */
function sealText(entryCount: number, journalBytes: number): string {
  return JSON.stringify({
    version: 1,
    studyId:
      '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222',
    entryCount,
    journalBytes,
    journalHash: 'a'.repeat(64),
    status: 'partial',
    endedAt: '2026-10-23T00:00:00.000Z',
  })
}

/** A history folder holding the given files, removed when the test ends. */
async function historyFolder(
  context: TestContext,
  files: Record<string, string>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-sealed-empty-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content)
  return directory
}

// Value: protects=the one rule that lists a history and counts it toward the saved study limit; fails_when=a seal with an empty or absent journal is not recognized, or a history with an entry, an unsealed one or a seal that is no file is taken for empty; why_new=a history sealed with no entry (before D6) was hidden from the list but still counted (F213); seam=real files; no_claim=the journal's content (only its size is read)
test('a folder with a seal and an empty or absent journal is a sealed empty history, any other is not', async (context) => {
  // Arrange
  const emptyJournal = await historyFolder(context, {
    'sealed.json': sealText(0, 0),
    'events.jsonl': '',
  })
  const noJournal = await historyFolder(context, {
    'sealed.json': sealText(0, 0),
  })
  const withEntry = await historyFolder(context, {
    'sealed.json': sealText(0, 0),
    'events.jsonl': '{"type":"output"}\n',
  })
  const unsealed = await historyFolder(context, { 'events.jsonl': '' })
  const sealIsFolder = await historyFolder(context, { 'events.jsonl': '' })
  await mkdir(join(sealIsFolder, 'sealed.json'))

  // Act
  const results = await Promise.all(
    [emptyJournal, noJournal, withEntry, unsealed, sealIsFolder].map(
      isSealedEmptyHistory,
    ),
  )

  // Assert
  assert.deepEqual(results, [true, true, false, false, false])
})

// Value: protects=the saved learning of a history whose seal records entries but whose journal was lost or emptied (a damaged history): it is not taken for an empty one, so codebook_status, the list and the saved-study count never remove it with its learning material and header (F251); fails_when=the journal's size alone decides, so a lost journal makes a status call delete the whole folder; why_new=Codex's structured review of PR-1 found the deletion path, and no test gave a seal with entries and no journal; seam=real files; no_claim=how the damaged history then reads (unavailable), which the store's read decides
test('a seal that records entries keeps its history although the journal is gone or empty, and an unreadable seal keeps it too', async (context) => {
  // Arrange
  const lostJournal = await historyFolder(context, {
    'sealed.json': sealText(4, 812),
  })
  const emptiedJournal = await historyFolder(context, {
    'sealed.json': sealText(4, 812),
    'events.jsonl': '',
  })
  const bytesWithoutEntries = await historyFolder(context, {
    'sealed.json': sealText(0, 812),
    'events.jsonl': '',
  })
  const unreadableSeal = await historyFolder(context, {
    'sealed.json': '{"version":1',
    'events.jsonl': '',
  })
  const sealOfAnotherShape = await historyFolder(context, {
    'sealed.json': '{}',
  })

  // Act
  const results = await Promise.all(
    [
      lostJournal,
      emptiedJournal,
      bytesWithoutEntries,
      unreadableSeal,
      sealOfAnotherShape,
    ].map(isSealedEmptyHistory),
  )

  // Assert
  assert.deepEqual(results, [false, false, false, false, false])
})
