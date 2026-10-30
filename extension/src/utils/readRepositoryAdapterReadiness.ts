import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { VITE_SUPPORTED_MAJOR } from '../constants'

import {
  VITE_NO_DEV_SCRIPT_MESSAGE,
  VITE_PNP_MESSAGE,
  VITE_PREDEV_MESSAGE,
  viteEnginesMessage,
  viteMajorMessage,
  viteScriptMessage,
} from './assessViteWorkspace'
import { parseViteDevScript } from './parseViteDevScript'
import { readNodeVersion } from './readNodeVersion'
import { resolveViteInstallation } from './resolveViteInstallation'
import { satisfiesNodeRange } from './satisfiesNodeRange'

const NODE_NOT_CONFIGURED_MESSAGE =
  'The Vite engines.node check needs the configured Node executable (codebook.nodeExecutable).'

/** The Next prerequisite of one workspace. */
export type NextAdapterReadiness = {
  ready: boolean
  /** The `next` package version, when it is installed and readable. */
  version?: string
  missing: string[]
}

/** The `dev` script state of a Vite workspace. */
export type ViteDevScriptReadiness =
  | { form: 'accepted' }
  | { form: 'refused'; refused: string[] }
  | { form: 'absent' }

/** The Vite prerequisite of one workspace. */
export type ViteAdapterReadiness = {
  ready: boolean
  /** Whether `vite` resolves from the workspace root. */
  installed: boolean
  version?: string
  /** Whether the found major is the supported one. */
  supported?: boolean
  supportedMajor: number
  /** Vite's `engines.node` range and whether the configured Node satisfies it. */
  enginesNode?: string
  nodeVersion?: string
  nodeSatisfiesEngines?: boolean
  devScript?: ViteDevScriptReadiness
  yarnPnp: boolean
  missing: string[]
}

/** What `codebook_status` reports per repository-browser adapter for the current workspace. */
export type RepositoryAdapterReadiness = {
  'next-dev-webpack': NextAdapterReadiness
  'vite-dev': ViteAdapterReadiness
}

const nextPackageSchema = z.object({ version: z.string() })
const scriptsSchema = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
})

/** Reads the `next` readiness: its executable present, its version when readable. */
async function readNextReadiness(
  workspace: string,
): Promise<NextAdapterReadiness> {
  const installed = await access(
    join(workspace, 'node_modules/next/dist/bin/next'),
  ).then(
    () => true,
    () => false,
  )
  if (!installed)
    return {
      ready: false,
      missing: [
        'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
      ],
    }
  const version = await readFile(
    join(workspace, 'node_modules/next/package.json'),
    'utf8',
  ).then(
    (text) => nextPackageSchema.parse(JSON.parse(text)).version,
    () => undefined,
  )
  return { ready: true, missing: [], ...(version ? { version } : {}) }
}

/** Reads the `dev` script state and the sentences it adds to `missing`. */
async function readViteScript(
  workspace: string,
): Promise<{ devScript: ViteDevScriptReadiness; missing: string[] }> {
  const scripts = await readFile(join(workspace, 'package.json'), 'utf8').then(
    (text): Record<string, unknown> =>
      scriptsSchema.parse(JSON.parse(text)).scripts ?? {},
    (): Record<string, unknown> => ({}),
  )
  const missing: string[] = []
  if (scripts.predev !== undefined) missing.push(VITE_PREDEV_MESSAGE)
  if (typeof scripts.dev !== 'string') {
    missing.push(VITE_NO_DEV_SCRIPT_MESSAGE)
    return { devScript: { form: 'absent' }, missing }
  }
  const reading = parseViteDevScript(scripts.dev)
  if (reading.accepted) return { devScript: { form: 'accepted' }, missing }
  missing.push(viteScriptMessage(reading.refused))
  return {
    devScript: { form: 'refused', refused: reading.refused },
    missing,
  }
}

