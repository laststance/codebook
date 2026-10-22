import assert from 'node:assert/strict'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { DebugAdapterTrackerFactory, DebugSession } from 'vscode'
import { z } from 'zod'

import type { ConfiguredBrowserRun } from '../configuredBrowserRun'
import { configuredDefinitionSchema } from '../configuredStudySchemas'
import type * as EnvironmentModule from '../environment'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'

test('untrusted, remote and virtual workspaces reject execution before creating any runtime', async () => {
  // Arrange
  const workspace = {
      isTrusted: false,
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
    },
    env = { remoteName: '' }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    { './configuredBrowserRun': {}, vscode: { workspace, env } },
  )
  // Act / Assert
  assert.throws(() => boundary.requireWorkspace(), /Trust this workspace/)
  workspace.isTrusted = true
  env.remoteName = 'ssh-remote'
  assert.throws(
    () => boundary.requireWorkspace(),
    /Open a trusted file workspace on this machine or in WSL; other remote and virtual workspaces are not supported\./,
  )
  env.remoteName = 'wsl'
  workspace.workspaceFolders[0]!.uri.scheme = 'virtual'
  assert.throws(() => boundary.requireWorkspace(), /file workspace/)
  env.remoteName = ''
  assert.throws(() => boundary.requireWorkspace(), /file workspace/)
  workspace.workspaceFolders[0]!.uri.scheme = 'file'
  assert.equal(boundary.requireWorkspace(), '/workspace')
})

// Value: protects=Codebook on VS Code or Cursor for Windows opened on a repository in WSL; fails_when=a WSL remote file workspace is refused like any other remote, so Set Up AI Chat and status answer "not supported"; why_new=the boundary test only proved that every remote is refused (Cycle 0044 row N-1); seam=none
test('a trusted file workspace opened in WSL is accepted and its prerequisites answer ready', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wsl-'))
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
  const chromeExecutable = join(directory, 'chrome')
  await writeFile(chromeExecutable, '#!/bin/sh\n', { mode: 0o755 })
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      'node:util': {
        promisify: () => async () => ({ stdout: 'Google Chrome 140.0' }),
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (key: string, fallback: string) =>
              key === 'chromeExecutable' ? chromeExecutable : fallback,
          }),
        },
        env: {
          appRoot: directory,
          appName: 'Visual Studio Code',
          remoteName: 'wsl',
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
  // Act
  const workspace = boundary.requireWorkspace()
  const environment = await boundary.createEnvironment({
    extensionPath: directory,
  })
  context.after(() => environment.dispose())
  const prerequisites = await environment.prerequisites()
  // Assert
  assert.equal(workspace, directory)
  assert.deepEqual([...prerequisites.missing], [])
  assert.equal(prerequisites.ready, true)
})

// Value: protects=codebook_status naming an older root Vitest under profiles['node-test'] before any start, while the shared prerequisites stay ready; fails_when=the node-test profile reads ready with Vitest 3, or the Vitest sentence leaks into the browser profile's prerequisites; why_new=the Vitest check ran only inside the launch (X9, EN11, AC18); seam=the editor and its settings are fakes, the repository's node_modules is real; no_claim=package-root Vitest (a later candidate)
test('a workspace whose root Vitest is older than 4 makes the node-test profile name it before any start', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-status-'))
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
  await mkdir(join(directory, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(
    join(directory, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version: '3.2.4' }),
  )
  const chromeExecutable = join(directory, 'chrome')
  await writeFile(chromeExecutable, '#!/bin/sh\n', { mode: 0o755 })
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      'node:util': {
        promisify: () => async () => ({ stdout: 'Google Chrome 140.0' }),
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (key: string, fallback: string) =>
              key === 'chromeExecutable' ? chromeExecutable : fallback,
          }),
        },
        env: {
          appRoot: directory,
          appName: 'Visual Studio Code',
          remoteName: 'wsl',
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
  const prerequisites = await environment.prerequisites()

  // Assert
  assert.equal(prerequisites.ready, true)
  const nodeTest = prerequisites.profiles?.['node-test']
  // The module runs in its own context: its objects are copied into this one before they are compared.
  assert.deepEqual(
    { ready: nodeTest?.ready, missing: [...(nodeTest?.missing ?? [])] },
    {
      ready: false,
      missing: [
        'node-test needs Vitest 4 or later at the repository root; this repository has 3.2.4 (node_modules/vitest/package.json). Ask the learner to upgrade it, then call codebook_status again.',
      ],
    },
  )
  assert.ok(
    !prerequisites.profiles?.['repository-browser']?.missing.some((sentence) =>
      sentence.includes('Vitest'),
    ),
  )
})

