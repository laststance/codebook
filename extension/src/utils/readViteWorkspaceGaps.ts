import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { VITE_SUPPORTED_MAJOR } from '../constants'
import type { ErrorCode } from '../errors'

import { hasNextExecutable } from './hasNextExecutable'
import { parseViteDevScript, type ViteDevScript } from './parseViteDevScript'
import {
  resolveViteInstallation,
  type ViteInstallation,
} from './resolveViteInstallation'
import { isReadableNodeRange, satisfiesNodeRange } from './satisfiesNodeRange'
import {
  VITE_ADAPTER_MISROUTE_MESSAGE,
  VITE_NODE_NOT_CONFIGURED_MESSAGE,
  VITE_NO_DEV_SCRIPT_MESSAGE,
  VITE_NOT_AVAILABLE_FOR_NEXT_MESSAGE,
  VITE_NOT_INSTALLED_MESSAGE,
  VITE_PNP_MESSAGE,
  VITE_PREDEV_MESSAGE,
  viteEnginesMessage,
  viteEnginesUnknownMessage,
  viteMajorMessage,
  viteManifestUnreadableMessage,
  viteScriptMessage,
} from './viteWorkspaceMessages'

const scriptsSchema = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
})

/** The `dev` script state of a Vite workspace. */
export type ViteDevScriptReadiness =
  | { form: 'accepted' }
  | { form: 'refused'; refused: string[] }
  | { form: 'absent' }

/** One reason a workspace cannot start on `vite-dev`, with the code a start refuses with. */
export type ViteWorkspaceGap = {
  code: Extract<
    ErrorCode,
    'ADAPTER_MISROUTE' | 'VITE_UNSUPPORTED' | 'PREREQUISITE_MISSING'
  >
  message: string
  /** The sentence `codebook_status` reports instead of {@link ViteWorkspaceGap.message}, when the start's wording presumes a choice nobody made at status time. */
  statusMessage?: string
}

/** What looking at a workspace for `vite-dev` found. */
export type ViteWorkspaceReading = {
  /** The Vite package, when it resolves from the workspace root. */
  installation?: ViteInstallation
  yarnPnp: boolean
  supported?: boolean
  /** The run's Node version, when it was read. */
  nodeVersion?: string
  nodeSatisfiesEngines?: boolean
  devScript?: ViteDevScriptReadiness
  /** The accepted `dev` script. */
  script?: ViteDevScript
  /** Every gap found, in the order a start refuses them (only the first when `firstGapOnly`). */
  gaps: ViteWorkspaceGap[]
}

/** Reads the manifest's scripts: the scripts, or the sentence for a file that is unreadable (never its contents); no file reads as no scripts. */
async function readPackageScripts(
  workspace: string,
): Promise<{ scripts: Record<string, unknown> } | { problem: string }> {
  const text = await readFile(join(workspace, 'package.json'), 'utf8').catch(
    () => undefined,
  )
  if (text === undefined) return { scripts: {} }
  try {
    return { scripts: scriptsSchema.parse(JSON.parse(text)).scripts ?? {} }
  } catch (error) {
    return {
      problem: viteManifestUnreadableMessage(
        error instanceof SyntaxError
          ? 'is not valid JSON'
          : 'has no valid scripts',
      ),
    }
  }
}

/** The manifest read by {@link readPackageScripts}. */
type PackageManifestReading = Awaited<ReturnType<typeof readPackageScripts>>

/** Names why Vite does not resolve: the unreadable manifest first (it also stops Node's resolution, so it is the cause), then Yarn Plug-n-Play, a misrouted Next workspace or a missing install. */
async function unresolvedGapsOf(
  workspace: string,
  reason: 'yarn-pnp' | 'not-installed',
  manifest: PackageManifestReading,
): Promise<ViteWorkspaceGap[]> {
  const gaps: ViteWorkspaceGap[] = []
  if ('problem' in manifest)
    gaps.push({ code: 'VITE_UNSUPPORTED', message: manifest.problem })
  if (reason === 'yarn-pnp')
    gaps.push({ code: 'VITE_UNSUPPORTED', message: VITE_PNP_MESSAGE })
  else if (await hasNextExecutable(workspace))
    gaps.push({
      code: 'ADAPTER_MISROUTE',
      message: VITE_ADAPTER_MISROUTE_MESSAGE,
      statusMessage: VITE_NOT_AVAILABLE_FOR_NEXT_MESSAGE,
    })
  else
    gaps.push({
      code: 'PREREQUISITE_MISSING',
      message: VITE_NOT_INSTALLED_MESSAGE,
    })
  return gaps
}

