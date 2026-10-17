import assert from 'node:assert/strict'
import fsPromises, {
  readFile,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
  rm,
  stat,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  setImmediate as nextEventLoopTurn,
  setTimeout as delay,
} from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

import type { BrowserViewportFactory } from '../runtimeSupport/browserViewport'
import { Cdp } from '../runtimeSupport/cdp'
import type * as HostModule from '../runtimeSupport/hostBrowser'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'

import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'

/** Loads the compiled adapter with controlled non-cancellable editor calls for cleanup regressions; the adapter's lazy import of its viewport module is answered by the same `require` as its other modules, so a managed launch can get a stand-in. @example await loadHostBrowser(editorStub) */
async function loadHostBrowser(
  editor: object,
  modules: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
): Promise<typeof HostModule.HostBrowser> {
  const filename = join(__dirname, '../runtimeSupport/hostBrowser.js')
  const nativeRequire = createRequire(filename)
  const exports: Partial<typeof HostModule> = {}
  const compiled = await readFile(filename, 'utf8')
  // A plain script context cannot import; the one lazy import becomes a `require`, which the map below answers.
  const script = compiled.replace(
    "await import('./browserViewport.js')",
    "require('./browserViewport.js')",
  )
  assert.notEqual(script, compiled, 'the lazy viewport import was found')
  runInNewContext(
    script,
    {
      exports,
      URL,
      fetch,
      AbortSignal,
      ...globals,
      require: (name: string) =>
        name === 'vscode'
          ? editor
          : name === './utils/awaitResponse'
            ? {
                awaitResponse: (
                  response: PromiseLike<unknown>,
                  description: string,
                  signal?: AbortSignal,
                ) => awaitResponse(response, description, signal, 20),
              }
            : (modules[name] ?? nativeRequire(name)),
    },
    { filename },
  )
  assert.ok(exports.HostBrowser)
  return exports.HostBrowser
}

/**
 * Builds a managed browser for cleanup tests whose profile folder lies under a root of the test's own, never under the real `/tmp`; the editor's debugger start, the processes of a profile and the folder removal are the test's.
 * @param context - The test, which removes the root when it ends.
 * @param options.startDebugging - The editor's answer to the debugger launch; started at once by default.
 * @param options.onEvent - Called with the type of every journal entry as it is recorded, for a test that cancels at one.
 * @param options.removeFolder - Stands in for the adapter's folder removal; the real one by default.
 * @param options.removeAbandonedProfiles - Stands in for the sweep of the profile folders a killed editor left; the real one by default.
 * @param options.currentStorageOwner - Stands in for the read of this process's machine, boot and start, for a test that holds it; the real one by default.
 * @param options.createViewport - Holds or rejects the real factory boundary while the test observes launch and cleanup ordering.
 * @param options.platform - The system the adapter reads from `process.platform`; this machine's by default.
 * @param options.processesOfProfile - The processes a look for the profile finds, by the look's number (1 for the first); none by default.
 * @param options.rootChosenByTheBrowser - Gives the browser no profile root, so it chooses its own as the product does (managedProfileRoot): its loaded context reads `LOCALAPPDATA` as the test's root then, and answers a home folder and a temp folder (`os.homedir`, `os.tmpdir`) that no system's root may be taken from. By default the browser is given the test's root.
 * @returns The browser, its root, every journal entry as plain data, and every profile whose processes were asked for. A profile's processes are looked up like the real utility does it: the folder is resolved first, which fails once it is gone, and the processes `options.processesOfProfile` names are found.
 * @example
 * const managed = await managedBrowser(context)
 * await managed.browser.launch(configuration, signal); await managed.browser.close() // managed.events names browser.managed-profile-removed
 */
async function managedBrowser(
  context: TestContext,
  options: {
    startDebugging?: () => Promise<boolean>
    onEvent?: (type: string) => void
    removeFolder?: typeof rm
    removeAbandonedProfiles?: (root: string) => Promise<string[]>
    currentStorageOwner?: () => Promise<{ hostname: string }>
    createViewport?: BrowserViewportFactory
    platform?: NodeJS.Platform
    processesOfProfile?: (look: number) => { pid: number; command: string }[]
    rootChosenByTheBrowser?: boolean
  } = {},
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-root-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  const events: { type: string; detail: unknown }[] = [],
    processProbes: string[] = []
  const HostBrowser = await loadHostBrowser(
    {
      debug: { startDebugging: options.startDebugging ?? (async () => true) },
      window: { tabGroups: { all: [] } },
    },
    {
      'node:fs/promises': {
        ...fsPromises,
        rm: options.removeFolder ?? rm,
      },
      // The real viewport needs the editor; a managed launch gets one whose close does nothing.
      './browserViewport.js': {
        BrowserViewport: class {
          close(): void {}
          async attach(): Promise<void> {}
        },
      },
      './utils/profileProcesses': {
        profileProcesses: async (profile: string) => {
          processProbes.push(profile)
          const look = processProbes.length
          await realpath(profile)
          return options.processesOfProfile?.(look) ?? []
        },
      },
      ...(options.removeAbandonedProfiles && {
        './utils/removeAbandonedProfiles': {
          removeAbandonedProfiles: options.removeAbandonedProfiles,
        },
      }),
      ...(options.currentStorageOwner && {
        '../utils/currentStorageOwner': {
          currentStorageOwner: options.currentStorageOwner,
        },
      }),
      ...(options.rootChosenByTheBrowser && {
        'node:os': {
          ...os,
          homedir: () => join(root, 'a-home-folder-not-to-use'),
          tmpdir: () => '/var/folders/zz/a-long-temporary-folder-not-to-use/T',
        },
      }),
    },
    // The owner marker names this process; a test may name another system, which the adapter reads as `process.platform`, and the user's local application data folder it reads as `process.env.LOCALAPPDATA`.
    {
      process:
        options.platform || options.rootChosenByTheBrowser
          ? new Proxy(process, {
              get: (target, key) => {
                if (key === 'platform' && options.platform)
                  return options.platform
                if (key === 'env' && options.rootChosenByTheBrowser)
                  return { ...process.env, LOCALAPPDATA: root }
                return Reflect.get(target, key, target)
              },
            })
          : process,
    },
  )
  const browser = new HostBrowser(
    {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
      browserBackend: 'managed',
      chrome: { binary: process.execPath, version: 'test' },
    },
    'owned-run',
    'http://127.0.0.1/owned',
    (type, detail) => {
      // The adapter runs in a context of its own; its details are kept as plain data of this one.
      events.push({
        type,
        detail: detail === undefined ? undefined : structuredClone(detail),
      })
      options.onEvent?.(type)
    },
    'normal',
    undefined,
    options.createViewport,
    options.rootChosenByTheBrowser ? undefined : root,
  )
  return { browser, root, events, processProbes }
}

