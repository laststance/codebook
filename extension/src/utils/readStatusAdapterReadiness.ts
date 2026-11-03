import { realpath } from 'node:fs/promises'

import { REPOSITORY_GIT_TIMEOUT_MS } from '../constants'

import {
  describeNestedWorkspace,
  describeNestedWorkspaceRecovery,
} from './describeNestedWorkspace'
import { describeNextPackagesTruncation } from './describeNextPackagesTruncation'
import {
  discoverNextPackages,
  type DiscoverNextPackagesOptions,
} from './discoverNextPackages'
import { manifestNamesNext } from './nextManifest'
import { readNextRouterKind } from './readNextRouterKind'
import {
  readRepositoryAdapterReadiness,
  type NextAdapterReadiness,
  type RepositoryAdapterReadiness,
} from './readRepositoryAdapterReadiness'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { readGitTopLevel } from './runOpenedFolderGit'

/** The root `package.json` is read through the safe reader with the same cap as the discovery's manifests. */
const ROOT_MANIFEST_LIMIT_BYTES = 256 * 1024

/**
 * Says whether the opened root is itself the Next app: its `package.json` names `next` and it has a route folder (E3).
 *
 * A hoisted root `node_modules/next` alone never makes the root the choice. Called by {@link readStatusAdapterReadiness}.
 *
 * @param workspace - The opened repository's root.
 * @returns `true` for a root app; `false` for an unreadable manifest, no `next` dependency or no route folder.
 * @example await readRootIsApp('/repo') // => false for a monorepo root that only hoists Next
 */
async function readRootIsApp(workspace: string): Promise<boolean> {
  const text = await readRepositoryBuildText(
    workspace,
    'package.json',
    ROOT_MANIFEST_LIMIT_BYTES,
  ).catch(() => undefined)
  if (text === undefined) return false
  let namesNext: boolean
  try {
    namesNext = manifestNamesNext(JSON.parse(text))
  } catch {
    return false
  }
  return namesNext && (await readNextRouterKind(workspace)) !== 'none'
}

/** What the opened folder is to Git: the repository root, a folder below it (with the names), or in no repository. */
type Placement =
  | { kind: 'root' }
  | { kind: 'nested'; gitRoot: string; workspace: string }
  | { kind: 'no-git' }

/** Asks Git where the opened folder lies; any Git failure is `no-git`. */
async function readPlacement(
  workspace: string,
  signal: AbortSignal,
): Promise<Placement> {
  try {
    const [top, real] = await Promise.all([
      readGitTopLevel(workspace, {
        timeoutMs: REPOSITORY_GIT_TIMEOUT_MS,
        maxBuffer: 65_536,
        signal,
      }).then((path) => realpath(path)),
      realpath(workspace),
    ])
    return top === real
      ? { kind: 'root' }
      : { kind: 'nested', gitRoot: top, workspace: real }
  } catch {
    return { kind: 'no-git' }
  }
}

/** The options of {@link readStatusAdapterReadiness}; the discovery's clock, deadline and entry reader are injectable. */
export type StatusReadinessOptions = {
  discovery?: DiscoverNextPackagesOptions
}

/**
 * Reads the repository-browser readiness `codebook_status` reports: {@link readRepositoryAdapterReadiness} plus `rootIsApp` and the Next apps below the root.
 *
 * Why it exists: AC 4, 5 and 13. The chat chooses the app from `packages` (each entry's `ready` and `missing` are what a start with that `packageRoot` checks), and a workspace opened below the Git root reports every adapter not ready with the adapter-aware recovery, because source authoring refuses every run there. The discovery starts beside the other adapters' reads and the answer waits for it until its one deadline (5 s). Called by the environment's `prerequisites` for `codebook_status`.
 *
 * @param workspace - The opened folder.
 * @param node - The configured Node executable, when one resolved.
 * @param signal - Ends the Node version read and the Git calls.
 * @param options - Injectable discovery options for tests.
 * @returns
 * - Opened at the repository root: the base report with `rootIsApp`, `packages`, `packagesTruncated` (and `packagesTruncatedReason`); a root without Next points to `packages` and `packageRoot` in its `missing`
 * - Opened below the Git root: both adapters `ready: false` with the nested-folder recovery in `missing`, `packages` empty
 * - In no Git repository: the base report, `packages` empty and truncated as `git-failed`
 * @example
 * await readStatusAdapterReadiness('/repo', '/usr/bin/node', signal) // => { 'next-dev-webpack': { ready: false, rootIsApp: false, packages: [{ packageRoot: 'examples/react/nextjs', … }], packagesTruncated: false, … }, 'vite-dev': … }
 */
