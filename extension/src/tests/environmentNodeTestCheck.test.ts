import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
 * @returns The environment, a configuration citing the files by their current hashes, and the article's source text.
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
    .checkNodeTestFiles?.(run.configuration, run.citedSources)
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

// Value: protects=a test start refused for a repository whose root Vitest has no program file before the run's history begins; fails_when=the program check runs only at the launch, after the history began, so the refusal leaves a zero-entry history in Saved studies; why_new=the Vitest program check ran after the history began (F57); seam=the editor and its settings are fakes, the repository files are real; no_claim=the Vitest version sentence (status reports it)
test('the preparation check of a test start refuses a root Vitest that has no program file', async (context) => {
  // Arrange
  const run = await environmentWithRepository(context, {
    withProgram: false,
    openDocuments: () => [],
  })

  // Act
  const refusal = await run.environment
    .checkNodeTestFiles?.(run.configuration, run.citedSources)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(refusalOf(refusal).code, 'PREREQUISITE_MISSING')
  assert.match(
    refusalOf(refusal).message,
    /node_modules\/vitest\/vitest\.mjs inside the opened repository/,
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
    run.environment.checkNodeTestFiles!(run.configuration, run.citedSources),
  )
})
