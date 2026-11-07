import { createHash } from 'node:crypto'
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { LIBRARY_PACK_ERROR_STEPS } from './constants'
import {
  EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
  EXTENSION_BUILD_GIT_TIMEOUT_MS,
  LIBRARY_BUILD_TIMEOUT_MS,
  LIBRARY_CLEANUP_BOUND_MS,
  LIBRARY_OBSERVATION_LIMIT_BYTES,
} from './constants'
import type { NodeScriptConfiguration } from './nodeScriptConfigSchemas'
import {
  assertLibraryRouteSupported,
  libraryBuildPath,
  type SupportedLibrary,
} from './utils/assertLibraryRouteSupported'
import { buildProcessEnvironment } from './utils/buildProcessEnvironment'
import type {
  BuildClock,
  BuildProcess,
  BuildSpawner,
} from './utils/buildProcessTypes'
import { createBuildSpawner } from './utils/createBuildSpawner'
import { createLibraryBuildError } from './utils/createLibraryBuildError'
import { endBuildTree } from './utils/endBuildTree'
import { extractPackageTarball } from './utils/extractPackageTarball'
import { findChangedTrackedFile } from './utils/findChangedTrackedFile'
import { hashTrackedFiles } from './utils/hashTrackedFiles'
import {
  buildLibraryHookSource,
  type LibraryHookConfiguration,
} from './utils/libraryHookScript'
import { listTrackedFiles } from './utils/listTrackedFiles'
import { readInstalledPackageManifest } from './utils/readInstalledPackageManifest'
import {
  readLibraryObservation,
  type LibraryObservation,
} from './utils/readLibraryObservation'
import { runBuildProcess, type BuildProcessEnd } from './utils/runBuildProcess'
import { runOpenedFolderGit } from './utils/runOpenedFolderGit'
import { settledWithin } from './utils/settledWithin'
import { sleepUntilAborted } from './utils/sleepUntilAborted'

const productionClock: BuildClock = {
  nowMs: () => Date.now(),
  delay: sleepUntilAborted,
}

/** The name of the hook file inside the run's private folder. */
const HOOK_FILE_NAME = 'library-hook.mjs'

/** The name of the anchor file the Vite redirect resolves from, inside the run's private folder. */
const LIBRARY_ANCHOR_FILE_NAME = 'codebook-anchor.js'

/** The name of the observation file inside the run's private folder. */
const OBSERVATION_FILE_NAME = 'library-observation.jsonl'

/** The folders and roots of one library run, all real paths except where noted. */
export type LibraryPackageRoots = {
  /** The Git repository root. */
  repositoryRoot: string
  /** The Example's package folder (`packageRoot` of the configuration), inside the repository. */
  examplePackageRoot: string
  /** The run's private folder: it must exist; the tarball, the unpacked package, the hook and the observation file live in it, and {@link LibraryPackage.dispose} removes all of it. */
  privateFolder: string
}

/** What {@link prepareLibraryPackage} is given besides the configuration and the roots; tests pass their own spawner, clock and revision reader. */
export type LibraryPackageDependencies = {
  /** The resolved external Node, or none. */
  node: { executable: string; version: string } | undefined
  /** The run's stop: aborting it ends the build and pack. */
  signal: AbortSignal
  clock?: BuildClock
  spawner?: BuildSpawner
  /** The extension host's environment the build's allow-listed environment is taken from. */
  hostEnvironment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isProgramFile?: (path: string) => Promise<boolean>
  /** Reads the repository's HEAD; the real `git rev-parse HEAD` unless a test names its own. */
  readRevision?: (repositoryRoot: string) => Promise<string>
  /** How long a removal that follows a failure or a stop is waited for. */
  cleanupBoundMs?: number
}

/** The correspondence facts of a built and packed library. */
export type LibraryPackageFacts = {
  package: string
  version: string
  /** The declared `library.packageRoot`. */
  packageRoot: string
  /** The repository's HEAD before the build (40 hex characters). */
  revision: string
  /** Whether the library folder had uncommitted or untracked changes before the build. */
  dirty: boolean
  packageManager: { name: 'pnpm' | 'npm'; version: string | null }
  buildMs: number
  packMs: number
  tarballSha256: string
  /** The version the Example's own `node_modules` holds of the package, or `null`. */
  installedVersion: string | null
}