export async function readStatusAdapterReadiness(
  workspace: string,
  node: string | undefined,
  signal: AbortSignal,
  options: StatusReadinessOptions = {},
): Promise<RepositoryAdapterReadiness> {
  const placement = await readPlacement(workspace, signal)
  const [base, rootIsApp, discovery] = await Promise.all([
    readRepositoryAdapterReadiness(workspace, node, signal),
    placement.kind === 'root' ? readRootIsApp(workspace) : false,
    placement.kind === 'root'
      ? discoverNextPackages(workspace, { ...options.discovery, signal })
      : undefined,
  ])
  if (placement.kind === 'nested') {
    const recovery = describeNestedWorkspaceRecovery(
      describeNestedWorkspace(placement.gitRoot, placement.workspace),
    )
    return {
      'next-dev-webpack': {
        ...base['next-dev-webpack'],
        ready: false,
        missing: [recovery],
        rootIsApp: false,
        packages: [],
        packagesTruncated: false,
      },
      'vite-dev': { ...base['vite-dev'], ready: false, missing: [recovery] },
    }
  }
  const next: NextAdapterReadiness = {
    ...base['next-dev-webpack'],
    rootIsApp,
    packages: discovery?.packages ?? [],
    packagesTruncated: discovery?.packagesTruncated ?? true,
    ...(discovery
      ? discovery.packagesTruncatedReason
        ? { packagesTruncatedReason: discovery.packagesTruncatedReason }
        : {}
      : { packagesTruncatedReason: 'git-failed' as const }),
  }
  return {
    'next-dev-webpack': { ...next, missing: rootMissing(next) },
    'vite-dev': base['vite-dev'],
  }
}

/**
 * Rewrites the root's `missing` when Next is not installed at the root and the discovery knows more (R4, DX-14, DX-19).
 *
 * Called by {@link readStatusAdapterReadiness}. An installed root keeps today's `missing`; a root without Next keeps today's install sentence when nothing below it was found and discovery was complete.
 *
 * @param next - The root's Next readiness with the discovery fields.
 * @returns
 * - The unchanged `missing` for an installed root
 * - The pointer to `packages` and `packageRoot` (plus the incompleteness sentence when truncated) when apps were found
 * - The install sentence plus the incompleteness sentence when none were found and the discovery was truncated
 * - The unchanged `missing` otherwise
 * @example rootMissing({ ready: false, missing: ['Install …'], packages: [], packagesTruncated: false }) // => ['Install …']
 */
function rootMissing(next: NextAdapterReadiness): string[] {
  // Only a root that has no Next installation (no router kind is read then) is rewritten.
  if (next.routerKind !== undefined) return next.missing
  const incomplete =
    next.packagesTruncated && next.packagesTruncatedReason
      ? [describeNextPackagesTruncation(next.packagesTruncatedReason)]
      : []
  if (next.packages && next.packages.length > 0)
    return [
      "Next is not installed at the repository root, so the root is not the app. Next apps below the root are listed in packages: start the one the question is about by declaring its packageRoot (the entry's packageRoot value), and only when that entry's ready is true.",
      ...incomplete,
    ]
  return incomplete.length > 0 ? [...next.missing, ...incomplete] : next.missing
}
