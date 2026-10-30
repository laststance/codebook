import { execFile } from 'node:child_process'
import { constants as filesystemConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import * as vscode from 'vscode'
import { z } from 'zod'

import type { ChromeExtensionViewportFactory } from './chromeExtensionContracts'
import { ConfiguredBrowserRun } from './configuredBrowserRun'
import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  CHROME_LINUX_EXECUTABLE_NAMES,
  PREREQUISITE_TIMEOUT_MS,
  WSL_REMOTE_NAME,
} from './constants'
import { StudyError } from './errors'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type { NodeServerHistorySink } from './nodeServerHistorySink'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import type {
  ChromeExtensionRunInput,
  NodeTestPreparationControl,
  RuntimeControl,
  RuntimeDefinition,
  RuntimeSnapshot,
  StudyEnvironment,
  StudyRuntime,
} from './runtime'
import type { BrowserViewportFactory } from './runtimeSupport/browserViewport'
import type { HostConfiguration } from './runtimeSupport/hostBrowser'
import { assertSupportedChromeVersion } from './runtimeSupport/utils/assertSupportedChromeVersion'
import { managedProfileRoot } from './runtimeSupport/utils/managedProfileRoot'
import { createStateChangingRequestAsker } from './utils/askToSendStateChangingRequest'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import {
  assertDevelopmentWorkspace,
  type DevelopmentLockIdentity,
} from './utils/assertDevelopmentWorkspace'
import { causeRootsFor } from './utils/causeRootsFor'
import { checkNodeTestFiles } from './utils/checkNodeTestFiles'
import { chromeExtensionPrerequisiteGaps } from './utils/chromeExtensionPrerequisiteGaps'
import { configuredStops } from './utils/configuredStops'
import { createChromeExecutableLookup } from './utils/createChromeExecutableLookup'
import { createMemoryOrphanStore } from './utils/createMemoryOrphanStore'
import { createNodeServerRunUtilities } from './utils/createNodeServerRunUtilities'
import { listVitestForRootClaim } from './utils/listVitestForRootClaim'
import { nodeServerMachineGaps } from './utils/nodeServerMachineGaps'
import type { NodeServerOrphanStore } from './utils/nodeServerOrphanRecords'
import {
  planNodeTestExecution,
  type NodeTestExecutionPlan,
} from './utils/planNodeTestExecution'
import { readRepositoryAdapterReadiness } from './utils/readRepositoryAdapterReadiness'
import {
  resolveExternalNode,
  resolveExternalNodeExecutable,
} from './utils/resolveExternalNodeExecutable'
import { sanitizeCause } from './utils/sanitizeCause'
import type { CauseRoots } from './utils/sanitizeCause'
import { searchRepositoryVitest } from './utils/searchRepositoryVitest'

export interface StudyPresentation {
  createViewport: BrowserViewportFactory
  /** The leased Application view of a chrome-extension run ({@link ChromeExtensionViewport}); absent where no editor shows one (tests), and the run goes on without a view. */
  createChromeExtensionViewport?: ChromeExtensionViewportFactory
  revealSource(snapshot: RuntimeSnapshot, path: string): Promise<boolean>
}

const executeFile = promisify(execFile)
const buildSchema = z.object({
  revision: z.string(),
  dirty: z.boolean(),
  sourceHash: z.string(),
})
const productSchema = z.object({
  version: z.string(),
  commit: z.string(),
  vscodeVersion: z.string().optional(),
})

/**
 * Rejects unsupported execution contexts even when extension trust support is manually overridden.
 * A WSL remote is accepted: the extension (a `workspace` kind) then runs in the WSL extension host, where the folder is a `file` URI and every path, process and Chrome is the Linux one.
 * @example requireWorkspace()
 */
export function requireWorkspace(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!vscode.workspace.isTrusted)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      'Trust this workspace before starting the agent server.',
    )
  // Only a local window or a WSL remote host owns its files and processes like a local one; SSH, containers, tunnels and virtual folders do not.
  if (
    !folder ||
    folder.uri.scheme !== 'file' ||
    (vscode.env.remoteName && vscode.env.remoteName !== WSL_REMOTE_NAME)
  )
    throw new StudyError(
      'PREREQUISITE_MISSING',
      'Open a trusted file workspace on this machine or in WSL; other remote and virtual workspaces are not supported.',
    )
  return folder.uri.fsPath
}

