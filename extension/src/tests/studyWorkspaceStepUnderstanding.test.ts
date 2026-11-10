import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { before, test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import type { ChromeExtensionLearningMaterialContent } from '../chromeExtensionLearningSchemas'
import { STEP_UNDERSTANDING_NODE_FILE } from '../constants'
import type { NodeServerLearningMaterialContent } from '../nodeServerLearningSchemas'
import { RepositoryBookStore } from '../repositoryBook'
import { RepositorySourceService } from '../repositorySource'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { hashSteps } from '../utils/stepUnderstanding'
import { withStorageLock } from '../utils/withStorageLock'

import {
  readerSeams,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { POPUP_SOURCE_TEXT } from './utils/chromeExtensionHistoryFixture'
import {
  openExtensionReplay,
  writeExtensionHistoryFor,
} from './utils/extensionWorkspaceHarness'
import {
  runScriptHistory,
  scriptMaterialCiting,
} from './utils/nodeScriptHistoryFixture'
import { HANDLER_SOURCE_TEXT } from './utils/nodeServerHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import type { ExtensionScriptStep } from './utils/sealedExtensionHistory'
import { writeServerHistory } from './utils/sealedServerHistory'
import {
  openServerReplay,
  repositoryOf,
  workspaceKeyOf,
} from './utils/serverWorkspaceHarness'
import {
  explainFirstStop,
  lastView,
  saveTwoStopNodeHistory,
} from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/** A saved replay of one family, open in a workspace harness, with the two steps the tests press. */
type OpenedReplay = {
  family: string
  harness: Harness
  studyId: string
  /** The two steps that can be selected, first and second. */
  stepIds: [string, string]
  /** How many steps of the material can be selected. */
  selectableCount: number
  /** The replay's step-understanding file. */
  stepFile: string
  /** Closes the reader and opens the same replay again, as a window reload does for the replay's data. */
  reopen(): Promise<void>
  /** Opens the replay again after the reader was closed. */
  openAgain(): Promise<void>
  /** Does what a learner does besides pressing a check: moves the playhead, plays and pauses. */
  moveAround(): Promise<void>
}

const SERVER_STEP_IDS: [string, string] = ['request', 'stop']

/** The steps `stepUnderstanding` reports for the open replay, or none before they are read. */
function stepView(opened: OpenedReplay) {
  return lastView(opened.harness)?.stepUnderstanding
}

/** One step's entry in the Study message. */
function stepEntry(opened: OpenedReplay, stepId: string) {
  return stepView(opened)?.steps.find((step) => step.stepId === stepId)
}

/** Waits until the replay's decisions were read. */
async function whenRead(opened: OpenedReplay): Promise<void> {
  await waitUntil(
    () => stepView(opened)?.status === 'ready',
    `the ${opened.family}'s step decisions are read`,
    READER_RESULT_BOUND_MS,
  )
}

/** Fixed window in which a close with a held step save must stay pending. */
const HELD_CLOSE_OBSERVATION_WINDOW_MS = 50
/** Fixed window in which no Study message may follow a closed workspace's step save. */
const POST_CLOSE_OBSERVATION_WINDOW_MS = 100

/** Delivers the webview's `step-understanding` message for a step, with fields overridden for a refused one. */
function press(
  opened: OpenedReplay,
  stepId: string,
  understood: boolean,
  overrides: Record<string, unknown> = {},
): void {
  opened.harness.receiveContext({
    type: 'step-understanding',
    revision: lastView(opened.harness)!.revision,
    studyId: opened.studyId,
    stepId,
    // The hash the Study message shows for the step, as the page sends it back; a step the message lacks gets an unrelated hash.
    stepHash: stepEntry(opened, stepId)?.stepHash ?? '0'.repeat(64),
    understood,
    ...overrides,
  })
}

/** Waits until a step reads `understood` in the Study message. */
async function whenMarked(
  opened: OpenedReplay,
  stepId: string,
  understood = true,
): Promise<void> {
  await waitUntil(
    () =>
      stepEntry(opened, stepId)?.understood === understood &&
      stepEntry(opened, stepId)?.saving === false,
    `${stepId} reads ${understood ? 'understood' : 'not understood'}`,
    READER_RESULT_BOUND_MS,
  )
}

const POSITION_MS = 120

/** Moves a Node family's playhead to its next event and back, then plays and pauses; the same moves the learner makes, none of them a check. */
async function moveNodePlayhead(
  harness: Harness,
  studyId: string,
): Promise<void> {
  const before = lastView(harness)?.nodeHistoryPosition?.sequence
  harness.receiveContext({
    type: 'node-history-step',
    revision: lastView(harness)!.revision,
    studyId,
    direction: 'next',
    unit: 'event',
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence !== before &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    'the playhead moved',
    READER_RESULT_BOUND_MS,
  )
  for (const action of ['play', 'pause'] as const) {
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId,
      action,
    })
  }
  harness.receiveContext({
    type: 'node-history-playback',
    revision: lastView(harness)!.revision,
    studyId,
    action: 'seek',
    positionMs: POSITION_MS,
  })
  await waitUntil(
    () => !lastView(harness)?.nodeHistoryPosition?.pending,
    'the seek settled',
    READER_RESULT_BOUND_MS,
  )
}

/** Closes the Node family's reader and opens the replay again from the library. */
async function reopenNodeReplay(
  harness: Harness,
  studyId: string,
): Promise<void> {
  await harness.reader.close()
  await openNodeReplayAgain(harness, studyId)
}

/** Opens a Node family's replay again from the library after the reader was closed. */
async function openNodeReplayAgain(
  harness: Harness,
  studyId: string,
): Promise<void> {
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === studyId &&
      !lastView(harness)?.loading,
    'the replay is shown again',
    READER_RESULT_BOUND_MS,
  )
}

async function openTestReplay(): Promise<OpenedReplay> {
  const harness = await workspaceHarness()
  const store = harness.service.nodeHistoryStore!
  const history = await saveTwoStopNodeHistory(store)
  await explainFirstStop(harness, history)
  await harness.reader.action('retry')
  await harness.reader.open()
  await harness.reader.openLearningReplay(history.studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
      !lastView(harness)?.loading,
    'the test replay is shown',
    READER_RESULT_BOUND_MS,
  )
  return {
    family: 'test replay',
    harness,
    studyId: history.studyId,
    stepIds: ['read', 'keep'],
    selectableCount: 2,
    stepFile: join(
      store.historyDirectory(history.studyId),
      STEP_UNDERSTANDING_NODE_FILE,
    ),
    reopen: (): Promise<void> => reopenNodeReplay(harness, history.studyId),
    openAgain: (): Promise<void> =>
      openNodeReplayAgain(harness, history.studyId),
    moveAround: (): Promise<void> => moveNodePlayhead(harness, history.studyId),
  }
}

