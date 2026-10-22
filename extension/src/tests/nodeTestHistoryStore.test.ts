import assert from 'node:assert/strict'
import fsPromises, {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, mock, test, type TestContext } from 'node:test'

import { NODE_TEST_HISTORY_DIRECTORY } from '../constants'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { citationContext } from '../utils/citationContext'
import { currentStorageOwner } from '../utils/currentStorageOwner'

const createWorkspaceKey = () => sha256('node-history-test-workspace')
import { idleChild } from './utils/idleChild'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

// Every start of a history takes the storage lock, which names this process's own start; the product reads that start once and keeps it, also a failed read for a minute. It is read here first, with the tests' own bound, as the tests of the lock do.
before(async () => {
  await realProcessStart(process.pid)
})

/**
 * Holds the creation of one history's header file until the test lets it go on, so that a test can look at the storage, and ask for further starts, while a start is between making its folder and writing its header.
 * @param context - The test, at whose end the file system's own `open` is back.
 * @param headerPath - The header file whose creation is held; every other file is opened at once.
 * @returns `folderMade`, which resolves when the held start has made its folder and asks for its header file, and `letGoOn`, which lets the header be created, or refuses its creation with the given error.
 * @example
 * const held = holdHeaderCreation(context, join(historyDirectory, first.studyId, 'header.json'))
 * const firstStart = store.start(first); await held.folderMade; held.letGoOn()
 */
function holdHeaderCreation(
  context: TestContext,
  headerPath: string,
): { folderMade: Promise<void>; letGoOn: (refusal?: Error) => void } {
  let letGoOn!: (refusal?: Error) => void
  const mayGoOn = new Promise<Error | undefined>((resolve) => {
    letGoOn = resolve
  })
  let reportFolderMade!: () => void
  const folderMade = new Promise<void>((resolve) => {
    reportFolderMade = resolve
  })
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      if (input[0] === headerPath) {
        reportFolderMade()
        const refusal = await mayGoOn
        if (refusal) throw refusal
      }
      return openBefore(...input)
    },
  )
  return { folderMade, letGoOn }
}

