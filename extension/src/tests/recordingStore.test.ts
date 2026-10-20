import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fsPromises, {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { crc32 } from 'node:zlib'

import { LearningLibrary } from '../learningLibrary'
import type { RecordingBinding } from '../recordingSchemas'
import {
  RecordingStore,
  recordingDiskIo,
  type RecordingIo,
  type RecordingLimits,
} from '../recordingStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { useEditorMachineId } from '../utils/currentStorageOwner'
import { recordingOwnerRecordPath } from '../utils/recordingOwnerRecordPath'
import { systemTrashName } from '../utils/systemTrashName'

import { idleChild } from './utils/idleChild'
import { rewriteWriterRecord } from './utils/rewriteWriterRecord'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
  'base64',
)
const workspaceKey = sha256('recording-workspace')

/** Gives recording regressions private real files and explicit fault injection, without claiming browser/native capture. @example const { store, binding } = await recordingHarness(context) */
async function recordingHarness(
  context: TestContext,
  limits: Partial<RecordingLimits> = {},
  io: RecordingIo = recordingDiskIo,
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-recording-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const instanceId = randomUUID(),
    runId = randomUUID()
  const binding: RecordingBinding = {
    workspaceKey,
    studyId: `${instanceId}_${runId}`,
    instanceId,
    runId,
    runtimeId: randomUUID(),
    profile: 'repository-browser',
    sourceBuild: {
      revision: 'fixture-test',
      dirty: false,
      sourceHash: sha256('fixed-source'),
    },
  }
  return {
    directory,
    binding,
    store: new RecordingStore(directory, workspaceKey, limits, io),
  }
}

test('recording starts after concurrent learner storage finishes instead of losing the entire film to its own writer lock', async (context) => {
  // Arrange
  const { directory, store, binding } = await recordingHarness(context),
    library = new LearningLibrary(directory, workspaceKey)
  let release = (): void => {},
    entered = (): void => {}
  const held = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  const read = library.readProgress.bind(library)
  library.readProgress = async () => {
    const progress = await read()
    entered()
    await held
    return progress
  }
  const saving = library.select({
    profile: 'repository-browser',
    itemId: 'repository/interface/theme',
    tab: 'live',
    follow: false,
  })
  await started
  // Act: hold the real library lock while the independent recording owner attempts admission.
  const admission = store.start(binding, 0).then(
    (writer) => ({ writer }),
    (error) => ({ error }),
  )
  await delay(25)
  release()
  await saving
  const result = await admission
  // Assert
  assert.ok(
    'writer' in result,
    `Recording was lost: ${'error' in result ? result.error : ''}`,
  )
  assert.equal(
    result.writer.frame({ bytes: png, elapsedMs: 50, kind: 'stream' }),
    true,
  )
  await result.writer.finish(100)
  assert.equal((await store.read(binding.studyId)).status, 'finalized')
  assert.equal(
    (await library.readProgress()).selection?.itemId,
    'repository/interface/theme',
  )
})

test('recording is discoverable before its first frame and survives restart without a study archive', async (context) => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 10)
  // Act
  const initial = await store.list()
  assert.equal(
    writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }),
    true,
  )
  assert.equal(
    writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' }),
    true,
  )
  await writer.finish(120)
  const restarted = new RecordingStore(directory, workspaceKey),
    recording = await restarted.read(binding.studyId)
  // Assert
  assert.equal(initial.length, 1)
  assert.equal(initial[0]?.status, 'recording')
  assert.equal(recording.status, 'finalized')
  assert.equal(recording.endMs, 120)
  assert.equal(recording.header.clock, 'runtime-receipt-ms')
  assert.equal(recording.entries.length, 3)
  assert.deepEqual(
    recording.entries.map((entry) => entry.elapsedMs),
    [20, 70, 120],
  )
  assert.equal(
    (await readdir(store.path(binding.studyId))).filter((name) =>
      name.endsWith('.png'),
    ).length,
    1,
  )
  assert.equal(recording.seal?.pngBytes, 68)
  assert.deepEqual(await restarted.readFrame(binding.studyId, sha256(png)), png)
})

test('sampling preserves explicit phase frames and never upgrades stream pixels to a confirmed pause', async (context) => {
  // Arrange
  const { binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  // Act
  const admitted = [
    writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' }),
    writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }),
    writer.frame({
      bytes: png,
      elapsedMs: 21,
      kind: 'phase',
      phase: 'paused-browser',
    }),
  ]
  await writer.finish(30)
  const recording = await store.read(binding.studyId)
  // Assert
  assert.deepEqual(admitted, [true, false, true])
  assert.equal(recording.entries[0]?.type, 'frame')
  assert.equal('phase' in recording.entries[0], false)
  assert.equal(
    recording.entries[1]?.type === 'frame'
      ? recording.entries[1].phase
      : undefined,
    'paused-browser',
  )
  assert.equal(JSON.stringify(recording.entries).includes('confirmed'), false)
})

