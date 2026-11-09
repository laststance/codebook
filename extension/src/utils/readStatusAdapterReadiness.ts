import { realpath } from 'node:fs/promises'

import {
  NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  REPOSITORY_GIT_TOPLEVEL_BYTES,
  REPOSITORY_GIT_TIMEOUT_MS,
} from '../constants'

import {
  describeNestedWorkspace,
  describeNestedWorkspaceRecovery,
} from './describeNestedWorkspace'
import {
  describeNextPackagesTruncation,
  NEXT_PACKAGE_DEPTH_SENTENCE,
} from './describeNextPackagesTruncation'
import {
  discoverPackages,
  type DiscoverPackagesOptions,
  type NextPackageDiscovery,
} from './discoverNextPackages'
import { discoverStaticPages } from './discoverStaticPages'
import { manifestDeclaresExpo } from './manifestDeclaresPackage'
import { manifestNamesNext } from './nextManifest'
import { manifestDeclaresReactScripts } from './reactScriptsManifest'
import { readNextRouterKind } from './readNextRouterKind'
import {
  readRepositoryAdapterReadiness,
  type ExpoWebAdapterReadiness,
  type NextAdapterReadiness,
  type ReactScriptsAdapterReadiness,
  type RepositoryAdapterReadiness,
  type StaticPageAdapterReadiness,
  type ViteAdapterReadiness,
} from './readRepositoryAdapterReadiness'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { readGitTopLevel } from './runOpenedFolderGit'
import type { NextPackageTruncationReason } from './scanNextPackages'
import { isViteAppManifest } from './viteAppManifest'

/**
 * Says whether the opened root is itself the Next app: its `package.json` names `next` and it has a route folder (E3).
 *
 * A hoisted root `node_modules/next` alone never makes the root the choice. Called by {@link readStatusAdapterReadiness} and by {@link pointRootStartToPackages}.
 *
 * @param workspace - The opened repository's root.
 * @returns `true` for a root app; `false` for an unreadable manifest, no `next` dependency or no route folder.
 * @example await readRootIsApp('/repo') // => false for a monorepo root that only hoists Next
 */
