import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { launchNodeTest } from '../utils/launchNodeTest'
import type { RootClaimListing } from '../utils/listVitestForRootClaim'
import {
  listVitestTestFiles,
  type ListVitestTestFilesRequest,
} from '../utils/listVitestTestFiles'
import { planNodeTestExecution } from '../utils/planNodeTestExecution'
import {
  prepareNodeTestLaunch,
  type PreparedNodeTestLaunch,
} from '../utils/prepareNodeTestLaunch'

const SOURCE_TEXT = 'export function subscribe() { return true }\n'
const TEST_TEXT = 'import { subscribe } from "./subscribable"\n'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** One start of the stand-in Vitest, as it recorded its arguments and working directory. */
type RecordedVitestCall = { argv: string[]; cwd: string }

/**
 * Builds a repository holding one cited test and its source in `folder`, a sibling copy of the test that Vitest's substring filter also selects, and a stand-in root Vitest 5 that records each start and lists both files until the copy is excluded.
 * @param context - Removes the repository when the test ends.
 * @param folder - The root-relative folder of the test and its source, `.` for the root.
 * @param configFiles - Root-relative config files to write.
 * @returns The real root, the test's configuration and a reader of the stand-in Vitest's starts.
 * @example const repository = await createRepository(context, 'packages/a', ['packages/a/vite.config.ts'])
 */
async function createRepository(
  context: TestContext,
  folder: string,
  configFiles: string[],
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vitest-root-launch-')),
  )
  const calls = `${root}-calls.jsonl`
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(calls, { force: true })
  })
  const testFile =
    folder === '.'
      ? 'src/subscribable.test.ts'
      : `${folder}/src/subscribable.test.ts`
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  await write(testFile.replace('.test.ts', '.ts'), SOURCE_TEXT)
  await write(testFile, TEST_TEXT)
  await write(join(folder, 'copy', 'src', 'subscribable.test.ts'), TEST_TEXT)
  for (const config of configFiles) await write(config, 'export default {}\n')
  const cited = join(root, testFile)
  const copy = join(root, folder, 'copy', 'src', 'subscribable.test.ts')
  await write(
    'node_modules/vitest/package.json',
    JSON.stringify({ name: 'vitest', version: '5.0.2' }),
  )
  await write(
    'node_modules/vitest/vitest.mjs',
    `import { appendFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const output = argv.find((argument) => argument.startsWith('--json='))?.slice('--json='.length);
if (argv[0] === 'list') {
  const excluded = argv.some((argument) => argument.startsWith('--exclude='));
  writeFileSync(output, JSON.stringify(excluded ? [{ file: ${JSON.stringify(cited)} }] : [{ file: ${JSON.stringify(cited)} }, { file: ${JSON.stringify(copy)} }]));
}
`,
  )
  // A plain object, not a schema parse, so its JSON (and hash) has the key order of the fixture at 83a07385.
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: {
      bookId: 'subscription',
      revision: 1,
      nodeId: 'subscribe',
      anchorIndex: 0,
    },
    testFile,
    testTitles: ['subscription', 'subscribes once'],
    testHash: sha256(TEST_TEXT),
    source: {
      path: testFile.replace('.test.ts', '.ts'),
      hash: sha256(SOURCE_TEXT),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  }
  return {
    root,
    configuration,
    calls: async (): Promise<RecordedVitestCall[]> =>
      (await readFile(calls, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line): RecordedVitestCall => JSON.parse(line)),
  }
}

/**
 * Plans, prepares and launches the cited test with the real listing and launch, as the owned run does, and journals the launch's events.
 * @param root - The repository's real root.
 * @param configuration - The cited test's configuration.
 * @param rootClaim - What a root claim's listing answers; the default fails the test when a claim is made.
 * @returns The prepared launch and the journaled events.
 * @example const { launch, events } = await planAndLaunch(root, configuration)
 */