test('frame count exhaustion preserves readable frames and still seals the missing tail', async (context) => {
  // Arrange
  const { store, binding } = await recordingHarness(context, { frames: 1 }),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  // Act
  const rejected = writer.frame({ bytes: png, elapsedMs: 80, kind: 'stream' })
  const seal = await writer.finish(120),
    recording = await store.read(binding.studyId)
  // Assert
  assert.equal(rejected, false)
  assert.equal(seal.status, 'partial')
  assert.equal(seal.frameCount, 1)
  assert.deepEqual(
    recording.entries.map((entry) => entry.type),
    ['frame', 'gap', 'end'],
  )
  assert.equal(recording.entries[1]?.elapsedMs, 80)
  assert.equal(recording.endMs, 120)
  assert.equal(
    writer.frame({ bytes: png, elapsedMs: 130, kind: 'stream' }),
    false,
  )
})

test('journal capacity reserves terminal records even when frame metadata fills its admission budget', async (context) => {
  // Arrange
  const { binding, store } = await recordingHarness(context, {
      journalBytes: 16_634,
    }),
    writer = await store.start(binding, 0)
  // Act
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' })
  await writer.finish(100)
  const recording = await store.read(binding.studyId)
  // Assert
  assert.equal(recording.status, 'partial')
  assert.equal(recording.seal?.frameCount, 1)
  assert.equal(recording.entries.at(-1)?.type, 'end')
  assert.ok(recording.seal.journalBytes < 16_634)
})

test('pending binary capacity rejects excess work synchronously while the first write is delayed', async (context) => {
  // Arrange
  let release: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const { store, binding } = await recordingHarness(
    context,
    { pendingBytes: 350 },
    {
      ...recordingDiskIo,
      async binary(path, bytes) {
        if (path.endsWith('.png')) await blocked
        await recordingDiskIo.binary(path, bytes)
      },
    },
  )
  const writer = await store.start(binding, 0)
  // Act
  const first = writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  const second = writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' })
  const stateWhileBlocked = writer.state()
  release()
  await writer.finish(100)
  // Assert
  assert.equal(first, true)
  assert.equal(second, false)
  assert.equal(stateWhileBlocked.status, 'partial')
  assert.ok(stateWhileBlocked.pendingHighWaterBytes <= 350)
  assert.equal((await store.read(binding.studyId)).entries[0]?.type, 'frame')
})

test('a torn journal exposes only the verified prefix and never invents an end time after a dead owner', async (context) => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  await writer.flush()
  const header = await store.header(binding.studyId)
  await writeFile(
    join(store.path(binding.studyId), 'header.json'),
    JSON.stringify({
      ...header,
      owner: { ...header.owner, pid: 2_147_483_647 },
    }),
  )
  // The dead owner is named where a window of this build names its writer too: in the record beside the recordings.
  await rewriteWriterRecord(directory, binding.studyId, { pid: 2_147_483_647 })
  await appendFile(
    join(store.path(binding.studyId), 'frames.jsonl'),
    '{"type":"frame"',
  )
  // Act
  const recovered = await new RecordingStore(directory, workspaceKey).read(
    binding.studyId,
  )
  // Assert
  assert.equal(recovered.status, 'interrupted')
  assert.equal(recovered.entries.length, 1)
  assert.equal(recovered.lastVerifiedMs, 10)
  assert.equal(recovered.endMs, undefined)
  assert.match(recovered.reason ?? '', /end time unknown/)
})

// Value: protects=a recording whose writer still runs under another user is never offered as an interrupted one; fails_when=every failed probe of the owner counts as "gone" (Cycle 0044 rows SS-6 and ST-12); why_new=the owner tests used a process id that does not exist, which answers ESRCH; seam=the process probe
test('a recording whose owner process answers EPERM stays unfinalized, not interrupted', async (context) => {
  // Arrange: a flushed recording whose header names process 4242 of this machine, which this user may not signal.
  const { directory, binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  await writer.flush()
  const header = await store.header(binding.studyId)
  await writeFile(
    join(store.path(binding.studyId), 'header.json'),
    JSON.stringify({ ...header, owner: { ...header.owner, pid: 4242 } }),
  )
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
  })
  // Act
  const reopened = await new RecordingStore(directory, workspaceKey).read(
    binding.studyId,
  )
  // Assert
  assert.equal(reopened.status, 'unfinalized')
})

