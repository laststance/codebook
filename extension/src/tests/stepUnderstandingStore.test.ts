import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fsPromises, {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { STEP_UNDERSTANDING_NODE_FILE } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  stepUnderstandingFileSchema,
  type StepUnderstandingDecision,
} from '../stepUnderstandingSchemas'
import type { StudyArchive } from '../studyModel'
import { StepUnderstandingSessions } from '../studyWorkspace/stepUnderstandingSessions'
import { holdsLearnerFiles } from '../utils/holdsLearnerFiles'
import { hashSteps } from '../utils/stepUnderstanding'
import { readStepUnderstandingFile } from '../utils/stepUnderstandingFile'
import { StorageLockHeldError } from '../utils/storageLockHeldError'
import { withStorageLock } from '../utils/withStorageLock'

import { EXTENSION_WORKSPACE_KEY } from './utils/chromeExtensionHistoryFixture'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { removeTestFolder } from './utils/removeTestFolder'
import {
  writeExtensionHistory,
  type ExtensionScriptStep,
} from './utils/sealedExtensionHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const HASH_ONE = '1'.repeat(64)
const HASH_TWO = '2'.repeat(64)
const STEPS = [
  { stepId: 'step-one', stepHash: HASH_ONE },
  { stepId: 'step-two', stepHash: HASH_TWO },
]
const SCRIPT: ExtensionScriptStep[] = [
  { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 101, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 200, type: 'close', pauseId: 'p1' },
  { at: 300, type: 'result' },
]
const BROWSER_WORKSPACE_KEY = sha256('step-understanding-browser-workspace')

function decisionFor(
  stepId: string,
  stepHash: string,
  understood = true,
): StepUnderstandingDecision {
  return { stepId, stepHash, understood, at: new Date().toISOString() }
}

/** The two operations under test, as both replay families offer them, on one saved replay. */
type StepStore = {
  read(): Promise<unknown>
  save(change: StepUnderstandingDecision, limitBytes?: number): Promise<unknown>
}

/** A saved replay of one family with everything a store test needs to look at and to disturb. */
type SavedReplay = {
  family: 'extension replay' | 'browser recording'
  studyId: string
  /** The step-understanding file of the replay. */
  filePath: string
  /** The folder whose `writer.lock` the family's writers take. */
  lockDirectory: string
  store: StepStore
  /** A second store instance on the same folders, as another editor window has. */
  otherWindow(): Promise<StepStore>
  /** Removes the replay the way the family's removal does, completing before it returns. */
  remove(): Promise<void>
  /** Removes the replay's folder or archive by file system, for a removal that happens while a write waits for the lock. */
  removeByFileSystem(): Promise<void>
  /** The refusal text the family's store gives a write for a replay that is gone. */
  removedRefusal: RegExp
  /** Paths of the replay that must never be recreated once it is removed. */
  mustStayAbsent: string[]
}

async function openExtensionReplay(context: TestContext): Promise<SavedReplay> {
  const { repository, learningDirectory } = await openServerRepository(
    context,
    { workspaceKey: EXTENSION_WORKSPACE_KEY },
  )
  const history = await writeExtensionHistory(
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    SCRIPT,
  )
  const studyId = history.studyId
  const storeOf = (source: typeof repository): StepStore => ({
    read: () => source.extensionHistories.readStepUnderstanding(studyId),
    save: (change, limitBytes) =>
      source.extensionHistories.saveStepUnderstanding(
        studyId,
        change,
        STEPS,
        limitBytes,
      ),
  })
  const folder = repository.extensionHistories.historyDirectory(studyId)
  return {
    family: 'extension replay',
    studyId,
    filePath: join(folder, STEP_UNDERSTANDING_NODE_FILE),
    lockDirectory: learningDirectory,
    store: storeOf(repository),
    otherWindow: async () =>
      storeOf(
        (
          await openServerRepository(context, {
            workspaceKey: EXTENSION_WORKSPACE_KEY,
            learningDirectory,
          })
        ).repository,
      ),
    remove: async (): Promise<void> => {
      const removal = await repository.extensionHistories.removeHistory(
        studyId,
        () => false,
      )
      assert.equal(removal.outcome, 'removed')
    },
    removeByFileSystem: (): Promise<void> =>
      rename(folder, join(learningDirectory, `removed-${randomUUID()}`)),
    removedRefusal: /No Node history has this study id/,
    mustStayAbsent: [folder],
  }
}

