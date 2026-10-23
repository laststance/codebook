import assert from 'node:assert/strict'
import fsPromises, { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  NODE_TEST_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_WRITER_FILE,
} from '../constants'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { writeNodeTestWriterRecord } from '../utils/writeNodeTestWriterRecord'

import { markNodeTestWriterGone } from './utils/markNodeTestWriterGone'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** Two stores on one learning folder, standing for two editor windows of one workspace; the first writes, the second only lists. */
async function twoWindows(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-history-windows-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = 'd'.repeat(64)
  return {
    directory,
    workspaceKey,
    writing: new NodeTestHistoryStore(directory, workspaceKey),
    reading: new NodeTestHistoryStore(directory, workspaceKey),
  }
}

// Value: protects=Saved studies in a second window: a test another live window records reads as recording and says nothing of an end; fails_when=the second window lists the history as interrupted with "no verified final seal" because only the writing window knows it is active; why_new=only the recording window knew a history was active (F260); seam=two stores on one storage folder; no_claim=the editor's own refresh timer
test('a test history another live window records is listed as recording, not interrupted', async (context) => {
  // Arrange
  const { writing, reading, workspaceKey } = await twoWindows(context)
  const writer = await writing.start(nodeTestHistoryHeader(workspaceKey))
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })

  // Act
  const [seenElsewhere] = await reading.list()

  // Assert
  assert.equal(seenElsewhere?.status, 'recording')
  assert.equal(seenElsewhere?.reason, undefined)
  assert.equal(seenElsewhere?.verification, 'verified')
})

// Value: protects=the learner's trust in a crash: a history whose writing window is gone still reads as interrupted in another window; fails_when=a stale writer record keeps the history recording for good; why_new=the recording marker of F260 must not outlive its writer; seam=the record names a process id no system has; no_claim=a writer on another machine, which this computer cannot probe
test('a test history whose writing window crashed is listed interrupted in another window', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [whileLive] = await reading.list()
  await markNodeTestWriterGone(directory, header.studyId)

  // Act
  const [afterCrash] = await reading.list()

  // Assert
  assert.equal(whileLive?.status, 'recording')
  assert.equal(afterCrash?.status, 'interrupted')
  assert.equal(
    afterCrash?.reason,
    'Node test history has no verified final seal.',
  )
})

// Value: protects=the end of a recording seen from another window: after the writer seals, the sealed status is read and the writer record is gone; fails_when=the second window keeps saying recording after the seal, or the seal leaves the record behind; why_new=the marker of F260 is removed at the seal; seam=none; no_claim=the seal's content (other tests)
test('a test history another window recorded is listed with its sealed status after the seal', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [whileLive] = await reading.list()

  // Act
  await writer.finish('partial', 'The learner stopped this run.')
  const [afterSeal] = await reading.list()
  const record = await stat(
    join(
      directory,
      NODE_TEST_HISTORY_DIRECTORY,
      header.studyId,
      NODE_TEST_HISTORY_WRITER_FILE,
    ),
  ).catch((error: NodeJS.ErrnoException) => error.code)

  // Assert
  assert.equal(whileLive?.status, 'recording')
  assert.equal(afterSeal?.status, 'partial')
  assert.equal(afterSeal?.reason, 'The learner stopped this run.')
  assert.equal(record, 'ENOENT')
})

// Value: protects=the cost of watching a history another window records: fifty refreshes read at most twice the final journal; fails_when=the second window reads the whole growing journal at every refresh; why_new=the incremental scan knew only a history of this window (F260, as F64); why_changed=F311: the count had no lower bound, so a store that read through a binding the counters miss read 0 bytes and passed; every appended byte is read at least once; seam=the bytes read through the file system are counted; no_claim=wall-clock time
test('fifty refreshes of a history another window records read at most twice its final journal size', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  let bytesRead = 0
  const openBefore = fsPromises.open
  const readFileBefore = fsPromises.readFile
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      const handle = await openBefore(...input)
      const readBefore = handle.read.bind(handle)
      handle.read = (async (...readInput: unknown[]) => {
        const result = await Reflect.apply(readBefore, handle, readInput)
        bytesRead += result.bytesRead
        return result
      }) as typeof handle.read
      return handle
    },
  )
  context.mock.method(
    fsPromises,
    'readFile',
    async (...input: Parameters<typeof readFileBefore>) => {
      const content = await readFileBefore(...input)
      bytesRead += content.length
      return content
    },
  )

  // Act
  for (let index = 1; index <= 50; index++) {
    await writer.appendOutput({
      sequence: index,
      elapsedMs: index,
      channel: 'stdout',
      text: `line ${index} ${'x'.repeat(900)}`,
    })
    await reading.list()
  }
  const journalBytes = (
    await stat(
      join(
        directory,
        NODE_TEST_HISTORY_DIRECTORY,
        header.studyId,
        'events.jsonl',
      ),
    )
  ).size
  const [summary] = await reading.list()

  // Assert
  assert.ok(journalBytes > 45_000, `journal is ${journalBytes} bytes`)
  assert.ok(
    bytesRead >= journalBytes,
    `read ${bytesRead} bytes, less than the journal of ${journalBytes}: the counters miss the store's reads`,
  )
  assert.ok(
    bytesRead <= 2 * journalBytes,
    `read ${bytesRead} bytes for a journal of ${journalBytes}`,
  )
  assert.equal(summary?.status, 'recording')
})

