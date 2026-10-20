import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
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
import { silenceLimitOfRun } from '../utils/silenceLimitOfRun.mjs'
import {
  CALL_SILENCE_TIMEOUT_MS,
  PROGRESS_LINE_INTERVAL_MS,
} from '../utils/testShardConstants.mjs'
import { writeProgressWhileRunning } from '../utils/writeProgressWhileRunning.mjs'

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

// Value: protects=the pre-gate runs workflowPins.test.mjs for a change to any CI definition that test reads: a workflow written as `.yml` or `.yaml`, a composite action anywhere under `.github/actions`, the Node release, the Reader DOM job's package files; and runs no test for the VERSION file, which none reads; fails_when=the policy drops one of these entries, names a missing test file, or leaves `.yaml` workflows, the actions, `.node-version` or either Reader DOM package file out (a change there then selects no test); why_new=task 31 was closed by the policy file and evidence only; Cycle 0048 task 105 (OCR B) added the `.yaml` and actions entries; task 113 added `"VERSION": []`; Cycle 0048 tasks 118 and 122 (Testing, Red Team) pin the VERSION entry and the files workflowPins.test.mjs read that no import reaches; seam=none; no_claim=that the pre-gate reads the policy as this test does (its glob has `*` for one path part and `**` for any), and the files that the import graph reaches by their path in the test text
test('the pre-gate policy declares workflowPins.test.mjs as the test lane of the workflow files, composite actions, Node release and Reader DOM package files it reads, and VERSION as no lane, and that test exists', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )

  // Act
  const lanes = {
    yml: policy.dependencies['.github/workflows/*.yml'],
    yaml: policy.dependencies['.github/workflows/*.yaml'],
    actions: policy.dependencies['.github/actions/**'],
    nodeVersion: policy.dependencies['.node-version'],
    readerDomPackage: policy.dependencies['.github/reader-dom/package.json'],
    readerDomLockfile:
      policy.dependencies['.github/reader-dom/package-lock.json'],
    version: policy.dependencies['VERSION'],
  }

  // Assert
  const workflowPins = ['extension/scripts/tests/workflowPins.test.mjs']
  assert.deepEqual(lanes, {
    yml: workflowPins,
    yaml: workflowPins,
    actions: workflowPins,
    nodeVersion: [
      'extension/scripts/tests/health.test.mjs',
      'extension/scripts/tests/workflowPins.test.mjs',
    ],
    readerDomPackage: workflowPins,
    readerDomLockfile: workflowPins,
    version: [],
  })
  assert.equal(existsSync(`${repositoryRoot}${workflowPins[0]}`), true)
})

