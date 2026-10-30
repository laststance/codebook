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
import {
  isReadableNodeRange,
  isReadableNodeVersion,
  satisfiesNodeRange,
} from './satisfiesNodeRange'
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
  viteNodeUnrunnableMessage,
  viteNodeVersionUnknownMessage,
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
type ViteWorkspaceGap = {
  code: Extract<
    ErrorCode,
    'ADAPTER_MISROUTE' | 'VITE_UNSUPPORTED' | 'PREREQUISITE_MISSING'
  >
  message: string
  /** The sentence `codebook_status` reports instead of {@link ViteWorkspaceGap.message}, when the start's wording presumes a choice nobody made at status time. */
  statusMessage?: string
}

/** At least one gap: a reading with a gap always has a first one to refuse with. */
type NonEmptyGaps = [ViteWorkspaceGap, ...ViteWorkspaceGap[]]

/** What looking at a workspace for `vite-dev` found, apart from the gaps. */
type ViteWorkspaceFacts = {
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
}

/**
 * What looking at a workspace for `vite-dev` found: either no gap, with the Vite installation and the accepted script present, or at least one gap, in the order a start refuses them (only the first when `firstGapOnly`).
 *
 * Typed as a union so a caller that finds no gap reads `installation` and `script` without a fallback branch.
 */
export type ViteWorkspaceReading = ViteWorkspaceFacts &
  (
    | {
        ready: true
        gaps: []
        installation: ViteInstallation
        script: ViteDevScript
      }
    | { ready: false; gaps: NonEmptyGaps }
  )

/**
 * Reads the manifest's scripts once, so every later check judges the same reading.
 *
 * Why it exists: an unreadable `package.json` must be reported by name without ever quoting its contents. Called first by {@link readViteWorkspaceGaps}.
 *
 * @param workspace - The package root.
 * @returns The scripts; the refusal sentence when the file is not valid JSON or has no valid scripts; no scripts when there is no file.
 * @example
 * await readPackageScripts('/repo') // => { scripts: { dev: 'vite' } }
 */
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

/**
 * Names why Vite does not resolve: the unreadable manifest first (it also stops Node's resolution, so it is the cause), then the resolution gap.
 *
 * Called by {@link readViteWorkspaceGaps} when the Vite lookup finds nothing.
 *
 * @param workspace - The package root.
 * @param reason - Why the lookup found nothing.
 * @param manifest - The manifest reading of {@link readPackageScripts}.
 * @returns One or two gaps, the manifest's first.
 * @example
 * await unresolvedGapsOf('/repo', 'not-installed', { scripts: {} }) // => [{ code: 'PREREQUISITE_MISSING', message: '…' }]
 */
async function unresolvedGapsOf(
  workspace: string,
  reason: 'yarn-pnp' | 'not-installed',
  manifest: PackageManifestReading,
): Promise<NonEmptyGaps> {
  const resolutionGap = await resolutionGapOf(workspace, reason)
  if ('problem' in manifest)
    return [
      { code: 'VITE_UNSUPPORTED', message: manifest.problem },
      resolutionGap,
    ]
  return [resolutionGap]
}

/**
 * Picks the gap for the reason Vite does not resolve: Yarn Plug-n-Play, a misrouted Next workspace or a missing install.
 *
 * Called by {@link unresolvedGapsOf}.
 *
 * @param workspace - The package root, searched for a Next executable.
 * @param reason - Why the lookup found nothing.
 * @returns The gap, with a status wording when the start's wording presumes a choice nobody made.
 * @example
 * await resolutionGapOf('/repo', 'yarn-pnp') // => { code: 'VITE_UNSUPPORTED', message: VITE_PNP_MESSAGE }
 */
async function resolutionGapOf(
  workspace: string,
  reason: 'yarn-pnp' | 'not-installed',
): Promise<ViteWorkspaceGap> {
  if (reason === 'yarn-pnp')
    return { code: 'VITE_UNSUPPORTED', message: VITE_PNP_MESSAGE }
  if (await hasNextExecutable(workspace))
    return {
      code: 'ADAPTER_MISROUTE',
      message: VITE_ADAPTER_MISROUTE_MESSAGE,
      statusMessage: VITE_NOT_AVAILABLE_FOR_NEXT_MESSAGE,
    }
  return { code: 'PREREQUISITE_MISSING', message: VITE_NOT_INSTALLED_MESSAGE }
}