test('Node history remains a readable interrupted prefix after extension restart and rejects foreign workspace access', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-')),
    header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    // Act: reopen the same private workspace store without a seal, as after abrupt extension exit.
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey)
    const recovered = await restarted.read(header.studyId)

    // Assert
    assert.equal(recovered.status, 'interrupted')
    assert.deepEqual(
      recovered.entries.map((entry) => entry.type),
      ['output'],
    )
    assert.match(recovered.reason!, /no verified final seal/i)
    await assert.rejects(
      new NodeTestHistoryStore(directory, 'f'.repeat(64)).read(header.studyId),
      /another workspace/i,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node history refuses edited bytes after a sealed partial run', async () => {
  // Arrange
  const directory = await mkdtemp(
      join(tmpdir(), 'codebook-node-history-seal-'),
    ),
    header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stderr',
      text: 'test interrupted',
    })
    await writer.finish('partial', 'The learner stopped this run.')
    const journal = join(
      directory,
      NODE_TEST_HISTORY_DIRECTORY,
      header.studyId,
      'events.jsonl',
    )
    await appendFile(journal, '{"type":"forged"}\n')

    // Act / Assert
    await assert.rejects(
      store.read(header.studyId),
      /sealed Node history journal is corrupt/i,
    )
    const [listed] = await store.list()
    assert.equal(
      listed?.verification,
      'unavailable',
      'catalog keeps corrupted evidence visible without trusting it',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node reader restores a verified event cursor without changing the sealed journal', async () => {
  // Arrange
  const directory = await mkdtemp(
      join(tmpdir(), 'codebook-node-history-position-'),
    ),
    header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    await writer.finish('partial', 'The test process was stopped.')
    const historyDirectory = join(
      directory,
      NODE_TEST_HISTORY_DIRECTORY,
      header.studyId,
    )
    const journalPath = join(historyDirectory, 'events.jsonl'),
      journalBefore = await readFile(journalPath)

    // Act: save an exact journal event and open it through a fresh store instance.
    await store.saveReaderPosition(header.studyId, 1)
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey)
    const restoredSequence = await restarted.readReaderPosition(header.studyId)

    // Assert
    assert.equal(restoredSequence, 1)
    assert.deepEqual(
      await readFile(journalPath),
      journalBefore,
      'reading progress does not rewrite sealed execution evidence',
    )
    await assert.rejects(
      restarted.saveReaderPosition(header.studyId, 2),
      /unavailable in verified history/i,
    )

    // Act: a stale cursor cannot be presented as a valid replay position.
    const positionPath = join(historyDirectory, 'reader-position.json')
    await writeFile(
      positionPath,
      JSON.stringify({
        version: 1,
        studyId: header.studyId,
        sequence: 2,
        updatedAt: new Date().toISOString(),
      }),
    )

    // Assert
    await assert.rejects(
      restarted.readReaderPosition(header.studyId),
      /no longer present in the verified history/i,
    )
    assert.deepEqual(
      await readFile(journalPath),
      journalBefore,
      'a stale cursor leaves the sealed journal byte-identical',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('stepping through an opened Node history saves each reader position without re-verifying the whole journal', async () => {
  // Arrange
  const directory = await mkdtemp(
      join(tmpdir(), 'codebook-node-history-position-steps-'),
    ),
    header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    for (const sequence of [1, 2, 3])
      await writer.appendOutput({
        sequence,
        elapsedMs: sequence,
        channel: 'stdout',
        text: `output ${sequence}`,
      })
    await writer.finish('partial', 'The test process was stopped.')
    const opened = await store.read(header.studyId)
    const journalReads = mock.method(store, 'read')

    // Act: playback advances through each event of the history the reader already verified.
    for (const sequence of [1, 2, 3])
      await store.saveReaderPosition(header.studyId, sequence, opened)

    // Assert
    assert.equal(journalReads.mock.callCount(), 0)
    assert.equal(
      await new NodeTestHistoryStore(
        directory,
        header.workspaceKey,
      ).readReaderPosition(header.studyId),
      3,
    )
    await assert.rejects(
      store.saveReaderPosition(header.studyId, 4, opened),
      /unavailable in verified history/i,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node history understanding is an explicit private decision that survives store restart', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-understanding-'),
  )
  const header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey)
  const writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'Tests 1 passed',
    })
    const sourceText = 'const nextTheme = "dark";\n'
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
      variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'notifyManager',
            line: 1,
            column: 1,
            source: {
              name: header.configuration.source.path,
              text: sourceText,
              hash: sha256(sourceText),
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    })
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      6,
    )
    await writer.finish('complete')
    const journalPath = join(
      directory,
      NODE_TEST_HISTORY_DIRECTORY,
      header.studyId,
      'events.jsonl',
    )
    const originalJournal = await readFile(journalPath)

    // Act: a completed test has no understanding decision until the learner records one.
    assert.equal(await store.readLearningDecision(header.studyId), undefined)
    const decision = await store.saveLearningDecision(header.studyId, true)
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey)
    const restored = await restarted.readLearningDecision(header.studyId)

    // Assert
    assert.equal(decision.studyId, header.studyId)
    assert.equal(decision.understood, true)
    assert.equal(restored?.understood, true)
    assert.ok(restored?.at)
    assert.deepEqual(
      await readFile(journalPath),
      originalJournal,
      'learner progress does not rewrite sealed test output',
    )

    // Act: an explicit review choice can replace understood state for the same history.
    await restarted.saveLearningDecision(header.studyId, false)

    // Assert
    assert.equal(
      (await store.readLearningDecision(header.studyId))?.understood,
      false,
    )
    await writeFile(
      join(
        directory,
        NODE_TEST_HISTORY_DIRECTORY,
        header.studyId,
        'learning-decision.json',
      ),
      JSON.stringify({
        version: 1,
        studyId:
          '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000000',
        understood: true,
        at: new Date().toISOString(),
      }),
    )
    await assert.rejects(
      restarted.readLearningDecision(header.studyId),
      /belongs to another history/i,
    )
    assert.deepEqual(
      await readFile(journalPath),
      originalJournal,
      'a foreign learner decision does not modify execution evidence',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=learning material that restores by revision and cites only exact sealed events, refused with a step-level INVALID_REFERENCE; fails_when=a step citing the result as a stop is accepted, or its refusal does not name the step, the sequence, what it is and what the step claims; why_new=the step refusal named nothing the agent could correct (X19); seam=none; no_claim=the service's MCP answer (service tests)
test('Node learning explanation restores by revision and accepts only exact sealed stop and result events', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-learning-material-'),
  )
  const header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey)
  const writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    const sourceText = 'const nextTheme = "dark";\n'
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
      variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'notifyManager',
            line: 1,
            column: 1,
            source: {
              name: header.configuration.source.path,
              text: sourceText,
              hash: sha256(sourceText),
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    })
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      6,
    )
    await writer.finish('complete')
    const historyDirectory = join(
      directory,
      NODE_TEST_HISTORY_DIRECTORY,
      header.studyId,
    )
    const journalPath = join(historyDirectory, 'events.jsonl')
    const sealedJournal = await readFile(journalPath)
    const content = {
      question: 'Why did the selected theme become dark?',
      title: 'Theme update',
      summary:
        'The captured stop shows the dark value; the test process later exited successfully.',
      participants: [
        { id: 'test', label: 'Vitest test' },
        { id: 'state', label: 'Theme state' },
      ],
      steps: [
        {
          id: 'selection',
          from: 'test',
          to: 'state',
          label: 'Select theme',
          explanation:
            'The native debugger captured the dark theme value at this source stop.',
          evidence: 'observed' as const,
          reference: {
            type: 'stop' as const,
            sequence: 2,
            sourceHash: header.configuration.source.hash,
          },
        },
        {
          id: 'result',
          from: 'test',
          to: 'test',
          label: 'Finish test',
          explanation: 'The sealed journal records a passing process result.',
          evidence: 'observed' as const,
          reference: { type: 'result' as const, sequence: 3 },
        },
      ],
    }

    // Act: save the editor agent's summary, then reopen it from a fresh store instance.
    const saved = await store.saveLearningMaterial(header.studyId, 0, content)
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey)
    const restored = await restarted.readLearningMaterial(header.studyId)

    // Assert
    assert.equal(saved.revision, 1)
    assert.deepEqual(restored?.content, content)
    assert.equal(
      await restarted.readLearningDecision(header.studyId),
      undefined,
      'agent explanation never marks learner understanding',
    )
    assert.deepEqual(
      await readFile(journalPath),
      sealedJournal,
      'learning content never mutates sealed execution events',
    )
    await assert.rejects(
      restarted.saveLearningMaterial(header.studyId, 0, content),
      /revision changed/i,
    )
    const [stopStep, resultStep] = content.steps
    assert.ok(stopStep)
    assert.ok(resultStep)
    await assert.rejects(
      restarted.saveLearningMaterial(header.studyId, 1, {
        ...content,
        steps: [
          {
            ...stopStep,
            reference: {
              type: 'stop',
              sequence: 3,
              sourceHash: header.configuration.source.hash,
            },
          },
          resultStep,
        ],
      }),
      {
        code: 'INVALID_REFERENCE',
        message:
          /^codebook_explain_node_history refused step [\w-]+: sequence 3 is the result in the sealed history, but the step claims a stop with sourceHash [0-9a-f]{64}\. Read the history's events again and cite each event by its sequence, type and source hash\.$/,
      },
    )
    assert.deepEqual(
      await restarted.readLearningMaterial(header.studyId),
      saved,
      'invalid revisions and references preserve the last valid explanation',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a new Node test is refused when saved studies and histories reach the configured limit, keeping existing history readable', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-capacity-'),
  )
  const workspaceKey = createWorkspaceKey()
  const savedBrowserStudies = async () => 1
  const store = new NodeTestHistoryStore(
    directory,
    workspaceKey,
    () => 2,
    savedBrowserStudies,
  )
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  try {
    const writer = await store.start(first)
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    await writer.finish('partial', 'The learner stopped this run.')

    // Act
    const starting = store.start(second)

    // Assert
    await assert.rejects(starting, /Saved study storage is full/)
    assert.deepEqual(
      (await store.list()).map((entry) => entry.studyId),
      [first.studyId],
    )
    assert.equal((await store.read(first.studyId)).status, 'partial')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=starting a Node test in a history directory that holds an entry nobody's history owns; fails_when=every entry of the directory is counted against the saved study limit, so a stray file or folder that no list shows makes a store with room refuse the start as full; why_new=Cycle 0046 package HYA, found while working F1 (row 57); seam=none
test('a stray file and a stray folder in the Node history directory take no place of the saved study limit, and a store that holds the limit still refuses a new test', async () => {
  // Arrange: a limit of one history, and a history directory that holds a stray file and a stray folder.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-stray-'),
  )
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  await mkdir(join(historyDirectory, 'notes'), { recursive: true })
  await writeFile(join(historyDirectory, '.DS_Store'), '')
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  try {
    // Act: the first test starts beside the stray entries; the second meets a store that holds its one history.
    const writer = await store.start(first)
    await writer.finish('partial', 'The learner stopped this run.')
    const secondStart = await store.start(second).then(
      () => 'admitted',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      secondStart,
      'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
    )
    assert.deepEqual(
      (await store.list()).map((entry) => entry.studyId),
      [first.studyId],
    )
    assert.deepEqual(
      (await readdir(historyDirectory)).sort(),
      ['.DS_Store', first.studyId, 'notes'].sort(),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a Node test whose history could not be started takes no place of the saved study limit; fails_when=the history's folder is made before the header's size is checked, or stays after its header file could not be written: no list shows such a folder, nothing removes it, and every later start counts it, so each failure takes one place of the limit for good (Cycle 0046 row 95); why_new=no test made a start fail; seam=a header above its size limit, and the creation of the header file, which the disk refuses once
test('a Node test whose history cannot be started leaves no folder behind, and the next test under a limit of one is admitted', async (context) => {
  // Arrange: a limit of one history. The first header is above its limit of 8,388,608 bytes (six sources of 262,144 control characters each make 9,440,675 bytes of JSON); for the second start the disk refuses the header file after the history's folder was made.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-failed-start-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const refusedByDisk = nodeTestHistoryHeader(workspaceKey),
    admitted = nodeTestHistoryHeader(workspaceKey),
    template = nodeTestHistoryHeader(workspaceKey)
  const largeText = '\u0001'.repeat(262_144)
  const largeSources = Array.from({ length: 6 }, (_, index) => ({
    path: `src/large-${index}.ts`,
    hash: sha256(largeText),
    text: largeText,
    lineCount: 1,
  }))
  const largeAnchors = largeSources.map(({ path, hash }) => ({
    path,
    hash,
    startLine: 1,
    endLine: 1,
  }))
  const aboveItsLimit = {
    ...template,
    descriptor: {
      ...template.descriptor,
      anchors: largeAnchors,
      citationContext: citationContext(largeAnchors),
      sources: largeSources,
    },
  }
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      if (
        input[0] ===
        join(historyDirectory, refusedByDisk.studyId, 'header.json')
      )
        throw Object.assign(
          new Error('ENOSPC: no space left on device, open'),
          { code: 'ENOSPC' },
        )
      return openBefore(...input)
    },
  )
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act
  const startAboveItsLimit = await outcomeOf(store.start(aboveItsLimit))
  const foldersAfterTheLargeHeader = await readdir(historyDirectory)
  const startRefusedByDisk = await outcomeOf(store.start(refusedByDisk))
  const foldersAfterTheRefusedFile = await readdir(historyDirectory)
  const nextStart = await outcomeOf(
    store
      .start(admitted)
      .then((writer) =>
        writer.finish('partial', 'The learner stopped this run.'),
      ),
  )
  // Assert
  assert.equal(
    startAboveItsLimit,
    'Error: Node history article context exceeds its storage limit.',
  )
  assert.deepEqual(foldersAfterTheLargeHeader, [])
  assert.equal(
    startRefusedByDisk,
    'Error: ENOSPC: no space left on device, open',
  )
  assert.deepEqual(foldersAfterTheRefusedFile, [])
  assert.equal(nextStart, 'admitted')
  assert.deepEqual(
    (await store.list()).map((entry) => entry.studyId),
    [admitted.studyId],
  )
})

// Value: protects=a Node test starts in a store whose history directory holds folders that are nobody's listed history; fails_when=every folder named like a study id is counted against the saved study limit although the list shows a history only by its header, so a folder without a header (one a learner made, or one a failed start of an earlier build left) fills the limit while the list is empty, for good (Cycle 0046 row 183); why_new=row 57 put entries with other names into the directory, no test a folder with the name of a history and no readable header; seam=the history directory, into which the test puts the folders
test('a folder without a header and one whose header cannot be read take no place of the saved study limit, and a store whose list holds the limit still refuses a new test', async (context) => {
  // Arrange: a limit of one history; the history directory holds a folder named like a study id without a header, and one whose header is no JSON. The list shows neither.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-unlisted-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const withoutHeader = nodeTestHistoryHeader(workspaceKey).studyId,
    withBrokenHeader = nodeTestHistoryHeader(workspaceKey).studyId
  await mkdir(join(historyDirectory, withoutHeader), { recursive: true })
  await mkdir(join(historyDirectory, withBrokenHeader))
  await writeFile(join(historyDirectory, withBrokenHeader, 'header.json'), '{')
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act: the first test starts beside the two folders; the second meets a store whose list holds its one history.
  const listedBefore = (await store.list()).map((entry) => entry.studyId)
  const firstStart = await outcomeOf(
    store
      .start(first)
      .then((writer) =>
        writer.finish('partial', 'The learner stopped this run.'),
      ),
  )
  const secondStart = await outcomeOf(store.start(second))
  // Assert
  assert.deepEqual(listedBefore, [])
  assert.equal(firstStart, 'admitted')
  assert.equal(
    secondStart,
    'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
  )
  assert.deepEqual(
    (await store.list()).map((entry) => entry.studyId),
    [first.studyId],
  )
  assert.deepEqual(
    (await readdir(historyDirectory)).sort(),
    [first.studyId, withBrokenHeader, withoutHeader].sort(),
  )
})

// Value: protects=the saved study limit while a Node test of this window is being started; fails_when=a history counts only by its header (Cycle 0046 row 183) and nothing holds a second start back, so a second test asked for while the first has made its folder and not yet written its header takes the same last place; why_new=before row 183 a history counted by its folder's name, from the moment the folder was made; since row 190 the start runs under the storage lock, so the second start waits for the first; seam=the creation of the first history's header file, which the test holds
test('a Node test asked for while another one is being started under a limit of one is refused, and the one being started is admitted', async (context) => {
  // Arrange: a limit of one. The creation of the first history's header file waits until the test lets it go on; its folder is made by then.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-two-starts-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  const held = holdHeaderCreation(
    context,
    join(historyDirectory, first.studyId, 'header.json'),
  )
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act: the second test is asked for while the first history has a folder and no header. It waits for the storage lock the first start holds; were the lock not held, it would be decided at once, so it is awaited before the first start goes on.
  const firstStart = outcomeOf(store.start(first))
  await held.folderMade
  const foldersWhileStarting = await readdir(historyDirectory)
  const listedWhileStarting = (await store.list()).map((entry) => entry.studyId)
  const isLockHeldWhileStarting = (await readdir(directory)).includes(
    'writer.lock',
  )
  const secondStart = outcomeOf(store.start(second))
  if (!isLockHeldWhileStarting) await secondStart
  held.letGoOn()
  // Assert
  assert.deepEqual(foldersWhileStarting, [first.studyId])
  assert.deepEqual(listedWhileStarting, [])
  assert.equal(isLockHeldWhileStarting, true)
  assert.equal(await firstStart, 'admitted')
  assert.equal(
    await secondStart,
    'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
  )
  assert.deepEqual(await readdir(historyDirectory), [first.studyId])
})

// Value: protects=the saved study limit when two windows of one workspace start a Node test at the same moment; fails_when=the start of a history takes no storage lock, so the second window counts the histories while the first has made its folder and not yet written its header, and both take the last place (Cycle 0046 row 190); why_new=the history store never took the lock that the library and the recording store take; seam=two stores on one learning directory, as two windows have them, and the creation of the first history's header file, which the test holds
test('of two windows that start a Node test with one place left, one history is reserved under the storage lock and the other test is refused', async (context) => {
  // Arrange: a limit of one and two stores on one learning directory. The first window's start is held between its folder and its header.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-two-windows-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const firstWindow = new NodeTestHistoryStore(
      directory,
      workspaceKey,
      () => 1,
    ),
    secondWindow = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  const held = holdHeaderCreation(
    context,
    join(historyDirectory, first.studyId, 'header.json'),
  )
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act: the second window asks while the first holds the storage lock. In this one process its start waits for the lock; were the lock not held, it would be decided at once, so it is awaited before the first start goes on.
  const firstStart = outcomeOf(firstWindow.start(first))
  await held.folderMade
  const storageWhileStarting = (await readdir(directory)).sort()
  const isLockHeldWhileStarting = storageWhileStarting.includes('writer.lock')
  const secondStart = outcomeOf(secondWindow.start(second))
  if (!isLockHeldWhileStarting) await secondStart
  held.letGoOn()
  const outcomes = [await firstStart, await secondStart]
  // Assert
  assert.deepEqual(storageWhileStarting, [
    NODE_TEST_HISTORY_DIRECTORY,
    'writer.lock',
  ])
  assert.deepEqual(outcomes, [
    'admitted',
    'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
  ])
  assert.deepEqual(await readdir(historyDirectory), [first.studyId])
  assert.deepEqual(await readdir(directory), [NODE_TEST_HISTORY_DIRECTORY])
})

