import assert from 'node:assert/strict'
import {
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

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { detectLibraryPackage } from '../utils/libraryBuildStop'
import { resolveVitePackage } from '../utils/resolveVitePackage'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { NESTED_VITE_LIBRARY_SOURCE_PATH } from './utils/nestedViteWorkspace'

/** Writes a file, creating its folders. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Stages app -> react-lib -> core (a chain of workspace links) and an unlinked `other`, with a nested Vite app. */
async function stageChain(context: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vite-chain-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  await put(
    join(root, 'examples/app/package.json'),
    JSON.stringify({ name: 'app', devDependencies: { vite: '^8.3.5' } }),
  )
  await put(join(root, 'examples/app/index.html'), '<html></html>')
  for (const [folder, name] of [
    ['packages/react-lib', '@s/react-lib'],
    ['packages/core', '@s/core'],
    ['packages/other', '@s/other'],
  ] as const) {
    await put(join(root, folder, 'package.json'), JSON.stringify({ name }))
    await put(join(root, folder, 'src/x.ts'), 'export const x = 1\n')
  }
  await mkdir(join(root, 'examples/app/node_modules/@s'), { recursive: true })
  await symlink(
    join(root, 'packages/react-lib'),
    join(root, 'examples/app/node_modules/@s/react-lib'),
  )
  await mkdir(join(root, 'packages/react-lib/node_modules/@s'), {
    recursive: true,
  })
  await symlink(
    join(root, 'packages/core'),
    join(root, 'packages/react-lib/node_modules/@s/core'),
  )
  const app = await resolveVitePackage(root, 'examples/app')
  return { root, app }
}

// protects=AC 1 and AC 4: a library the Vite app reaches only through another workspace library (app -> react-lib -> core) is detected by the library detection Next shares; fails_when=the chain is not followed for a ResolvedVitePackage or an unlinked library is detected; no_claim=npm-installed libraries (never detected)
test('detects a library reached through another workspace library and not an unlinked one for a Vite app', async (context) => {
  // Arrange
  const { root, app } = await stageChain(context)
  // Act
  const chained = await detectLibraryPackage(
    root,
    app,
    'packages/core/src/x.ts',
  )
  const direct = await detectLibraryPackage(
    root,
    app,
    'packages/react-lib/src/x.ts',
  )
  const unlinked = await detectLibraryPackage(
    root,
    app,
    'packages/other/src/x.ts',
  )
  // Assert
  assert.equal(chained?.name, '@s/core')
  assert.equal(direct?.name, '@s/react-lib')
  assert.equal(unlinked, undefined)
})

// protects=D3 (root run unchanged): a root vite-dev run never looks for a library, so it never walks Vite's graph for one; fails_when=a root run registers a library stop and the launcher is asked to walk; no_claim=the root run's own refusal of a stop outside its root (raised by the seal, covered by viteServedModule tests)
test('a root Vite run with a stop in a linked library asks the launcher for no library walk', async (context) => {
  // Arrange
  const click: RepositoryOperation = {
    kind: 'click',
    title: 'Toggle',
    selector: '#toggle',
  }
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    sourcePath: NESTED_VITE_LIBRARY_SOURCE_PATH,
    viteLibrary: {},
    operations: { operations: [click], stopOperations: [1] },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.viteLibrary?.walks.length, 0)
})