/** Reads from a managed browser's journal the profile folder its launch created. @example profileOf(managed.events) // => '/tmp/codebook-profile-root-x/codebook-browser-a1b2c3' */
function profileOf(events: { type: string; detail: unknown }[]): string {
  const created = events.find(
    (event) => event.type === 'browser.managed-profile',
  )
  assert.ok(
    created?.detail &&
      typeof created.detail === 'object' &&
      'profile' in created.detail &&
      typeof created.detail.profile === 'string',
  )
  return created.detail.profile
}

test('a managed run waits for its App viewport before launching the debugger', async (context) => {
  // Arrange: the factory has started but has not yet produced its native resource.
  let finishViewport = (
    _viewport: Awaited<ReturnType<BrowserViewportFactory>>,
  ): void => {}
  let noteFactoryStarted = (): void => {}
  const factoryStarted = new Promise<void>((resolve) => {
    noteFactoryStarted = resolve
  })
  const pendingViewport = new Promise<
    Awaited<ReturnType<BrowserViewportFactory>>
  >((resolve) => {
    finishViewport = resolve
  })
  let debuggerStarts = 0
  let viewportCloses = 0
  // The nominal viewport class owns native editor dependencies; this fixture models only the adapter's close boundary.
  const viewport = {
    close: () => {
      viewportCloses++
    },
  } as Awaited<ReturnType<BrowserViewportFactory>>
  const managed = await managedBrowser(context, {
    createViewport: () => {
      noteFactoryStarted()
      return pendingViewport
    },
    startDebugging: async () => {
      debuggerStarts++
      return true
    },
  })

  // Act
  const launching = managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const launchResult = launching.then(
    () => 'launched',
    (error: unknown) => String(error),
  )
  try {
    await factoryStarted
    await nextEventLoopTurn()

    // Assert: a pending native App cannot be bypassed by starting execution first.
    assert.equal(debuggerStarts, 0)
    finishViewport(viewport)
    assert.equal(await launchResult, 'launched')
    assert.equal(debuggerStarts, 1)
    await managed.browser.close()
    assert.equal(viewportCloses, 1)
  } finally {
    finishViewport(viewport)
    await launchResult
    await managed.browser.close().catch(() => undefined)
  }
})

test('closing a managed run retires an App viewport that finishes after cancellation', async (context) => {
  // Arrange
  let finishViewport = (
    _viewport: Awaited<ReturnType<BrowserViewportFactory>>,
  ): void => {}
  let noteFactoryStarted = (): void => {}
  const factoryStarted = new Promise<void>((resolve) => {
    noteFactoryStarted = resolve
  })
  const pendingViewport = new Promise<
    Awaited<ReturnType<BrowserViewportFactory>>
  >((resolve) => {
    finishViewport = resolve
  })
  let viewportCloses = 0
  let debuggerStarts = 0
  // This native-resource stand-in makes a missed late close observable without constructing an editor in Node.
  const viewport = {
    close: () => {
      viewportCloses++
    },
  } as Awaited<ReturnType<BrowserViewportFactory>>
  const managed = await managedBrowser(context, {
    createViewport: () => {
      noteFactoryStarted()
      return pendingViewport
    },
    startDebugging: async () => {
      debuggerStarts++
      return true
    },
  })
  const cancellation = new AbortController()
  const launchResult = managed.browser
    .launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      cancellation.signal,
    )
    .then(
      () => 'launched',
      (error: unknown) => String(error),
    )
  let closeSettled = false
  let closing: Promise<string> | undefined
  try {
    await factoryStarted

    // Act: Close begins while the accepted factory still owns an unresolved resource.
    cancellation.abort(new Error('cancelled while App was preparing'))
    closing = managed.browser.close().then(
      () => {
        closeSettled = true
        return 'closed'
      },
      (error: unknown) => {
        closeSettled = true
        return String(error)
      },
    )
    await nextEventLoopTurn()
    finishViewport(viewport)

    // Assert
    assert.equal(debuggerStarts, 0)
    assert.equal(closeSettled, false)
    assert.equal(await closing, 'closed')
    assert.equal(
      await launchResult,
      'Error: Cancelled owned App viewport preparation',
    )
    assert.equal(viewportCloses, 1)
    assert.equal(await exists(profileOf(managed.events)), false)
  } finally {
    finishViewport(viewport)
    await launchResult
    await closing
    await managed.browser.close().catch(() => undefined)
  }
})

