import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import type * as EnvironmentModule from '../environment'

import { loadModule } from './utils/loadModule'

const execFileAsync = promisify(execFile)

// Value: protects=codebook_status folds the shared prerequisites into a listed react-scripts app and keeps its own facts (DX-9): the app reads not ready while Chrome is missing, and the adapter is listed beside the other two; fails_when=packages[] of react-scripts-dev keeps the app-only ready, or the adapter is absent from the profile; no_claim=a managed run in the way (the same check() joins its sentences)
test('a listed react-scripts app reads not ready with the shared Chrome gap', async (context) => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-react-scripts-status-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '1.140.0', commit: 'fixture' }),
  )
  await mkdir(join(directory, 'dist'))
  await writeFile(
    join(directory, 'dist/build.json'),
    JSON.stringify({
      revision: 'fixture',
      dirty: false,
      sourceHash: 'fixture',
    }),
  )
  await mkdir(join(directory, 'apps/web/node_modules/react-scripts'), {
    recursive: true,
  })
  await writeFile(
    join(directory, 'apps/web/package.json'),
    JSON.stringify({
      name: 'web',
      dependencies: { 'react-scripts': '5.0.1' },
      scripts: { start: 'react-scripts start' },
    }),
  )
  await writeFile(
    join(directory, 'apps/web/node_modules/react-scripts/package.json'),
    JSON.stringify({ name: 'react-scripts', version: '5.0.1' }),
  )
  await execFileAsync('git', ['init', '--quiet', directory])
  await execFileAsync('git', ['add', '--', 'apps/web/package.json'], {
    cwd: directory,
  })
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
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (key: string, fallback: string) =>
              key === 'chromeExecutable'
                ? join(directory, 'no-such-chrome')
                : fallback,
          }),
        },
        env: {
          appRoot: directory,
          appName: 'Visual Studio Code',
          remoteName: '',
        },
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
  const environment = await boundary.createEnvironment({
    extensionPath: directory,
  })
  context.after(() => environment.dispose())
  // Act
  const prerequisites = await environment.prerequisites({
    discoverPackages: true,
  })
  // Assert
  const adapter =
    prerequisites.profiles?.['repository-browser']?.adapters?.[
      'react-scripts-dev'
    ]
  const entry = adapter?.packages?.[0]
  assert.equal(entry?.packageRoot, 'apps/web')
  assert.equal(entry?.installed, true)
  assert.equal(entry?.version, '5.0.1')
  assert.equal(entry?.ready, false)
  assert.match(entry?.missing.join(' ') ?? '', /Chrome/i)
  assert.equal(adapter?.ready, false)
})
