import { constants as filesystemConstants } from 'node:fs'
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import * as vscode from 'vscode'

import {
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_REMOVAL_RETRIES,
  MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
  MANAGED_PROFILE_ROOT,
} from '../constants'
import { currentStorageOwner } from '../utils/currentStorageOwner'

import type { BrowserViewport, BrowserViewportFactory } from './browserViewport'
import type { Cdp } from './cdp'
import {
  ACTIVE_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  INTERFERENCE_DELAY_MS,
  type Scenario,
} from './constants'
import { CursorCdpBridge } from './cursorCdpBridge'
import { awaitResponse } from './utils/awaitResponse'
import { profileProcesses } from './utils/profileProcesses'
import { removeAbandonedProfiles } from './utils/removeAbandonedProfiles'
import type { selectHost } from './utils/selectHost'
import { selectPageTarget } from './utils/selectPageTarget'
import { settleCleanup } from './utils/settleCleanup'
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

/** Owns host-specific browser acquisition/reveal/cleanup for {@link ExperimentRun}; correctness stays in the shared coordinator. @example await browser.launch(configuration, signal) */
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

  /**
   * @param profileRoot - The directory in which a managed run creates its profile folder and looks for folders a killed editor left; tests name a directory of their own.
   */
  constructor(
    private readonly host: HostConfiguration,
    private readonly runId: string,
    private readonly url: string,
    private readonly record: RecordEvent,
    private readonly scenario: Scenario,
    private readonly fail: (reason: string) => void = () => undefined,
    private readonly createViewport?: BrowserViewportFactory,
    private readonly profileRoot: string = MANAGED_PROFILE_ROOT,
  ) {
    this.ownerOptions = { ownerAgentId: `codebook-${runId}` }
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

  /** Starts a real debugger using the selected host route, invoked once during run preparation; a managed launch first removes the profile folders a killed editor left ({@link removeAbandonedProfiles}) and marks its own as this process's. @example await browser.launch({ name: 'codebook run', type: 'editor-browser', request: 'launch' }, signal) */
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
      // What a killed editor left behind goes before this run adds a folder of its own; the sweep never fails the launch.
      const abandoned = await removeAbandonedProfiles(this.profileRoot, owner)
      if (abandoned.length)
        this.record('browser.abandoned-profiles-removed', {
          profiles: abandoned,
        })
      signal.throwIfAborted()
      this.managedProfile = await realpath(
        await mkdtemp(join(this.profileRoot, MANAGED_PROFILE_PREFIX)),
      )
      // The marker is the proof by which a later run may remove this folder, should this editor be killed before the run closes.
      await writeFile(
        join(this.managedProfile, MANAGED_PROFILE_OWNER_FILE),
        JSON.stringify({
          pid: process.pid,
          ...owner,
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
      this.viewport = this.createViewport
        ? this.createViewport(this.runId, this.record, this.fail, this.scenario)
        : new BrowserViewport(this.runId, this.record, this.fail, this.scenario)
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

  /** Binds the owned viewport only after {@link ExperimentRun} identifies the exact child/page. @example await browser.attachViewport(cdp, signal) */
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

  /** Retires only viewport pause presentation; debugger control remains in {@link ExperimentRun}. @example browser.resumeViewport() */
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

  /** Releases known handles even if acquisition is unresolved, then removes a managed run's own profile folder; {@link ExperimentRun} can retry incomplete teardown, and a folder that stays is no failure of it ({@link profileLeft}). @example await browser.close() */
  async close(): Promise<void> {
    this.closing = true
    const failures = await settleCleanup([
      {
        description: 'owned viewport close',
        release: () => this.viewport?.close(),
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
          await waitUntil(
            async () => (await profileProcesses(profile)).length === 0,
            'owned Chrome profile processes exited',
          )
          this.record('browser.managed-exit-verified', {
            profile,
            remainingProcesses: 0,
          })
        },
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
   * Removes this run's own profile folder once its browser is verified gone, so that a run leaves nothing in the profile root; called by {@link close} after every release succeeded, outside the release list.
   * A folder that cannot be removed is journaled as `browser.managed-profile-left` and kept for {@link profileLeft}; it is never a failed release, so the run's outcome and the next start are not affected. A removed folder is remembered, which makes a repeated close a no-op here.
   * @example
   * await this.removeManagedProfile() // journal: browser.managed-profile-removed { profile: '/tmp/codebook-browser-a1b2c3' }
   */
  private async removeManagedProfile(): Promise<void> {
    if (!this.managedProfile || this.managedProfileRemoved) return
    const profile = this.managedProfile
    try {
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: MANAGED_PROFILE_REMOVAL_RETRIES,
        retryDelay: MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
      })
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
