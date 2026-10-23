import assert from 'node:assert/strict'
import fsPromises, {
  chmod,
  readFile,
  readdir,
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
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  setImmediate as nextEventLoopTurn,
  setTimeout as delay,
} from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

import type { BrowserViewportFactory } from '../runtimeSupport/browserViewport'
import { Cdp } from '../runtimeSupport/cdp'
import * as runtimeConstants from '../runtimeSupport/constants'
import type * as HostModule from '../runtimeSupport/hostBrowser'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'

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
      AbortController,
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
 * @param options.removeFolder - Stands in for the adapter's folder removal ({@link removeWithoutFollowing}, which the close and the launch call); the real one by default.
 * @param options.removeAbandonedProfiles - Stands in for the sweep of the profile folders a killed editor left; the real one by default.
 * @param options.currentStorageOwner - Stands in for the read of this process's machine, boot and start, for a test that holds it; the real one by default.
 * @param options.createViewport - Holds or rejects the real factory boundary while the test observes launch and cleanup ordering.
 * @param options.platform - The system the adapter reads from `process.platform`; this machine's by default.
 * @param options.processesOfProfile - The processes a look for the profile finds, by the look's number (1 for the first); none by default.
 * @param options.realpathOfProfileFails - Makes `realpath` of the loaded browser refuse every profile folder (`EISDIR`), as the system does on some Windows volumes; the refused paths are noted in `refusedRealpaths`.
 * @param options.ownerMarkerWriteFails - Makes the loaded browser's write of an owner marker fail (`EACCES`), as on a volume that refuses new files.
 * @param options.activeTimeoutMs - The bound of the adapter's waits (`ACTIVE_TIMEOUT_MS` of its constants), for a test whose real wait must reach it; 20 s by default.
 * @param options.rootChosenByTheBrowser - Gives the browser no profile root, so it chooses its own as the product does (managedProfileRoot): its loaded context reads `LOCALAPPDATA` as the test's root then, and answers a home folder and a temp folder (`os.homedir`, `os.tmpdir`) that no system's root may be taken from. By default the browser is given the test's root.
 * @returns The browser, its root, every journal entry as plain data, every profile whose processes were asked for, the paths `realpath` refused, and `laterRun`, which makes the browser of a later run of the same editor (the same loaded adapter and root, a journal of its own). A profile's processes are looked up like the real utility does it: the folder is resolved first, which fails once it is gone, and the processes `options.processesOfProfile` names are found.
 * @example
 * const managed = await managedBrowser(context)
 * await managed.browser.launch(configuration, signal); await managed.browser.close() // managed.events names browser.managed-profile-removed
 */
