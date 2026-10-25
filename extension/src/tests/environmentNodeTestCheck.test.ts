import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { z } from 'zod'

import type * as EnvironmentModule from '../environment'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { loadModule } from './utils/loadModule'

const SOURCE_TEXT = 'export const nextRun = schedule(job, 5_000)\n'
const TEST_TEXT = 'test("runs a delayed job after its timer", () => {})\n'

/**
 * Builds a repository that holds a scheduler's source and test and the root Vitest 5 package, with or without its program file, and the study environment over it with the editor's open documents as given.
 * @param context - Removes the repository when the test ends.
 * @param options - `withProgram` writes `node_modules/vitest/vitest.mjs`; `openDocuments` are the editor's open documents.
 * @returns The environment, a configuration citing the files by their current hashes, the repository's real root, and the article's source text.
 */
async function environmentWithRepository(
  context: TestContext,
  options: {
    withProgram: boolean
    openDocuments: (
      root: string,
    ) => { scheme: string; fsPath: string; text: string }[]
  },
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-environment-node-test-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(
    join(root, 'product.json'),
    JSON.stringify({ version: '1.140.0', commit: 'fixture' }),
  )
  await mkdir(join(root, 'dist'))
  await writeFile(
    join(root, 'dist/build.json'),
    JSON.stringify({
      revision: 'fixture',
      dirty: false,
      sourceHash: 'fixture',
    }),
  )
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'scheduler.ts'), SOURCE_TEXT)
  await writeFile(join(root, 'src', 'scheduler.test.ts'), TEST_TEXT)
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version: '5.0.2' }),
  )
  if (options.withProgram)
    await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), '')
  const chromeExecutable = join(root, 'chrome')
  await writeFile(chromeExecutable, '#!/bin/sh\n', { mode: 0o755 })
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }],
          textDocuments: options.openDocuments(root).map((document) => ({
            uri: { scheme: document.scheme, fsPath: document.fsPath },
            getText: () => document.text,
          })),
          getConfiguration: () => ({
            get: (key: string, fallback: string) =>
              key === 'chromeExecutable' ? chromeExecutable : fallback,
          }),
        },
        env: { appRoot: root, appName: 'Visual Studio Code', remoteName: '' },
        version: '1.140.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: () => disposable,
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const environment = await boundary.createEnvironment({ extensionPath: root })
  context.after(() => environment.dispose())
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
    environment,
    configuration,
    workspace: root,
    citedSources: [
      {
        path: 'src/scheduler.ts',
        hash: sha256(SOURCE_TEXT),
        text: SOURCE_TEXT,
        lineCount: 1,
      },
    ],
  }
}

/** A start that is neither cancelled nor near its preparation deadline; no root claim lists anything in these repositories, which hold no config. */
const CONTROL = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 600_000,
  now: Date.now,
}

/** Reads the code and message of the typed refusal the check threw; the module runs in its own context, so the error is parsed rather than compared by class. */
function refusalOf(thrown: unknown): { code: string; message: string } {
  return z.object({ code: z.string(), message: z.string() }).parse(thrown)
}

// Value: protects=a test start refused by a cited source open in the editor with other text before the run's history begins; fails_when=the dirty-editor refusal runs only inside the owned run, after the history began, so a refusal leaves a zero-entry history in Saved studies; why_new=assertConfiguredSourceDocuments ran after the history began (F57); seam=the editor's documents and settings are fakes, the repository files are real; no_claim=the owned run's own recheck at its launch
test('the preparation check of a test start refuses a cited source that the editor holds with other text', async (context) => {
  // Arrange
  const run = await environmentWithRepository(context, {
    withProgram: true,
    openDocuments: (root) => [
      {
        scheme: 'file',
        fsPath: join(root, 'src', 'scheduler.ts'),
        text: `${SOURCE_TEXT}// unsaved edit\n`,
      },
    ],
  })

  // Act
  const refusal = await run.environment
    .checkNodeTestFiles?.(run.configuration, run.citedSources, CONTROL)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(refusalOf(refusal).code, 'SOURCE_CHANGED')
  assert.match(
    refusalOf(refusal).message,
    /The cited source src\/scheduler\.ts is open in the editor with text that differs/,
  )
})