// Value: protects=the pre-gate runs the script test that reads a repository file no import reaches (a file it opens by a path built in code, a place beside it, a file it copies into a fixture, or the policy itself): a change to that file selects the test; fails_when=one of these entries is dropped or points to another test, so a change to `.gitignore`, `AGENTS.md`, `.codex/hooks.json`, the shipped skill's `SKILL.md` or `reader-shell.html`, a browser check, the health checker, the shard script or the policy runs no test that reads it; why_new=Cycle 0048 task 122 (Red Team: workflowPins.test.mjs read five files that the policy named nowhere; the same search over every script test found the rest); seam=none; no_claim=files that a test only writes into a fixture (the fixtures of packageIO.test.mjs, `extension/test-timings.json`), and the files the import graph reaches, which the pre-gate decides
test('the pre-gate policy declares the script test that reads each repository file the import graph does not reach, and every test it names exists', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )
  const scriptTests = 'extension/scripts/tests/'

  // Act
  const declared = (file) => policy.dependencies[file]
  const lanes = {
    gitignore: declared('.gitignore'),
    policy: declared('.gstack/pregate.json'),
    agents: declared('AGENTS.md'),
    codexHooks: declared('.codex/hooks.json'),
    healthChecker: declared('extension/scripts/checkHealth.mjs'),
    shardScript: declared('extension/scripts/test-shard.mjs'),
    studyCheck: declared('extension/scripts/study-bootstrap-qa.mjs'),
    wikiCheck: declared('extension/scripts/wiki-reader-dom-qa.mjs'),
    wikiShellFixture: declared(
      'extension/scripts/fixtures/reader-shell-0.2.29.0.txt',
    ),
    publishProbe: declared(`${scriptTests}utils/prepareWikiBufferProbe.mjs`),
    publishHooks: declared(`${scriptTests}utils/markedCopyHooks.mjs`),
    publishKilledProbe: declared(
      `${scriptTests}utils/killedPublisherProbe.mjs`,
    ),
    skillGuide: declared('extension/skills/codebook/SKILL.md'),
    readerShell: declared('extension/skills/codebook/reader-shell.html'),
    constants: declared('extension/src/constants.ts'),
    deepWikiReader: declared('extension/src/deepWikiReader.ts'),
    wikiUpdateStatus: declared(
      'extension/src/utils/installWikiUpdateStatus.ts',
    ),
    editorLinks: declared('extension/src/utils/rebindDeepWikiEditorLinks.ts'),
    shortcutHelp: declared('extension/src/utils/installShortcutHelp.ts'),
  }
  const namedTests = Object.values(policy.dependencies).flat()
  const missingTests = namedTests.filter(
    (test) => !existsSync(`${repositoryRoot}${test}`),
  )

  // Assert
  const publishWiki = [`${scriptTests}publishWiki.test.mjs`]
  assert.deepEqual(lanes, {
    gitignore: [`${scriptTests}repositoryIgnore.test.mjs`],
    policy: [`${scriptTests}pregateTests.test.mjs`],
    agents: ['.codex/restore-product-context.test.mjs'],
    codexHooks: ['.codex/restore-product-context.test.mjs'],
    healthChecker: [`${scriptTests}health.test.mjs`],
    shardScript: [`${scriptTests}testShards.test.mjs`],
    studyCheck: [`${scriptTests}studyBootstrapQa.test.mjs`],
    wikiCheck: [`${scriptTests}wikiReaderDomQa.test.mjs`],
    wikiShellFixture: [`${scriptTests}wikiReaderDomQa.test.mjs`],
    publishProbe: publishWiki,
    publishHooks: publishWiki,
    publishKilledProbe: publishWiki,
    skillGuide: [
      `${scriptTests}publishWiki.test.mjs`,
      `${scriptTests}renderWikiPageLimit.test.mjs`,
    ],
    readerShell: [
      `${scriptTests}publishWiki.test.mjs`,
      `${scriptTests}studyBootstrapQa.test.mjs`,
    ],
    constants: publishWiki,
    deepWikiReader: publishWiki,
    wikiUpdateStatus: publishWiki,
    editorLinks: publishWiki,
    shortcutHelp: publishWiki,
  })
  assert.deepEqual(missingTests, [])
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

/** Starts the fixture's runner with the given selection and answers its exit code, both streams and the order log as a list of lines; `extraEnvironment` adds variables to the runner's own (for example `NODE_OPTIONS`, which every node process it starts reads too). @example await runPregateRunner(root, ['extension/scripts/tests/s.test.mjs']) // => { code: 0, stdout: '…', stderr: '', order: ['build', 'script'] } */
async function runPregateRunner(root, selection, extraEnvironment = {}) {
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
            // An outer NO_COLOR beside a FORCE_COLOR the test gives makes Node warn on stderr; the runner gets none.
            ([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NO_COLOR',
          ),
        ),
        ORDER_LOG: orderLog,
        ...extraEnvironment,
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

// Value: protects=the pre-gate from one test that never ends: its run is ended after the silence limit, named, and the lane fails, while the next run still runs; fails_when=the runner starts `node --test` with no silence limit, so the pre-gate waits for the hung test until its own time limit and shows nothing; why_new=Cycle 0048 task 57 (Red Team: task 25's limit covered one entry point of three); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build, a hanging product test and a 5 s limit passed as `--silence-seconds`, which leaves the script test that runs after it 5 s to start and pass; no_claim=the default limit (120 s)
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
  // gstack-timing-ok: the product test never ends, so the 5 s limit is the contract that ends it; a load only delays the end. The limit is the margin of the script test that runs after it (it must start and pass inside 5 s of its spawn).
  const result = await runPregateRunner(root, [
    '--silence-seconds',
    '5',
    'extension/scripts/tests/script.test.mjs',
    'extension/src/tests/product.test.ts',
  ])

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      namesTheRun: result.stderr.includes(
        '✖ extension/dist/tests/product.test.js printed nothing for 5 s and was ended',
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

/** The source of a fixture product test that notes its name in the order log, then runs `body` (the statements of an async function). @example scriptedTest('product', "console.error('x')") */
function scriptedTest(name, body) {
  return [
    "import { appendFileSync } from 'node:fs'",
    "import { test } from 'node:test'",
    `test('${name}', async () => {`,
    `  appendFileSync(process.env.ORDER_LOG, '${name}\\n')`,
    `  ${body}`,
    '})',
    '',
  ].join('\n')
}

// Value: protects=the count the pre-gate reads on a machine whose environment sets FORCE_COLOR: the spec reporter then colours its summary lines also on a pipe (`ESC[34mℹ tests 1ESC[39m`), which the runner's summary pattern did not match, so the summary said `ℹ tests 0` although the tests ran; fails_when=the runner starts `node --test` with FORCE_COLOR still in its environment; why_new=Cycle 0048 task 109 (Red Team); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build and FORCE_COLOR=1 in its environment; no_claim=other colour variables of other tools
test('the pre-gate runner prints the true test count when FORCE_COLOR is set in its environment', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {
    'product.test.js': notingTest('product', true),
  })

  // Act
  const result = await runPregateRunner(
    root,
    ['extension/src/tests/product.test.ts'],
    { FORCE_COLOR: '1' },
  )

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      combinedSummary: result.stdout
        .split('\n')
        .filter((line) => /^ℹ (tests|pass|fail) \d+$/.test(line)),
    },
    { code: 0, combinedSummary: ['ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'] },
  )
})