/** A saved browser study as the library tests build one: a configured study under a captured id. */
function capturedStudy(): StudyArchive {
  const instanceId = randomUUID()
  const runId = randomUUID()
  const study = createConfiguredStudy('const nextTheme = "dark";\n')
  return {
    ...study,
    workspaceKey: BROWSER_WORKSPACE_KEY,
    id: `${instanceId}_${runId}`,
    instanceId,
    runId,
    terminal: false,
    finalOutcome: 'pending-teardown',
    observations: study.observations.map((observation) => ({
      ...observation,
      interpretations: [],
      snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/${encodeURIComponent(observation.id)}`,
    })),
  }
}

async function openBrowserReplay(context: TestContext): Promise<SavedReplay> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-step-store-'))
  context.after(() => removeTestFolder(directory))
  const library = new LearningLibrary(directory, BROWSER_WORKSPACE_KEY)
  const study = capturedStudy()
  await library.saveStudy(study)
  const storeOf = (source: LearningLibrary): StepStore => ({
    read: () => source.readStepUnderstanding(study.id),
    save: (change, limitBytes) =>
      source.saveStepUnderstanding(study.id, change, STEPS, limitBytes),
  })
  const archive = join(directory, `${study.id}.study.v3.json`)
  const filePath = join(directory, `${study.id}.steps.v1.json`)
  return {
    family: 'browser recording',
    studyId: study.id,
    filePath,
    lockDirectory: directory,
    store: storeOf(library),
    otherWindow: async () =>
      storeOf(new LearningLibrary(directory, BROWSER_WORKSPACE_KEY)),
    remove: async (): Promise<void> => {
      const removal = await library.removeStudy(study.id, (path) =>
        // not cleanup: the injected remover stands in for the Trash
        rm(path, { recursive: true }),
      )
      assert.deepEqual(removal, { outcome: 'moved' })
    },
    removeByFileSystem: async (): Promise<void> => {
      // not cleanup: the archive and its catalog sidecar leave the library while the write waits
      await rm(archive)
      await rm(join(directory, `${study.id}.study.meta.v3.json`))
    },
    removedRefusal: /Study archive is unavailable/,
    mustStayAbsent: [filePath],
  }
}

const families = [
  { name: 'extension replay', open: openExtensionReplay },
  { name: 'browser recording', open: openBrowserReplay },
]

for (const family of families) {
  // Value: protects=a learner's step decision landing in the replay's own file and reading back; fails_when=the decision goes to another file, does not parse against the file schema, or is lost on a fresh store; no_claim=the Study pane's drawing of it
  test(`${family.name}: a saved step decision lands in the replay's step file and reads back through the schema`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    const change = decisionFor('step-one', HASH_ONE)

    // Act
    const before = await replay.store.read()
    await replay.store.save(change)
    const fresh = await (await replay.otherWindow()).read()

    // Assert
    assert.equal(before, undefined)
    const onDisk = stepUnderstandingFileSchema.parse(
      JSON.parse(await readFile(replay.filePath, 'utf8')),
    )
    assert.equal(onDisk.studyId, replay.studyId)
    assert.deepEqual(onDisk.decisions, [change])
    assert.deepEqual(fresh, onDisk)
  })

  // Value: protects=two windows pressing different steps in the same turn both keeping their decision; fails_when=the second read-modify-write starts before the first has written and one decision is lost (red check: the same test with the write's lock call removed from the store loses one decision); no_claim=writers in separate processes (the lock file they share is the same one the foreign-lock test places)
  test(`${family.name}: two windows saving different steps in one turn keep both decisions`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    const otherWindow = await replay.otherWindow()
    const first = decisionFor('step-one', HASH_ONE)
    const second = decisionFor('step-two', HASH_TWO)

    // Act: both read-modify-writes are issued before either has finished.
    await Promise.all([replay.store.save(first), otherWindow.save(second)])

    // Assert
    const onDisk = stepUnderstandingFileSchema.parse(
      JSON.parse(await readFile(replay.filePath, 'utf8')),
    )
    assert.deepEqual(onDisk.decisions.map((value) => value.stepId).sort(), [
      'step-one',
      'step-two',
    ])
  })

  // Value: protects=a saved step decision coming back with its check, its time and the progress count after a window reload; fails_when=a fresh store and session on the stored files show the step unchecked, without its time or without the count; no_claim=a real window reload (native) and the webview's drawing
  test(`${family.name}: a fresh store and session on the stored files show the saved step with its time and the progress count`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    const steps = [
      { id: 'step-one', label: 'One' },
      { id: 'step-two', label: 'Two' },
    ]
    const hashed = hashSteps(steps)
    const change = {
      stepId: 'step-one',
      stepHash: hashed[0]!.stepHash,
      understood: true,
      at: '2026-11-10T09:30:00.000Z',
    }
    await replay.store.save(change)

    // Act: a window reload builds new store objects and a new session over the same files.
    const fresh = await replay.otherWindow()
    const reloadedStore = {
      readStepUnderstanding: () => fresh.read() as Promise<never>,
      saveStepUnderstanding: () => fresh.save(change) as Promise<never>,
    }
    const sessions = new StepUnderstandingSessions(() => undefined, String)
    const shown = {
      studyId: replay.studyId,
      store: reloadedStore,
      steps: hashed,
      selectable: ['step-one', 'step-two'],
    }
    const first = sessions.view(shown)
    await waitUntil(
      () => sessions.view(shown)?.status === 'ready',
      'the reloaded decisions are read',
      READER_RESULT_BOUND_MS,
    )
    const reloaded = sessions.view(shown)

    // Assert
    assert.equal(first?.status, 'unknown')
    assert.deepEqual(reloaded?.steps[0], {
      stepId: 'step-one',
      understood: true,
      at: '2026-11-10T09:30:00.000Z',
      reviewNeeded: false,
      saving: false,
    })
    assert.equal(reloaded?.steps[1]?.understood, false)
    assert.equal(reloaded?.understoodCount, 1)
    assert.equal(reloaded?.selectableCount, 2)
  })

  // Value: protects=a lock held by another writer refusing the write without touching the file; fails_when=the write waits, is retried in the background, or changes the file's bytes; no_claim=a lock of a process that has really died (its takeover has its own tests)
  test(`${family.name}: a lock file of another writer refuses the save and leaves the file's bytes`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    await replay.store.save(decisionFor('step-one', HASH_ONE))
    const before = await readFile(replay.filePath)
    await writeFile(join(replay.lockDirectory, 'writer.lock'), 'another writer')

    // Act
    const refusal = await replay.store
      .save(decisionFor('step-two', HASH_TWO))
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    // Assert
    assert.ok(refusal instanceof StorageLockHeldError)
    assert.match(String(refusal), /Learning storage is locked/)
    assert.deepEqual(await readFile(replay.filePath), before)
    // not cleanup: the foreign lock is taken away so the folder can be removed
    await rm(join(replay.lockDirectory, 'writer.lock'))
  })

  // Value: protects=a removal that happened while a write waited for the storage lock winning; fails_when=the waiting write recreates the replay's folder or step file after the removal (red check: with the existence check under the lock removed, the browser recording's step file reappears); no_claim=the ordering of two callers that both wait for the lock (the removal here is done under the held lock, so the order is fixed); the removal is a plain rename or rm under the held lock, not the real removeHistory or removeStudy, so their own bookkeeping is not exercised here
  test(`${family.name}: a write waiting for the lock is refused when the replay was removed first and recreates nothing`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    let write!: Promise<unknown>

    // Act: the write is queued behind a held lock, the replay is removed, then the lock is released.
    await withStorageLock(replay.lockDirectory, async () => {
      write = replay.store.save(decisionFor('step-two', HASH_TWO)).then(
        () => 'saved',
        (error: unknown) => String(error),
      )
      await replay.removeByFileSystem()
    })
    const outcome = await write

    // Assert
    assert.match(String(outcome), replay.removedRefusal)
    for (const path of replay.mustStayAbsent)
      assert.equal(existsSync(path), false, `${path} was recreated`)
    assert.equal(
      existsSync(replay.filePath),
      false,
      'the step file was recreated',
    )
  })

  // Value: protects=a write after the family's own removal being refused; fails_when=the removed replay gets its folder or step file back; no_claim=a write that overlaps the removal (the held-lock test fixes that order); the Node family's in-flight removing marker, which only a write during the real removal reaches
  test(`${family.name}: a write after the replay's removal is refused and recreates nothing`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    await replay.store.save(decisionFor('step-one', HASH_ONE))
    await replay.remove()

    // Act
    const outcome = await replay.store
      .save(decisionFor('step-two', HASH_TWO))
      .then(
        () => 'saved',
        (error: unknown) => String(error),
      )

    // Assert
    assert.match(String(outcome), replay.removedRefusal)
    assert.equal(existsSync(replay.filePath), false)
    for (const path of replay.mustStayAbsent)
      assert.equal(existsSync(path), false)
  })

  // Value: protects=a serialized file over the byte limit never replacing the previous bytes; fails_when=the write truncates, partially writes or replaces the file; no_claim=disk-full behavior (the limit is passed small instead)
  test(`${family.name}: a file over the byte limit fails the save and keeps the previous bytes`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    await replay.store.save(decisionFor('step-one', HASH_ONE))
    const before = await readFile(replay.filePath)
    const leftover = (await readdir(join(replay.filePath, '..'))).sort()

    // Act
    const failure = await replay.store
      .save(decisionFor('step-two', HASH_TWO), before.length + 10)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert
    assert.match(failure ?? '', /Storage limit exceeded/)
    assert.deepEqual(await readFile(replay.filePath), before)
    assert.deepEqual(
      (await readdir(join(replay.filePath, '..'))).sort(),
      leftover,
    )
  })

  // Value: protects=a damaged or foreign file never being overwritten or trusted; fails_when=a malformed, another study's or oversized file reads as decisions, is overwritten by a save, or keeps reading as unreadable after it is replaced by a valid file; no_claim=the pane's wording of the unreadable state
  test(`${family.name}: a malformed, foreign or oversized file reads as unreadable, stays untouched and reads again once replaced`, async (context) => {
    // Arrange
    const replay = await family.open(context)
    const foreign = JSON.stringify({
      version: 1,
      studyId:
        '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000000',
      decisions: [],
    })
    const oversized = ' '.repeat(262_145)
    const valid = JSON.stringify({
      version: 1,
      studyId: replay.studyId,
      decisions: [decisionFor('step-one', HASH_ONE)],
    })

    for (const bytes of ['{broken', foreign, oversized]) {
      // Act
      await writeFile(replay.filePath, bytes)
      const read = await replay.store.read().then(
        () => 'read',
        () => 'unreadable',
      )
      const save = await replay.store
        .save(decisionFor('step-two', HASH_TWO))
        .then(
          () => 'saved',
          () => 'refused',
        )

      // Assert
      assert.equal(read, 'unreadable')
      assert.equal(save, 'refused')
      assert.equal(await readFile(replay.filePath, 'utf8'), bytes)
    }

    // Act: the learner repairs the file.
    await writeFile(replay.filePath, valid)
    const repaired = await replay.store.read()

    // Assert
    assert.equal((repaired as { decisions: unknown[] }).decisions.length, 1)
  })
}