/** A second window whose judge of the writer counts its queries and whose clock the test moves. */
async function windowWithCountedJudge(context: TestContext) {
  const { writing, directory, workspaceKey } = await twoWindows(context)
  const clock = { nowMs: 1_000_000 }
  const judge = { queries: 0, live: true }
  const reading = new NodeTestHistoryStore(
    directory,
    workspaceKey,
    () => 64,
    async () => 0,
    {
      now: () => clock.nowMs,
      isLive: async () => {
        judge.queries += 1
        return judge.live
      },
    },
  )
  return { writing, reading, clock, judge, workspaceKey }
}

// Value: protects=the cost of watching another window's recording: the writer is judged (a process query) once per recheck interval, not at every 250 ms refresh; fails_when=each refresh asks the judge, so fifty refreshes make fifty queries; why_new=F260's first fix judged the writer at every refresh, spawning ps or PowerShell four times a second; seam=injected clock and judge; no_claim=the judge's own correctness
test('fifty refreshes of a history another window records query its writer at most once per recheck interval', async (context) => {
  // Arrange
  const { writing, reading, clock, judge, workspaceKey } =
    await windowWithCountedJudge(context)
  await writing.start(nodeTestHistoryHeader(workspaceKey))

  // Act
  for (let index = 0; index < 50; index++) {
    await reading.list()
    clock.nowMs += 250
  }

  // Assert
  assert.ok(judge.queries >= 1, `queries: ${judge.queries}`)
  assert.ok(judge.queries <= 4, `queries: ${judge.queries}`)
})

// Value: protects=a crash seen from another window within the recheck interval; fails_when=the kept "live" verdict is never rechecked, so a crashed writer reads recording for good; why_new=the verdict is now kept between refreshes (F260); seam=injected clock and judge; no_claim=the judge's own correctness
test('a writer that becomes gone is listed interrupted at the first refresh after the recheck interval', async (context) => {
  // Arrange
  const { writing, reading, clock, judge, workspaceKey } =
    await windowWithCountedJudge(context)
  await writing.start(nodeTestHistoryHeader(workspaceKey))
  const [whileLive] = await reading.list()
  judge.live = false
  clock.nowMs += 4_999
  const [insideInterval] = await reading.list()

  // Act
  clock.nowMs += 1
  const [afterInterval] = await reading.list()

  // Assert
  assert.equal(whileLive?.status, 'recording')
  assert.equal(insideInterval?.status, 'recording')
  assert.equal(afterInterval?.status, 'interrupted')
})

// Value: protects=a crash seen from another window although the clock was stepped backwards: a kept "live" verdict whose judging time lies in the future is rechecked, not trusted for the length of the step; fails_when=the negative difference passes as "inside the interval" and a crashed writer's history stays listed as recording until the clock catches up; why_new=F284: the recheck compared wall-clock times; seam=injected clock and judge; no_claim=the judge's own correctness
test('a writer that becomes gone is listed interrupted at the next refresh after the clock stepped backwards', async (context) => {
  // Arrange
  const { writing, reading, clock, judge, workspaceKey } =
    await windowWithCountedJudge(context)
  await writing.start(nodeTestHistoryHeader(workspaceKey))
  const [whileLive] = await reading.list()
  judge.live = false
  clock.nowMs -= 3_600_000

  // Act
  const [afterStep] = await reading.list()

  // Assert
  assert.equal(whileLive?.status, 'recording')
  assert.equal(afterStep?.status, 'interrupted')
})

/** The path of a history's writer record in a learning folder. */
function writerRecordPath(directory: string, studyId: string): string {
  return join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    studyId,
    NODE_TEST_HISTORY_WRITER_FILE,
  )
}

