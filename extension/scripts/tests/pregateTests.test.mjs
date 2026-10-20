import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { mapPregateTests } from '../utils/mapPregateTests.mjs'
import {
  combinedSummary,
  planPregateRuns,
  runSummaryLine,
} from '../utils/planPregateRuns.mjs'

// Value: protects=the pre-gate's local lane when it selects product tests together with the package tests, which rebuild extension/dist while they run; fails_when=both are passed to one node --test call, so product tests fail to load their modules from dist (906 of 5,725 failed on Cycle 0048's branch), or the script tests run with more than four at a time; why_new=Cycle 0048 task 32 (found while the pre-gate ran on PR #106); seam=none; no_claim=the run itself, which run-pregate-tests.mjs makes from this plan
test('the pre-gate runs the selected product tests first, then the script tests four at a time, in two calls', () => {
  // Arrange
  const files = [
    '/repo/extension/scripts/tests/package.test.mjs',
    '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
    '/repo/.codex/restore-product-context.test.mjs',
    '/repo/extension/dist/tests/utils/within.test.js',
  ]

  // Act
  const runs = planPregateRuns(files)

  // Assert
  assert.deepEqual(runs, [
    {
      files: [
        '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
        '/repo/extension/dist/tests/utils/within.test.js',
      ],
      args: [],
    },
    {
      files: [
        '/repo/extension/scripts/tests/package.test.mjs',
        '/repo/.codex/restore-product-context.test.mjs',
      ],
      args: ['--test-concurrency=4'],
    },
  ])
})

// Value: protects=the count of the pre-gate's lane, which it takes from the first summary line of the output; fails_when=a run's own summary line keeps its form, so the pre-gate counts only the first run, or the combined summary leaves a run out; why_new=Cycle 0048 task 32; seam=none; no_claim=the runner's own summary format, which is node:test's spec reporter as this repository runs it
test('the pre-gate reads one summary that adds up both runs, as each run’s own summary is marked as the run’s', () => {
  // Arrange
  const outputs = [
    '✔ a (1ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 12.5',
    '✖ b (2ms)\nℹ tests 3\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 30',
  ]

  // Act
  const marked = outputs[0].split('\n').map(runSummaryLine)
  const summary = combinedSummary(outputs)

  // Assert
  assert.deepEqual(marked, [
    '✔ a (1ms)',
    'ℹ run tests 2',
    'ℹ run suites 0',
    'ℹ run pass 2',
    'ℹ run fail 0',
    'ℹ run cancelled 0',
    'ℹ run skipped 0',
    'ℹ run todo 0',
    'ℹ run duration_ms 12.5',
  ])
  assert.deepEqual(summary, [
    'ℹ tests 5',
    'ℹ pass 3',
    'ℹ fail 1',
    'ℹ cancelled 0',
    'ℹ skipped 1',
    'ℹ todo 0',
  ])
})

// Value: protects=the pre-gate's local lane, which runs the extension's TypeScript tests as the JavaScript the build writes; fails_when=a selected TypeScript test is passed to node as its .ts source (every test of it fails to load, as when the pre-gate ran `bun test` on them) or lands outside dist/tests, also for a test in a subfolder; no_claim=the build itself, which the runner script starts before it maps
test('the pre-gate runs a selected TypeScript test of the extension as the JavaScript the build wrote for it, also in a subfolder', () => {
  // Arrange
  const selected = [
    'extension/src/tests/wikiUpdateFlow.test.ts',
    'extension/src/tests/utils/within.test.ts',
  ]

  // Act
  const files = mapPregateTests('/repo', selected)

  // Assert
  assert.deepEqual(files, [
    '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
    '/repo/extension/dist/tests/utils/within.test.js',
  ])
})

// Value: protects=the script tests and the compaction hook's test, which are JavaScript already; fails_when=the runner looks for them under dist or drops them; no_claim=none beyond protects
test('the pre-gate runs a selected script test and the compaction hook test as they are', () => {
  // Arrange
  const selected = [
    'extension/scripts/tests/testShards.test.mjs',
    '.codex/restore-product-context.test.mjs',
  ]

  // Act
  const files = mapPregateTests('/repo', selected)

  // Assert
  assert.deepEqual(files, [
    '/repo/extension/scripts/tests/testShards.test.mjs',
    '/repo/.codex/restore-product-context.test.mjs',
  ])
})

// Value: protects=a pre-gate selection that this runner cannot run, which must stop the lane with the file's name; fails_when=such a file is passed on, so node reports a load error or the lane counts fewer tests than were selected; no_claim=which files the pre-gate selects, which its import graph decides
test('the pre-gate runner refuses a selected file that is no test it can run, and names it', () => {
  // Arrange
  const selected = ['extension/src/extension.ts']

  // Act
  const map = () => mapPregateTests('/repo', selected)

  // Assert
  assert.throws(map, {
    message:
      'The pre-gate selected extension/src/extension.ts, which is no test this runner runs (TypeScript tests under extension/src/tests/, script tests under extension/scripts/tests/, or .codex/*.test.mjs).',
  })
})