// Value: protects=the status another window shows for the recording of a crashed editor whose process id went to another process of this machine; fails_when=the writer is judged by its process id alone, so the recording stays "unfinalized" (its end unknown, as if still written) for as long as any process has that id; why_new=Cycle 0046 /ship review N1: the status used the rule R10 replaced for the library's judgement of a writer; seam=the header and the record of the writer (removed, as for a recording of 0.2.29.0, and then naming the later process), with a live child process of the test that began after the recording's creation time
test('a recording whose writer’s process id went to a process begun after the recording was created shows as interrupted to another window, with and without the record of its writer', async (context) => {
  // Arrange: two recordings created ten minutes ago by a window that crashed; a process that began just now has its id. The first has no record of its writer (a recording of 0.2.29.0); the second's record names that id with the start of the window that wrote it.
  const first = await recordingHarness(context),
    second = await recordingHarness(context)
  const laterProcess = await idleChild(context)
  const createdAt = new Date(Date.now() - 10 * 60_000).toISOString()
  for (const { store, binding } of [first, second]) {
    const writer = await store.start(binding, 0)
    writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
    await writer.flush()
    const header = await store.header(binding.studyId)
    await writeFile(
      join(store.path(binding.studyId), 'header.json'),
      JSON.stringify({
        ...header,
        owner: { ...header.owner, pid: laterProcess.pid! },
        createdAt,
      }),
    )
  }
  await rm(recordingOwnerRecordPath(first.directory, first.binding.studyId))
  // The record keeps the start of the window that wrote it, this test process's, which the later process does not have; it names the recording by its folder and its creation time.
  await rewriteWriterRecord(second.directory, second.binding.studyId, {
    pid: laterProcess.pid!,
    recording: { folder: 'recordings.v2', createdAt },
  })

  // Act
  const statuses = {
    withoutRecord: (
      await new RecordingStore(first.directory, workspaceKey).read(
        first.binding.studyId,
      )
    ).status,
    withRecord: (
      await new RecordingStore(second.directory, workspaceKey).read(
        second.binding.studyId,
      )
    ).status,
  }

  // Assert
  assert.deepEqual(statuses, {
    withoutRecord: 'interrupted',
    withRecord: 'interrupted',
  })
})

// Value: protects=the status another window shows for the recording of a crashed editor on a computer whose host name changed since (macOS names itself after the network); fails_when=the writer is judged by the host name in the header, which is no longer this machine's, so the recording stays "unfinalized" for good; why_new=Cycle 0046 /ship review N1; seam=the header and the record of the writer, which name the old host name and a process id of no process, with this editor's machine id in the record
test('a recording whose writer’s host name has changed since shows as interrupted to another window once the record of its writer names a process of this machine that is gone', async (context) => {
  // Arrange
  useEditorMachineId('machine-a', undefined)
  context.after(() => useEditorMachineId(undefined, undefined))
  const { directory, binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  await writer.flush()
  const header = await store.header(binding.studyId)
  await writeFile(
    join(store.path(binding.studyId), 'header.json'),
    JSON.stringify({
      ...header,
      owner: {
        ...header.owner,
        pid: 2_147_483_647,
        hostname: 'laptop.home-network',
      },
    }),
  )
  await rewriteWriterRecord(directory, binding.studyId, {
    pid: 2_147_483_647,
    hostname: 'laptop.home-network',
  })

  // Act
  const listed = await new RecordingStore(directory, workspaceKey).list()

  // Assert
  assert.deepEqual(
    listed.map((entry) => ({ studyId: entry.studyId, status: entry.status })),
    [{ studyId: binding.studyId, status: 'interrupted' }],
  )
})

test('a failed final seal never advertises a completed recording even when the terminal journal record exists', async (context) => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(
    context,
    {},
    {
      ...recordingDiskIo,
      async json(path, value, limit) {
        if (path.endsWith('sealed.json'))
          throw new Error('injected final storage failure')
        await recordingDiskIo.json(path, value, limit)
      },
    },
  )
  const writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  // Act / Assert
  await assert.rejects(writer.finish(100), /injected final storage failure/)
  const reopened = await new RecordingStore(directory, workspaceKey).read(
    binding.studyId,
  )
  assert.equal(reopened.status, 'unfinalized')
  assert.equal(reopened.endMs, undefined)
  assert.equal(reopened.entries.at(-1)?.type, 'end')
  assert.equal(writer.state().status, 'partial')
})

test('a failed blob write cannot publish its frame metadata or certify finalization', async (context) => {
  // Arrange
  const { binding, store } = await recordingHarness(
    context,
    {},
    {
      ...recordingDiskIo,
      async binary(path, bytes) {
        if (path.endsWith('.png')) throw new Error('injected blob failure')
        await recordingDiskIo.binary(path, bytes)
      },
    },
  )
  const writer = await store.start(binding, 0)
  // Act
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  // Assert
  await assert.rejects(writer.finish(100), /end time unknown/)
  assert.equal(
    await readFile(join(store.path(binding.studyId), 'frames.jsonl'), 'utf8'),
    '',
  )
  assert.equal((await store.read(binding.studyId)).endMs, undefined)
})