/** Judges the run's Node against Vite's `engines.node`: the version read, whether it is inside, and the gap when it is not or cannot be judged. */
async function readEnginesGap(
  installation: ViteInstallation,
  enginesNode: string,
  readNode: () => Promise<string | undefined>,
): Promise<{
  nodeVersion?: string
  nodeSatisfiesEngines?: boolean
  gap?: ViteWorkspaceGap
}> {
  const nodeVersion = await readNode()
  if (nodeVersion === undefined)
    return {
      gap: {
        code: 'PREREQUISITE_MISSING',
        message: VITE_NODE_NOT_CONFIGURED_MESSAGE,
      },
    }
  const nodeSatisfiesEngines = satisfiesNodeRange(enginesNode, nodeVersion)
  if (nodeSatisfiesEngines) return { nodeVersion, nodeSatisfiesEngines }
  // A range Codebook cannot read is named as unknown instead of as excluding the Node.
  const message = isReadableNodeRange(enginesNode)
    ? viteEnginesMessage(installation.version, enginesNode, nodeVersion)
    : viteEnginesUnknownMessage(installation.version, enginesNode, nodeVersion)
  return {
    nodeVersion,
    nodeSatisfiesEngines,
    gap: { code: 'VITE_UNSUPPORTED', message },
  }
}

/** Judges the manifest's scripts: the `dev` script state, the accepted script and the gaps in the order a start refuses them. */
function readScriptGaps(
  workspace: string,
  manifest: PackageManifestReading,
): Pick<ViteWorkspaceReading, 'devScript' | 'script' | 'gaps'> {
  if ('problem' in manifest)
    return {
      devScript: { form: 'absent' },
      gaps: [{ code: 'VITE_UNSUPPORTED', message: manifest.problem }],
    }
  const { dev, predev } = manifest.scripts
  const gaps: ViteWorkspaceGap[] = []
  if (typeof dev !== 'string')
    gaps.push({ code: 'VITE_UNSUPPORTED', message: VITE_NO_DEV_SCRIPT_MESSAGE })
  if (predev !== undefined)
    gaps.push({ code: 'VITE_UNSUPPORTED', message: VITE_PREDEV_MESSAGE })
  if (typeof dev !== 'string') return { devScript: { form: 'absent' }, gaps }
  const reading = parseViteDevScript(dev, workspace)
  if (reading.accepted)
    return { devScript: { form: 'accepted' }, script: reading.script, gaps }
  gaps.push({
    code: 'VITE_UNSUPPORTED',
    message: viteScriptMessage(reading.refused),
  })
  return {
    devScript: { form: 'refused', refused: reading.refused },
    gaps,
  }
}

/**
 * Checks everything about a workspace that is known before any process starts, once, for both the start and `codebook_status`.
 *
 * Why it exists: the start (`assessViteWorkspace`) and the status readiness (`readRepositoryAdapterReadiness`) used to carry two copies of these checks, which could disagree after a prerequisite changed. Both now call this function, so a start refuses exactly when status reports a gap.
 * The checks: the app's own Vite (found, no Yarn Plug-n-Play, supported major, `engines.node` read and including the run's Node) and the manifest's `dev` script (readable, present, no `predev`, inside the grammar).
 *
 * @param workspace - The package root.
 * @param readNode - Reads the run's Node version, called only when the Node gate is reached; `undefined` when no Node is configured. A start passes a reader that throws when Node cannot run.
 * @param firstGapOnly - Stop at the first gap, as a start does, so nothing after a refusal is read (no Node process after an unsupported major).
 * @returns The facts found and the gaps, empty when `vite-dev` could start as far as this check can tell.
 * @example
 * const { gaps } = await readViteWorkspaceGaps('/repo', async () => 'v24.22.1', true)
 */
export async function readViteWorkspaceGaps(
  workspace: string,
  readNode: () => Promise<string | undefined>,
  firstGapOnly: boolean,
): Promise<ViteWorkspaceReading> {
  const manifest = await readPackageScripts(workspace)
  const lookup = await resolveViteInstallation(workspace)
  if (!lookup.found)
    return {
      yarnPnp: lookup.reason === 'yarn-pnp',
      gaps: await unresolvedGapsOf(workspace, lookup.reason, manifest),
    }
  const { installation } = lookup
  const supported = installation.major === VITE_SUPPORTED_MAJOR
  const reading: ViteWorkspaceReading = {
    installation,
    yarnPnp: false,
    supported,
    gaps: supported
      ? []
      : [
          {
            code: 'VITE_UNSUPPORTED',
            message: viteMajorMessage(installation.version),
          },
        ],
  }
  if (firstGapOnly && reading.gaps.length > 0) return reading
  if (installation.enginesNode) {
    const engines = await readEnginesGap(
      installation,
      installation.enginesNode,
      readNode,
    )
    reading.nodeVersion = engines.nodeVersion
    reading.nodeSatisfiesEngines = engines.nodeSatisfiesEngines
    if (engines.gap) reading.gaps.push(engines.gap)
    if (firstGapOnly && reading.gaps.length > 0) return reading
  }
  const scripts = readScriptGaps(workspace, manifest)
  reading.devScript = scripts.devScript
  reading.script = scripts.script
  reading.gaps.push(...scripts.gaps)
  return reading
}
