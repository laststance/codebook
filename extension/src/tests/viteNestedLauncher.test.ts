import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { assessViteWorkspace } from '../utils/assessViteWorkspace'
import { launchViteDevelopmentServer } from '../utils/launchViteDevelopmentServer'
import { resolveVitePackage } from '../utils/resolveVitePackage'

import {
  createViteRepository,
  freePort,
  type StubViteBehavior,
} from './utils/createViteRepository'

/** The compiled launcher beside the compiled tests' parent folder. */
const LAUNCHER = join(__dirname, '..', 'viteLauncher.js')

/** The folder of the nested app below the repository, shaped like P02's `examples/react/basic`. */
const APP = 'examples/react/basic'

/** Writes a file below a folder, creating its parents. */
async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/**
 * Stages a repository whose Vite is hoisted to its root (the stub package) and an app below it with its own `dev` script, `.env` and stub behavior, then starts the launcher from the app folder as the Vite adapter does for a nested run.
 * @param context - The test, which removes the repository and closes the server.
 * @param options - The app's `dev` script, stub behavior and extra files (app-relative).
 * @returns The folders, the started server and the pieces a test reads.
 */
async function startNestedVite(
  context: TestContext,
  options: {
    dev: string
    behavior: StubViteBehavior
    files?: Record<string, string>
  },
) {
  const repository = await createViteRepository(context)
  const appFolder = join(repository.root, APP)
  await put(
    appFolder,
    'package.json',
    JSON.stringify({
      name: 'nested',
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: options.dev },
    }),
  )
  await put(appFolder, 'stub-vite.json', JSON.stringify(options.behavior))
  for (const [name, text] of Object.entries(options.files ?? {}))
    await put(appFolder, name, text)
  const controller = new AbortController()
  const declared: { port: number; source: string }[] = []
  let app: DevelopmentApp | undefined
  const request: DevelopmentServerStart = {
    workspace: appFolder,
    vitePackage: await resolveVitePackage(repository.root, APP),
    node: process.execPath,
    record: () => undefined,
    inspectServer: false,
    signal: controller.signal,
    alive: () => controller.signal.throwIfAborted(),
    assertPortFree: async () => undefined,
    onDeclaredPort: (value) => declared.push(value),
    onApp: (value) => {
      app = value
    },
    onStep: () => undefined,
  }
  context.after(async () => {
    await app?.close()
  })
  const workspaceInfo = await assessViteWorkspace(
    appFolder,
    process.execPath,
    controller.signal,
    repository.root,
  )
  const started = await launchViteDevelopmentServer(
    request,
    workspaceInfo,
    LAUNCHER,
  )
  return { repository, appFolder, declared, started, app: () => app! }
}

// protects=AC 1 and Task 4 (Cycle 0077): Codebook starts the hoisted Vite from the app folder as its working folder and root, on the port of the app's own dev script, never running the script; fails_when=the launcher runs in the repository root, the script's --port is ignored, or the hoisted Vite is not found for the nested app; no_claim=real Vite 8 (a stub Vite package records what the launcher gave it)
test("a nested app starts from its folder on the port of its own dev script with the repository's hoisted Vite", async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startNestedVite(context, {
    dev: `vite --port ${port}`,
    behavior: { port: await freePort(), logCwd: true },
  })
  const response = await fetch(`http://127.0.0.1:${run.started.port}/`)
  // Assert
  assert.equal(run.started.port, port)
  assert.equal(response.status, 200)
  assert.deepEqual(run.declared, [{ port, source: 'the dev script --port' }])
  // A literal substring: the folder is a runtime path that may hold regex or backslash characters
  assert.ok(run.app().outputTail().includes(`CWD ${run.appFolder}`))
})

// protects=Task 4 env masking: a value in the app folder's .env is masked in the server output the run keeps, and the repository root's own .env value is not treated as the app's; fails_when=the app folder's env file is not read (the secret shows) or the output is not masked; no_claim=the saved study (the same mask feeds the existing saved-study masking tests)
test('a value in the app folders .env is masked in the output of the nested server', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startNestedVite(context, {
    dev: 'vite',
    behavior: { port, logLines: ['connecting with appenvsecret1 now'] },
    files: { '.env': 'API_TOKEN=appenvsecret1\n' },
  })
  // Assert
  const output = run.app().outputTail()
  assert.equal(output.includes('appenvsecret1'), false)
  assert.match(output, /connecting with \[masked\] now/)
})

// protects=decision D8: a timestamp file another app wrote into the shared hoisted node_modules/.vite-temp during the run survives the run's end when the app has no node_modules of its own; fails_when=cleanup deletes every new matching file of the nearest node_modules, so another app's temp file is lost; no_claim=Vite's own removal of its temp file after loading a config
test('a timestamp file another app writes into the shared hoisted .vite-temp survives the run', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startNestedVite(context, {
    dev: 'vite',
    behavior: { port },
  })
  const name = 'vite.config.ts.timestamp-123-abc.mjs'
  const sharedOther = join(run.repository.root, 'node_modules/.vite-temp', name)
  await put(run.repository.root, `node_modules/.vite-temp/${name}`, 'x')
  // Act
  await run.app().close()
  // Assert
  await access(sharedOther)
})

// protects=decision D8 (the app's own folder is still cleaned): a timestamp file the forced kill left in the app's own node_modules/.vite-temp is removed, and one that existed before the launch is kept; fails_when=the own folder is no longer cleaned or a pre-existing file is deleted; no_claim=a shared ancestor folder (test above)
test('a timestamp file left in the apps own .vite-temp is removed and one from before the launch is kept', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  const appFolder = join(repository.root, APP)
  const tempFolder = 'node_modules/.vite-temp'
  const oldName = 'vite.config.ts.timestamp-1-old.mjs'
  const newName = 'vite.config.ts.timestamp-123-abc.mjs'
  await put(appFolder, `${tempFolder}/${oldName}`, 'x')
  await put(
    appFolder,
    'package.json',
    JSON.stringify({
      name: 'nested',
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: 'vite' },
    }),
  )
  await put(appFolder, 'stub-vite.json', JSON.stringify({ port }))
  const controller = new AbortController()
  let app: DevelopmentApp | undefined
  context.after(async () => {
    await app?.close()
  })
  const workspaceInfo = await assessViteWorkspace(
    appFolder,
    process.execPath,
    controller.signal,
    repository.root,
  )
  await launchViteDevelopmentServer(
    {
      workspace: appFolder,
      vitePackage: await resolveVitePackage(repository.root, APP),
      node: process.execPath,
      record: () => undefined,
      inspectServer: false,
      signal: controller.signal,
      alive: () => undefined,
      assertPortFree: async () => undefined,
      onDeclaredPort: () => undefined,
      onApp: (value) => {
        app = value
      },
      onStep: () => undefined,
    },
    workspaceInfo,
    LAUNCHER,
  )
  await put(appFolder, `${tempFolder}/${newName}`, 'x')
  // Act
  await app!.close()
  // Assert
  await assert.rejects(access(join(appFolder, tempFolder, newName)))
  await access(join(appFolder, tempFolder, oldName))
})
