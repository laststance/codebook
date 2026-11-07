import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ViteFacts } from '../utils/assessViteSettings'
import { isViteLauncherLibraryOptions } from '../utils/isViteLauncherLibraryOptions'
import type { ViteLauncherLibraryOptions } from '../viteLauncherProtocol'

import {
  createViteRepository,
  freePort,
  type StubViteBehavior,
} from './utils/createViteRepository'
import { removeTestFolder } from './utils/removeTestFolder'

/** The compiled launcher beside the compiled tests' parent folder. */
const LAUNCHER = join(__dirname, '..', 'viteLauncher.js')

/** The facts message of the launcher, as far as these tests read it. */
type FactsMessage = {
  facts: ViteFacts
  libraryBlockers?: { aliased: string[]; optimizeInclude: string[] }
}

/** Library options over a real private folder whose packed folder stays empty, as before the build. */
async function libraryOptions(
  context: TestContext,
): Promise<ViteLauncherLibraryOptions> {
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-lib-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', '@acme', 'widgets')
  await mkdir(packedRoot, { recursive: true })
  return {
    packageName: '@acme/widgets',
    packedRoot,
    anchorFile: join(privateFolder, 'codebook-anchor.js'),
    libraryRoot: '/library',
    peers: ['react'],
    privateFolder,
  }
}

/** Forks the compiled launcher over the stub Vite with the given library option, waits for its facts, refuses the listen and returns the message with the package root. */
async function factsOf(
  context: TestContext,
  behavior: StubViteBehavior,
  library: unknown,
): Promise<FactsMessage & { root: string }> {
  const repository = await createViteRepository(context)
  await repository.behave(behavior)
  const launcher = fork(
    LAUNCHER,
    [
      JSON.stringify({
        viteEntry: join(repository.root, 'node_modules/vite/index.mjs'),
        root: repository.root,
        mode: undefined,
        configFile: undefined,
        port: behavior.port,
        library,
      }),
    ],
    { cwd: repository.root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )
  context.after(() => {
    launcher.kill('SIGKILL')
  })
  const message = await new Promise<FactsMessage>((resolve, reject) => {
    launcher.on('message', (received: { type?: string }) => {
      if (received.type === 'vite-facts') {
        launcher.send({ type: 'vite-refuse' })
        resolve(received as FactsMessage)
      }
      if (received.type === 'vite-failed') reject(new Error('launcher failed'))
    })
    launcher.once('exit', () => reject(new Error('launcher exited')))
  })
  return { ...message, root: repository.root }
}

// protects=a library run's server is created with the redirect plugin (enforce pre), the private cache, the package excluded from pre-bundling and fs.allow holding the workspace root and the private folder's real path, while the packed folder is still empty; fails_when=any of the four settings is missing or the Example's own cache is used; no_claim=real Vite behavior (the E1/E2 probes and the native check cover it); the stub Vite only echoes the inline config
test('creates the server with the redirect plugin, a private cache, the optimizer exclusion and file access when the library option is present', async (context) => {
  // Arrange
  const library = await libraryOptions(context)
  const port = await freePort()
  // Act
  const message = await factsOf(context, { port }, library)
  const inline: unknown = JSON.parse(
    await readFile(join(message.root, 'inline-config.json'), 'utf8'),
  )
  // Assert
  assert.deepEqual(inline, {
    pluginNames: ['codebook-library-redirect'],
    pluginEnforce: ['pre'],
    cacheDir: join(library.privateFolder, 'vite-cache'),
    optimizeDeps: { exclude: ['@acme/widgets'] },
    fsAllow: [message.root, library.privateFolder],
  })
  assert.equal(
    message.facts.cacheDir,
    join(library.privateFolder, 'vite-cache'),
  )
})

// protects=the facts message names the alias and optimizeDeps.include blockers read from the same resolved config the server uses; fails_when=blockers are missing, read from another config, or sent for a run without library; no_claim=how the extension refuses on them (the run integration)
test('reports the blockers of the resolved config in the facts message only for a library run', async (context) => {
  // Arrange
  const library = await libraryOptions(context)
  const port = await freePort()
  const config = {
    resolve: { alias: [{ find: '@acme/widgets', replacement: '/x' }] },
    optimizeDeps: { include: ['@acme/widgets/sub'] },
  }
  // Act
  const withLibrary = await factsOf(context, { port, config }, library)
  const withoutLibrary = await factsOf(context, { port, config }, undefined)
  // Assert
  assert.deepEqual(withLibrary.libraryBlockers, {
    aliased: ['@acme/widgets'],
    optimizeInclude: ['@acme/widgets/sub'],
  })
  assert.equal(withoutLibrary.libraryBlockers, undefined)
})

// protects=a run without library creates the server exactly as before (no plugin, no cache, no exclusion, no fs.allow); fails_when=the library settings leak into an ordinary Vite run; no_claim=none beyond protects
test('adds no library setting to the server of a run without library', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const message = await factsOf(context, { port }, undefined)
  const inline: unknown = JSON.parse(
    await readFile(join(message.root, 'inline-config.json'), 'utf8'),
  )
  // Assert
  assert.deepEqual(inline, { pluginNames: [], pluginEnforce: [] })
})

// protects=a malformed library option stops the launcher before any server exists; fails_when=a half-formed option creates a server with a broken plugin; no_claim=the wording of the refusal
test('fails the launch for a malformed library option', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const outcome = await factsOf(context, { port }, { packageName: '' }).then(
    () => 'facts',
    (error: Error) => error.message,
  )
  // Assert
  assert.equal(outcome, 'launcher failed')
})

// protects=only a complete library option is accepted from the command line; fails_when=an empty name, a relative path, a non-string peer or an array imports is accepted; no_claim=none beyond protects
test('accepts a complete library option and rejects a malformed one', () => {
  // Arrange
  const complete = {
    packageName: 'lib',
    packedRoot: '/p/node_modules/lib',
    anchorFile: '/p/codebook-anchor.js',
    libraryRoot: '/r/lib',
    peers: ['react'],
    privateFolder: '/p',
  }
  const malformed = [
    null,
    'lib',
    { ...complete, packageName: '' },
    { ...complete, packedRoot: 'relative/path' },
    { ...complete, anchorFile: undefined },
    { ...complete, peers: ['react', 7] },
    { ...complete, peers: 'react' },
    { ...complete, imports: ['#a'] },
  ]
  // Act
  const results = [
    isViteLauncherLibraryOptions(complete),
    isViteLauncherLibraryOptions({ ...complete, imports: { '#a': 'react' } }),
    ...malformed.map((value) => isViteLauncherLibraryOptions(value)),
  ]
  // Assert
  assert.deepEqual(results, [
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})