// Value: protects=a Linux or WSL learner who never set codebook.chromeExecutable; fails_when=the unset setting still names the macOS bundle path and status answers only "configure an installed executable Chrome"; why_new=the prerequisite test configured an absent path on every platform (Cycle 0044 row N-6); seam=the package.json default read as VS Code applies it
for (const scenario of [
  { name: 'google-chrome on PATH is used', installed: true },
  {
    name: 'no Chrome on PATH is named with a Linux remedy',
    installed: false,
  },
])
  test(`on Linux with codebook.chromeExecutable unset, ${scenario.name}`, async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-linux-chrome-'))
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
    const binDirectory = join(directory, 'bin')
    await mkdir(binDirectory)
    if (scenario.installed)
      await writeFile(join(binDirectory, 'google-chrome'), '#!/bin/sh\n', {
        mode: 0o755,
      })
    const manifest = z
      .object({
        contributes: z.object({
          configuration: z.object({
            properties: z.record(
              z.string(),
              z.object({ default: z.unknown().optional() }),
            ),
          }),
        }),
      })
      .parse(
        JSON.parse(
          await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
        ),
      )
    const disposable = { dispose(): void {} }
    const boundary = await loadModule<typeof EnvironmentModule>(
      resolve(__dirname, '../environment.js'),
      {
        './configuredBrowserRun': {},
        './utils/resolveExternalNodeExecutable': {
          resolveExternalNodeExecutable: async () => '/external/node',
        },
        'node:util': {
          promisify: () => async () => ({ stdout: 'Google Chrome 140.0' }),
        },
        vscode: {
          workspace: {
            isTrusted: true,
            workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
            // An unset setting answers the manifest default, as VS Code does.
            getConfiguration: () => ({
              get: (key: string, fallback: unknown) =>
                manifest.contributes.configuration.properties[`codebook.${key}`]
                  ?.default ?? fallback,
            }),
          },
          env: { appRoot: directory, appName: 'Visual Studio Code' },
          version: '1.140.0',
          extensions: { getExtension: () => ({}) },
          debug: {
            registerDebugAdapterTrackerFactory: () => disposable,
            onDidTerminateDebugSession: () => disposable,
            onDidChangeActiveDebugSession: () => disposable,
          },
        },
      },
      {
        process: { platform: 'linux', env: { PATH: binDirectory } },
      },
    )
    const environment = await boundary.createEnvironment({
      extensionPath: directory,
    })
    context.after(() => environment.dispose())
    // Act
    const prerequisites = await environment.prerequisites()
    // Assert
    if (scenario.installed) {
      assert.deepEqual([...prerequisites.missing], [])
      assert.equal(prerequisites.ready, true)
    } else {
      assert.equal(prerequisites.ready, false)
      assert.deepEqual(
        [...prerequisites.missing],
        [
          'codebook.chromeExecutable: no google-chrome, google-chrome-stable, chromium or chromium-browser is on PATH. Install Google Chrome for Linux (or Chromium), or set codebook.chromeExecutable to its executable path.',
        ],
      )
    }
  })

/**
 * Creates the real environment of a Linux window whose `codebook.chromeExecutable` is unset, over two PATH directories the test fills, and records every executable check the environment makes and every binary it asks for its version.
 * @param context - The test, which removes the temporary folder and disposes the environment when it ends.
 * @returns The environment, the first PATH directory (kept empty), the second (where a test installs browsers), the checked paths and the binaries asked for a version, both in order.
 * @example
 * const linux = await linuxEnvironmentWithUnsetChrome(context)
 * await writeFile(join(linux.installDirectory, 'chromium'), '#!/bin/sh\n', { mode: 0o755 })
 * await linux.environment.prerequisites() // linux.checked => every path probed, then the found one once more
 */