test('sealed journal edits and altered PNG bytes fail instead of showing another frame', async (context) => {
  // Arrange
  const { store, binding } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  await writer.finish(100)
  const journalPath = join(store.path(binding.studyId), 'frames.jsonl'),
    original = await readFile(journalPath)
  // Act / Assert
  await appendFile(journalPath, ' ')
  await assert.rejects(store.read(binding.studyId), /journal is corrupt/)
  await writeFile(journalPath, original)
  await writeFile(
    join(store.path(binding.studyId), `${sha256(png)}.png`),
    Buffer.from('changed'),
  )
  await assert.rejects(store.read(binding.studyId), /hash mismatch/)
})

test('orphan blobs count against storage and nonregular frame files cannot follow external paths', async (context) => {
  // Arrange
  const { store, binding, directory } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' })
  await writer.finish(100)
  const orphanPath = join(
      store.path(binding.studyId),
      `${sha256('orphan')}.png`,
    ),
    orphan = await open(orphanPath, 'wx')
  await orphan.truncate(536_870_912)
  await orphan.close()
  // Act / Assert
  await assert.rejects(store.read(binding.studyId), /including orphan/)
  await rm(orphanPath)
  const framePath = join(store.path(binding.studyId), `${sha256(png)}.png`),
    external = join(directory, 'outside.png')
  await writeFile(external, png)
  await rm(framePath)
  await symlink(external, framePath)
  await assert.rejects(
    store.readFrame(binding.studyId, sha256(png)),
    /regular file/,
  )
})

test('simultaneous editor reservations cannot overfill a one-slot recording library', async (context) => {
  // Arrange
  const { directory, store, binding } = await recordingHarness(context, {
    slots: 1,
  })
  const second = new RecordingStore(directory, workspaceKey, { slots: 1 }),
    runId = randomUUID()
  // Act
  const results = await Promise.allSettled([
    store.start(binding, 0),
    second.start(
      { ...binding, runId, studyId: `${binding.instanceId}_${runId}` },
      0,
    ),
  ])
  // Assert
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  )
  assert.equal((await store.list()).length, 1)
})

// Value: protects=a learner whose editor could not move a saved study to the Trash is not told to delete one when a recording is refused; fails_when=the store words its refusal without asking whether a removal can work in this window (B-M3, C-L3); why_new=only the run refusal read the removal availability; seam=the store's reader of the removal availability
test('a recording refused by a full library names no delete remedy after this editor’s Trash refused a removal', async (context) => {
  // Arrange: a recording library full at one recording, in a window whose last removal left its study in the library.
  const { directory, binding } = await recordingHarness(context)
  const store = new RecordingStore(
      directory,
      workspaceKey,
      {},
      undefined,
      () => 1,
      () => 'trash-refused',
    ),
    runId = randomUUID()
  await store.start(binding, 0)
  // Act
  const reservation = store.start(
    { ...binding, runId, studyId: `${binding.instanceId}_${runId}` },
    0,
  )
  // Assert
  await assert.rejects(reservation, {
    message: `Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another session; this editor could not move a saved study to the ${systemTrashName()} in this session. Existing recordings were kept.`,
  })
})