// Value: protects=the pre-gate lane from failing a valid package build: package.test.mjs builds the package in its `before` hook and prints nothing for up to the build's limit (180 s), more than the default silence limit (120 s); fails_when=a run that holds package.test.mjs gets the default limit, or a limit the caller gave is replaced; why_new=Cycle 0048 task 110 (Red Team); seam=silenceLimitOfRun, which run-pregate-tests.mjs calls for each run; no_claim=the real build time, which the process test below shows with a shortened build limit
test('the pre-gate allows a run that holds the package test a silence longer than the package build’s limit, and keeps a limit the caller gave', () => {
  // Arrange
  const productRun = ['/repo/extension/dist/tests/citation.test.js']
  const packageRun = [
    '/repo/extension/scripts/tests/health.test.mjs',
    '/repo/extension/scripts/tests/package.test.mjs',
  ]

  // Act
  const limits = {
    product: silenceLimitOfRun(productRun, undefined),
    package: silenceLimitOfRun(packageRun, undefined),
    windowsPath: silenceLimitOfRun(
      ['C:\\repo\\extension\\scripts\\tests\\package.test.mjs'],
      undefined,
    ),
    productGiven: silenceLimitOfRun(productRun, 3_000),
    packageGiven: silenceLimitOfRun(packageRun, 3_000),
  }

  // Assert
  assert.deepEqual(limits, {
    product: 120_000,
    package: 300_000,
    windowsPath: 300_000,
    productGiven: 3_000,
    packageGiven: 3_000,
  })
})