test('a failed App viewport preparation never starts the managed debugger', async (context) => {
  // Arrange
  let debuggerStarts = 0
  const rejectedViewport = Promise.reject<
    Awaited<ReturnType<BrowserViewportFactory>>
  >(new Error('App group registration refused'))
  // Keep the original buggy adapter's ignored promise from becoming an unrelated unhandled-rejection failure.
  void rejectedViewport.catch(() => undefined)
  const managed = await managedBrowser(context, {
    createViewport: () => rejectedViewport,
    startDebugging: async () => {
      debuggerStarts++
      return true
    },
  })
  try {
    // Act / Assert
    await assert.rejects(
      managed.browser.launch(
        { type: 'editor-browser', name: 'owned', request: 'launch' },
        new AbortController().signal,
      ),
      /App group registration refused/,
    )
    assert.equal(debuggerStarts, 0)
    await managed.browser.close()
    assert.equal(await exists(profileOf(managed.events)), false)
  } finally {
    await managed.browser.close().catch(() => undefined)
  }
})

/** Says whether a path still exists. @example await exists('/tmp/codebook-browser-a1b2c3') // => false after its run closed */
function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

test('a timed-out native tab is closed when its handle arrives after cleanup also times out', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-late-tab-'))
  const descriptor = join(directory, 'endpoint.json')
  await writeFile(descriptor, '{"port":9222}')
  let releaseTab!: (tab: { success: boolean; browserId: string }) => void
  const acquisition = new Promise<{ success: boolean; browserId: string }>(
    (resolve) => {
      releaseTab = resolve
    },
  )
  const liveTabs = new Set<string>()
  const events: string[] = []
  const commands = ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(
    (name) => `cursor.browserView.${name}`,
  )
  const HostBrowser = await loadHostBrowser({
    commands: {
      getCommands: async () => commands,
      executeCommand: async (command: string, browserId: string) => {
        if (command.endsWith('newTab')) return acquisition
        if (command.endsWith('closeTab')) {
          liveTabs.delete(browserId)
          return { success: true }
        }
        return { tabs: [...liveTabs] }
      },
    },
  })
  const browser = new HostBrowser(
    {
      id: 'cursor',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
      endpointPath: descriptor,
    },
    'owned-run',
    'http://127.0.0.1/owned',
    (type) => events.push(type),
    'normal',
  )
  try {
    // Act
    await assert.rejects(
      browser.launch(
        { type: 'editor-browser', name: 'owned', request: 'launch' },
        new AbortController().signal,
      ),
      /Timed out waiting for Cursor browser creation/,
    )
    await assert.rejects(
      browser.close(),
      /Timed out waiting for owned browser and debugger acquisitions/,
    )
    assert.equal(events.includes('browser.cleanup-verified'), false)
    liveTabs.add('late-owned')
    releaseTab({ success: true, browserId: 'late-owned' })
    await delay(0)
    // Assert
    assert.deepEqual([...liveTabs], [])
    await browser.close()
    assert.equal(
      events.filter((event) => event === 'browser.cleanup-verified').length,
      1,
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('a debugger acquisition deadline cannot certify cleanup while the native launch is still pending', async () => {
  // Arrange
  let releaseDebugger!: (launched: boolean) => void
  const acquisition = new Promise<boolean>((resolve) => {
    releaseDebugger = resolve
  })
  const events: string[] = []
  const HostBrowser = await loadHostBrowser({
    debug: { startDebugging: () => acquisition },
    window: { tabGroups: { all: [] } },
  })
  const browser = new HostBrowser(
    {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    'owned-run',
    'http://127.0.0.1/owned',
    (type) => events.push(type),
    'normal',
  )
  // Act
  await assert.rejects(
    browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    ),
    /Timed out waiting for owned debugger launch/,
  )
  await assert.rejects(
    browser.close(),
    /Timed out waiting for owned browser and debugger acquisitions/,
  )
  // Assert
  assert.equal(events.includes('browser.cleanup-verified'), false)
  releaseDebugger(true)
  await browser.close()
  assert.equal(
    events.filter((event) => event === 'browser.cleanup-verified').length,
    1,
  )
})

test('a pending debugger launch releases the already acquired Cursor tab and bridge before cleanup fails', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-known-tab-'))
  const descriptor = join(directory, 'endpoint.json')
  await writeFile(descriptor, '{"port":9222}')
  const liveTabs = new Set(['unrelated'])
  const events: string[] = []
  const url = 'http://127.0.0.1/owned'
  let releaseDebugger!: (launched: boolean) => void
  const acquisition = new Promise<boolean>((resolve) => {
    releaseDebugger = resolve
  })
  let bridgeClosed = 0
  const HostBrowser = await loadHostBrowser(
    {
      commands: {
        getCommands: async () =>
          ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(
            (name) => `cursor.browserView.${name}`,
          ),
        executeCommand: async (command: string, browserId: string) => {
          if (command.endsWith('newTab')) {
            liveTabs.add('owned')
            return { success: true, browserId: 'owned' }
          }
          if (command.endsWith('closeTab')) {
            liveTabs.delete(browserId)
            return { success: true }
          }
          return { tabs: [...liveTabs] }
        },
      },
      debug: { startDebugging: () => acquisition },
    },
    {
      './cursorCdpBridge': {
        CursorCdpBridge: class {
          async listen() {
            return 9223
          }
          async close(): Promise<void> {
            bridgeClosed++
          }
        },
      },
    },
    {
      fetch: async (address: string) => ({
        ok: true,
        json: async () =>
          address.endsWith('/json/list')
            ? [{ id: 'owned', type: 'webview', url }]
            : {
                webSocketDebuggerUrl:
                  'ws://127.0.0.1:9222/devtools/browser/test',
              },
      }),
    },
  )
  const browser = new HostBrowser(
    {
      id: 'cursor',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
      endpointPath: descriptor,
    },
    'owned-run',
    url,
    (type) => events.push(type),
    'normal',
  )
  try {
    // Act
    await assert.rejects(
      browser.launch(
        { type: 'editor-browser', name: 'owned', request: 'launch' },
        new AbortController().signal,
      ),
      /Timed out waiting for owned debugger launch/,
    )
    await assert.rejects(
      browser.close(),
      /Timed out waiting for owned browser and debugger acquisitions/,
    )
    // Assert
    assert.equal(bridgeClosed, 1)
    assert.deepEqual([...liveTabs], ['unrelated'])
    assert.equal(events.includes('browser.cleanup-verified'), false)
    releaseDebugger(true)
    await browser.close()
    assert.equal(
      events.filter((event) => event === 'browser.cleanup-verified').length,
      1,
    )
  } finally {
    releaseDebugger(true)
    await rm(directory, { recursive: true })
  }
})

// Cycle 0045 (NF-14): red while no ending of a run removed its browser profile folder (28 folders of 3 to 10 MB each on the QA host).
test("a managed browser's profile folder is gone after its run closed, also when the launch was cancelled", async (context) => {
  // Arrange: one launch runs to its debugger, the other is cancelled as soon as its profile folder exists.
  const finished = await managedBrowser(context)
  const cancellation = new AbortController()
  const cancelled = await managedBrowser(context, {
    onEvent: (type) => {
      if (type === 'browser.managed-profile')
        cancellation.abort(new Error('run cancelled'))
    },
  })
  await finished.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  await assert.rejects(
    cancelled.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      cancellation.signal,
    ),
    /run cancelled/,
  )
  const finishedProfile = profileOf(finished.events),
    cancelledProfile = profileOf(cancelled.events)
  const existedBeforeClose = [
    await exists(finishedProfile),
    await exists(cancelledProfile),
  ]
  // Act
  await finished.browser.close()
  await cancelled.browser.close()
  // Assert
  assert.deepEqual(existedBeforeClose, [true, true])
  assert.equal(await exists(finishedProfile), false)
  assert.equal(await exists(cancelledProfile), false)
  assert.deepEqual(
    finished.events.map((event) => event.type),
    [
      'browser.managed-profile',
      'host.debugger-started',
      'browser.managed-exit-verified',
      'browser.managed-profile-removed',
      'browser.cleanup-verified',
    ],
  )
  assert.equal(finished.browser.profileLeft, undefined)
  assert.equal(cancelled.browser.profileLeft, undefined)
})

// Cycle 0045 (NF-14 as ER-11): a folder that stays is a journal entry and a field the run can show, never a failed release.
test("a profile folder that cannot be removed is journaled with its path and the reason, and the browser's cleanup still completes", async (context) => {
  // Arrange: the system refuses the removal of the profile folder.
  const managed = await managedBrowser(context, {
    removeFolder: async (path) => {
      throw Object.assign(
        new Error(`EACCES: permission denied, rmdir '${String(path)}'`),
        { code: 'EACCES' },
      )
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  // Act
  await managed.browser.close()
  // Assert
  assert.deepEqual(managed.events.slice(2), [
    {
      type: 'browser.managed-exit-verified',
      detail: { profile, remainingProcesses: 0 },
    },
    {
      type: 'browser.managed-profile-left',
      detail: {
        profile,
        reason: `Error: EACCES: permission denied, rmdir '${profile}'`,
      },
    },
    {
      type: 'browser.cleanup-verified',
      detail: { host: 'vscode', remainingOwnedTabs: 0 },
    },
  ])
  assert.deepEqual(structuredClone(managed.browser.profileLeft), {
    profile,
    reason: `Error: EACCES: permission denied, rmdir '${profile}'`,
  })
  assert.equal(await exists(profile), true)
})

test('a profile folder that an earlier close had to leave is removed by a later close and is then no longer named', async (context) => {
  // Arrange: the first removal is refused, as while a file of the folder is still busy.
  let isRemovalRefused = true
  const managed = await managedBrowser(context, {
    removeFolder: async (path, removal) => {
      if (isRemovalRefused)
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, rmdir '${String(path)}'`),
          { code: 'EBUSY' },
        )
      return rm(path, removal)
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  await managed.browser.close()
  const leftAfterFirstClose = structuredClone(managed.browser.profileLeft)
  isRemovalRefused = false
  // Act
  await managed.browser.close()
  // Assert
  assert.deepEqual(leftAfterFirstClose, {
    profile,
    reason: `Error: EBUSY: resource busy or locked, rmdir '${profile}'`,
  })
  assert.equal(managed.browser.profileLeft, undefined)
  assert.equal(await exists(profile), false)
})

// Cycle 0045 (NF-14, PC-1.5): a launch that outlived its deadline may still start a browser; its folder must be there for it.
test("a managed profile folder is kept while its debugger launch is still pending, and removed by the close that follows the launch's end", async (context) => {
  // Arrange
  let releaseDebugger!: (launched: boolean) => void
  const acquisition = new Promise<boolean>((resolve) => {
    releaseDebugger = resolve
  })
  const managed = await managedBrowser(context, {
    startDebugging: () => acquisition,
  })
  await assert.rejects(
    managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    ),
    /Timed out waiting for owned debugger launch/,
  )
  const profile = profileOf(managed.events)
  // Act
  await assert.rejects(
    managed.browser.close(),
    /Timed out waiting for owned browser and debugger acquisitions/,
  )
  const existsWhileLaunchIsPending = await exists(profile)
  releaseDebugger(true)
  await managed.browser.close()
  // Assert
  assert.equal(existsWhileLaunchIsPending, true)
  assert.equal(await exists(profile), false)
  assert.equal(
    managed.events.filter(
      (event) => event.type === 'browser.managed-profile-removed',
    ).length,
    1,
  )
})

// Cycle 0045 (NF-14, PC-1.5): the check for profile processes resolves the folder, so it must not run again once the folder is gone.
test('closing a managed browser again after its profile folder was removed succeeds without looking for its processes again', async (context) => {
  // Arrange
  const managed = await managedBrowser(context)
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  await managed.browser.close()
  // Act
  await managed.browser.close()
  // Assert
  assert.deepEqual(managed.processProbes, [profile])
  assert.equal(
    managed.events.filter(
      (event) => event.type === 'browser.managed-profile-removed',
    ).length,
    1,
  )
  assert.equal(
    managed.events.filter((event) => event.type === 'browser.cleanup-verified')
      .length,
    2,
  )
})

// F7, Cycle 0046 /ship review: a managed browser's wait for its profile's processes lists them every 500 ms on Windows, where each listing is a PowerShell scan, and every 50 ms on Linux and macOS.
for (const { system, platform, intervalMs } of [
  { system: 'Windows', platform: 'win32', intervalMs: 500 },
  { system: 'Linux', platform: 'linux', intervalMs: 50 },
] as const)
  // Value: protects=the close of a managed run on Windows, where each look for the browser's processes starts a PowerShell scan of every process (Get-CimInstance Win32_Process, hundreds of milliseconds or more): the looks are spaced 500 ms apart, while Linux and macOS, whose `ps` answers in milliseconds, keep 50 ms (F7, Cycle 0046 /ship review); fails_when=the wait looks again 50 ms after each scan on Windows too, so the scans run nearly back to back for as long as the browser takes to exit; why_new=the wait's interval had no test; seam=the system the adapter reads (`process.platform` of its loaded context), the stand-in for the profile's processes, which counts the looks, and the faked setTimeout of the wait's pause; no_claim=the same interval of attachViewport's wait for the browser's start, which the start-wait rows below cover (TR6)
  test(`on ${system}, the close of a managed browser looks for its profile’s processes again only ${intervalMs} ms after a look that found them`, async (context) => {
    // Arrange: a managed browser whose processes are still there at the first two looks and gone at the third; no sweep of abandoned folders runs. The answer of each look is noted, since the wait's pause starts only once the look has answered.
    let answeredLooks = 0
    const managed = await managedBrowser(context, {
      platform,
      removeAbandonedProfiles: async () => [],
      processesOfProfile: (look) => {
        answeredLooks = look
        return look <= 2
          ? [{ pid: 4242, command: 'chrome --user-data-dir=x' }]
          : []
      },
    })
    await managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    )
    context.mock.timers.enable({ apis: ['setTimeout'] })
    /** Lets real work run (the look's resolve of the folder) until a condition holds, for at most 1,000 real turns, and then one turn more, in which the wait starts its pause after a look's answer. */
    const afterRealTurnsUntil = async (
      reached: () => boolean,
    ): Promise<void> => {
      for (let turn = 0; turn < 1_000 && !reached(); turn += 1)
        await nextEventLoopTurn()
      await nextEventLoopTurn()
    }
    // Act: the close looks once; once that look has answered, the faked clock moves to 1 ms before the interval and then to the interval itself.
    const closing = managed.browser.close()
    await afterRealTurnsUntil(() => answeredLooks >= 1)
    const looksAtFirst = managed.processProbes.length
    context.mock.timers.tick(intervalMs - 1)
    await afterRealTurnsUntil(() => managed.processProbes.length >= 2)
    const looksJustBeforeInterval = managed.processProbes.length
    context.mock.timers.tick(1)
    await afterRealTurnsUntil(() => answeredLooks >= 2)
    const looksAtInterval = managed.processProbes.length
    context.mock.timers.tick(intervalMs)
    await afterRealTurnsUntil(() => answeredLooks >= 3)
    await closing
    // Assert
    assert.deepEqual(
      { looksAtFirst, looksJustBeforeInterval, looksAtInterval },
      { looksAtFirst: 1, looksJustBeforeInterval: 1, looksAtInterval: 2 },
    )
    assert.equal(
      managed.events.some(
        (event) => event.type === 'browser.managed-exit-verified',
      ),
      true,
    )
  })

// TR6, Cycle 0046 repeat testing review: the wait for the owned Chrome's start (attachViewport) lists the processes at the same pace as the close's wait for its exit.
for (const { system, platform, intervalMs } of [
  { system: 'Windows', platform: 'win32', intervalMs: 500 },
  { system: 'Linux', platform: 'linux', intervalMs: 50 },
] as const)
  // Value: protects=the start of a managed run on Windows, where each look for the owned Chrome's processes starts a PowerShell scan of every process: the wait for the browser's start looks again only 500 ms after a look that found nothing, while Linux and macOS keep 50 ms (F7); fails_when=attachViewport's wait drops its interval and looks again 50 ms after each scan on Windows too; why_new=TR6, Cycle 0046 repeat testing review (only the close's wait had a test); seam=the system the adapter reads (`process.platform` of its loaded context), the stand-in for the profile's processes, which counts the looks and finds the browser at the second, the viewport's stand-in, which attaches at once, a CDP stand-in that answers the version, and the faked setTimeout of the wait's pause
  test(`on ${system}, the wait for a managed browser's start looks for its profile’s processes again only ${intervalMs} ms after a look that found none`, async (context) => {
    // Arrange: a launched managed browser whose processes appear at the second look and are gone again from the third, so its close ends at once; no sweep of abandoned folders runs. The answer of each look is noted, since the wait's pause starts only once the look has answered.
    let answeredLooks = 0
    const managed = await managedBrowser(context, {
      platform,
      removeAbandonedProfiles: async () => [],
      processesOfProfile: (look) => {
        answeredLooks = look
        return look === 2
          ? [
              {
                pid: 4242,
                command: 'chrome --remote-debugging-pipe --user-data-dir=x',
              },
            ]
          : []
      },
    })
    await managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    )
    /** A connection whose browser answers every request with its version at once. */
    class AnsweringSocket extends EventTarget {
      send(message: string): void {
        const request = JSON.parse(message)
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              id: request.id,
              result: { product: 'Chrome/test' },
            }),
          }),
        )
      }
      close(): void {
        this.dispatchEvent(new Event('close'))
      }
    }
    const cdp = new Cdp(new AnsweringSocket(), () => undefined)
    context.mock.timers.enable({ apis: ['setTimeout'] })
    /** Lets real work run (the look's resolve of the folder) until a condition holds, for at most 1,000 real turns, and then one turn more, in which the wait starts its pause after a look's answer. */
    const afterRealTurnsUntil = async (
      reached: () => boolean,
    ): Promise<void> => {
      for (let turn = 0; turn < 1_000 && !reached(); turn += 1)
        await nextEventLoopTurn()
      await nextEventLoopTurn()
    }
    // Act: the start wait looks once; once that look has answered, the faked clock moves to 1 ms before the interval and then to the interval itself.
    const attaching = managed.browser.attachViewport(
      cdp,
      new AbortController().signal,
    )
    await afterRealTurnsUntil(() => answeredLooks >= 1)
    const looksAtFirst = managed.processProbes.length
    context.mock.timers.tick(intervalMs - 1)
    await afterRealTurnsUntil(() => managed.processProbes.length >= 2)
    const looksJustBeforeInterval = managed.processProbes.length
    context.mock.timers.tick(1)
    await afterRealTurnsUntil(() => answeredLooks >= 2)
    const looksAtInterval = managed.processProbes.length
    await attaching
    await managed.browser.close()
    // Assert
    assert.deepEqual(
      {
        looksAtFirst,
        looksJustBeforeInterval,
        looksAtInterval,
        processesJournaled: managed.events.some(
          (event) => event.type === 'browser.managed-processes',
        ),
      },
      {
        looksAtFirst: 1,
        looksJustBeforeInterval: 1,
        looksAtInterval: 2,
        processesJournaled: true,
      },
    )
  })

// Value: protects=the profiles of a managed run on Windows, which has no user id to tell another user's folder by: the browser creates its profile folder below the user's own local application data folder (made at the first run), which no other user can open and no TEMP setting moves, its sweep of abandoned folders looks there, and its marker names the operating-system user, whose sweep alone judges it (SC3, Cycle 0046 repeat review; CX7, /ship Codex adversarial review); fails_when=the profile root is `<drive>:\tmp`, a folder every user may change, or the user's TEMP, which an administrator may point at a folder several users share, or the marker names no user, so another user's sweep judges it; why_new=every managed-browser test named a root of its own; seam=the system the adapter reads (`process.platform` of its loaded context), its local application data folder (`LOCALAPPDATA` of that context, the test's root) beside a home and a temp folder not to use, the browser given no root of its own, and the sweep's stand-in, which notes the root it is asked to sweep
test('on Windows a managed browser creates its profile folder below the user’s local application data folder, sweeps abandoned folders there, and names the user in its marker', async (context) => {
  // Arrange: a managed browser on Windows whose local application data folder is the test's root and which is given no profile root.
  const sweptRoots: string[] = []
  const managed = await managedBrowser(context, {
    platform: 'win32',
    rootChosenByTheBrowser: true,
    removeAbandonedProfiles: async (root) => {
      sweptRoots.push(root)
      return []
    },
  })
  // Act
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  const marker: unknown = JSON.parse(
    await readFile(join(profile, 'codebook-owner.json'), 'utf8'),
  )
  await managed.browser.close()
  // Assert
  const profileRoot = join(managed.root, 'Codebook', 'browser-profiles')
  assert.deepEqual(
    {
      profileFolderIn: dirname(profile),
      sweptRoots,
      markerUser:
        typeof marker === 'object' && marker !== null && 'user' in marker
          ? marker.user
          : undefined,
    },
    {
      profileFolderIn: profileRoot,
      sweptRoots: [profileRoot],
      markerUser: os.userInfo().username,
    },
  )
})

// Cycle 0045 (NF-14 as ER-11): only a folder that carries a marker whose editor is gone is Codebook's to remove.
test('a marked profile folder whose editor was killed is removed by the next run, and a folder without a marker is left', async (context) => {
  // Arrange: three folders lie in the profile root when the next run starts. The killed editor's marker names an id no process can have: the id of a child that just exited could be given to another process before the sweep judges it.
  const cancellation = new AbortController()
  const managed = await managedBrowser(context, {
    onEvent: (type) => {
      if (type === 'browser.managed-profile')
        cancellation.abort(new Error('run cancelled'))
    },
  })
  const ofKilledEditor = join(managed.root, 'codebook-browser-killed'),
    ofRunningEditor = join(managed.root, 'codebook-browser-running'),
    withoutMarker = join(managed.root, 'codebook-browser-unmarked')
  for (const folder of [ofKilledEditor, ofRunningEditor, withoutMarker]) {
    await mkdir(join(folder, 'Default'), { recursive: true })
    await writeFile(join(folder, 'Default', 'Preferences'), '{}')
  }
  await writeFile(
    join(ofKilledEditor, 'codebook-owner.json'),
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: hostname() }),
  )
  await writeFile(
    join(ofRunningEditor, 'codebook-owner.json'),
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
  // Act: the sweep the launch started has ended once the run's close has.
  await assert.rejects(
    managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      cancellation.signal,
    ),
    /run cancelled/,
  )
  const ownMarker: unknown = JSON.parse(
    await readFile(
      join(profileOf(managed.events), 'codebook-owner.json'),
      'utf8',
    ),
  )
  await managed.browser.close()
  // Assert
  assert.equal(await exists(ofKilledEditor), false)
  assert.equal(await exists(ofRunningEditor), true)
  assert.equal(await exists(withoutMarker), true)
  assert.deepEqual(
    managed.events.filter(
      (event) => event.type === 'browser.abandoned-profiles-removed',
    ),
    [
      {
        type: 'browser.abandoned-profiles-removed',
        detail: { profiles: [ofKilledEditor] },
      },
    ],
  )
  assert.ok(ownMarker && typeof ownMarker === 'object')
  assert.deepEqual(
    'pid' in ownMarker && 'hostname' in ownMarker
      ? { pid: ownMarker.pid, hostname: ownMarker.hostname }
      : ownMarker,
    { pid: process.pid, hostname: hostname() },
  )
})

