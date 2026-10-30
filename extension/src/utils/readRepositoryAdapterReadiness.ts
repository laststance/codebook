import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { VITE_SUPPORTED_MAJOR } from '../constants'

import { hasNextExecutable } from './hasNextExecutable'
import { readNodeVersion } from './readNodeVersion'
import {
  readViteWorkspaceGaps,
  type ViteDevScriptReadiness,
} from './readViteWorkspaceGaps'

export type { ViteDevScriptReadiness }

/** The Next prerequisite of one workspace. */
export type NextAdapterReadiness = {
  ready: boolean
  /** The `next` package version, when it is installed and readable. */
  version?: string
  missing: string[]
}

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

/** Reads the `next` readiness: its executable present, its version when readable. */
async function readNextReadiness(
  workspace: string,
): Promise<NextAdapterReadiness> {
  const installed = await hasNextExecutable(workspace)
  if (!installed)
    return {
      ready: false,
      missing: [
        'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
      ],
    }
  const text = await readFile(
    join(workspace, 'node_modules/next/package.json'),
    'utf8',
  ).catch(() => undefined)
  if (text === undefined) return { ready: true, missing: [] }
  // A manifest that does not parse is Next's failure alone: it never rejects the whole report
  const manifest = (() => {
    try {
      return nextPackageSchema.parse(JSON.parse(text))
    } catch {
      return undefined
    }
  })()
  if (!manifest)
    return {
      ready: false,
      missing: [
        'node_modules/next/package.json is not a valid package manifest. Reinstall the workspace dependencies before using next-dev-webpack.',
      ],
    }
  return { ready: true, missing: [], version: manifest.version }
}

/** Reads the `vite` readiness against the configured Node from the same gaps a start refuses with. */
async function readViteReadiness(
  workspace: string,
  node: string | undefined,
  signal: AbortSignal,
): Promise<ViteAdapterReadiness> {
  const reading = await readViteWorkspaceGaps(
    workspace,
    // The run's Node is the configured one; without it the engines check cannot run, and one that cannot run is named by the shared check, as at a start.
    async () => (node ? await readNodeVersion(node, signal) : undefined),
    false,
  )
  const { installation } = reading
  const missing = reading.gaps.map((gap) => gap.statusMessage ?? gap.message)
  return {
    ready: missing.length === 0,
    installed: installation !== undefined,
    ...(installation ? { version: installation.version } : {}),
    ...(reading.supported === undefined
      ? {}
      : { supported: reading.supported }),
    supportedMajor: VITE_SUPPORTED_MAJOR,
    ...(installation?.enginesNode
      ? { enginesNode: installation.enginesNode }
      : {}),
    ...(reading.nodeVersion ? { nodeVersion: reading.nodeVersion } : {}),
    ...(reading.nodeSatisfiesEngines === undefined
      ? {}
      : { nodeSatisfiesEngines: reading.nodeSatisfiesEngines }),
    ...(reading.devScript ? { devScript: reading.devScript } : {}),
    yarnPnp: reading.yarnPnp,
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