/** The answer of {@link LibraryPackage.dispose}. */
export type LibraryCleanup = { cleanup: 'removed' | 'pending' }

/** A built and packed library, ready for the script. */
export type LibraryPackage = {
  /** `['--import', <hook file URL>]`; the caller places it after the `tsx` loader when one is declared. */
  nodeArguments: string[]
  facts: LibraryPackageFacts
  /** Reads the observation file after the script's process tree ended. */
  finishObservation(): Promise<LibraryObservation>
  /** Removes the private folder, waiting at most `boundMs` (default {@link LIBRARY_CLEANUP_BOUND_MS}); `pending` while the removal continues in the background. */
  dispose(boundMs?: number): Promise<LibraryCleanup>
}

/**
 * Raised when the run's stop ended the build or pack and the repository is verified unchanged: the caller commits today's stop error. The private folder is already removed or its removal is pending.
 */
export class LibraryPackageCancelled extends Error {
  constructor(readonly cleanup: LibraryCleanup['cleanup']) {
    super('The library build was stopped.')
  }
}

/** One failure of a build step, before the source checks decide which error wins. */
type StepFailure = {
  reason: 'build-error' | 'timeout' | 'pack-error'
  sentence: string
  details: Record<string, unknown>
}

/** What the unpacked tarball tells: its digest and the parts of its `package.json` the redirect needs. */
type PackedManifest = {
  tarballSha256: string
  version: string
  /** The names in the packed `peerDependencies`. */
  peers: string[]
  /** The packed `package.json` `imports` map (`#` package imports), or `undefined` when it has none. */
  imports: Record<string, unknown> | undefined
}

/** What the build and pack steps produced. */
type StepsResult = {
  failure?: StepFailure
  wasCancelled: boolean
  endings: BuildProcessEnd[]
  buildMs: number
  packMs: number
  packed?: PackedManifest
}

/** Everything the steps share. */
type RouteContext = {
  library: SupportedLibrary
  roots: LibraryPackageRoots & { privateFolder: string }
  dependencies: LibraryPackageDependencies
  clock: BuildClock
  spawner: BuildSpawner
  environment: NodeJS.ProcessEnv
  commandDetails: { packageManager: string; nodeVersion: string }
  /** Every process the spawner started, so a failure can end the trees still running. */
  processes: BuildProcess[]
}

/** The shared context once the snapshot is taken and the build-and-pack budget runs. */
type BudgetedContext = RouteContext & {
  /** When the shared budget of the build and the pack ends, by the clock. */
  deadlineMs: number
}

/** The default revision reader: HEAD as 40 hexadecimal characters. */
async function readHeadRevision(repositoryRoot: string): Promise<string> {
  const output = await runOpenedFolderGit(
    repositoryRoot,
    ['rev-parse', 'HEAD'],
    {
      timeoutMs: EXTENSION_BUILD_GIT_TIMEOUT_MS,
      maxBuffer: 1024,
    },
  )
  return output.trim()
}

/** Whether the library folder has uncommitted changes or untracked files. */
async function readDirty(libraryRoot: string): Promise<boolean> {
  const output = await runOpenedFolderGit(
    libraryRoot,
    ['status', '--porcelain', '--', '.'],
    {
      timeoutMs: EXTENSION_BUILD_GIT_TIMEOUT_MS,
      maxBuffer: EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
    },
  )
  return output.trim() !== ''
}

/** The `<pm> run build` or pack argument list of a manager. */
function packArguments(
  library: SupportedLibrary,
  privateFolder: string,
): string[] {
  return library.packageManager.name === 'pnpm'
    ? [
        'pack',
        '--pack-destination',
        privateFolder,
        '--config.ignore-scripts=true',
      ]
    : ['pack', '--pack-destination', privateFolder, '--ignore-scripts']
}