// Value: protects=the first run after crashes starts its browser without waiting for the removal of the profile folders killed editors left (Cycle 0045 review PL-6); fails_when=the launch awaits the sweep (the awaited launch then never ends and the test runs into its time limit), or the run's close does not wait for it, so the sweep outlives the run; why_new=the sweep was awaited inside the launch until Cycle 0046, and the first form of this test decided both claims by races against the wall clock (Cycle 0046 row 97); seam=the sweep, which the test holds until it releases it, the adapter's folder removal, which only notes the folder, and the journal, whose entry for the verified browser exit says that the close has reached its wait for the sweep
test('a managed launch starts its debugger while the sweep of abandoned profile folders still runs, and the run’s close waits for that sweep', async (context) => {
  // Arrange: a sweep that ends only when the test releases it. The removal of the run's own folder does no file work, so a close that did not wait for the sweep would end without leaving its turn of the event loop.
  let releaseSweep!: (removed: string[]) => void
  const sweep = new Promise<string[]>((resolve) => {
    releaseSweep = resolve
  })
  let reportBrowserExitVerified!: () => void
  const browserExitVerified = new Promise<void>((resolve) => {
    reportBrowserExitVerified = resolve
  })
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: () => sweep,
    removeFolder: async () => undefined,
    onEvent: (type) => {
      if (type === 'browser.managed-exit-verified') reportBrowserExitVerified()
    },
  })
  // Act: the launch is awaited while the sweep is held. The close is started and followed up to the step before its wait for the sweep, and then for one more turn of the event loop.
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const journalAfterLaunch = managed.events.map((event) => event.type)
  let hasCloseSettled = false
  const closing = managed.browser.close().then(() => {
    hasCloseSettled = true
  })
  await browserExitVerified
  await nextEventLoopTurn()
  const hadCloseSettledBeforeSweepEnded = hasCloseSettled
  releaseSweep(['/profile-root/codebook-browser-killed'])
  await closing
  // Assert
  assert.deepEqual(journalAfterLaunch, [
    'browser.managed-profile',
    'host.debugger-started',
  ])
  assert.equal(hadCloseSettledBeforeSweepEnded, false)
  assert.equal(hasCloseSettled, true)
  assert.deepEqual(
    managed.events.map((event) => event.type),
    [
      'browser.managed-profile',
      'host.debugger-started',
      'browser.managed-exit-verified',
      'browser.abandoned-profiles-removed',
      'browser.managed-profile-removed',
      'browser.cleanup-verified',
    ],
  )
})