// Value: protects=the place of the saved study limit that a recording start takes only when it starts; fails_when=a start that fails after it made the recording's folder (its header or its empty journal cannot be written, a full disk) leaves the folder: a folder with this window's header is the reservation of a run of this machine, which no list shows and no removal deletes, and it takes a place of the limit until the editor ends (row 86's rule; row 95 fixed it for the Node test history only); why_new=Cycle 0047 row 35 (P3RT13); seam=the store's disk operations, whose header write and journal creation fail once each; no_claim=a crash between the folder and its header, which leaves an interrupted reservation (the next test)
test('a recording start that fails after making its folder leaves no folder behind, and the next start under a limit of one is admitted', async (context) => {
  // Arrange: the first start cannot write its header, the second cannot create its journal.
  let failing: 'header' | 'journal' | undefined = 'header'
  const { directory, binding, store } = await recordingHarness(
    context,
    { slots: 1 },
    {
      ...recordingDiskIo,
      async json(path, value, limit) {
        if (failing === 'header' && path.endsWith('header.json'))
          throw new Error('ENOSPC: no space left on device, write')
        await recordingDiskIo.json(path, value, limit)
      },
      async binary(path, bytes) {
        if (failing === 'journal' && path.endsWith('frames.jsonl'))
          throw new Error('ENOSPC: no space left on device, open')
        await recordingDiskIo.binary(path, bytes)
      },
    },
  )
  const studyIdOf = (runId: string): string => `${binding.instanceId}_${runId}`
  const journalRunId = randomUUID(),
    admittedRunId = randomUUID()

  // Act
  const headerFailure = await store.start(binding, 0).then(
    () => 'started',
    (error: unknown) => String(error),
  )
  const leftAfterHeaderFailure = await readdir(store.directory)
  failing = 'journal'
  const journalFailure = await store
    .start(
      { ...binding, runId: journalRunId, studyId: studyIdOf(journalRunId) },
      0,
    )
    .then(
      () => 'started',
      (error: unknown) => String(error),
    )
  const leftAfterJournalFailure = await readdir(store.directory)
  failing = undefined
  const admitted = await new RecordingStore(directory, workspaceKey, {
    slots: 1,
  })
    .start(
      { ...binding, runId: admittedRunId, studyId: studyIdOf(admittedRunId) },
      0,
    )
    .then(
      async (writer) => {
        await writer.finish(1)
        return 'started'
      },
      (error: unknown) => String(error),
    )

  // Assert
  assert.deepEqual(
    {
      headerFailure,
      leftAfterHeaderFailure,
      journalFailure,
      leftAfterJournalFailure,
      admitted,
      listed: (await store.list()).map((entry) => entry.studyId),
    },
    {
      headerFailure: 'Error: ENOSPC: no space left on device, write',
      leftAfterHeaderFailure: [],
      journalFailure: 'Error: ENOSPC: no space left on device, open',
      leftAfterJournalFailure: [],
      admitted: 'started',
      listed: [studyIdOf(admittedRunId)],
    },
  )
})

// Value: protects=a recording start whose write under the storage lock succeeded while the release of the lock fails at each of its attempts (a scanner or an indexer holds writer.lock on Windows): the run records, and the lock it left is taken back by this window's next write (row 199); fails_when=the release's failure fails the start, so the run goes on without its recording while the folder and the writer record it made stay this window's reservation, which no list shows and no removal deletes, and which takes a place of the saved study limit until the editor closes; why_new=Cycle 0047 row 240 (P2CLA-12): the release's failure failed every write that succeeded; seam=node:fs/promises unlink, which refuses to remove writer.lock while the test blocks it; no_claim=a real scanner on Windows
test('a recording start whose storage lock cannot be released after it made the recording still starts, and the next start takes the lock back', async (context) => {
  // Arrange: a library with room for two recordings; the removal of writer.lock is refused during the first start.
  const { directory, binding, store } = await recordingHarness(context, {
    slots: 2,
  })
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'writer.lock')
  const unlinkBefore = fsPromises.unlink
  const blockedRelease = context.mock.method(
    fsPromises,
    'unlink',
    async (...input: Parameters<typeof unlinkBefore>) => {
      if (input[0] === lockPath)
        throw Object.assign(
          new Error(`EPERM: operation not permitted, unlink '${lockPath}'`),
          { code: 'EPERM' },
        )
      return unlinkBefore(...input)
    },
  )
  const secondRunId = randomUUID()
  const secondStudyId = `${binding.instanceId}_${secondRunId}`

  // Act
  const firstStart = await store.start(binding, 10).then(
    async (writer) => {
      writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
      await writer.finish(120)
      return 'started and sealed'
    },
    (error: unknown) => String(error),
  )
  const lockLeftByTheFirstStart = await readFile(lockPath).then(
    () => true,
    () => false,
  )
  blockedRelease.mock.restore()
  const secondStart = await store
    .start({ ...binding, runId: secondRunId, studyId: secondStudyId }, 10)
    .then(
      async (writer) => {
        writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
        await writer.finish(120)
        return 'started and sealed'
      },
      (error: unknown) => String(error),
    )

  // Assert
  assert.deepEqual(
    {
      firstStart,
      lockLeftByTheFirstStart,
      secondStart,
      lockLeftAtTheEnd: await readFile(lockPath).then(
        () => true,
        () => false,
      ),
      listed: (await store.list())
        .map((entry) => ({ studyId: entry.studyId, status: entry.status }))
        .sort((left, right) => left.studyId.localeCompare(right.studyId)),
    },
    {
      firstStart: 'started and sealed',
      lockLeftByTheFirstStart: true,
      secondStart: 'started and sealed',
      lockLeftAtTheEnd: false,
      listed: [
        { studyId: binding.studyId, status: 'finalized' },
        { studyId: secondStudyId, status: 'finalized' },
      ].sort((left, right) => left.studyId.localeCompare(right.studyId)),
    },
  )
})