// Value: protects=the pre-gate runs workflowPins.test.mjs for a change to any workflow file; fails_when=the policy drops the .github/workflows/*.yml entry or names a missing test file; why_new=task 31 was closed by the policy file and evidence only; seam=none; no_claim=that the pre-gate reads the policy as this test does
test('the pre-gate policy declares workflowPins.test.mjs as the test lane of the workflow files, and that test exists', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )

  // Act
  const lane = policy.dependencies['.github/workflows/*.yml']

  // Assert
  assert.deepEqual(lane, ['extension/scripts/tests/workflowPins.test.mjs'])
  assert.equal(existsSync(`${repositoryRoot}${lane[0]}`), true)
})

/**
 * Lays out a copy of the pre-gate runner and its helpers in a fixture repository, with a stand-in `build-fast.mjs` that notes `build` in the fixture's order log and writes the given product tests into `dist/tests`, so the runner can be started as a process without touching the real build.
 * @param context - The test context; the fixture is removed after the test.
 * @param productTests - The source of each product test by its compiled file name (`p.test.js`), which the stand-in build writes.
 * @returns The fixture repository's root.
 * @example const root = await createFixtureRepository(context, { 'p.test.js': notingTest('product', true) })
 */
async function createFixtureRepository(context, productTests) {
  const scriptsDirectory = fileURLToPath(new URL('../', import.meta.url))
  const root = await mkdtemp(join(tmpdir(), 'codebook-pregate-runner-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const extension = join(root, 'extension')
  await mkdir(join(extension, 'scripts/tests'), { recursive: true })
  await cp(join(scriptsDirectory, 'utils'), join(extension, 'scripts/utils'), {
    recursive: true,
  })
  await copyFile(
    join(scriptsDirectory, 'run-pregate-tests.mjs'),
    join(extension, 'scripts/run-pregate-tests.mjs'),
  )
  await writeFile(
    join(extension, 'scripts/build-fast.mjs'),
    [
      "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'",
      "mkdirSync('dist/tests', { recursive: true })",
      "appendFileSync(process.env.ORDER_LOG, 'build\\n')",
      `for (const [name, source] of Object.entries(${JSON.stringify(productTests)}))`,
      "  writeFileSync('dist/tests/' + name, source)",
      '',
    ].join('\n'),
  )
  return root
}

/** The source of a fixture test that notes its name in the order log and passes or fails as told. @example notingTest('script', true) // => a test file that appends 'script' and passes */
function notingTest(name, passes) {
  return [
    "import { appendFileSync } from 'node:fs'",
    "import { test } from 'node:test'",
    `test('${name}', () => {`,
    `  appendFileSync(process.env.ORDER_LOG, '${name}\\n')`,
    `  if (!${passes}) throw new Error('${name} failed')`,
    '})',
    '',
  ].join('\n')
}

/** Starts the fixture's runner with the given selection and answers its exit code, both streams and the order log as a list of lines. @example await runPregateRunner(root, ['extension/scripts/tests/s.test.mjs']) // => { code: 0, stdout: '…', stderr: '', order: ['build', 'script'] } */
async function runPregateRunner(root, selection) {
  const orderLog = join(root, 'order.log')
  const result = spawnSync(
    process.execPath,
    [join(root, 'extension/scripts/run-pregate-tests.mjs'), ...selection],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
        ORDER_LOG: orderLog,
      },
    },
  )
  const order = (await readFile(orderLog, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    order,
  }
}

// Value: protects=the pre-gate from a lane that passes with nothing run: a call with no test file ends with code 2 and a call with a file that is no test it can run ends with a failure that names the file, both before the build starts; fails_when=either guard is dropped, so the runner builds dist, runs no test and exits 0 ("0 tests" counted as a pass); why_new=pregateTests.test.mjs tests mapPregateTests and the plan, not the exit code of the runner script that the pre-gate reads; seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build; no_claim=the real build, which the stand-in replaces
test('the pre-gate runner ends with code 2 for no test file and with a failure naming a file it cannot run, and builds nothing for either', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})

  // Act
  const noSelection = await runPregateRunner(root, [])
  const sourceFile = await runPregateRunner(root, [
    'extension/src/extension.ts',
  ])

  // Assert
  assert.deepEqual(
    {
      noSelection: {
        code: noSelection.code,
        stderr: noSelection.stderr,
        order: noSelection.order,
      },
      sourceFile: {
        code: sourceFile.code,
        namesTheFile: sourceFile.stderr.includes(
          'The pre-gate selected extension/src/extension.ts, which is no test this runner runs',
        ),
        order: sourceFile.order,
      },
    },
    {
      noSelection: {
        code: 2,
        stderr: 'run-pregate-tests: no test file was given.\n',
        order: [],
      },
      sourceFile: { code: 1, namesTheFile: true, order: [] },
    },
  )
})

