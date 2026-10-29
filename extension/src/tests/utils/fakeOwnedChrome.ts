import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FlatCdpConnection } from '../../chromeExtensionContracts'
import { FlatCdpCommandError } from '../../runtimeSupport/flatCdpConnection'
import type {
  BrowserProcess,
  OwnedBrowserDependencies,
} from '../../runtimeSupport/ownedExtensionBrowser'

/** One command the fake browser received. */
export type RecordedCommand = {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

/** What a test changes about the fake browser's behaviour. */
export type FakeOwnedChromeBehaviour = {
  /** The id `Extensions.loadUnpacked` answers. */
  loadedId: string
  /** A method that answers with CDP's method-not-found error. */
  missingMethod?: string
  /** `Extensions.loadUnpacked` rejects with this message. */
  loadRejection?: string
  /** What `Extensions.getStorageItems` answers instead of the stored data. */
  storedData?: Record<string, unknown>
  /** Whether `Extensions.triggerAction` opens the popup. */
  popupOpens: boolean
  /** Runs when a command arrives, before it is answered. */
  onCommand?: (command: RecordedCommand) => void
  /** A method that rejects with this error every time it is sent (an unmapped command's failure, a lost connection). */
  rejectMethod?: { method: string; error: Error }
  /** The first `ServiceWorker.stopAllWorkers` answers nothing in time, as Chrome may while a worker registers. */
  stopTimesOutOnce?: boolean
  /** `ServiceWorker.stopAllWorkers` answers but the worker keeps running. */
  stopLeavesWorker?: boolean
  /** The worker starts again when the action opens the popup (the extension's own startup work). */
  workerStartsWithPopup?: boolean
  /** The spawned browser ends at once and never publishes `DevToolsActivePort`. */
  exitsAtSpawn?: boolean
  /** What `<chrome> --version` prints; defaults to a supported Chrome. */
  executableVersionText?: string
  /** What `Browser.getVersion` answers as `product`; defaults to a supported Chrome. */
  browserProduct?: string
}

/** The fake browser as a test sees it. */
export type FakeOwnedChrome = {
  dependencies: OwnedBrowserDependencies
  commands: RecordedCommand[]
  spawned: { executable: string; args: string[] }[]
  /** The executables whose `--version` was read, in order. */
  versionReads: string[]
  /** The signals sent to the browser process, in order. */
  signals: (NodeJS.Signals | 0)[]
  closed: () => boolean
  /** The pids and group ids (negative) the browser was signalled through, in order. */
  signalledIds: number[]
  /** Ends the CDP connection from the browser's side, as a crashed or killed Chrome does. */
  dropConnection: () => void
  /** Ends the browser process without a signal from the launch, as a crash does. */
  crashProcess: () => void
}

/** Copies a JSON value with the keys of every object in sorted order, as Chrome returns storage. */
function sortedKeys(value: unknown): Record<string, unknown> {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort)
    if (typeof node !== 'object' || node === null) return node
    return Object.fromEntries(
      Object.entries(node)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sort(child)]),
    )
  }
  const sorted = sort(value)
  return typeof sorted === 'object' && sorted !== null && !Array.isArray(sorted)
    ? Object.fromEntries(Object.entries(sorted))
    : {}
}

/**
 * Builds a stand-in for Chrome's process and its browser-level CDP endpoint, enough for the owned launch: targets, flat sessions, extension install, workers, storage and the popup.
 * @param behaviour - What differs from a healthy Chrome.
 * @returns The dependencies to hand the launch and what the fake saw.
 * @example
 * const chrome = fakeOwnedChrome({ loadedId: 'abc', popupOpens: true })
 * await launchOwnedExtensionBrowser(options, chrome.dependencies)
 */
