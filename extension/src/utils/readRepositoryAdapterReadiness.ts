import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { NEXT_VERSION_MAX_CHARS, VITE_SUPPORTED_MAJOR } from '../constants'

import { describeNextDevPreparation } from './describeNextDevPreparation'
import { hasNextExecutable } from './hasNextExecutable'
import { isSemverLikeVersion } from './isSemverLikeVersion'
import {
  readExpoWebPackageReadiness,
  type ExpoWebAppReadiness,
  type ExpoWebPackageReadiness,
} from './readExpoWebPackageReadiness'
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
  readReactScriptsPackageReadiness,
  type ReactScriptsAppReadiness,
  type ReactScriptsPackageReadiness,
} from './readReactScriptsPackageReadiness'
import {
  readStaticPageReadiness,
  type StaticPageAppReadiness,
  type StaticPagePackageReadiness,
} from './readStaticPageReadiness'
import {
  readViteWorkspaceGaps,
  type ViteDevScriptReadiness,
} from './readViteWorkspaceGaps'
import type { NextPackageTruncationReason } from './scanNextPackages'

export type { NextDevPreparation, NextRouterKind, ViteDevScriptReadiness }

/** One Next app below the repository root as `codebook_status` lists it (`packages[]`); see {@link discoverNextPackages}. */
export type NextPackageReadiness = {
  /** The repository-relative folder: the exact value to declare as `packageRoot`. */
  packageRoot: string
  routerKind: NextRouterKind
  /** Whether Next resolves for this package ({@link resolveNextPackage}). */
  installed: boolean
  /** What a start with this `packageRoot` would decide on the package alone; the environment joins the shared Node and Chrome prerequisites and a managed run. */
  ready: boolean
  version?: string
  missing: string[]
}