async function linuxEnvironmentWithUnsetChrome(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-chrome-lookup-'))
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
  const emptyDirectory = join(directory, 'empty-bin'),
    installDirectory = join(directory, 'bin')
  await mkdir(emptyDirectory)
  await mkdir(installDirectory)
  const checked: string[] = [],
    versionAsked: string[] = []
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      // The real filesystem answers; every executable check is recorded first.
      'node:fs/promises': {
        readFile,
        access: (path: string, mode?: number) => {
          checked.push(path)
          return access(path, mode)
        },
      },
      'node:util': {
        promisify: () => async (binary: string) => {
          versionAsked.push(binary)
          return { stdout: 'Chromium 140.0' }
        },
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (key: string, fallback: unknown) =>
              key === 'chromeExecutable' ? '' : fallback,
          }),
        },
        env: { appRoot: directory, appName: 'Visual Studio Code' },
        version: '1.140.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: () => disposable,
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
    {
      process: {
        platform: 'linux',
        env: { PATH: `${emptyDirectory}:${installDirectory}` },
      },
    },
  )
  const environment = await boundary.createEnvironment({
    extensionPath: directory,
  })
  context.after(() => environment.dispose())
  return {
    environment,
    emptyDirectory,
    installDirectory,
    checked,
    versionAsked,
  }
}

// Cycle 0045 (SP-4): red while every prerequisite check probed every Chrome name in every PATH directory again (98 ms on a host without Chrome).
test('a second status read with the same setting and PATH does not search the PATH for Chrome again', async (context) => {
  // Arrange: Chromium, the third name searched, is installed in the second PATH directory.
  const linux = await linuxEnvironmentWithUnsetChrome(context)
  const chromium = join(linux.installDirectory, 'chromium')
  await writeFile(chromium, '#!/bin/sh\n', { mode: 0o755 })
  const first = await linux.environment.prerequisites()
  const checkedByFirstRead = linux.checked.splice(0)
  // Act
  const second = await linux.environment.prerequisites()
  // Assert
  assert.deepEqual(checkedByFirstRead, [
    join(linux.emptyDirectory, 'google-chrome'),
    join(linux.installDirectory, 'google-chrome'),
    join(linux.emptyDirectory, 'google-chrome-stable'),
    join(linux.installDirectory, 'google-chrome-stable'),
    join(linux.emptyDirectory, 'chromium'),
    chromium,
    chromium,
  ])
  // The remembered executable is checked once by the lookup and once by the prerequisite itself; no other path is probed.
  assert.deepEqual(linux.checked, [chromium, chromium])
  assert.deepEqual([...first.missing], [])
  assert.deepEqual([...second.missing], [])
  assert.equal(second.ready, true)
})

test('a second status read after no Chrome was found on PATH answers the same remedy without probing the PATH again', async (context) => {
  // Arrange
  const linux = await linuxEnvironmentWithUnsetChrome(context)
  await linux.environment.prerequisites()
  const checkedByFirstRead = linux.checked.splice(0)
  // Act
  const second = await linux.environment.prerequisites()
  // Assert
  assert.equal(checkedByFirstRead.length, 8)
  assert.deepEqual(linux.checked, [])
  assert.equal(second.ready, false)
  assert.deepEqual(
    [...second.missing],
    [
      'codebook.chromeExecutable: no google-chrome, google-chrome-stable, chromium or chromium-browser is on PATH. Install Google Chrome for Linux (or Chromium), or set codebook.chromeExecutable to its executable path.',
    ],
  )
})

// Cycle 0045 (PC-3.6): a remembered executable that is gone must not become "configure an installed executable Chrome" while another browser is on the PATH.
test('after the Chrome found on PATH is uninstalled and Chromium installed, the next status read is ready with Chromium', async (context) => {
  // Arrange
  const linux = await linuxEnvironmentWithUnsetChrome(context)
  const chrome = join(linux.installDirectory, 'google-chrome'),
    chromium = join(linux.installDirectory, 'chromium')
  await writeFile(chrome, '#!/bin/sh\n', { mode: 0o755 })
  await linux.environment.prerequisites()
  await rm(chrome)
  await writeFile(chromium, '#!/bin/sh\n', { mode: 0o755 })
  // Act
  const afterTheSwitch = await linux.environment.prerequisites()
  // Assert
  assert.deepEqual([...afterTheSwitch.missing], [])
  assert.equal(afterTheSwitch.ready, true)
  assert.deepEqual(linux.versionAsked, [chrome, chromium])
})

