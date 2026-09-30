import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { nodeTestConfigSchema } from '../nodeTestConfigSchemas'
import type {
  ListVitestTestFilesRequest,
  VitestListedFile,
} from '../utils/listVitestTestFiles'
import { prepareNodeTestLaunch } from '../utils/prepareNodeTestLaunch'

/**
 * Creates a disposable repository holding one cited source, one test file and an owned Vitest of the given version.
 *
 * @param vitestVersion - Version written to the owned `node_modules/vitest/package.json`.
 * @returns The canonical root and hashes needed by a node-test configuration.
 * @example
 * ```ts
 * const repository = await createVitestRepository('5.0.2'); // => { root: '/private/var/.../codebook-node-test-x', ... }
 * ```
 */
async function createVitestRepository(vitestVersion: string) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-test-')),
  )
  const source = 'export function subscribe() { return true }\n'
  const testText = 'import { subscribe } from "./subscribable"\n'
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(join(root, 'src', 'subscribable.ts'), source)
  await writeFile(join(root, 'src', 'subscribable.test.ts'), testText)
  await writeFile(
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'export {}\n',
  )
  await writeFile(
    join(root, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version: vitestVersion }),
  )
  return {
    root,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    testHash: createHash('sha256').update(testText).digest('hex'),
  }
}

/**
 * Stands in for the owned `vitest list --filesOnly`, answering each call in order and recording what was asked.
 *
 * @param answers - The files Vitest reports for the first, second, ... listing.
 * @example
 * ```ts
 * const vitest = scriptedVitestList([[{ file: '/repo/src/a.test.ts' }]]); await vitest.list(request) // => [{ file: '/repo/src/a.test.ts' }]
 * ```
 */
function scriptedVitestList(answers: VitestListedFile[][]) {
  const requests: ListVitestTestFilesRequest[] = []
  return {
    requests,
    list: async (request: ListVitestTestFilesRequest) => {
      requests.push(request)
      const answer = answers[requests.length - 1]
      if (!answer)
        throw new Error(`Unexpected Vitest listing ${requests.length}`)
      return answer
    },
  }
}