// Value: protects=a read-only history folder failing a step save without changing the file; fails_when=the previous bytes change or a temporary file is left; no_claim=Windows permissions (the test is skipped there) and a root user (skipped too)
test(
  'extension replay: a read-only history folder fails the save and keeps the previous bytes',
  {
    skip:
      process.platform === 'win32'
        ? 'POSIX permissions only'
        : process.getuid?.() === 0
          ? 'a root user ignores folder permissions'
          : false,
  },
  async (context) => {
    // Arrange
    const replay = await openExtensionReplay(context)
    await replay.store.save(decisionFor('step-one', HASH_ONE))
    const before = await readFile(replay.filePath)
    const folder = join(replay.filePath, '..')
    const listingBefore = (await readdir(folder)).sort()
    await chmod(folder, 0o500)

    // Act
    let failure: string
    try {
      failure = await replay.store.save(decisionFor('step-two', HASH_TWO)).then(
        () => 'saved',
        (error: unknown) => String(error),
      )
    } finally {
      // The folder is writable again so the test's cleanup can remove it.
      await chmod(folder, 0o700)
    }

    // Assert
    assert.notEqual(failure, 'saved')
    assert.deepEqual(await readFile(replay.filePath), before)
    assert.deepEqual((await readdir(folder)).sort(), listingBefore)
  },
)