test('interrupted reservations count against capacity and legacy learner bytes remain untouched', async (context) => {
  // Arrange: the folder a start made before its editor ended, without a header (since Cycle 0047 row 35 a start that fails while the editor runs removes its folder, so the crash's folder is made here).
  const { directory, binding, store } = await recordingHarness(context, {
    slots: 1,
  })
  await writeFile(
    join(directory, 'progress.v2.json'),
    'existing learner choices',
  )
  await mkdir(store.path(binding.studyId), { recursive: true })
  const newRunId = randomUUID(),
    fresh = new RecordingStore(directory, workspaceKey, { slots: 1 })
  // Act / Assert
  await assert.rejects(
    fresh.start(
      {
        ...binding,
        runId: newRunId,
        studyId: `${binding.instanceId}_${newRunId}`,
      },
      0,
    ),
    /full/,
  )
  assert.equal((await fresh.list())[0]?.status, 'partial')
  assert.equal(
    await readFile(join(directory, 'progress.v2.json'), 'utf8'),
    'existing learner choices',
  )
})

test('foreign identities and impossible PNG dimensions stop capture without enlarging storage bounds', async (context) => {
  // Arrange
  const { binding, store } = await recordingHarness(context),
    writer = await store.start(binding, 0),
    oversized = Buffer.from(png)
  oversized.writeUInt32BE(4_097, 16)
  // Act / Assert
  assert.equal(
    writer.frame({ bytes: oversized, elapsedMs: 10, kind: 'stream' }),
    false,
  )
  assert.equal((await writer.finish(20)).status, 'partial')
  await assert.rejects(
    store.start({ ...binding, workspaceKey: sha256('another') }, 0),
    /another workspace/,
  )
  assert.throws(() => store.path('../other'), /Invalid/)
  assert.throws(
    () => new RecordingStore('/unused', workspaceKey, { slots: 257 }),
    /Invalid recording limit/,
  )
})

test('a study without a recording offers history recovery without exposing a filesystem error', async (context) => {
  // Arrange
  const { store, binding } = await recordingHarness(context)
  // Act / Assert
  await assert.rejects(
    store.read(binding.studyId),
    /No saved recording is available for this study/,
  )
})

test('ten minutes of animated application frames retain every sampled moment within bounded pending memory', async (context) => {
  // Arrange: valid PNG text chunks make distinct 33 KB inert frames; binary/append I/O is counted, not native capture.
  let writtenBytes = 0,
    appendedBytes = 0
  const { store, binding } = await recordingHarness(
    context,
    {},
    {
      ...recordingDiskIo,
      async binary(_path, bytes) {
        writtenBytes += bytes.byteLength
      },
      async append(_path, line) {
        appendedBytes += Buffer.byteLength(line)
      },
    },
  )
  const writer = await store.start(binding, 0)
  // Act: preserve the production 50 ms sampling rate through the full supported run wall time.
  for (let index = 0; index < 12_000; index++) {
    const chunk = Buffer.alloc(32_932, 32)
    chunk.writeUInt32BE(32_920, 0)
    chunk.write('tEXt', 4)
    chunk.write(`Frame\0${index}`, 8)
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
    const bytes = Buffer.concat([
      png.subarray(0, -12),
      chunk,
      png.subarray(-12),
    ])
    assert.equal(bytes.length, 33_000)
    assert.equal(
      writer.frame({ bytes, elapsedMs: (index + 1) * 50, kind: 'stream' }),
      true,
      `Frame ${index + 1} lost: ${writer.state().reason}`,
    )
    // Flush batches below the unchanged pending-byte budget, without buffering the whole film.
    if ((index + 1) % 100 === 0) await writer.flush()
  }
  const seal = await writer.finish(600_000)
  // Assert
  assert.equal(seal.status, 'complete')
  assert.equal(seal.frameCount, 12_000)
  assert.equal(seal.pngBytes, 396_000_000)
  assert.equal(writtenBytes, 396_000_000)
  assert.equal(seal.endMs, 600_000)
  assert.equal(seal.journalBytes, appendedBytes)
  assert.ok(writer.state().pendingHighWaterBytes <= 8_388_608)
  assert.equal(writer.state().pendingBytes, 0)
})

// Value: protects=a window that records and deletes studies for hours keeps no writer, journal or frame-hash set of a recording that is sealed or removed; fails_when=the store keeps the writer of every run started in the window (0038-F15, 0039-ER-b); why_new=the store never dropped a writer; seam=none
test('the store keeps a recording’s writer only while it is being written: sealing it or removing its study releases the writer, and the sealed recording still lists as finalized', async (context) => {
  // Arrange: one recording that is sealed, and one that is still being written when its study is removed.
  const sealed = await recordingHarness(context),
    removed = await recordingHarness(context)
  const sealedWriter = await sealed.store.start(sealed.binding, 10)
  sealedWriter.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
  await removed.store.start(removed.binding, 10)
  const keptWhileWriting = [
    sealed.store['active'].size,
    removed.store['active'].size,
  ]
  // Act
  await sealedWriter.finish(120)
  removed.store.release(removed.binding.studyId)
  // Assert
  assert.deepEqual(keptWhileWriting, [1, 1])
  assert.equal(sealed.store['active'].size, 0)
  assert.equal(removed.store['active'].size, 0)
  assert.deepEqual(
    (await sealed.store.list()).map((entry) => [entry.studyId, entry.status]),
    [[sealed.binding.studyId, 'finalized']],
  )
})

