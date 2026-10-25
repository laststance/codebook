import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { RootClaimListing } from '../utils/listVitestForRootClaim'
import type { ListVitestTestFilesRequest } from '../utils/listVitestTestFiles'
import { planNodeTestExecution } from '../utils/planNodeTestExecution'

/**
 * Makes an empty repository folder by its real path, removed when the test ends.
 * @param context - The test, which removes the folder when it ends.
 * @returns The repository's real root.
 * @example const root = await repository(context) // => '/private/var/folders/.../codebook-vitest-root-x'
 */
async function repository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vitest-root-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Writes a file of the repository, making its folders.
 * @param root - The repository's real root.
 * @param path - The root-relative path.
 * @param text - The file's text.
 * @example await write(root, 'packages/a/vite.config.ts', 'export default {}\n')
 */
async function write(root: string, path: string, text = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/**
 * Installs a stand-in Vitest in a folder's `node_modules/vitest`: its package file with the version, and its program unless told otherwise.
 * @param root - The repository's real root.
 * @param folder - The root-relative folder whose `node_modules` holds it, `.` for the root.
 * @param version - The version its package file names.
 * @param withProgram - Whether `vitest.mjs` exists.
 * @example await installVitest(root, 'packages/toolkit', '5.0.0')
 */
async function installVitest(
  root: string,
  folder: string,
  version: string,
  withProgram = true,
): Promise<void> {
  await write(
    root,
    join(folder, 'node_modules/vitest/package.json'),
    JSON.stringify({ name: 'vitest', version }),
  )
  if (withProgram)
    await write(root, join(folder, 'node_modules/vitest/vitest.mjs'))
}

/**
 * Plans the cited test with a root claim listing that answers as given, recording what it was asked.
 * @param root - The repository's real root.
 * @param testFile - The cited root-relative test file.
 * @param answer - The root listing's outcome; the default fails the test if a claim is made.
 * @returns The plan's promise and the requests the root listing received.
 * @example const { plan, claims } = planWith(root, 'packages/a/src/a.test.ts')
 */
function planWith(
  root: string,
  testFile: string,
  answer: (
    request: ListVitestTestFilesRequest,
  ) => Promise<RootClaimListing> = async () =>
    assert.fail('this repository makes no root claim'),
) {
  const claims: ListVitestTestFilesRequest[] = []
  return {
    claims,
    plan: planNodeTestExecution({
      root,
      testFile: join(root, testFile),
      declaredTestFile: testFile,
      listRootClaim: async (request) => {
        claims.push(request)
        return answer(request)
      },
    }),
  }
}

/**
 * Reads the code and message of a refused plan.
 * @param plan - The plan's promise, expected to reject with a {@link StudyError}.
 * @returns The refusal's code and message.
 * @example await refusalOf(plan) // => { code: 'PREREQUISITE_MISSING', message: 'node-test needs …' }
 */
async function refusalOf(
  plan: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  const thrown = await plan.then(
    () => assert.fail('the plan was not refused'),
    (error: unknown) => error,
  )
  assert.ok(thrown instanceof StudyError, String(thrown))
  return { code: thrown.code, message: thrown.message }
}

// Value: protects=a TanStack-query-shaped package test running in its own package with the package's config and the hoisted Vitest; fails_when=the Vitest root stays the opened root, the filter stays repository-relative, the hoisted Vitest is not found, or a claim is made without a root config; why_new=node-test ran every test from the root, without the package's config (Cycle 0053 task 2); seam=real files, a stand-in Vitest package; no_claim=Vitest's own config loading (task 1 spike)
test('a test under a package config runs in that package, with its path from there and the Vitest hoisted above it', async (context) => {
  // Arrange
  const root = await repository(context)
  await write(root, 'packages/query-core/vite.config.ts')
  await write(root, 'packages/query-core/src/__tests__/query.test.tsx')
  await installVitest(root, '.', '5.0.5')
  const { plan, claims } = planWith(
    root,
    'packages/query-core/src/__tests__/query.test.tsx',
  )

  // Act
  const planned = await plan

  // Assert
  assert.equal(planned.vitestRoot, join(root, 'packages/query-core'))
  assert.equal(planned.filter, 'src/__tests__/query.test.tsx')
  assert.equal(planned.vitest.directory, root)
  assert.equal(
    planned.vitest.program,
    join(root, 'node_modules/vitest/vitest.mjs'),
  )
  assert.deepEqual(planned.summary, {
    vitestRoot: 'packages/query-core',
    vitestRootReason: 'nearest-config',
    rootClaim: 'not-applicable',
    vitestConfigFiles: ['vite.config.ts'],
    skippedConfigFiles: [],
  })
  assert.deepEqual(claims, [])
})

// Value: protects=root mode for a test with no nearer config: it keeps the declared path as its filter and names whether the root holds a config; fails_when=a test under no config leaves the opened root, its filter changes, or the reason confuses a root config with none; why_new=AC 3 keeps root-mode runs exactly as at 83a07385 (task 2); seam=real files; no_claim=the argv and cwd of the launch (H4 in nodeTestVitestRootLaunch tests)
test('a test under no package config runs at the opened root with its declared path, with or without a root config', async (context) => {
  // Arrange
  const withRootConfig = await repository(context)
  const withoutConfig = await repository(context)
  for (const root of [withRootConfig, withoutConfig]) {
    await write(root, 'src/scheduler.test.ts')
    await installVitest(root, '.', '4.1.11')
  }
  await write(withRootConfig, 'vitest.config.ts')

  // Act
  const configured = await planWith(withRootConfig, 'src/scheduler.test.ts')
    .plan
  const bare = await planWith(withoutConfig, 'src/scheduler.test.ts').plan

  // Assert
  assert.equal(configured.vitestRoot, withRootConfig)
  assert.equal(configured.filter, 'src/scheduler.test.ts')
  assert.deepEqual(configured.summary, {
    vitestRoot: '.',
    vitestRootReason: 'root-config',
    rootClaim: 'not-applicable',
    vitestConfigFiles: ['vitest.config.ts'],
    skippedConfigFiles: [],
  })
  assert.equal(bare.vitestRoot, withoutConfig)
  assert.deepEqual(bare.summary, {
    vitestRoot: '.',
    vitestRootReason: 'no-config',
    rootClaim: 'not-applicable',
    vitestConfigFiles: [],
    skippedConfigFiles: [],
  })
})

// Value: protects=a redux-toolkit-shaped package whose only Vitest is its own; fails_when=the package's own Vitest is not the one run, or a repository without a root Vitest is refused; why_new=node-test refused a repository without a root Vitest (readVitestPrerequisite.ts:69 at 83a07385); seam=real files; no_claim=pnpm's or npm's install layout
test('a package whose only Vitest is its own runs with that Vitest', async (context) => {
  // Arrange
  const root = await repository(context)
  await write(root, 'packages/toolkit/vitest.config.mts')
  await write(root, 'packages/toolkit/src/tests/createAsyncThunk.test.ts')
  await installVitest(root, 'packages/toolkit', '5.0.0')

  // Act
  const planned = await planWith(
    root,
    'packages/toolkit/src/tests/createAsyncThunk.test.ts',
  ).plan

  // Assert
  assert.equal(planned.vitest.directory, join(root, 'packages/toolkit'))
  assert.equal(planned.vitest.version, '5.0.0')
  assert.equal(planned.filter, 'src/tests/createAsyncThunk.test.ts')
})

// Value: protects=Node's resolution order: the nearest node_modules/vitest is the Vitest, never one further up; fails_when=an older package Vitest is skipped for a supported root one, so the run uses a Vitest the package does not; why_new=the walk never falls back (task 2, rule 2); seam=real files; no_claim=other version checks
test('an older Vitest nearest the package is refused even when a supported one lies above it', async (context) => {
  // Arrange
  const root = await repository(context)
  await write(root, 'packages/legacy/vite.config.ts')
  await write(root, 'packages/legacy/src/legacy.test.ts')
  await installVitest(root, 'packages/legacy', '3.2.4')
  await installVitest(root, '.', '5.0.2')

  // Act
  const refusal = await refusalOf(
    planWith(root, 'packages/legacy/src/legacy.test.ts').plan,
  )

  // Assert
  assert.deepEqual(refusal, {
    code: 'PREREQUISITE_MISSING',
    message:
      'node-test needs Vitest 4 or later for packages/legacy/src/legacy.test.ts; packages/legacy/node_modules/vitest is 3.2.4. Ask the learner to upgrade it, then start the test again.',
  })
})

// Value: protects=each of the five Vitest refusals' exact sentence, naming the test, the folder and the fix; fails_when=a sentence changes, names the repository root for a package, or misses "then start the test again"; why_new=Cycle 0053 task 5 pins the literals (AC 6); seam=real files and links; no_claim=Windows junctions
test('a test whose Vitest is missing, unreadable, without its program or outside the repository is refused with its own sentence', async (context) => {
  // Arrange
  const none = await repository(context)
  const unreadable = await repository(context)
  const withoutProgram = await repository(context)
  const linked = await repository(context)
  const outside = await repository(context)
  for (const root of [none, unreadable, withoutProgram, linked]) {
    await write(root, 'packages/a/vite.config.ts')
    await write(root, 'packages/a/src/a.test.ts')
  }
  await installVitest(unreadable, 'packages/a', 'not a version')
  await installVitest(withoutProgram, 'packages/a', '5.0.2', false)
  await installVitest(outside, '.', '5.0.2')
  await mkdir(join(linked, 'packages/a/node_modules'), { recursive: true })
  await symlink(
    join(outside, 'node_modules/vitest'),
    join(linked, 'packages/a/node_modules/vitest'),
    'dir',
  )

  // Act
  const refusals = await Promise.all(
    [none, unreadable, withoutProgram, linked].map((root) =>
      refusalOf(planWith(root, 'packages/a/src/a.test.ts').plan),
    ),
  )

  // Assert
  assert.deepEqual(refusals, [
    {
      code: 'PREREQUISITE_MISSING',
      message:
        'node-test needs Vitest 4 or later for packages/a/src/a.test.ts; none was found in packages/a/node_modules/vitest or above it inside the repository. Ask the learner to install Vitest in that package or at the repository root, then start the test again.',
    },
    {
      code: 'PREREQUISITE_MISSING',
      message:
        'node-test cannot read the version of packages/a/node_modules/vitest for packages/a/src/a.test.ts: its package.json is missing, unreadable or not a Vitest package file. Ask the learner to reinstall the dependencies, then start the test again.',
    },
    {
      code: 'PREREQUISITE_MISSING',
      message:
        'node-test needs the Vitest program packages/a/node_modules/vitest/vitest.mjs for packages/a/src/a.test.ts; reinstall Vitest there, then start the test again.',
    },
    {
      code: 'PREREQUISITE_MISSING',
      message:
        'node-test needs Vitest 4 or later inside the repository for packages/a/src/a.test.ts; packages/a/node_modules/vitest links outside it (for example to a package store outside the repository), which Codebook does not run. Ask the learner to install the dependencies so that Vitest lies inside the repository, then start the test again.',
    },
  ])
})

// Value: protects=the walk passing over config-named folders, outside links and dangling links on its way, and naming them; fails_when=such an entry stops the walk, is loaded as a config, or is not listed in skippedConfigFiles by its in-repository path; why_new=task 2 (a config name that is a directory, an outside link and a dangling link are skipped); seam=real folders and links; no_claim=Windows junctions
test('config-named folders and links nothing can load on the way are passed over and named', async (context) => {
  // Arrange
  const root = await repository(context)
  const outside = await repository(context)
  await write(outside, 'vite.config.ts')
  await write(root, 'packages/a/vite.config.ts')
  await write(root, 'packages/a/src/a.test.ts')
  await mkdir(join(root, 'packages/a/src/vitest.config.ts'))
  await symlink(
    join(outside, 'vite.config.ts'),
    join(root, 'packages/a/src/vite.config.ts'),
  )
  await symlink(
    join(root, 'packages/a/src/missing.ts'),
    join(root, 'packages/a/src/vitest.config.mts'),
  )
  await installVitest(root, '.', '5.0.2')

  // Act
  const planned = await planWith(root, 'packages/a/src/a.test.ts').plan

  // Assert
  assert.equal(planned.summary.vitestRoot, 'packages/a')
  assert.deepEqual(planned.summary.skippedConfigFiles, [
    'packages/a/src/vitest.config.ts',
    'packages/a/src/vite.config.ts',
    'packages/a/src/vitest.config.mts',
  ])
})

// Value: protects=the refusal of a Vitest root that holds a config-named folder or a link that leaves the repository, in package and in root mode; fails_when=Vitest is started beside such an entry, which its own config search could load, or the sentence changes; why_new=Eng review d8, the one intended root-mode change (AC 3); seam=real folders and links; no_claim=Vitest's choice between several real config files
test('a Vitest root holding a config-named folder or an outside link is refused before Vitest starts there', async (context) => {
  // Arrange
  const packageRoot = await repository(context)
  const openedRoot = await repository(context)
  const outside = await repository(context)
  await write(outside, 'vite.config.ts')
  await write(packageRoot, 'packages/a/vite.config.ts')
  await mkdir(join(packageRoot, 'packages/a/vitest.config.ts'))
  await write(packageRoot, 'packages/a/src/a.test.ts')
  await installVitest(packageRoot, '.', '5.0.2')
  await write(openedRoot, 'src/a.test.ts')
  await symlink(
    join(outside, 'vite.config.ts'),
    join(openedRoot, 'vite.config.ts'),
  )
  await installVitest(openedRoot, '.', '5.0.2')

  // Act
  const inPackage = await refusalOf(
    planWith(packageRoot, 'packages/a/src/a.test.ts').plan,
  )
  const atRoot = await refusalOf(planWith(openedRoot, 'src/a.test.ts').plan)

  // Assert
  assert.deepEqual(inPackage, {
    code: 'PREREQUISITE_MISSING',
    message:
      'node-test does not start Vitest in packages/a for packages/a/src/a.test.ts: vitest.config.ts there is a folder or a link that leaves the repository, and Vitest could load it as its config. Ask the learner to remove or replace it, then start the test again.',
  })
  assert.deepEqual(atRoot, {
    code: 'PREREQUISITE_MISSING',
    message:
      'node-test does not start Vitest in . for src/a.test.ts: vite.config.ts there is a folder or a link that leaves the repository, and Vitest could load it as its config. Ask the learner to remove or replace it, then start the test again.',
  })
})

// Value: protects=a test whose path from its Vitest root starts with "-", which Vitest would read as an option; fails_when=such a filter reaches the Vitest command line, or the sentence changes; why_new=Eng review (task 2, rule 4); seam=real files; no_claim=other unusual file names
test('a test whose path from its Vitest root starts with a dash is refused', async (context) => {
  // Arrange
  const root = await repository(context)
  await write(root, 'packages/a/vite.config.ts')
  await write(root, 'packages/a/-flags.test.ts')
  await installVitest(root, '.', '5.0.2')

  // Act
  const refusal = await refusalOf(
    planWith(root, 'packages/a/-flags.test.ts').plan,
  )

  // Assert
  assert.deepEqual(refusal, {
    code: 'INVALID_CONFIGURATION',
    message:
      'node-test cannot pass packages/a/-flags.test.ts to Vitest from packages/a: its path there starts with "-", which Vitest would read as an option. Ask the learner to rename that file or folder, then start the test again.',
  })
})

/**
 * Builds an nsx-shaped repository: a root config and root Vitest beside a package with its own config, so a root claim applies.
 * @param context - Removes the folder when the test ends.
 * @returns The repository's real root.
 * @example const root = await claimRepository(context)
 */
async function claimRepository(context: TestContext): Promise<string> {
  const root = await repository(context)
  await write(root, 'vitest.config.ts')
  await write(root, 'browser-extension/vitest.config.ts')
  await write(root, 'browser-extension/tests/unit/popup.test.tsx')
  await installVitest(root, '.', '5.0.5')
  return root
}

const CLAIMED_TEST = 'browser-extension/tests/unit/popup.test.tsx'

// Value: protects=the root claim keeping a test the root config already selects exactly once at the root, as it runs today, and asking with the root Vitest and the declared path; fails_when=such a test moves to its package config, or the claim's listing runs elsewhere or with another filter; why_new=CEO review root claim (H5 root-mode case); seam=the root listing is scripted; no_claim=Vitest's listing itself (listVitestForRootClaim tests)
test('a test the root config selects exactly once keeps running at the root', async (context) => {
  // Arrange
  const root = await claimRepository(context)
  const { plan, claims } = planWith(root, CLAIMED_TEST, async () => ({
    outcome: 'listed',
    files: [{ file: join(root, CLAIMED_TEST) }],
  }))

  // Act
  const planned = await plan

  // Assert
  assert.deepEqual(claims, [
    {
      program: join(root, 'node_modules/vitest/vitest.mjs'),
      vitestRoot: root,
      filter: CLAIMED_TEST,
      excludes: [],
    },
  ])
  assert.equal(planned.vitestRoot, root)
  assert.equal(planned.nearestConfigDirectory, join(root, 'browser-extension'))
  assert.equal(planned.filter, CLAIMED_TEST)
  assert.deepEqual(planned.summary, {
    vitestRoot: '.',
    vitestRootReason: 'root-claim',
    rootClaim: 'selected-once',
    vitestConfigFiles: ['vitest.config.ts'],
    skippedConfigFiles: [],
  })
})

// Value: protects=the three root-claim results that leave a test in its package: zero selections, several projects, and a listing Vitest itself failed; fails_when=one of them keeps root mode, or the manifest's rootClaim does not name it; why_new=CEO review root claim (H5 package-mode cases); seam=the root listing is scripted; no_claim=the journal record of the claim (launchNodeTest tests)
test('a root listing that selects the test zero times, under two projects or fails cleanly leaves it in its package', async (context) => {
  // Arrange
  const root = await claimRepository(context)
  const cited = { file: join(root, CLAIMED_TEST) }
  const answers: RootClaimListing[] = [
    { outcome: 'listed', files: [] },
    {
      outcome: 'listed',
      files: [
        { ...cited, projectName: 'web' },
        { ...cited, projectName: 'server' },
      ],
    },
    { outcome: 'failed', error: new Error('Vitest exited with code 1') },
  ]

  // Act
  const planned = await Promise.all(
    answers.map(
      (answer) => planWith(root, CLAIMED_TEST, async () => answer).plan,
    ),
  )

  // Assert
  assert.deepEqual(
    planned.map((plan) => [
      plan.summary.vitestRoot,
      plan.summary.vitestRootReason,
      plan.summary.rootClaim,
      plan.filter,
    ]),
    [
      [
        'browser-extension',
        'nearest-config',
        'not-selected',
        'tests/unit/popup.test.tsx',
      ],
      [
        'browser-extension',
        'nearest-config',
        'several-projects',
        'tests/unit/popup.test.tsx',
      ],
      [
        'browser-extension',
        'nearest-config',
        'listing-failed',
        'tests/unit/popup.test.tsx',
      ],
    ],
  )
})

// Value: protects=a cancelled start, a passed deadline and a listing whose process group could not be confirmed as ended refusing the start with the listing's own error, never falling back to the package; fails_when=one of them plans a package-mode run, or the refusal loses the listing's error; why_new=Eng review (H5 refusals: neither the package listing nor the launch runs, since the plan never forms); seam=the root listing is scripted; no_claim=the classification of a real listing (listVitestForRootClaim tests)
test('a root listing that was cancelled, passed its deadline or left its process group unconfirmed refuses the start', async (context) => {
  // Arrange
  const root = await claimRepository(context)
  const errors = ['cancelled', 'deadline', 'unconfirmed'] as const

  // Act
  const results = await Promise.all(
    errors.map((outcome) => {
      const error = new Error(`the root listing ended: ${outcome}`)
      return planWith(root, CLAIMED_TEST, async () => ({
        outcome,
        error,
      })).plan.then(
        () => 'planned',
        (thrown: unknown) => (thrown === error ? 'refused' : String(thrown)),
      )
    }),
  )

  // Assert
  assert.deepEqual(results, ['refused', 'refused', 'refused'])
})

// Value: protects=a root claim made only with the root's own usable Vitest; fails_when=a root Vitest below 4 is asked to list, or its refusal stops a package test that has a usable Vitest of its own; why_new=task 2 (an unusable root Vitest skips the claim); seam=real files; no_claim=a missing root Vitest (the same branch)
test('a root Vitest older than 4 skips the root claim and leaves the test in its package', async (context) => {
  // Arrange
  const root = await repository(context)
  await write(root, 'vitest.config.ts')
  await write(root, 'apps/api/vitest.config.ts')
  await write(root, 'apps/api/src/rpc/domain.test.ts')
  await installVitest(root, '.', '3.2.4')
  await installVitest(root, 'apps/api', '5.0.1')
  const { plan, claims } = planWith(root, 'apps/api/src/rpc/domain.test.ts')

  // Act
  const planned = await plan

  // Assert
  assert.deepEqual(claims, [])
  assert.equal(planned.summary.vitestRoot, 'apps/api')
  assert.equal(planned.summary.rootClaim, 'not-applicable')
  assert.equal(planned.vitest.version, '5.0.1')
})

// Value: protects=the opened root bounding the walk when it was opened through a link, so a config above it is never consulted; fails_when=the walk passes the canonical root and stops at a parent's config; why_new=Eng review (a symlinked opened root still bounds the walk); seam=a real link to the repository; no_claim=Windows junctions
test('a repository opened through a link stops its walk at its own root', async (context) => {
  // Arrange
  const parent = await repository(context)
  await write(parent, 'vitest.config.ts')
  await write(parent, 'project/src/a.test.ts')
  await installVitest(parent, 'project', '5.0.2')
  const linkFolder = await repository(context)
  await symlink(join(parent, 'project'), join(linkFolder, 'opened'), 'dir')
  const root = await realpath(join(linkFolder, 'opened'))

  // Act
  const planned = await planWith(root, 'src/a.test.ts').plan

  // Assert
  assert.equal(root, join(parent, 'project'))
  assert.equal(planned.vitestRoot, root)
  assert.equal(planned.summary.vitestRootReason, 'no-config')
})

// Value: protects=a folder on the way to the Vitest that cannot be read refusing the start with a sentence naming it; fails_when=an EACCES folder is treated as "no Vitest" and the walk goes on to a Vitest above it, or the error escapes unnamed; why_new=Eng review (an unreadable ancestor refuses); seam=a real folder without permissions; no_claim=a run as root, which reads every folder (skipped)
test('a folder on the way to the Vitest that cannot be read refuses the start', async (context) => {
  // Arrange
  if (process.getuid?.() === 0) {
    context.skip('root reads every folder')
    return
  }
  const root = await repository(context)
  await write(root, 'packages/a/vite.config.ts')
  await write(root, 'packages/a/src/a.test.ts')
  await installVitest(root, 'packages/a', '5.0.2')
  await installVitest(root, '.', '5.0.2')
  await chmod(join(root, 'packages/a/node_modules'), 0o000)

  // Act
  const refusal = await refusalOf(
    planWith(root, 'packages/a/src/a.test.ts').plan,
  ).finally(() => chmod(join(root, 'packages/a/node_modules'), 0o755))

  // Assert
  assert.deepEqual(refusal, {
    code: 'PREREQUISITE_MISSING',
    message:
      'node-test cannot read packages/a/node_modules/vitest for packages/a/src/a.test.ts (EACCES). Ask the learner to make that folder readable, then start the test again.',
  })
})