test('the configured environment routes only owned DAP responses and reveals immutable Study source without a demo or raw-tab fallback', async (context) => {
  // Arrange: constructor/host effects are controlled; the environment bridge and prerequisite decisions are real.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-environment-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '3.21.13', commit: 'fixture' }),
  )
  const filesystem = await import('node:fs/promises'),
    accesses: string[] = [],
    messages: string[] = [],
    instances: SelectedRun[] = []
  let ownedLock: { dev: bigint; ino: bigint } | undefined,
    runStatus: 'preparing' | 'ready' = 'ready',
    cleaning = false
  let factory: DebugAdapterTrackerFactory | undefined,
    revealed = false
  class SelectedRun {
    readonly id = 'configured-run'
    readonly activeSessions = new Set<string>()
    readonly evidence = { record(): void {} }
    constructor(
      readonly options: ConstructorParameters<typeof ConfiguredBrowserRun>[0],
    ) {
      instances.push(this)
    }
    owner(session: DebugSession) {
      return session.id === 'selected'
    }
    addSession(session: DebugSession): void {
      this.activeSessions.add(session.id)
    }
    onRequest(): void {
      messages.push('request')
    }
    onResponse(): void {
      messages.push('response')
    }
    onEvent(): void {
      messages.push('event')
    }
    view() {
      return {
        status: runStatus,
        cleaned: false,
        snapshots: createConfiguredStudy().observations,
      }
    }
    terminated(): void {}
    fail(): void {
      messages.push('failed')
    }
    ownsDevelopmentLock() {
      return ownedLock
    }
    isCleaning() {
      return cleaning
    }
  }
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': { ConfiguredBrowserRun: SelectedRun },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      'node:fs/promises': {
        ...filesystem,
        access: async (path: string) => {
          accesses.push(path)
          if (path.includes('/dist/demo/'))
            throw new Error('No installed demo fixtures')
        },
      },
      'node:util': {
        promisify: () => async (file: string) => ({
          stdout:
            file === 'node'
              ? JSON.stringify({
                  version: '24.21.0',
                  executable: '/external/node',
                })
              : 'Chrome fixture',
        }),
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (_key: string, fallback: string) => fallback,
          }),
        },
        env: { appRoot: directory, appName: 'Cursor' },
        version: '1.128.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: (
            _kind: string,
            value: DebugAdapterTrackerFactory,
          ) => {
            factory = value
            return disposable
          },
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const environment = await boundary.createEnvironment(
    { extensionPath: resolve(__dirname, '../..') },
    {
      createViewport: () => {
        throw new Error('No renderer acquisition in a factory test')
      },
      revealSource: async () => revealed,
    },
  )
  context.after(() => environment.dispose())
  await mkdir(join(directory, 'node_modules/next/dist/bin'), {
    recursive: true,
  })
  const nextExecutable = join(directory, 'node_modules/next/dist/bin/next')
  await writeFile(nextExecutable, 'Next fixture')
  await mkdir(join(directory, '.next/dev'), { recursive: true })
  await writeFile(join(directory, '.next/dev/lock'), 'owned run fixture')
  // The run reads its lock with exact numbers, so the stand-in does too.
  const lockStatus = await lstat(join(directory, '.next/dev/lock'), {
    bigint: true,
  })
  ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino }
  assert.equal(
    (await environment.prerequisites()).profiles?.['repository-browser']?.ready,
    false,
  )
  const cancellation = new AbortController(),
    control = {
      signal: cancellation.signal,
      deadlineAt: 600000,
      preparationDeadlineAt: 90000,
    }
  const fixture = createConfiguredStudy()
  const definition = configuredDefinitionSchema.parse({
    configuration: fixture.configuration,
    configurationHash: fixture.configurationHash,
    descriptor: fixture.descriptor,
  })
  // Act
  const runtime = await environment.createRuntime(
      join(directory, 'runtime'),
      definition,
      control,
    ),
    selected = instances[0]!
  runStatus = 'preparing'
  ownedLock = undefined
  const preparing = await environment.prerequisites()
  assert.equal(preparing.profiles?.['repository-browser']?.ready, false)
  assert.match(
    preparing.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /Poll the current run; do not stop its process/,
  )
  assert.doesNotMatch(
    preparing.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /belongs to another process/,
  )
  runStatus = 'ready'
  ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino }
  assert.equal(
    (await environment.prerequisites()).profiles?.['repository-browser']?.ready,
    true,
  )
  cleaning = true
  ownedLock = undefined
  const releasing = await environment.prerequisites()
  assert.equal(releasing.profiles?.['repository-browser']?.ready, false)
  assert.match(
    releasing.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /releasing its managed run/,
  )
  assert.doesNotMatch(
    releasing.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /belongs to another process/,
  )
  cleaning = false
  ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino }
  const lockPath = join(directory, '.next/dev/lock'),
    ownedLockBackup = join(directory, '.next/dev/lock.owned')
  await rename(lockPath, ownedLockBackup)
  await writeFile(lockPath, 'foreign lock')
  const replacedDuringRun = await environment.prerequisites()
  assert.equal(replacedDuringRun.profiles?.['repository-browser']?.ready, false)
  assert.match(
    replacedDuringRun.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /lock/,
  )
  await rm(lockPath)
  await rename(ownedLockBackup, lockPath)
  await rm(nextExecutable)
  const missingDuringRun = await environment.prerequisites()
  assert.equal(missingDuringRun.profiles?.['repository-browser']?.ready, false)
  assert.match(
    missingDuringRun.profiles?.['repository-browser']?.missing.join(' ') ?? '',
    /Next/,
  )
  await writeFile(nextExecutable, 'Next fixture')
  const session: DebugSession = {
    id: 'selected',
    type: 'pwa-chrome',
    name: 'selected',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-chrome', request: 'launch', name: 'selected' },
    customRequest: async () => ({}),
    getDebugProtocolBreakpoint: async () => undefined,
  }
  const tracker = await factory!.createDebugAdapterTracker(session)
  tracker?.onWillReceiveMessage?.({
    type: 'request',
    command: 'setBreakpoints',
  })
  tracker?.onDidSendMessage?.({ type: 'response', command: 'setBreakpoints' })
  tracker?.onDidSendMessage?.({ type: 'event', event: 'stopped' })
  // Assert
  assert.equal(runtime.id, 'configured-run')
  assert.equal(selected.options.control, control)
  assert.equal(selected.options.definition, definition)
  assert.equal(selected.options.host.id, 'cursor')
  assert.deepEqual(messages, ['request', 'response', 'event'])
  assert.equal(
    await factory!.createDebugAdapterTracker({ ...session, id: 'foreign' }),
    undefined,
  )
  assert.equal(
    accesses.some((path) => path.includes('/dist/demo/')),
    false,
  )
  await assert.rejects(
    selected.options.revealSource(createConfiguredStudy().observations[0]!),
    { code: 'EVIDENCE_UNAVAILABLE' },
  )
  revealed = true
  await selected.options.revealSource(createConfiguredStudy().observations[0]!)
  await assert.rejects(
    selected.options.revealSource({
      ...createConfiguredStudy().observations[0]!,
      id: 'foreign-snapshot',
    }),
    { code: 'EVIDENCE_UNAVAILABLE' },
  )
  cancellation.abort()
  await assert.rejects(
    environment.createRuntime(
      join(directory, 'cancelled'),
      definition,
      control,
    ),
    /abort/i,
  )
  assert.equal(instances.length, 1)
})