function serverMaterial(sequences: {
  request: number
  stops: number[]
  response?: number
}): NodeServerLearningMaterialContent {
  const step = (
    id: string,
    explanation: string,
    reference: NodeServerLearningMaterialContent['steps'][number]['reference'],
  ) => ({
    id,
    from: 'server',
    to: 'server',
    label: id,
    explanation,
    evidence: 'observed' as const,
    reference,
  })
  return {
    question: 'How does the server create an item?',
    title: 'Creating an item',
    summary: 'The handler creates the item and answers.',
    participants: [{ id: 'server', label: 'Handler' }],
    steps: [
      step('request', 'Codebook sends the request.', {
        type: 'request',
        sequence: sequences.request,
      }),
      step('stop', 'The handler stops at its first line.', {
        type: 'stop',
        sequence: sequences.stops[0]!,
        sourceHash: sha256(HANDLER_SOURCE_TEXT),
      }),
      step('response', 'The server answers with the item.', {
        type: 'response',
        sequence: sequences.response!,
      }),
    ],
  }
}

async function openServerFamily(): Promise<OpenedReplay> {
  const harness = await workspaceHarness()
  const repository = repositoryOf(harness)
  const { header, sequences } = await writeServerHistory(repository, {
    workspaceKey: workspaceKeyOf(harness),
    output: ['saved\n'],
  })
  await repository.serverHistories.saveLearningMaterial(
    header.studyId,
    0,
    serverMaterial(sequences),
  )
  await openServerReplay(harness, header.studyId)
  return {
    family: 'server replay',
    harness,
    studyId: header.studyId,
    stepIds: SERVER_STEP_IDS,
    selectableCount: 3,
    stepFile: join(
      repository.serverHistories.historyDirectory(header.studyId),
      STEP_UNDERSTANDING_NODE_FILE,
    ),
    reopen: (): Promise<void> => reopenNodeReplay(harness, header.studyId),
    openAgain: (): Promise<void> =>
      openNodeReplayAgain(harness, header.studyId),
    moveAround: (): Promise<void> => moveNodePlayhead(harness, header.studyId),
  }
}

async function openScriptFamily(context: TestContext): Promise<OpenedReplay> {
  const harness = await workspaceHarness()
  const repository = repositoryOf(harness)
  const { studyId } = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [0],
      output: ['seeding\n'],
      end: {
        kind: 'exited',
        exitCode: 0,
        stopsReached: [0],
        stopsNeverReached: [],
      },
    },
    repository,
  )
  const { entries } = await repository.scriptHistories.read(studyId)
  const of = (type: 'stop' | 'end') =>
    entries.filter((entry) => entry.type === type).map((e) => e.sequence)
  await repository.scriptHistories.saveLearningMaterial(
    studyId,
    0,
    scriptMaterialCiting([
      {
        type: 'stop',
        sequence: of('stop')[0]!,
        sourceHash: sha256(HANDLER_SOURCE_TEXT),
      },
      { type: 'end', sequence: of('end')[0]! },
    ]),
  )
  await openServerReplay(harness, studyId)
  return {
    family: 'script replay',
    harness,
    studyId,
    stepIds: ['step-1', 'step-2'],
    selectableCount: 2,
    stepFile: join(
      repository.scriptHistories.historyDirectory(studyId),
      STEP_UNDERSTANDING_NODE_FILE,
    ),
    reopen: (): Promise<void> => reopenNodeReplay(harness, studyId),
    openAgain: (): Promise<void> => openNodeReplayAgain(harness, studyId),
    moveAround: (): Promise<void> => moveNodePlayhead(harness, studyId),
  }
}

const EXTENSION_RUN: ExtensionScriptStep[] = [
  { at: 10, type: 'frame', kind: 'stream', salt: 'a' },
  { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 101, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 110, type: 'frame', kind: 'pin', pauseId: 'p1', salt: 'pin' },
  { at: 200, type: 'close', pauseId: 'p1' },
  {
    at: 300,
    type: 'frame',
    kind: 'stream',
    salt: 'b',
    width: 400,
    height: 300,
  },
  {
    at: 350,
    type: 'frame',
    kind: 'stream',
    salt: 'c',
    width: 800,
    height: 500,
  },
  {
    at: 1550,
    type: 'open',
    pauseId: 'p2',
    stopIndex: 2,
    context: 'service-worker',
  },
  {
    at: 1551,
    type: 'capture',
    pauseId: 'p2',
    stopIndex: 2,
    context: 'service-worker',
  },
  { at: 1700, type: 'close', pauseId: 'p2' },
  { at: 1800, type: 'result' },
]

function extensionMaterial() {
  const step = (
    id: string,
    reference: ChromeExtensionLearningMaterialContent['steps'][number]['reference'],
  ) => ({
    id,
    from: 'extension',
    to: 'extension',
    label: `Step ${id}`,
    explanation: `Explains ${id}.`,
    evidence: 'observed' as const,
    reference,
  })
  return {
    question: 'Why does Save fail?',
    title: 'Saving a note',
    summary: 'The popup asks the worker to save and the page shows the answer.',
    participants: [{ id: 'extension', label: 'Extension' }],
    steps: [
      step('page-stop', {
        type: 'stop' as const,
        sequence: 3,
        sourceHash: sha256(POPUP_SOURCE_TEXT),
        context: 'page',
      }),
      step('worker-pause', {
        type: 'pause' as const,
        sequence: 8,
        context: 'service-worker',
      }),
      step('result', { type: 'result' as const, sequence: 11 }),
    ],
  } satisfies ChromeExtensionLearningMaterialContent
}

async function openExtensionFamily(): Promise<OpenedReplay> {
  const harness = await workspaceHarness()
  const history = await writeExtensionHistoryFor(harness, EXTENSION_RUN)
  const repository = repositoryOf(harness)
  await repository.extensionHistories.saveLearningMaterial(
    history.studyId,
    0,
    extensionMaterial(),
  )
  await openExtensionReplay(harness, history.studyId)
  return {
    family: 'extension replay',
    harness,
    studyId: history.studyId,
    stepIds: ['page-stop', 'worker-pause'],
    selectableCount: 3,
    stepFile: join(
      repository.extensionHistories.historyDirectory(history.studyId),
      STEP_UNDERSTANDING_NODE_FILE,
    ),
    reopen: (): Promise<void> => reopenNodeReplay(harness, history.studyId),
    openAgain: (): Promise<void> =>
      openNodeReplayAgain(harness, history.studyId),
    moveAround: (): Promise<void> => moveNodePlayhead(harness, history.studyId),
  }
}

const families: {
  name: string
  open: (context: TestContext) => Promise<OpenedReplay>
}[] = [
  { name: 'test replay', open: () => openTestReplay() },
  { name: 'server replay', open: () => openServerFamily() },
  { name: 'script replay', open: (context) => openScriptFamily(context) },
  { name: 'extension replay', open: () => openExtensionFamily() },
]