// Value: protects=the pre-gate lane from ending a package build that stays silent longer than the default silence limit but within the build's own limit; fails_when=the runner gives the run that holds package.test.mjs the same limit as any other run, so a silent `before` hook is ended as hung; why_new=Cycle 0048 task 110 (Red Team); seam=run-pregate-tests.mjs started as a process in a fixture repository whose copies of the two constants are shortened (default silence limit 2 s, package command limit 20 s, so the package run's limit is 22 s) and whose script tests stay silent for 4 s, which leaves 18 s for a slow start-up of the package run and 2 s before the other run is ended; no_claim=the real constants, which the test above reads
test('the pre-gate runner lets package.test.mjs stay silent longer than the default silence limit and ends another test that does the same', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})
  const utilities = join(root, 'extension/scripts/utils')
  const shorten = async (file, from, to) => {
    const text = await readFile(join(utilities, file), 'utf8')
    assert.ok(text.includes(from), `${file} no longer holds ${from}`)
    await writeFile(join(utilities, file), text.replace(from, to))
  }
  await shorten(
    'testShardConstants.mjs',
    'CALL_SILENCE_TIMEOUT_MS = 120_000',
    'CALL_SILENCE_TIMEOUT_MS = 2_000',
  )
  await shorten(
    'packageConstants.mjs',
    'PACKAGE_COMMAND_TIMEOUT_MS = 180_000',
    // The silence watch counts from the child's spawn, start-up and module load included: 22 s (20 s plus the 2 s default) keeps a loaded runner's slow start from ending the package run.
    'PACKAGE_COMMAND_TIMEOUT_MS = 20_000',
  )
  // gstack-timing-ok: the contract is 2 s default limit < 4 s of silence < 22 s package limit. A timer never fires early, so a load only delays the end of the other run (the 2 s above its limit is spent only if its watch is late by 2 s) and, for the package run, would need a 18 s stall to reach its limit.
  const quietFor4Seconds = scriptedTest(
    'quiet',
    'await new Promise((resolve) => setTimeout(resolve, 4_000))',
  )
  await writeFile(
    join(root, 'extension/scripts/tests/package.test.mjs'),
    quietFor4Seconds,
  )
  await writeFile(
    join(root, 'extension/scripts/tests/other.test.mjs'),
    quietFor4Seconds,
  )

  // Act
  const packageRun = await runPregateRunner(root, [
    'extension/scripts/tests/package.test.mjs',
  ])
  const otherRun = await runPregateRunner(root, [
    'extension/scripts/tests/other.test.mjs',
  ])

  // Assert
  assert.deepEqual(
    {
      package: {
        code: packageRun.code,
        endedAsHung: packageRun.stderr.includes('printed nothing'),
      },
      other: {
        code: otherRun.code,
        endedAsHung: otherRun.stderr.includes(
          '✖ extension/scripts/tests/other.test.mjs printed nothing for 2 s and was ended',
        ),
      },
    },
    {
      package: { code: 0, endedAsHung: false },
      other: { code: 1, endedAsHung: true },
    },
  )
})

// Value: protects=the lane from a package build whose commands, each within its own 180 s limit, together stay silent for longer than the run's silence limit: the step writes a line at an interval while it runs, and stops when it ends or fails; fails_when=the step writes nothing while it runs, or its timer outlives the step (a line after the step ended); why_new=Cycle 0048 task 111 (found while fixing task 110), made independent of machine load by task 114 (pre-gate timing); seam=writeProgressWhileRunning with a stand-in step of 350 ms and an interval of 100 ms, on the mocked setInterval and setTimeout of node:test that the test ticks by hand; no_claim=that the real hook uses it (the next test), the real build, and that a surviving real timer would keep the process alive (a mocked timer cannot)
test('a long step writes a progress line at each interval while it runs, none after it ended or failed, and gives back its result or its error', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const lines = []
  const write = (line) => lines.push(line)
  const slowStep = () =>
    new Promise((resolve) => setTimeout(() => resolve('receipt'), 350))
  const failingStep = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    throw new Error('build failed')
  }

  // Act: the slow step runs 350 ms of the mocked clock; the lines fall at 100, 200 and 300 ms
  const slowRun = writeProgressWhileRunning(slowStep, {
    intervalMs: 100,
    write,
  })
  context.mock.timers.tick(100)
  context.mock.timers.tick(100)
  context.mock.timers.tick(100)
  const linesBeforeTheEnd = lines.length
  context.mock.timers.tick(50)
  const result = await slowRun
  const linesOfSlowStep = lines.length
  // Act: far past the step's end, where its interval would have fired ten more times
  context.mock.timers.tick(1_000)
  const linesAfterSlowStepEnded = lines.length - linesOfSlowStep

  // Act: the failing step ends at 150 ms, after the line at 100 ms
  const failingRun = writeProgressWhileRunning(failingStep, {
    intervalMs: 100,
    write,
  }).catch((error) => error.message)
  context.mock.timers.tick(100)
  context.mock.timers.tick(50)
  const failure = await failingRun
  const linesAfterFailure = lines.length
  context.mock.timers.tick(1_000)

  // Assert
  assert.deepEqual(
    {
      result,
      linesBeforeTheEnd,
      linesOfSlowStep,
      linesAfterSlowStepEnded,
      failure,
      linesOfFailingStep: linesAfterFailure - linesOfSlowStep,
      linesAfterTheFailure: lines.length - linesAfterFailure,
      firstLineStart: lines[0].startsWith('still running, '),
    },
    {
      result: 'receipt',
      linesBeforeTheEnd: 3,
      linesOfSlowStep: 3,
      linesAfterSlowStepEnded: 0,
      failure: 'build failed',
      linesOfFailingStep: 1,
      linesAfterTheFailure: 0,
      firstLineStart: true,
    },
  )
})