// Cycle 0044 (0042-SR1): red while a finished run stayed in the environment's run map for the window's life, with its journal and script maps.
test('a released configured run is dropped when the next one is created, so the debugger sessions of a finished run are no longer routed', async (context) => {
  // Arrange: constructor and host effects are controlled; the environment's run map and prerequisite decisions are real.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-environment-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '3.21.13', commit: 'fixture' }),
  )
  await mkdir(join(directory, 'node_modules/next/dist/bin'), {
    recursive: true,
  })
  await writeFile(
    join(directory, 'node_modules/next/dist/bin/next'),
    'Next fixture',
  )
  const filesystem = await import('node:fs/promises'),
    instances: OwnedRun[] = []
  let factory: DebugAdapterTrackerFactory | undefined
  class OwnedRun {
    readonly id = `configured-run-${instances.length + 1}`
    readonly activeSessions = new Set<string>()
    readonly evidence = { record(): void {} }
    cleaned = false
    constructor() {
      instances.push(this)
    }
    owner(session: DebugSession) {
      return session.id === this.id
    }
    addSession(): void {}
    onRequest(): void {}
    onResponse(): void {}
    onEvent(): void {}
    view() {
      return { status: 'ready', cleaned: this.cleaned, snapshots: [] }
    }
    terminated(): void {}
    fail(): void {}
    ownsDevelopmentLock() {
      return undefined
    }
    isCleaning() {
      return false
    }
  }
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': { ConfiguredBrowserRun: OwnedRun },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      'node:fs/promises': { ...filesystem, access: async () => undefined },
      'node:util': {
        promisify: () => async (file: string) => ({
          stdout:
            file === 'node'
              ? JSON.stringify({
                  version: '24.21.0',
                  executable: '/external/node',
                })
              : 'Chrome fixture',
        }),
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (_key: string, fallback: string) => fallback,
          }),
        },
        env: { appRoot: directory, appName: 'Cursor' },
        version: '1.128.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: (
            _kind: string,
            value: DebugAdapterTrackerFactory,
          ) => {
            factory = value
            return disposable
          },
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const environment = await boundary.createEnvironment({
    extensionPath: resolve(__dirname, '../..'),
  })
  context.after(() => environment.dispose())
  const fixture = createConfiguredStudy()
  const definition = configuredDefinitionSchema.parse({
    configuration: fixture.configuration,
    configurationHash: fixture.configurationHash,
    descriptor: fixture.descriptor,
  })
  const session = (id: string): DebugSession => ({
    id,
    type: 'pwa-chrome',
    name: id,
    workspaceFolder: undefined,
    configuration: { type: 'pwa-chrome', request: 'launch', name: id },
    customRequest: async () => ({}),
    getDebugProtocolBreakpoint: async () => undefined,
  })
  await environment.createRuntime(join(directory, 'first'), definition)
  const routedWhileLive = await factory!.createDebugAdapterTracker(
    session('configured-run-1'),
  )
  // Act: the first run is released, and a second one is created.
  instances[0]!.cleaned = true
  await environment.createRuntime(join(directory, 'second'), definition)
  const routedAfterRelease = await factory!.createDebugAdapterTracker(
    session('configured-run-1'),
  )
  const secondRouted = await factory!.createDebugAdapterTracker(
    session('configured-run-2'),
  )
  // Assert
  assert.notEqual(routedWhileLive, undefined)
  assert.equal(routedAfterRelease, undefined)
  assert.notEqual(secondRouted, undefined)
})

