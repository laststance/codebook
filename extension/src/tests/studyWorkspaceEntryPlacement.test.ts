import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_TEST_PROFILE } from '../constants'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import type { NodeTestRuntime } from '../runtime'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'

/**
 * Builds a fake owned Node run with two declared stops and a passing result, as a live test run the workspace's Save acts on.
 * @param source - The cited source of both stops.
 * @param sourceText - The cited source's text, which each stop's debugger snapshot holds so the stop verifies.
 * @returns The run, which pauses at its first stop and reaches the second one when it advances.
 * @example const run = twoStopOwnedRun(configuration.source, sourceText)
 */
function twoStopOwnedRun(
  source: NodeTestConfiguration['source'],
  sourceText: string,
): NodeTestRuntime {
  const stops = [0, 1].map(
    (index) =>
      ({
        index,
        runId: 'node-run',
        sessionId: 'owned-session',
        threadId: 7,
        elapsedMs: 10 + index * 10,
        worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
        source,
        frame: {
          id: 10 + index,
          name: 'schedule',
          line: source.line,
          column: source.column,
        },
        variables: [{ name: 'delayMs', value: '5000', variablesReference: 0 }],
        facts: [
          { path: 'delayMs', mode: 'value', display: '5000', type: 'number' },
        ],
        debuggerSnapshot: {
          version: 1,
          frames: [
            {
              name: 'schedule',
              line: source.line,
              column: source.column,
              source: {
                name: source.path,
                text: sourceText,
                hash: sha256(sourceText),
                line: source.line,
              },
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [
            { name: 'delayMs', value: '5000', type: 'number', children: [] },
          ],
          limitations: [],
        },
      }) satisfies NodeTestSourceStop,
  )
  let cursor = 0
  return {
    id: 'node-run',
    async prepare() {
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor < stops.length - 1
    },
    async advance() {
      return stops[++cursor]!
    },
    async complete() {
      return {
        exitCode: 0,
        signal: null,
        output: 'Tests 1 passed',
        elapsedMs: 40,
      }
    },
    async stop(): Promise<void> {},
  }
}

/**
 * Starts a live test run of two declared stops on a workspace harness and waits for its preparation, so the status bar item and Save act on a run paused at its first stop.
 * @param harness - The workspace harness whose service runs it.
 * @param runName - The start's idempotency key, named by what the run is for.
 * @returns The run's record and its study id.
 * @example const { record, studyId } = await startLiveTestRun(harness, 'closed-pane-save-item')
 */
async function startLiveTestRun(
  harness: Pick<
    Awaited<ReturnType<typeof workspaceHarness>>,
    'service' | 'configuration' | 'directory'
  >,
  runName: string,
) {
  const { service, configuration } = harness
  const sourceText = await readFile(
    join(harness.directory, configuration.source.path),
    'utf8',
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  service.environment.createNodeTestRun = async () =>
    twoStopOwnedRun(configuration.source, sourceText)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: runName,
    configuration: {
      version: 1,
      adapter: 'vitest-node',
      book: configuration.book,
      testFile: 'src/scheduler.test.ts',
      testHash: 'a'.repeat(64),
      testTitles: ['job scheduler', 'runs a delayed job after its timer'],
      source: configuration.source,
      inspections: configuration.inspections.slice(0, 1),
      additionalStops: [
        {
          ...configuration.source,
          anchorIndex: 0,
          inspections: configuration.inspections.slice(0, 1),
        },
      ],
    },
  })
  const record = service.record(receipt)
  await record.preparation
  return { record, studyId: `${service.instanceId}_${record.id}` }
}

// Value: protects=the first Open replay after a node-test run whose live Application pane closed at the run's end and left its empty, locked group at column 1 beside a learner's source group and a Welcome group (F382, VS Code 1.142.0 N50 round 1): the replay is shown with the Application at column 1 and the Study pane, nothing is written as a refused placement, and the learner's Welcome and source tabs stay; fails_when=the first Open replay refuses with the placement sentence, writes a placement-refused entry, shows no replay, or loses the learner's tabs; why_new=Cycle 0050 F382 (the native layout before the press: an empty locked group above the source group and a Welcome group to the right); seam=workspaceHarness with the fake owned Node run, the run's own Application preparation with the reader closed (prepareApplicationGroup), closeApplicationPaneOfEndedRun with refuseNextGroupClose (the group the editor keeps), the diagnostics log; no_claim=this passes on the code of 5868b54, so it does not show F382's cause: the native refusal is not reproduced by the fake editor
test('the first Open replay after a node-test run that left its empty locked Application group shows the replay without a placement refusal', async () => {
  // Arrange: the run's Application stood in its own locked group above the source group; the run ended, the pane closed and the editor kept the emptied group.
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.addOpaqueTab('Welcome', 2)
    const { record, studyId } = await startLiveTestRun(harness, 'f382')
    harness.focusMutableDraft('utils.ts', 1)
    await readerSeams(harness).refresh()
    await harness.reader['prepareApplicationGroup'](
      undefined,
      undefined,
      false,
      undefined,
      true,
    )
    for (const generation of [1, 2])
      await harness.service.continue({
        instanceId: harness.service.instanceId,
        runId: record.id,
        participant: 'server',
        sessionId: 'owned-session',
        threadId: 7,
        generation,
      })
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: record.id,
    })
    await readerSeams(harness).refresh()
    harness.refuseNextGroupClose()
    await harness.reader['closeApplicationPaneOfEndedRun']()
    await harness.reader.saveLearningReplay(studyId)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!

    // Act
    await harness.reader.openLearningReplay(studyId)

    // Assert
    assert.equal(leftover.tabs.length, 1)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      studyId,
    )
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    assert.deepEqual(harness.errorMessages, [])
    const tabLabels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.ok(tabLabels.includes('Welcome'))
    assert.ok(tabLabels.includes('utils.ts'))
  } finally {
    await harness.close()
  }
})