// Value: protects=the load phase of a Recording press on a paused live run's own recording (0035-O01); fails_when=opening an in-progress recording reads and hashes again every frame this session's writer just wrote, so the load grows by about 0.6 ms a frame (1.0 s at 130 s of film); why_new=native run of 2026-10-04 measured 1.2 s at 94 s and 1.5 to 1.6 s at 130 s; seam=RecordingStore.readFrame
test('an in-progress recording of this session opens without reading back the frames its own writer wrote', async (context) => {
  // Arrange
  const { store, binding } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({
    bytes: png,
    elapsedMs: 0,
    kind: 'phase',
    phase: 'paused-browser',
  })
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'stream' })
  await writer.flush()
  const readFrame = context.mock.method(store, 'readFrame')

  // Act
  const index = await store.read(binding.studyId)

  // Assert
  assert.equal(readFrame.mock.callCount(), 0)
  assert.equal(index.status, 'recording')
  assert.deepEqual(
    index.entries.map((entry) => [entry.type, entry.elapsedMs]),
    [
      ['frame', 0],
      ['frame', 100],
    ],
  )
  assert.equal(index.lastVerifiedMs, 100)
})

// Value: protects=an in-progress recording is offered for replay only as far as its frames are still on disk; fails_when=what the writer measured when it wrote a frame stands for that frame after its file was deleted, so the read counts the moment as verified (X7-B.5); why_new=the own-writer shortcut was only tested with every frame in place; seam=the recording directory, from which the test removes one frame file
test('an in-progress recording whose frame file was deleted after its write is read only up to the frame before it', async (context) => {
  // Arrange: this session's writer wrote one frame; its file is deleted afterwards.
  const { store, binding } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({
    bytes: png,
    elapsedMs: 50,
    kind: 'phase',
    phase: 'paused-browser',
  })
  await writer.flush()
  await rm(join(store.path(binding.studyId), `${sha256(png)}.png`))

  // Act
  const index = await store.read(binding.studyId)

  // Assert
  assert.deepEqual(index.entries, [])
  assert.equal(index.lastVerifiedMs, 0)
  assert.equal(
    index.reason?.startsWith(
      'Interrupted recording after verified prefix: Error: ENOENT',
    ),
    true,
  )
})

// Value: protects=the verified prefix of a recording another session left behind; fails_when=the frames of a recording this session did not write are trusted without their bytes being read; why_new=control for the own-writer shortcut of 0035-O01; seam=RecordingStore.readFrame
test('a recording an earlier session left unfinished still has every frame read and hashed when it opens', async (context) => {
  // Arrange
  const { directory, store, binding } = await recordingHarness(context),
    writer = await store.start(binding, 0)
  writer.frame({
    bytes: png,
    elapsedMs: 0,
    kind: 'phase',
    phase: 'paused-browser',
  })
  await writer.flush()
  const laterSession = new RecordingStore(directory, workspaceKey)
  const readFrame = context.mock.method(laterSession, 'readFrame')

  // Act
  const index = await laterSession.read(binding.studyId)

  // Assert
  assert.equal(readFrame.mock.callCount(), 1)
  assert.equal(index.entries.length, 1)
})

// Value: protects=a folder in a recording root whose name is no study id leaves recordings startable and listable (Cycle 0046 row 47); fails_when=the root's folder names are parsed as study ids, which throws and breaks the recording start's admission and the recording list together; why_new=every recording test named its folders after study ids; seam=the recording root, into which the test puts the stray folder
test('a stray folder x in the recording root leaves a recording startable and the recordings listed', async (context) => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context)
  await mkdir(join(directory, 'recordings.v2', 'x'), { recursive: true })
  // Act
  const start = await store.start(binding, 10).then(
    async (writer) => {
      await writer.finish(20)
      return 'started'
    },
    (error: unknown) => String(error),
  )
  const listed = await store.list().then(
    (recordings) => recordings.map((recording) => recording.studyId),
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(start, 'started')
  assert.deepEqual(listed, [binding.studyId])
  assert.deepEqual(
    (await readdir(join(directory, 'recordings.v2'))).sort(),
    [binding.studyId, 'x'].sort(),
  )
})

