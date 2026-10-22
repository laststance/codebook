import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { advanceRecordingScan } from '../utils/recordingJournalScan'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** One output entry as the writer stores it, as a journal line. */
function outputLine(sequence: number, elapsedMs = sequence): string {
  return `${JSON.stringify({
    type: 'output',
    sequence,
    elapsedMs,
    outputSequence: sequence,
    channel: 'stdout',
    text: `line ${sequence}`,
  })}\n`
}

/** A journal file in a temporary folder, removed when the test ends. */
async function journalFile(context: TestContext, content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-journal-scan-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'events.jsonl')
  await writeFile(path, content)
  return path
}

const header = { version: 1 as const, ...nodeTestHistoryHeader('d'.repeat(64)) }

// Value: protects=a refresh that continues a recording from the bytes already consumed, and a last line the writer has not finished; fails_when=a half-written line is parsed (and breaks the verified prefix), counted twice, or skipped for good once it completes; why_new=the incremental scan of a recording is new (F64); seam=a real file; no_claim=the store's summary built from the scan
test('a scan continues after the bytes it consumed and leaves an unfinished last line for the next refresh', async (context) => {
  // Arrange
  const path = await journalFile(context, outputLine(1) + outputLine(2))
  const first = await advanceRecordingScan(undefined, header, 'h1', path)
  const entriesAtFirst = first.progress.entryCount
  const halfLine = outputLine(3).slice(0, 40)
  await appendFile(path, halfLine)

  // Act
  const whileHalfWritten = await advanceRecordingScan(first, header, 'h1', path)
  const entriesWhileHalfWritten = whileHalfWritten.progress.entryCount
  await appendFile(path, outputLine(3).slice(40))
  const afterwards = await advanceRecordingScan(
    whileHalfWritten,
    header,
    'h1',
    path,
  )

  // Assert
  assert.equal(entriesAtFirst, 2)
  assert.equal(entriesWhileHalfWritten, 2)
  assert.equal(afterwards.progress.entryCount, 3)
  assert.equal(afterwards.brokenReason, undefined)
  assert.deepEqual([...afterwards.citable.keys()], [1, 2, 3])
})

// Value: protects=the verified prefix of a recording whose journal breaks its rules; fails_when=an entry out of order is accepted, entries after it are read, or the reason is lost; why_new=the incremental scan must accept the same journals as a whole read (F64); seam=a real file; no_claim=schema errors of single fields
test('a scan stops its verified prefix at an out-of-order entry and reads nothing after it', async (context) => {
  // Arrange
  const path = await journalFile(
    context,
    outputLine(1) + outputLine(3) + outputLine(4),
  )

  // Act
  const scan = await advanceRecordingScan(undefined, header, 'h1', path)
  await appendFile(path, outputLine(5))
  const later = await advanceRecordingScan(scan, header, 'h1', path)

  // Assert
  assert.equal(later.progress.entryCount, 1)
  assert.match(
    later.brokenReason ?? '',
    /^Interrupted Node history after its verified prefix: Error: Node history order or receipt time changed\./,
  )
})

// Value: protects=a recording whose header file or journal was replaced; fails_when=a changed header signal or a journal that became shorter keeps the old scan, so the summary describes entries that are gone; why_new=the scan is reused only for the same header and file (F64, F102); seam=a real file; no_claim=inode reuse by the file system
test('a scan restarts from the beginning when the header changed or the journal became shorter', async (context) => {
  // Arrange
  const path = await journalFile(
    context,
    outputLine(1) + outputLine(2) + outputLine(3),
  )
  const first = await advanceRecordingScan(undefined, header, 'h1', path)

  // Act
  const afterHeaderChange = await advanceRecordingScan(
    first,
    header,
    'h2',
    path,
  )
  await writeFile(path, outputLine(1))
  const afterTruncation = await advanceRecordingScan(
    afterHeaderChange,
    header,
    'h2',
    path,
  )

  // Assert
  assert.notEqual(afterHeaderChange, first)
  assert.equal(afterHeaderChange.progress.entryCount, 3)
  assert.equal(afterTruncation.progress.entryCount, 1)
})