// Value: protects=a history that holds only per-step marks not being removed as empty; fails_when=a folder holding only step-understanding.json is judged to hold no learner files; no_claim=the sealed-empty history rules beyond this file
test('a history folder holding only its step-understanding file holds learner files', async (context) => {
  // Arrange
  const withFile = await mkdtemp(join(tmpdir(), 'codebook-step-holds-'))
  const empty = await mkdtemp(join(tmpdir(), 'codebook-step-holds-'))
  context.after(() => removeTestFolder(withFile))
  context.after(() => removeTestFolder(empty))
  await writeFile(join(withFile, STEP_UNDERSTANDING_NODE_FILE), '{}')

  // Act
  const holdsFile = await holdsLearnerFiles(withFile)
  const holdsNothing = await holdsLearnerFiles(empty)

  // Assert
  assert.equal(holdsFile, true)
  assert.equal(holdsNothing, false)
})

// Value: protects=a deleted or hand-removed study taking its step file along and a step file left without its archive being found as the rest of a study; fails_when=studyFiles or the removal omit <studyId>.steps.v1.json, or the leftover is not listed; no_claim=the Trash move itself (an injected mover records the paths)
test('a browser study’s removal and Remove by hand list include its step file, and a step file without its archive is listed as the rest of a study', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-step-files-'))
  context.after(() => removeTestFolder(directory))
  const library = new LearningLibrary(directory, BROWSER_WORKSPACE_KEY)
  const removed = capturedStudy()
  const orphaned = capturedStudy()
  await library.saveStudy(removed)
  await library.saveStudy(orphaned)
  await library.saveStepUnderstanding(
    removed.id,
    decisionFor('step-one', HASH_ONE),
    STEPS,
  )
  await library.saveStepUnderstanding(
    orphaned.id,
    decisionFor('step-one', HASH_ONE),
    STEPS,
  )
  const moved: string[] = []

  // Act
  const listedFiles = await library.studyFiles(removed.id)
  const removal = await library.removeStudy(removed.id, async (path) => {
    moved.push(path)
    // not cleanup: the injected remover stands in for the Trash
    await rm(path, { recursive: true })
  })
  // not cleanup: the learner removes the orphan's archive by hand and leaves its other files
  await rm(join(directory, `${orphaned.id}.study.v3.json`))
  await rm(join(directory, `${orphaned.id}.study.meta.v3.json`))
  const listed = await library.list()
  const handFiles = await library.studyFiles(orphaned.id)

  // Assert
  const stepFile = join(directory, `${removed.id}.steps.v1.json`)
  assert.equal(listedFiles.includes(stepFile), true)
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.equal(moved.includes(stepFile), true)
  assert.equal(existsSync(stepFile), false)
  assert.deepEqual(
    listed.map((entry) => [entry.id, entry.format]),
    [[orphaned.id, 'archive-missing']],
  )
  assert.deepEqual(handFiles, [join(directory, `${orphaned.id}.steps.v1.json`)])
})