async function planAndLaunch(
  root: string,
  configuration: NodeTestConfiguration,
  rootClaim: () => Promise<RootClaimListing> = async () =>
    assert.fail('this repository makes no root claim'),
) {
  const list = (request: ListVitestTestFilesRequest) =>
    listVitestTestFiles({
      ...request,
      node: process.execPath,
      signal: new AbortController().signal,
    })
  const plan = await planNodeTestExecution({
    root,
    testFile: join(root, configuration.testFile),
    declaredTestFile: configuration.testFile,
    listRootClaim: rootClaim,
  })
  const launch = await prepareNodeTestLaunch(root, configuration, list, plan)
  const events: { type: string; detail: Record<string, unknown> }[] = []
  const owned = await launchNodeTest(launch, process.execPath, (type, detail) =>
    events.push({ type, detail: detail as Record<string, unknown> }),
  )
  await owned.waitForExit(10_000)
  await owned.close()
  await rm(launch.report.directory, { recursive: true, force: true })
  return { launch, events }
}

/**
 * Replaces the machine's paths in recorded arguments with stable markers, so a test compares the shape the baseline produced.
 * @param values - Recorded arguments or paths.
 * @param root - The repository's real root, written `<root>`.
 * @param launch - The prepared launch, whose report file is written `<report>`.
 * @returns The values with `<root>`, `<report>`, `--json=<list>` and `--inspect-brk=<port>`.
 * @example stable(['--exclude=/tmp/x/copy/a.test.ts'], '/tmp/x', launch) // => ['--exclude=<root>/copy/a.test.ts']
 */
function stable(
  values: string[],
  root: string,
  launch: PreparedNodeTestLaunch,
): string[] {
  return values.map((value) =>
    value
      .split(launch.report.file)
      .join('<report>')
      .split(root)
      .join('<root>')
      .replace(/^--json=.*$/, '--json=<list>')
      .replace(/^--inspect-brk=\d+$/, '--inspect-brk=<port>'),
  )
}

// Value: protects=a root-mode run (no config up to the root) starting exactly as at 83a07385: the same listings, argv, working directory, excludes, journal cwd and configuration hash; fails_when=any of them differs from the literals captured at 83a07385 (artifacts/cycle-0053/h4/baseline.json, same fixture); why_new=AC 3 (H4): root-mode runs keep their behavior; seam=a stand-in Vitest program run by the real listing and launch; no_claim=Vitest's own behavior and the debugger attach (unchanged; ownedNodeTestRun tests)
test('a test under no config starts with the same listings, argv, working directory and journal as at 83a07385', async (context) => {
  // Arrange
  const { root, configuration, calls } = await createRepository(
    context,
    '.',
    [],
  )

  // Act
  const { launch, events } = await planAndLaunch(root, configuration)

  // Assert
  const recorded = await calls()
  const started = events.find((event) => event.type === 'node-test.started')
  assert.equal(
    sha256(JSON.stringify(configuration)),
    '5263e8948d7d8bcfe42b91510b6db6715f54ab083c86f75d79927e17802661e8',
  )
  assert.deepEqual(stable(launch.args, root, launch), [
    'run',
    'src/subscribable.test.ts',
    '--inspect-brk',
    '--no-file-parallelism',
    '--testTimeout=600000',
    '--exclude=<root>/copy/src/subscribable.test.ts',
    '--testNamePattern=^subscription > subscribes once$',
    '--reporter=default',
    '--reporter=json',
    '--outputFile.json=<report>',
  ])
  assert.deepEqual(
    recorded.map((call) => [stable(call.argv, root, launch), call.cwd]),
    [
      [
        ['list', '--filesOnly', '--json=<list>', 'src/subscribable.test.ts'],
        root,
      ],
      [
        [
          'list',
          '--filesOnly',
          '--json=<list>',
          'src/subscribable.test.ts',
          '--exclude=<root>/copy/src/subscribable.test.ts',
        ],
        root,
      ],
      [
        [
          'run',
          'src/subscribable.test.ts',
          '--inspect-brk=<port>',
          '--no-file-parallelism',
          '--testTimeout=600000',
          '--exclude=<root>/copy/src/subscribable.test.ts',
          '--testNamePattern=^subscription > subscribes once$',
          '--reporter=default',
          '--reporter=json',
          '--outputFile.json=<report>',
        ],
        root,
      ],
    ],
  )
  assert.equal(started?.detail.cwd, root)
})

