import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
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
  const first = await advanceRecordingScan(
    undefined,
    header,
    'h1',
    path,
    String,
  )
  const entriesAtFirst = first.progress.entryCount
  const halfLine = outputLine(3).slice(0, 40)
  await appendFile(path, halfLine)

  // Act
  const whileHalfWritten = await advanceRecordingScan(
    first,
    header,
    'h1',
    path,
    String,
  )
  const entriesWhileHalfWritten = whileHalfWritten.progress.entryCount
  await appendFile(path, outputLine(3).slice(40))
  const afterwards = await advanceRecordingScan(
    whileHalfWritten,
    header,
    'h1',
    path,
    String,
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
  const scan = await advanceRecordingScan(undefined, header, 'h1', path, String)
  await appendFile(path, outputLine(5))
  const later = await advanceRecordingScan(scan, header, 'h1', path, String)

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
  const first = await advanceRecordingScan(
    undefined,
    header,
    'h1',
    path,
    String,
  )

  // Act
  const afterHeaderChange = await advanceRecordingScan(
    first,
    header,
    'h2',
    path,
    String,
  )
  await writeFile(path, outputLine(1))
  const afterTruncation = await advanceRecordingScan(
    afterHeaderChange,
    header,
    'h2',
    path,
    String,
  )

  // Assert
  assert.notEqual(afterHeaderChange, first)
  assert.equal(afterHeaderChange.progress.entryCount, 3)
  assert.equal(afterTruncation.progress.entryCount, 1)
})

// Value: protects=the words of a broken entry's reason in a recording's summary, which Saved studies and the agent's node-history resource show: they come from the describer the store gives, which hides private paths and keeps the reason's bound (F243); fails_when=the scan writes the raw parse or schema failure, so a failure that quotes test output or a path reaches the agent unchanged; why_new=the scan wrote String(error) and no test read whose words the reason carries; seam=none; no_claim=what the store's describer hides, which sanitizeCause.test.ts pins
test("a broken entry's reason in a recording's scan is worded by the describer the store gives", async (context) => {
  // Arrange
  const path = await journalFile(
    context,
    outputLine(1) + '{"type":"output","sequence":2,"text":broken}\n',
  )

  // Act
  const scan = await advanceRecordingScan(
    undefined,
    header,
    'h1',
    path,
    () => 'the described failure',
  )

  // Assert
  assert.equal(scan.progress.entryCount, 1)
  assert.equal(
    scan.brokenReason,
    'Interrupted Node history after its verified prefix: the described failure',
  )
})

// Value: protects=a recording whose journal file was replaced by another file at least as long as what the scan consumed (a new inode): the scan starts again from the new file's beginning (F244); fails_when=the scan continues the new file from the old file's offset, so it reads from the middle of a line and the summary ends its verified prefix there or counts entries that are not in the file; why_new=the restart test covers a changed header and a shorter journal only, both of which also restart without the inode check; seam=none; no_claim=inode reuse by the file system
test('a scan starts again from the beginning when the journal is replaced by another file at least as long', async (context) => {
  // Arrange
  const path = await journalFile(context, outputLine(1) + outputLine(2))
  const first = await advanceRecordingScan(
    undefined,
    header,
    'h1',
    path,
    String,
  )
  const replacedLine = (sequence: number) =>
    `${JSON.stringify({
      type: 'output',
      sequence,
      elapsedMs: sequence,
      outputSequence: sequence,
      channel: 'stdout',
      text: `replaced output line ${sequence} of the new journal`,
    })}\n`
  await writeFile(
    `${path}.new`,
    replacedLine(1) + replacedLine(2) + replacedLine(3),
  )
  await rename(`${path}.new`, path)

  // Act
  const afterReplacement = await advanceRecordingScan(
    first,
    header,
    'h1',
    path,
    String,
  )

  // Assert
  assert.equal(first.progress.entryCount, 2)
  assert.equal(afterReplacement.brokenReason, undefined)
  assert.equal(afterReplacement.progress.entryCount, 3)
  assert.deepEqual([...afterReplacement.citable.keys()], [1, 2, 3])
})
