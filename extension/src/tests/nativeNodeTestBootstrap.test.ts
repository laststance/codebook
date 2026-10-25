import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as NativeNodeTestBootstrapModule from '../nativeNodeTestBootstrap'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type {
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from '../utils/listVitestTestFiles'

import { loadModule } from './utils/loadModule'

// Value: protects=a native trial whose root listing could not be released releasing it before the trial ends, as a run's stop releases it, and still failing with the plan's refusal; fails_when=the trial drops the listing's retry, so a listing process may outlive the trial with nobody to end it; why_new=Cycle 0053 /ship review pass 4 (the native bootstrap was the only owner without the retry); seam=the editor, the file checks, the plan and the root listing are stand-ins, the trial's own code and its report are real; no_claim=the real release (listVitestTestFiles tests)
test('a native trial releases a root listing that was not released before it ends with the refusal', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-native-trial-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: { bookId: 'scheduler', revision: 1, nodeId: 'delay', anchorIndex: 0 },
    testFile: 'packages/a/src/scheduler.test.ts',
    testTitles: ['scheduler', 'runs a delayed job'],
    testHash: 'a'.repeat(64),
    source: {
      path: 'packages/a/src/scheduler.ts',
      hash: 'b'.repeat(64),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'job', mode: 'value', required: true }],
  }
  const configPath = join(folder, 'config.json')
  const reportPath = join(folder, 'report.json')
  await writeFile(configPath, JSON.stringify(configuration))
  const environment = {
    CODEBOOK_NODE_TEST_CONFIG_PATH: process.env.CODEBOOK_NODE_TEST_CONFIG_PATH,
    CODEBOOK_NODE_TEST_REPORT_PATH: process.env.CODEBOOK_NODE_TEST_REPORT_PATH,
  }
  process.env.CODEBOOK_NODE_TEST_CONFIG_PATH = configPath
  process.env.CODEBOOK_NODE_TEST_REPORT_PATH = reportPath
  context.after(() => {
    for (const [name, value] of Object.entries(environment))
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })
  let releases = 0
  const refusal = new Error(
    "Vitest's listing from the repository root ended, but Codebook could not confirm that its process group 4242 ended (Error: kill EPERM), so a process of that group may still run.",
  )
  const bootstrap = await loadModule<typeof NativeNodeTestBootstrapModule>(
    resolve(__dirname, '../nativeNodeTestBootstrap.js'),
    {
      vscode: {
        workspace: { workspaceFolders: [{ uri: { fsPath: folder } }] },
        env: { appName: 'Visual Studio Code' },
      },
      './ownedNodeTestRun': {
        OwnedNodeTestRun: class {
          constructor() {
            throw new Error('a refused plan starts no run')
          }
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => process.execPath,
      },
      './utils/checkNodeTestFiles': {
        checkNodeTestFiles: async () => ({
          root: folder,
          testFile: join(folder, configuration.testFile),
        }),
      },
      './utils/listVitestForRootClaim': {
        listVitestForRootClaim: async (
          _request: unknown,
          run: {
            onReleaseFailed?: (
              failure: VitestListingReleaseFailure,
              retryRelease: RetryVitestListingRelease,
            ) => void
          },
        ) => {
          run.onReleaseFailed?.(
            {
              processGroup: 4242,
              directory: '/tmp/codebook-vitest-list-x',
              reason: 'Error: kill EPERM',
            },
            async () => {
              releases++
            },
          )
          return { outcome: 'unconfirmed', error: refusal }
        },
      },
      './utils/planNodeTestExecution': {
        planNodeTestExecution: async (input: {
          listRootClaim: (request: unknown) => Promise<{ error?: unknown }>
        }) => {
          const listing = await input.listRootClaim({})
          throw listing.error
        },
      },
    },
  )

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(outcome, refusal)
  assert.equal(releases, 1)
})