// Value: protects=the pre-gate's lane from a silent package build: the default interval of the progress line stays well under the run's silence limit, so a build that holds the test is seen alive; fails_when=PROGRESS_LINE_INTERVAL_MS is raised to CALL_SILENCE_TIMEOUT_MS or above (or not used as the default), so the step writes its first line only when the silence limit has run out and the lane ends as hung again; why_new=Cycle 0048 task 115 (Step 7: no test read the default; tasks 110 and 111); seam=writeProgressWhileRunning called without intervalMs on the mocked setInterval of node:test, ticked by hand, and the two constants; no_claim=the length of the real build
test('a long step called without an interval writes its first progress line after 30 s and two lines fit inside the silence limit', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval'] })
  const lines = []
  let finishStep
  const step = () =>
    new Promise((resolve) => {
      finishStep = resolve
    })

  // Act
  const run = writeProgressWhileRunning(step, {
    write: (line) => lines.push(line),
  })
  context.mock.timers.tick(29_999)
  const linesAt29999Ms = lines.length
  context.mock.timers.tick(1)
  const linesAt30000Ms = lines.length
  context.mock.timers.tick(30_000)
  const linesAt60000Ms = lines.length
  finishStep('done')
  await run

  // Assert
  assert.deepEqual(
    {
      linesAt29999Ms,
      linesAt30000Ms,
      linesAt60000Ms,
      defaultIntervalMs: PROGRESS_LINE_INTERVAL_MS,
      twoIntervalsFitInTheSilenceLimit:
        2 * PROGRESS_LINE_INTERVAL_MS < CALL_SILENCE_TIMEOUT_MS,
    },
    {
      linesAt29999Ms: 0,
      linesAt30000Ms: 1,
      linesAt60000Ms: 2,
      defaultIntervalMs: 30_000,
      twoIntervalsFitInTheSilenceLimit: true,
    },
  )
})

// Value: protects=the package test's hook from being ended as hung while its build runs several commands in turn: the hook's lines reach the pre-gate runner as they are written and restart its silence time; fails_when=the hook writes nothing during its build (the run is ended after the silence limit although the build is within its own limits), or Node's runner holds the hook's output until the file ends; why_new=Cycle 0048 task 111 (found while fixing task 110); seam=run-pregate-tests.mjs started as a process in a fixture repository whose package.test.mjs runs a silent 8 s step through writeProgressWhileRunning (interval 500 ms) under `--silence-seconds 6`, and a twin that runs the same step without it, so the first line may be 5.5 s late and the twin is ended 2 s before its step ends; no_claim=the real build
test('the pre-gate runner does not end a package test whose hook stays silent for longer than the limit but writes progress lines, and ends one that writes none', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})
  const hook = (step) =>
    [
      "import { before, test } from 'node:test'",
      "import { writeProgressWhileRunning } from '../utils/writeProgressWhileRunning.mjs'",
      'before(async () => {',
      `  await ${step}`,
      '})',
      "test('built', () => {})",
      '',
    ].join('\n')
  // gstack-timing-ok: the contract is a progress line every 500 ms < the 6 s silence limit < the 8 s the step is silent. A timer never fires early, so a load only delays the lines (5.5 s of slack for the start-up and module load that the watch counts) and the twin's end (it is ended at 6 s whatever the load, 2 s before its step could end).
  const silentStep = 'new Promise((resolve) => setTimeout(resolve, 8_000))'
  await writeFile(
    join(root, 'extension/scripts/tests/package.test.mjs'),
    hook(`writeProgressWhileRunning(() => ${silentStep}, { intervalMs: 500 })`),
  )
  await writeFile(
    join(root, 'extension/scripts/tests/other.test.mjs'),
    hook(silentStep),
  )

  // Act
  const withProgress = await runPregateRunner(root, [
    '--silence-seconds',
    '6',
    'extension/scripts/tests/package.test.mjs',
  ])
  const withoutProgress = await runPregateRunner(root, [
    '--silence-seconds',
    '6',
    'extension/scripts/tests/other.test.mjs',
  ])

  // Assert
  assert.deepEqual(
    {
      withProgress: {
        code: withProgress.code,
        endedAsHung: withProgress.stderr.includes('printed nothing'),
        passesTheLines: withProgress.stdout.includes('still running, '),
      },
      withoutProgress: {
        code: withoutProgress.code,
        endedAsHung: withoutProgress.stderr.includes('printed nothing'),
      },
    },
    {
      withProgress: { code: 0, endedAsHung: false, passesTheLines: true },
      withoutProgress: { code: 1, endedAsHung: true },
    },
  )
})

