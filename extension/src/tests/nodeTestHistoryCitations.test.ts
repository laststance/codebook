import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { NODE_TEST_HISTORY_DIRECTORY } from '../constants'
import type { NodeTestLearningMaterialContent } from '../nodeTestHistorySchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

const SOURCE_TEXT = 'const nextTheme = "dark";\n'

/**
 * Seals a passing test history of three events: stdout output (sequence 1), the declared stop (2) and the result (3).
 * @param context - The test, which removes the folder when it ends.
 * @returns The store, the history's study id and directory, and the source hash its stop cites.
 * @example const { store, studyId } = await sealedPassingHistory(context)
 */
async function sealedPassingHistory(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-citations-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const header = nodeTestHistoryHeader('e'.repeat(64))
  const store = new NodeTestHistoryStore(directory, header.workspaceKey)
  const writer = await store.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 4,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
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
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    6,
  )
  await writer.finish('complete')
  return {
    store,
    directory,
    studyId: header.studyId,
    stopHash: header.configuration.source.hash,
  }
}

/** A learning material with one step that cites the given reference. */
function materialCiting(
  reference: NonNullable<
    NodeTestLearningMaterialContent['steps'][number]['reference']
  >,
): NodeTestLearningMaterialContent {
  return {
    question: 'Why did the selected theme become dark?',
    title: 'Theme update',
    summary: 'The captured stop shows the dark value.',
    participants: [
      { id: 'test', label: 'Vitest test' },
      { id: 'state', label: 'Theme state' },
    ],
    steps: [
      {
        id: 'step-one',
        from: 'test',
        to: 'state',
        label: 'Select theme',
        explanation: 'The native debugger captured the dark value.',
        evidence: 'observed',
        reference,
      },
    ],
  }
}

const REPEATED_ADVICE =
  "Read the history's events again and cite each event by its sequence, type and source hash."

// Value: protects=the three other INVALID_REFERENCE refusals of a saved explanation: a stop cited with another source hash (with the hash the journal holds), a sequence that is no event, and an output cited on the other channel; fails_when=any of them is accepted, loses its code, or words the stop, the sequence or the claim otherwise; why_new=only the result-cited-as-stop case was tested (F27); seam=none; no_claim=the position refusal of codebook_explain (D17)
test('a saved explanation is refused with INVALID_REFERENCE for a stop cited with another source hash, a sequence that is no event and an output on the other channel', async (context) => {
  // Arrange
  const { store, studyId, stopHash } = await sealedPassingHistory(context)
  const otherHash = 'f'.repeat(64)

  // Act
  const refusals = await Promise.all(
    [
      materialCiting({ type: 'stop', sequence: 2, sourceHash: otherHash }),
      materialCiting({ type: 'result', sequence: 9 }),
      materialCiting({ type: 'output', sequence: 1, channel: 'stderr' }),
    ].map((content) =>
      store.saveLearningMaterial(studyId, 0, content).then(
        () => undefined,
        (error: unknown) => error,
      ),
    ),
  )

  // Assert
  assert.deepEqual(
    refusals.map((refusal) =>
      refusal instanceof Error && 'code' in refusal
        ? [refusal.code, refusal.message]
        : refusal,
    ),
    [
      [
        'INVALID_REFERENCE',
        `codebook_explain_node_history refused step step-one: sequence 2 is a stop at src/theme.ts:1 in the sealed history, but the step claims a stop with sourceHash ${otherHash}; expected sourceHash ${stopHash}. ${REPEATED_ADVICE}`,
      ],
      [
        'INVALID_REFERENCE',
        `codebook_explain_node_history refused step step-one: sequence 9 is no event in the sealed history, but the step claims the result. ${REPEATED_ADVICE}`,
      ],
      [
        'INVALID_REFERENCE',
        `codebook_explain_node_history refused step step-one: sequence 1 is an output on stdout in the sealed history, but the step claims an output on stderr. ${REPEATED_ADVICE}`,
      ],
    ],
  )
})

// Value: protects=the wording of a stored explanation that no longer matches its journal when it is only read; fails_when=a read path (the history resource, a summary) says `codebook_explain_node_history refused …` although nobody called that tool; why_new=the shared citation check always carried the tool's prefix (F45); seam=the material file is edited on disk; no_claim=the save path, which keeps the prefix (other test)
test('a stored explanation whose citation no longer matches is refused on a read without naming the explain tool', async (context) => {
  // Arrange
  const { store, directory, studyId } = await sealedPassingHistory(context)
  await store.saveLearningMaterial(
    studyId,
    0,
    materialCiting({ type: 'result', sequence: 3 }),
  )
  const materialPath = join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    studyId,
    'learning-material.json',
  )
  const stored = JSON.parse(await readFile(materialPath, 'utf8'))
  stored.content.steps[0].reference.sequence = 9
  await writeFile(materialPath, JSON.stringify(stored))

  // Act
  const refusal = await store.readLearningMaterial(studyId).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof Error)
  assert.equal(
    refusal.message,
    `Saved learning step step-one: sequence 9 is no event in the sealed history, but the step claims the result. ${REPEATED_ADVICE}`,
  )
})