export function fakeOwnedChrome(
  behaviour: FakeOwnedChromeBehaviour,
): FakeOwnedChrome {
  const commands: RecordedCommand[] = []
  const spawned: FakeOwnedChrome['spawned'] = []
  const versionReads: string[] = []
  const signals: (NodeJS.Signals | 0)[] = []
  const signalledIds: number[] = []
  let stopTimeoutsLeft = behaviour.stopTimesOutOnce ? 1 : 0
  let workerRunning = true
  let popupOpen = false
  let connectionClosed = false
  let alive = true
  const storage: Record<string, unknown> = {}
  const sessions = new Map<string, string>()
  let targetCount = 0

  const answer = (command: RecordedCommand): Record<string, unknown> => {
    const { method, params, sessionId } = command
    if (method === behaviour.rejectMethod?.method)
      throw behaviour.rejectMethod.error
    if (method === behaviour.missingMethod)
      throw new FlatCdpCommandError(method, -32601, `'${method}' wasn't found`)
    switch (method) {
      case 'Browser.getVersion':
        return { product: behaviour.browserProduct ?? 'Chrome/156.0.0.1' }
      case 'Target.getTargets':
        return { targetInfos: listTargets(params) }
      case 'Target.attachToTarget': {
        const targetId = String(params.targetId)
        const session = `session-${targetId}`
        sessions.set(session, targetId)
        return { sessionId: session }
      }
      case 'Target.createTarget':
        return { targetId: `created-${++targetCount}-${String(params.url)}` }
      case 'Target.closeTarget':
        return { success: true }
      case 'Extensions.loadUnpacked':
        if (behaviour.loadRejection !== undefined)
          throw new FlatCdpCommandError(
            method,
            -32600,
            behaviour.loadRejection.replace('<root>', String(params.path)),
          )
        return { id: behaviour.loadedId }
      case 'ServiceWorker.stopAllWorkers':
        if (stopTimeoutsLeft > 0) {
          stopTimeoutsLeft -= 1
          throw new FlatCdpCommandError(method, undefined, 'timed out')
        }
        workerRunning = Boolean(behaviour.stopLeavesWorker)
        return {}
      case 'ServiceWorker.startWorker':
        workerRunning = true
        return {}
      case 'Extensions.setStorageItems':
        assertExtensionPage(sessionId)
        Object.assign(storage, params.values)
        return {}
      case 'Extensions.getStorageItems':
        assertExtensionPage(sessionId)
        // Chrome answers the keys of every object sorted.
        return { data: sortedKeys(behaviour.storedData ?? storage) }
      case 'Extensions.triggerAction':
        popupOpen = behaviour.popupOpens
        if (behaviour.workerStartsWithPopup) workerRunning = true
        return {}
      default:
        return {}
    }
  }

  /** The storage commands answer only on a session of an extension-origin page (TZ2). */
  const assertExtensionPage = (sessionId: string | undefined): void => {
    const target = sessionId === undefined ? undefined : sessions.get(sessionId)
    if (target === undefined || !target.includes('chrome-extension://'))
      throw new FlatCdpCommandError(
        'Extensions.storage',
        -32000,
        'Extension not found.',
      )
  }

  const listTargets = (params: Record<string, unknown>) => {
    if (Array.isArray(params.filter))
      return [{ targetId: 'tab-1', type: 'tab', url: 'about:blank' }]
    const targets = [
      { targetId: 'page-1', type: 'page', url: 'about:blank' },
      ...(workerRunning
        ? [
            {
              targetId: 'worker-1',
              type: 'service_worker',
              url: `chrome-extension://${behaviour.loadedId}/worker.js`,
            },
          ]
        : []),
      ...(popupOpen
        ? [
            {
              targetId: 'popup-1',
              type: 'page',
              url: `chrome-extension://${behaviour.loadedId}/popup.html`,
            },
          ]
        : []),
    ]
    return targets
  }

  const closeListeners = new Set<() => void>()
  const exitListeners = new Set<() => void>()
  const endConnection = (): void => {
    connectionClosed = true
    for (const listener of [...closeListeners]) listener()
    closeListeners.clear()
  }
  const endProcess = (): void => {
    alive = false
    for (const listener of [...exitListeners]) listener()
    exitListeners.clear()
  }
  const connection: FlatCdpConnection = {
    request: async (method, params, sessionId) => {
      const command: RecordedCommand = {
        method,
        params,
        ...(sessionId !== undefined && { sessionId }),
      }
      commands.push(command)
      behaviour.onCommand?.(command)
      return answer(command)
    },
    on: () => () => undefined,
    onClose: (listener) => {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close: endConnection,
  }

  const browser: BrowserProcess = {
    pid: 987_654,
    hasExited: () => !alive,
    onExit: (listener) => {
      exitListeners.add(listener)
    },
  }

  return {
    commands,
    spawned,
    versionReads,
    signals,
    signalledIds,
    closed: () => connectionClosed,
    dropConnection: endConnection,
    crashProcess: endProcess,
    dependencies: {
      readExecutableVersion: async (executable) => {
        versionReads.push(executable)
        return behaviour.executableVersionText ?? 'Google Chrome 156.0.8078.74'
      },
      spawnBrowser: (executable, args) => {
        spawned.push({ executable, args })
        if (behaviour.exitsAtSpawn) {
          alive = false
          return browser
        }
        const profileSwitch = args.find((arg) =>
          arg.startsWith('--user-data-dir='),
        )
        const profile = profileSwitch?.slice('--user-data-dir='.length) ?? ''
        // Chrome publishes its endpoint as the profile's DevToolsActivePort.
        writeFileSync(
          join(profile, 'DevToolsActivePort'),
          '45678\n/devtools/browser/fake\n',
        )
        return browser
      },
      connect: async () => connection,
      sleep: async () => undefined,
      stopper: {
        platform: 'linux',
        signal: (pid, signal): void => {
          signals.push(signal)
          if (signal !== 0) signalledIds.push(pid)
          if (signal === 'SIGTERM' || signal === 'SIGKILL') alive = false
          // The null signal throws once the process is gone, as the system does.
          if (signal === 0 && !alive) throw new Error('ESRCH')
        },
        taskkill: async () => undefined,
        sleep: async () => undefined,
      },
      startSweep: () => undefined,
    },
  }
}