/** The failure of a process that did not finish cleanly, or `undefined` when it exited with code 0. */
function processFailure(
  context: RouteContext,
  step: 'build' | 'pack',
  end: BuildProcessEnd,
  command: string,
): StepFailure | undefined {
  const lines = end.outputLines.join('\n')
  const details = {
    ...context.commandDetails,
    command: `${command} in ${context.library.relativeRoot}`,
  }
  if (end.ending === 'timeout')
    return {
      reason: 'timeout',
      sentence: `The library ${step} was stopped after its time limit and its processes were ended.\n${lines}`,
      details,
    }
  if (end.ending === 'cancelled' || end.exit?.code === 0) return undefined
  return {
    reason: step === 'build' ? 'build-error' : 'pack-error',
    sentence: `The library ${step} ended with an error. Last output lines:\n${lines}`,
    details: {
      ...details,
      ...(step === 'pack'
        ? { step: 'pack' satisfies (typeof LIBRARY_PACK_ERROR_STEPS)[number] }
        : {}),
      exitCode: end.exit?.code ?? null,
      signal: end.exit?.signal ?? null,
    },
  }
}

/** Runs one manager command in the library folder under what is left of the shared budget. */
async function runManagerCommand(
  context: BudgetedContext,
  commandArguments: string[],
): Promise<BuildProcessEnd | undefined> {
  const remainingMs = context.deadlineMs - context.clock.nowMs()
  // The budget was used up by the earlier step.
  if (remainingMs <= 0) return undefined
  return runBuildProcess(
    {
      executable: context.library.packageManager.executable,
      arguments: commandArguments,
      cwd: context.library.libraryRoot,
      environment: context.environment,
    },
    context.spawner,
    context.clock,
    context.dependencies.signal,
    remainingMs,
  )
}

/** A `pack-error` failure for a step of the pack that is not the process itself. */
function packStepFailure(
  context: RouteContext,
  step: (typeof LIBRARY_PACK_ERROR_STEPS)[number],
  sentence: string,
): StepFailure {
  return {
    reason: 'pack-error',
    sentence,
    details: { ...context.commandDetails, step },
  }
}

/** The message of a thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether an error says the file does not exist. */
function isFileMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
}

/** One top-level field of a parsed `package.json`, or `undefined` when the manifest is not an object. */
function manifestField(manifest: unknown, field: string): unknown {
  return typeof manifest === 'object' && manifest !== null
    ? Reflect.get(manifest, field)
    : undefined
}

/** The names in a packed `peerDependencies` value; none for anything that is not an object. */
function packedPeerNames(peerValue: unknown): string[] {
  return typeof peerValue === 'object' && peerValue !== null
    ? Object.keys(peerValue)
    : []
}

/** The packed `imports` map; a non-object or an array is not a valid map and reads as none. */
function packedImportsMap(
  importsValue: unknown,
): Record<string, unknown> | undefined {
  if (
    typeof importsValue !== 'object' ||
    importsValue === null ||
    Array.isArray(importsValue)
  )
    return undefined
  return Object.fromEntries(Object.entries(importsValue))
}

/** Finds the one tarball, unpacks it into `node_modules/<name>` and reads its manifest. */
async function unpackTarball(
  context: RouteContext,
): Promise<{ failure: StepFailure } | PackedManifest> {
  const { privateFolder } = context.roots
  let tarballs: string[]
  try {
    tarballs = (await readdir(privateFolder)).filter((name) =>
      name.endsWith('.tgz'),
    )
  } catch (error) {
    return {
      failure: packStepFailure(
        context,
        'tarball',
        `The private folder could not be listed after the pack: ${describeError(error)}`,
      ),
    }
  }
  if (tarballs.length !== 1)
    return {
      failure: packStepFailure(
        context,
        'tarball',
        `The pack left ${tarballs.length} tarballs in the private folder; exactly one was expected.`,
      ),
    }
  const tarballPath = join(privateFolder, tarballs[0] ?? '')
  const packedFolder = join(privateFolder, 'node_modules', context.library.name)
  try {
    await extractPackageTarball(tarballPath, packedFolder)
  } catch (error) {
    return {
      failure: packStepFailure(
        context,
        'unpack',
        `The tarball could not be unpacked: ${describeError(error)}`,
      ),
    }
  }
  let manifest: unknown
  try {
    manifest = await readFile(join(packedFolder, 'package.json'), 'utf8').then(
      (text): unknown => JSON.parse(text),
      (error: unknown): unknown => {
        // A missing file reads as no manifest; the name check below answers it.
        if (isFileMissing(error)) return undefined
        throw error
      },
    )
  } catch (error) {
    return {
      failure: packStepFailure(
        context,
        'metadata',
        `The packed package.json could not be read: ${describeError(error)}`,
      ),
    }
  }
  const name = manifestField(manifest, 'name')
  const version = manifestField(manifest, 'version')
  if (name !== context.library.name || typeof version !== 'string')
    return {
      failure: packStepFailure(
        context,
        'metadata',
        `The packed package.json names ${String(name)} ${String(version)}, not ${context.library.name} with a version.`,
      ),
    }
  return {
    tarballSha256: createHash('sha256')
      .update(await readFile(tarballPath))
      .digest('hex'),
    version,
    peers: packedPeerNames(manifestField(manifest, 'peerDependencies')),
    imports: packedImportsMap(manifestField(manifest, 'imports')),
  }
}