// Value: protects=the browser step file never being created for a study that has no archive; fails_when=saving for an unknown study id creates <id>.steps.v1.json; no_claim=removals racing a write (the family tests above)
test('a browser step save for a study without an archive is refused and creates no file', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-step-noarchive-'))
  context.after(() => removeTestFolder(directory))
  await mkdir(directory, { recursive: true })
  const library = new LearningLibrary(directory, BROWSER_WORKSPACE_KEY)
  const studyId = capturedStudy().id

  // Act
  const failure = await library
    .saveStepUnderstanding(studyId, decisionFor('step-one', HASH_ONE), STEPS)
    .then(
      () => 'saved',
      (error: unknown) => String(error),
    )

  // Assert
  assert.match(failure, /Study archive is unavailable/)
  assert.equal(existsSync(join(directory, `${studyId}.steps.v1.json`)), false)
})

// Value: protects=a step file that grows after the size check never being read whole past the limit (memory); fails_when=the read takes the file's bytes beyond the limit once the size check passed; no_claim=a real writer racing the read (the size check is made to report a small file) and the pane's wording of the unreadable state
test('a step file that grows past the byte limit after the size check reads as unreadable', async (context) => {
  // Arrange: a valid file of 600 bytes, a limit of 500, and size checks that still report 100 bytes.
  const folder = await mkdtemp(join(tmpdir(), 'step-file-growth-'))
  context.after(() => removeTestFolder(folder))
  const path = join(folder, 'step-understanding.json')
  const studyId =
    '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000001'
  await writeFile(
    path,
    JSON.stringify({ version: 1, studyId, decisions: [] }).padEnd(600, ' '),
  )
  const lying = { isFile: () => true, isSymbolicLink: () => false, size: 100 }
  context.mock.method(fsPromises, 'lstat', async () => lying)
  const realOpen = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args)
      // The handle answers a small size, as a file that grew after the check would.
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'stat') return async () => lying
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  )

  // Act
  const outcome = await readStepUnderstandingFile(path, studyId, 500).then(
    () => 'read',
    (error: Error) => error.message,
  )

  // Assert
  assert.equal(outcome, 'The step-understanding file is not a bounded file.')
})