// Value: protects=the hook of package.test.mjs keeps its progress lines: the build runs inside writeProgressWhileRunning; fails_when=the hook calls buildPackage bare again, so a build whose commands stay silent for longer than the silence limit ends the lane; why_new=Cycle 0048 task 111; seam=the source text of package.test.mjs (the file builds the package and cannot run in a test); no_claim=that the lines are written, which the two tests above show
test('the package test’s before hook runs the package build inside writeProgressWhileRunning', () => {
  // Arrange
  const source = readFileSync(
    fileURLToPath(new URL('./package.test.mjs', import.meta.url)),
    'utf8',
  )

  // Act
  const hookCall =
    /receipt = await writeProgressWhileRunning\(\(\) =>\s*buildPackage\(repository, artifact\),?\s*\)/

  // Assert
  assert.match(source, hookCall)
})

// Value: protects=the pre-gate's silence watch from a run that talks only on stderr (Node's runner prints a test's own stderr on its stdout, so what reaches the runner's stderr is its own: a warning, a crash report): that text is passed through to the pre-gate runner's own stderr and counts as activity, so the run is not ended as hung; fails_when=stderr is not piped on, or a chunk of it does not restart the silence time (the run is ended after the limit although it printed all the time); why_new=Cycle 0048 task 87 (Step 7: stderr became piped in fixing cycle 2); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build, a product test that prints nothing for 7 s under a 5 s limit, and NODE_OPTIONS=--require of a file that makes the `node --test` process (the one with `--test` in its execArgv, not the pre-gate runner that has none) write a line to its stderr every second; the test is red on a runner that drops the run's stderr (Cycle 0048 task 102); no_claim=output on stdout, which the hanging test above covers by its absence
test('the pre-gate runner keeps a run alive that writes only to stderr for longer than the limit, and passes the text to its own stderr', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {
    'product.test.js': scriptedTest(
      'product',
      // gstack-timing-ok: the contract is a stderr line every 1 s < the 5 s silence limit < the 7 s the test is silent. A timer never fires early, so a load only delays the lines (4 s of slack for the start-up the watch counts); without the lines the run is ended at 5 s, 2 s before the test could end.
      'await new Promise((resolve) => setTimeout(resolve, 7_000))',
    ),
  })
  const preloadPath = join(root, 'write-to-stderr.cjs')
  await writeFile(
    preloadPath,
    // Only the `node --test` process has `--test` in its execArgv; the pre-gate runner and the test-file processes do not.
    "if (process.execArgv.includes('--test')) setInterval(() => console.error('runner still working'), 1_000).unref()\n",
  )

  // Act
  const result = await runPregateRunner(
    root,
    ['--silence-seconds', '5', 'extension/src/tests/product.test.ts'],
    { NODE_OPTIONS: `--require=${preloadPath}` },
  )

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      passesTheTextOn: result.stderr.includes('runner still working'),
      endedAsHung: result.stderr.includes('printed nothing'),
    },
    { code: 0, passesTheTextOn: true, endedAsHung: false },
  )
})