// Value: protects=a package-mode run listing and launching in its package with its path from there, excluding the other files by absolute path, and journaling its Vitest root and the root claim's clean failure; fails_when=the listing or the launch runs from the repository root, the filter stays repository-relative, the excludes change form, or node-test.started lacks vitestRoot or rootClaim; why_new=Cycle 0053 (H1, H2, and H5's journal of a clean failed root listing); seam=a stand-in Vitest program run by the real listing and launch, a scripted root claim; no_claim=Vitest's own config loading (task 1 spike)
test('a test under a package config lists and launches in its package and journals its Vitest root and root claim', async (context) => {
  // Arrange
  const { root, configuration, calls } = await createRepository(
    context,
    'packages/a',
    ['vitest.config.ts', 'packages/a/vite.config.ts'],
  )

  // Act
  const { launch, events } = await planAndLaunch(
    root,
    configuration,
    async () => ({ outcome: 'failed', error: new Error('exit code 1') }),
  )

  // Assert
  const packageFolder = join(root, 'packages', 'a')
  const recorded = await calls()
  const started = events.find((event) => event.type === 'node-test.started')
  assert.equal(launch.vitestRoot, packageFolder)
  assert.deepEqual(
    recorded.map((call) => [
      stable(call.argv, root, launch).slice(0, 5),
      call.cwd,
    ]),
    [
      [
        ['list', '--filesOnly', '--json=<list>', 'src/subscribable.test.ts'],
        packageFolder,
      ],
      [
        [
          'list',
          '--filesOnly',
          '--json=<list>',
          'src/subscribable.test.ts',
          '--exclude=<root>/packages/a/copy/src/subscribable.test.ts',
        ],
        packageFolder,
      ],
      [
        [
          'run',
          'src/subscribable.test.ts',
          '--inspect-brk=<port>',
          '--no-file-parallelism',
          '--testTimeout=600000',
        ],
        packageFolder,
      ],
    ],
  )
  assert.deepEqual(
    {
      cwd: started?.detail.cwd,
      vitestRoot: started?.detail.vitestRoot,
      rootClaim: started?.detail.rootClaim,
    },
    {
      cwd: packageFolder,
      vitestRoot: 'packages/a',
      rootClaim: 'listing-failed',
    },
  )
})

