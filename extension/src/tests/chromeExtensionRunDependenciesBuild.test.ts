import assert from 'node:assert/strict'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as RunDependenciesModule from '../chromeExtensionRunDependencies'
import type { ChromeExtensionRunDependencies } from '../ownedChromeExtensionRun'

import { loadModule } from './utils/loadModule'

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/**
 * Loads the product dependencies over a fake editor and a fake extension source, with a real profile folder.
 * @param context - The test context whose end removes the folder.
 * @param prepare - What the fake `prepareExtensionSource` does with the private folder it is given.
 * @returns The dependencies, the profile root and the private folders the source was asked to build in.
 */
async function load(
  context: TestContext,
  prepare: (privateFolder: string) => Promise<unknown>,
) {
  const profileRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-run-deps-')),
  )
  context.after(() => rm(profileRoot, { recursive: true, force: true }))
  const folders: string[] = []
  const module = await loadModule<typeof RunDependenciesModule>(
    resolve(__dirname, '../chromeExtensionRunDependencies.js'),
    {
      vscode: {
        debug: {
          onDidTerminateDebugSession: () => ({ dispose: (): void => {} }),
        },
        workspace: { textDocuments: [] },
      },
      './chromeExtensionActionExecutor': {},
      './resolveChromeExtensionRun': {},
      './runtimeSupport/ownedExtensionBrowser': {},
      './utils/createExtensionSourceCheck': {},
      './utils/currentStorageOwner': {},
      './vscodeChromeExtensionDebugger': {},
      './extensionSource': {
        prepareExtensionSource: async (input: { privateFolder: string }) => {
          folders.push(input.privateFolder)
          return prepare(input.privateFolder)
        },
      },
    },
  )
  const dependencies: ChromeExtensionRunDependencies =
    module.createProductChromeExtensionRunDependencies({
      workspace: '/repo',
      chromeExecutable: '/chrome',
      profileRoot,
    })
  return { dependencies, profileRoot, folders }
}

const REQUEST = {
  repositoryRoot: '/repo',
  configuration: {} as never,
  signal: new AbortController().signal,
  onBuilding: () => undefined,
}

// protects=the build folder is made owner-only beside the test profiles under its own prefix and is removed by dispose; fails_when=the folder is made elsewhere, keeps another prefix or outlives dispose; no_claim=the source's own build (a fake source stands in)
test('the build folder is made beside the profiles and removed by dispose', async (context) => {
  // Arrange
  const { dependencies, profileRoot, folders } = await load(
    context,
    async () => ({ kind: 'source' }),
  )
  // Act
  const prepared = await dependencies.prepareSource?.(REQUEST)
  const folder = folders[0] ?? ''
  const existedBeforeDispose = await exists(folder)
  await prepared?.dispose()
  // Assert
  assert.equal(dirname(folder), profileRoot)
  assert.match(basename(folder), /^codebook-extension-build-/)
  assert.equal(existedBeforeDispose, true)
  assert.equal(await exists(folder), false)
})

// protects=a refused or failed build leaves no folder behind and rethrows its own error; fails_when=the folder survives a refusal or the error is replaced; no_claim=which refusal
test('a build that throws leaves no folder behind', async (context) => {
  // Arrange
  const refusal = new Error('refused')
  const { dependencies, folders } = await load(context, async () => {
    throw refusal
  })
  // Act
  const preparing = async () => dependencies.prepareSource?.(REQUEST)
  // Assert
  await assert.rejects(preparing, (error: unknown) => error === refusal)
  assert.equal(await exists(folders[0] ?? ''), false)
})