// Value: protects=the pre-gate's verdict on a run that was ended for its silence but winds down with exit code 0 (the real runner exits non-zero after a SIGTERM, so this is the only case that tells `timedOut ||` from the exit code): the lane fails and the run is named; fails_when=the verdict reads only the exit code, so a hung test that the runner reports as exit 0 after the SIGTERM turns into a pass; why_new=Cycle 0048 task 88 (Step 7: nothing told `timedOut ||` apart); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build, and NODE_OPTIONS=--require of a file that makes the `node --test` process (the one with `--test` in its execArgv) exit 0 on SIGTERM; the script has no seam for a stand-in runner and needs none; no_claim=what the real runner exits with after a SIGTERM
test('the pre-gate runner fails the lane for a run ended for its silence even when the runner exits 0 after the SIGTERM', async (context) => {
  // Arrange
  // The hung test ends by itself after 6 s: the stand-in runner exits at the SIGTERM and leaves its file process behind.
  const root = await createFixtureRepository(context, {
    'product.test.js': scriptedTest(
      'product',
      // gstack-timing-ok: the contract is the 3 s silence limit < the 6 s the test is silent. A timer never fires early, so a load only delays the test's end and the run is ended at 3 s, 3 s before the test could end; no outcome here waits for a start-up.
      'await new Promise((resolve) => setTimeout(resolve, 6_000))',
    ),
  })
  const preloadPath = join(root, 'exit-on-sigterm.cjs')
  await writeFile(
    preloadPath,
    "if (process.execArgv.includes('--test')) process.on('SIGTERM', () => process.exit(0))\n",
  )

  // Act
  const result = await runPregateRunner(
    root,
    ['--silence-seconds', '3', 'extension/src/tests/product.test.ts'],
    { NODE_OPTIONS: `--require=${preloadPath}` },
  )

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      namesTheRun: result.stderr.includes(
        '✖ extension/dist/tests/product.test.js printed nothing for 3 s and was ended',
      ),
    },
    { code: 1, namesTheRun: true },
  )
})

// Value: protects=the pre-gate lane from a runner that cannot start: the lane fails with one line that names the run and the error, not with exit 1 and nothing to read; fails_when=the error of the spawn is dropped; why_new=Cycle 0048 task 71 (OCR B); seam=run-pregate-tests.mjs started as a process in a fixture repository whose stand-in build removes the extension folder (the runner's working folder), so the spawn fails with ENOENT; no_claim=other causes of a failed start
test('the pre-gate runner names the run and the error when a runner cannot start, and fails the lane', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})
  await writeFile(
    join(root, 'extension/scripts/build-fast.mjs'),
    [
      "import { appendFileSync, rmSync } from 'node:fs'",
      "appendFileSync(process.env.ORDER_LOG, 'build\\n')",
      '// The build ran in the extension folder, which the runner uses as its working folder.',
      'rmSync(process.cwd(), { recursive: true, force: true })',
      '',
    ].join('\n'),
  )

  // Act
  const result = await runPregateRunner(root, [
    'extension/src/tests/product.test.ts',
  ])

  // Assert
  assert.equal(result.code, 1)
  assert.match(
    result.stderr,
    /^run-pregate-tests: extension\/dist\/tests\/product\.test\.js could not start: spawn .* ENOENT$/m,
  )
})

// Value: protects=the pre-gate from a build that never ends: it is ended after its limit and the lane fails with one line that names the limit, before any test runs; fails_when=the build runs with no time bound, so a hung build holds the pre-gate with nothing shown; why_new=Cycle 0048 task 73 (native adversarial); seam=run-pregate-tests.mjs started as a process in a fixture repository whose stand-in build hangs, with `--build-seconds 2`; no_claim=the default limit (300 s)
test('the pre-gate runner ends a build that never ends after its limit, names the limit and runs no test', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})
  await writeFile(
    join(root, 'extension/scripts/build-fast.mjs'),
    [
      "import { appendFileSync } from 'node:fs'",
      "appendFileSync(process.env.ORDER_LOG, 'build\\n')",
      'setInterval(() => {}, 1_000)',
      '',
    ].join('\n'),
  )

  // Act
  const result = await runPregateRunner(root, [
    '--build-seconds',
    '2',
    'extension/src/tests/product.test.ts',
  ])

  // Assert
  assert.deepEqual(
    { code: result.code, stderr: result.stderr, order: result.order },
    {
      code: 1,
      stderr:
        'run-pregate-tests: the build did not end within 2 s and was ended.\n',
      order: ['build'],
    },
  )
})