/**
 * Judges the run's Node against Vite's `engines.node`, naming a Node version or a range Codebook cannot read as such instead of as excluded.
 *
 * Called by {@link readViteWorkspaceGaps} when the found Vite declares `engines.node`.
 *
 * @param installation - The found Vite, named in the sentence.
 * @param enginesNode - Vite's `engines.node` range.
 * @param readNode - Reads the run's Node version; `undefined` when no Node is configured; rejects when a configured Node cannot run, which is named as such.
 * @returns The version read, whether it is inside, and the gap when it is not or cannot be judged.
 * @example
 * await readEnginesGap(installation, '^18.0.0', async () => 'v24.22.1') // => { nodeVersion: 'v24.22.1', nodeSatisfiesEngines: false, gap: { code: 'VITE_UNSUPPORTED', message: '…' } }
 */
async function readEnginesGap(
  installation: ViteInstallation,
  enginesNode: string,
  readNode: () => Promise<string | undefined>,
): Promise<{
  nodeVersion?: string
  nodeSatisfiesEngines?: boolean
  gap?: ViteWorkspaceGap
}> {
  const nodeVersion = await readNode().catch((error: unknown) =>
    // A cancelled run stays cancelled; a Node that is set but cannot run is named as such, never as not set.
    error instanceof Error && error.name === 'AbortError'
      ? Promise.reject(error)
      : { unrunnable: error instanceof Error ? error.message : String(error) },
  )
  if (typeof nodeVersion === 'object')
    return {
      gap: {
        code: 'PREREQUISITE_MISSING',
        message: viteNodeUnrunnableMessage(nodeVersion.unrunnable),
      },
    }
  if (nodeVersion === undefined)
    return {
      gap: {
        code: 'PREREQUISITE_MISSING',
        message: VITE_NODE_NOT_CONFIGURED_MESSAGE,
      },
    }
  const nodeSatisfiesEngines = satisfiesNodeRange(enginesNode, nodeVersion)
  if (nodeSatisfiesEngines) return { nodeVersion, nodeSatisfiesEngines }
  // A version or a range Codebook cannot read is named as unreadable, never as excluding the Node.
  const message = !isReadableNodeVersion(nodeVersion)
    ? viteNodeVersionUnknownMessage(
        installation.version,
        enginesNode,
        nodeVersion,
      )
    : isReadableNodeRange(enginesNode)
      ? viteEnginesMessage(installation.version, enginesNode, nodeVersion)
      : viteEnginesUnknownMessage(
          installation.version,
          enginesNode,
          nodeVersion,
        )
  return {
    nodeVersion,
    nodeSatisfiesEngines,
    gap: { code: 'VITE_UNSUPPORTED', message },
  }
}

/** The script judgement of {@link readScriptGaps}: ready with the accepted script, or blocked with at least one gap. */
type ScriptReading =
  | { ready: true; devScript: ViteDevScriptReadiness; script: ViteDevScript }
  | { ready: false; devScript: ViteDevScriptReadiness; gaps: NonEmptyGaps }

/**
 * Judges the manifest's scripts: the `dev` script state, and either the accepted script or the gaps in the order a start refuses them.
 *
 * Called last by {@link readViteWorkspaceGaps}, after the Vite and Node checks.
 *
 * @param workspace - The package root the script's `--config` must stay inside.
 * @param manifest - The manifest reading of {@link readPackageScripts}.
 * @returns Ready with the accepted script, or blocked with at least one gap.
 * @example
 * readScriptGaps('/repo', { scripts: { dev: 'vite' } }) // => { ready: true, devScript: { form: 'accepted' }, script: … }
 */
