import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { checkNodeTestFiles } from '../utils/checkNodeTestFiles'

const SOURCE_TEXT = 'export const nextRun = schedule(job, 5_000)\n'
const TEST_TEXT = 'test("runs a delayed job after its timer", () => {})\n'

/** A repository holding the job scheduler's source and test, with a configuration citing both by their current hashes. */
async function schedulerRepository(): Promise<{
  root: string
  configuration: NodeTestConfiguration
  cleanup: () => Promise<void>
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-test-files-')),
  )
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'scheduler.ts'), SOURCE_TEXT)
  await writeFile(join(root, 'src', 'scheduler.test.ts'), TEST_TEXT)
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: { bookId: 'scheduler', revision: 1, nodeId: 'timer', anchorIndex: 0 },
    testFile: 'src/scheduler.test.ts',
    testHash: sha256(TEST_TEXT),
    testTitles: ['job scheduler', 'runs a delayed job after its timer'],
    source: {
      path: 'src/scheduler.ts',
      hash: sha256(SOURCE_TEXT),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'nextRun', mode: 'value', required: true }],
  }
  return {
    root,
    configuration,
    cleanup: (): Promise<void> => rm(root, { recursive: true, force: true }),
  }
}

/** Runs the check and returns the typed refusal it throws. */
async function refusalOf(
  root: string,
  configuration: NodeTestConfiguration,
): Promise<StudyError> {
  const error = await checkNodeTestFiles(root, configuration).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return error
}

// Value: protects=the real files a node-test start checks before its history begins; fails_when=a configuration whose paths and hashes match is refused, or a declared stop loses its file; why_new=the checks move from the launch into preparation (EN1); seam=none; no_claim=Vitest's selection of the test
test('a configuration whose test and stop files still have their declared hashes passes the preparation checks', async () => {
  // Arrange
  const { root, configuration, cleanup } = await schedulerRepository()
  try {
    // Act
    const checked = await checkNodeTestFiles(root, configuration)

    // Assert
    assert.equal(checked.root, root)
    assert.equal(checked.testFile, join(root, 'src', 'scheduler.test.ts'))
    assert.deepEqual(
      checked.stops.map((stop) => stop.file),
      [join(root, 'src', 'scheduler.ts')],
    )
  } finally {
    await cleanup()
  }
})

// Value: protects=the typed refusal of a stop whose source changed after the article was published; fails_when=it reads otherwise than the Error contract or carries another code than SOURCE_CHANGED; why_new=the launch threw an untyped "Node test source changed" after the history began (X7, EN1); seam=none; no_claim=the run resource's channel (service tests)
test('a declared stop whose source changed is refused naming the stop, the path and both hashes', async () => {
  // Arrange
  const { root, configuration, cleanup } = await schedulerRepository()
  try {
    await writeFile(
      join(root, 'src', 'scheduler.ts'),
      'export const nextRun = 0\n',
    )

    // Act
    const refusal = await refusalOf(root, configuration)

    // Assert
    assert.equal(refusal.code, 'SOURCE_CHANGED')
    assert.equal(
      refusal.message,
      `node-test preparation refused: declared stop 1 cites src/scheduler.ts with SHA-256 ${sha256(SOURCE_TEXT)}, but the file now has ${sha256('export const nextRun = 0\n')}. Read it with codebook_source, publish the article with the current source, then start with a new key.`,
    )
  } finally {
    await cleanup()
  }
})

// Value: protects=the typed refusal of a changed test file; fails_when=it reads otherwise than the Error contract or carries another code than INVALID_CONFIGURATION; why_new=the launch threw "Node test file changed" without the hashes (X7, EN1); seam=none; no_claim=none beyond protects
test('a changed test file is refused naming its declared and current hashes', async () => {
  // Arrange
  const { root, configuration, cleanup } = await schedulerRepository()
  try {
    await writeFile(join(root, 'src', 'scheduler.test.ts'), 'test.skip("x")\n')

    // Act
    const refusal = await refusalOf(root, configuration)

    // Assert
    assert.equal(refusal.code, 'INVALID_CONFIGURATION')
    assert.equal(
      refusal.message,
      `node-test preparation refused: testHash ${sha256(TEST_TEXT)} does not match src/scheduler.test.ts, which now has SHA-256 ${sha256('test.skip("x")\n')}. Read the test file with codebook_source and start with its current hash and a new key.`,
    )
  } finally {
    await cleanup()
  }
})

// Value: protects=the typed refusal of a path that is not a file, a missing one included; fails_when=a realpath ENOENT reaches the agent as a raw file-system error, or the field is not named; why_new=the launch threw "Node test path is not a file" or a raw ENOENT (X7, EN1); seam=none; no_claim=tracked-file checks (the article's citations)
test('a missing stop file is refused naming its field and path', async () => {
  // Arrange
  const { root, configuration, cleanup } = await schedulerRepository()
  try {
    const missingStop: NodeTestConfiguration = {
      ...configuration,
      source: { ...configuration.source, path: 'src/removed.ts' },
    }

    // Act
    const refusal = await refusalOf(root, missingStop)

    // Assert
    assert.equal(refusal.code, 'INVALID_CONFIGURATION')
    assert.equal(
      refusal.message,
      'node-test preparation refused: source.path src/removed.ts is not a file in the opened repository. Use a tracked path from codebook_sources.',
    )
  } finally {
    await cleanup()
  }
})
