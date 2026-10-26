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
import { dirname, join, relative, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { launchNodeTest } from '../utils/launchNodeTest'
import type { RootClaimListing } from '../utils/listVitestForRootClaim'
import {
  listVitestTestFiles,
  VitestListingDeadlineError,
  VitestListingFailedError,
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
/** What the stand-in Vitest answers when it lists from the repository root: root-relative entries, or the exit code of a listing that fails. */
type RootListingAnswer =
  { files: { file: string; projectName?: string }[] } | { exitCode: number }

/**
 * Builds a repository holding one cited test and its source in `folder`, a sibling copy of the test that Vitest's substring filter also selects, and a stand-in root Vitest 5 that records each start and lists both files until the copy is excluded; once a test scripts the root's answer, a listing from the repository root answers that instead.
 * @param context - Removes the repository when the test ends.
 * @param folder - The root-relative folder of the test and its source, `.` for the root.
 * @param configFiles - Root-relative config files to write.
 * @returns The real root, the test's configuration, a reader of the stand-in Vitest's starts and a writer of what a listing from the root answers.
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
  const rootAnswer = `${root}-root-answer.json`
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(calls, { force: true })
    await rm(rootAnswer, { force: true })
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
    `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const output = argv.find((argument) => argument.startsWith('--json='))?.slice('--json='.length);
let rootAnswer;
try {
  if (process.cwd() === ${JSON.stringify(root)}) rootAnswer = JSON.parse(readFileSync(${JSON.stringify(rootAnswer)}, 'utf8'));
} catch {}
if (argv[0] === 'list') {
  if (rootAnswer && 'exitCode' in rootAnswer) process.exit(rootAnswer.exitCode);
  const excluded = argv.some((argument) => argument.startsWith('--exclude='));
  writeFileSync(output, JSON.stringify(rootAnswer ? rootAnswer.files : excluded ? [{ file: ${JSON.stringify(cited)} }] : [{ file: ${JSON.stringify(cited)} }, { file: ${JSON.stringify(copy)} }]));
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
    answerFromRoot: (answer: RootListingAnswer): Promise<void> =>
      writeFile(
        rootAnswer,
        JSON.stringify(
          'files' in answer
            ? {
                files: answer.files.map((entry) => ({
                  ...entry,
                  file: join(root, entry.file),
                })),
              }
            : answer,
        ),
      ),
  }
}

/**
 * Runs the real Vitest listing with this process's Node and no cancellation, as the owned run binds it.
 * @param request - The listing's program, Vitest root, filter and excludes.
 * @returns Every file entry the stand-in Vitest reports.
 * @example await listWithOwnedNode({ program, vitestRoot: root, filter: 'src/a.test.ts', excludes: [] }) // => [{ file: '/repo/src/a.test.ts' }]
 */
const listWithOwnedNode = (request: ListVitestTestFilesRequest) =>
  listVitestTestFiles({
    ...request,
    node: process.execPath,
    signal: new AbortController().signal,
  })

/**
 * Writes one recorded start with stable markers for the listing's output path, so a test compares where and how Vitest was asked.
 * @param call - One start of the stand-in Vitest.
 * @returns Its arguments with `--json=<list>`, and its working directory.
 * @example listingCall({ argv: ['list', '--json=/tmp/x/files.json'], cwd: '/repo' }) // => [['list', '--json=<list>'], '/repo']
 */
const listingCall = (call: RecordedVitestCall) => [
  call.argv.map((argument) => argument.replace(/^--json=.*$/, '--json=<list>')),
  call.cwd,
]

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

// Value: protects=a package-mode run asking the repository root's Vitest again from the root with the repository-relative path, then listing and launching in its package with its path from there, excluding the other files by absolute path, and journaling its Vitest root and the root claim's clean failure; fails_when=the package listing or the launch runs from the repository root, the filter stays repository-relative, the excludes change form, the root is not asked again before the package listing, or node-test.started lacks vitestRoot or rootClaim; why_new=Cycle 0053 (H1, H2, and H5's journal of a clean failed root listing); Cycle 0054 task 2 adds the root listing at launch (first recorded call), whose stand-in now fails as it did when the plan was made; seam=a stand-in Vitest program run by the real listing and launch, a scripted root claim; no_claim=Vitest's own config loading (task 1 spike)
test('a test under a package config lists and launches in its package and journals its Vitest root and root claim', async (context) => {
  // Arrange
  const { root, configuration, calls, answerFromRoot } = await createRepository(
    context,
    'packages/a',
    ['vitest.config.ts', 'packages/a/vite.config.ts'],
  )
  await answerFromRoot({ exitCode: 1 })

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
        [
          'list',
          '--filesOnly',
          '--json=<list>',
          'packages/a/src/subscribable.test.ts',
        ],
        root,
      ],
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

// Value: protects=a package-mode plan whose root claim basis changed before the launch being refused with a sentence naming the change, before Vitest is asked anything, while an unchanged basis launches as planned: a root config added, a root config edited, and the root Vitest replaced each could decide the claim the other way; fails_when=the launch runs in the package although the repository now runs the test from the root (or the reverse), or an unchanged root config is refused; why_new=Cycle 0053 /ship Step 11 (Codex adversarial review: the root claim's basis was not compared again); Cycle 0054 task 2: the unchanged launch also asks the root again (three Vitest starts), and the root answers as at the plan; seam=real files changed after the plan, the root claim's listing scripted; no_claim=files a root config imports (not compared; the root listing at launch answers for them)
test('a root config added or edited, or the root Vitest replaced, after a package-mode plan refuses the launch, and an unchanged root launches', async (context) => {
  // Arrange
  const launchAfter = async (
    rootConfigs: string[],
    change: (root: string) => Promise<void>,
  ) => {
    const { root, configuration, calls, answerFromRoot } =
      await createRepository(context, 'packages/a', [
        'packages/a/vite.config.ts',
        ...rootConfigs,
      ])
    await answerFromRoot({ files: [] })
    const plan = await planNodeTestExecution({
      root,
      testFile: join(root, configuration.testFile),
      declaredTestFile: configuration.testFile,
      listRootClaim: async () => ({ outcome: 'listed', files: [] }),
    })
    await change(root)
    const outcome = await prepareNodeTestLaunch(
      root,
      configuration,
      (request) =>
        listVitestTestFiles({
          ...request,
          node: process.execPath,
          signal: new AbortController().signal,
        }),
      plan,
    ).then(
      async (launch) => {
        await rm(launch.report.directory, { recursive: true, force: true })
        return `launched in ${launch.execution.vitestRoot}`
      },
      (thrown: unknown) =>
        thrown instanceof StudyError
          ? `${thrown.code}: ${thrown.message}`
          : String(thrown),
    )
    return { outcome, vitestStarts: (await calls()).length }
  }
  const changedPrefix =
    "INVALID_CONFIGURATION: node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing ("

  // Act
  const unchanged = await launchAfter(['vitest.config.ts'], async () => {})
  const rootConfigAdded = await launchAfter([], (root) =>
    writeFile(join(root, 'vitest.config.ts'), 'export default {}\n'),
  )
  const rootConfigEdited = await launchAfter(['vitest.config.ts'], (root) =>
    writeFile(
      join(root, 'vitest.config.ts'),
      "export default { test: { include: ['packages/**/*.test.ts'] } }\n",
    ),
  )
  const rootVitestReplaced = await launchAfter(['vitest.config.ts'], (root) =>
    writeFile(
      join(root, 'node_modules', 'vitest', 'package.json'),
      JSON.stringify({ name: 'vitest', version: '5.0.3' }),
    ),
  )

  // Assert
  assert.deepEqual(
    [unchanged, rootConfigAdded, rootConfigEdited, rootVitestReplaced],
    [
      { outcome: 'launched in packages/a', vitestStarts: 3 },
      {
        outcome: `${changedPrefix}the Vitest or Vite config files at the repository root changed after the root claim was decided); start the test again.`,
        vitestStarts: 0,
      },
      {
        outcome: `${changedPrefix}the Vitest or Vite config files at the repository root changed after the root claim was decided); start the test again.`,
        vitestStarts: 0,
      },
      {
        outcome: `${changedPrefix}the Vitest at the repository root changed after the root claim was decided); start the test again.`,
        vitestStarts: 0,
      },
    ],
  )
})

// Value: protects=a root config changed while the launch's own listings run being refused once they end, before the test is launched; fails_when=the plan is compared only before the listings, so a root config that changed during them, and would now run the test from the root, is launched in the package with the stale rootClaim; why_new=Cycle 0053 Step 11 round 2 (Codex adversarial, Medium); Cycle 0054 task 2: the first listing is now the root's, asked again at launch (three Vitest starts), whose stand-in answers as at the plan; seam=the launch's first listing edits the root config before the real listing runs; no_claim=a change after the last check, which Vitest itself reads after the launch
test('a root config changed while the launch lists its test files refuses the launch after the listings', async (context) => {
  // Arrange
  const { root, configuration, calls, answerFromRoot } = await createRepository(
    context,
    'packages/a',
    ['packages/a/vite.config.ts', 'vitest.config.ts'],
  )
  await answerFromRoot({ files: [] })
  const plan = await planNodeTestExecution({
    root,
    testFile: join(root, configuration.testFile),
    declaredTestFile: configuration.testFile,
    listRootClaim: async () => ({ outcome: 'listed', files: [] }),
  })
  let edited = false
  const listEditingRootConfig = async (request: ListVitestTestFilesRequest) => {
    if (!edited) {
      edited = true
      await writeFile(
        join(root, 'vitest.config.ts'),
        "export default { test: { include: ['packages/**/*.test.ts'] } }\n",
      )
    }
    return listVitestTestFiles({
      ...request,
      node: process.execPath,
      signal: new AbortController().signal,
    })
  }

  // Act
  const refusal = await prepareNodeTestLaunch(
    root,
    configuration,
    listEditingRootConfig,
    plan,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(
    refusal.message,
    "node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the Vitest or Vite config files at the repository root changed after the root claim was decided); start the test again.",
  )
  assert.equal((await calls()).length, 3)
})

// Value: protects=a package-mode plan decided as not-selected being refused at launch once the repository root's Vitest selects the cited test once, before its package listing runs; fails_when=the launch lists and runs the test in its package although the root would now run it, the root is asked from another folder or with another filter, or the refusal does not name both answers; why_new=Cycle 0054 task 2 (CR-OD1: a config the root's projects select can change without the root config or the root Vitest changing); seam=the stand-in root Vitest answers a scripted root listing at launch; no_claim=Vitest's own projects resolution
test('a package test the repository root now selects once is refused at launch before its package listing', async (context) => {
  // Arrange
  const { root, configuration, calls, answerFromRoot } = await createRepository(
    context,
    'packages/a',
    ['vitest.config.ts', 'packages/a/vite.config.ts'],
  )
  const plan = await planNodeTestExecution({
    root,
    testFile: join(root, configuration.testFile),
    declaredTestFile: configuration.testFile,
    listRootClaim: async () => ({ outcome: 'listed', files: [] }),
  })
  await answerFromRoot({
    files: [{ file: 'packages/a/src/subscribable.test.ts' }],
  })

  // Act
  const refusal = await prepareNodeTestLaunch(
    root,
    configuration,
    listWithOwnedNode,
    plan,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.deepEqual(
    { code: refusal.code, message: refusal.message },
    {
      code: 'INVALID_CONFIGURATION',
      message:
        "node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the repository root's Vitest now answers rootClaim selected-once, not not-selected); start the test again.",
    },
  )
  assert.deepEqual((await calls()).map(listingCall), [
    [
      [
        'list',
        '--filesOnly',
        '--json=<list>',
        'packages/a/src/subscribable.test.ts',
      ],
      root,
    ],
  ])
})

// Value: protects=a package-mode plan launching in its package when the repository root's Vitest answers the same root claim at launch: none selected (not-selected), several projects (several-projects) and a failure Vitest itself reported (listing-failed); fails_when=an unchanged answer is refused, the launch does not ask the root before its package listings, or the root listing runs from the package; why_new=Cycle 0054 task 2 (CR-OD1); seam=the stand-in root Vitest answers a scripted root listing at launch; no_claim=the time the extra listing takes (measured on nsx, Issue #130)
test('a package test whose root answers the same root claim at launch lists and launches in its package', async (context) => {
  // Arrange
  const cited = 'packages/a/src/subscribable.test.ts'
  const launchWith = async (
    planned: (root: string) => RootClaimListing,
    atLaunch: RootListingAnswer,
  ) => {
    const { root, configuration, calls, answerFromRoot } =
      await createRepository(context, 'packages/a', [
        'vitest.config.ts',
        'packages/a/vite.config.ts',
      ])
    const plan = await planNodeTestExecution({
      root,
      testFile: join(root, configuration.testFile),
      declaredTestFile: configuration.testFile,
      listRootClaim: async () => planned(root),
    })
    await answerFromRoot(atLaunch)
    const launch = await prepareNodeTestLaunch(
      root,
      configuration,
      listWithOwnedNode,
      plan,
    )
    await rm(launch.report.directory, { recursive: true, force: true })
    return {
      rootClaim: launch.execution.rootClaim,
      listedFrom: (await calls()).map(
        (call) => relative(root, call.cwd).split(sep).join('/') || '<root>',
      ),
    }
  }

  // Act
  const notSelected = await launchWith(
    () => ({ outcome: 'listed', files: [] }),
    { files: [] },
  )
  const severalProjects = await launchWith(
    (root) => ({
      outcome: 'listed',
      files: [
        { file: join(root, cited), projectName: 'unit' },
        { file: join(root, cited), projectName: 'browser' },
      ],
    }),
    {
      files: [
        { file: cited, projectName: 'unit' },
        { file: cited, projectName: 'browser' },
      ],
    },
  )
  const listingFailed = await launchWith(
    () => ({ outcome: 'failed', error: new Error('exit code 1') }),
    { exitCode: 1 },
  )

  // Assert
  assert.deepEqual(
    [notSelected, severalProjects, listingFailed],
    [
      {
        rootClaim: 'not-selected',
        listedFrom: ['<root>', 'packages/a', 'packages/a'],
      },
      {
        rootClaim: 'several-projects',
        listedFrom: ['<root>', 'packages/a', 'packages/a'],
      },
      {
        rootClaim: 'listing-failed',
        listedFrom: ['<root>', 'packages/a', 'packages/a'],
      },
    ],
  )
})

// Value: protects=a package-mode plan being refused at launch, before its package listing, when the repository root's Vitest now answers a different root claim: a clean failure that now selects the test once, none selected that now lists it under several projects, and several projects that now select it once; fails_when=either launch goes on in the package, or the refusal does not name both answers; why_new=Cycle 0054 task 2 (CR-OD1); seam=the stand-in root Vitest answers a scripted root listing at launch; no_claim=a selected-once plan whose root now selects the test twice (prepareNodeTestLaunch's exactly-once refusal pins it)
test('a package test whose root now answers a different root claim is refused at launch, naming both answers', async (context) => {
  // Arrange
  const cited = 'packages/a/src/subscribable.test.ts'
  const refusalOf = async (
    planned: (root: string) => RootClaimListing,
    atLaunch: RootListingAnswer,
  ) => {
    const { root, configuration, calls, answerFromRoot } =
      await createRepository(context, 'packages/a', [
        'vitest.config.ts',
        'packages/a/vite.config.ts',
      ])
    const plan = await planNodeTestExecution({
      root,
      testFile: join(root, configuration.testFile),
      declaredTestFile: configuration.testFile,
      listRootClaim: async () => planned(root),
    })
    await answerFromRoot(atLaunch)
    const message = await prepareNodeTestLaunch(
      root,
      configuration,
      listWithOwnedNode,
      plan,
    ).then(
      async (launch) => {
        await rm(launch.report.directory, { recursive: true, force: true })
        return `launched in ${launch.execution.vitestRoot}`
      },
      (thrown: unknown) =>
        thrown instanceof StudyError
          ? `${thrown.code}: ${thrown.message}`
          : String(thrown),
    )
    return { message, vitestStarts: (await calls()).length }
  }

  // Act
  const failedNowSelectedOnce = await refusalOf(
    () => ({ outcome: 'failed', error: new Error('exit code 1') }),
    { files: [{ file: cited }] },
  )
  const notSelectedNowSeveralProjects = await refusalOf(
    () => ({ outcome: 'listed', files: [] }),
    {
      files: [
        { file: cited, projectName: 'unit' },
        { file: cited, projectName: 'browser' },
      ],
    },
  )

  const severalProjectsNowSelectedOnce = await refusalOf(
    (root) => ({
      outcome: 'listed',
      files: [
        { file: join(root, cited), projectName: 'unit' },
        { file: join(root, cited), projectName: 'browser' },
      ],
    }),
    { files: [{ file: cited }] },
  )

  // Assert
  assert.deepEqual(
    [
      failedNowSelectedOnce,
      notSelectedNowSeveralProjects,
      severalProjectsNowSelectedOnce,
    ],
    [
      {
        message:
          "INVALID_CONFIGURATION: node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the repository root's Vitest now answers rootClaim selected-once, not listing-failed); start the test again.",
        vitestStarts: 1,
      },
      {
        message:
          "INVALID_CONFIGURATION: node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the repository root's Vitest now answers rootClaim several-projects, not not-selected); start the test again.",
        vitestStarts: 1,
      },
      {
        message:
          "INVALID_CONFIGURATION: node-test's plan for packages/a/src/subscribable.test.ts changed while the run was preparing (the repository root's Vitest now answers rootClaim selected-once, not several-projects); start the test again.",
        vitestStarts: 1,
      },
    ],
  )
})

// Value: protects=a root listing at launch that ends without a list or a clean failure refusing the launch with that listing's own error before any package listing: a listing past its deadline (for a not-selected and a several-projects plan), and a clean failure whose process group could not be confirmed as ended, which never reads as listing-failed again; fails_when=either is decided as a root claim, wrapped in another error, or the package listing runs anyway; why_new=Cycle 0054 task 2 (CR-OD1: a root listing that did not end cleanly is never a fallback); seam=a scripted listing that answers the root request and counts the others; no_claim=the run journaling and keeping the unreleased listing's retry (ownedNodeTestRun tests)
test('a root listing at launch that times out or cannot confirm its process group ended refuses with its own error', async (context) => {
  // Arrange
  const outcomeOf = async (
    planned: (root: string) => RootClaimListing,
    rootListing: (request: ListVitestTestFilesRequest) => never,
  ) => {
    const { root, configuration } = await createRepository(
      context,
      'packages/a',
      ['vitest.config.ts', 'packages/a/vite.config.ts'],
    )
    const plan = await planNodeTestExecution({
      root,
      testFile: join(root, configuration.testFile),
      declaredTestFile: configuration.testFile,
      listRootClaim: async () => planned(root),
    })
    let packageListings = 0
    const thrown = await prepareNodeTestLaunch(
      root,
      configuration,
      async (request) => {
        if (request.vitestRoot === root) rootListing(request)
        packageListings += 1
        return listWithOwnedNode(request)
      },
      plan,
    ).then(
      async (launch) => {
        await rm(launch.report.directory, { recursive: true, force: true })
        return undefined
      },
      (error: unknown) => error,
    )
    return { thrown, packageListings }
  }
  const deadline = new VitestListingDeadlineError(
    'Vitest did not list its test files within 15000 ms.',
  )
  const failedUnreleased = new VitestListingFailedError(
    'Vitest could not list the cited test file (exit code 1): ',
  )

  // Act
  const pastDeadline = await outcomeOf(
    () => ({ outcome: 'listed', files: [] }),
    () => {
      throw deadline
    },
  )
  const severalProjectsPastDeadline = await outcomeOf(
    (root) => ({
      outcome: 'listed',
      files: [
        {
          file: join(root, 'packages/a/src/subscribable.test.ts'),
          projectName: 'unit',
        },
        {
          file: join(root, 'packages/a/src/subscribable.test.ts'),
          projectName: 'browser',
        },
      ],
    }),
    () => {
      throw deadline
    },
  )
  const unconfirmed = await outcomeOf(
    () => ({ outcome: 'failed', error: new Error('exit code 1') }),
    (request) => {
      request.onReleaseFailed?.(
        { processGroup: 4242, directory: '/tmp/list', reason: 'EPERM' },
        async () => {},
      )
      throw failedUnreleased
    },
  )

  // Assert
  assert.deepEqual(
    [pastDeadline, severalProjectsPastDeadline, unconfirmed],
    [
      { thrown: deadline, packageListings: 0 },
      { thrown: deadline, packageListings: 0 },
      { thrown: failedUnreleased, packageListings: 0 },
    ],
  )
})

// Value: protects=a package-mode run whose plan made no root claim (no root config) launching without listing from the repository root; fails_when=every package launch also lists from the root, adding a Vitest start where no claim was made; why_new=Cycle 0054 /ship Step 9 testing review (no launch test pinned the skip); seam=a stand-in Vitest recording its starts; no_claim=root-mode runs (the 83a07385 baseline test pins their two listings)
test('a package test whose plan made no root claim launches without listing from the repository root', async (context) => {
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

  // Act
  const launch = await prepareNodeTestLaunch(
    root,
    configuration,
    listWithOwnedNode,
    plan,
  )
  await rm(launch.report.directory, { recursive: true, force: true })

  // Assert
  assert.deepEqual(
    {
      rootClaim: launch.execution.rootClaim,
      listedFrom: (await calls()).map(
        (call) => relative(root, call.cwd).split(sep).join('/') || '<root>',
      ),
    },
    { rootClaim: 'not-applicable', listedFrom: ['packages/a', 'packages/a'] },
  )
})