for (const family of families) {
  // Value: protects=a learner's press saving one step of a Node family's replay and the step returning after the replay is opened again; fails_when=the press marks no step, marks the other step, the progress line misses it, the whole-history decision changes, or the mark is lost on reopen; no_claim=the webview's drawing of the check (Reader DOM) and a real window reload (native)
  test(`${family.name}: pressing a step's check saves that step alone, leaves the whole-history decision unchanged and survives reopening`, async (context) => {
    // Arrange
    const opened = await family.open(context)
    try {
      await whenRead(opened)
      const [first, second] = opened.stepIds
      const decisionBefore = JSON.stringify(
        lastView(opened.harness)?.nodeHistoryLearningDecision ?? null,
      )

      // Act
      press(opened, first, true)
      await whenMarked(opened, first)

      // Assert
      assert.equal(stepEntry(opened, first)?.understood, true)
      assert.match(stepEntry(opened, first)?.at ?? '', /^\d{4}-\d\d-\d\dT/)
      assert.equal(stepEntry(opened, second)?.understood, false)
      assert.equal(stepView(opened)?.understoodCount, 1)
      assert.equal(stepView(opened)?.selectableCount, opened.selectableCount)
      assert.equal(existsSync(opened.stepFile), true)
      assert.equal(
        JSON.stringify(
          lastView(opened.harness)?.nodeHistoryLearningDecision ?? null,
        ),
        decisionBefore,
      )
      assert.equal(
        existsSync(join(dirname(opened.stepFile), 'learning-decision.json')),
        false,
      )

      // Act: the replay is closed and opened again.
      await opened.reopen()
      await whenRead(opened)

      // Assert
      assert.equal(stepEntry(opened, first)?.understood, true)
      assert.equal(stepEntry(opened, second)?.understood, false)
      assert.equal(stepView(opened)?.understoodCount, 1)

      // Act: the learner unchecks the step again.
      press(opened, first, false)
      await whenMarked(opened, first, false)

      // Assert
      assert.equal(stepView(opened)?.understoodCount, 0)
    } finally {
      await opened.harness.close()
    }
  })

  // Value: protects=refusals that write nothing and say why; fails_when=a message for a step the material lacks, for another study or from an older revision writes a decision, or the learner is not told which; no_claim=the webview's wording of the line
  test(`${family.name}: a press for an unknown step, another study or an older revision writes nothing and names why`, async (context) => {
    // Arrange
    const opened = await family.open(context)
    try {
      await whenRead(opened)

      // Act
      press(opened, 'ghost-step', true)
      await waitUntil(
        () =>
          lastView(opened.harness)?.nodeHistoryRefusal !== undefined ||
          (lastView(opened.harness)?.errors ?? []).some((line) =>
            /saved material/.test(line),
          ),
        'the unknown step is refused',
        READER_RESULT_BOUND_MS,
      )
      const unknownStepLine = [
        lastView(opened.harness)?.nodeHistoryRefusal ?? '',
        ...(lastView(opened.harness)?.errors ?? []),
      ].join(' | ')
      press(opened, opened.stepIds[0], true, {
        studyId:
          '99999999-9999-4999-8999-999999999999_88888888-8888-4888-8888-888888888888',
      })
      await waitUntil(
        () =>
          [
            lastView(opened.harness)?.nodeHistoryRefusal ?? '',
            ...(lastView(opened.harness)?.errors ?? []),
          ].some((line) => /not the one shown/.test(line)),
        'the other study is refused',
        READER_RESULT_BOUND_MS,
      )
      // A revision other than the displayed one: an older one where the replay has had one, else the next.
      const shownRevision = lastView(opened.harness)!.revision
      press(opened, opened.stepIds[0], true, {
        revision: shownRevision > 0 ? shownRevision - 1 : shownRevision + 1,
      })
      await waitUntil(
        () => Boolean(stepEntry(opened, opened.stepIds[0])?.failure),
        'the old revision is refused on its step',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.match(unknownStepLine, /saved material/)
      assert.equal(
        stepEntry(opened, opened.stepIds[0])?.failure,
        'The displayed study changed. Inspect the current view before acting.',
      )
      assert.equal(stepEntry(opened, opened.stepIds[1])?.failure, undefined)
      assert.equal(stepView(opened)?.understoodCount, 0)
      assert.equal(existsSync(opened.stepFile), false)
    } finally {
      await opened.harness.close()
    }
  })

  // Value: protects=only the learner's press writing a step decision; fails_when=moving, playing, seeking, saving the whole-history check or saving the AI's material writes a step decision; no_claim=a Wiki update (browser recording test) and the MCP tool list (service tests)
  test(`${family.name}: moving the playhead, playing, saving understanding and saving material write no step decision`, async (context) => {
    // Arrange
    const opened = await family.open(context)
    try {
      await whenRead(opened)

      // Act
      await opened.moveAround()
      opened.harness.receiveContext({
        type: 'node-history-understanding',
        revision: lastView(opened.harness)!.revision,
        studyId: opened.studyId,
        understood: true,
      })
      await waitUntil(
        () =>
          lastView(opened.harness)?.nodeHistoryLearningDecision?.understood ===
          true,
        'the whole-history decision is saved',
        READER_RESULT_BOUND_MS,
      )
      const material = await repositoryOf(opened.harness)
        .resolve(opened.studyId)
        ?.store.readLearningMaterial(opened.studyId)
      opened.harness.reader.nodeHistoryLearningMaterialSaved(
        opened.studyId,
        material!,
      )
      await opened.harness.reader.action('retry')

      // Assert
      assert.equal(existsSync(opened.stepFile), false)
      assert.equal(stepView(opened)?.understoodCount, 0)
    } finally {
      await opened.harness.close()
    }
  })
}

// Value: protects=the step progress counting only the steps a learner can select, so a step with no recorded event never holds it below full; fails_when=the progress counts an unreferenced unknown step (shows "0 of 2" or stays at "1 of 2" after the reachable step is checked), or a press for that step is saved or goes unexplained; no_claim=the webview's drawing of the progress line (Reader DOM) and the other Node families' mapping (their projections)
test('test replay: a step with no recorded event is left out of the step progress and its check is refused', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveTwoStopNodeHistory(store)
    await harness.service.explainNodeHistory({
      studyId: history.studyId,
      expectedRevision: 0,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'The first stop shows nextTheme is dark.',
            evidence: 'observed',
            reference: {
              type: 'stop',
              sequence: 2,
              sourceHash: history.configuration.source.hash,
            },
          },
          {
            id: 'unrecorded',
            from: 'theme',
            to: 'theme',
            label: 'Guess the cause',
            explanation: 'Nothing recorded shows why the theme stays.',
            evidence: 'unknown',
          },
        ],
      },
    })
    await harness.reader.action('retry')
    await harness.reader.open()
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      READER_RESULT_BOUND_MS,
    )
    const opened: OpenedReplay = {
      family: 'test replay',
      harness,
      studyId: history.studyId,
      stepIds: ['read', 'unrecorded'],
      selectableCount: 1,
      stepFile: join(
        store.historyDirectory(history.studyId),
        STEP_UNDERSTANDING_NODE_FILE,
      ),
      reopen: (): Promise<void> => reopenNodeReplay(harness, history.studyId),
      openAgain: (): Promise<void> =>
        openNodeReplayAgain(harness, history.studyId),
      moveAround: (): Promise<void> =>
        moveNodePlayhead(harness, history.studyId),
    }
    await whenRead(opened)

    // Assert: the unreachable step is not counted before any press.
    assert.equal(stepView(opened)?.selectableCount, 1)
    assert.equal(stepView(opened)?.understoodCount, 0)

    // Act: the learner checks the one step that has a position.
    press(opened, 'read', true)
    await whenMarked(opened, 'read')

    // Assert
    assert.equal(stepView(opened)?.understoodCount, 1)
    assert.equal(stepView(opened)?.selectableCount, 1)

    // Act: a press names the step that has no recorded position.
    const stepFileBefore = await readFile(opened.stepFile, 'utf8')
    press(opened, 'unrecorded', true)
    await waitUntil(
      () =>
        [
          lastView(harness)?.nodeHistoryRefusal ?? '',
          ...(lastView(harness)?.errors ?? []),
        ].some((line) =>
          line.includes(
            'This step has no recorded position, so it has no understanding check.',
          ),
        ),
      'the unreferenced step is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(await readFile(opened.stepFile, 'utf8'), stepFileBefore)
    assert.equal(stepView(opened)?.understoodCount, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's material update never being marked understood unseen: a press carrying the hash of the step the page drew is refused once that step changed, though the Study revision did not; fails_when=the press is saved under the new version's hash, the step reads understood, or the refusal is not shown on that step's state line; no_claim=the page sending the hash (Reader DOM) and a press that arrives before the update (saved under the old hash, the revision tests below)
test('test replay: a press of a step whose material was revised after the page drew it is refused and writes nothing', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const shownHash = stepEntry(opened, 'read')?.stepHash
    const sourceHash = sha256('const nextTheme = "dark";\n')

    // Act: the agent saves material whose first step explains something else; the page still draws the old step.
    await opened.harness.service.explainNodeHistory({
      studyId: opened.studyId,
      expectedRevision: 1,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'The first stop now shows a different explanation.',
            evidence: 'observed',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
          {
            id: 'keep',
            from: 'theme',
            to: 'theme',
            label: 'Keep the theme',
            explanation: 'applyTheme keeps the theme it read.',
            evidence: 'source-derived',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
        ],
      },
    })
    await waitUntil(
      () =>
        stepEntry(opened, 'read')?.stepHash !== undefined &&
        stepEntry(opened, 'read')?.stepHash !== shownHash,
      'the Study message shows the revised step',
      READER_RESULT_BOUND_MS,
    )
    press(opened, 'read', true, { stepHash: shownHash })
    await waitUntil(
      () => Boolean(stepEntry(opened, 'read')?.failure),
      'the press of the old step is refused on its step',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      stepEntry(opened, 'read')?.failure,
      'The displayed study changed. Inspect the current view before acting.',
    )
    assert.equal(stepEntry(opened, 'read')?.understood, false)
    assert.equal(stepEntry(opened, 'read')?.reviewNeeded, false)
    assert.equal(stepEntry(opened, 'keep')?.failure, undefined)
    assert.equal(stepView(opened)?.understoodCount, 0)
    assert.equal(existsSync(opened.stepFile), false)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a changed step asking for review instead of carrying an old check; fails_when=after the material is revised the changed step still reads understood or loses its time, or the unchanged step loses its check; no_claim=the browser recording, whose material is saved with its study
test('test replay: revising a step after it was marked shows review for that step and keeps the other step’s check', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const [first, second] = opened.stepIds
    press(opened, first, true)
    await whenMarked(opened, first)
    press(opened, second, true)
    await whenMarked(opened, second)
    const markedAt = stepEntry(opened, first)?.at
    const sourceHash = sha256('const nextTheme = "dark";\n')

    // Act: the agent saves new material whose first step explains something else.
    await opened.harness.service.explainNodeHistory({
      studyId: opened.studyId,
      expectedRevision: 1,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'The first stop now shows a different explanation.',
            evidence: 'observed',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
          {
            id: 'keep',
            from: 'theme',
            to: 'theme',
            label: 'Keep the theme',
            explanation: 'applyTheme keeps the theme it read.',
            evidence: 'source-derived',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
        ],
      },
    })
    await waitUntil(
      () => stepEntry(opened, first)?.reviewNeeded === true,
      'the revised step asks for review',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(stepEntry(opened, first)?.understood, false)
    assert.equal(stepEntry(opened, first)?.reviewAt, markedAt)
    assert.equal(stepEntry(opened, second)?.understood, true)
    assert.equal(stepEntry(opened, second)?.reviewNeeded, false)
    assert.equal(stepView(opened)?.understoodCount, 1)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a press that is queued ahead of a revision on the storage lock keeping the hash of the step the learner saw, and that step then reading as review; fails_when=the stored decision carries the revised step's hash, or the revised step reads understood; no_claim=hash at arrival versus hash at write (the next test holds the write after the revision has landed)
test('test replay: a press queued ahead of a revision on the storage lock keeps the hash of the step the learner saw and shows review', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const [first] = opened.stepIds
    const store = opened.harness.service.nodeHistoryStore!
    const sourceHash = sha256('const nextTheme = "dark";\n')
    let revised!: Promise<unknown>

    // Act: the storage lock is held, the press waits for it, and the material is revised behind it.
    await withStorageLock(store.learningDirectory, async () => {
      press(opened, first, true)
      await waitUntil(
        () => stepEntry(opened, first)?.saving === true,
        'the press is saving',
        READER_RESULT_BOUND_MS,
      )
      revised = opened.harness.service.explainNodeHistory({
        studyId: opened.studyId,
        expectedRevision: 1,
        content: {
          question: 'Where does the test switch the theme?',
          title: 'Theme switch',
          summary: 'The test reads the next theme twice and passes.',
          participants: [
            { id: 'test', label: 'Theme test' },
            { id: 'theme', label: 'applyTheme' },
          ],
          steps: [
            {
              id: 'read',
              from: 'test',
              to: 'theme',
              label: 'Read the next theme',
              explanation: 'This explanation changed while the press waited.',
              evidence: 'observed',
              reference: { type: 'stop', sequence: 2, sourceHash },
            },
            {
              id: 'keep',
              from: 'theme',
              to: 'theme',
              label: 'Keep the theme',
              explanation: 'applyTheme keeps the theme it read.',
              evidence: 'source-derived',
              reference: { type: 'stop', sequence: 2, sourceHash },
            },
          ],
        },
      })
    })
    await revised
    await waitUntil(
      () =>
        stepEntry(opened, first)?.saving === false &&
        stepEntry(opened, first)?.reviewNeeded === true,
      'the saved press shows review for the revised step',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const stored = JSON.parse(await readFile(opened.stepFile, 'utf8'))
    assert.equal(stored.decisions.length, 1)
    assert.equal(stored.decisions[0].stepId, first)
    assert.equal(stored.decisions[0].understood, true)
    assert.equal(stepEntry(opened, first)?.understood, false)
    assert.equal(stepView(opened)?.understoodCount, 0)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a decision hashed from the step as it was when the learner pressed, not when the write runs; fails_when=a write that runs after the material was revised stores the revised step's hash, so the revised step reads understood without the learner having seen it; no_claim=lock ordering between a press and a revision (the test before)
test('test replay: a press whose write runs after the material was revised keeps the hash of the step the learner saw', async (context) => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const [first] = opened.stepIds
    const store = opened.harness.service.nodeHistoryStore!
    const original = store.saveStepUnderstanding.bind(store)
    const materialBefore = await repositoryOf(opened.harness)
      .resolve(opened.studyId)
      ?.store.readLearningMaterial(opened.studyId)
    const hashSeen = hashSteps(materialBefore!.content.steps).find(
      (value) => value.stepId === first,
    )!.stepHash
    const sourceHash = sha256('const nextTheme = "dark";\n')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    context.mock.method(
      store,
      'saveStepUnderstanding',
      async (...input: Parameters<typeof original>) => {
        await gate
        return original(...input)
      },
    )

    // Act: the press arrives, its write is held, and the material is revised before the write runs.
    press(opened, first, true)
    await waitUntil(
      () => stepEntry(opened, first)?.saving === true,
      'the press is saving',
      READER_RESULT_BOUND_MS,
    )
    await opened.harness.service.explainNodeHistory({
      studyId: opened.studyId,
      expectedRevision: 1,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'This explanation changed before the write ran.',
            evidence: 'observed',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
          {
            id: 'keep',
            from: 'theme',
            to: 'theme',
            label: 'Keep the theme',
            explanation: 'applyTheme keeps the theme it read.',
            evidence: 'source-derived',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
        ],
      },
    })
    release()
    await waitUntil(
      () =>
        stepEntry(opened, first)?.saving === false &&
        stepEntry(opened, first)?.reviewNeeded === true,
      'the saved press shows review for the revised step',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const stored = JSON.parse(await readFile(opened.stepFile, 'utf8'))
    assert.equal(stored.decisions.length, 1)
    assert.equal(stored.decisions[0].stepHash, hashSeen)
    assert.equal(stepEntry(opened, first)?.understood, false)
    assert.equal(stepView(opened)?.understoodCount, 0)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=the AI's material save never writing a step decision, asserted on the file; fails_when=an MCP explain call creates the step file or changes a stored decision's bytes; no_claim=the tool list and result flags (service tests)
test('test replay: an MCP explain call leaves the step file’s bytes unchanged', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    press(opened, opened.stepIds[1], true)
    await whenMarked(opened, opened.stepIds[1])
    const bytesBefore = await readFile(opened.stepFile, 'utf8')
    const sourceHash = sha256('const nextTheme = "dark";\n')

    // Act: the agent revises the first step's explanation through the MCP tool.
    const result = await opened.harness.service.explainNodeHistory({
      studyId: opened.studyId,
      expectedRevision: 1,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'The agent explains the first stop differently.',
            evidence: 'observed',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
          {
            id: 'keep',
            from: 'theme',
            to: 'theme',
            label: 'Keep the theme',
            explanation: 'applyTheme keeps the theme it read.',
            evidence: 'source-derived',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
        ],
      },
    })
    await opened.harness.reader.action('retry')

    // Assert
    assert.equal(result.revision, 2)
    assert.equal(await readFile(opened.stepFile, 'utf8'), bytesBefore)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a damaged step file disabling the checks instead of reading as no decisions, and a repaired file enabling them without reopening; fails_when=an unreadable file reads as ready with no decisions, a press overwrites it, or the replay needs reopening after the repair; no_claim=the pane's wording (Reader DOM)
test('test replay: an unreadable step file reports unreadable, refuses a press and reads again once it is repaired', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    await writeFile(opened.stepFile, '{broken')

    // Act: the playhead moves, which asks for a fresh read.
    await moveNodePlayhead(opened.harness, opened.studyId)
    await waitUntil(
      () => stepView(opened)?.status === 'unreadable',
      'the damaged file reads as unreadable',
      READER_RESULT_BOUND_MS,
    )
    // The webview draws its progress line only for status ready, so an unreadable file must carry no decision that could read as "0 of m".
    const unreadableView = stepView(opened)
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () =>
        [
          lastView(opened.harness)?.nodeHistoryRefusal ?? '',
          ...(lastView(opened.harness)?.errors ?? []),
        ].some((line) => /could not be read/.test(line)),
      'the press is refused',
      READER_RESULT_BOUND_MS,
    )
    const untouched = await readFile(opened.stepFile, 'utf8')
    await writeFile(
      opened.stepFile,
      JSON.stringify({
        version: 1,
        studyId: opened.studyId,
        decisions: [],
      }),
    )
    await moveNodePlayhead(opened.harness, opened.studyId)
    await whenRead(opened)

    // Assert
    assert.equal(unreadableView?.status, 'unreadable')
    assert.equal(
      unreadableView?.steps.every(
        (step) =>
          !step.understood &&
          !step.saving &&
          !step.reviewNeeded &&
          step.failure === undefined,
      ),
      true,
    )
    assert.equal(untouched, '{broken')
    assert.equal(stepView(opened)?.status, 'ready')
  } finally {
    await opened.harness.close()
  }
})

const BROWSER_STEPS: [string, string] = ['select', 'apply']

/** A browser recording whose agent explained its one stop with three steps: two cite the stop and so have a recorded position, one is unknown and has none. */
async function openBrowserFamily(): Promise<OpenedReplay> {
  const harness = await recordedReaderHarness(
    true,
    false,
    1,
    async (stopped) => {
      const { service } = stopped
      const record = [...service.records.values()][0]!
      const snapshotUri = service.state(record).observations[0]!.snapshotUri
      const sourceHash = stopped.runtimes[0]!.snapshots[0]!.source.hash
      stopped.clock(150)
      await service.explain({
        instanceId: service.instanceId,
        runId: record.id,
        snapshotUri,
        sourceHash,
        valuePaths: ['value:nextTheme'],
        key: 'explanation',
        interpretation: 'The theme is read before the click applies it.',
        learningSummary: {
          question: 'How does the selected theme reach the interface?',
          title: 'Theme selection',
          summary: 'The recorded stop holds the selected dark theme.',
          participants: [
            { id: 'control', label: 'Theme control' },
            { id: 'interface', label: 'Interface' },
          ],
          steps: [
            {
              id: 'select',
              from: 'control',
              to: 'interface',
              label: 'Selected theme',
              explanation: 'The stop records nextTheme as dark.',
              evidence: 'observed',
              reference: { snapshotUri, sourceHash },
            },
            {
              id: 'apply',
              from: 'interface',
              to: 'interface',
              label: 'Applied theme',
              explanation: 'The interface applies the dark theme.',
              evidence: 'source-derived',
              reference: { snapshotUri, sourceHash },
            },
            {
              id: 'later',
              from: 'interface',
              to: 'interface',
              label: 'Later rendering',
              explanation: 'No later stop was captured.',
              evidence: 'unknown',
            },
          ],
        },
      })
    },
  )
  const { service, record, controller, studyId } = harness
  await readerSeams(harness).refresh()
  await waitUntil(
    () =>
      service.state(record).historyOutcome.status === 'saved' &&
      service.state(record).recording.contextStatus === 'saved',
    'the explanation is saved with the recording context',
    READER_RESULT_BOUND_MS,
  )
  const open = async (): Promise<void> => {
    await harness.reader.openRecording(studyId)
    await controller.settle()
    await waitUntil(
      () => lastView(harness)?.recording?.learningSummary !== undefined,
      'the saved learning summary is shown',
      READER_RESULT_BOUND_MS,
    )
  }
  await open()
  return {
    family: 'browser recording',
    harness,
    studyId,
    stepIds: BROWSER_STEPS,
    selectableCount: 2,
    stepFile: join(
      harness.reader.inspect().libraryDirectory!,
      `${studyId}.steps.v1.json`,
    ),
    reopen: async (): Promise<void> => {
      await harness.reader.close()
      await open()
    },
    openAgain: open,
    moveAround: async (): Promise<void> => {
      // The webview's own playback messages, so the reader sees the moves a learner makes.
      harness.receiveContext({
        type: 'playback',
        revision: lastView(harness)!.revision,
        expectedRevision: controller.state().revision,
        action: 'seek',
        positionMs: POSITION_MS,
      })
      await controller.settle()
      harness.receiveContext({
        type: 'playback',
        revision: lastView(harness)!.revision,
        expectedRevision: controller.state().revision,
        action: 'pause',
      })
      await controller.settle()
    },
  }
}

/** Publishes a Repository Wiki book twice in the harness's folder, as the agent's Wiki update does. */
async function updateWiki(
  harness: Harness,
  library: Awaited<ReturnType<Harness['reader']['learningStorage']>>,
): Promise<void> {
  const directory = await realpath(harness.directory)
  const git = promisify(execFile)
  await git('git', ['init', '--quiet', directory])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'src/theme.ts'), 'export const theme = 1\n')
  await git('git', ['add', '--', 'src'], { cwd: directory })
  const sources = new RepositorySourceService(directory)
  const books = new RepositoryBookStore(sources, library)
  try {
    const source = await sources.read('src/theme.ts')
    const document = (title: string) => ({
      title,
      summary: 'Theme behavior',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: [
            { path: source.path, hash: source.hash, startLine: 1, endLine: 1 },
          ],
          observations: [],
        },
      ],
      edges: [],
    })
    await books.publish({
      bookId: 'interface',
      expectedRevision: 0,
      key: 'first',
      document: document('Interface'),
    })
    await books.publish({
      bookId: 'interface',
      expectedRevision: 1,
      key: 'second',
      document: document('Interface, revised'),
    })
  } finally {
    await books.dispose()
  }
}