// Value: protects=a run the writing window gives up reads as interrupted in another window at once, although the giving-up window is still alive; fails_when=abandon() leaves the writer record, so the live window keeps the history listed as recording; why_new=the seal removes the record (tested) but abandon() is a separate path (F260); seam=none; no_claim=a record whose removal fails
test('a test history whose writer gave it up is listed interrupted in another window while the giving-up window lives', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [whileWriting] = await reading.list()

  // Act
  writer.abandon()
  await waitUntil(
    async () =>
      (await stat(writerRecordPath(directory, header.studyId)).catch(
        () => undefined,
      )) === undefined,
    'the writer record is removed',
    5_000,
  )
  const [afterAbandon] = await reading.list()

  // Assert
  assert.equal(whileWriting?.status, 'recording')
  assert.equal(afterAbandon?.status, 'interrupted')
})

// Value: protects=a history this window started never reads as recorded by another window because a writer record of this live process stands after the history closed; fails_when=startedHere is dropped, so a record left behind by a failed removal lists this window's own abandoned history as recording; why_new=only the other window's view was tested (F260); seam=none; no_claim=how the removal failed
test('a record left behind after a window gave up its own test history does not list it as recording in that window, only in another', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  writer.abandon()
  await waitUntil(
    async () =>
      (await stat(writerRecordPath(directory, header.studyId)).catch(
        () => undefined,
      )) === undefined,
    'the writer record is removed',
    5_000,
  )

  // Act
  await writeNodeTestWriterRecord(
    join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId),
  )
  const [inStartingWindow] = await writing.list()
  const [inOtherWindow] = await reading.list()

  // Assert
  assert.equal(inStartingWindow?.status, 'interrupted')
  assert.equal(inOtherWindow?.status, 'recording')
})

// Value: protects=a history with no writer record or one that cannot be read, such as a history of an earlier build or a damaged record, reads as interrupted in another window instead of recording for good; fails_when=a missing or unreadable record counts as a live writer; why_new=only a record naming a gone process was tested (F260); seam=none; no_claim=a record of another machine
test('a test history with a missing or an unreadable writer record is listed interrupted in another window', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [whileLive] = await reading.list()

  // Act
  await writeFile(writerRecordPath(directory, header.studyId), '{ not json')
  const [withUnreadableRecord] = await reading.list()
  await rm(writerRecordPath(directory, header.studyId))
  const [withoutRecord] = await reading.list()

  // Assert
  assert.equal(whileLive?.status, 'recording')
  assert.equal(withUnreadableRecord?.status, 'interrupted')
  assert.equal(withoutRecord?.status, 'interrupted')
})

// Value: protects=the writer record is a help, not a part of the history: a record the file system refuses leaves the start and the recording working, and another window reads the history as interrupted, as before the record existed; fails_when=the record's write failure escapes start, so a learner's test run fails because a help file could not be written; why_new=F309 (PR-2 coverage audit): only records that were written were tested (F260); seam=the file system's rename refuses the record's path; no_claim=which error a real file system gives
test('a writer record the file system refuses leaves the start recording here and the history interrupted in another window', async (context) => {
  // Arrange
  const { writing, reading, workspaceKey } = await twoWindows(context)
  const renameBefore = fsPromises.rename
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      if (String(input[1]).endsWith(NODE_TEST_HISTORY_WRITER_FILE))
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        })
      return renameBefore(...input)
    },
  )

  // Act
  const writer = await writing.start(nodeTestHistoryHeader(workspaceKey))
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [seenHere] = await writing.list()
  const [seenElsewhere] = await reading.list()

  // Assert
  assert.equal(seenHere?.status, 'recording')
  assert.equal(seenElsewhere?.status, 'interrupted')
})

// Value: protects=opening a test history that another live window records reads it as recording, and as interrupted once that writer is gone, as Saved studies lists it; fails_when=the open reads such a history as interrupted with "no verified final seal" while it is still being recorded (only this window's own recordings were read as recording), or keeps reading it as recording after its writer crashed; why_new=F334 (PR-2 /ship Step 9 pass 3 testing): F260's branch of read() had no test, as every other-window test went through list(); seam=none; no_claim=the Study workspace's own refresh of an opened recording
test('a test history another live window records opens as recording in a second window, and as interrupted once its writer is gone', async (context) => {
  // Arrange
  const { directory, writing, reading, workspaceKey } =
    await twoWindows(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await writing.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })

  // Act
  const whileLive = await reading.read(header.studyId)
  await markNodeTestWriterGone(directory, header.studyId)
  const afterCrash = await reading.read(header.studyId)

  // Assert
  assert.equal(whileLive.status, 'recording')
  assert.equal(afterCrash.status, 'interrupted')
  assert.equal(
    afterCrash.reason,
    'Node test history has no verified final seal.',
  )
})