// Value: protects=the first Open replay after Developer: Reload Window left the earlier window's empty, locked Application group at column 1 above the learner's source group, with the Welcome group at the right and the earlier window's record proving that group (F382, VS Code 1.142.0 round 1 and x4): Codebook retires the proven leftover as its own removal, shows the replay, writes nothing as a refused placement, and the learner's Welcome and Notes tabs stay; the Application then shares the source group as it does after a cold open without any leftover; fails_when=the first Open replay refuses with the placement sentence, writes a placement-refused entry, shows no replay, leaves the empty locked group standing, or loses a learner tab; why_new=Cycle 0050 F382 (the native precondition is the editor's restore of the earlier window's group, not a run's leftover); seam=workspaceHarness (a fresh reader over the earlier window's applicationGroupMarkers record), leaveEmptyLockedGroup, the fake owned Node run, focusChatInSecondarySideBar (the chat view has the keyboard), the diagnostics log; no_claim=this passes on the code of c698cbb, so it does not show why the native entry refused: the fake editor reports the removal and the active group in one turn
test('the first Open replay after a window reload retires the restored empty locked Application group and shows the replay without a placement refusal', async () => {
  // Arrange: the editor restored [empty locked group, Notes group, Welcome group]; the earlier window's record proves the first one; a run ended with no Application pane; the chat view has the keyboard.
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.groups[1]!.tabs = []
    harness.addOpaqueTab('Notes', 2)
    harness.addOpaqueTab('Welcome', 3)
    const { record, studyId } = await startLiveTestRun(harness, 'f382-reload')
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    for (const generation of [1, 2])
      await harness.service.continue({
        instanceId: harness.service.instanceId,
        runId: record.id,
        participant: 'server',
        sessionId: 'owned-session',
        threadId: 7,
        generation,
      })
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: record.id,
    })
    await readerSeams(harness).refresh()
    await harness.reader.saveLearningReplay(studyId)
    harness.focusChatInSecondarySideBar()

    // Act
    await harness.reader.openLearningReplay(studyId)

    // Assert
    assert.equal(harness.groups.includes(leftover), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      studyId,
    )
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    assert.deepEqual(harness.errorMessages, [])
    const tabLabels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.ok(tabLabels.includes('Welcome'))
    assert.ok(tabLabels.includes('Notes'))
  } finally {
    await harness.close()
  }
})