// Value: protects=the saved study limit when a start is asked for twice with one study id while it is under way; fails_when=the starts under way are noted by study id, so the second start, which is refused, takes the one note the first start still needs when it ends, and a third test is then admitted beside the first, above the limit (Cycle 0046 row 191); why_new=every test started each history once; since rows 190 and 191 no start is noted at all: the storage lock holds every other start back until the first has written its header; seam=the creation of the first history's header file, which the test holds
test('of two starts with one study id and a third Node test asked for while the first is being started under a limit of one, only the first is admitted', async (context) => {
  // Arrange: a limit of one. The first start is held between its folder and its header.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-one-id-twice-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const first = nodeTestHistoryHeader(workspaceKey),
    third = nodeTestHistoryHeader(workspaceKey)
  const held = holdHeaderCreation(
    context,
    join(historyDirectory, first.studyId, 'header.json'),
  )
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act: the same history is asked for again, and then another one. Both wait for the storage lock the first start holds; were the lock not held, they would be decided at once and in this order, so they are awaited before the first start goes on.
  const firstStart = outcomeOf(store.start(first))
  await held.folderMade
  const isLockHeldWhileStarting = (await readdir(directory)).includes(
    'writer.lock',
  )
  const secondStartOfTheSameId = outcomeOf(store.start(first))
  if (!isLockHeldWhileStarting) await secondStartOfTheSameId
  const thirdStart = outcomeOf(store.start(third))
  if (!isLockHeldWhileStarting) await thirdStart
  held.letGoOn()
  const outcomes = {
    first: await firstStart,
    secondOfTheSameId: await secondStartOfTheSameId,
    third: await thirdStart,
  }
  // Assert
  assert.deepEqual(outcomes, {
    first: 'admitted',
    secondOfTheSameId:
      'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
    third:
      'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
  })
  assert.deepEqual(await readdir(historyDirectory), [first.studyId])
  assert.deepEqual(
    (await store.list()).map((entry) => entry.studyId),
    [first.studyId],
  )
})