// Value: protects=a step file that grows after the size check, yet stays under the byte limit, being refused for that read and read again at its new size on the next; fails_when=the read buffer is sized from the limit instead of the checked size, so the grown file is read whole, or the refusal sticks for later reads; no_claim=a real writer racing the read (the size check is made to report a small file) and the pane's wording of the unreadable state
test('a step file that grows after the size check but stays under the limit is refused once and read on the next read', async (context) => {
  // Arrange: a valid file of 300 bytes, a limit of 500, and one size check that reports 100 bytes.
  const folder = await mkdtemp(join(tmpdir(), 'step-file-growth-under-'))
  context.after(() => removeTestFolder(folder))
  const path = join(folder, 'step-understanding.json')
  const studyId =
    '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000001'
  await writeFile(
    path,
    JSON.stringify({ version: 1, studyId, decisions: [] }).padEnd(300, ' '),
  )
  let sizeCheckIsStale = true
  const realOpen = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args)
      return new Proxy(handle, {
        get(target, key) {
          // Only the first read's handle answers a small size, as a file that grew after the check would.
          if (key === 'stat' && sizeCheckIsStale) {
            sizeCheckIsStale = false
            return async () => ({ isFile: () => true, size: 100 })
          }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  )

  // Act
  const firstOutcome = await readStepUnderstandingFile(path, studyId, 500).then(
    () => 'read',
    (error: Error) => error.message,
  )
  const secondRead = await readStepUnderstandingFile(path, studyId, 500)

  // Assert
  assert.equal(
    firstOutcome,
    'The step-understanding file is not a bounded file.',
  )
  assert.deepEqual(secondRead, { version: 1, studyId, decisions: [] })
})