/**
 * Lists what the editor itself lacks for a study, before any executable is looked for; called first by the prerequisite check of {@link createEnvironment}, behind every status read and run start.
 * @param workspace - The workspace folder the agent server was started for.
 * @returns The sentences of the missing prerequisites, in the order they are reported: the workspace's identity (or why no workspace can be used), then the bundled JavaScript Debugger. Empty when both hold.
 * @example
 * editorPrerequisiteGaps('/repo') // => [] in the trusted window that still has /repo open
 */
function editorPrerequisiteGaps(workspace: string): string[] {
  const missing: string[] = []
  try {
    if (requireWorkspace() !== workspace)
      missing.push('Workspace identity changed; restart the agent server.')
  } catch (error) {
    missing.push(String(error))
  }
  if (!vscode.extensions.getExtension('ms-vscode.js-debug'))
    missing.push('Enable the bundled JavaScript Debugger (ms-vscode.js-debug).')
  return missing
}

/**
 * Words the missing Chrome for the platform, when the prerequisite check of {@link createEnvironment} found no executable.
 * @param platform - The platform of the extension host.
 * @returns On Linux the names that were looked for on PATH and the install remedy; elsewhere the request to configure an installed Chrome.
 * @example
 * missingChromeText('darwin') // => 'codebook.chromeExecutable: configure an installed executable Chrome.'
 */
function missingChromeText(platform: NodeJS.Platform): string {
  // An unset setting on Linux that found nothing on PATH gets the Linux remedy, not the generic one.
  return platform === 'linux'
    ? `codebook.chromeExecutable: no ${CHROME_LINUX_EXECUTABLE_NAMES.slice(0, -1).join(', ')} or ${CHROME_LINUX_EXECUTABLE_NAMES.at(-1)} is on PATH. Install Google Chrome for Linux (or Chromium), or set codebook.chromeExecutable to its executable path.`
    : 'codebook.chromeExecutable: configure an installed executable Chrome.'
}

/**
 * Takes the version a Chrome executable printed for `--version`, for the prerequisite check of {@link createEnvironment}, which reports an executable that prints none as not installed.
 * @param output - The standard output of the executable.
 * @returns The output without the surrounding white space.
 * @throws When nothing but white space was printed.
 * @example
 * requireChromeVersion('Google Chrome 141.0.7390.54 \n') // => 'Google Chrome 141.0.7390.54'
 */
function requireChromeVersion(output: string): string {
  const version = output.trim()
  if (!version) throw new Error('Missing Chrome version')
  return version
}