// Value: protects=a Node test is refused as "full" only by what the store holds when the test is decided; fails_when=a start remembers the starts that were under way when it was asked for and counts them although it is decided after they ended, so a test asked for during a start that then fails is refused while the store is empty (Cycle 0046 row 191: the note of the starts under way, which the storage lock of row 190 made unnecessary, is gone); why_new=no test made a start fail while another one waited; seam=the creation of the first history's header file, which the test holds and then refuses as a full disk does
test('a Node test asked for while another start is under way is admitted when that start fails', async (context) => {
  // Arrange: a limit of one. The first start is held between its folder and its header, and its header file is then refused.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-failed-first-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY)
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
  const held = holdHeaderCreation(
    context,
    join(historyDirectory, first.studyId, 'header.json'),
  )
  const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
    starting.then(
      () => 'admitted',
      (error: unknown) => String(error),
    )
  // Act: the second test is asked for while the first start holds the storage lock, and is decided once the first has failed and removed its folder.
  const firstStart = outcomeOf(store.start(first))
  await held.folderMade
  const isLockHeldWhileStarting = (await readdir(directory)).includes(
    'writer.lock',
  )
  const secondStart = outcomeOf(store.start(second))
  if (!isLockHeldWhileStarting) await secondStart
  held.letGoOn(
    Object.assign(new Error('ENOSPC: no space left on device, open'), {
      code: 'ENOSPC',
    }),
  )
  const outcomes = [await firstStart, await secondStart]
  // Assert
  assert.equal(isLockHeldWhileStarting, true)
  assert.deepEqual(outcomes, [
    'Error: ENOSPC: no space left on device, open',
    'admitted',
  ])
  assert.deepEqual(await readdir(historyDirectory), [second.studyId])
})