export async function readRootIsApp(workspace: string): Promise<boolean> {
  const text = await readRepositoryBuildText(
    workspace,
    'package.json',
    NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
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

/**
 * Says whether the opened root is itself the Vite app by decision D5: its `package.json` declares `vite` and the root holds an `index.html` or an accepted `dev` script.
 *
 * A hoisted root `node_modules/vite` alone never makes the root the choice. Called by {@link readStatusAdapterReadiness}.
 *
 * @param workspace - The opened repository's root.
 * @returns `true` for a root Vite app; `false` for an unreadable manifest, no `vite` declaration, or neither `index.html` nor an accepted `dev` script (a Vitest-only root).
 * @example await readRootIsViteApp('/repo') // => false for a monorepo root that only hoists Vite
 */
async function readRootIsViteApp(workspace: string): Promise<boolean> {
  const text = await readRepositoryBuildText(
    workspace,
    'package.json',
    NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  ).catch(() => undefined)
  if (text === undefined) return false
  try {
    return await isViteAppManifest(JSON.parse(text), workspace)
  } catch {
    return false
  }
}

/**
 * Says whether the opened root is itself the react-scripts app: its `package.json` declares `react-scripts`.
 *
 * A hoisted root `node_modules/react-scripts` alone never makes the root the choice. Called by {@link readStatusAdapterReadiness}.
 *
 * @param workspace - The opened repository's root.
 * @returns `true` for a root react-scripts app; `false` for an unreadable manifest or no `react-scripts` declaration.
 * @example await readRootIsReactScriptsApp('/repo') // => false for a monorepo root that only hoists react-scripts
 */
async function readRootIsReactScriptsApp(workspace: string): Promise<boolean> {
  const text = await readRepositoryBuildText(
    workspace,
    'package.json',
    NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  ).catch(() => undefined)
  if (text === undefined) return false
  try {
    return manifestDeclaresReactScripts(JSON.parse(text))
  } catch {
    return false
  }
}

/**
 * Says whether the opened root is itself the Expo app: its `package.json` declares `expo`.
 *
 * A hoisted root `node_modules/expo` alone never makes the root the choice. Called by {@link readStatusAdapterReadiness}.
 *
 * @param workspace - The opened repository's root.
 * @returns `true` for a root Expo app; `false` for an unreadable manifest or no `expo` declaration.
 * @example await readRootIsExpoWebApp('/repo') // => false for a monorepo root that only hoists expo
 */
async function readRootIsExpoWebApp(workspace: string): Promise<boolean> {
  const text = await readRepositoryBuildText(
    workspace,
    'package.json',
    NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  ).catch(() => undefined)
  if (text === undefined) return false
  try {
    return manifestDeclaresExpo(JSON.parse(text))
  } catch {
    return false
  }
}

/**
 * Says for each adapter whether the opened root is itself its app, unless the folder is below the Git root, where no adapter has an app.
 * Called by {@link readStatusAdapterReadiness}.
 * @param workspace - The opened repository's root.
 * @param isNested - Whether the opened folder lies below the Git root.
 * @returns One flag per adapter.
 * @example await readRootApps('/repo', false) // => { next: false, vite: false, reactScripts: false, expoWeb: true }
 */
async function readRootApps(
  workspace: string,
  isNested: boolean,
): Promise<{
  next: boolean
  vite: boolean
  reactScripts: boolean
  expoWeb: boolean
}> {
  if (isNested)
    return { next: false, vite: false, reactScripts: false, expoWeb: false }
  // The root manifest is read even when Git failed: rootIsApp does not depend on Git.
  const [next, vite, reactScripts, expoWeb] = await Promise.all([
    readRootIsApp(workspace),
    readRootIsViteApp(workspace),
    readRootIsReactScriptsApp(workspace),
    readRootIsExpoWebApp(workspace),
  ])
  return { next, vite, reactScripts, expoWeb }
}

/** What the opened folder is to Git: the repository root, a folder below it (with the names), or in no repository. */
type Placement =
  | { kind: 'root' }
  | { kind: 'nested'; gitRoot: string; workspace: string }
  | { kind: 'no-git' }

/** Asks Git where the opened folder lies within `timeoutMs`; any Git failure is `no-git`. */
async function readPlacement(
  workspace: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Placement> {
  try {
    const [top, real] = await Promise.all([
      readGitTopLevel(workspace, {
        timeoutMs: Math.max(1, timeoutMs),
        maxBuffer: REPOSITORY_GIT_TOPLEVEL_BYTES,
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
  /** The discovery's clock, deadline, limits, owned lock and entry reader; `now` and `timeoutMs` also bound the placement read, which shares the discovery's one deadline. */
  discovery?: DiscoverPackagesOptions
}

/**
 * Reads the repository-browser readiness `codebook_status` reports: {@link readRepositoryAdapterReadiness} plus `rootIsApp` and the Next, Vite, react-scripts and Expo web apps below the root (one discovery pass, {@link discoverPackages}).
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
  // E15: one deadline covers the placement read and the discovery, so a slow Git costs the discovery its share instead of doubling the wait.
  const now = options.discovery?.now ?? Date.now
  const deadlineAt =
    now() + (options.discovery?.timeoutMs ?? REPOSITORY_GIT_TIMEOUT_MS)
  const placement = await readPlacement(workspace, signal, deadlineAt - now())
  const [base, rootApps, discovery] = await Promise.all([
    readRepositoryAdapterReadiness(workspace, node, signal),
    readRootApps(workspace, placement.kind === 'nested'),
    // One pass classifies each tracked package.json for both Next and Vite.
    placement.kind === 'root'
      ? discoverPackages(workspace, {
          node,
          ...options.discovery,
          timeoutMs: Math.max(0, deadlineAt - now()),
          signal,
        })
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
      'vite-dev': {
        ...base['vite-dev'],
        ready: false,
        missing: [recovery],
        rootIsApp: false,
        packages: [],
        packagesTruncated: false,
      },
      'react-scripts-dev': {
        ...base['react-scripts-dev'],
        ready: false,
        missing: [recovery],
        rootIsApp: false,
        packages: [],
        packagesTruncated: false,
      },
      'expo-web-dev': {
        ...base['expo-web-dev'],
        ready: false,
        missing: [recovery],
        rootIsApp: false,
        packages: [],
        packagesTruncated: false,
      },
      'static-page': {
        ...base['static-page'],
        ready: false,
        missing: [recovery],
        rootIsApp: false,
        packages: [],
        packagesTruncated: false,
      },
    }
  }
  const next: NextAdapterReadiness = {
    ...base['next-dev-webpack'],
    rootIsApp: rootApps.next,
    ...listedPackagesOf(discovery?.next),
  }
  const vite: ViteAdapterReadiness = {
    ...base['vite-dev'],
    rootIsApp: rootApps.vite,
    ...listedPackagesOf(discovery?.vite),
  }
  const reactScripts: ReactScriptsAdapterReadiness = {
    ...base['react-scripts-dev'],
    rootIsApp: rootApps.reactScripts,
    ...listedPackagesOf(discovery?.reactScripts),
  }
  const expoWeb: ExpoWebAdapterReadiness = {
    ...base['expo-web-dev'],
    rootIsApp: rootApps.expoWeb,
    ...listedPackagesOf(discovery?.expoWeb),
  }
  const staticPage: StaticPageAdapterReadiness = {
    ...base['static-page'],
    ...(await staticPageListing(workspace, placement.kind === 'root')),
  }
  return {
    'next-dev-webpack': { ...next, missing: rootMissing(next) },
    'vite-dev': vite,
    'react-scripts-dev': reactScripts,
    'expo-web-dev': expoWeb,
    'static-page': staticPage,
  }
}

/**
 * Lists the plain pages of the repository for the `static-page` status report.
 * Called by {@link readStatusAdapterReadiness}; the listing has its own scan (a plain page has no `package.json` to find), so it needs no Git.
 * @param workspace - The opened repository's root.
 * @param isAtGitRoot - Whether the opened folder is the repository root; below it, no adapter lists anything.
 * @returns `rootIsApp`, `packages`, `packagesTruncated` and, when truncated, `packagesTruncatedReason`.
 * @example await staticPageListing('/repo', true) // => { rootIsApp: false, packages: [{ packageRoot: 'examples/page', … }], packagesTruncated: false }
 */
async function staticPageListing(
  workspace: string,
  isAtGitRoot: boolean,
): Promise<
  Pick<
    StaticPageAdapterReadiness,
    'rootIsApp' | 'packages' | 'packagesTruncated' | 'packagesTruncatedReason'
  >
> {
  if (!isAtGitRoot)
    return {
      rootIsApp: false,
      packages: [],
      packagesTruncated: true,
      packagesTruncatedReason: 'git-failed',
    }
  try {
    return await discoverStaticPages(workspace)
  } catch {
    return {
      rootIsApp: false,
      packages: [],
      packagesTruncated: true,
      packagesTruncatedReason: 'git-failed',
    }
  }
}

/**
 * Gives the discovery fields every adapter's status report carries: the listed apps, whether the list is incomplete and why.
 * @param discovery - One kind's discovery; `undefined` when Git could not place the folder, which lists nothing and says `git-failed`.
 * @returns `packages`, `packagesTruncated` and, when truncated, `packagesTruncatedReason`.
 * @example listedPackagesOf(undefined) // => { packages: [], packagesTruncated: true, packagesTruncatedReason: 'git-failed' }
 */
function listedPackagesOf<Entry>(
  discovery:
    | {
        packages: Entry[]
        packagesTruncated: boolean
        packagesTruncatedReason?: NextPackageTruncationReason
      }
    | undefined,
) {
  return {
    packages: discovery?.packages ?? [],
    packagesTruncated: discovery?.packagesTruncated ?? true,
    ...truncationReasonOf(discovery),
  }
}

/**
 * Names the truncation reason of the discovery, or `git-failed` when none ran.
 * @param discovery - The discovery's answer; `undefined` when Git could not place the folder.
 * @returns The `packagesTruncatedReason` field to spread, or nothing for a complete list.
 * @example truncationReasonOf(undefined) // => { packagesTruncatedReason: 'git-failed' }
 */
function truncationReasonOf(
  discovery: Pick<NextPackageDiscovery, 'packagesTruncatedReason'> | undefined,
): Pick<NextAdapterReadiness, 'packagesTruncatedReason'> {
  if (!discovery) return { packagesTruncatedReason: 'git-failed' }
  if (discovery.packagesTruncatedReason)
    return { packagesTruncatedReason: discovery.packagesTruncatedReason }
  return {}
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
  // Only a root that has no Next installation (no router kind is read then) is rewritten, and never a root that is itself the app: its only gap is the install.
  if (next.routerKind !== undefined || next.rootIsApp) return next.missing
  const incomplete =
    next.packagesTruncated && next.packagesTruncatedReason
      ? [describeNextPackagesTruncation(next.packagesTruncatedReason)]
      : []
  if (next.packages && next.packages.length > 0)
    return [
      "Next is not installed at the repository root, so the root is not the app. Next apps below the root are listed in packages: start the one the question is about by declaring its packageRoot (the entry's packageRoot value), and only when that entry's ready is true.",
      ...(incomplete.length > 0 ? incomplete : [NEXT_PACKAGE_DEPTH_SENTENCE]),
    ]
  return incomplete.length > 0 ? [...next.missing, ...incomplete] : next.missing
}