test('a cited Vitest 5 test runs only its file with a literal anchored title path and a result report', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('5.0.2')
  const vitest = scriptedVitestList([
    [{ file: join(root, 'src', 'subscribable.test.ts') }],
  ])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscription', 'subscribes once (x) [id].'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  let reportDirectory: string | undefined
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration, vitest.list)
    reportDirectory = launch.report.directory
    // Assert
    assert.equal(
      launch.program,
      join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    )
    assert.deepEqual(launch.args, [
      'run',
      'src/subscribable.test.ts',
      '--inspect-brk',
      '--no-file-parallelism',
      '--testTimeout=600000',
      '--testNamePattern=^subscription > subscribes once \\(x\\) \\[id\\]\\.$',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${launch.report.file}`,
    ])
    assert.deepEqual(vitest.requests, [
      {
        program: launch.program,
        workspace: root,
        filter: 'src/subscribable.test.ts',
        excludes: [],
      },
    ])
    assert.deepEqual(launch.testTitles, [
      'subscription',
      'subscribes once (x) [id].',
    ])
    assert.equal(
      launch.report.file,
      join(launch.report.directory, 'vitest-report.json'),
    )
    assert.equal(
      (await stat(launch.report.directory)).mode & 0o777,
      0o700,
      'the report folder is private to this user',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    if (reportDirectory)
      await rm(reportDirectory, { recursive: true, force: true })
  }
})

test('a cited Vitest 4 test joins its title path with the single space Vitest 4 uses', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('4.1.11')
  const vitest = scriptedVitestList([
    [{ file: join(root, 'src', 'subscribable.test.ts') }],
  ])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscription', 'nested', 'subscribes once'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  let reportDirectory: string | undefined
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration, vitest.list)
    reportDirectory = launch.report.directory
    // Assert
    assert.equal(
      launch.args.find((argument) => argument.startsWith('--testNamePattern=')),
      '--testNamePattern=^subscription nested subscribes once$',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    if (reportDirectory)
      await rm(reportDirectory, { recursive: true, force: true })
  }
})

test('a test title that looks like a Vitest option stays inside the anchored name filter token', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('5.0.2')
  const vitest = scriptedVitestList([
    [{ file: join(root, 'src', 'subscribable.test.ts') }],
  ])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['--config=evil.config.ts'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  let reportDirectory: string | undefined
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration, vitest.list)
    reportDirectory = launch.report.directory
    // Assert
    // Vitest's parser does not take a separate value that begins with "-", so the pattern must share the option's token.
    assert.equal(
      launch.args.includes('--testNamePattern=^--config=evil\\.config\\.ts$'),
      true,
    )
    assert.equal(launch.args.includes('--config=evil.config.ts'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
    if (reportDirectory)
      await rm(reportDirectory, { recursive: true, force: true })
  }
})

test('other test files that contain the cited path are excluded and Vitest must then select only the cited file', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('5.0.2')
  const cited = join(root, 'src', 'subscribable.test.ts')
  const vitest = scriptedVitestList([
    [
      { file: cited },
      { file: join(root, 'src', 'subscribable.test.tsx') },
      {
        file: join(root, 'copy', 'app', '[id]', 'src', 'subscribable.test.ts'),
      },
    ],
    [{ file: cited }],
  ])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscribes once'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  let reportDirectory: string | undefined
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration, vitest.list)
    reportDirectory = launch.report.directory
    // Assert
    const excludes = [
      `${root}/src/subscribable.test.tsx`,
      `${root}/copy/app/\\[id\\]/src/subscribable.test.ts`,
    ]
    assert.deepEqual(
      vitest.requests.map((request) => request.excludes),
      [[], excludes],
    )
    assert.deepEqual(
      launch.args.filter((argument) => argument.startsWith('--exclude=')),
      excludes.map((exclude) => `--exclude=${exclude}`),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    if (reportDirectory)
      await rm(reportDirectory, { recursive: true, force: true })
  }
})

test('a Vitest selection that cannot run the cited file exactly once is refused before launch', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('5.0.2')
  const cited = join(root, 'src', 'subscribable.test.ts'),
    other = join(root, 'copy', 'src', 'subscribable.test.ts')
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscribes once'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  const tooMany = Array.from({ length: 65 }, (_, index) => ({
    file: join(root, `copy${index}`, 'src', 'subscribable.test.ts'),
  }))
  try {
    // Act / Assert
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        configuration,
        scriptedVitestList([[{ file: other }]]).list,
      ),
      /Vitest does not select the cited test file/,
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        configuration,
        scriptedVitestList([
          [
            { file: cited, projectName: 'unit' },
            { file: cited, projectName: 'browser' },
          ],
        ]).list,
      ),
      /belongs to 2 Vitest projects/,
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        configuration,
        scriptedVitestList([
          [{ file: cited }, { file: other }],
          [{ file: cited }, { file: other }],
        ]).list,
      ),
      /Vitest still selects other test files/,
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        configuration,
        scriptedVitestList([[{ file: cited }, ...tooMany]]).list,
      ),
      /65 other test files/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a retired testName or a missing test identity is refused before any Vitest process starts', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('5.0.2')
  const vitest = scriptedVitestList([])
  const base = {
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  }
  try {
    // Act / Assert
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        nodeTestConfigSchema.parse({ ...base, testName: 'subscribes once' }),
        vitest.list,
      ),
      /testName is retired.*testTitles/,
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        nodeTestConfigSchema.parse(base),
        vitest.list,
      ),
      /needs testTitles/,
    )
    assert.equal(vitest.requests.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a repository whose Vitest is older than 4 is refused before any Vitest process starts', async () => {
  // Arrange
  const { root, sourceHash, testHash } = await createVitestRepository('3.2.4')
  const vitest = scriptedVitestList([])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscribes once'],
    testHash,
    source: {
      path: 'src/subscribable.ts',
      hash: sourceHash,
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  try {
    // Act / Assert
    await assert.rejects(
      prepareNodeTestLaunch(root, configuration, vitest.list),
      /Vitest 4 or later.*3\.2\.4/,
    )
    assert.equal(vitest.requests.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a changed source or a symlink escaping the repository cannot start a Node test', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-node-test-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'codebook-node-test-outside-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(join(root, 'src', 'subscribable.ts'), 'changed source\n')
  await writeFile(join(outside, 'subscribable.test.ts'), 'outside test\n')
  await symlink(
    join(outside, 'subscribable.test.ts'),
    join(root, 'src', 'subscribable.test.ts'),
  )
  await writeFile(
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'export {}\n',
  )
  await writeFile(
    join(root, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version: '5.0.2' }),
  )
  const vitest = scriptedVitestList([])
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/subscribable.test.ts',
    testTitles: ['subscribes once'],
    testHash: '0'.repeat(64),
    source: {
      path: 'src/subscribable.ts',
      hash: '0'.repeat(64),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  })
  try {
    // Act / Assert
    await assert.rejects(
      prepareNodeTestLaunch(root, configuration, vitest.list),
      /not a file in the opened repository/,
    )
    await rm(join(root, 'src', 'subscribable.test.ts'))
    await writeFile(join(root, 'src', 'subscribable.test.ts'), 'local test\n')
    await assert.rejects(
      prepareNodeTestLaunch(root, configuration, vitest.list),
      /source changed/,
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        {
          ...configuration,
          source: {
            ...configuration.source,
            hash: createHash('sha256').update('changed source\n').digest('hex'),
          },
        },
        vitest.list,
      ),
      /test file changed/,
    )
    assert.equal(
      vitest.requests.length,
      0,
      'no Vitest process starts for an unverified repository',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a Node test seals every declared source stop before acquiring a process', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-multiple-stops-')),
  )
  const source = 'export const first = 1\nexport const second = 2\n'
  const testText = 'test("two stops", () => undefined)\n'
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(join(root, 'src', 'target.ts'), source)
  await writeFile(join(root, 'src', 'target.test.ts'), testText)
  await writeFile(
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'export {}\n',
  )
  await writeFile(
    join(root, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version: '5.0.2' }),
  )
  const hash = createHash('sha256').update(source).digest('hex')
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile: 'src/target.test.ts',
    testTitles: ['two stops'],
    testHash: createHash('sha256').update(testText).digest('hex'),
    source: { path: 'src/target.ts', hash, line: 1, column: 1 },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
    additionalStops: [
      {
        path: 'src/target.ts',
        hash,
        line: 2,
        column: 1,
        anchorIndex: 0,
        inspections: [{ path: 'listener', mode: 'value', required: true }],
      },
    ],
  })
  let reportDirectory: string | undefined
  try {
    // Act
    const launch = await prepareNodeTestLaunch(
      root,
      configuration,
      scriptedVitestList([[{ file: join(root, 'src', 'target.test.ts') }]])
        .list,
    )
    reportDirectory = launch.report.directory
    // Assert
    assert.deepEqual(
      launch.stops.map((stop) => [stop.source.line, stop.source.column]),
      [
        [1, 1],
        [2, 1],
      ],
    )
    await assert.rejects(
      prepareNodeTestLaunch(
        root,
        {
          ...configuration,
          additionalStops: [
            { ...configuration.additionalStops![0]!, hash: '0'.repeat(64) },
          ],
        },
        scriptedVitestList([]).list,
      ),
      /source changed; declared stop 2/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    if (reportDirectory)
      await rm(reportDirectory, { recursive: true, force: true })
  }
})