// Value: protects=a file in a recording root leaves recordings startable and listable, as a stray folder does (Cycle 0046 row 93); fails_when=an entry of the root that is no folder is refused for the whole root, so every run records "Recording unavailable before input" and no recording is listed, for example after the learner opened the folder in Finder, which writes a .DS_Store; why_new=row 47 put a stray folder into the root, no test a file or a link; seam=the recording root, into which the test puts the file and the link
test('a stray .DS_Store file and a link in the recording root leave a recording startable and the recordings listed, and both stay where they are', async (context) => {
  // Arrange: the file Finder writes, and a link named like a study id that points outside the root.
  const { directory, binding, store } = await recordingHarness(context)
  const root = join(directory, 'recordings.v2'),
    outside = join(directory, 'outside'),
    linkedStudyId = `${randomUUID()}_${randomUUID()}`
  await mkdir(root, { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, '.DS_Store'), 'Bud1')
  await symlink(outside, join(root, linkedStudyId))
  // Act
  const start = await store.start(binding, 10).then(
    async (writer) => {
      await writer.finish(20)
      return 'started'
    },
    (error: unknown) => String(error),
  )
  const listed = await store.list().then(
    (recordings) => recordings.map((recording) => recording.studyId),
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(start, 'started')
  assert.deepEqual(listed, [binding.studyId])
  assert.deepEqual(
    (await readdir(root)).sort(),
    ['.DS_Store', binding.studyId, linkedStudyId].sort(),
  )
  assert.equal(await readFile(join(root, '.DS_Store'), 'utf8'), 'Bud1')
  assert.deepEqual(await readdir(outside), [])
})

// Value: protects=a learner who keeps a folder of Codebook's recordings elsewhere behind a link (a larger disk), and the agent that reads the library; fails_when=every recording, every replay and the library's listing end with "Recording root is not a regular directory.", which names no path, while the folder lies in the editor's storage where nobody finds it, and the pane's own step (Retry storage) reads the same link again; or a step the sentence names does not end in a listing; why_new=Cycle 0046 row 311: the three places that refuse a recording root name its path and what to do; seam=none, the real links (junctions on Windows, which every user may create)
test('a link where a folder of the recordings should be is refused by the listing and by a reading with the folder’s path, what stands there and what to do, at each of the three places that look at a root: after the learner puts the folder in the link’s place, or removes the link, the listing answers and a reading says that no recording is saved', async (context) => {
  // Arrange: three stores. In the first the root a listing creates is a link, in the second another root a listing looks at, in the third the first root a reading looks at.
  const created = await recordingHarness(context),
    lookedAt = await recordingHarness(context),
    read = await recordingHarness(context)
  const linkAtTheCreatedRoot = join(created.directory, 'recordings.v2'),
    linkAtAnotherRoot = join(lookedAt.directory, 'recordings.v1'),
    linkAtTheReadRoot = join(read.directory, 'recordings.v3')
  for (const [directory, link] of [
    [created.directory, linkAtTheCreatedRoot],
    [lookedAt.directory, linkAtAnotherRoot],
    [read.directory, linkAtTheReadRoot],
  ] as const) {
    await mkdir(join(directory, 'kept-elsewhere'), { recursive: true })
    await symlink(join(directory, 'kept-elsewhere'), link, 'junction')
  }
  const answerOf = (calling: Promise<unknown>): Promise<string> =>
    calling.then(
      (answer) => JSON.stringify(answer),
      (error: Error) => error.message,
    )

  // Act
  const refusals = {
    createdRoot: await answerOf(created.store.list()),
    anotherRoot: await answerOf(lookedAt.store.list()),
    readRoot: await answerOf(read.store.read(read.binding.studyId)),
  }
  // The sentences are followed to the letter: the folder takes the link's place, or the link is removed.
  await rm(linkAtTheCreatedRoot)
  await rename(join(created.directory, 'kept-elsewhere'), linkAtTheCreatedRoot)
  await rm(linkAtAnotherRoot)
  await rm(linkAtTheReadRoot)
  const afterwards = {
    createdRoot: await answerOf(created.store.list()),
    anotherRoot: await answerOf(lookedAt.store.list()),
    readRoot: await answerOf(read.store.read(read.binding.studyId)),
  }

  // Assert
  assert.deepEqual(
    { refusals, afterwards },
    {
      refusals: {
        createdRoot: `Recording root is not a regular directory: ${linkAtTheCreatedRoot}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
        anotherRoot: `Recording root is not a regular directory: ${linkAtAnotherRoot}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
        readRoot: `Recording root is not a regular directory: ${linkAtTheReadRoot}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
      },
      afterwards: {
        createdRoot: '[]',
        anotherRoot: '[]',
        readRoot:
          'No saved recording is available for this study. Open its available study history or select another recording.',
      },
    },
  )
})
