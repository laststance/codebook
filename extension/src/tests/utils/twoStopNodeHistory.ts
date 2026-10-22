import type { NodeTestHistoryStore } from '../../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../../ownedNodeTestRun'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import type { workspaceHarness } from '../studyWorkspaceHarness'

import { nodeTestHistoryHeader } from './nodeTestHistoryFixture'

const SOURCE_TEXT = 'const nextTheme = "dark";\n'

/** The last view the reader posted to its panes. */
export function lastView(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
) {
  return harness.postedMessages().slice(-1)[0]
}

/**
 * Saves a sealed test replay of two stops with output before and between them and a passing result: output 1, stop 2, output 3, stop 4, result 5.
 * @param store - The workspace's history store.
 * @returns The history's header.
 * @example const history = await saveTwoStopNodeHistory(harness.service.nodeHistoryStore!)
 */
export async function saveTwoStopNodeHistory(store: NodeTestHistoryStore) {
  const oneStop = nodeTestHistoryHeader(store.workspaceKey)
  // The second stop is declared at the same line, as a loop's second pass stops there again.
  const configuration = {
    ...oneStop.configuration,
    additionalStops: [
      {
        ...oneStop.configuration.source,
        anchorIndex: 0,
        inspections: oneStop.configuration.inspections,
      },
    ],
  }
  const history = {
    ...oneStop,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
  const writer = await store.start(history)
  const stopAt = (index: number, elapsedMs: number): NodeTestSourceStop => ({
    index,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source: history.configuration.source,
    frame: { id: index + 1, name: 'applyTheme', line: 1, column: 1 },
    variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'applyTheme',
          line: 1,
          column: 1,
          source: {
            name: history.configuration.source.path,
            text: SOURCE_TEXT,
            hash: sha256(SOURCE_TEXT),
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
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 100,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts\n',
  })
  await writer.appendStop(stopAt(0, 200))
  await writer.appendOutput({
    sequence: 2,
    elapsedMs: 250,
    channel: 'stderr',
    text: 'theme switched\n',
  })
  await writer.appendStop(stopAt(1, 300))
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    400,
  )
  await writer.finish('complete')
  return history
}

/**
 * Saves learning material that explains a two-stop test replay's first stop (sequence 2) with two steps, so the stop shows `read` first and `keep` once the learner chooses it; the replay's step ids repeat from one replay to the next, as a chat's explanations of two runs of one test do.
 * @param harness - The workspace harness whose service saves the material.
 * @param history - The replay's header, as {@link saveTwoStopNodeHistory} returns it.
 * @example await explainFirstStop(harness, history)
 */
export async function explainFirstStop(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  history: Awaited<ReturnType<typeof saveTwoStopNodeHistory>>,
): Promise<void> {
  const sourceHash = history.configuration.source.hash
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
}
