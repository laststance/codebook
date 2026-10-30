import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { VITE_SUPPORTED_MAJOR } from '../constants'

import { describeNextDevPreparation } from './describeNextDevPreparation'
import { hasNextExecutable } from './hasNextExecutable'
import {
  readNextDevPreparation,
  type NextDevPreparation,
} from './readNextDevPreparation'
import {
  NEXT_ROUTE_FOLDER_NOT_FOUND_NOTE,
  readNextRouterKind,
  type NextRouterKind,
} from './readNextRouterKind'
import { readNodeVersion } from './readNodeVersion'
import {
  readViteWorkspaceGaps,
  type ViteDevScriptReadiness,
} from './readViteWorkspaceGaps'

export type { NextDevPreparation, NextRouterKind, ViteDevScriptReadiness }

/** The Next prerequisite of one workspace. */
export type NextAdapterReadiness = {
  ready: boolean
  /** Which routers the workspace's route folders hold ({@link readNextRouterKind}); a label that never changes `ready`. Present when Next is installed. */
  routerKind?: NextRouterKind
  /** What Codebook leaves out of `scripts.dev` ({@link readNextDevPreparation}); present when Next is installed and the reading is not a plain `none`. */
  preparation?: NextDevPreparation
  /** The `next` package version, when it is installed and readable. */
  version?: string
  missing: string[]
  /** Sentences to tell the learner that never change `ready`: the folders searched for router kind `none`, skipped or unread preparation, unapplied environment settings by name. Present when there is one. */
  notes?: string[]
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

/**
 * Reads the `next` installation: its executable present, its version when readable.
 *
 * Called by {@link readNextReadiness}, which adds the router kind and preparation labels of an installed Next.
 *
 * @param workspace - The package root.
 * @returns
 * - `installed: false` with the install sentence when the executable is missing
 * - `installed: true` with `ready: false` and the reinstall sentence when `node_modules/next/package.json` does not parse
 * - `installed: true`, `ready: true` and the version when it is readable
 * @example
 * await readNextInstallation('/repo') // => { installed: true, ready: true, missing: [], version: '16.4.3' }
 */
async function readNextInstallation(workspace: string): Promise<
  Pick<NextAdapterReadiness, 'ready' | 'version' | 'missing'> & {
    installed: boolean
  }
> {
  const installed = await hasNextExecutable(workspace)
  if (!installed)
    return {
      installed: false,
      ready: false,
      missing: [
        'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
      ],
    }
  const text = await readFile(
    join(workspace, 'node_modules/next/package.json'),
    'utf8',
  ).catch(() => undefined)
  if (text === undefined) return { installed: true, ready: true, missing: [] }
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
      installed: true,
      ready: false,
      missing: [
        'node_modules/next/package.json is not a valid package manifest. Reinstall the workspace dependencies before using next-dev-webpack.',
      ],
    }
  return {
    installed: true,
    ready: true,
    missing: [],
    version: manifest.version,
  }
}

/**
 * Reads the `next` readiness: the installation, then, for an installed Next, the router kind and the preparation of `scripts.dev` as labels with their notes.
 *
 * Called by {@link readRepositoryAdapterReadiness}. Without Next the adapter cannot start, so no label is read and the report stays the install sentence. The labels never change `ready`: their sentences go to `notes`, never to `missing`, because the environment turns every `missing` sentence into not ready.
 *
 * @param workspace - The package root.
 * @returns The Next report, keyed `ready`, `routerKind`, `preparation` (only when it is not a plain `none`), `version`, `missing`, `notes` (only when there is a note).
 * @example
 * await readNextReadiness('/repo')
 * // => { ready: true, routerKind: 'pages', preparation: { status: 'skipped', statements: 1 }, version: '16.4.3', missing: [], notes: ['Codebook starts Next with --webpack and skips 1 statement(s) …'] }
 */
async function readNextReadiness(
  workspace: string,
): Promise<NextAdapterReadiness> {
  const { installed, ...installation } = await readNextInstallation(workspace)
  if (!installed) return installation
  const [routerKind, preparation] = await Promise.all([
    readNextRouterKind(workspace),
    readNextDevPreparation(workspace),
  ])
  const notes = [
    ...(routerKind === 'none' ? [NEXT_ROUTE_FOLDER_NOT_FOUND_NOTE] : []),
    ...describeNextDevPreparation(preparation),
  ]
  // A plain `next dev` with no environment setting leaves nothing out, so it is not reported.
  const reportsPreparation =
    preparation.status !== 'none' || preparation.envSettings !== undefined
  const { ready, version, missing } = installation
  return {
    ready,
    routerKind,
    ...(reportsPreparation ? { preparation } : {}),
    ...(version === undefined ? {} : { version }),
    missing,
    ...(notes.length > 0 ? { notes } : {}),
  }
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
 * Reports, for the current workspace, whether each repository-browser adapter could start: its package, version, supported major, Vite's `engines.node` against the configured Node, the `dev` script form and Yarn Plug-n-Play; for an installed Next also the router kind and what Codebook leaves out of `scripts.dev`, as labels that never change `ready`.
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