// Value: protects=a managed launch that was cancelled while it read its owner removes no folder of a killed editor; fails_when=the sweep is started before the launch looks at its signal again, so a cancelled launch still starts up to 64 folder removals (Cycle 0046 row 98); why_new=no test cancelled a launch before its sweep; seam=the read of the storage owner, which the test holds, and the sweep, which counts its starts
test('a managed launch cancelled while it reads its owner starts no sweep of abandoned profile folders', async (context) => {
  // Arrange: the read of the owner ends only when the test releases it.
  let releaseOwner!: (owner: { hostname: string }) => void
  const ownerRead = new Promise<{ hostname: string }>((resolve) => {
    releaseOwner = resolve
  })
  let reportOwnerAsked!: () => void
  const ownerAsked = new Promise<void>((resolve) => {
    reportOwnerAsked = resolve
  })
  let sweepsStarted = 0
  const managed = await managedBrowser(context, {
    currentStorageOwner: () => {
      reportOwnerAsked()
      return ownerRead
    },
    removeAbandonedProfiles: async () => {
      sweepsStarted += 1
      return []
    },
  })
  const cancellation = new AbortController()
  // Act: the run is cancelled while the launch waits for its owner.
  const launch = managed.browser
    .launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      cancellation.signal,
    )
    .then(
      () => 'launched',
      (error: unknown) => String(error),
    )
  await ownerAsked
  cancellation.abort(new Error('run cancelled'))
  releaseOwner({ hostname: hostname() })
  const launchOutcome = await launch
  await managed.browser.close()
  // Assert
  assert.equal(launchOutcome, 'Error: run cancelled')
  assert.equal(sweepsStarted, 0)
  assert.deepEqual(
    managed.events.map((event) => event.type),
    ['browser.cleanup-verified'],
  )
})