// Value: protects=a Node test whose history start wrote its folder under the storage lock while the release of the lock fails at each of its attempts (a scanner or an indexer holds writer.lock on Windows): the test starts with its history, and the lock left is taken back by this window's next start (Cycle 0047 row 199); fails_when=the release's failure fails the start, so the test is refused while the history's folder and its active entry stay until the window closes, unsealed and taking a place of the saved study limit; why_new=Cycle 0047 row 254 (P3CLA-9): row 240 made only a recording's start stand; seam=node:fs/promises unlink, which refuses to remove writer.lock while the test blocks it; no_claim=a real scanner on Windows
test('a Node test history start whose storage lock cannot be released after it made the history still starts, and the next start takes the lock back', async (context) => {
  // Arrange: a limit of two histories; the removal of writer.lock is refused during the first start.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-history-unreleased-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 2)
  const first = nodeTestHistoryHeader(workspaceKey),
    second = nodeTestHistoryHeader(workspaceKey)
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
  const sealedOrRefused = (
    starting: ReturnType<NodeTestHistoryStore['start']>,
  ): Promise<string> =>
    starting.then(
      async (writer) => {
        await writer.finish('partial', 'The learner stopped this run.')
        return 'started and sealed'
      },
      (error: unknown) => String(error),
    )

  // Act
  const firstStart = await sealedOrRefused(store.start(first))
  const lockLeftByTheFirstStart = await readFile(lockPath).then(
    () => true,
    () => false,
  )
  blockedRelease.mock.restore()
  const secondStart = await sealedOrRefused(store.start(second))

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
        { studyId: first.studyId, status: 'partial' },
        { studyId: second.studyId, status: 'partial' },
      ].sort((left, right) => left.studyId.localeCompare(right.studyId)),
    },
  )
})

