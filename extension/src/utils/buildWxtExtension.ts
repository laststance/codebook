import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { assertWxtBuildSupported } from './assertWxtBuildSupported'
import { createExtensionBuildError } from './createExtensionBuildError'
import { createWxtBuildSpawner } from './createWxtBuildSpawner'
import { findChangedTrackedFile } from './findChangedTrackedFile'
import { hashTrackedFiles } from './hashTrackedFiles'
import { listTrackedFiles } from './listTrackedFiles'
import { readWxtBuildResultFile } from './readWxtBuildResultFile'
import { runWxtBuildProcess } from './runWxtBuildProcess'
import type { WxtBuildProcessEnd } from './runWxtBuildProcess'
import { sleepUntilAborted } from './sleepUntilAborted'
import { WXT_BUILD_SCRIPT } from './wxtBuildScript'
import type { WxtBuildInput, WxtBuildResult } from './wxtBuildTypes'

export type {
  WxtBuildClock,
  WxtBuildInput,
  WxtBuildProcess,
  WxtBuildResult,
  WxtBuildSpawner,
} from './wxtBuildTypes'

/** The folder WXT writes its Chrome development build to, inside the output folder. */
const CHROME_DEVELOPMENT_BUILD_FOLDER = 'chrome-mv3-dev'

const productionClock = { nowMs: () => Date.now(), delay: sleepUntilAborted }

/** Raises `EXTENSION_BUILD_FAILED` for a build that started; Chrome did not. */
function buildFailed(
  reason: string,
  sentence: string,
  details: Record<string, unknown> = {},
) {
  return createExtensionBuildError(
    'EXTENSION_BUILD_FAILED',
    reason,
    sentence,
    details,
  )
}

/** Judges a finished build's own outcome, after the tracked files were found unchanged and the tree ended. */
async function judgeBuildOutcome(
  end: WxtBuildProcessEnd,
  resultFile: string,
  outDir: string,
  input: WxtBuildInput,
  wxtVersion: string,
): Promise<string> {
  if (end.ending === 'timeout')
    throw buildFailed(
      'timeout',
      `The WXT build was stopped after its time limit and its processes were ended.\n${end.outputLines.join('\n')}`,
      { wxtVersion, nodeVersion: input.node?.version },
    )
  const result = await readWxtBuildResultFile(resultFile)
  if (!result?.ok)
    throw buildFailed(
      'build-error',
      `WXT ended with an error. Last output lines:\n${end.outputLines.join('\n')}`,
      {
        wxtVersion,
        nodeVersion: input.node?.version,
        exitCode: end.exit?.code ?? null,
        signal: end.exit?.signal ?? null,
      },
    )
  const loadRoot = join(outDir, CHROME_DEVELOPMENT_BUILD_FOLDER)
  const hasManifest = await access(join(loadRoot, 'manifest.json')).then(
    () => true,
    () => false,
  )
  if (!hasManifest)
    throw buildFailed(
      'no-output',
      `WXT ${result.wxtVersion} finished without a ${CHROME_DEVELOPMENT_BUILD_FOLDER} build in the output folder.`,
      { wxtVersion: result.wxtVersion },
    )
  return loadRoot
}

/**
 * Builds a WXT project with the project's own WXT `build()` and source maps into the run's private folder, so the build can be loaded as an unpacked extension.
 *
 * Refuses before any process when the project cannot be built; snapshots the tracked files; runs the build under its time budget; and after the process tree ended, on every way the build ends, compares the tracked files. A changed file takes precedence over the build's own outcome, and Codebook never restores files.
 * Called by the `extensionSource` boundary of a `wxt-build` run.
 *
 * @param input - Roots, the private folder, the external Node, the cancellation and optional injected clock and spawner.
 * @returns
 * - `built` with the load root (`<private folder>/wxt-build/chrome-mv3-dev`), the WXT version and the duration
 * - `cancelled` when the signal ended the build and the tracked files are verified unchanged
 * @throws `StudyError` `EXTENSION_BUILD_UNSUPPORTED` before any process (see {@link assertWxtBuildSupported}), or `EXTENSION_BUILD_FAILED` with reason `tracked-file-changed`, `tracked-files-unverified`, `timeout`, `build-error` or `no-output`.
 * @example
 * const result = await buildWxtExtension({ repositoryRoot: '/repo', projectRoot: '/repo/ext', privateFolder: '/tmp/run', node, signal })
 * // => { kind: 'built', loadRoot: '/tmp/run/wxt-build/chrome-mv3-dev', wxtVersion: '0.21.4', durationMs: 8123 }
 */
export async function buildWxtExtension(
  input: WxtBuildInput,
): Promise<WxtBuildResult> {
  const clock = input.clock ?? productionClock
  const spawner = input.spawner ?? createWxtBuildSpawner
  const wxtVersion = await assertWxtBuildSupported(input)
  const snapshot = await hashTrackedFiles(
    input.repositoryRoot,
    await listTrackedFiles(input.repositoryRoot, input.projectRoot),
  )
  // Cancelled before any process: nothing could have changed.
  if (input.signal.aborted) return { kind: 'cancelled' }
  const outDir = join(input.privateFolder, 'wxt-build')
  const resultFile = join(input.privateFolder, 'wxt-build-result.json')
  await rm(resultFile, { force: true })
  const startedAtMs = clock.nowMs()
  const end = await runWxtBuildProcess(
    {
      executable: input.node?.executable ?? '',
      arguments: [
        '--input-type=module',
        '--eval',
        WXT_BUILD_SCRIPT,
        input.projectRoot,
        outDir,
        resultFile,
      ],
      cwd: input.projectRoot,
    },
    spawner,
    clock,
    input.signal,
  )
  // The comparison runs on every ending, whatever the tree's state: a change is reported first.
  const changedPath = await findChangedTrackedFile(
    input.repositoryRoot,
    snapshot,
  )
  if (changedPath !== undefined)
    throw buildFailed(
      'tracked-file-changed',
      `The WXT build changed the tracked file ${changedPath}; Codebook did not restore it.`,
      { path: changedPath, wxtVersion },
    )
  if (!end.treeEnded)
    throw buildFailed(
      'tracked-files-unverified',
      "The build's processes could not be confirmed ended, so the tracked files could not be checked.",
      { wxtVersion },
    )
  if (end.ending === 'cancelled') return { kind: 'cancelled' }
  const loadRoot = await judgeBuildOutcome(
    end,
    resultFile,
    outDir,
    input,
    wxtVersion,
  )
  return {
    kind: 'built',
    loadRoot,
    wxtVersion,
    durationMs: clock.nowMs() - startedAtMs,
  }
}