// Value: protects=no sweep of abandoned profile folders outlives the close of its run; fails_when=a launch that reaches its sweep after the browser's close ran starts one, which no close waits for any more (Cycle 0046 row 98); why_new=no test closed a browser before its launch reached the sweep; seam=the read of the storage owner, which the test holds, and the sweep, which counts its starts
test('closing a managed browser before its owner is read prevents a later sweep or browser creation', async (context) => {
  // Arrange: the read of the owner ends only when the test releases it.
  let releaseOwner!: (owner: { hostname: string }) => void
  const ownerRead = new Promise<{ hostname: string }>((resolve) => {
    releaseOwner = resolve
  })
  let reportOwnerAsked!: () => void
  const ownerAsked = new Promise<void>((resolve) => {
    reportOwnerAsked = resolve
  })
  let sweepsStarted = 0
  const managed = await managedBrowser(context, {
    currentStorageOwner: () => {
      reportOwnerAsked()
      return ownerRead
    },
    removeAbandonedProfiles: async () => {
      sweepsStarted += 1
      return []
    },
  })
  // Act: Close retires the pending launch even when its external signal was not cancelled.
  const launch = managed.browser
    .launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    )
    .then(
      () => 'launched',
      (error: unknown) => String(error),
    )
  await ownerAsked
  await managed.browser.close()
  releaseOwner({ hostname: hostname() })
  const launchOutcome = await launch
  await managed.browser.close()
  // Assert
  assert.equal(launchOutcome, 'Error: Owned browser is closing')
  assert.equal(sweepsStarted, 0)
  assert.deepEqual(
    managed.events.map((event) => event.type),
    ['browser.cleanup-verified', 'browser.cleanup-verified'],
  )
})

// Value: protects=a sweep of abandoned profile folders that fails in a way it did not expect neither fails the run's cleanup nor leaves a rejected promise nobody handles (Cycle 0045 review PL-6); fails_when=the launch keeps the sweep's promise without a handler, so its rejection is unhandled and the close reports an incomplete cleanup; why_new=the sweep runs beside the launch since Cycle 0046; seam=the sweep, which rejects
test('a sweep of abandoned profile folders that fails leaves the launch and the run’s close complete', async (context) => {
  // Arrange
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: async () => {
      throw new Error('EIO: i/o error, scandir')
    },
  })
  // Act
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const close = await managed.browser.close().then(
    () => 'closed',
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(close, 'closed')
  assert.deepEqual(
    managed.events.map((event) => event.type),
    [
      'browser.managed-profile',
      'host.debugger-started',
      'browser.managed-exit-verified',
      'browser.managed-profile-removed',
      'browser.cleanup-verified',
    ],
  )
})