// Value: protects=each listing refusal keeping its message while its cause names the test, the Vitest root, the root claim's result and the filter; fails_when=a refusal's message changes, or its cause does not name what the agent needs to tell a config that excludes the file; why_new=DX review (H8); seam=a scripted listing that selects nothing; no_claim=the other three refusals' messages (prepareNodeTestLaunch tests keep them)
test('a package test Vitest does not select is refused with the same message and a cause naming its Vitest root and filter', async (context) => {
  // Arrange
  const { root, configuration } = await createRepository(
    context,
    'packages/a',
    ['packages/a/vite.config.ts'],
  )
  const plan = await planNodeTestExecution({
    root,
    testFile: join(root, configuration.testFile),
    declaredTestFile: configuration.testFile,
    listRootClaim: async () => assert.fail('no root config'),
  })

  // Act
  const refusal = await prepareNodeTestLaunch(
    root,
    configuration,
    async () => [],
    plan,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.deepEqual(refusal.describe().code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    "Vitest does not select the cited test file under this repository's Vitest configuration.",
  )
  assert.equal(
    refusal.describe().cause,
    "node-test listed packages/a/src/subscribable.test.ts from the Vitest root packages/a (root claim: not-applicable) with the filter src/subscribable.test.ts. The config's own root, dir or include may exclude the file.",
  )
})

// Value: protects=a plan that changed between the pre-history check and the launch being refused before Vitest is asked anything; fails_when=a nearer config added in between is silently used, or the refusal does not say what changed; why_new=Eng review rule 7 (H11); seam=real files changed after the plan; no_claim=a changed Vitest version (the same comparison)
test('a nearer config added after the plan refuses the launch, naming what changed', async (context) => {
  // Arrange
  const { root, configuration, calls } = await createRepository(
    context,
    'packages/a',
    ['packages/a/vite.config.ts'],
  )
  const plan = await planNodeTestExecution({
    root,
    testFile: join(root, configuration.testFile),
    declaredTestFile: configuration.testFile,
    listRootClaim: async () => assert.fail('no root config'),
  })
  await writeFile(
    join(root, 'packages', 'a', 'src', 'vitest.config.ts'),
    'export default {}\n',
  )

  // Act
  const refusal = await prepareNodeTestLaunch(
    root,
    configuration,
    async () => assert.fail('a changed plan lists nothing'),
    plan,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    "node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the nearest Vitest config is now in packages/a/src, not packages/a); start the test again.",
  )
  assert.deepEqual(await calls(), [])
})

// Value: protects=a plan whose config files, config-named entries or Vitest changed between the pre-history check and the launch being refused with a sentence naming what changed, before Vitest is asked anything; fails_when=a second config file, a folder named like a config, or a nearer Vitest installed after the plan is silently run with the stale plan, or the refusal does not name the change; why_new=the nearest-config change is pinned by the test above but verifyExecutionPlan's other three comparisons (config files, refused entries, Vitest identity) had no test; seam=real files changed after the plan; no_claim=the nearest-config comparison (the test above)
test('a second config file, a config-named folder or a nearer Vitest added after the plan each refuse the launch, naming what changed', async (context) => {
  // Arrange
  const refusalAfter = async (change: (root: string) => Promise<void>) => {
    const { root, configuration, calls } = await createRepository(
      context,
      'packages/a',
      ['packages/a/vite.config.ts'],
    )
    const plan = await planNodeTestExecution({
      root,
      testFile: join(root, configuration.testFile),
      declaredTestFile: configuration.testFile,
      listRootClaim: async () => assert.fail('no root config'),
    })
    await change(root)
    const refusal = await prepareNodeTestLaunch(
      root,
      configuration,
      async () => assert.fail('a changed plan lists nothing'),
      plan,
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    assert.ok(refusal instanceof StudyError)
    assert.deepEqual(await calls(), [])
    return { code: refusal.code, message: refusal.message }
  }
  const changedPrefix =
    "node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing ("

  // Act
  const secondConfig = await refusalAfter((root) =>
    writeFile(
      join(root, 'packages', 'a', 'vitest.config.ts'),
      'export default {}\n',
    ),
  )
  const configFolder = await refusalAfter((root) =>
    mkdir(join(root, 'packages', 'a', 'vitest.config.mts')),
  )
  const nearerVitest = await refusalAfter(async (root) => {
    await mkdir(join(root, 'packages', 'a', 'node_modules', 'vitest'), {
      recursive: true,
    })
    await writeFile(
      join(root, 'packages', 'a', 'node_modules', 'vitest', 'package.json'),
      JSON.stringify({ name: 'vitest', version: '5.0.3' }),
    )
    await writeFile(
      join(root, 'packages', 'a', 'node_modules', 'vitest', 'vitest.mjs'),
      '',
    )
  })

  // Assert
  assert.deepEqual(
    [secondConfig, configFolder, nearerVitest],
    [
      {
        code: 'INVALID_CONFIGURATION',
        message: `${changedPrefix}the config files in packages/a are now vitest.config.ts, vite.config.ts, not vite.config.ts); start the test again.`,
      },
      {
        code: 'INVALID_CONFIGURATION',
        message: `${changedPrefix}vitest.config.mts in packages/a is now a folder or a link that leaves the repository); start the test again.`,
      },
      {
        code: 'INVALID_CONFIGURATION',
        message: `${changedPrefix}the Vitest for it is now packages/a/node_modules/vitest 5.0.3, not ./node_modules/vitest 5.0.2); start the test again.`,
      },
    ],
  )
})