// Value: protects=the pre-gate's verdict on a selection of product and script tests: the build runs first, the product test runs before the script test, the exit code is 0 only when both pass and 1 when the script test fails; fails_when=the runs swap or overlap (the package tests rebuild dist under a product test), the build is skipped, or a failed run no longer sets the exit code; why_new=pregateTests.test.mjs tests the plan of runs and the summary lines, not the order the script runs them in or its exit code; seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build; no_claim=the real build and the real tests, which the stand-ins replace
test('the pre-gate runner builds first, runs the product test before the script test, exits 0 when both pass and 1 when the script test fails', async (context) => {
  // Arrange
  const selection = [
    'extension/scripts/tests/script.test.mjs',
    'extension/src/tests/product.test.ts',
  ]
  const passing = await createFixtureRepository(context, {
    'product.test.js': notingTest('product', true),
  })
  await writeFile(
    join(passing, 'extension/scripts/tests/script.test.mjs'),
    notingTest('script', true),
  )
  const failing = await createFixtureRepository(context, {
    'product.test.js': notingTest('product', true),
  })
  await writeFile(
    join(failing, 'extension/scripts/tests/script.test.mjs'),
    notingTest('script', false),
  )

  // Act
  const passed = await runPregateRunner(passing, selection)
  const failed = await runPregateRunner(failing, selection)

  // Assert
  assert.deepEqual(
    {
      passed: { code: passed.code, order: passed.order },
      failed: { code: failed.code, order: failed.order },
      combinedSummary: failed.stdout
        .split('\n')
        .filter((line) => /^ℹ (tests|pass|fail) \d+$/.test(line)),
    },
    {
      passed: { code: 0, order: ['build', 'product', 'script'] },
      failed: { code: 1, order: ['build', 'product', 'script'] },
      combinedSummary: ['ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1'],
    },
  )
})

// Value: protects=the pre-gate from one test that never ends: its run is ended after the silence limit, named, and the lane fails, while the next run still runs; fails_when=the runner starts `node --test` with no silence limit, so the pre-gate waits for the hung test until its own time limit and shows nothing; why_new=Cycle 0048 task 57 (Red Team: task 25's limit covered one entry point of three); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build, a hanging product test and a 3 s limit passed as `--silence-seconds`; no_claim=the default limit (120 s)
test('the pre-gate runner ends a product test that never ends, names its run, runs the script test after it and exits 1', async (context) => {
  // Arrange
  const hangingProduct = [
    "import { appendFileSync } from 'node:fs'",
    "import { test } from 'node:test'",
    "test('product', () => {",
    "  appendFileSync(process.env.ORDER_LOG, 'product\\n')",
    '  return new Promise(() => setInterval(() => {}, 1_000))',
    '})',
    '',
  ].join('\n')
  const root = await createFixtureRepository(context, {
    'product.test.js': hangingProduct,
  })
  await writeFile(
    join(root, 'extension/scripts/tests/script.test.mjs'),
    notingTest('script', true),
  )

  // Act
  const result = await runPregateRunner(root, [
    '--silence-seconds',
    '3',
    'extension/scripts/tests/script.test.mjs',
    'extension/src/tests/product.test.ts',
  ])

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      namesTheRun: result.stderr.includes(
        '✖ extension/dist/tests/product.test.js printed nothing for 3 s and was ended',
      ),
      order: result.order,
    },
    { code: 1, namesTheRun: true, order: ['build', 'product', 'script'] },
  )
})

// Value: protects=the pre-gate from a silence limit that ends every run at once (`Infinity`, 0, a text, more than a timer can wait): the runner stops with code 2 before it builds; fails_when=the option is not read, or read without the checks of test-shard.mjs; why_new=Cycle 0048 task 57 (the option is new) with task 54 (the limits); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build; no_claim=the shard script's own refusals, which testShards.test.mjs covers
test('the pre-gate runner refuses a silence limit of Infinity, above a timer’s limit, 0 or no number, and builds nothing', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})

  // Act
  const refusals = []
  for (const seconds of ['Infinity', '3000000', '0', 'soon'])
    refusals.push(
      await runPregateRunner(root, [
        '--silence-seconds',
        seconds,
        'extension/scripts/tests/script.test.mjs',
      ]),
    )

  // Assert
  assert.deepEqual(
    refusals.map(({ code, stderr, order }) => ({ code, stderr, order })),
    [
      {
        code: 2,
        stderr:
          'run-pregate-tests: --silence-seconds must be at most 2147483, the longest wait a timer allows.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --silence-seconds must be at most 2147483, the longest wait a timer allows.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --silence-seconds must be a number above 0.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --silence-seconds must be a number above 0.\n',
        order: [],
      },
    ],
  )
})