function readScriptGaps(
  workspace: string,
  manifest: PackageManifestReading,
): ScriptReading {
  if ('problem' in manifest)
    return {
      ready: false,
      devScript: { form: 'absent' },
      gaps: [{ code: 'VITE_UNSUPPORTED', message: manifest.problem }],
    }
  const { dev, predev } = manifest.scripts
  const predevGap: ViteWorkspaceGap = {
    code: 'VITE_UNSUPPORTED',
    message: VITE_PREDEV_MESSAGE,
  }
  if (typeof dev !== 'string') {
    const noDevGap: ViteWorkspaceGap = {
      code: 'VITE_UNSUPPORTED',
      message: VITE_NO_DEV_SCRIPT_MESSAGE,
    }
    return {
      ready: false,
      devScript: { form: 'absent' },
      gaps: predev !== undefined ? [noDevGap, predevGap] : [noDevGap],
    }
  }
  const reading = parseViteDevScript(dev, workspace)
  if (!reading.accepted) {
    const scriptGap: ViteWorkspaceGap = {
      code: 'VITE_UNSUPPORTED',
      message: viteScriptMessage(reading.refused),
    }
    return {
      ready: false,
      devScript: { form: 'refused', refused: reading.refused },
      gaps: predev !== undefined ? [predevGap, scriptGap] : [scriptGap],
    }
  }
  const devScript: ViteDevScriptReadiness = { form: 'accepted' }
  // An accepted script with a `predev` is still blocked.
  if (predev !== undefined)
    return { ready: false, devScript, gaps: [predevGap] }
  return { ready: true, devScript, script: reading.script }
}

/**
 * Checks everything about a workspace that is known before any process starts, once, for both the start and `codebook_status`.
 *
 * Why it exists: the start (`assessViteWorkspace`) and the status readiness (`readRepositoryAdapterReadiness`) used to carry two copies of these checks, which could disagree after a prerequisite changed. Both now call this function, so a start refuses exactly when status reports a gap.
 * The checks: the app's own Vite (found, no Yarn Plug-n-Play, supported major, `engines.node` read and including the run's Node) and the manifest's `dev` script (readable, present, no `predev`, inside the grammar).
 *
 * @param workspace - The package root.
 * @param readNode - Reads the run's Node version, called only when the Node gate is reached; `undefined` when no Node is configured. A reader that rejects (a configured Node that cannot run) gives the same `PREREQUISITE_MISSING` gap to a start and to `codebook_status`.
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
      ready: false,
      yarnPnp: lookup.reason === 'yarn-pnp',
      gaps: await unresolvedGapsOf(workspace, lookup.reason, manifest),
    }
  const { installation } = lookup
  const supported = installation.major === VITE_SUPPORTED_MAJOR
  const facts: ViteWorkspaceFacts = {
    installation,
    yarnPnp: false,
    supported,
  }
  // Gaps found before the script judgement, in the order a start refuses them.
  const earlierGaps: ViteWorkspaceGap[] = []
  if (!supported) {
    const majorGap: ViteWorkspaceGap = {
      code: 'VITE_UNSUPPORTED',
      message: viteMajorMessage(installation.version),
    }
    if (firstGapOnly) return { ...facts, ready: false, gaps: [majorGap] }
    earlierGaps.push(majorGap)
  }
  if (installation.enginesNode) {
    const engines = await readEnginesGap(
      installation,
      installation.enginesNode,
      readNode,
    )
    facts.nodeVersion = engines.nodeVersion
    facts.nodeSatisfiesEngines = engines.nodeSatisfiesEngines
    if (engines.gap) {
      if (firstGapOnly) return { ...facts, ready: false, gaps: [engines.gap] }
      earlierGaps.push(engines.gap)
    }
  }
  const scripts = readScriptGaps(workspace, manifest)
  facts.devScript = scripts.devScript
  const [earlyFirst, ...earlyRest] = earlierGaps
  if (scripts.ready) {
    // No script gap: the earlier gaps alone decide.
    if (!earlyFirst)
      return {
        ...facts,
        ready: true,
        script: scripts.script,
        installation,
        gaps: [],
      }
    return {
      ...facts,
      ready: false,
      gaps: [earlyFirst, ...earlyRest],
    }
  }
  const [scriptFirst, ...scriptRest] = scripts.gaps
  return {
    ...facts,
    ready: false,
    gaps: earlyFirst
      ? [earlyFirst, ...earlyRest, scriptFirst, ...scriptRest]
      : [scriptFirst, ...scriptRest],
  }
}