// Value: protects=a test start refused for a repository whose root Vitest has no program file before the run's history begins; fails_when=the program check runs only at the launch, after the history began, so the refusal leaves a zero-entry history in Saved studies, or its sentence does not name the program, the test and the fix; why_new=the Vitest program check ran after the history began (F57); Cycle 0053 words it per test, naming the folder Node resolves Vitest from (task 5); seam=the editor and its settings are fakes, the repository files are real; no_claim=the Vitest version sentence (status reports it)
test('the preparation check of a test start refuses a root Vitest that has no program file', async (context) => {
  // Arrange
  const run = await environmentWithRepository(context, {
    withProgram: false,
    openDocuments: () => [],
  })

  // Act
  const refusal = await run.environment
    .checkNodeTestFiles?.(run.configuration, run.citedSources, CONTROL)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(refusalOf(refusal).code, 'PREREQUISITE_MISSING')
  assert.equal(
    refusalOf(refusal).message,
    'node-test needs the Vitest program ./node_modules/vitest/vitest.mjs for src/scheduler.test.ts; reinstall Vitest there, then start the test again.',
  )
})

// Value: protects=the preparation check passing for a repository whose files, editor documents and root Vitest are all in order; fails_when=a check added to the preparation refuses a valid start; why_new=the preparation check gained two refusals (F57); seam=as the refusal tests; no_claim=Vitest's selection of the test
test('the preparation check of a test start passes when the editor agrees and the root Vitest has its program', async (context) => {
  // Arrange
  const run = await environmentWithRepository(context, {
    withProgram: true,
    openDocuments: (root) => [
      {
        scheme: 'file',
        fsPath: join(root, 'src', 'scheduler.ts'),
        text: SOURCE_TEXT,
      },
    ],
  })

  // Act / Assert
  const check = run.environment.checkNodeTestFiles
  assert.equal(typeof check, 'function', 'the environment checks test starts')
  await assert.doesNotReject(
    run.environment.checkNodeTestFiles!(
      run.configuration,
      run.citedSources,
      CONTROL,
    ),
  )
})

// Value: protects=a start refused for an unreadable Vitest version, then for a Vitest that links outside the repository, starting once the learner repaired each, with nothing kept from the refusal; fails_when=a repaired repository stays refused, or a refusal's sentence does not name the test, the folder and the fix; why_new=DX review (H9): refusals come before the history, so starting again is safe; seam=the editor and its settings are fakes, the repository's node_modules is real; no_claim=the run resource's channel (nodeTestVitestRootService tests)
test('a start refused for an unreadable or outside Vitest is planned once the learner repaired it', async (context) => {
  // Arrange
  const run = await environmentWithRepository(context, {
    withProgram: true,
    openDocuments: () => [],
  })
  const root = run.workspace
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-environment-outside-vitest-')),
  )
  context.after(() => rm(outside, { recursive: true, force: true }))
  const packageFile = join(root, 'node_modules', 'vitest', 'package.json')
  const check = () =>
    run.environment.checkNodeTestFiles!(
      run.configuration,
      run.citedSources,
      CONTROL,
    ).then(
      (plan) => plan.summary.vitestRoot,
      (error: unknown) => refusalOf(error).message,
    )

  // Act
  await writeFile(packageFile, 'not json {')
  const unreadable = await check()
  await writeFile(
    packageFile,
    JSON.stringify({ name: 'vitest', version: '5.0.2' }),
  )
  const repairedVersion = await check()
  await rename(join(root, 'node_modules', 'vitest'), join(outside, 'vitest'))
  await symlink(
    join(outside, 'vitest'),
    join(root, 'node_modules', 'vitest'),
    'dir',
  )
  const linkedOutside = await check()
  await rm(join(root, 'node_modules', 'vitest'))
  await rename(join(outside, 'vitest'), join(root, 'node_modules', 'vitest'))
  const repairedLink = await check()

  // Assert
  assert.deepEqual(
    [unreadable, repairedVersion, linkedOutside, repairedLink],
    [
      'node-test cannot read the version of ./node_modules/vitest for src/scheduler.test.ts: its package.json is missing, unreadable or not a Vitest package file. Ask the learner to reinstall the dependencies, then start the test again.',
      '.',
      'node-test needs Vitest 4 or later inside the repository for src/scheduler.test.ts; ./node_modules/vitest links outside it (for example to a package store outside the repository), which Codebook does not run. Ask the learner to install the dependencies so that Vitest lies inside the repository, then start the test again.',
      '.',
    ],
  )
})