test('missing Node Chrome and debugger prerequisites identify configuration keys without starting a runtime', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-prerequisite-'))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '1.138.0', commit: 'fixture' }),
  )
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: () => join(directory, 'absent-executable'),
          }),
        },
        env: { appRoot: directory, appName: 'Visual Studio Code' },
        version: '1.138.0',
        extensions: { getExtension: () => undefined },
        debug: {
          registerDebugAdapterTrackerFactory: () => disposable,
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const context = { extensionPath: resolve(__dirname, '../..') }
  try {
    const environment = await boundary.createEnvironment(context)
    // Act
    const prerequisites = await environment.prerequisites()
    // Assert
    assert.equal(prerequisites.ready, false)
    assert.equal(prerequisites.missing.length, 3)
    assert.equal(prerequisites.profiles?.['repository-browser']?.ready, false)
    assert.match(
      prerequisites.profiles?.['repository-browser']?.missing.join(' ') ?? '',
      /Next/,
    )
    assert.match(prerequisites.missing.join('\n'), /ms-vscode.js-debug/)
    assert.match(prerequisites.missing.join('\n'), /codebook.nodeExecutable/)
    assert.match(prerequisites.missing.join('\n'), /codebook.chromeExecutable/)
    await assert.rejects(
      environment.createRuntime(join(directory, 'runtime'), {
        configuration: createConfiguredStudy().configuration,
        configurationHash: createConfiguredStudy().configurationHash,
        descriptor: createConfiguredStudy().descriptor!,
      }),
      /nodeExecutable/,
    )
    environment.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