/** Packs the build into the private folder and unpacks it. */
async function packLibrary(context: BudgetedContext): Promise<{
  end: BuildProcessEnd | undefined
  failure?: StepFailure
  packed?: StepsResult['packed']
}> {
  const command = `${context.library.packageManager.name} pack`
  const end = await runManagerCommand(
    context,
    packArguments(context.library, context.roots.privateFolder),
  )
  if (end === undefined)
    return {
      end,
      failure: {
        reason: 'timeout',
        sentence: 'The library build used up the whole time limit.',
        details: { ...context.commandDetails, command },
      },
    }
  const failure = processFailure(context, 'pack', end, command)
  if (failure !== undefined || end.ending === 'cancelled')
    return { end, failure }
  const unpacked = await unpackTarball(context)
  return 'failure' in unpacked
    ? { end, failure: unpacked.failure }
    : { end, packed: unpacked }
}

/** Ends every process tree still running; a failure to end one is left to the late removal in {@link abandonPrivateFolder}. */
async function endRunningTrees(context: RouteContext): Promise<void> {
  const running = context.processes.filter((process) => !process.isTreeGone())
  await Promise.all(
    running.map((process) =>
      endBuildTree(process, context.clock).catch(() => false),
    ),
  )
}

/** Runs the build, then the pack, and reports what happened; an unexpected throw becomes a `pack-error` with the step it happened in, after the running trees were ended. The source checks come after. */
async function runBuildAndPack(context: RouteContext): Promise<StepsResult> {
  const progress = { step: 'build' as 'build' | 'pack' }
  try {
    return await runBuildAndPackSteps(
      {
        ...context,
        deadlineMs: context.clock.nowMs() + LIBRARY_BUILD_TIMEOUT_MS,
      },
      progress,
    )
  } catch (error) {
    await endRunningTrees(context)
    return {
      failure: packStepFailure(
        context,
        progress.step,
        `The library ${progress.step} stopped unexpectedly: ${describeError(error)}`,
      ),
      wasCancelled: false,
      endings: [],
      buildMs: 0,
      packMs: 0,
    }
  }
}

/** The build, then the pack, under one budget that started when this was called. */
async function runBuildAndPackSteps(
  context: BudgetedContext,
  progress: { step: 'build' | 'pack' },
): Promise<StepsResult> {
  const { clock, dependencies } = context
  const buildStartMs = clock.nowMs()
  const buildCommand = `${context.library.packageManager.name} run build`
  const buildEnd = await runManagerCommand(context, ['run', 'build'])
  const buildMs = clock.nowMs() - buildStartMs
  const endings = buildEnd === undefined ? [] : [buildEnd]
  const buildFailure =
    buildEnd === undefined
      ? undefined
      : processFailure(context, 'build', buildEnd, buildCommand)
  if (buildFailure !== undefined)
    return {
      failure: buildFailure,
      wasCancelled: false,
      endings,
      buildMs,
      packMs: 0,
    }
  // A stop during the build, or just after it, leaves no pack to run.
  if (buildEnd?.ending === 'cancelled' || dependencies.signal.aborted)
    return { wasCancelled: true, endings, buildMs, packMs: 0 }
  progress.step = 'pack'
  const packStartMs = clock.nowMs()
  const pack = await packLibrary(context)
  const packMs = clock.nowMs() - packStartMs
  return {
    failure: pack.failure,
    wasCancelled: pack.end?.ending === 'cancelled',
    endings: pack.end === undefined ? endings : [...endings, pack.end],
    buildMs,
    packMs,
    packed: pack.packed,
  }
}