/** Installs tracking before creating any runtime; commands retain these observers until owned teardown completes. @example const environment = await createEnvironment(context) */
export async function createEnvironment(
  context: Pick<vscode.ExtensionContext, 'extensionPath'> & {
    /** Where a node-server run keeps its process record for the next activation's orphan check; without it the record lives only in memory. */
    workspaceState?: NodeServerOrphanStore
  },
  presentation?: StudyPresentation,
): Promise<StudyEnvironment & { dispose(): void }> {
  const workspace = requireWorkspace(),
    runs = new Map<string, ConfiguredBrowserRun>()
  const orphanStore = context.workspaceState ?? createMemoryOrphanStore()
  const product = productSchema.parse(
    JSON.parse(
      await readFile(join(vscode.env.appRoot, 'product.json'), 'utf8'),
    ),
  )
  const host: HostConfiguration = {
    id: vscode.env.appName.toLowerCase().includes('cursor')
      ? 'cursor'
      : 'vscode',
    productVersion: product.version,
    apiVersion: vscode.version,
    commit: product.commit,
    browserBackend: 'managed',
  }
  const build = buildSchema.parse(
    JSON.parse(
      await readFile(join(context.extensionPath, 'dist/build.json'), 'utf8'),
    ),
  )
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      const run = [...runs.values()].find((candidate) =>
        candidate.owner(session),
      )
      if (!run) return
      run.addSession(session)
      return {
        onWillReceiveMessage: (message): void => {
          if (message.type === 'request') run.onRequest(session, message)
        },
        onDidSendMessage: (message): void => {
          if (message.type === 'event') run.onEvent(session, message)
          if (message.type === 'response' && 'onResponse' in run)
            run.onResponse(session, message)
        },
        onError: (error): void =>
          run.fail(`Debug adapter error: ${error.message}`),
      }
    },
  })
  const termination = vscode.debug.onDidTerminateDebugSession((session) => {
    for (const run of runs.values())
      if (run.owner(session)) run.terminated(session)
  })
  const focus = vscode.debug.onDidChangeActiveDebugSession((session) => {
    // Closed history must not grow with unrelated future editor activity.
    for (const run of runs.values())
      if (!run.view().cleaned && run.activeSessions.size)
        run.evidence.record('focus.changed', { sessionId: session?.id })
  })
  // One lookup for the window's life: it remembers the last PATH search between prerequisite checks.
  const lookUpChromeExecutable = createChromeExecutableLookup()
  const configuredNodeExecutable = () =>
    resolveExternalNodeExecutable(
      vscode.workspace
        .getConfiguration('codebook')
        .get<string>('nodeExecutable', 'node'),
    )
  // What a node-test run needs of the editor and the machine: the workspace, the bundled debugger and the external Node, without Chrome.
  const resolveNodePrerequisites = async () => {
    const editorMissing = editorPrerequisiteGaps(workspace)
    const nodeMissing = [...editorMissing]
    let nodeExecutable: string | undefined
    try {
      nodeExecutable = await configuredNodeExecutable()
    } catch {
      nodeMissing.push(
        'codebook.nodeExecutable: configure an executable external Node.js >=24.',
      )
    }
    return { nodeMissing, nodeExecutable, editorMissing }
  }
  /**
   * Refuses a Node run whose editor prerequisites or external Node are missing, or whose window's workspace changed, before anything is created; called by the node-test and node-server run factories.
   * @param runName - How the run is named in the stale-workspace refusal (`the Node test`, `the Node server run`).
   * @returns The configured external Node executable.
   * @throws `PREREQUISITE_MISSING` naming every gap; `STALE_INSTANCE` after a workspace change.
   * @example await requireNodeRunPrerequisites('the Node test') // => '/usr/local/bin/node'
   */
  const requireNodeRunPrerequisites = async (
    runName: string,
  ): Promise<string> => {
    const prerequisites = await resolveNodePrerequisites()
    if (prerequisites.nodeMissing.length || !prerequisites.nodeExecutable)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        prerequisites.nodeMissing.join('; '),
      )
    if (requireWorkspace() !== workspace)
      throw new StudyError(
        'STALE_INSTANCE',
        `Workspace identity changed before ${runName}.`,
      )
    return prerequisites.nodeExecutable
  }
  /**
   * Looks Chrome up on this machine apart from Node, so a chrome-extension start never waits on the Node lookup.
   * Called by {@link resolvePrerequisites} and the chrome-extension run factory and start hook.
   * @returns The Chrome executable with its `--version` text when found, and the gaps the lookup itself found.
   * @example await resolveChrome() // => { chromeMissing: [], chrome: { binary: '/usr/bin/google-chrome', version: 'Google Chrome 156.0.8078.74' } }
   */
  const resolveChrome = async () => {
    const chromeMissing: string[] = []
    let chrome: HostConfiguration['chrome']
    const configuration = vscode.workspace.getConfiguration('codebook')
    const binary = await lookUpChromeExecutable(
      configuration.get<string>('chromeExecutable', ''),
      process.platform,
      process.env.PATH,
      (path) =>
        access(path, filesystemConstants.X_OK).then(
          () => true,
          () => false,
        ),
    )
    if (!binary) chromeMissing.push(missingChromeText(process.platform))
    else
      try {
        await access(binary, filesystemConstants.X_OK)
        const version = requireChromeVersion(
          (
            await executeFile(binary, ['--version'], {
              timeout: PREREQUISITE_TIMEOUT_MS,
            })
          ).stdout,
        )
        chrome = { binary, version }
      } catch {
        chromeMissing.push(
          'codebook.chromeExecutable: configure an installed executable Chrome.',
        )
      }
    return { chromeMissing, chrome }
  }
  /**
   * Joins the editor's gaps with the chrome-extension profile's own (system, Chrome, version) for status and for the start's wait.
   * @param editorMissing - The editor gaps (js-debug, workspace identity).
   * @param chromeMissing - What the Chrome lookup found missing.
   * @param chrome - The found Chrome, when any.
   * @returns Every sentence that keeps the profile from running; empty when it can.
   */
  const chromeExtensionGaps = (
    editorMissing: readonly string[],
    chromeMissing: readonly string[],
    chrome: HostConfiguration['chrome'],
  ) => [
    ...editorMissing,
    ...chromeExtensionPrerequisiteGaps({
      platform: process.platform,
      chromeMissing,
      chromeVersion: chrome?.version,
    }),
  ]
  const resolvePrerequisites = async () => {
    const { nodeMissing, nodeExecutable, editorMissing } =
      await resolveNodePrerequisites()
    const { chromeMissing, chrome } = await resolveChrome()
    const missing = [...nodeMissing, ...chromeMissing]
    return {
      ready: missing.length === 0,
      missing,
      nodeMissing,
      editorMissing,
      chromeMissing,
      nodeExecutable,
      chrome,
    }
  }
  // One asker for the window's life, so a retry joins a modal still on screen.
  const askToSendStateChangingRequest = createStateChangingRequestAsker(
    (message, detail, ...items) =>
      vscode.window.showWarningMessage(
        message,
        { modal: true, detail },
        ...items,
      ),
  )
  return {
    workspace,
    host,
    remoteName: vscode.env.remoteName,
    build,
    assertWorkspace(): void {
      if (requireWorkspace() !== workspace)
        throw new StudyError(
          'STALE_INSTANCE',
          'Workspace identity changed; reconnect before reading or publishing repository content.',
        )
    },
    prerequisites: async () => {
      let ownedConfiguredLock: DevelopmentLockIdentity | undefined
      let preparingConfiguredRun = false,
        releasingConfiguredRun = false
      // Only one live configured run may own this workspace lock; status still checks the surrounding build.
      for (const run of runs.values()) {
        if (run instanceof ConfiguredBrowserRun) {
          preparingConfiguredRun ||= run.view().status === 'preparing'
          releasingConfiguredRun ||= run.isCleaning()
          ownedConfiguredLock = run.ownsDevelopmentLock()
        }
        if (ownedConfiguredLock) break
      }
      const [
        {
          ready,
          missing,
          nodeMissing,
          editorMissing,
          chromeMissing,
          chrome,
          nodeExecutable,
        },
        checkedConfigured,
        vitestSearch,
        machineMissing,
      ] = await Promise.all([
        resolvePrerequisites(),
        // Even during a run, recheck dependencies and directories; only its exact live lock is permitted.
        assertDevelopmentWorkspace(
          workspace,
          new AbortController().signal,
          ownedConfiguredLock,
        ).then(
          () => [],
          (error) => [String(error)],
        ),
        // A usable Vitest at the root or in a package up to two levels below it is named before any start (X9); a start checks its test's own.
        searchRepositoryVitest(workspace).catch((error: unknown) => ({
          vitestSearch: 'incomplete' as const,
          // The reason reaches the agent in codebook_status, so it names no private path (F10).
          missing: `node-test could not finish looking for Vitest in the repository: ${sanitizeCause(error, causeRootsFor([], workspace))}. A start still checks the cited test's own package.`,
        })),
        // The machine's part of node-server: a supported system, a listener tool and ps.
        nodeServerMachineGaps(),
      ])
      // A managed run that is preparing or releasing blocks a new start under either adapter.
      const managedRunState = releasingConfiguredRun
        ? [
            'Codebook is releasing its managed run. Read the current run error and retry Stop if cleanup fails.',
          ]
        : preparingConfiguredRun
          ? [
              'Codebook is preparing its managed repository run. Poll the current run; do not stop its process or remove its lock.',
            ]
          : []
      // A preparing run may have created its lock before it has sealed ownership; never label that interval foreign.
      const configured = managedRunState.length
        ? [
            ...checkedConfigured.filter(
              (message) => !message.includes('Next development build lock'),
            ),
            ...managedRunState,
          ]
        : checkedConfigured
      const check = (specific: string[]) => ({
        ready: ready && specific.length === 0,
        missing: [...missing, ...specific],
      })
      const adapters = await readRepositoryAdapterReadiness(
        workspace,
        nodeExecutable,
        new AbortController().signal,
      )
      return {
        ready,
        missing,
        profiles: {
          'repository-browser': {
            ...check(configured),
            adapters: {
              ...adapters,
              // A vite-dev start needs the shared prerequisites, Vite's own gates and no other managed run; Next's workspace checks do not apply to it, so a Vite app without Next can start.
              'vite-dev': {
                ...adapters['vite-dev'],
                ...check([...adapters['vite-dev'].missing, ...managedRunState]),
              },
            },
          },
          'node-test': {
            ready:
              nodeMissing.length === 0 &&
              vitestSearch.vitestSearch === 'usable',
            missing: [
              ...nodeMissing,
              ...('missing' in vitestSearch ? [vitestSearch.missing] : []),
            ],
            vitestSearch: vitestSearch.vitestSearch,
          },
          'node-server': {
            ready: nodeMissing.length === 0 && machineMissing.length === 0,
            missing: [...nodeMissing, ...machineMissing],
          },
          'chrome-extension': (() => {
            // The editor's gaps (a disabled js-debug, a workspace mismatch) count; the Node executable does not.
            const gaps = chromeExtensionGaps(
              editorMissing,
              chromeMissing,
              chrome,
            )
            return { ready: gaps.length === 0, missing: gaps }
          })(),
        },
      }
    },
    async createRuntime(
      directory: string,
      profile: RuntimeDefinition,
      control?: RuntimeControl,
    ): Promise<StudyRuntime> {
      const prerequisites = await resolvePrerequisites()
      if (
        !prerequisites.ready ||
        !prerequisites.nodeExecutable ||
        !prerequisites.chrome
      )
        throw new StudyError(
          'PREREQUISITE_MISSING',
          prerequisites.missing.join('; '),
        )
      control?.signal.throwIfAborted()
      // A released run gets no further debugger events; keeping it would hold its journal and script maps for the window's life.
      for (const [id, released] of runs)
        if (released.view().cleaned) runs.delete(id)
      const run = new ConfiguredBrowserRun({
        directory,
        workspace,
        definition: profile,
        control,
        node: prerequisites.nodeExecutable,
        host: { ...host, chrome: prerequisites.chrome },
        assertWorkspace() {
          if (requireWorkspace() !== workspace)
            throw new StudyError(
              'STALE_INSTANCE',
              'Workspace identity changed during the configured study.',
            )
        },
        createViewport: presentation?.createViewport,
        revealSource: async (snapshot) => {
          const index = run
            .view()
            .snapshots.findIndex((candidate) => candidate.id === snapshot.id)
          const stop = configuredStops(profile.configuration)[index]
          if (!stop)
            throw new StudyError(
              'EVIDENCE_UNAVAILABLE',
              'Captured source stop is unavailable.',
            )
          if (
            !(await presentation?.revealSource(
              snapshot,
              join(workspace, stop.source.path),
            ))
          )
            throw new StudyError(
              'EVIDENCE_UNAVAILABLE',
              'Open the Study reader to inspect this immutable captured source.',
            )
        },
      })
      runs.set(run.id, run)
      return run
    },
    async nodeServerStartPrerequisites() {
      const [{ nodeMissing }, machineMissing] = await Promise.all([
        resolveNodePrerequisites(),
        nodeServerMachineGaps(),
      ])
      const missing = [...nodeMissing, ...machineMissing]
      return { ready: missing.length === 0, missing }
    },
    async nodeTestStartPrerequisites() {
      const { nodeMissing } = await resolveNodePrerequisites()
      return { ready: nodeMissing.length === 0, missing: nodeMissing }
    },
    async checkNodeTestFiles(
      configuration: NodeTestConfiguration,
      citedSources: ConfiguredDescriptor['sources'],
      control: NodeTestPreparationControl,
    ) {
      // The owned run's own checks, made before the history begins: a refusal leaves no zero-entry history behind (F57).
      assertConfiguredSourceDocuments(
        workspace,
        citedSources,
        vscode.workspace.textDocuments,
      )
      const { root, testFile } = await checkNodeTestFiles(
        workspace,
        configuration,
      )
      return planNodeTestExecution({
        root,
        testFile,
        declaredTestFile: configuration.testFile,
        // The Node executable is looked up only when a root claim lists from the root.
        listRootClaim: async (request) =>
          listVitestForRootClaim(request, {
            node: await configuredNodeExecutable(),
            cancellation: control.signal,
            deadlineAt: control.deadlineAt,
            now: control.now,
            onReleaseFailed: control.onListingNotReleased,
          }),
      })
    },
    async createNodeTestRun(
      configuration: NodeTestConfiguration,
      record: (type: string, detail?: unknown) => unknown,
      citedSources: ConfiguredDescriptor['sources'],
      plan: NodeTestExecutionPlan | undefined,
    ) {
      if (!plan)
        throw new StudyError(
          'PREREQUISITE_MISSING',
          'The node-test run has no execution plan from its preparation check.',
        )
      const nodeExecutable = await requireNodeRunPrerequisites('the Node test')
      // Load the VS Code-backed owner only after a caller selects this profile; environment unit tests run in plain Node.
      const { OwnedNodeTestRun } = await import('./ownedNodeTestRun.js')
      return new OwnedNodeTestRun(
        workspace,
        configuration,
        nodeExecutable,
        record,
        citedSources,
        plan,
      )
    },
    async createNodeServerRun(
      configuration: NodeServerConfiguration,
      record: (type: string, detail?: unknown) => unknown,
      citedSources: ConfiguredDescriptor['sources'],
      runId: string,
      history?: NodeServerHistorySink,
      privateRoots?: CauseRoots,
    ) {
      const node = await resolveExternalNode(
        await requireNodeRunPrerequisites('the Node server run'),
      )
      // Load the VS Code-backed run only after a caller selects this profile; environment unit tests run in plain Node.
      const [
        { createOwnedNodeServerRun },
        { createProductNodeServerRunDependencies },
      ] = await Promise.all([
        import('./ownedNodeServerRun.js'),
        import('./nodeServerRunDependencies.js'),
      ])
      return createOwnedNodeServerRun({
        workspace,
        configuration,
        record,
        citedSources,
        runId,
        history,
        ...(privateRoots ? { privateRoots } : {}),
        dependencies: createProductNodeServerRunDependencies({
          node,
          utilities: createNodeServerRunUtilities(orphanStore),
        }),
      })
    },
    async chromeExtensionStartPrerequisites() {
      const { chromeMissing, chrome } = await resolveChrome()
      const missing = chromeExtensionGaps(
        editorPrerequisiteGaps(workspace),
        chromeMissing,
        chrome,
      )
      return { ready: missing.length === 0, missing }
    },
    async createChromeExtensionRun(input: ChromeExtensionRunInput) {
      const { chrome, chromeMissing } = await resolveChrome()
      const gaps = chromeExtensionPrerequisiteGaps({
        platform: process.platform,
        chromeMissing,
        chromeVersion: chrome?.version,
      })
      // An unsupported system or a missing Chrome stays PREREQUISITE_MISSING; a found but too old Chrome has its own code and sentence.
      if (chrome === undefined || process.platform === 'win32')
        throw new StudyError(
          'PREREQUISITE_MISSING',
          gaps.join('; ') || 'Chrome is not installed.',
        )
      assertSupportedChromeVersion(chrome.version)
      if (requireWorkspace() !== workspace)
        throw new StudyError(
          'STALE_INSTANCE',
          'Workspace identity changed before the extension run.',
        )
      // Load the VS Code-backed run only after a caller selects this profile; environment unit tests run in plain Node.
      const [
        { createOwnedChromeExtensionRun },
        { createProductChromeExtensionRunDependencies },
      ] = await Promise.all([
        import('./ownedChromeExtensionRun.js'),
        import('./chromeExtensionRunDependencies.js'),
      ])
      return createOwnedChromeExtensionRun({
        ...input,
        workspace,
        ...(presentation?.createChromeExtensionViewport
          ? { createViewport: presentation.createChromeExtensionViewport }
          : {}),
        dependencies: createProductChromeExtensionRunDependencies({
          workspace,
          chromeExecutable: chrome.binary,
          profileRoot: managedProfileRoot(process.platform, {
            environment: process.env,
            homeDirectory: homedir,
          }),
        }),
      })
    },
    confirmStateChangingRequest: askToSendStateChangingRequest,
    dispose(): void {
      tracker.dispose()
      termination.dispose()
      focus.dispose()
    },
  }
}
