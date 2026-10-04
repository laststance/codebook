import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

import type * as HostModule from '../runtimeSupport/hostBrowser'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'

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
 * @returns The browser, its root, every journal entry as plain data, and every profile whose processes were asked for. A profile's processes are looked up like the real utility does it: the folder is resolved first, which fails once it is gone, and no process is found.
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
        },
      },
      './utils/profileProcesses': {
        profileProcesses: async (profile: string) => {
          processProbes.push(profile)
          await realpath(profile)
          return []
        },
      },
    },
    // The owner marker names this process.
    { process },
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
    undefined,
    root,
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

// Cycle 0045 (NF-14 as ER-11): only a folder that carries a marker whose editor is gone is Codebook's to remove.
test('a marked profile folder whose editor was killed is removed by the next run, and a folder without a marker is left', async (context) => {
  // Arrange: three folders lie in the profile root when the next run starts.
  const cancellation = new AbortController()
  const managed = await managedBrowser(context, {
    onEvent: (type) => {
      if (type === 'browser.managed-profile')
        cancellation.abort(new Error('run cancelled'))
    },
  })
  const killedEditor = spawnSync(process.execPath, ['-e', ''])
  const ofKilledEditor = join(managed.root, 'codebook-browser-killed'),
    ofRunningEditor = join(managed.root, 'codebook-browser-running'),
    withoutMarker = join(managed.root, 'codebook-browser-unmarked')
  for (const folder of [ofKilledEditor, ofRunningEditor, withoutMarker]) {
    await mkdir(join(folder, 'Default'), { recursive: true })
    await writeFile(join(folder, 'Default', 'Preferences'), '{}')
  }
  await writeFile(
    join(ofKilledEditor, 'codebook-owner.json'),
    JSON.stringify({ pid: killedEditor.pid, hostname: hostname() }),
  )
  await writeFile(
    join(ofRunningEditor, 'codebook-owner.json'),
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
  // Act
  await assert.rejects(
    managed.browser.launch(
      { type: 'editor-browser', name: 'owned', request: 'launch' },
      cancellation.signal,
    ),
    /run cancelled/,
  )
  // Assert
  assert.equal(await exists(ofKilledEditor), false)
  assert.equal(await exists(ofRunningEditor), true)
  assert.equal(await exists(withoutMarker), true)
  assert.deepEqual(managed.events[0], {
    type: 'browser.abandoned-profiles-removed',
    detail: { profiles: [ofKilledEditor] },
  })
  const ownMarker: unknown = JSON.parse(
    await readFile(
      join(profileOf(managed.events), 'codebook-owner.json'),
      'utf8',
    ),
  )
  assert.ok(ownMarker && typeof ownMarker === 'object')
  assert.deepEqual(
    'pid' in ownMarker && 'hostname' in ownMarker
      ? { pid: ownMarker.pid, hostname: ownMarker.hostname }
      : ownMarker,
    { pid: process.pid, hostname: hostname() },
  )
  await managed.browser.close()
})