// Value: protects=the pre-gate from a build limit that would end the build at once or never (`Infinity`, 0, a text, under one millisecond, more than a timer can wait): the runner stops with code 2 and a sentence that names `--build-seconds`, before it builds; fails_when=the option is read with `Number()` alone, so NaN or 0 reaches the build's timeout, or the refusal names `--silence-seconds`; why_new=Cycle 0048 task 73 added the option; the silence test above refuses `--silence-seconds` only; seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build; no_claim=the default limit (300 s) and a build that is ended at its limit, which the test above covers
test('the pre-gate runner refuses a build limit of Infinity, above a timer’s limit, under a millisecond, 0 or no number, names the option, and builds nothing', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {})

  // Act
  const refusals = []
  for (const seconds of ['Infinity', '3000000', '0.0004', '0', 'soon'])
    refusals.push(
      await runPregateRunner(root, [
        '--build-seconds',
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
          'run-pregate-tests: --build-seconds must be at most 2147483, the longest wait a timer allows.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --build-seconds must be at most 2147483, the longest wait a timer allows.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --build-seconds must be at least 0.001, the shortest wait a timer keeps.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --build-seconds must be a number above 0.\n',
        order: [],
      },
      {
        code: 2,
        stderr:
          'run-pregate-tests: --build-seconds must be a number above 0.\n',
        order: [],
      },
    ],
  )
})

// Value: protects=the pre-gate from a lane that goes on after its build failed: a build that exits with code 3 ends the runner with code 3, no test runs against the old dist, and no line claims that the build was ended for its time; fails_when=the exit code of a failed build is dropped (exit 0 or 1), the tests run against a stale dist, or the build-limit sentence is printed for a build that failed by itself; why_new=Cycle 0048 task 73 added the build bound and reportBuildFailure; no test makes the build fail by itself; seam=run-pregate-tests.mjs started as a process in a fixture repository whose stand-in build exits with code 3; no_claim=the build that cannot start (its spawn error), which a fixture cannot arrange
test('the pre-gate runner ends with the exit code of a build that failed, runs no test and does not say the build was ended for its time', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {
    'product.test.js': notingTest('product', true),
  })
  await writeFile(
    join(root, 'extension/scripts/build-fast.mjs'),
    [
      "import { appendFileSync } from 'node:fs'",
      "appendFileSync(process.env.ORDER_LOG, 'build\\n')",
      'process.exit(3)',
      '',
    ].join('\n'),
  )

  // Act
  const result = await runPregateRunner(root, [
    'extension/src/tests/product.test.ts',
  ])

  // Assert
  assert.deepEqual(
    { code: result.code, stderr: result.stderr, order: result.order },
    { code: 3, stderr: '', order: ['build'] },
  )
})

// Value: protects=the count the pre-gate reads from the end of the runner's output: when the reader is slower than the runner (a pipe that has filled), the combined summary is still written in full; fails_when=the runner ends with process.exit() right after writing the summary, which drops the output still queued for the pipe (the probe: 5 MB written to a pipe read after a second lose the tail); why_new=Cycle 0048 task 72 (Codex); seam=run-pregate-tests.mjs started as a process in a fixture repository with a stand-in build and a product test that prints 2.4 MB, whose output is read only after 2 s; no_claim=a reader on another system (Windows pipes are written the same way, but this test runs where the others run)
test('the pre-gate runner writes its whole output, the combined summary last, to a pipe that is read late', async (context) => {
  // Arrange
  const root = await createFixtureRepository(context, {
    'product.test.js': scriptedTest(
      'product',
      "for (let line = 0; line < 40_000; line++) console.log('x'.repeat(60))",
    ),
  })

  // Act
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(root, 'extension/scripts/run-pregate-tests.mjs'),
        'extension/src/tests/product.test.ts',
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => name !== 'NODE_TEST_CONTEXT',
            ),
          ),
          ORDER_LOG: join(root, 'order.log'),
        },
      },
    )
    let text = ''
    child.on('error', reject)
    child.on('close', () => resolve(text))
    // The pipe is not read for 2 s, so the runner's output queues up behind a full pipe.
    setTimeout(() => {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => (text += chunk))
    }, 2_000)
  })

  // Assert
  assert.deepEqual(output.trimEnd().split('\n').slice(-6), [
    'ℹ tests 1',
    'ℹ pass 1',
    'ℹ fail 0',
    'ℹ cancelled 0',
    'ℹ skipped 0',
    'ℹ todo 0',
  ])
})
