import { constants as filesystemConstants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import * as vscode from 'vscode'

import {
  ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS,
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_REMOVAL_RETRIES,
  MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
  PROCESS_LISTING_POLL_INTERVAL_MS_ON_WINDOWS,
} from '../constants'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { currentUserName } from '../utils/currentUserName'
import type { StorageOwnerIdentity } from '../utils/readRecordedOwner'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'
import { retryWhileBusy } from '../utils/retryWhileBusy'

import type { BrowserViewport, BrowserViewportFactory } from './browserViewport'
import type { Cdp } from './cdp'
import {
  ACTIVE_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  INTERFERENCE_DELAY_MS,
  POLL_INTERVAL_MS,
  type Scenario,
} from './constants'
import { CursorCdpBridge } from './cursorCdpBridge'
import { awaitResponse } from './utils/awaitResponse'
import { managedProfileRoot } from './utils/managedProfileRoot'
import { profileProcesses } from './utils/profileProcesses'
import { removeAbandonedProfiles } from './utils/removeAbandonedProfiles'
import type { selectHost } from './utils/selectHost'
import { selectPageTarget } from './utils/selectPageTarget'
import { settleCleanup } from './utils/settleCleanup'
import { WaitTimeoutError } from './utils/waitTimeoutError'
import { waitUntil } from './utils/waitUntil'

export interface HostConfiguration {
  id: ReturnType<typeof selectHost>
  productVersion: string
  apiVersion: string
  commit: string
  endpointPath?: string
  browserBackend?: 'native' | 'managed'
  chrome?: { binary: string; version: string }
}
interface CursorCommandResult {
  success: boolean
  browserId?: string
  error?: string
}
interface CursorTabs {
  tabs: string[]
}
type RecordEvent = (type: string, detail?: unknown) => unknown
/** A managed run's own profile folder that its close could not remove, with the removal's error as text; the run shows it in its cleanup record. */
export type ProfileLeft = { profile: string; reason: string }

/**
 * Names the pause between two looks for a managed profile's processes ({@link profileProcesses}), each of which lists every process of the machine ({@link listProcesses}); called by {@link HostBrowser.attachViewport} for the owned Chrome's start and by {@link HostBrowser.close} for its exit.
 * @param platform - The system the editor runs on.
 * @returns
 * - On Windows, where each look starts a PowerShell scan of every process: {@link PROCESS_LISTING_POLL_INTERVAL_MS_ON_WINDOWS}, so the scans do not follow each other back to back
 * - On every other system, where `ps` answers in milliseconds: {@link POLL_INTERVAL_MS}
 * @example
 * profileProcessPollIntervalMs('win32') // => 500
 * profileProcessPollIntervalMs('linux') // => 50
 */
function profileProcessPollIntervalMs(platform: NodeJS.Platform): number {
  return platform === 'win32'
    ? PROCESS_LISTING_POLL_INTERVAL_MS_ON_WINDOWS
    : POLL_INTERVAL_MS
}

/**
 * Makes a managed run's profile folder in its root and gives the folder's real path, by which Chrome and the debugger name it; called by {@link HostBrowser.launch} before it writes the folder's owner marker.
 * A folder whose real path cannot be read (on some Windows volumes, a RAM disk, a `subst` or a network drive, the system's own resolution fails) would have no marker and no path the run knows, so neither the close nor a later sweep would remove it: it is removed again at once, without following a link ({@link removeWithoutFollowing}), and the launch fails with a sentence that says so.
 * @param root - The managed profile root ({@link managedProfileRoot}).
 * @returns The real path of the new folder.
 * @throws When the folder cannot be made, or when its real path cannot be read: the folder is removed then, and the error names it and the cause.
 * @example
 * await madeProfileFolder('/tmp') // => '/private/tmp/codebook-browser-a1b2c3' on macOS
 */
async function madeProfileFolder(root: string): Promise<string> {
  const made = await mkdtemp(join(root, MANAGED_PROFILE_PREFIX))
  try {
    return await realpath(made)
  } catch (error) {
    // A folder without its real path gets no marker: no close and no sweep would ever find it, so it goes now.
    await removeWithoutFollowing(made).catch(() => undefined)
    throw new Error(
      `The managed browser's profile folder ${made} could not be resolved, so it was removed again and the browser was not started: ${String(error)}`,
      { cause: error },
    )
  }
}

/** Owns host-specific browser acquisition/reveal/cleanup for {@link ConfiguredBrowserRun}; correctness stays in the shared coordinator. @example await browser.launch(configuration, signal) */
export class HostBrowser {
  private tab?: vscode.Tab
  private readonly cursorIds = new Set<string>()
  private readonly ownerOptions: { ownerAgentId: string }
  private bridge?: CursorCdpBridge
  private readonly acquisitions = new Set<Promise<unknown>>()
  private closing = false
  private managedProfile?: string
  /** Set once this run's profile folder is gone, so that a repeated {@link close} neither looks for its processes nor removes it again. */
  private managedProfileRemoved = false
  private leftProfile?: ProfileLeft
  private viewport?: BrowserViewport
  /** The sweep of the profile folders a killed editor left, started by a managed {@link launch} without waiting for it ({@link startAbandonedProfileSweep}) and awaited by {@link close} for at most {@link ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS}; it never rejects, and none is started once the browser is closing. */
  private abandonedProfileSweep?: Promise<void>
  /** Set once {@link close} stopped waiting for a sweep that was still running: the run's journal is complete then, and the sweep's later result is not journaled. */
  private sweepOutlivedClose = false

  /**
   * @param profileRoot - The directory in which a managed run creates its profile folder and looks for folders a killed editor left; tests name a directory of their own. Left out, a managed run uses this user's directory ({@link managedProfileRoot}: the shared `/tmp` on macOS and Linux, the user's own local application data folder on Windows).
   */
  constructor(
    private readonly host: HostConfiguration,
    private readonly runId: string,
    private readonly url: string,
    private readonly record: RecordEvent,
    private readonly scenario: Scenario,
    private readonly fail: (reason: string) => void = () => undefined,
    private readonly createViewport?: BrowserViewportFactory,
    private readonly profileRoot?: string,
  ) {
    this.ownerOptions = { ownerAgentId: `codebook-${runId}` }
  }

  /**
   * Names the directory of this run's managed profile folder and of the folders a killed editor left, the same for both; read by {@link launch} for the profile folder and by {@link startAbandonedProfileSweep} for the sweep, so both use the same directory; only a managed browser reads it.
   * @returns The directory a test named; else this user's directory of {@link managedProfileRoot} on this system.
   * @example this.managedRoot // => '/tmp' on Linux, 'C:\Users\learner\AppData\Local\Codebook\browser-profiles' on Windows
   */
  private get managedRoot(): string {
    return (
      this.profileRoot ??
      managedProfileRoot(process.platform, {
        environment: process.env,
        homeDirectory: homedir,
      })
    )
  }

  /**
   * Names the managed profile folder the last {@link close} could not remove, for the run's cleanup record; read by {@link ConfiguredBrowserRun} in its view.
   * A folder that stays is no failed release: the browser's processes are gone, and a later run removes the folder once this editor has ended.
   * @returns
   * - `undefined` when the run has no managed profile, has not closed yet, or its folder was removed
   * - The folder and the removal's error when the folder is still there
   * @example
   * browser.profileLeft // => { profile: '/tmp/codebook-browser-a1b2c3', reason: 'Error: EACCES: permission denied, rmdir …' }
   */
  get profileLeft(): ProfileLeft | undefined {
    return this.leftProfile
  }

  /** Starts a real debugger using the selected host route, invoked once during run preparation; a managed launch that was not cancelled while its owner was read starts the removal of the profile folders a killed editor left ({@link startAbandonedProfileSweep}) without waiting for it, and marks its own folder as this process's. @example await browser.launch({ name: 'codebook run', type: 'editor-browser', request: 'launch' }, signal) */
  async launch(
    configuration: vscode.DebugConfiguration,
    signal: AbortSignal,
  ): Promise<void> {
    // Owned browser debugging must not open the Debug Console over the application and Study panes.
    let debugConfiguration: vscode.DebugConfiguration = {
      ...configuration,
      internalConsoleOptions: 'neverOpen',
    }
    if (this.host.browserBackend === 'managed') {
      if (!this.host.chrome)
        throw new Error('Managed Chrome installation is missing')
      const runtimeExecutable =
        this.scenario === 'missing-browser'
          ? '/codebook-missing-chrome'
          : this.host.chrome.binary
      // js-debug opens a modal for missing executables; reject before an interactive launch is acquired.
      await access(runtimeExecutable, filesystemConstants.X_OK).catch(
        (error) => {
          throw new Error(
            `Managed Chrome executable unavailable: ${String(error)}`,
          )
        },
      )
      signal.throwIfAborted()
      const owner = await currentStorageOwner()
      // A launch cancelled while its owner was read removes nothing and creates nothing.
      signal.throwIfAborted()
      if (this.closing) throw new Error('Owned browser is closing')
      this.startAbandonedProfileSweep(owner)
      const root = this.managedRoot
      // The root of Windows (below the user's local application data folder) is made at the first run; /tmp is always there.
      await mkdir(root, { recursive: true })
      this.managedProfile = await madeProfileFolder(root)
      const user = currentUserName()
      // The marker is the proof by which a later run may remove this folder, should this editor be killed before the run closes; it names the user, whose sweep alone judges it.
      await writeFile(
        join(this.managedProfile, MANAGED_PROFILE_OWNER_FILE),
        JSON.stringify({
          pid: process.pid,
          ...owner,
          ...(user !== undefined && { user }),
          createdAt: new Date().toISOString(),
        }),
      )
      this.record('browser.managed-profile', {
        profile: this.managedProfile,
        chrome: this.host.chrome,
      })
      signal.throwIfAborted()
      const { BrowserViewport } = await import('./browserViewport.js')
      signal.throwIfAborted()
      // Keep the raw preparation tracked after request cancellation so a late native viewport cannot escape cleanup.
      const preparingViewport = this.trackAcquisition(
        Promise.resolve()
          .then(() => {
            signal.throwIfAborted()
            if (this.closing) throw new Error('Owned browser is closing')
            return this.createViewport
              ? this.createViewport(
                  this.runId,
                  this.record,
                  this.fail,
                  this.scenario,
                  signal,
                )
              : new BrowserViewport(
                  this.runId,
                  this.record,
                  this.fail,
                  this.scenario,
                )
          })
          .then((viewport) => {
            this.viewport = viewport
            // The accepting request can be gone while the native resource still finishes creating.
            if (this.closing || signal.aborted) this.closeViewport()
          }),
      )
      await awaitResponse(
        preparingViewport,
        'owned App viewport preparation',
        signal,
      )
      signal.throwIfAborted()
      if (this.closing) throw new Error('Owned browser is closing')
      debugConfiguration = {
        ...debugConfiguration,
        type: 'pwa-chrome',
        request: 'launch',
        runtimeExecutable,
        runtimeArgs: ['--headless=new', '--remote-debugging-pipe'],
        userDataDir: this.managedProfile,
        cleanUp: 'wholeBrowser',
        browserLaunchLocation: 'workspace',
      }
    } else if (this.host.id === 'cursor') {
      const commands = await awaitResponse(
        vscode.commands.getCommands(true),
        'Cursor browser capabilities',
        signal,
      )
      const required = ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(
        (operation) => `cursor.browserView.${operation}`,
      )
      if (this.scenario === 'missing-capability') {
        required.push('codebook.deliberately-missing-browser')
        this.record('fault.capability-missing')
      }
      for (const command of required)
        if (!commands.includes(command))
          throw new Error(`Missing Cursor browser capability: ${command}`)
      if (this.scenario === 'missing-endpoint')
        this.record('fault.endpoint-missing')
      if (!this.host.endpointPath || this.scenario === 'missing-endpoint')
        throw new Error('Cursor debugging endpoint descriptor is missing')
      const endpoint: unknown = JSON.parse(
        await readFile(this.host.endpointPath, 'utf8'),
      )
      if (
        !endpoint ||
        typeof endpoint !== 'object' ||
        !('port' in endpoint) ||
        typeof endpoint.port !== 'number' ||
        !Number.isInteger(endpoint.port) ||
        endpoint.port <= 0
      )
        throw new Error('Invalid Cursor debugging endpoint descriptor')
      const origin = `http://127.0.0.1:${endpoint.port}`
      signal.throwIfAborted()
      await awaitResponse(this.createCursorTab(), 'Cursor browser creation')
      signal.throwIfAborted()
      if (this.scenario === 'cancel-browser') {
        this.record('fault.browser-acquisition-held')
        await delay(INTERFERENCE_DELAY_MS, undefined, { signal })
      }
      if (this.scenario === 'ambiguous-target') {
        const duplicate = await awaitResponse(
          this.createCursorTab(),
          'duplicate owned browser creation',
        )
        // The native tab command returns before Chromium finishes navigation; observe the actual duplicate targets.
        await waitUntil(
          async () => {
            const response = await fetch(`${origin}/json/list`, {
              signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
              ]),
            })
            const targets: unknown = await response.json()
            try {
              selectPageTarget(targets, this.url)
              return false
            } catch (error) {
              if (
                String(error).includes('Ambiguous application browser targets')
              ) {
                this.record('fault.duplicate-targets-observed', targets)
                return true
              }
              throw error
            }
          },
          'duplicate page navigation',
          ACTIVE_TIMEOUT_MS,
          signal,
        )
        this.record('fault.duplicate-target-created', { browserId: duplicate })
      }
      let previousTargets = ''
      const target = await waitUntil(
        async () => {
          const response = await fetch(`${origin}/json/list`, {
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
            ]),
          })
          if (!response.ok)
            throw new Error(
              `Cursor debugging endpoint returned ${response.status}`,
            )
          const targets: unknown = await response.json()
          const serialized = JSON.stringify(targets)
          if (serialized !== previousTargets) {
            this.record('browser.targets-observed', targets)
            previousTargets = serialized
          }
          return selectPageTarget(targets, this.url)
        },
        'unique Cursor page target',
        ACTIVE_TIMEOUT_MS,
        signal,
      )
      this.record('browser.target-discovered', target)
      const versionResponse = await fetch(`${origin}/json/version`, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
        ]),
      })
      const version: { webSocketDebuggerUrl?: string } =
        await versionResponse.json()
      if (
        !version.webSocketDebuggerUrl ||
        new URL(version.webSocketDebuggerUrl).host !==
          `127.0.0.1:${endpoint.port}`
      )
        throw new Error('Cursor upstream debugging endpoint changed')
      this.bridge = new CursorCdpBridge(
        version.webSocketDebuggerUrl,
        target.id,
        this.record,
      )
      const bridgePort = await this.bridge.listen()
      debugConfiguration = {
        ...debugConfiguration,
        type: 'pwa-chrome',
        request: 'attach',
        address: '127.0.0.1',
        port: bridgePort,
        urlFilter: this.url,
        targetSelection: 'automatic',
      }
    }
    signal.throwIfAborted()
    // Owned fixed builds never require saving unrelated learner documents before launch.
    const launching = this.trackAcquisition(
      vscode.debug.startDebugging(undefined, debugConfiguration, {
        suppressSaveBeforeStart: true,
      }),
    )
    if (this.scenario === 'cancel-attach') {
      this.record('fault.attach-acquisition-held')
      // Even a cancelled hold must drain the already-issued launch before releasing its sessions.
      await delay(INTERFERENCE_DELAY_MS, undefined, { signal }).catch(
        () => undefined,
      )
    }
    const launched = await awaitResponse(launching, 'owned debugger launch')
    signal.throwIfAborted()
    if (!launched)
      throw new Error(
        `${this.host.id} rejected the ${debugConfiguration.type} debugger`,
      )
    this.record('host.debugger-started', {
      host: this.host.id,
      type: debugConfiguration.type,
    })
    if (
      (this.host.id === 'vscode' || this.host.browserBackend === 'managed') &&
      this.scenario === 'cancel-browser'
    ) {
      await this.reveal(signal)
      this.record('fault.browser-acquisition-held')
      await delay(INTERFERENCE_DELAY_MS, undefined, { signal })
    }
  }

  /**
   * Starts the removal of the profile folders a killed editor left ({@link removeAbandonedProfiles}) beside a managed run's start, which does not wait for it; called by {@link launch} once its owner is read and its signal is still not aborted.
   * This run's own folder is never removed by the sweep, because its marker names this running process. The sweep never fails the launch, and {@link close} awaits it.
   * A browser that is closing starts none: its close may already have passed the step that waits for a sweep, and a sweep started after it would outlive the run. A browser starts at most one sweep.
   * @param owner - The machine, the boot and the start of this process, by which a folder's marker is judged.
   * @example
   * this.startAbandonedProfileSweep(await currentStorageOwner()) // journal, once the sweep ended: browser.abandoned-profiles-removed { profiles: ['/tmp/codebook-browser-a1b2c3'] }
   */
  private startAbandonedProfileSweep(owner: StorageOwnerIdentity): void {
    if (this.closing || this.abandonedProfileSweep) return
    this.abandonedProfileSweep = removeAbandonedProfiles(
      this.managedRoot,
      owner,
    )
      .then((abandoned) => {
        // A sweep that outlived the run's close journals nothing into the run that already ended.
        if (abandoned.length && !this.sweepOutlivedClose)
          this.record('browser.abandoned-profiles-removed', {
            profiles: abandoned,
          })
      })
      .catch(() => undefined)
  }

  /** Binds the owned viewport only after {@link ConfiguredBrowserRun} identifies the exact child/page. @example await browser.attachViewport(cdp, signal) */
  async attachViewport(cdp: Cdp, signal: AbortSignal): Promise<void> {
    if (!this.viewport || !this.managedProfile) return
    const profile = this.managedProfile
    const processes = await waitUntil(
      async () => {
        const observed = await profileProcesses(profile)
        return observed.length ? observed : undefined
      },
      'owned Chrome process',
      ACTIVE_TIMEOUT_MS,
      signal,
      profileProcessPollIntervalMs(process.platform),
    )
    if (
      !processes.some((process) =>
        process.command.includes('--remote-debugging-pipe'),
      ) ||
      processes.some((process) =>
        process.command.includes('--remote-debugging-port'),
      )
    )
      throw new Error('Owned Chrome is not using the declared debugging pipe')
    const portFile = await readFile(
      join(profile, 'DevToolsActivePort'),
      'utf8',
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (portFile !== undefined)
      throw new Error(
        'Owned Chrome unexpectedly exposed a browser debugging port',
      )
    this.record('browser.managed-processes', {
      processes,
      pipe: true,
      devToolsPortFileAbsent: true,
    })
    this.record(
      'browser.runtime-version',
      await cdp.request('Browser.getVersion', undefined),
    )
    await this.viewport.attach(cdp, signal)
  }

  /** Connects immutable captured pixels to an exact renderer acknowledgement in managed mode. @example await browser.presentCapture(png, 'paused-1') */
  async presentCapture(
    data: string,
    phase: string,
  ): Promise<{ epoch: string; id: number; hash: string } | undefined> {
    return this.viewport?.present(data, phase)
  }

  /** Forwards actual phase response pixels to optional recording before reveal/storage can delay them. @example browser.recordCapture(data, 'before') */
  recordCapture(data: string, phase: string): void {
    this.viewport?.recordCapture(data, phase)
  }

  /** Retires only viewport pause presentation; debugger control remains in {@link ConfiguredBrowserRun}. @example browser.resumeViewport() */
  resumeViewport(): void {
    this.viewport?.resume()
  }

  /** Retains raw acquisitions beyond request deadlines so {@link drainAcquisitions} cannot certify an unknown resource state. @example this.trackAcquisition(startDebugging()) */
  private trackAcquisition<Value>(
    acquisition: PromiseLike<Value>,
  ): Promise<Value> {
    const pending = Promise.resolve(acquisition)
    this.acquisitions.add(pending)
    void pending.then(
      () => this.acquisitions.delete(pending),
      () => this.acquisitions.delete(pending),
    )
    return pending
  }

  /** Adopts native tab handles even after a timeout; {@link launch} owns the request while late teardown owns release. @example await this.createCursorTab() */
  private createCursorTab(): Promise<string> {
    return this.trackAcquisition(
      Promise.resolve(
        vscode.commands.executeCommand<CursorCommandResult>(
          'cursor.browserView.newTab',
          this.url,
          { agentId: this.ownerOptions.ownerAgentId },
        ),
      ).then(async (created) => {
        if (!created?.success || !created.browserId)
          throw new Error(`Cursor browser creation failed: ${created?.error}`)
        this.cursorIds.add(created.browserId)
        this.record('browser.created', {
          host: this.host.id,
          browserId: created.browserId,
          duringCleanup: this.closing,
        })
        // The original request may have timed out and its cleanup may already have failed closed.
        if (this.closing)
          await awaitResponse(
            vscode.commands.executeCommand(
              'cursor.browserView.closeTab',
              created.browserId,
              this.ownerOptions,
            ),
            'late owned Cursor browser close',
          )
        return created.browserId
      }),
    )
  }

  /** Prevents cleanup success while non-cancellable creation can still produce resources, called before stopping owned sessions. @example await browser.drainAcquisitions() */
  async drainAcquisitions(): Promise<void> {
    this.closing = true
    await awaitResponse(
      Promise.allSettled(this.acquisitions),
      'owned browser and debugger acquisitions',
    )
  }

  /** Reveals the exact owned app after preparation or continuation, without adopting focused tabs. @example await browser.reveal(signal) */
  async reveal(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.viewport) {
      await this.viewport.reveal(signal)
      return
    }
    if (this.host.id === 'cursor') {
      const browserId = [...this.cursorIds][0]
      if (!browserId) throw new Error('Owned Cursor browser is missing')
      const selected = await awaitResponse(
        vscode.commands.executeCommand<CursorCommandResult>(
          'cursor.browserView.selectTab',
          browserId,
          this.ownerOptions,
        ),
        'owned Cursor browser reveal',
        signal,
      )
      if (!selected?.success)
        throw new Error(`Owned Cursor browser disappeared: ${selected?.error}`)
      this.record('browser.revealed', { browserId })
      return
    }
    const browser = await waitUntil(
      () => {
        for (const group of vscode.window.tabGroups.all) {
          const tab = group.tabs.find(
            (candidate) =>
              candidate === this.tab ||
              (!this.tab &&
                candidate.label === `codebook ${this.runId.slice(0, 8)}`),
          )
          if (tab) return { group, tab }
        }
        return undefined
      },
      'owned browser tab',
      ACTIVE_TIMEOUT_MS,
      signal,
    )
    this.tab = browser.tab
    if (browser.group.viewColumn !== vscode.ViewColumn.One)
      throw new Error(
        'Codebook expects its owned browser in the first editor group',
      )
    await awaitResponse(
      vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'),
      'browser group focus',
      signal,
    )
    const index = browser.group.tabs.indexOf(browser.tab)
    if (index < 0)
      throw new Error('Owned browser tab disappeared before reveal')
    await awaitResponse(
      vscode.commands.executeCommand(
        'workbench.action.openEditorAtIndex',
        index,
      ),
      'owned browser reveal',
      signal,
    )
    signal.throwIfAborted()
    this.record('browser.revealed', { title: browser.tab.label, index })
  }

  /** Releases known handles even if acquisition is unresolved, waits for the sweep of abandoned profile folders its launch started, then removes a managed run's own profile folder; {@link ConfiguredBrowserRun} can retry incomplete teardown, and a folder that stays is no failure of it ({@link profileLeft}). @example await browser.close() */
  async close(): Promise<void> {
    this.closing = true
    const failures = await settleCleanup([
      {
        description: 'owned viewport close',
        release: (): void => this.closeViewport(),
      },
      {
        description: 'owned CDP bridge close',
        release: async (): Promise<void> => {
          if (this.bridge)
            await awaitResponse(this.bridge.close(), 'owned CDP bridge close')
          this.bridge = undefined
        },
      },
      {
        description: 'known owned browser tabs',
        release: (): Promise<void> => this.closeTabs(),
      },
      {
        description: 'pending browser acquisitions',
        release: (): Promise<void> => this.drainAcquisitions(),
      },
      {
        description: 'late owned viewport close',
        release: (): void => this.closeViewport(),
      },
      // A launch may reveal its editor after the first sweep; check again after acquisition settles.
      {
        description: 'late owned browser tabs',
        release: (): Promise<void> => this.closeTabs(),
      },
      {
        description: 'owned Chrome process exit',
        release: async (): Promise<void> => {
          // A folder an earlier close removed has no processes to look for, and looking would fail on the missing path.
          if (!this.managedProfile || this.managedProfileRemoved) return
          const profile = this.managedProfile
          try {
            // Each look lists every process of the machine; on Windows the looks are spaced out (profileProcessPollIntervalMs).
            await waitUntil(
              async () => (await profileProcesses(profile)).length === 0,
              'owned Chrome profile processes exited',
              ACTIVE_TIMEOUT_MS,
              undefined,
              profileProcessPollIntervalMs(process.platform),
            )
          } catch (error) {
            // Processes still there at the bound are a failed release. A listing that cannot be made proves nothing either way: the close goes on, so the folder this run made is removed and never left behind, also on a machine where no listing ever succeeds.
            if (error instanceof WaitTimeoutError) throw error
            this.record('browser.managed-exit-unverified', {
              profile,
              reason: String(error),
            })
            return
          }
          this.record('browser.managed-exit-verified', {
            profile,
            remainingProcesses: 0,
          })
        },
      },
      // The sweep a managed launch started is waited for within its bound; it never rejects, so it adds no failure.
      {
        description: 'abandoned profile sweep',
        release: (): Promise<void> => this.awaitSweepWithinBound(),
      },
    ])
    if (failures.length)
      throw new Error(`Browser cleanup incomplete: ${failures.join('; ')}`)
    // Only here every acquisition has ended and no profile process is left: a browser that starts late never loses its folder.
    await this.removeManagedProfile()
    this.record('browser.cleanup-verified', {
      host: this.host.id,
      remainingOwnedTabs: 0,
    })
  }

  /**
   * Waits for the sweep of abandoned profile folders a managed launch started, for at most {@link ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS}; called by {@link close} after the browser's exit was verified.
   * Why bounded: on Windows each judgement of a folder can cost a PowerShell query of up to 3 s, so a root with many leftovers would hold the close for minutes. A sweep that is still running at the bound goes on in the background; the folders it has not judged stay for the next sweep, and its later result is not journaled into this run (`browser.abandoned-profile-sweep-left-running` says that it outlived the close).
   * @returns Once the sweep ended or the bound passed; at once without a sweep.
   * @example
   * await this.awaitSweepWithinBound() // after 2 s at most
   */
  private async awaitSweepWithinBound(): Promise<void> {
    const sweep = this.abandonedProfileSweep
    if (!sweep) return
    const bound = new AbortController()
    const ended = await Promise.race([
      sweep.then(() => true),
      delay(ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS, false, {
        signal: bound.signal,
      }),
    ])
    // The bound's timer goes with the wait, so no timer outlives a sweep that ended first.
    bound.abort()
    if (ended) return
    this.sweepOutlivedClose = true
    this.record('browser.abandoned-profile-sweep-left-running', {
      waitedMs: ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS,
    })
  }

  /**
   * Retires the current viewport during {@link close} and after cancelled preparation in {@link launch}, retaining a failed close for retry.
   * @example this.closeViewport() // the same retired viewport is not closed again by the late cleanup sweep
   */
  private closeViewport(): void {
    const viewport = this.viewport
    viewport?.close()
    // A release callback must not clear a successor installed during the retired viewport's close.
    if (this.viewport === viewport) this.viewport = undefined
  }

  /**
   * Removes this run's own profile folder once its browser is verified gone, so that a run leaves nothing in the profile root; called by {@link close} after every release succeeded, outside the release list.
   * A folder that cannot be removed is journaled as `browser.managed-profile-left` and kept for {@link profileLeft}; it is never a failed release, so the run's outcome and the next start are not affected. A removed folder is remembered, which makes a repeated close a no-op here.
   * The folder is removed by {@link removeWithoutFollowing} with its owner marker ({@link MANAGED_PROFILE_OWNER_FILE}) as the entry that goes last, as the sweep removes a folder: a removal that stops at a file Chrome still holds, or one this user may not remove, leaves a folder that keeps its marker, which a later sweep removes once the file is free. The recursive `rm` of Node.js would remove the marker beside the entry that refuses, and the folder would stay unknown to every sweep. A busy answer is tried again, after 100, 200 and 300 ms ({@link retryWhileBusy}), as `rm` did with its retries, for a file Windows still holds a moment after the browser ended.
   * @example
   * await this.removeManagedProfile() // journal: browser.managed-profile-removed { profile: '/tmp/codebook-browser-a1b2c3' }
   */
  private async removeManagedProfile(): Promise<void> {
    if (!this.managedProfile || this.managedProfileRemoved) return
    const profile = this.managedProfile
    try {
      // The marker goes last, so a folder that stays keeps it for a later sweep.
      await retryWhileBusy(
        () =>
          removeWithoutFollowing(profile, {
            lastEntry: MANAGED_PROFILE_OWNER_FILE,
          }),
        MANAGED_PROFILE_REMOVAL_RETRIES,
        MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
      )
      this.managedProfileRemoved = true
      this.leftProfile = undefined
      this.record('browser.managed-profile-removed', { profile })
    } catch (error) {
      this.leftProfile = { profile, reason: String(error) }
      this.record('browser.managed-profile-left', this.leftProfile)
    }
  }

  /** Closes and observes only recorded/uniquely named tabs before and after acquisition draining in {@link close}. @example await this.closeTabs() */
  private async closeTabs(): Promise<void> {
    if (this.host.browserBackend === 'managed') return
    if (this.host.id === 'cursor') {
      const failures = await settleCleanup(
        [...this.cursorIds].map((browserId) => ({
          description: 'owned Cursor browser close',
          release: () =>
            awaitResponse(
              vscode.commands.executeCommand(
                'cursor.browserView.closeTab',
                browserId,
                this.ownerOptions,
              ),
              'owned Cursor browser close',
            ),
        })),
      )
      const tabs = await awaitResponse(
        vscode.commands.executeCommand<CursorTabs>(
          'cursor.browserView.listTabs',
          this.ownerOptions,
        ),
        'Cursor browser cleanup inspection',
      )
      if (!tabs || !Array.isArray(tabs.tabs))
        throw new Error('Cursor browser cleanup could not be observed')
      for (const browserId of this.cursorIds)
        if (!tabs.tabs.includes(browserId)) this.cursorIds.delete(browserId)
      if (this.cursorIds.size)
        failures.push('Owned Cursor browser remains after cleanup')
      if (failures.length) throw new Error(failures.join('; '))
    } else {
      // A cancelled launch may have created a tab before the normal reveal adopted its handle.
      const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab === this.tab ||
            tab.label === `codebook ${this.runId.slice(0, 8)}`,
        )
      const failures = await settleCleanup(
        tabs.map((tab) => ({
          description: 'owned VS Code browser close',
          release: () =>
            awaitResponse(
              vscode.window.tabGroups.close(tab),
              'owned VS Code browser close',
            ),
        })),
      )
      if (
        vscode.window.tabGroups.all.some((group) =>
          group.tabs.some((tab) => tabs.includes(tab)),
        )
      )
        failures.push('Owned VS Code browser remains after cleanup')
      if (failures.length) throw new Error(failures.join('; '))
      this.tab = undefined
    }
  }
}
