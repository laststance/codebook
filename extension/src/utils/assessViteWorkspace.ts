import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { VITE_SUPPORTED_MAJOR } from '../constants'
import { StudyError } from '../errors'
import { viteRefusal } from '../viteRefusals'

import { parseViteDevScript, type ViteDevScript } from './parseViteDevScript'
import { readNodeVersion } from './readNodeVersion'
import {
  resolveViteInstallation,
  type ViteInstallation,
} from './resolveViteInstallation'
import { satisfiesNodeRange } from './satisfiesNodeRange'

const projectScriptsSchema = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
})

/** The Yarn Plug-n-Play refusal sentence, shared by the start and `codebook_status`. */
export const VITE_PNP_MESSAGE =
  'Yarn Plug-n-Play without node_modules is not supported: vite cannot be resolved from the package root. Use node_modules (nodeLinker: node-modules).'

/**
 * The sentence for a Vite whose major is not supported.
 * @param version - The found Vite version.
 * @returns The refusal sentence, naming the found version and the supported major.
 * @example
 * viteMajorMessage('7.1.0') // => 'Vite 7.1.0 is installed; Codebook supports Vite 8 only.'
 */
export function viteMajorMessage(version: string): string {
  return `Vite ${version} is installed; Codebook supports Vite ${VITE_SUPPORTED_MAJOR} only.`
}

/**
 * The sentence for a Vite whose `engines.node` excludes the run's Node.
 * @param version - The found Vite version.
 * @param range - Vite's `engines.node` range.
 * @param nodeVersion - The run's Node version.
 * @returns The refusal sentence with the fix.
 * @example
 * viteEnginesMessage('8.3.5', '^20.19.0 || >=22.12.0', 'v18.0.0') // => 'Vite 8.3.5 requires Node ^20.19.0 || >=22.12.0, but Codebook runs Node v18.0.0 …'
 */
export function viteEnginesMessage(
  version: string,
  range: string,
  nodeVersion: string,
): string {
  return `Vite ${version} requires Node ${range}, but Codebook runs Node ${nodeVersion} (the Node Executable setting; a .nvmrc or .node-version is not honored). Set codebook.nodeExecutable to a Node in that range.`
}

/** The sentence for a missing `dev` script. */
export const VITE_NO_DEV_SCRIPT_MESSAGE =
  'package.json has no dev script. Codebook starts Vite as the dev script does and accepts a script such as "vite" or "vite dev".'

/** The sentence for a `predev` script. */
export const VITE_PREDEV_MESSAGE =
  "package.json has a predev script: Codebook starts Vite directly and would skip it, so its start would differ from the project's own."

/**
 * The sentence for a `dev` script outside the grammar, naming every refused element.
 * @param refused - The refused elements {@link parseViteDevScript} listed (grammar words only, never values).
 * @returns The refusal sentence with the accepted forms.
 * @example
 * viteScriptMessage(['the operator &&']) // => 'The dev script is outside what Codebook starts: the operator &&. Accepted: …'
 */
export function viteScriptMessage(refused: readonly string[]): string {
  return `The dev script is outside what Codebook starts: ${refused.join('; ')}. Accepted: [NAME=value ...] vite [dev|serve] [--host] [--open] [--port N] [--mode M] [--config F].`
}

/** What a workspace that can run on `vite-dev` provides. */
export type ViteWorkspace = {
  installation: ViteInstallation
  script: ViteDevScript
}

/** Whether `node_modules/next/dist/bin/next` exists in the workspace. */
async function hasNext(workspace: string): Promise<boolean> {
  return access(join(workspace, 'node_modules/next/dist/bin/next')).then(
    () => true,
    () => false,
  )
}

/**
 * Refuses a Next adapter start on a workspace that has Vite and no Next, naming the Vite version and the adapter to use.
 *
 * Called by the Next adapter's workspace check when Next is missing, so an agent that picked the wrong adapter reads the right one in the refusal.
 *
 * @param workspace - The package root.
 * @throws `ADAPTER_MISROUTE` when `vite` resolves and `next` does not.
 * @example
 * await refuseViteMisroute('/vite-app') // throws ADAPTER_MISROUTE: vite 8.3.5 is installed, use adapter "vite-dev"
 */
export async function refuseViteMisroute(workspace: string): Promise<void> {
  if (await hasNext(workspace)) return
  const lookup = await resolveViteInstallation(workspace).catch(() => undefined)
  if (lookup?.found)
    throw viteRefusal(
      'ADAPTER_MISROUTE',
      `next-dev-webpack was chosen, but this workspace has Vite ${lookup.installation.version} and no Next: use adapter "vite-dev".`,
    )
}

/**
 * Checks everything about a workspace that is known before any process starts: the app's own Vite (found, major 8, `engines.node` including the run's Node, no Yarn Plug-n-Play) and the `dev` script grammar with no `predev`.
 *
 * Why it exists: these refusals need no launcher, so they leave nothing started. Called by the Vite adapter's `assertWorkspace` at the start of preparation.
 *
 * @param workspace - The package root.
 * @param node - The run's Node executable.
 * @param signal - Ends the check when the run is cancelled.
 * @returns The Vite installation and the accepted script.
 * @throws `ADAPTER_MISROUTE` (no Vite, Next present), `PREREQUISITE_MISSING` (no Vite), `VITE_UNSUPPORTED` for the rest; each names the value it refuses.
 * @example
 * const { installation, script } = await assessViteWorkspace('/repo', '/usr/bin/node', signal)
 */
export async function assessViteWorkspace(
  workspace: string,
  node: string,
  signal: AbortSignal,
): Promise<ViteWorkspace> {
  signal.throwIfAborted()
  const lookup = await resolveViteInstallation(workspace)
  if (!lookup.found) {
    if (lookup.reason === 'yarn-pnp')
      throw viteRefusal('VITE_UNSUPPORTED', VITE_PNP_MESSAGE)
    if (await hasNext(workspace))
      throw viteRefusal(
        'ADAPTER_MISROUTE',
        'vite-dev was chosen, but this workspace has Next and no vite package: use adapter "next-dev-webpack".',
      )
    throw new StudyError(
      'PREREQUISITE_MISSING',
      'Install the workspace dependencies, including vite, before using vite-dev (the vite package does not resolve from the package root).',
    )
  }
  const { installation } = lookup
  if (installation.major !== VITE_SUPPORTED_MAJOR)
    throw viteRefusal(
      'VITE_UNSUPPORTED',
      viteMajorMessage(installation.version),
    )
  const nodeVersion = await readNodeVersion(node, signal)
  if (
    installation.enginesNode &&
    !satisfiesNodeRange(installation.enginesNode, nodeVersion)
  )
    throw viteRefusal(
      'VITE_UNSUPPORTED',
      viteEnginesMessage(
        installation.version,
        installation.enginesNode,
        nodeVersion,
      ),
    )
  const project = projectScriptsSchema.parse(
    JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')),
  )
  const scripts = project.scripts ?? {}
  const devScript = scripts.dev
  if (typeof devScript !== 'string')
    throw viteRefusal('VITE_UNSUPPORTED', VITE_NO_DEV_SCRIPT_MESSAGE)
  if (scripts.predev !== undefined)
    throw viteRefusal('VITE_UNSUPPORTED', VITE_PREDEV_MESSAGE)
  const reading = parseViteDevScript(devScript)
  if (!reading.accepted)
    throw viteRefusal('VITE_UNSUPPORTED', viteScriptMessage(reading.refused))
  return { installation, script: reading.script }
}