/** What the source checks found, in the order of precedence, or `undefined` when the sources are verified unchanged. */
async function judgeSource(
  context: RouteContext,
  snapshot: Map<string, string>,
  revisionBefore: string,
  allTreesEnded: boolean,
): Promise<
  | { reason: string; sentence: string; details: Record<string, unknown> }
  | undefined
> {
  const { repositoryRoot } = context.roots
  const readRevision = context.dependencies.readRevision ?? readHeadRevision
  let comparison: Awaited<ReturnType<typeof findChangedTrackedFile>>
  try {
    comparison = await findChangedTrackedFile(
      repositoryRoot,
      snapshot,
      'tracked-and-untracked',
    )
  } catch {
    comparison = { kind: 'unverified', path: '' }
  }
  // A failing HEAD read must not replace the comparison result: a changed file still outranks it.
  const revisionAfter: string | undefined = await readRevision(
    repositoryRoot,
  ).catch(() => undefined)
  if (comparison?.kind === 'changed')
    return {
      reason: 'tracked-file-changed',
      sentence: `The library build changed the file ${comparison.path}; Codebook did not restore it.`,
      details: { path: comparison.path },
    }
  if (
    comparison?.kind === 'unverified' ||
    !allTreesEnded ||
    revisionAfter === undefined
  )
    return {
      reason: 'tracked-files-unverified',
      sentence:
        "The repository's files or the build's processes could not be checked, so the build's effect on the sources could not be verified.",
      details: comparison?.path ? { path: comparison.path } : {},
    }
  if (revisionAfter !== revisionBefore)
    return {
      reason: 'source-changed',
      sentence: `The repository's HEAD moved from ${revisionBefore} to ${String(revisionAfter)} while the library was built.`,
      details: { revision: { before: revisionBefore, after: revisionAfter } },
    }
  return undefined
}

/** Removes a folder, resolving to whether it is gone. */
function removeFolder(folder: string): Promise<boolean> {
  return rm(folder, { recursive: true, force: true }).then(
    () => true,
    () => false,
  )
}

/** Waits for a removal at most `boundMs`; `pending` while it continues. */
async function awaitRemoval(
  removal: Promise<boolean>,
  boundMs: number,
): Promise<LibraryCleanup['cleanup']> {
  const isSettled = await settledWithin(removal, boundMs)
  return isSettled && (await removal) ? 'removed' : 'pending'
}

/** Removes the private folder after a failure or stop; a tree that is not confirmed ended is killed and the folder removed when it ends. */
async function abandonPrivateFolder(
  folder: string,
  processes: BuildProcess[],
  boundMs: number,
): Promise<LibraryCleanup['cleanup']> {
  const unfinished = processes.filter((process) => !process.isTreeGone())
  if (unfinished.length === 0)
    return awaitRemoval(removeFolder(folder), boundMs)
  for (const process of unfinished) {
    try {
      process.signalTree('SIGKILL')
    } catch {
      // The late removal below still waits for the tree.
    }
  }
  void Promise.all(unfinished.map((process) => process.treeGone)).then(() =>
    removeFolder(folder),
  )
  return 'pending'
}

