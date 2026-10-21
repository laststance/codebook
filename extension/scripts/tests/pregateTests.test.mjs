import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createBoundedOutput } from '../utils/createBoundedOutput.mjs'
import { createRunLineForwarder } from '../utils/createRunLineForwarder.mjs'
import { mapPregateTests } from '../utils/mapPregateTests.mjs'
import {
  combinedSummary,
  planPregateRuns,
  runSummaryLine,
} from '../utils/planPregateRuns.mjs'
import { readRunSummary } from '../utils/readRunSummary.mjs'
import { runBuildWithLimit } from '../utils/runBuildWithLimit.mjs'
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

// Value: protects=the pre-gate's count of a lane: a test that prints `ℹ tests 99` at column 0 adds nothing to the combined summary, and a run that died before its summary adds nothing either; fails_when=the combined summary adds every line of the summary form, so one test's text changes the count the pre-gate reads; why_new=Cycle 0048 task 135 (native adversarial: combinedSummary summed every such line); seam=none; no_claim=a test that prints a whole fake summary block
test('the pre-gate adds only the last summary block of each run to the combined summary, not a line a test printed', () => {
  // Arrange
  const outputs = [
    'ℹ tests 99\n✔ a (1ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 12.5',
    '✔ b (2ms)\nℹ pass 7',
    'ℹ tests 3\nℹ suites 0\nℹ pass 3\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 30',
  ]

  // Act
  const summary = combinedSummary(outputs)

  // Assert
  assert.deepEqual(summary, [
    'ℹ tests 5',
    'ℹ pass 5',
    'ℹ fail 0',
    'ℹ cancelled 0',
    'ℹ skipped 0',
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

// Value: protects=the pre-gate runs the script test that reads a repository file no import reaches (a file it opens by a path built in code, a place beside it, a file it copies into a fixture, or the policy itself): a change to that file selects the test; fails_when=one of these entries is dropped or points to another test, so a change to `.gitignore`, `AGENTS.md`, `.codex/hooks.json`, the shipped skill's `SKILL.md` or `reader-shell.html`, a browser check, the health checker, the shard script or the policy runs no test that reads it; why_new=Cycle 0048 task 122 (Red Team: workflowPins.test.mjs read five files that the policy named nowhere; the same search over every script test found the rest); Cycle 0048 task 154 added renderWikiPageLimit.test.mjs and wikiReaderDomQa.test.mjs to the reader shell (the renderer reads it) and package.test.mjs to `.gitignore` (the Git status guarding the build reads it); seam=none; no_claim=files that a test only writes into a fixture (the fixtures of packageIO.test.mjs, `extension/test-timings.json`), and the files the import graph reaches, which the pre-gate decides
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
    gitignore: [
      `${scriptTests}repositoryIgnore.test.mjs`,
      `${scriptTests}package.test.mjs`,
    ],
    policy: [`${scriptTests}pregateTests.test.mjs`],
    agents: ['.codex/restore-product-context.test.mjs'],
    codexHooks: ['.codex/restore-product-context.test.mjs'],
    healthChecker: [`${scriptTests}health.test.mjs`],
    shardScript: [`${scriptTests}testShards.test.mjs`],
    studyCheck: [
      `${scriptTests}studyBootstrapQa.test.mjs`,
      `${scriptTests}workflowPins.test.mjs`,
    ],
    wikiCheck: [
      `${scriptTests}wikiReaderDomQa.test.mjs`,
      `${scriptTests}workflowPins.test.mjs`,
    ],
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
      `${scriptTests}renderWikiPageLimit.test.mjs`,
      `${scriptTests}wikiReaderDomQa.test.mjs`,
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
 * Turns a glob of `.gstack/pregate.json` into the pattern the gstack pre-gate matches a repository path with: `*` is any characters but `/`, `**` any characters, `**` followed by `/` zero or more folders, `?` one character but `/`.
 * Called by {@link testsSelectedBy} so the policy tests read a glob as the pre-gate does.
 * @param glob - A key of `dependencies`.
 * @returns The pattern that matches the whole path.
 * @example globPattern('extension/src/**').test('extension/src/a/b.ts') // => true
 */
function globPattern(glob) {
  let pattern = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*' && glob[index + 1] === '*') {
      index += 1
      // `**/` also matches no folder at all.
      if (glob[index + 1] === '/') {
        index += 1
        pattern += '(?:.*/)?'
      } else pattern += '.*'
    } else if (character === '*') pattern += '[^/]*'
    else if (character === '?') pattern += '[^/]'
    else pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${pattern}$`)
}

/**
 * Lists the tests the policy selects for one repository file: the union of the tests of every `dependencies` entry whose glob matches the file, as the pre-gate unions them. Called by the policy tests that pin which test a file selects when a module reads it by path.
 * @param dependencies - The `dependencies` object of `.gstack/pregate.json`.
 * @param file - A repository path.
 * @returns The selected test paths, without repeats, sorted.
 * @example testsSelectedBy({ 'a/**': ['t.mjs'], 'a/b.txt': ['u.mjs'] }, 'a/b.txt') // => ['t.mjs', 'u.mjs']
 */
function testsSelectedBy(dependencies, file) {
  const selected = Object.entries(dependencies)
    .filter(([glob]) => globPattern(glob).test(file))
    .flatMap(([, tests]) => tests)
  return [...new Set(selected)].toSorted()
}

// Value: protects=the pre-gate runs package.test.mjs for a change to any file its package build reads by a path built in code: the five package inputs `readBuildIdentity` names, every file in the four folders it walks (`src`, `scripts`, `patches`, `skills`), and `.gitignore`, which the Git status that guards the build reads; fails_when=the policy drops package.test.mjs from one of these, or `readBuildIdentity` reads another file or folder that the policy does not name (the test reads the lists out of that module), so a change there runs no test that builds the package from it; why_new=Cycle 0048 task 154 (OCR B: tasks 122 and 136 gave lanes to what a test reads or starts itself, not to what a module it imports or a script it starts reads by path: `buildPackage.mjs:59` and `readBuildIdentity.mjs:53-84` read the files below for the build that package.test.mjs runs on the checkout); seam=none (the policy file, the module's source and the folders); no_claim=that a content change in a file the build only hashes (`scripts`, `patches`) can fail package.test.mjs (it can fail for a symlink, a missing file or a build that no longer compiles or bundles), and files the build reads in a fixture (packageIO.test.mjs, packageCli.test.mjs, health.test.mjs)
test('the pre-gate policy runs package.test.mjs for every file its package build reads by path: the package inputs, the four folders the build identity walks, and the ignore rules', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )
  const identitySource = readFileSync(
    `${repositoryRoot}extension/scripts/utils/readBuildIdentity.mjs`,
    'utf8',
  )
  const quotedIn = (declaration) =>
    [...identitySource.match(declaration)[1].matchAll(/'([^']+)'/g)].map(
      (match) => match[1],
    )

  // Act
  const namedInputs = quotedIn(/const files = \[([^\]]*)\]/)
  const walkedFolders = quotedIn(/const parts = \[([^\]]*)\]/)
  const readFiles = [
    ...namedInputs.map((file) => `extension/${file}`),
    ...walkedFolders.flatMap((folder) =>
      readdirSync(`${repositoryRoot}extension/${folder}`, {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) =>
          `${entry.parentPath}/${entry.name}`
            .slice(repositoryRoot.length)
            .replaceAll('\\', '/'),
        ),
    ),
    '.gitignore',
  ]
  const packageTest = 'extension/scripts/tests/package.test.mjs'
  const leftOut = readFiles.filter(
    (file) => !testsSelectedBy(policy.dependencies, file).includes(packageTest),
  )

  // Assert
  assert.deepEqual(namedInputs, [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'pnpm-workspace.yaml',
    'README.md',
  ])
  assert.deepEqual(walkedFolders, ['src', 'scripts', 'patches', 'skills'])
  assert.deepEqual(leftOut, [])
  assert.deepEqual(
    {
      manifest: testsSelectedBy(policy.dependencies, 'extension/package.json'),
      patch: testsSelectedBy(
        policy.dependencies,
        'extension/patches/@modelcontextprotocol__sdk@1.30.0.patch',
      ),
      ignoreRules: testsSelectedBy(policy.dependencies, '.gitignore'),
    },
    {
      manifest: [
        'extension/scripts/tests/package.test.mjs',
        'extension/scripts/tests/workflowPins.test.mjs',
      ],
      patch: ['extension/scripts/tests/package.test.mjs'],
      ignoreRules: [
        'extension/scripts/tests/package.test.mjs',
        'extension/scripts/tests/repositoryIgnore.test.mjs',
      ],
    },
  )
})

// Value: protects=the pre-gate runs the script tests that run a module which reads a repository file by a path built in code: the Wiki renderer reads `reader-shell.html` beside itself for every page it renders (renderWikiPageLimit.test.mjs, the publisher's tests, and wikiReaderDomQa.test.mjs through the check it starts), and runPackageCommand.test.mjs copies three utilities into a fixture and runs them there; fails_when=a change to the shell runs neither renderWikiPageLimit.test.mjs nor wikiReaderDomQa.test.mjs, or a change to one of the three copied utilities runs no runPackageCommand.test.mjs; why_new=Cycle 0048 task 154 (OCR B, the class of a module's read by path: `render-wiki.mjs:126` reads the shell, and `runPackageCommand.test.mjs:84-91` reads the three utilities by a name beside a base URL); seam=none (the policy file); no_claim=the tests the import graph reaches by an import
test('the pre-gate policy runs the tests that render a Wiki page or start the Wiki reader check for a change to the reader shell, and the test that copies the package command utilities for a change to one of them', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )

  // Act
  const lanes = {
    readerShell: testsSelectedBy(
      policy.dependencies,
      'extension/skills/codebook/reader-shell.html',
    ),
    runPackageCommand: testsSelectedBy(
      policy.dependencies,
      'extension/scripts/utils/runPackageCommand.mjs',
    ),
    withPackageOutput: testsSelectedBy(
      policy.dependencies,
      'extension/scripts/utils/withPackageOutput.mjs',
    ),
    packageConstants: testsSelectedBy(
      policy.dependencies,
      'extension/scripts/utils/packageConstants.mjs',
    ),
  }

  // Assert
  const packageAndCommand = [
    'extension/scripts/tests/package.test.mjs',
    'extension/scripts/tests/runPackageCommand.test.mjs',
  ]
  assert.deepEqual(lanes, {
    readerShell: [
      'extension/scripts/tests/package.test.mjs',
      'extension/scripts/tests/publishWiki.test.mjs',
      'extension/scripts/tests/renderWikiPageLimit.test.mjs',
      'extension/scripts/tests/studyBootstrapQa.test.mjs',
      'extension/scripts/tests/wikiReaderDomQa.test.mjs',
    ],
    runPackageCommand: packageAndCommand,
    withPackageOutput: packageAndCommand,
    packageConstants: packageAndCommand,
  })
})

// Value: protects=the pre-gate runs the script test that starts a script as a process, copies it into a fixture, or reads it by a path built in code: a change to `run-pregate-tests.mjs`, `collectTestRun.mjs`, `planWholeSplitFiles.mjs`, a browser check (`*-qa.mjs`), `build-fast.mjs`, `check-package.mjs`, `package.mjs`, a file-system stand-in of the publisher's tests, `codecov.yml`, `extension/package.json` or `extension/pnpm-workspace.yaml` selects the test that runs or reads it; fails_when=one of these entries is dropped or points to another test, so a change to such a file runs no test that starts or reads it (the import graph does not reach a file that a test only starts); why_new=Cycle 0048 task 136 (OCR B, Red Team: task 122 found only literal reads); Cycle 0048 task 154 added package.test.mjs to `extension/package.json` and `extension/pnpm-workspace.yaml`; task 155 derived the browser-check assertion from the folder (every script that drives `playwright-cli`) and from workflowPins.test.mjs's listing of `*-qa.mjs`, so a sixth check needs no edit here; seam=none (the policy file and the files it names); no_claim=files a test only writes into a fixture, and the files the import graph reaches
test('the pre-gate policy declares the script test that starts or copies each script and reads each browser check, and every browser check in the folder is covered', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const policy = JSON.parse(
    readFileSync(`${repositoryRoot}.gstack/pregate.json`, 'utf8'),
  )
  const scripts = 'extension/scripts/'
  const scriptTests = 'extension/scripts/tests/'

  // Act
  const declared = (file) => policy.dependencies[file]
  const lanes = {
    pregateRunner: declared(`${scripts}run-pregate-tests.mjs`),
    collectTestRun: declared(`${scripts}utils/collectTestRun.mjs`),
    planWholeSplitFiles: declared(`${scripts}utils/planWholeSplitFiles.mjs`),
    browserChecks: declared(`${scripts}*-qa.mjs`),
    studyBootstrapCheck: declared(`${scripts}study-bootstrap-qa.mjs`),
    wikiReaderDomCheck: declared(`${scripts}wiki-reader-dom-qa.mjs`),
    fastBuild: declared(`${scripts}build-fast.mjs`),
    packageChecker: declared(`${scripts}check-package.mjs`),
    packageCommand: declared(`${scripts}package.mjs`),
    wrongLookStandIn: declared(`${scriptTests}utils/wrongLookFileSystem.mjs`),
    crlfShellStandIn: declared(`${scriptTests}utils/crlfShellFileSystem.mjs`),
    codecov: declared('codecov.yml'),
    extensionManifest: declared('extension/package.json'),
    pnpmWorkspace: declared('extension/pnpm-workspace.yaml'),
  }
  // A browser check is a script of the folder that drives the browser CLI; workflowPins.test.mjs reads every `*-qa.mjs` of the folder, by the listing and the filter below.
  const browserChecksInFolder = readdirSync(`${repositoryRoot}${scripts}`)
    .filter(
      (name) =>
        name.endsWith('.mjs') &&
        readFileSync(`${repositoryRoot}${scripts}${name}`, 'utf8').includes(
          'playwright-cli',
        ),
    )
    .toSorted()
  const workflowPinsSource = readFileSync(
    `${repositoryRoot}${scriptTests}workflowPins.test.mjs`,
    'utf8',
  )
  const namedTests = Object.values(policy.dependencies).flat()
  const missingTests = namedTests.filter(
    (test) => !existsSync(`${repositoryRoot}${test}`),
  )

  // Assert
  const workflowPins = [`${scriptTests}workflowPins.test.mjs`]
  const workflowPinsAndPackage = [
    `${scriptTests}workflowPins.test.mjs`,
    `${scriptTests}package.test.mjs`,
  ]
  const publishWiki = [`${scriptTests}publishWiki.test.mjs`]
  assert.deepEqual(lanes, {
    pregateRunner: [`${scriptTests}pregateTests.test.mjs`],
    collectTestRun: [`${scriptTests}testShards.test.mjs`],
    planWholeSplitFiles: [`${scriptTests}testShards.test.mjs`],
    browserChecks: workflowPins,
    studyBootstrapCheck: [
      `${scriptTests}studyBootstrapQa.test.mjs`,
      `${scriptTests}workflowPins.test.mjs`,
    ],
    wikiReaderDomCheck: [
      `${scriptTests}wikiReaderDomQa.test.mjs`,
      `${scriptTests}workflowPins.test.mjs`,
    ],
    fastBuild: workflowPins,
    packageChecker: [`${scriptTests}package.test.mjs`],
    packageCommand: [`${scriptTests}packageCli.test.mjs`],
    wrongLookStandIn: publishWiki,
    crlfShellStandIn: publishWiki,
    codecov: workflowPins,
    extensionManifest: workflowPinsAndPackage,
    pnpmWorkspace: workflowPinsAndPackage,
  })
  // Every browser check, whatever its name, is in the lane of workflowPins.test.mjs: a sixth check passes when its name is read by that test and fails when it is not.
  const checksWorkflowPinsDoesNotRead = browserChecksInFolder.filter(
    (name) =>
      !testsSelectedBy(policy.dependencies, `${scripts}${name}`).includes(
        workflowPins[0],
      ),
  )
  assert.deepEqual(checksWorkflowPinsDoesNotRead, [])
  // The test reads the checks by listing the folder and keeping the names that end in `-qa.mjs`, which is what the glob `*-qa.mjs` of the policy names.
  assert.match(
    workflowPinsSource,
    /readdir\(join\(repositoryRoot, 'extension\/scripts'\)\)\)\s*\.filter\(\(name\) => name\.endsWith\('-qa\.mjs'\)\)/,
  )
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

/** Tells whether a process still runs; a zombie that nobody has reaped yet counts as gone. @example processRuns(4242) // => false */
function processRuns(pid) {
  try {
    const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim()
    return state !== '' && !state.startsWith('Z')
  } catch {
    // `ps` exits with 1 when no process has this id.
    return false
  }
}

/** Waits until the file holds a process id, which the stand-in build writes once it has started its process. @example await waitForProcessId('/tmp/x/grandchild.pid', 10_000) // => 4242 */
async function waitForProcessId(pidFile, waitMs) {
  const until = Date.now() + waitMs
  for (;;) {
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''))
    if (pid > 0 || Date.now() > until) return pid > 0 ? pid : undefined
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Waits until a process is gone or the wait is over; the end of a killed process is seen a moment after the kill. @example await waitUntilGone(4242, 5_000) // => true */
async function waitUntilGone(pid, waitMs) {
  const until = Date.now() + waitMs
  while (processRuns(pid) && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 50))
  return !processRuns(pid)
}

// Value: protects=the memory of the output keeper: the end of a long output stays (the failing tests and the summary come last) with a note of what was left out, cut at a line start, and an output within the bound is kept whole with no note; fails_when=the keeper holds every chunk, or cuts a line in two so that a half of a summary line could be read as a summary; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial); seam=createBoundedOutput alone; no_claim=the bound of the runners (TEST_OUTPUT_KEEP_CHARS), a constant
test('the output keeper keeps the end of an output longer than its bound from a line start, with a note of what it left out, and keeps a short output whole', () => {
  // Arrange
  const long = createBoundedOutput(50)
  const short = createBoundedOutput(50)
  const lines = Array.from({ length: 30 }, (_, index) => `line number ${index}`)

  // Act
  for (const line of lines) long.append(`${line}\n`)
  short.append('one\n')
  short.append('two\n')

  // Assert
  const longText = long.text()
  assert.equal(
    longText,
    '[… 395 characters of earlier output left out; at most the last 50 are kept]\nline number 27\nline number 28\nline number 29\n',
  )
  assert.equal(short.text(), 'one\ntwo\n')
})

// Value: protects=the memory of the pre-gate runner for a line that never ends: the part of a line that passes the limit is written at once and never held, and a part is written as it is (a piece that looks like a summary line is not marked as the run's own); the lines that end are still marked; fails_when=the forwarder holds a line until its end, so a test that prints without a line break grows the runner's memory without end, or marks a piece of a long line as a summary; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial: `pending` grew without a bound); seam=createRunLineForwarder alone with a limit of 10 characters; no_claim=the limit of the runner (TEST_LINE_FLUSH_CHARS), a constant
test('the line forwarder writes a line that passes its limit in pieces without marking a piece as a summary, and marks the summary lines that end', () => {
  // Arrange
  const written = []
  const forwarder = createRunLineForwarder((text) => written.push(text), 10)

  // Act
  forwarder.push('ℹ tests 1\nabcdefghijkl')
  forwarder.push('mnop\nℹ tests 2')
  forwarder.push('\nℹ pass 3')
  forwarder.end()

  // Assert
  assert.deepEqual(written, [
    'ℹ run tests 1\n',
    'abcdefghijkl',
    'mnop\n',
    'ℹ run tests 2\n',
    'ℹ run pass 3\n',
  ])
})

// Value: protects=the pre-gate runner from a signal handler that outlives its build: once the build has ended (by its own exit, by its limit, or because it could not start) the runner holds no SIGINT or SIGTERM handler for it, so a later Ctrl-C does not send SIGKILL to the process group of a process id the system may have given to another program; fails_when=the handlers are not removed when the build closes or fails to start, or a build that cannot start is not answered with its error; why_new=the tests of the build limit run the runner as a process and see its exit, never the handlers it leaves in a runner that goes on; seam=none; no_claim=the Windows path and a signal that arrives during the build (the tests beside it); a program name that does not exist stands in for a build that cannot start
test('a build that has ended, been ended for its limit or could not start leaves no SIGINT or SIGTERM handler of the runner behind', async () => {
  // Arrange
  const handlersBefore = [
    process.listenerCount('SIGINT'),
    process.listenerCount('SIGTERM'),
  ]
  const build = (options) =>
    runBuildWithLimit({
      command: process.execPath,
      cwd: tmpdir(),
      timeoutMs: 10_000,
      ...options,
    })

  // Act
  const finished = await build({ args: ['-e', 'process.exit(3)'] })
  const limited = await build({
    args: ['-e', 'setInterval(() => {}, 1_000)'],
    timeoutMs: 300,
  })
  const unstarted = await build({
    command: join(tmpdir(), 'codebook-no-such-build-program'),
    args: [],
  })

  // Assert
  assert.deepEqual(
    {
      finished,
      limited: { status: limited.status, timedOut: limited.timedOut },
      unstarted: {
        status: unstarted.status,
        timedOut: unstarted.timedOut,
        errorCode: unstarted.error?.code,
      },
      handlersAfter: [
        process.listenerCount('SIGINT'),
        process.listenerCount('SIGTERM'),
      ],
    },
    {
      finished: { status: 3, timedOut: false, error: undefined },
      limited: { status: null, timedOut: true },
      unstarted: { status: null, timedOut: false, errorCode: 'ENOENT' },
      handlersAfter: handlersBefore,
    },
  )
})

// Value: protects=the memory of the output keeper for a line that never ends: a line longer than the bound has no line start to cut at, so it is cut where it stands and only its last characters stay, with a note of how many were left out; a cut that falls just after a line break leaves that line whole; fails_when=the keeper holds an unbroken line whole, drops it with its note, or moves a cut that already sits at a line start; why_new=the keeper's test above feeds lines and the 100 MB test below asserts the count of the summary, neither pins what an unbroken line leaves; seam=none; no_claim=the bound in memory (the 100 MB test below); characters stand for UTF-16 units, as the keeper counts them
test('the output keeper cuts a line longer than its bound where it stands, and leaves a line whole when the cut falls just after a line break', () => {
  // Arrange
  const unbroken = createBoundedOutput(10)
  const atLineStart = createBoundedOutput(10)

  // Act
  for (const chunk of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'])
    unbroken.append(chunk)
  // The first 6 characters are cut, and the cut falls right after the line break.
  atLineStart.append('abcde\nab\ncdefgh')
  atLineStart.append('i')

  // Assert
  assert.deepEqual(
    { unbroken: unbroken.text(), atLineStart: atLineStart.text() },
    {
      unbroken:
        '[… 22 characters of earlier output left out; at most the last 10 are kept]\nccdddddddd',
      atLineStart:
        '[… 6 characters of earlier output left out; at most the last 10 are kept]\nab\ncdefghi',
    },
  )
})

/** One whole summary block as Node 24 prints it: two tests, one passed, one failed, with the lines `readRunSummary` knows. */
const TWO_TESTS_SUMMARY_BLOCK =
  'ℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 41.5\n'

/** The counts that {@link TWO_TESTS_SUMMARY_BLOCK} holds, as `readRunSummary` answers them. */
const TWO_TESTS_SUMMARY_COUNTS = {
  tests: 2,
  suites: 0,
  pass: 1,
  fail: 1,
  cancelled: 0,
  skipped: 0,
  todo: 0,
  duration_ms: 41.5,
}

/** The report of the failing tests that Node 24 prints after the summary: a heading, then the failure with every line indented. It is longer than 700 characters. @example failureReportOfNode24() */
function failureReportOfNode24() {
  return `\n✖ failing tests:\n\ntest at a.test.mjs:4:1\n✖ bad (0.5ms)\n${'  AssertionError: a long line of the failure report\n'.repeat(20)}`
}

// Value: protects=the count of a call whose failing tests' report is longer than the output bound: Node 24 prints the summary block before the report, so the report pushes the summary out of the kept end, and the shard script counted no test for the call while the pre-gate's combined summary left the run out; fails_when=the keeper keeps only the last characters and the summary is not kept with them; why_new=Cycle 0048 task 153 (Red Team, core, parent's probe: Node 24.21 prints the summary before the report); seam=createBoundedOutput with readRunSummary; no_claim=the bound of the runners (TEST_OUTPUT_KEEP_CHARS), a constant; Node's real output (the test below)
test('the output keeper still reads the counts of a call whose failure report after the summary is longer than the bound', () => {
  // Arrange
  const output = createBoundedOutput(300)

  // Act
  output.append('✔ ok (0.9ms)\n✖ bad (0.5ms)\n')
  output.append(TWO_TESTS_SUMMARY_BLOCK)
  output.append(failureReportOfNode24())

  // Assert
  const text = output.text()
  assert.deepEqual(readRunSummary(text), TWO_TESTS_SUMMARY_COUNTS)
  assert.match(
    text,
    /^\[… \d+ characters of earlier output left out; at most the last 300 are kept\]\n/,
  )
  assert.ok(
    text.endsWith(
      `[… the runner’s own summary, repeated from the output left out:]\n${TWO_TESTS_SUMMARY_BLOCK}`,
    ),
    'the summary block is repeated at the end under a note',
  )
})

// Value: protects=the count of a call against a line a test printed in the summary's form: a block printed by a test before the runner's own summary, and an indented block inside the failure report, count nothing when the report cuts the summary away; fails_when=the keeper repeats the first block or the printed one, or reads an indented line of the report as a summary line; why_new=Cycle 0048 task 153 (the last block is the runner's own, task 135); seam=createBoundedOutput with readRunSummary; no_claim=what Node prints for a real run (the test below)
test('the output keeper repeats the runner’s own last summary block, never a block a test printed or an indented one in the failure report', () => {
  // Arrange
  const output = createBoundedOutput(300)
  const printedByTest = 'ℹ tests 99\nℹ pass 99\nℹ fail 0\n'
  const indentedInReport = '  ℹ tests 77\n  ℹ pass 77\n  ℹ fail 0\n'

  // Act
  output.append(printedByTest)
  output.append(TWO_TESTS_SUMMARY_BLOCK)
  output.append(failureReportOfNode24())
  output.append(indentedInReport)
  output.append(failureReportOfNode24())

  // Assert
  assert.deepEqual(readRunSummary(output.text()), TWO_TESTS_SUMMARY_COUNTS)
})

// Value: protects=the count of a call whose output reaches the keeper in chunks of any size: a summary block, or even one summary line, split across chunks is read whole, and the last line of the output needs no line break; fails_when=the keeper reads each chunk alone, so a line cut between two chunks is no summary line; why_new=Cycle 0048 task 153 (a summary block that arrives split across chunks); seam=createBoundedOutput with readRunSummary; no_claim=the sizes of the chunks a pipe delivers
test('the output keeper reads a summary block that arrives split across chunks, with no line break after its last line', () => {
  // Arrange
  const output = createBoundedOutput(300)
  const wholeOutput = `${TWO_TESTS_SUMMARY_BLOCK.trimEnd()}${failureReportOfNode24()}`
  const lastBlockEnd = 'ℹ tests 3\nℹ pass 3\nℹ fail 0'

  // Act
  for (let start = 0; start < wholeOutput.length; start += 7)
    output.append(wholeOutput.slice(start, start + 7))
  const endsWithBlock = createBoundedOutput(20)
  endsWithBlock.append(
    `${'a line of output\n'.repeat(60)}ℹ tests 3\nℹ pass 3\nℹ f`,
  )
  endsWithBlock.append('ail 0')

  // Assert
  assert.deepEqual(readRunSummary(output.text()), TWO_TESTS_SUMMARY_COUNTS)
  assert.deepEqual(readRunSummary(endsWithBlock.text()), {
    tests: 3,
    pass: 3,
    fail: 0,
  })
  assert.ok(
    endsWithBlock
      .text()
      .endsWith(
        `[… the runner’s own summary, repeated from the output left out:]\n${lastBlockEnd}\n`,
      ),
  )
})

// Value: protects=the count of a runner that died: an output with no complete summary block still counts none, however long, and the keeper adds no block of its own; a line longer than any summary line ends a block and is not held; fails_when=the keeper repeats a lone summary line or an incomplete block as a summary, or a long line between two summary lines does not break the block; why_new=Cycle 0048 task 153 (output that holds no summary); seam=createBoundedOutput with readRunSummary; no_claim=the note of the left out characters (the keeper tests above)
test('the output keeper counts no test for an output with no complete summary block, even when a long line breaks a block in two', () => {
  // Arrange
  const died = createBoundedOutput(300)
  const brokenByLongLine = createBoundedOutput(300)

  // Act
  died.append('ℹ tests 99\nℹ pass 99\n')
  died.append('a line of output that goes on\n'.repeat(60))
  brokenByLongLine.append('ℹ tests 5\nℹ pass 5\n')
  for (let part = 0; part < 10; part += 1)
    brokenByLongLine.append('x'.repeat(100))
  brokenByLongLine.append('\nℹ fail 0\n')

  // Assert
  assert.equal(readRunSummary(died.text()), undefined)
  assert.equal(died.text().includes('repeated from the output left out'), false)
  assert.equal(readRunSummary(brokenByLongLine.text()), undefined)
})

// Value: protects=the count of a real `node --test` call whose failure report is longer than the bound, as Node 24 prints it (the summary before the report, the report's lines indented, a block a test printed before the summary); fails_when=Node's order or form of the output differs from what the keeper assumes, or the keeper does not keep the real call's counts; why_new=Cycle 0048 task 153 (the parent's probe on Node 24.21 and the check of task 135 on that version); seam=a real `node --test` run of a fixture file through createBoundedOutput; no_claim=other Node versions than the one that runs the tests
test('the output keeper keeps the counts of a real node --test call whose failure report is longer than its bound', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bounded-output-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const fixture = join(folder, 'long-failure.test.mjs')
  await writeFile(
    fixture,
    [
      "import { test } from 'node:test'",
      "test('prints a summary-shaped block', () => { console.log('ℹ tests 99\\nℹ pass 99\\nℹ fail 0') })",
      "test('fails with a long report', () => { throw new Error(('ℹ tests 77\\nℹ pass 77\\nℹ fail 0\\n' + 'a long line of the failure message\\n').repeat(60)) })",
      '',
    ].join('\n'),
  )
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NO_COLOR',
    ),
  )

  // Act
  const run = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=spec', fixture],
    { encoding: 'utf8', timeout: 60_000, env: environment },
  )
  const output = createBoundedOutput(500)
  for (let start = 0; start < run.stdout.length; start += 4096)
    output.append(run.stdout.slice(start, start + 4096))

  // Assert
  const pickCounts = ({ tests, pass, fail } = {}) => ({ tests, pass, fail })
  const failureReportLines = run.stdout
    .slice(run.stdout.indexOf('✖ failing tests:'))
    .split('\n')
  assert.deepEqual(
    {
      summaryComesBeforeReport:
        run.stdout.indexOf('ℹ duration_ms') <
        run.stdout.indexOf('✖ failing tests:'),
      reportHasSummaryShapedLinesAtColumnZero: failureReportLines.some((line) =>
        /^ℹ (tests|pass|fail) \d+$/.test(line),
      ),
      reportIsLongerThanBound: run.stdout.length > 2 * 500,
      counts: pickCounts(readRunSummary(output.text())),
    },
    {
      summaryComesBeforeReport: true,
      reportHasSummaryShapedLinesAtColumnZero: false,
      reportIsLongerThanBound: true,
      counts: { tests: 2, pass: 1, fail: 1 },
    },
  )
})

// Value: protects=the pre-gate runner's memory: a product test that prints about 100 MB, as lines and then as one line with no break, is run by a runner that may use 64 MB of heap, and the combined summary still counts the test; fails_when=the runner keeps every byte of a run's output (`output += chunk`) or holds a line without a break until it ends, so its heap passes the limit and it aborts; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial: the runner kept every byte, and a test that kept printing kept the silence watch alive); seam=run-pregate-tests.mjs started as a process with `--max-old-space-size=64` (the flag of the runner only, not of the `node --test` it starts) in a fixture repository with a stand-in build; no_claim=the memory of the `node --test` process the runner starts, and a consumer of the runner's output that reads more slowly than the test writes
test('the pre-gate runner survives a test that prints about 100 MB, as lines and as one line, within 64 MB of heap, and still counts it', async (context) => {
  // Arrange
  const printingProduct = [
    "import { test } from 'node:test'",
    "test('prints a lot', () => {",
    "  const lines = 'a line of output of the product test\\n'.repeat(30_000)",
    '  for (let part = 0; part < 50; part += 1) process.stdout.write(lines)',
    "  for (let part = 0; part < 50; part += 1) process.stdout.write('x'.repeat(1_048_576))",
    "  process.stdout.write('\\n')",
    '})',
    '',
  ].join('\n')
  const root = await createFixtureRepository(context, {
    'product.test.js': printingProduct,
  })
  const outputPath = join(root, 'runner-output.txt')
  const outputFile = await open(outputPath, 'w')
  context.after(() => outputFile.close())

  // Act
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=64',
      join(root, 'extension/scripts/run-pregate-tests.mjs'),
      'extension/src/tests/product.test.ts',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', outputFile.fd, 'pipe'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NO_COLOR',
          ),
        ),
        ORDER_LOG: join(root, 'order.log'),
      },
    },
  )

  // Assert
  const written = await readFile(outputPath, 'utf8')
  assert.deepEqual(
    {
      stderr: result.stderr,
      code: result.status,
      counted: written
        .split('\n')
        .filter((line) => /^ℹ (tests|pass|fail) \d+$/.test(line)),
    },
    {
      stderr: '',
      code: 0,
      counted: ['ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'],
    },
  )
})

/** The source of a stand-in `build-fast.mjs` that starts a process of its own (which the build's tree holds), notes its id in the file `GRANDCHILD_PID_FILE` names, and then never ends. @example await writeFile(path, buildThatStartsAProcess()) */
function buildThatStartsAProcess() {
  return [
    "import { spawn } from 'node:child_process'",
    "import { writeFileSync } from 'node:fs'",
    "const started = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })",
    'writeFileSync(process.env.GRANDCHILD_PID_FILE, String(started.pid))',
    'setInterval(() => {}, 1_000)',
    '',
  ].join('\n')
}

// Value: protects=the pre-gate from a build that leaves a process behind: the build is ended at its limit together with everything it started, so no process of the build holds the checkout or the CPU after the lane has failed; fails_when=only the build's own process is killed (`spawnSync`'s `killSignal` ends one process), so the process it started runs on; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial: the build's SIGKILL ended build-fast.mjs and not what it started); seam=run-pregate-tests.mjs started as a process in a fixture repository whose stand-in build starts a second process and never ends; no_claim=Windows (the Windows path is the next test), and what the real build starts (it starts nothing today)
test(
  'the pre-gate runner ends a build that never ends together with the process the build started',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureRepository(context, {})
    await writeFile(
      join(root, 'extension/scripts/build-fast.mjs'),
      buildThatStartsAProcess(),
    )
    const pidFile = join(root, 'grandchild.pid')

    // Act
    const result = await runPregateRunner(
      root,
      ['--build-seconds', '2', 'extension/src/tests/product.test.ts'],
      { GRANDCHILD_PID_FILE: pidFile },
    )
    const startedPid = Number(await readFile(pidFile, 'utf8'))
    context.after(() => {
      try {
        process.kill(startedPid, 'SIGKILL')
      } catch {
        // It is gone already, which is what the test wants.
      }
    })
    const gone = await waitUntilGone(startedPid, 5_000)

    // Assert
    assert.deepEqual(
      { code: result.code, startedProcessGone: gone },
      { code: 1, startedProcessGone: true },
    )
  },
)

// Value: protects=the pre-gate from a runner that is ended while its build runs (Ctrl-C, a time limit of the caller): the build has its own process group, so the signal does not reach it, and the runner ends the build's tree before it exits; fails_when=the runner exits at SIGTERM and leaves the build and the process it started running; why_new=Cycle 0048 task 134 (a build in its own process group needs this, or Ctrl-C leaves it); seam=run-pregate-tests.mjs started as a process in a fixture repository whose stand-in build starts a second process and never ends, then sent SIGTERM; no_claim=SIGINT (the same handler) and Windows
test(
  'the pre-gate runner that gets SIGTERM during the build ends the build and the process it started',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureRepository(context, {})
    await writeFile(
      join(root, 'extension/scripts/build-fast.mjs'),
      buildThatStartsAProcess(),
    )
    const pidFile = join(root, 'grandchild.pid')
    const runner = spawn(
      process.execPath,
      [
        join(root, 'extension/scripts/run-pregate-tests.mjs'),
        'extension/src/tests/product.test.ts',
      ],
      {
        cwd: root,
        stdio: 'ignore',
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => name !== 'NODE_TEST_CONTEXT',
            ),
          ),
          ORDER_LOG: join(root, 'order.log'),
          GRANDCHILD_PID_FILE: pidFile,
        },
      },
    )
    const runnerEnded = new Promise((resolve) => runner.on('close', resolve))
    // The build writes the id of the process it started once it runs.
    const startedPid = await waitForProcessId(pidFile, 10_000)
    context.after(() => {
      runner.kill('SIGKILL')
      try {
        process.kill(startedPid, 'SIGKILL')
      } catch {
        // It is gone already, which is what the test wants.
      }
    })

    // Act
    runner.kill('SIGTERM')
    await runnerEnded
    const gone = await waitUntilGone(startedPid, 5_000)

    // Assert
    assert.deepEqual(
      { startedPidSeen: startedPid !== undefined, startedProcessGone: gone },
      { startedPidSeen: true, startedProcessGone: true },
    )
  },
)

// Value: protects=the Windows lane from a build that leaves its tree: at the limit the build is ended through the system's taskkill.exe with `/T /F`, as a silent call is; fails_when=the build is ended with a kill of its own process only, or by the bare name `taskkill`; why_new=Cycle 0048 task 134 (on Windows a build's tree needs taskkill as a call's does); seam=runBuildWithLimit in the test process with `platform` set to win32 and `SystemRoot` set to a folder with a stand-in System32/taskkill.exe that ends the build's process; no_claim=the real taskkill.exe and a Windows process tree (no Windows process is started)
test(
  'on Windows a build that never ends is ended through taskkill with its whole tree',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const systemRoot = await mkdtemp(join(tmpdir(), 'codebook-stand-in-root-'))
    context.after(() => rm(systemRoot, { recursive: true, force: true }))
    await mkdir(join(systemRoot, 'System32'))
    await writeFile(
      join(systemRoot, 'System32', 'taskkill.exe'),
      [
        `#!${process.execPath}`,
        "const { appendFileSync } = require('node:fs')",
        "const { join } = require('node:path')",
        "appendFileSync(join(__dirname, '..', 'taskkill.log'), process.argv.slice(2).join(' ') + '\\n')",
        "process.kill(Number(process.argv[3]), 'SIGKILL')",
      ].join('\n'),
      { mode: 0o755 },
    )

    // Act
    const result = await runBuildWithLimit({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1_000)'],
      cwd: systemRoot,
      timeoutMs: 1_000,
      platform: 'win32',
      environment: { SystemRoot: systemRoot },
    })

    // Assert
    const log = await readFile(join(systemRoot, 'taskkill.log'), 'utf8').catch(
      () => '',
    )
    assert.deepEqual(
      {
        timedOut: result.timedOut,
        taskkill: log.trim().replace(/\d+/, '<pid>'),
      },
      { timedOut: true, taskkill: '/pid <pid> /T /F' },
    )
  },
)