// Value: protects=a Node test is not started beside a writer of another window, and a learner or an agent whose start is refused learns which file holds the lock; fails_when=the start of a history ignores the storage lock (Cycle 0046 row 190), or a refused start leaves a folder behind; why_new=the history store never took the storage lock; seam=the lock file, which names a real running process of this machine with its real start, as a window that is writing does
test('a Node test asked for while another window holds the storage lock is refused with the lock’s sentence, and nothing is written', async (context) => {
  // Arrange: the storage lock of another running window of this machine.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-history-locked-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const otherWindow = await idleChild(context)
  const lockPath = join(directory, 'writer.lock'),
    lockBytes = JSON.stringify({
      ...(await currentStorageOwner()),
      pid: otherWindow.pid,
      processStart: await realProcessStart(otherWindow.pid!),
    })
  await writeFile(lockPath, lockBytes)
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 1)
  // Act
  const start = await store.start(nodeTestHistoryHeader(workspaceKey)).then(
    () => 'admitted',
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(
    start,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.deepEqual(await readdir(directory), ['writer.lock'])
  assert.equal(await readFile(lockPath, 'utf8'), lockBytes)
})

// Value: protects=the sentence a learner or an agent reads when a Node test is asked for under a study id that already has a history; fails_when=the start ends with the file system's own text, which names the path of the private storage; why_new=Cycle 0046 row 208: the start made its folder without telling an id that is taken, as a recording's start tells it; seam=none, a real store in a temporary folder
test('a Node test asked for under a study id that already has a history is refused with a sentence that names no storage path, and that history stays as it is', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-same-id-'),
  )
  const workspaceKey = createWorkspaceKey()
  const store = new NodeTestHistoryStore(
    directory,
    workspaceKey,
    () => 5,
    async () => 0,
  )
  const header = nodeTestHistoryHeader(workspaceKey)
  try {
    const writer = await store.start(header)
    await writer.finish('partial', 'The learner stopped this run.')

    // Act
    const secondStart = await store.start(header).then(
      () => 'admitted',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      secondStart,
      'Error: A Node test history already exists for this study.',
    )
    assert.deepEqual(
      (await store.list()).map((entry) => entry.studyId),
      [header.studyId],
    )
    assert.equal((await store.read(header.studyId)).status, 'partial')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a refused history entry still lets the run seal its verified prefix as partial history', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-refused-entry-'),
  )
  const header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })

    // Act: an entry stamped before the last saved one is refused, leaving a gap after the verified prefix.
    const refused = writer.appendOutput({
      sequence: 2,
      elapsedMs: 3,
      channel: 'stdout',
      text: 'late output',
    })
    const afterGap = writer.appendOutput({
      sequence: 3,
      elapsedMs: 5,
      channel: 'stdout',
      text: 'output after the gap',
    })

    // Assert
    await assert.rejects(refused, /time moved backward/)
    await assert.rejects(
      afterGap,
      /stopped accepting evidence after an earlier entry failed/,
    )
    await assert.rejects(writer.finish('complete'), /cannot be marked complete/)
    await writer.finish('partial', 'Node test output capture failed.')
    const history = await new NodeTestHistoryStore(
      directory,
      header.workspaceKey,
    ).read(header.studyId)
    assert.equal(history.status, 'partial')
    assert.equal(history.reason, 'Node test output capture failed.')
    assert.deepEqual(
      history.entries.map((entry) =>
        entry.type === 'output' ? entry.text : entry.type,
      ),
      ['RUN src/theme.test.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a journal holding bytes its writer never confirmed stays an unsealed interrupted prefix', async () => {
  // Arrange: a write torn by an I/O failure leaves an incomplete line after the confirmed entries.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-torn-write-'),
  )
  const header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  const journalPath = join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    header.studyId,
    'events.jsonl',
  )
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    await appendFile(
      journalPath,
      '{"type":"output","sequence":2,"elapsedMs":5,"outp',
    )

    // Act
    const sealing = writer.finish('partial', 'Node test output capture failed.')

    // Assert
    await assert.rejects(sealing, /bytes its writer never confirmed/)
    writer.abandon()
    const history = await new NodeTestHistoryStore(
      directory,
      header.workspaceKey,
    ).read(header.studyId)
    assert.equal(history.status, 'interrupted')
    assert.equal(history.seal, undefined)
    assert.deepEqual(
      history.entries.map((entry) =>
        entry.type === 'output' ? entry.text : entry.type,
      ),
      ['RUN src/theme.test.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a failing Node test result can be sealed only as partial history', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-node-history-failing-result-'),
  )
  const header = nodeTestHistoryHeader(createWorkspaceKey())
  const store = new NodeTestHistoryStore(directory, header.workspaceKey),
    writer = await store.start(header)
  try {
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 4,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    const sourceText = 'const nextTheme = "dark";\n'
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
      variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'notifyManager',
            line: 1,
            column: 1,
            source: {
              name: header.configuration.source.path,
              text: sourceText,
              hash: sha256(sourceText),
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    })
    await writer.appendResult(
      { exitCode: 1, signal: null, output: 'Tests 1 failed' },
      6,
    )

    // Act
    const completing = writer.finish('complete')

    // Assert
    await assert.rejects(completing, /cannot be marked complete/)
    await writer.finish('partial', 'The test failed after its recorded stop.')
    const history = await store.read(header.studyId)
    assert.equal(history.status, 'partial')
    assert.equal(history.reason, 'The test failed after its recorded stop.')
    assert.deepEqual(
      history.entries.map((entry) => entry.type),
      ['output', 'stop', 'result'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