/** Writes the hook and the empty observation file; returns the hook's `--import` argument list. */
async function writeHook(
  prepared: PreparedLibraryCore,
  exampleRoot: string,
): Promise<string[]> {
  const { privateFolder } = prepared
  const configuration: LibraryHookConfiguration = {
    packageName: prepared.facts.package,
    packedRoot: prepared.packedRoot,
    privateFolder,
    exampleRoot,
    libraryRoot: prepared.libraryRoot,
    peers: prepared.peers,
    observationFile: join(privateFolder, OBSERVATION_FILE_NAME),
    observationLimitBytes: LIBRARY_OBSERVATION_LIMIT_BYTES,
  }
  const hookFile = join(privateFolder, HOOK_FILE_NAME)
  await mkdir(privateFolder, { recursive: true })
  await writeFile(hookFile, buildLibraryHookSource(configuration))
  // The hook never truncates; every observed process appends to this empty file.
  await writeFile(configuration.observationFile, '')
  return ['--import', pathToFileURL(hookFile).href]
}

/** What {@link prepareLibraryCore} hands to a runtime-specific step (the Node hook or the Vite redirect). */
export type PreparedLibraryCore = {
  /** The correspondence facts of the built and packed library. */
  facts: LibraryPackageFacts
  /** The real path of the unpacked packed package, `<private>/node_modules/<name>`. */
  packedRoot: string
  /** The names in the packed `peerDependencies`; the Example supplies these, never the library's install. */
  peers: string[]
  /** The packed `package.json` `imports` map, or `undefined` when it has none. */
  imports: Record<string, unknown> | undefined
  /** The library package folder (real path), whose installed `node_modules` supplies the library's other dependencies. */
  libraryRoot: string
  /** The run's private folder (real path). */
  privateFolder: string
  /** Removes the private folder, waiting at most `boundMs` (default {@link LIBRARY_CLEANUP_BOUND_MS}); `pending` while the removal continues in the background. */
  dispose(boundMs?: number): Promise<LibraryCleanup>
  /** Ends the preparation as a `LIBRARY_BUILD_FAILED` `pack-error` with step `link` after a runtime-specific step failed; the private folder is removed first. */
  failLink(sentence: string): Promise<never>
}

/**
 * Builds the checked-out library with the repository's package manager, packs it into the run's private folder and unpacks it to `<private>/node_modules/<name>`: the part of the library route both runtimes share.
 *
 * Order: the checks (nothing starts when one fails); the source snapshot of the whole repository and HEAD; `<pm> run build` in the library folder; a script-free pack into the private folder, unpacked into `node_modules/<name>`; then, on every ending, the process trees confirmed ended and the snapshot and HEAD compared. Precedence: `tracked-file-changed`, `tracked-files-unverified`, `source-changed`, `timeout`, `pack-error`, `build-error`.
 * Called by {@link prepareLibraryPackage} (the `node-script` route, which adds the resolve hook) and by the Vite library route (which adds the anchor file and the redirect plugin). Its input is the declared folder and the roots, not a runtime configuration.
 * @param declared - The declared `library.packageRoot`, relative to the repository root.
 * @param roots - The repository, the Example's folder and the run's private folder.
 * @param dependencies - The external Node, the stop signal and test seams.
 * @returns The packed root, the packed manifest facts, the correspondence facts and the disposer.
 * @throws `StudyError` `LIBRARY_BUILD_UNSUPPORTED` (nothing started) or `LIBRARY_BUILD_FAILED` (`details.cleanup` says whether the private folder is `removed` or `pending`); {@link LibraryPackageCancelled} when the stop ended the build and the sources are verified unchanged.
 * @example
 * const prepared = await prepareLibraryCore('packages/toolkit', roots, { node, signal })
 * // => { packedRoot: '/tmp/run/node_modules/@reduxjs/toolkit', peers: ['react', 'react-redux'], facts: { package: '@reduxjs/toolkit', … }, … }
 */