async function managedBrowser(
  context: TestContext,
  options: {
    startDebugging?: (
      folder: unknown,
      configuration: { runtimeArgs?: string[] },
    ) => Promise<boolean>
    onEvent?: (type: string) => void
    removeFolder?: typeof removeWithoutFollowing
    removeAbandonedProfiles?: (root: string) => Promise<string[]>
    currentStorageOwner?: () => Promise<{ hostname: string }>
    createViewport?: BrowserViewportFactory
    platform?: NodeJS.Platform
    processesOfProfile?: (look: number) => { pid: number; command: string }[]
    rootChosenByTheBrowser?: boolean
    realpathOfProfileFails?: boolean
    ownerMarkerWriteFails?: boolean
    activeTimeoutMs?: number
  } = {},
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-root-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  const events: { type: string; detail: unknown }[] = [],
    processProbes: string[] = [],
    refusedRealpaths: string[] = []
  const HostBrowser = await loadHostBrowser(
    {
      debug: { startDebugging: options.startDebugging ?? (async () => true) },
      window: { tabGroups: { all: [] } },
    },
    {
      ...(options.removeFolder && {
        '../utils/removeWithoutFollowing': {
          removeWithoutFollowing: options.removeFolder,
        },
      }),
      'node:fs/promises': {
        ...fsPromises,
        // The adapter writes one file, the owner marker, as text.
        writeFile: async (path: string, text: string): Promise<void> => {
          if (
            options.ownerMarkerWriteFails &&
            basename(path) === 'codebook-owner.json'
          )
            throw Object.assign(
              new Error(`EACCES: permission denied, open '${path}'`),
              { code: 'EACCES' },
            )
          return writeFile(path, text)
        },
        realpath: async (path: string): Promise<string> => {
          // A volume whose real paths the system cannot read refuses the new profile folder.
          if (
            options.realpathOfProfileFails &&
            basename(path).startsWith('codebook-browser-')
          ) {
            refusedRealpaths.push(path)
            throw Object.assign(
              new Error(
                `EISDIR: illegal operation on a directory, realpath '${path}'`,
              ),
              { code: 'EISDIR' },
            )
          }
          return realpath(path)
        },
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
      ...(options.activeTimeoutMs !== undefined && {
        './constants': {
          ...runtimeConstants,
          ACTIVE_TIMEOUT_MS: options.activeTimeoutMs,
        },
      }),
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
  /** Makes a managed browser of the loaded adapter that journals into the given list; a later run of the same editor is another one of the same adapter. */
  const browserJournalingInto = (
    journal: { type: string; detail: unknown }[],
  ) =>
    new HostBrowser(
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
        journal.push({
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
  const browser = browserJournalingInto(events)
  /** Makes the browser of a later run in the same editor: the same loaded adapter and root, a journal of its own. */
  const laterRun = () => {
    const laterEvents: { type: string; detail: unknown }[] = []
    return { browser: browserJournalingInto(laterEvents), events: laterEvents }
  }
  return { browser, root, events, processProbes, refusedRealpaths, laterRun }
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

// Value: protects=the profile folder of a run whose close cannot remove every file in it (on Windows Chrome may still hold a file, and since AD22 the close also removes the folder when the browser's exit could not be checked, as on every close where PowerShell is blocked): the close removes the folder's other entries first and its owner marker last, so a folder that stays keeps its marker and a later sweep removes it once the file is free (R6, /ship third review, Claude adversarial #6); fails_when=the close removes the folder by the recursive rm of Node.js, which removes the marker beside the entry that refuses, so the folder stays without a marker and every later sweep passes over it for good; why_new=every close test whose removal failed stood in for the whole removal; seam=the real removal over a folder `Default` without write permission (a file in it cannot be unlinked), and the sweep's stand-in, which ends at once
test(
  'a managed close whose removal stops at a file it cannot remove keeps the owner marker in the folder it journals as left',
  {
    skip:
      (process.platform === 'win32' &&
        'Windows lets the owner remove a file of a folder without write permission') ||
      (process.getuid?.() === 0 &&
        'root removes a file of a folder without write permission'),
  },
  async (context) => {
    // Arrange: a launched browser whose profile holds a file in a folder this user may not change.
    const managed = await managedBrowser(context, {
      removeAbandonedProfiles: async () => [],
    })
    await managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    )
    const profile = profileOf(managed.events)
    const browserFolder = join(profile, 'Default')
    await mkdir(browserFolder)
    await writeFile(join(browserFolder, 'Preferences'), '{}')
    await chmod(browserFolder, 0o500)
    try {
      // Act
      await managed.browser.close()
      // Assert
      assert.deepEqual(
        {
          left: (await readdir(profile)).toSorted(),
          journal: managed.events.map((event) => event.type),
          profileLeft: managed.browser.profileLeft?.profile,
        },
        {
          left: ['Default', 'codebook-owner.json'],
          journal: [
            'browser.managed-profile',
            'host.debugger-started',
            'browser.managed-exit-verified',
            'browser.managed-profile-left',
            'browser.cleanup-verified',
          ],
          profileLeft: profile,
        },
      )
    } finally {
      // The root is removed after the test; its folders must be changeable again.
      await chmod(browserFolder, 0o700)
    }
  },
)

// Value: protects=the profile folder of a run on Windows, which still holds a file of the ended browser for a moment: the close tries the removal again after a busy answer, as the recursive rm of Node.js did with its retries, and removes the folder (R6, /ship third review); fails_when=the close's removal gives up at the first busy answer, so every such run leaves its folder for a later sweep; why_new=the close's removal moved from rm to removeWithoutFollowing, which has no retries of its own; seam=the adapter's folder removal, which answers busy once and then removes the folder for real
test('a managed close whose removal the system answers as busy once removes the folder at its retry', async (context) => {
  // Arrange
  let removals = 0
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: async () => [],
    removeFolder: async (path, order) => {
      removals += 1
      if (removals === 1)
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, rmdir '${String(path)}'`),
          { code: 'EBUSY' },
        )
      return removeWithoutFollowing(path, order)
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
  assert.deepEqual(
    {
      removals,
      exists: await exists(profile),
      profileLeft: managed.browser.profileLeft,
    },
    { removals: 2, exists: false, profileLeft: undefined },
  )
})

test('a profile folder that an earlier close had to leave is removed by a later close and is then no longer named', async (context) => {
  // Arrange: the first removal is refused, as while a file of the folder is still busy.
  let isRemovalRefused = true
  const managed = await managedBrowser(context, {
    removeFolder: async (path, order) => {
      if (isRemovalRefused)
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, rmdir '${String(path)}'`),
          { code: 'EBUSY' },
        )
      return removeWithoutFollowing(path, order)
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
  // Value: protects=the close of a managed run on Windows, where each look for the browser's processes starts a PowerShell scan of every process (Get-CimInstance Win32_Process, hundreds of milliseconds or more): the looks are spaced 500 ms apart, while Linux and macOS, whose `ps` answers in milliseconds, keep 50 ms (F7, Cycle 0046 /ship review); fails_when=the wait looks again 50 ms after each scan on Windows too, so the scans run nearly back to back for as long as the browser takes to exit; why_new=the wait's interval had no test; its first form gave each look's real file work a count of event-loop turns and hung under load (FL3); seam=the system the adapter reads (`process.platform` of its loaded context), the stand-in for the profile's processes, which counts the looks and says when each has answered, and the faked setTimeout of the wait's pause; no_claim=the same interval of attachViewport's wait for the browser's start, which the start-wait rows below cover (TR6)
  test(`on ${system}, the close of a managed browser looks for its profile’s processes again only ${intervalMs} ms after a look that found them`, async (context) => {
    // Arrange: a managed browser whose processes are still there at the first two looks and gone at the third; no sweep of abandoned folders runs. Each look's answer resolves a promise of its own: a look resolves the folder with real file work first, and the wait's pause starts only once the look has answered.
    const noteAnswerOfLook: (() => void)[] = []
    const [firstLookAnswered, secondLookAnswered] = [0, 1].map(
      (index) =>
        new Promise<void>((resolve) => {
          noteAnswerOfLook[index] = resolve
        }),
    )
    const managed = await managedBrowser(context, {
      platform,
      removeAbandonedProfiles: async () => [],
      processesOfProfile: (look) => {
        noteAnswerOfLook[look - 1]?.()
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
    // Act: the close looks once; one turn after that look's answer the wait has started its pause, and the faked clock moves to 1 ms before the interval and then to the interval itself. A look is counted when it starts, in the turn its pause ends, before its file work. A close that ends without a look also ends the first wait.
    const closing = managed.browser.close()
    await Promise.race([firstLookAnswered, closing])
    await nextEventLoopTurn()
    const looksAtFirst = managed.processProbes.length
    context.mock.timers.tick(intervalMs - 1)
    await nextEventLoopTurn()
    const looksJustBeforeInterval = managed.processProbes.length
    context.mock.timers.tick(1)
    await nextEventLoopTurn()
    const looksAtInterval = managed.processProbes.length
    // Assert: the looks are judged before the close is awaited, so a wait that does not look again at its interval fails the test instead of holding it.
    assert.deepEqual(
      { looksAtFirst, looksJustBeforeInterval, looksAtInterval },
      { looksAtFirst: 1, looksJustBeforeInterval: 1, looksAtInterval: 2 },
    )
    // The second look still finds the processes; the third, one interval after its answer, finds them gone and ends the wait.
    await secondLookAnswered
    await nextEventLoopTurn()
    context.mock.timers.tick(intervalMs)
    await nextEventLoopTurn()
    assert.equal(managed.processProbes.length, 3)
    await closing
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
  // Value: protects=the start of a managed run on Windows, where each look for the owned Chrome's processes starts a PowerShell scan of every process: the wait for the browser's start looks again only 500 ms after a look that found nothing, while Linux and macOS keep 50 ms (F7); fails_when=attachViewport's wait drops its interval and looks again 50 ms after each scan on Windows too; why_new=TR6, Cycle 0046 repeat testing review (only the close's wait had a test); its first form gave each look's real file work a count of event-loop turns and hung under load (FL3); seam=the system the adapter reads (`process.platform` of its loaded context), the stand-in for the profile's processes, which counts the looks, says when the first has answered and finds the browser at the second, the viewport's stand-in, which attaches at once, a CDP stand-in that answers the version, and the faked setTimeout of the wait's pause
  test(`on ${system}, the wait for a managed browser's start looks for its profile’s processes again only ${intervalMs} ms after a look that found none`, async (context) => {
    // Arrange: a launched managed browser whose processes appear at the second look and are gone again from the third, so its close ends at once; no sweep of abandoned folders runs. The first look's answer resolves a promise: a look resolves the folder with real file work first, and the wait's pause starts only once the look has answered.
    let noteFirstAnswer!: () => void
    const firstLookAnswered = new Promise<void>((resolve) => {
      noteFirstAnswer = resolve
    })
    const managed = await managedBrowser(context, {
      platform,
      removeAbandonedProfiles: async () => [],
      processesOfProfile: (look) => {
        if (look === 1) noteFirstAnswer()
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
    // Act: the start wait looks once; one turn after that look's answer the wait has started its pause, and the faked clock moves to 1 ms before the interval and then to the interval itself. A look is counted when it starts, in the turn its pause ends, before its file work. A start that ends without a look also ends the first wait.
    const attaching = managed.browser.attachViewport(
      cdp,
      new AbortController().signal,
    )
    await Promise.race([firstLookAnswered, attaching])
    await nextEventLoopTurn()
    const looksAtFirst = managed.processProbes.length
    context.mock.timers.tick(intervalMs - 1)
    await nextEventLoopTurn()
    const looksJustBeforeInterval = managed.processProbes.length
    context.mock.timers.tick(1)
    await nextEventLoopTurn()
    const looksAtInterval = managed.processProbes.length
    // Assert: the looks are judged before the start is awaited, so a wait that does not look again at its interval fails the test instead of holding it.
    assert.deepEqual(
      { looksAtFirst, looksJustBeforeInterval, looksAtInterval },
      { looksAtFirst: 1, looksJustBeforeInterval: 1, looksAtInterval: 2 },
    )
    // The second look finds the browser and ends the start's wait; the close's look finds it gone.
    await attaching
    await managed.browser.close()
    assert.equal(
      managed.events.some(
        (event) => event.type === 'browser.managed-processes',
      ),
      true,
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

// Value: protects=the short, fixed /tmp of a managed run on macOS (and Linux), which Chrome and the debugger resolve: a browser given no root creates its profile folder there and sweeps abandoned folders there, not in the user's long temp folder (/var/folders/… on macOS) nor in a Windows root (TC6, Cycle 0046 repeat testing review); fails_when=the browser's root ignores the system it runs on (a call site that names 'win32'), so macOS and Linux put profiles below the user's folders; why_new=only the Windows row reached the browser's own choice of root; seam=the system the adapter reads (`process.platform` of its loaded context), a home folder, a temp folder and a local application data folder of that context that must not be used, the browser given no root of its own, and the sweep's stand-in, which notes the root it is asked to sweep; no_claim=the real macOS, where /tmp resolves to /private/tmp, which the expected value reads
test(
  'on macOS a managed browser creates its profile folder in /tmp and sweeps abandoned folders there, not in the user’s long temp folder',
  { skip: process.platform === 'win32' && 'the row creates a folder in /tmp' },
  async (context) => {
    // Arrange: a managed browser on macOS, given no profile root, whose loaded context answers a long temp folder that must not be used.
    const sweptRoots: string[] = []
    const managed = await managedBrowser(context, {
      platform: 'darwin',
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
    await managed.browser.close()
    // Assert
    assert.deepEqual(
      { profileFolderIn: dirname(profile), sweptRoots },
      { profileFolderIn: await realpath('/tmp'), sweptRoots: ['/tmp'] },
    )
  },
)

// Value: protects=the profile root of a machine whose volume the system cannot resolve a path on (a Windows RAM disk, a `subst` or a network drive): a managed launch whose new profile folder has no readable real path removes that folder again at once and fails with a sentence that names it, so no unmarked folder is left that neither the close nor a later sweep would ever remove (AD24, /ship adversarial review Step 11); fails_when=the launch fails with the raw error of `realpath` and leaves the folder it just made, without its marker; why_new=every launch test resolved its folder; seam=the managedBrowser harness's `realpath` of the loaded browser, which refuses the new profile folder and notes it, and the sweep's stand-in
test('a managed launch whose new profile folder cannot be resolved removes that folder again and fails with a sentence that names it', async (context) => {
  // Arrange: a managed browser on a volume whose real paths the system cannot read.
  const managed = await managedBrowser(context, {
    realpathOfProfileFails: true,
    removeAbandonedProfiles: async () => [],
  })
  // Act
  const failure = await managed.browser
    .launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      new AbortController().signal,
    )
    .then(
      () => undefined,
      (error: Error) => error.message,
    )
  await managed.browser.close()
  // Assert
  const refused = managed.refusedRealpaths[0]
  assert.deepEqual(
    { failure, leftInTheRoot: await readdir(managed.root) },
    {
      failure: `The managed browser's profile folder ${refused} could not be resolved, so it was removed again and the browser was not started: Error: EISDIR: illegal operation on a directory, realpath '${refused}'`,
      leftInTheRoot: [],
    },
  )
})

// Value: protects=the profile root of such a machine when the folder cannot be removed either (on Windows a file lock, EPERM): the launch says so instead of saying it removed the folder, and marks the folder by the path it was made at, so a later sweep removes it once this editor has ended; when the marker cannot be written either, the sentence says that no later run removes it (R4 and R9, /ship third review and its maintainability review); fails_when=the launch drops the removal's error and reports a removal that did not happen, and leaves the folder without a marker, which neither the close nor a later sweep removes; why_new=the AD24 test's removal succeeded; seam=the harness's `realpath`, which refuses the new profile folder, the adapter's folder removal, which fails with EPERM, the write of the owner marker, which fails for the second browser, and the sweep's stand-in
test('a managed launch whose unresolved profile folder cannot be removed either marks it by the path it was made at and says so, or says that it stays unmarked', async (context) => {
  // Arrange: two browsers on such a volume whose removal fails; the second cannot write a marker either.
  const refusedRemoval = async (path: string): Promise<void> => {
    throw Object.assign(
      new Error(`EPERM: operation not permitted, rmdir '${path}'`),
      { code: 'EPERM' },
    )
  }
  const marked = await managedBrowser(context, {
    realpathOfProfileFails: true,
    removeFolder: refusedRemoval,
    removeAbandonedProfiles: async () => [],
  })
  const unmarked = await managedBrowser(context, {
    realpathOfProfileFails: true,
    removeFolder: refusedRemoval,
    ownerMarkerWriteFails: true,
    removeAbandonedProfiles: async () => [],
  })
  const launch = (browser: typeof marked.browser) =>
    browser
      .launch(
        { type: 'editor-browser', name: 'owned', request: 'launch' },
        new AbortController().signal,
      )
      .then(
        () => undefined,
        (error: Error) => error.message,
      )
  // Act
  const failures = {
    marked: await launch(marked.browser),
    unmarked: await launch(unmarked.browser),
  }
  // Assert
  const [markedFolder] = marked.refusedRealpaths,
    [unmarkedFolder] = unmarked.refusedRealpaths
  const marker = JSON.parse(
    await readFile(join(markedFolder!, 'codebook-owner.json'), 'utf8'),
  )
  assert.deepEqual(
    {
      failures,
      markerNames: { pid: marker.pid, hostname: marker.hostname },
      unmarkedHolds: await readdir(unmarkedFolder!),
    },
    {
      failures: {
        marked: `The managed browser's profile folder ${markedFolder} could not be resolved and could not be removed (Error: EPERM: operation not permitted, rmdir '${markedFolder}'); it stays, marked as this editor's, so a later run removes it once this editor has ended, and the browser was not started: Error: EISDIR: illegal operation on a directory, realpath '${markedFolder}'`,
        unmarked: `The managed browser's profile folder ${unmarkedFolder} could not be resolved, could not be removed (Error: EPERM: operation not permitted, rmdir '${unmarkedFolder}') and could not be marked (Error: EACCES: permission denied, open '${join(unmarkedFolder!, 'codebook-owner.json')}'), so no later run removes it: remove it by hand. The browser was not started: Error: EISDIR: illegal operation on a directory, realpath '${unmarkedFolder}'`,
      },
      markerNames: { pid: process.pid, hostname: hostname() },
      unmarkedHolds: [],
    },
  )
})

// Value: protects=the live profile of a run whose Chrome does not exit: the close's wait for the profile's processes ends at its bound with the processes still there, which is a failed release, so the close fails as an incomplete cleanup and keeps the folder a running Chrome still uses (AD22's other branch; TT9, the third testing review); fails_when=the wait's timeout is taken like a failed listing, journaled as an unverified exit, and the running browser's folder removed with cleanup-verified; why_new=every close test let the processes exit or the listing fail; seam=the stand-in for the profile's processes, which finds the browser at every look, the bound of the adapter's waits (ACTIVE_TIMEOUT_MS of its constants), cut to 100 ms so that the real wait reaches it, and the sweep's stand-in, which ends at once
test('a managed close whose browser never exits fails as an incomplete cleanup at the wait’s bound and keeps the profile folder', async (context) => {
  // Arrange: a launched managed browser whose Chrome is found at every look.
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: async () => [],
    processesOfProfile: () => [
      { pid: 4242, command: 'chrome --user-data-dir=x' },
    ],
    activeTimeoutMs: 100,
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  // Act
  const failure = await managed.browser.close().then(
    () => 'closed',
    (error: Error) => error.message,
  )
  // Assert
  assert.deepEqual(
    {
      failure,
      folderKept: await exists(profile),
      journal: managed.events.map((event) => event.type),
    },
    {
      failure:
        'Browser cleanup incomplete: owned Chrome process exit: Error: Timed out waiting for owned Chrome profile processes exited',
      folderKept: true,
      journal: ['browser.managed-profile', 'host.debugger-started'],
    },
  )
})

// Value: protects=the run's own profile folder on a machine where the process listing fails (PowerShell refused, a listing that runs past its bound): the close cannot verify the browser's exit, journals that it is unverified with the reason, and still removes the folder this run made and completes, so no folder is left that no later close or sweep (both need the listing) would remove (AD22, /ship adversarial review Step 11); fails_when=a failed listing fails the close's exit step, so the close ends as an incomplete cleanup before its removal and the folder stays for good; why_new=every close test listed the processes; seam=the stand-in for the profile's processes, which fails as a listing that ran past its bound fails
test('a managed close whose process listing fails journals the exit as unverified, still removes its profile folder, and completes', async (context) => {
  // Arrange: a launched managed browser whose process listing fails at the close.
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: async () => [],
    processesOfProfile: () => {
      throw new Error(
        'The process listing (/bin/ps) did not answer within 10000 ms and was ended.',
      )
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const profile = profileOf(managed.events)
  // Act
  const closeFailure = await managed.browser.close().then(
    () => undefined,
    (error: Error) => error.message,
  )
  // Assert
  assert.deepEqual(
    {
      closeFailure,
      folderLeft: await exists(profile),
      journal: managed.events.map((event) =>
        event.type === 'browser.managed-exit-unverified'
          ? { type: event.type, detail: event.detail }
          : event.type,
      ),
    },
    {
      closeFailure: undefined,
      folderLeft: false,
      journal: [
        'browser.managed-profile',
        'host.debugger-started',
        {
          type: 'browser.managed-exit-unverified',
          detail: {
            profile,
            reason:
              'Error: The process listing (/bin/ps) did not answer within 10000 ms and was ended.',
          },
        },
        'browser.managed-profile-removed',
        'browser.cleanup-verified',
      ],
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

// Value: protects=the close of a managed run whose sweep of abandoned profile folders runs long (on Windows each judgement can cost a PowerShell query of up to 3 s, so a root with many leftovers would take minutes): the close waits for the sweep 2 s at most, says in the journal that the sweep outlived it, and completes, while the sweep goes on and its folders stay for the next sweep (AD23, /ship adversarial review Step 11); fails_when=the close waits for the sweep without a bound, so the run's close, and with it Close Study Workspace, waits for every judgement; why_new=every close test let its sweep end at once or released it; the first form of this test gave the close's real file work a count of event-loop turns and failed under load (FL1); seam=the sweep's stand-in, which never ends, the journal, whose entry for the verified browser exit says that the close has reached its wait for the sweep, and the faked setTimeout of that wait
test('a managed close waits for a sweep that never ends 2 s at most, journals that the sweep outlived it, and completes', async (context) => {
  // Arrange: a launched managed browser whose sweep never ends; the journal tells when the close has verified the browser's exit, the step before its wait for the sweep.
  let reportBrowserExitVerified!: () => void
  const browserExitVerified = new Promise<void>((resolve) => {
    reportBrowserExitVerified = resolve
  })
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: () => new Promise<string[]>(() => {}),
    onEvent: (type) => {
      if (type === 'browser.managed-exit-verified') reportBrowserExitVerified()
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let closed = false
  const sweepOutlivedTheClose = (): boolean =>
    managed.events.some(
      (event) => event.type === 'browser.abandoned-profile-sweep-left-running',
    )
  // Act: the close is followed to its wait for the sweep, whose timer is set in the same turn of the event loop as the verified exit; the faked clock then moves to 1 ms before the bound and then to the bound. No step between them does file work, so one turn after each move settles the wait.
  const closing = managed.browser.close().then(() => {
    closed = true
  })
  await browserExitVerified
  await nextEventLoopTurn()
  context.mock.timers.tick(1_999)
  await nextEventLoopTurn()
  const beforeTheBound = {
    closed,
    sweepOutlivedTheClose: sweepOutlivedTheClose(),
  }
  context.mock.timers.tick(1)
  await nextEventLoopTurn()
  const atTheBound = { sweepOutlivedTheClose: sweepOutlivedTheClose() }
  // Assert: the wait is judged before the close is awaited, so a close without a bound fails the test instead of holding it.
  assert.deepEqual(
    { beforeTheBound, atTheBound },
    {
      beforeTheBound: { closed: false, sweepOutlivedTheClose: false },
      atTheBound: { sweepOutlivedTheClose: true },
    },
  )
  // The rest of the close removes the run's own folder, which is real file work: its own completion is awaited, not counted in turns.
  await closing
  assert.deepEqual(
    { closed, journal: managed.events.map((event) => event.type) },
    {
      closed: true,
      journal: [
        'browser.managed-profile',
        'host.debugger-started',
        'browser.managed-exit-verified',
        'browser.abandoned-profile-sweep-left-running',
        'browser.managed-profile-removed',
        'browser.cleanup-verified',
      ],
    },
  )
})

// Value: protects=the journal of a run whose close stopped waiting for its sweep at the 2 s bound: the run is over, its journal ends with its cleanup, and the sweep that ends later, having removed a folder, writes nothing into it (R14, the third OCR review); fails_when=the sweep's result is journaled whatever the close did, so an entry lands after the run's `browser.cleanup-verified`; why_new=the bound's test used a sweep that never ends, so the guard was never reached; seam=the sweep's stand-in, which ends with one removed folder when the test releases it, the journal's verified exit, and the faked setTimeout of the close's bounded wait
test('a sweep that ends after its run’s close stopped waiting for it journals nothing into that run, although it removed a folder', async (context) => {
  // Arrange: the close stops waiting at the bound while the sweep still runs.
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
    onEvent: (type) => {
      if (type === 'browser.managed-exit-verified') reportBrowserExitVerified()
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const closing = managed.browser.close()
  await browserExitVerified
  await nextEventLoopTurn()
  context.mock.timers.tick(2_000)
  await closing
  // Act: the sweep ends with a removed folder; its handling settles within one turn of the event loop, since it does no file work.
  releaseSweep([join(managed.root, 'codebook-browser-left-by-a-killed-editor')])
  await sweep
  await nextEventLoopTurn()
  // Assert
  assert.deepEqual(
    managed.events.map((event) => event.type),
    [
      'browser.managed-profile',
      'host.debugger-started',
      'browser.managed-exit-verified',
      'browser.abandoned-profile-sweep-left-running',
      'browser.managed-profile-removed',
      'browser.cleanup-verified',
    ],
  )
})

// Value: protects=the next managed run after a close that stopped waiting for its sweep at the 2 s bound: its launch joins the sweep of the same root that still runs instead of starting a second one, which would read every marker's process start again (on Windows a PowerShell query of up to 3 s each) and remove nothing the first does not (R5, /ship third review, PD3-3); fails_when=the guard against a second sweep is kept per HostBrowser, which every ConfiguredBrowserRun makes anew, so each run starts a sweep of the root beside the one that runs; why_new=every sweep test used one browser; seam=the sweep's stand-in, which counts its starts and ends only when the test releases it, a later run of the same loaded adapter (`laterRun`), the journal's verified exit, and the faked setTimeout of the first close's bounded wait
test('a managed launch while the sweep of its root outlives an earlier run’s close joins that sweep and starts no second one', async (context) => {
  // Arrange: the first run's close stops waiting for its sweep at the bound; the sweep still runs.
  let sweepsStarted = 0
  let releaseSweep!: (removed: string[]) => void
  const sweep = new Promise<string[]>((resolve) => {
    releaseSweep = resolve
  })
  let reportBrowserExitVerified!: () => void
  const browserExitVerified = new Promise<void>((resolve) => {
    reportBrowserExitVerified = resolve
  })
  const managed = await managedBrowser(context, {
    removeAbandonedProfiles: () => {
      sweepsStarted += 1
      return sweep
    },
    onEvent: (type) => {
      if (type === 'browser.managed-exit-verified') reportBrowserExitVerified()
    },
  })
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const closing = managed.browser.close()
  await browserExitVerified
  await nextEventLoopTurn()
  context.mock.timers.tick(2_000)
  await closing
  context.mock.timers.reset()
  const later = managed.laterRun()
  // Act
  await later.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  const sweepsAtTheLaterLaunch = sweepsStarted
  releaseSweep([])
  await later.browser.close()
  // Assert
  assert.deepEqual(
    {
      sweepsAtTheLaterLaunch,
      firstJournalEnd: managed.events.at(-3)?.type,
      laterJournal: later.events.map((event) => event.type),
    },
    {
      sweepsAtTheLaterLaunch: 1,
      firstJournalEnd: 'browser.abandoned-profile-sweep-left-running',
      laterJournal: [
        'browser.managed-profile',
        'host.debugger-started',
        'browser.managed-exit-verified',
        'browser.managed-profile-removed',
        'browser.cleanup-verified',
      ],
    },
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

// Value: protects=the recorded Chrome resolves localhost to 127.0.0.1 only (D66 defense in depth: no other listener on ::1 can answer for the owned origin); fails_when=the launch omits the host-resolver rule; why_new=F427; seam=the real adapter with the editor's debugger start recording its configuration; no_claim=Chrome honoring the rule (checked natively)
test('the managed Chrome launch maps localhost to 127.0.0.1', async (context) => {
  // Arrange
  let runtimeArgs: string[] | undefined
  const managed = await managedBrowser(context, {
    startDebugging: async (_folder, configuration) => {
      runtimeArgs = configuration.runtimeArgs
      return true
    },
  })

  // Act
  await managed.browser.launch(
    { type: 'editor-browser', name: 'owned', request: 'launch' },
    new AbortController().signal,
  )
  await managed.browser.close()

  // Assert
  // The adapter runs in its own context, so its array is copied before the comparison.
  assert.deepEqual(Array.from(runtimeArgs ?? []), [
    '--headless=new',
    '--remote-debugging-pipe',
    '--host-resolver-rules=MAP localhost 127.0.0.1',
  ])
})
