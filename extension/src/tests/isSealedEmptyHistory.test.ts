import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { isSealedEmptyHistory } from '../utils/isSealedEmptyHistory'

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
    'sealed.json': '{}',
    'events.jsonl': '',
  })
  const noJournal = await historyFolder(context, { 'sealed.json': '{}' })
  const withEntry = await historyFolder(context, {
    'sealed.json': '{}',
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