export async function prepareLibraryCore(
  declared: string,
  roots: LibraryPackageRoots,
  dependencies: LibraryPackageDependencies,
): Promise<PreparedLibraryCore> {
  const clock = dependencies.clock ?? productionClock
  const baseSpawner = dependencies.spawner ?? createBuildSpawner
  const hostEnvironment = dependencies.hostEnvironment ?? process.env
  const pathText = libraryBuildPath(
    dependencies.node?.executable,
    hostEnvironment.PATH ?? '',
  )
  const library = await assertLibraryRouteSupported({
    repositoryRoot: roots.repositoryRoot,
    examplePackageRoot: roots.examplePackageRoot,
    declaredPackageRoot: declared,
    node: dependencies.node,
    pathText,
    platform: dependencies.platform,
    isProgramFile: dependencies.isProgramFile,
  })
  const privateFolder = await realpath(roots.privateFolder)
  const processes: BuildProcess[] = []
  const context: RouteContext = {
    library,
    roots: { ...roots, privateFolder },
    dependencies,
    clock,
    spawner: (request) => {
      const started = baseSpawner(request)
      processes.push(started)
      return started
    },
    environment: buildProcessEnvironment(hostEnvironment, { PATH: pathText }),
    commandDetails: {
      packageManager: library.packageManager.version
        ? `${library.packageManager.name}@${library.packageManager.version}`
        : library.packageManager.name,
      nodeVersion: dependencies.node?.version ?? 'none',
    },
    processes,
  }
  const cleanupBoundMs = dependencies.cleanupBoundMs ?? LIBRARY_CLEANUP_BOUND_MS
  const fail = async (
    reason: string,
    sentence: string,
    details: Record<string, unknown>,
  ): Promise<never> => {
    const cleanup = await abandonPrivateFolder(
      privateFolder,
      processes,
      cleanupBoundMs,
    )
    throw createLibraryBuildError('LIBRARY_BUILD_FAILED', reason, sentence, {
      ...context.commandDetails,
      ...details,
      cleanup,
    })
  }
  const before = await takeSourceBefore(context).catch((error: unknown) =>
    fail(
      'tracked-files-unverified',
      `The repository's files could not be read before the build: ${error instanceof Error ? error.message : String(error)}`,
      {},
    ),
  )
  if (dependencies.signal.aborted)
    throw new LibraryPackageCancelled(
      await abandonPrivateFolder(privateFolder, processes, cleanupBoundMs),
    )
  const steps = await runBuildAndPack(context)
  const sourceProblem = await judgeSource(
    context,
    before.snapshot,
    before.revision,
    steps.endings.every((end) => end.treeEnded) &&
      processes.every((process) => process.isTreeGone()),
  )
  if (sourceProblem !== undefined)
    return fail(
      sourceProblem.reason,
      sourceProblem.sentence,
      sourceProblem.details,
    )
  if (steps.failure !== undefined)
    return fail(
      steps.failure.reason,
      steps.failure.sentence,
      steps.failure.details,
    )
  if (steps.wasCancelled || steps.packed === undefined)
    throw new LibraryPackageCancelled(
      await abandonPrivateFolder(privateFolder, processes, cleanupBoundMs),
    )
  const packed = steps.packed
  const packedRoot = await realpath(
    join(privateFolder, 'node_modules', library.name),
  ).catch((error: unknown) =>
    fail(
      'pack-error',
      `The packed folder could not be resolved: ${describeError(error)}`,
      { step: 'unpack' satisfies (typeof LIBRARY_PACK_ERROR_STEPS)[number] },
    ),
  )
  const installed = await readInstalledPackageManifest(
    roots.examplePackageRoot,
    library.name,
  )
  let removal: Promise<boolean> | undefined
  return {
    facts: {
      package: library.name,
      version: packed.version,
      packageRoot: declared,
      revision: before.revision,
      dirty: before.dirty,
      packageManager: {
        name: library.packageManager.name,
        version: library.packageManager.version,
      },
      buildMs: steps.buildMs,
      packMs: steps.packMs,
      tarballSha256: packed.tarballSha256,
      installedVersion: installed?.version ?? null,
    },
    packedRoot,
    peers: packed.peers,
    imports: packed.imports,
    libraryRoot: library.libraryRoot,
    privateFolder,
    dispose(boundMs = cleanupBoundMs) {
      removal ??= removeFolder(privateFolder)
      return awaitRemoval(removal, boundMs).then((cleanup) => ({ cleanup }))
    },
    failLink: (sentence) =>
      fail('pack-error', sentence, {
        step: 'link' satisfies (typeof LIBRARY_PACK_ERROR_STEPS)[number],
      }),
  }
}