// Value: protects=a browser recording's per-step check saving one step with the same rules as the Node families; fails_when=the press marks no step or the other step, the progress counts a step with no recorded position, the source-revision check changes, or the mark is lost on reopening; no_claim=the webview's selected-step block (Reader DOM) and a real window reload (native)
test('browser recording: pressing a step’s check saves that step alone, counts only steps with a recorded position and survives reopening', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const [first, second] = opened.stepIds
    const library = await opened.harness.reader.learningStorage()
    const revisionCheckBefore = JSON.stringify(
      lastView(opened.harness)?.model.selectedUnderstanding,
    )
    const outlineBefore = JSON.stringify([
      lastView(opened.harness)?.model.understoodCount,
      lastView(opened.harness)?.model.reviewCount,
      lastView(opened.harness)?.model.progressByItem,
    ])
    const ledgerBefore = JSON.stringify(
      (await library.readProgress()).decisions,
    )

    // Act
    press(opened, first, true)
    await whenMarked(opened, first)

    // Assert
    assert.equal(stepView(opened)?.steps.length, 3)
    assert.equal(stepEntry(opened, second)?.understood, false)
    assert.equal(stepView(opened)?.understoodCount, 1)
    assert.equal(stepView(opened)?.selectableCount, 2)
    assert.equal(existsSync(opened.stepFile), true)
    assert.equal(
      JSON.stringify(lastView(opened.harness)?.model.selectedUnderstanding),
      revisionCheckBefore,
    )
    // The Learning outline's counts and the v4 ledger the Repository Wiki reader's check writes to are unchanged by a step save.
    assert.equal(
      JSON.stringify([
        lastView(opened.harness)?.model.understoodCount,
        lastView(opened.harness)?.model.reviewCount,
        lastView(opened.harness)?.model.progressByItem,
      ]),
      outlineBefore,
    )
    assert.equal(
      JSON.stringify((await library.readProgress()).decisions),
      ledgerBefore,
    )

    // Act: a step with no recorded position has no check.
    press(opened, 'later', true)
    await waitUntil(
      () =>
        [...(lastView(opened.harness)?.errors ?? [])].some((line) =>
          /no recorded position/.test(line),
        ),
      'the unselectable step is refused',
      READER_RESULT_BOUND_MS,
    )

    // Act: the replay is closed and opened again.
    await opened.reopen()
    await whenRead(opened)

    // Assert
    assert.equal(stepEntry(opened, first)?.understood, true)
    assert.equal(stepEntry(opened, second)?.understood, false)
    assert.equal(stepEntry(opened, 'later')?.understood, false)
    assert.equal(stepView(opened)?.understoodCount, 1)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=refusals that write nothing and say why in the browser family; fails_when=an unknown step, another study or an older revision writes a decision or goes unexplained; no_claim=the webview's wording
test('browser recording: a press for an unknown step, another study or an older revision writes nothing and names why', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const lines = () => [...(lastView(opened.harness)?.errors ?? [])]

    // Act
    press(opened, 'ghost-step', true)
    await waitUntil(
      () => lines().some((line) => /saved material/.test(line)),
      'the unknown step is refused',
      READER_RESULT_BOUND_MS,
    )
    press(opened, opened.stepIds[0], true, {
      studyId:
        '99999999-9999-4999-8999-999999999999_88888888-8888-4888-8888-888888888888',
    })
    await waitUntil(
      () => lines().some((line) => /not the one shown/.test(line)),
      'the other study is refused',
      READER_RESULT_BOUND_MS,
    )
    const shownRevision = lastView(opened.harness)!.revision
    press(opened, opened.stepIds[0], true, {
      revision: shownRevision > 0 ? shownRevision - 1 : shownRevision + 1,
    })
    await waitUntil(
      () => Boolean(stepEntry(opened, opened.stepIds[0])?.failure),
      'the old revision is refused on its step',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      stepEntry(opened, opened.stepIds[0])?.failure,
      'The displayed study changed. Inspect the current view before acting.',
    )
    assert.equal(stepEntry(opened, opened.stepIds[1])?.failure, undefined)
    assert.equal(existsSync(opened.stepFile), false)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=only the learner's press writing a step decision in a browser recording; fails_when=a seek, a pause, the source-revision check, a Wiki update or an agent's explanation writes a step decision; no_claim=the MCP tool list (service tests)
test('browser recording: seeking, pausing, the source-revision check and a Wiki update write no step decision', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const library = await opened.harness.reader.learningStorage()

    // Act
    await opened.moveAround()
    opened.harness.receiveContext({
      type: 'understanding',
      revision: lastView(opened.harness)!.revision,
      understood: true,
    })
    await updateWiki(opened.harness, library)
    await opened.harness.reader.action('retry')

    // Assert
    assert.equal(existsSync(opened.stepFile), false)
    assert.equal(stepView(opened)?.understoodCount, 0)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=an MCP playback call never writing a step decision, asserted on the file; fails_when=an MCP seek creates the step file; no_claim=the MCP explain call in a browser recording (service tests)
test('browser recording: an MCP playback call creates no step file', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const playback = opened.harness.service.playbackController!

    // Act
    playback.command({
      action: 'seek',
      studyId: opened.studyId,
      expectedRevision: playback.state().revision,
      positionMs: POSITION_MS,
    })
    await playback.settle()
    await opened.harness.reader.action('retry')

    // Assert
    assert.equal(playback.state().presentedMs, POSITION_MS)
    assert.equal(existsSync(opened.stepFile), false)
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a step press refused while the replay loads, writing nothing and saying why; fails_when=a press during a held presentation is saved, or is dropped without the learner's line; no_claim=the webview disabling the check while loading (Reader DOM)
test('browser recording: a press while the replay is loading writes nothing and says to wait', async (context) => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const held = opened.harness.holdHistoricalDebugPresentation()

    // Act: a seek starts a presentation the editor is slow to load, and the learner presses meanwhile.
    const playback = opened.harness.service.playbackController!
    playback.command({
      action: 'seek',
      studyId: opened.studyId,
      expectedRevision: playback.state().revision,
      positionMs: POSITION_MS,
    })
    await waitUntil(
      () => lastView(opened.harness)?.loading === true,
      'the replay is loading',
      READER_RESULT_BOUND_MS,
    )
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () =>
        [...(lastView(opened.harness)?.errors ?? [])].some((line) =>
          /Wait for the replay to finish loading\./.test(line),
        ),
      'the press is refused while loading',
      READER_RESULT_BOUND_MS,
    )
    held.release()
    await playback.settle()

    // Assert
    assert.equal(existsSync(opened.stepFile), false)
    assert.equal(stepEntry(opened, opened.stepIds[0])?.understood, false)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=a repaired step file showing when the Study panel becomes visible again, without reopening the replay; fails_when=the panel coming back reads nothing, so a damaged file stays unreadable (or a repaired one stays hidden) until the replay is reopened; no_claim=a real editor's visibility events (native)
test('browser recording: showing the Study panel again reads a damaged step file and a repaired one', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    await writeFile(opened.stepFile, '{broken')

    // Act: the panel is hidden and shown again; no playback or selection message is sent.
    opened.harness.hideSummary()
    await opened.harness.reader.showLearningSummary()
    await waitUntil(
      () => stepView(opened)?.status === 'unreadable',
      'the damaged file reads as unreadable when the panel is shown',
      READER_RESULT_BOUND_MS,
    )
    await writeFile(
      opened.stepFile,
      JSON.stringify({ version: 1, studyId: opened.studyId, decisions: [] }),
    )
    opened.harness.hideSummary()
    await opened.harness.reader.showLearningSummary()
    await whenRead(opened)

    // Assert
    assert.equal(stepView(opened)?.status, 'ready')
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a select message reading the step file again; fails_when=choosing a Learning item leaves a damaged file unseen (or a repaired one hidden) until the replay is reopened; no_claim=which item the webview offers
test('browser recording: a select message reads a damaged step file and a repaired one', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const select = (): void =>
      opened.harness.receiveContext({
        type: 'select',
        revision: lastView(opened.harness)!.revision,
        itemId: lastView(opened.harness)!.model.selection.itemId,
      })
    await writeFile(opened.stepFile, '{broken')

    // Act
    select()
    await waitUntil(
      () => stepView(opened)?.status === 'unreadable',
      'the damaged file reads as unreadable after a select message',
      READER_RESULT_BOUND_MS,
    )
    await writeFile(
      opened.stepFile,
      JSON.stringify({ version: 1, studyId: opened.studyId, decisions: [] }),
    )
    select()
    await whenRead(opened)

    // Assert
    assert.equal(stepView(opened)?.status, 'ready')
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a failed save showing on its own step only; fails_when=the failure appears on the other step, the check keeps a mark it did not save, or the file changes; no_claim=which step the webview draws (Reader DOM draws only the selected step's entry)
test('browser recording: a failed save shows its failure on that step alone and writes nothing', async (context) => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const library = await opened.harness.reader.learningStorage()
    context.mock.method(library, 'saveStepUnderstanding', async () => {
      throw new Error("EACCES: permission denied, open '/private/steps.json'")
    })

    // Act
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () => Boolean(stepEntry(opened, opened.stepIds[0])?.failure),
      'the failure reaches its step',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.match(
      stepEntry(opened, opened.stepIds[0])?.failure ?? '',
      /^Not saved: EACCES: permission denied/,
    )
    assert.equal(stepEntry(opened, opened.stepIds[0])?.understood, false)
    assert.equal(stepEntry(opened, opened.stepIds[0])?.saving, false)
    assert.equal(stepEntry(opened, opened.stepIds[1])?.failure, undefined)
    assert.equal(stepEntry(opened, opened.stepIds[1])?.saving, false)
    assert.equal(existsSync(opened.stepFile), false)

    // Act: the next press of that step clears the failure while it saves, and the working store saves it.
    context.mock.restoreAll()
    press(opened, opened.stepIds[0], true)
    await whenMarked(opened, opened.stepIds[0])

    // Assert
    assert.equal(stepEntry(opened, opened.stepIds[0])?.failure, undefined)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=a slow save finishing for its own step after the learner moved the playhead and so asked for a fresh read; fails_when=the other step shows the save or its failure, the read that the move queued returns decisions older than the save, or the first step loses its mark; no_claim=which step the learner selects, which the webview owns in memory (Reader DOM)
test('browser recording: a save that completes after the learner moved the playhead leaves the other step alone and keeps its own mark', async (context) => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const library = await opened.harness.reader.learningStorage()
    const original = library.saveStepUnderstanding.bind(library)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    context.mock.method(
      library,
      'saveStepUnderstanding',
      async (...input: Parameters<typeof original>) => {
        await gate
        return original(...input)
      },
    )

    // Act: the first step saves slowly, the learner moves the playhead (a seek asks for a fresh read), then the save ends.
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () => stepEntry(opened, opened.stepIds[0])?.saving === true,
      'the first step is saving',
      READER_RESULT_BOUND_MS,
    )
    await opened.moveAround()
    const secondWhileSaving = { ...stepEntry(opened, opened.stepIds[1]) }
    release()
    await whenMarked(opened, opened.stepIds[0])

    // Assert
    assert.equal(secondWhileSaving.saving, false)
    assert.equal(secondWhileSaving.failure, undefined)
    assert.equal(secondWhileSaving.understood, false)
    assert.equal(stepEntry(opened, opened.stepIds[1])?.understood, false)
    assert.equal(stepEntry(opened, opened.stepIds[1])?.saving, false)
    assert.equal(stepEntry(opened, opened.stepIds[1])?.failure, undefined)
    assert.equal(stepEntry(opened, opened.stepIds[0])?.understood, true)
    assert.equal(stepView(opened)?.understoodCount, 1)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=a step save still waiting when the Study workspace closes being kept by the close's drain, nothing being drawn once the close has ended, and the reopened replay showing the mark; fails_when=the close drops the waiting save, a message is posted within 100 ms after the close, or the reopened replay lacks the mark; no_claim=a message later than the fixed 100 ms observation window (an absence cannot be waited for any longer), a window close (native), a save outlasting the close's storage budget (the sessions tests cover a disposed session's late save)
test('browser recording: closing while a step save waits keeps the save, draws nothing after the close and the reopened replay shows it', async (context) => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    const library = await opened.harness.reader.learningStorage()
    const original = library.saveStepUnderstanding.bind(library)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let written!: Promise<unknown>
    context.mock.method(
      library,
      'saveStepUnderstanding',
      (...input: Parameters<typeof original>) => {
        written = gate.then(() => original(...input))
        return written
      },
    )
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () => stepEntry(opened, opened.stepIds[0])?.saving === true,
      'the first step is saving',
      READER_RESULT_BOUND_MS,
    )

    // Act: the close starts while the save waits; the save is let go, so the close's drain ends with it.
    const closing = opened.harness.reader.close()
    release()
    await closing
    const postedAfterClose = opened.harness.postedMessages().length
    await written
    // The save had ended before the close did; a late message, if the reader were to send one, may come on any later turn or timer, so the count is sampled across a fixed window.
    let postedAfterSave = opened.harness.postedMessages().length
    const windowEnds = Date.now() + POST_CLOSE_OBSERVATION_WINDOW_MS
    while (Date.now() < windowEnds) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      postedAfterSave = Math.max(
        postedAfterSave,
        opened.harness.postedMessages().length,
      )
    }
    context.mock.restoreAll()
    await opened.openAgain()
    await whenRead(opened)

    // Assert
    assert.equal(postedAfterSave, postedAfterClose)
    assert.equal(stepEntry(opened, opened.stepIds[0])?.understood, true)
    assert.equal(stepEntry(opened, opened.stepIds[0])?.failure, undefined)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=a damaged step file hiding the progress line and disabling the checks instead of reading as "0 of m"; fails_when=an unreadable file reports ready, or a press overwrites it; no_claim=the pane hiding the line (Reader DOM)
test('browser recording: a damaged step file reads as unreadable and a press does not overwrite it', async () => {
  // Arrange
  const opened = await openBrowserFamily()
  try {
    await whenRead(opened)
    await writeFile(opened.stepFile, '{broken')

    // Act
    await opened.moveAround()
    await waitUntil(
      () => stepView(opened)?.status === 'unreadable',
      'the damaged file reads as unreadable',
      READER_RESULT_BOUND_MS,
    )
    // The webview draws its progress line only for status ready, so an unreadable file must carry no decision that could read as "0 of m".
    const unreadableView = stepView(opened)
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () =>
        [...(lastView(opened.harness)?.errors ?? [])].some((line) =>
          /could not be read/.test(line),
        ),
      'the press is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(unreadableView?.status, 'unreadable')
    assert.equal(
      unreadableView?.steps.every(
        (step) =>
          !step.understood &&
          !step.saving &&
          !step.reviewNeeded &&
          step.failure === undefined,
      ),
      true,
    )
    assert.equal(await readFile(opened.stepFile, 'utf8'), '{broken')
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a pressed decision surviving the close of the Study workspace; fails_when=close resolves within the fixed 50 ms window while the save is held (the window is the only way to observe that absence), or the decision is missing from the file once close has resolved; no_claim=the pane after reopening, a close that resolves after the window while still held
test('test replay: closing the Study workspace while a step save is held waits for it and the decision is in the file', async (context) => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const store = opened.harness.service.nodeHistoryStore!
    const original = store.saveStepUnderstanding.bind(store)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = false
    context.mock.method(
      store,
      'saveStepUnderstanding',
      async (...input: Parameters<typeof original>) => {
        started = true
        await gate
        return original(...input)
      },
    )
    press(opened, opened.stepIds[0], true)
    await waitUntil(() => started, 'the save started', READER_RESULT_BOUND_MS)

    // Act
    let closed = false
    const closing = opened.harness.reader.close().then(() => {
      closed = true
    })
    // The save is held, so the close must stay pending across a real time window, not merely one microtask order.
    await new Promise((resolve) =>
      setTimeout(resolve, HELD_CLOSE_OBSERVATION_WINDOW_MS),
    )
    const closedWhileHeld = closed
    release()
    await closing

    // Assert
    assert.equal(closedWhileHeld, false)
    assert.equal(closed, true)
    assert.match(await readFile(opened.stepFile, 'utf8'), /"understood": ?true/)
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=the pane always getting an answer to a press, so its check never stays disabled; fails_when=a refused press that changes nothing else posts no Study message; no_claim=the webview clearing aria-disabled (Reader DOM)
test('test replay: a refused press posts a Study message even when the message is the same as the last one', async () => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    press(opened, 'ghost-step', true)
    await waitUntil(
      () => (lastView(opened.harness)?.errors ?? []).length > 0,
      'the first refusal is shown',
      READER_RESULT_BOUND_MS,
    )
    const postedBefore = opened.harness.postedMessages().length

    // Act
    press(opened, 'ghost-step', true)

    // Assert
    await waitUntil(
      () => opened.harness.postedMessages().length > postedBefore,
      'the repeated refusal is answered with a message',
      READER_RESULT_BOUND_MS,
    )
  } finally {
    await opened.harness.close()
  }
})

// Value: protects=a refusal raised while a step save runs staying shown when the save ends; fails_when=the old save's end erases the newer refusal; no_claim=refusals that existed before the press (retired by the next handled press)
test('test replay: a step save that ends after a newer refusal keeps that refusal shown', async (context) => {
  // Arrange
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    const store = opened.harness.service.nodeHistoryStore!
    const original = store.saveStepUnderstanding.bind(store)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    context.mock.method(
      store,
      'saveStepUnderstanding',
      async (...input: Parameters<typeof original>) => {
        await gate
        return original(...input)
      },
    )
    press(opened, opened.stepIds[0], true)
    await waitUntil(
      () => stepEntry(opened, opened.stepIds[0])?.saving === true,
      'the step is saving',
      READER_RESULT_BOUND_MS,
    )
    // A Node history control of an older revision is refused while the save waits.
    opened.harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(opened.harness)!.revision + 1,
      studyId: opened.studyId,
      direction: 'next',
      unit: 'event',
    })
    await waitUntil(
      () => lastView(opened.harness)?.nodeHistoryRefusal !== undefined,
      'the newer refusal is shown',
      READER_RESULT_BOUND_MS,
    )

    // Act
    release()
    await whenMarked(opened, opened.stepIds[0])

    // Assert
    assert.match(
      lastView(opened.harness)?.nodeHistoryRefusal ?? '',
      /displayed study changed/,
    )
  } finally {
    context.mock.restoreAll()
    await opened.harness.close()
  }
})

// Value: protects=an accepted step press retiring the Node history control refusal shown before it, so a stale refusal does not outlive the learner's next successful action; fails_when=the earlier refusal text is still in the Study message after the accepted press has saved; no_claim=a refusal raised during the save (kept, see the test above), the replay-control family
test('test replay: an accepted step press retires the Node history refusal shown before it', async () => {
  // Arrange: a Node history control of an older revision is refused and its text is shown (the test-replay family keeps it as the node-history-control refusal).
  const opened = await openTestReplay()
  try {
    await whenRead(opened)
    opened.harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(opened.harness)!.revision + 1,
      studyId: opened.studyId,
      direction: 'next',
      unit: 'event',
    })
    await waitUntil(
      () => lastView(opened.harness)?.nodeHistoryRefusal !== undefined,
      'the earlier refusal is shown',
      READER_RESULT_BOUND_MS,
    )

    // Act
    press(opened, opened.stepIds[0], true)
    await whenMarked(opened, opened.stepIds[0])

    // Assert
    await waitUntil(
      () => lastView(opened.harness)?.nodeHistoryRefusal === undefined,
      'the earlier refusal is retired',
      READER_RESULT_BOUND_MS,
    )
    assert.equal(lastView(opened.harness)?.nodeHistoryRefusal, undefined)
  } finally {
    await opened.harness.close()
  }
})