/** The Next prerequisite of one workspace. */
export type NextAdapterReadiness = {
  ready: boolean
  /** Which routers the workspace's route folders hold ({@link readNextRouterKind}); a label that never changes `ready`. Present when Next is installed. */
  routerKind?: NextRouterKind
  /** What Codebook leaves out of `scripts.dev` ({@link readNextDevPreparation}); present when Next is installed and the reading is not a plain `none`. */
  preparation?: NextDevPreparation
  /** The `next` package version, when it is installed and readable: a semantic version of at most {@link NEXT_VERSION_MAX_CHARS} characters, since the studied repository chose the text and it is published. */
  version?: string
  missing: string[]
  /** Sentences to tell the learner that never change `ready`: the folders searched for router kind `none`, skipped or unread preparation, unapplied environment settings by name. Present when there is one. */
  notes?: string[]
  /** Status only: whether the root is itself the Next app (its `package.json` names `next` and it has a route folder); a hoisted root `node_modules/next` alone is not. */
  rootIsApp?: boolean
  /** Status only: the Next apps below the root from tracked `package.json` files, each with the readiness a start with its `packageRoot` decides. Empty below the Git root. */
  packages?: NextPackageReadiness[]
  /** Status only: whether `packages` is incomplete. */
  packagesTruncated?: boolean
  /** Status only: why `packages` is incomplete. */
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** One Vite app below the repository root as `codebook_status` lists it (`packages[]`); see {@link discoverPackages}. */
export type VitePackageReadiness = {
  /** The repository-relative folder: the exact value to declare as `packageRoot`. */
  packageRoot: string
  /** Whether Vite resolves for this app inside the repository ({@link resolveViteInstallation}, decision D7). */
  installed: boolean
  /** What a start with this `packageRoot` would decide on the app alone ({@link readViteWorkspaceGaps}); the environment joins the shared Node and Chrome prerequisites and a managed run. */
  ready: boolean
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
  /** Status only: whether the root is itself the Vite app (its `package.json` declares `vite` and the root holds an `index.html` or an accepted `dev` script, decision D5). */
  rootIsApp?: boolean
  /** Status only: the Vite apps below the root from tracked `package.json` files, each with the readiness a start with its `packageRoot` decides. Empty below the Git root. */
  packages?: VitePackageReadiness[]
  /** Status only: whether `packages` is incomplete. */
  packagesTruncated?: boolean
  /** Status only: why `packages` is incomplete. */
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** The react-scripts prerequisite of one workspace: the root app's facts, and in the status answer the apps below the root. */
export type ReactScriptsAdapterReadiness = ReactScriptsAppReadiness & {
  /** Status only: whether the root is itself the react-scripts app (its `package.json` declares `react-scripts`). */
  rootIsApp?: boolean
  /** Status only: the react-scripts apps below the root from tracked `package.json` files, each with the readiness a start with its `packageRoot` decides. Empty below the Git root. */
  packages?: ReactScriptsPackageReadiness[]
  /** Status only: whether `packages` is incomplete. */
  packagesTruncated?: boolean
  /** Status only: why `packages` is incomplete. */
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** The Expo web prerequisite of one workspace: the root app's facts, and in the status answer the apps below the root. */
export type ExpoWebAdapterReadiness = ExpoWebAppReadiness & {
  /** Status only: whether the root is itself the Expo app (its `package.json` declares `expo`). */
  rootIsApp?: boolean
  /** Status only: the Expo apps below the root from tracked `package.json` files, each with the readiness a start with its `packageRoot` decides. Empty below the Git root. */
  packages?: ExpoWebPackageReadiness[]
  /** Status only: whether `packages` is incomplete. */
  packagesTruncated?: boolean
  /** Status only: why `packages` is incomplete. */
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** The plain-page prerequisite of one workspace: the root page's facts, and in the status answer the pages below the root. */
export type StaticPageAdapterReadiness = StaticPageAppReadiness & {
  /** Status only: whether the root is itself a candidate page (an `index.html` and no other adapter's dependency). */
  rootIsApp?: boolean
  /** Status only: the plain pages below the root (`examples/*`, `apps/*`), each with the readiness a start with its `packageRoot` decides. Empty below the Git root. */
  packages?: StaticPagePackageReadiness[]
  /** Status only: whether `packages` is incomplete. */
  packagesTruncated?: boolean
  /** Status only: why `packages` is incomplete. */
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** What `codebook_status` reports per repository-browser adapter for the current workspace. */
export type RepositoryAdapterReadiness = {
  'next-dev-webpack': NextAdapterReadiness
  'vite-dev': ViteAdapterReadiness
  'react-scripts-dev': ReactScriptsAdapterReadiness
  'expo-web-dev': ExpoWebAdapterReadiness
  'static-page': StaticPageAdapterReadiness
}

const nextPackageSchema = z.object({ version: z.string() })

/**
 * Reads the `next` installation: its executable present, its version when readable.
 *
 * Called by {@link readNextReadiness}, which adds the router kind and preparation labels of an installed Next, and by the configured browser run, which names the Next version in a Pages refusal or launch failure.
 *
 * @param workspace - The package root.
 * @param nextFolder - The Next folder {@link resolveNextPackage} resolved; defaults to `<workspace>/node_modules/next`.
 * @returns
 * - `installed: false` with the install sentence when the executable is missing
 * - `installed: true` with `ready: false` and the reinstall sentence when `node_modules/next/package.json` does not parse
 * - `installed: true`, `ready: true` and the version when it is readable
 * - `installed: true`, `ready: true` and no version when the manifest's `version` is not a semantic version of at most {@link NEXT_VERSION_MAX_CHARS} characters: the studied repository chose that text and the run publishes it, so it reads as unread, never as it is
 * @example
 * await readNextInstallation('/repo') // => { installed: true, ready: true, missing: [], version: '16.4.3' }
 * // a manifest whose version is 'latest' or longer than 64 characters:
 * await readNextInstallation('/repo') // => { installed: true, ready: true, missing: [] }
 */
export async function readNextInstallation(
  workspace: string,
  nextFolder: string = join(workspace, 'node_modules/next'),
): Promise<
  Pick<NextAdapterReadiness, 'ready' | 'version' | 'missing'> & {
    installed: boolean
  }
> {
  const installed = await hasNextExecutable(workspace, nextFolder)
  if (!installed)
    return {
      installed: false,
      ready: false,
      missing: [
        'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
      ],
    }
  const text = await readFile(join(nextFolder, 'package.json'), 'utf8').catch(
    () => undefined,
  )
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
  // A version that is no short semantic version is unread: the run publishes it, so the repository's text never goes out raw.
  if (!isSemverLikeVersion(manifest.version, NEXT_VERSION_MAX_CHARS))
    return { installed: true, ready: true, missing: [] }
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
  const [routerKind, reading] = await Promise.all([
    readNextRouterKind(workspace),
    readNextDevPreparation(workspace),
  ])
  const { preparation } = reading
  const notes = [
    ...(routerKind === 'none' ? [NEXT_ROUTE_FOLDER_NOT_FOUND_NOTE] : []),
    ...describeNextDevPreparation(reading),
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
  const [next, vite, reactScripts, expoWeb, staticPage] = await Promise.all([
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
    readReactScriptsReadiness(workspace),
    readExpoWebReadiness(workspace),
    readStaticPageRootReadiness(workspace),
  ])
  return {
    'next-dev-webpack': next,
    'vite-dev': vite,
    'react-scripts-dev': reactScripts,
    'expo-web-dev': expoWeb,
    'static-page': staticPage,
  }
}

/**
 * Reads the root workspace's `static-page` readiness from the shared judgement ({@link readStaticPageReadiness}).
 * Called by {@link readRepositoryAdapterReadiness}; a read that throws is a not-ready report, never a rejection.
 * @param workspace - The workspace root, which is the page folder.
 * @returns The root page's facts; a root with no `index.html` reports `no-entry-page`.
 * @example await readStaticPageRootReadiness('/repo') // => { ready: false, missing: ['no-entry-page'], entry: 'index.html' }
 */
async function readStaticPageRootReadiness(
  workspace: string,
): Promise<StaticPageAdapterReadiness> {
  try {
    return await readStaticPageReadiness(await realpath(workspace))
  } catch {
    return {
      ready: false,
      missing: ['The workspace root could not be checked.'],
      entry: 'index.html',
    }
  }
}

/**
 * Reads the root workspace's `expo-web-dev` readiness from the shared judgement ({@link readExpoWebPackageReadiness}).
 * Called by {@link readRepositoryAdapterReadiness}; a read that throws is a not-ready report, never a rejection.
 * @param workspace - The workspace root, which is the package root.
 * @returns The root app's facts; a root that does not declare expo reports `not-an-expo-app`.
 * @example await readExpoWebReadiness('/repo') // => { installed: false, ready: false, missing: ['not-an-expo-app'] }
 */
async function readExpoWebReadiness(
  workspace: string,
): Promise<ExpoWebAdapterReadiness> {
  try {
    return (await readExpoWebPackageReadiness(workspace, undefined)).readiness
  } catch {
    return {
      installed: false,
      ready: false,
      missing: ['The workspace root could not be checked.'],
    }
  }
}

/**
 * Reads the root workspace's `react-scripts-dev` readiness from the shared judgement ({@link readReactScriptsPackageReadiness}).
 * Called by {@link readRepositoryAdapterReadiness}; a read that throws is a not-ready report, never a rejection.
 * @param workspace - The workspace root, which is the package root.
 * @returns The root app's facts; a root that does not declare react-scripts reports `not-a-react-scripts-app`.
 * @example await readReactScriptsReadiness('/repo') // => { installed: false, ready: false, missing: ['not-a-react-scripts-app'], startScript: { form: 'absent' } }
 */
async function readReactScriptsReadiness(
  workspace: string,
): Promise<ReactScriptsAdapterReadiness> {
  try {
    return (await readReactScriptsPackageReadiness(workspace, undefined))
      .readiness
  } catch {
    return {
      installed: false,
      ready: false,
      missing: ['The workspace root could not be checked.'],
      startScript: { form: 'absent' },
    }
  }
}