/**
 * Builds the checked-out library with the repository's package manager, packs it into the run's private folder and prepares the Node resolve hook, so a `node-script` run's Example loads the packed checked-out build instead of its installed copy.
 *
 * The shared build-and-pack core is {@link prepareLibraryCore}; this adds the Node hook and the observation file.
 * Called by the owned `node-script` run before it spawns the script.
 * @param configuration - The `node-script` configuration; its `library.packageRoot` names the library folder.
 * @param roots - The repository, the Example's folder and the run's private folder.
 * @param dependencies - The external Node, the stop signal and test seams.
 * @returns The `--import` arguments, the correspondence facts, the observation reader and the disposer.
 * @throws `StudyError` `LIBRARY_BUILD_UNSUPPORTED` (nothing started) or `LIBRARY_BUILD_FAILED` (`details.cleanup` says whether the private folder is `removed` or `pending`); {@link LibraryPackageCancelled} when the stop ended the build and the sources are verified unchanged.
 * @example
 * const library = await prepareLibraryPackage(configuration, roots, { node, signal })
 * // => { nodeArguments: ['--import', 'file:///tmp/run/library-hook.mjs'], facts: { package: '@reduxjs/toolkit', version: '2.14.0', … }, … }
 */
export async function prepareLibraryPackage(
  configuration: Pick<NodeScriptConfiguration, 'library'>,
  roots: LibraryPackageRoots,
  dependencies: LibraryPackageDependencies,
): Promise<LibraryPackage> {
  const declared = configuration.library?.packageRoot
  if (declared === undefined)
    throw new Error('prepareLibraryPackage needs configuration.library.')
  const prepared = await prepareLibraryCore(declared, roots, dependencies)
  const nodeArguments = await writeHook(
    prepared,
    roots.examplePackageRoot,
  ).catch((error: unknown) =>
    prepared.failLink(
      `The resolve hook could not be prepared: ${describeError(error)}`,
    ),
  )
  return {
    nodeArguments,
    facts: prepared.facts,
    finishObservation: () =>
      readLibraryObservation(
        join(prepared.privateFolder, OBSERVATION_FILE_NAME),
      ),
    dispose: prepared.dispose,
  }
}

/**
 * Writes the anchor file `<private>/codebook-anchor.js` that the Vite redirect resolves from: Vite resolves an import from the project root when the importer file does not exist, so the redirect needs a real file inside the private folder.
 * Called by the Vite library route after {@link prepareLibraryCore}.
 * @param prepared - The prepared library; its private folder receives the file.
 * @returns The absolute path of the anchor file.
 * @throws `StudyError` `LIBRARY_BUILD_FAILED` with `details.reason` `pack-error` and `details.step` `link` when the file cannot be written; the private folder is removed first.
 * @example
 * const anchor = await writeLibraryAnchor(prepared) // => '/tmp/run/codebook-anchor.js'
 */
export async function writeLibraryAnchor(
  prepared: PreparedLibraryCore,
): Promise<string> {
  const anchorFile = join(prepared.privateFolder, LIBRARY_ANCHOR_FILE_NAME)
  try {
    await writeFile(
      anchorFile,
      '// Codebook anchor: the importer path the packed library is resolved from.\nexport {}\n',
    )
  } catch (error) {
    return prepared.failLink(
      `The resolve anchor could not be written: ${describeError(error)}`,
    )
  }
  return anchorFile
}

/** Takes the snapshot of the whole repository, HEAD and the library folder's dirty state, before the build. */
async function takeSourceBefore(context: RouteContext): Promise<{
  snapshot: Map<string, string>
  revision: string
  dirty: boolean
}> {
  const { repositoryRoot } = context.roots
  const readRevision = context.dependencies.readRevision ?? readHeadRevision
  const revision = await readRevision(repositoryRoot)
  if (!/^[0-9a-f]{40}$/.test(revision))
    throw new Error(`HEAD is not a 40 character revision: ${revision}`)
  const paths = await listTrackedFiles(
    repositoryRoot,
    repositoryRoot,
    'tracked-and-untracked',
  )
  return {
    snapshot: await hashTrackedFiles(repositoryRoot, paths),
    revision,
    dirty: await readDirty(context.library.libraryRoot),
  }
}