/** Reads the `vite` readiness against the configured Node. */
async function readViteReadiness(
  workspace: string,
  node: string | undefined,
  signal: AbortSignal,
): Promise<ViteAdapterReadiness> {
  const lookup = await resolveViteInstallation(workspace)
  if (!lookup.found)
    return {
      ready: false,
      installed: false,
      supportedMajor: VITE_SUPPORTED_MAJOR,
      yarnPnp: lookup.reason === 'yarn-pnp',
      missing: [
        lookup.reason === 'yarn-pnp'
          ? VITE_PNP_MESSAGE
          : 'Install the workspace dependencies, including vite, before using vite-dev (the vite package does not resolve from the package root).',
      ],
    }
  const { installation } = lookup
  const missing: string[] = []
  const supported = installation.major === VITE_SUPPORTED_MAJOR
  if (!supported) missing.push(viteMajorMessage(installation.version))
  // The run's Node is the configured one; without it the engines check cannot run.
  const nodeVersion = node
    ? await readNodeVersion(node, signal).catch(() => undefined)
    : undefined
  let nodeSatisfiesEngines: boolean | undefined
  if (installation.enginesNode && nodeVersion) {
    nodeSatisfiesEngines = satisfiesNodeRange(
      installation.enginesNode,
      nodeVersion,
    )
    if (!nodeSatisfiesEngines)
      missing.push(
        viteEnginesMessage(
          installation.version,
          installation.enginesNode,
          nodeVersion,
        ),
      )
  } else if (installation.enginesNode) missing.push(NODE_NOT_CONFIGURED_MESSAGE)
  const script = await readViteScript(workspace)
  missing.push(...script.missing)
  return {
    ready: missing.length === 0,
    installed: true,
    version: installation.version,
    supported,
    supportedMajor: VITE_SUPPORTED_MAJOR,
    ...(installation.enginesNode
      ? { enginesNode: installation.enginesNode }
      : {}),
    ...(nodeVersion ? { nodeVersion } : {}),
    ...(nodeSatisfiesEngines === undefined ? {} : { nodeSatisfiesEngines }),
    devScript: script.devScript,
    yarnPnp: false,
    missing,
  }
}

/**
 * Reports, for the current workspace, whether each repository-browser adapter could start: its package, version, supported major, Vite's `engines.node` against the configured Node, the `dev` script form and Yarn Plug-n-Play.
 *
 * Why it exists: an agent that reads `codebook_status` picks the adapter that reports ready instead of guessing. Called by the environment's `prerequisites` for `profiles['repository-browser'].adapters`. It reuses the start's own gate sentences ({@link viteScriptMessage} and the others) and checks nothing that needs the launcher; unsupported config settings appear only at a start.
 *
 * @param workspace - The workspace root, which is the package root.
 * @param node - The configured Node executable, when one resolved.
 * @param signal - Ends the Node version read.
 * @returns A report per adapter; a Vite lookup that throws becomes a not-ready report that names the error.
 * @example
 * await readRepositoryAdapterReadiness('/repo', '/usr/bin/node', signal)
 * // => { 'next-dev-webpack': { ready: false, missing: ['Install …Next…'] }, 'vite-dev': { ready: true, installed: true, version: '8.3.5', … } }
 */
export async function readRepositoryAdapterReadiness(
  workspace: string,
  node: string | undefined,
  signal: AbortSignal,
): Promise<RepositoryAdapterReadiness> {
  const [next, vite] = await Promise.all([
    readNextReadiness(workspace),
    readViteReadiness(workspace, node, signal).catch(
      (error: unknown): ViteAdapterReadiness => ({
        ready: false,
        installed: false,
        supportedMajor: VITE_SUPPORTED_MAJOR,
        yarnPnp: false,
        missing: [
          `vite could not be read from the workspace: ${error instanceof Error ? error.message : String(error)}`,
        ],
      }),
    ),
  ])
  return { 'next-dev-webpack': next, 'vite-dev': vite }
}
