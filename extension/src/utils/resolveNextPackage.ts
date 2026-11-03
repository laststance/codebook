import { access, realpath, stat } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'

import { z } from 'zod'

import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { repositoryPosixPath } from './repositoryPosixPath'

declare const repositoryRootBrand: unique symbol
declare const packageRootBrand: unique symbol
declare const repositoryRelativeBrand: unique symbol
declare const packageRelativeBrand: unique symbol

/** The opened repository's root as a path; made only by {@link resolveNextPackage}. */
export type RepositoryRoot = string & { readonly [repositoryRootBrand]: true }
/** The Next app's folder (the canonical real path of `packageRoot`, or the repository root itself for the root app); made only by {@link resolveNextPackage}. */
export type PackageRoot = string & { readonly [packageRootBrand]: true }
/** A POSIX path relative to the repository root, as book citations and stop files write it; made only by {@link ResolvedNextPackage}'s mappers. */
export type RepositoryRelativePath = string & {
  readonly [repositoryRelativeBrand]: true
}
/** A POSIX path relative to the package root, as Next names a module (`./src/pages/index.tsx` without the `./`); made only by {@link ResolvedNextPackage}'s mappers. */
export type PackageRelativePath = string & {
  readonly [packageRelativeBrand]: true
}

/** Why a declared `packageRoot` is no folder inside the repository (`details.reason`), plus `not-a-next-app` for a folder whose `package.json` does not name `next`. */
export type PackageRootRefusalReason =
  | 'outside-repository'
  | 'link-leaves-repository'
  | 'not-a-folder'
  | 'missing'
  | 'unreadable'
  | 'not-a-next-app'

/** How a module id Next printed relates to the package: inside it (with both relative paths) or outside it. */
export type NextModuleIdClassification =
  | {
      kind: 'inside'
      packageRelative: PackageRelativePath
      repositoryRelative: RepositoryRelativePath
    }
  | { kind: 'outside'; id: string }

/**
 * The one immutable answer about which Next app a run uses, produced once per run and read by every reader so none falls back to `<packageRoot>/node_modules/next`.
 *
 * Why it exists: status, the start preflight, the launch and the readers of Next's own output must agree on one package root, one Next folder and one executable, and must map Next's package-relative module names to the repository-relative paths books and stops use.
 */
export type ResolvedNextPackage = Readonly<{
  /** The opened repository's root (as given for the root app, its real path for a nested app). */
  repositoryRoot: RepositoryRoot
  /** The folder Next runs in: the cwd of the launch and the root of every Next-path reader. */
  packageRoot: PackageRoot
  /** The package root's canonical repository-relative path (`.` for the root app); the value later saved and keyed. */
  packageRootRelative: string
  /** The value the configuration declared (`.` when absent), unsanitized; for evidence only. */
  declaredPackageRoot: string
  /** Whether this is the repository root app (today's behaviour, byte for byte). */
  isRoot: boolean
  /** The folder of the resolved `next` package. */
  nextFolder: string
  /** `dist/bin/next` of {@link ResolvedNextPackage.nextFolder}, verified (nested: real path, regular file, inside the repository). */
  nextExecutable: string
  /** Maps a repository-relative path to the package-relative one, or `undefined` when the file lies outside the package. Lexical; see {@link ResolvedNextPackage.toPackageRelativeByRealPath} for symlinks. */
  toPackageRelative(path: string): PackageRelativePath | undefined
  /** Like {@link ResolvedNextPackage.toPackageRelative}, but compares real paths so a symlinked alias maps to its target. */
  toPackageRelativeByRealPath(
    path: string,
  ): Promise<PackageRelativePath | undefined>
  /** Maps a package-relative path to the repository-relative one. */
  toRepositoryRelative(path: string): RepositoryRelativePath
  /** Classifies a module id Next printed (`webpack-internal:///(pages-dir-node)/./src/pages/index.tsx`, `./src/a.ts`, `../shared/a.ts`). */
  classifyModuleId(id: string): NextModuleIdClassification
}>

/** What {@link resolveNextPackage} may be given beyond the two paths. */
export type ResolveNextPackageOptions = {
  /** Up to five discovered `packageRoot` values for a refusal's `details.suggestions`; absent or empty until discovery lands. */
  suggest?: () => readonly string[] | Promise<readonly string[]>
}

const SANITIZED_DECLARATION_CHARS = 120
const PACKAGE_MANIFEST_LIMIT_BYTES = 1024 * 1024
const INSTALL_SENTENCE =
  'Install the selected workspace dependencies, including Next, before using next-dev-webpack.'

/** The manifest fields the Next-app check reads. */
const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  peerDependencies: z.record(z.string(), z.unknown()).optional(),
})
const nextManifestSchema = z.looseObject({ name: z.string() })

/**
 * Makes a declared value safe to echo in a message: control characters and line breaks replaced, length bounded.
 * @param declared - The declared `packageRoot` or a path.
 * @returns The bounded single-line text.
 * @example sanitizeDeclaredPath('apps/\nweb') // => 'apps/?web'
 */
export function sanitizeDeclaredPath(declared: string): string {
  const cleaned = declared.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')
  return cleaned.length > SANITIZED_DECLARATION_CHARS
    ? `${cleaned.slice(0, SANITIZED_DECLARATION_CHARS)}…`
    : cleaned
}

/** Names the install command the repository's lockfile implies, for the learner to decide. */
async function installCommandOf(repositoryRoot: string): Promise<string> {
  const lockfiles: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm install'],
    ['yarn.lock', 'yarn install'],
    ['package-lock.json', 'npm install'],
    ['bun.lock', 'bun install'],
    ['bun.lockb', 'bun install'],
  ]
  for (const [file, command] of lockfiles)
    if (
      await access(join(repositoryRoot, file)).then(
        () => true,
        () => false,
      )
    )
      return `\`${command}\` at the repository root`
  return "the repository's install command at the repository root"
}

/** Builds the `INVALID_CONFIGURATION` refusal of a declared `packageRoot`. */
async function invalidPackageRoot(
  declared: string,
  reason: PackageRootRefusalReason,
  options: ResolveNextPackageOptions,
  errno?: string,
): Promise<StudyError> {
  const shown = sanitizeDeclaredPath(declared)
  const words: Record<PackageRootRefusalReason, string> = {
    'outside-repository': 'lies outside the opened repository',
    'link-leaves-repository': 'is a link that leaves the opened repository',
    'not-a-folder': 'is not a folder',
    missing: 'does not exist',
    unreadable: `cannot be read${errno ? ` (${errno})` : ''}`,
    'not-a-next-app':
      'has no package.json that names next in dependencies, devDependencies or peerDependencies',
  }
  const suggestions = [...((await options.suggest?.()) ?? [])]
    .slice(0, 5)
    .map(sanitizeDeclaredPath)
  const message = `packageRoot "${shown}" ${words[reason]}. Declare packageRoot as the repository-relative folder of the Next app (one of details.suggestions), or remove it for an app at the repository root; nothing was started.`
  return new StudyError(
    'INVALID_CONFIGURATION',
    message,
    message,
    undefined,
    undefined,
    {
      field: 'packageRoot',
      packageRoot: shown,
      reason,
      ...(errno ? { errno } : {}),
      suggestions,
      sideEffects: 'none',
    },
  )
}

/** Says whether a real path equals a folder or lies inside it. */
function isFolderOrInside(folder: string, realPath: string): boolean {
  return realPath === folder || isInsideFolder(folder, realPath)
}

/** Reads a file's real path, or the errno code of why it cannot be read. */
async function realPathOrCode(
  path: string,
): Promise<{ path: string } | { code: string }> {
  try {
    return { path: await realpath(path) }
  } catch (error) {
    return {
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'UNKNOWN',
    }
  }
}

/**
 * Builds the immutable record and its mappers from verified paths.
 * Called only by {@link resolveNextPackage}, which is why the branded types are constructible only in this module.
 */
function buildResolved(input: {
  repositoryRoot: string
  packageRoot: string
  packageRootRelative: string
  declaredPackageRoot: string
  isRoot: boolean
  nextFolder: string
  nextExecutable: string
}): ResolvedNextPackage {
  const prefix =
    input.packageRootRelative === '.' ? '' : `${input.packageRootRelative}/`
  const toPackageRelative = (path: string): PackageRelativePath | undefined => {
    const normalized = posix.normalize(path.split('\\').join('/'))
    // A path that climbs out of the repository, or an absolute one, is no repository-relative path at all.
    if (
      normalized === '..' ||
      normalized.startsWith('../') ||
      posix.isAbsolute(normalized)
    )
      return undefined
    if (prefix === '') return normalized as PackageRelativePath
    if (!normalized.startsWith(prefix)) return undefined
    return normalized.slice(prefix.length) as PackageRelativePath
  }
  const toRepositoryRelative = (path: string): RepositoryRelativePath =>
    posix.normalize(
      `${prefix}${path.split('\\').join('/')}`,
    ) as RepositoryRelativePath
  return Object.freeze({
    repositoryRoot: input.repositoryRoot as RepositoryRoot,
    packageRoot: input.packageRoot as PackageRoot,
    packageRootRelative: input.packageRootRelative,
    declaredPackageRoot: input.declaredPackageRoot,
    isRoot: input.isRoot,
    nextFolder: input.nextFolder,
    nextExecutable: input.nextExecutable,
    toPackageRelative,
    async toPackageRelativeByRealPath(path: string) {
      const lexical = toPackageRelative(path)
      const real = await realpath(resolve(input.repositoryRoot, path)).catch(
        () => undefined,
      )
      // A file that does not exist (yet) keeps its lexical placement.
      if (real === undefined) return lexical
      const canonicalRoot = await realpath(input.repositoryRoot).catch(
        () => input.repositoryRoot,
      )
      if (!isFolderOrInside(canonicalRoot, real)) return undefined
      const canonicalPackage = await realpath(input.packageRoot).catch(
        () => input.packageRoot,
      )
      if (!isFolderOrInside(canonicalPackage, real)) return undefined
      return (relative(canonicalPackage, real).split(sep).join('/') ||
        '.') as PackageRelativePath
    },
    toRepositoryRelative,
    classifyModuleId(id: string): NextModuleIdClassification {
      // Strip the loader scheme and the webpack layer: `webpack-internal:///(pages-dir-node)/./x`, `webpack://_N_E/./x`.
      let rest = id.split('\\').join('/')
      rest = rest.replace(/^webpack-internal:\/\/\//, '')
      rest = rest.replace(/^webpack:\/\/[^/]*\//, '')
      rest = rest.replace(/^\([^)/]*\)\//, '')
      // Next names modules relative to its project root; `../` leaves the package and is never normalized back inside.
      if (rest === '..' || rest.startsWith('../') || posix.isAbsolute(rest))
        return { kind: 'outside', id }
      const normalized = posix.normalize(rest)
      if (normalized === '..' || normalized.startsWith('../'))
        return { kind: 'outside', id }
      const packageRelative = normalized as PackageRelativePath
      return {
        kind: 'inside',
        packageRelative,
        repositoryRelative: toRepositoryRelative(packageRelative),
      }
    },
  })
}

/**
 * Resolves the Next app a run uses: its canonical package root, the Next package it resolves from there and the verified executable, once, as one immutable {@link ResolvedNextPackage}.
 *
 * Why it exists: Cycle 0074 lets a Next app live below the repository root (`packageRoot`); status, the start preflight, the launch and the readers share this resolver so none reads `<packageRoot>/node_modules/next` by itself.
 * For a `packageRoot` that is absent or `"."` it reproduces today's root behaviour exactly: `<repositoryRoot>/node_modules/next`, no real-path check, today's message.
 * For another value it refuses, in order: a declared folder that is not a real folder inside the repository (`INVALID_CONFIGURATION`), a folder whose `package.json` does not name `next` (`INVALID_CONFIGURATION`, reason `not-a-next-app`), and a Next that is not installed inside the repository (`PREREQUISITE_MISSING`). The nearest `node_modules/next` from the package root up to the repository root decides; when it fails containment the package is not installed (no fallback to an ancestor's). Yarn PnP and `NODE_PATH` count as not installed.
 * Called by {@link ConfiguredBrowserRun} when it resolves its configuration, by the start preflight in {@link StudyService}, and by the readiness readers.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @param options - An optional provider of discovered values for refusals.
 * @returns The resolved package.
 * @throws `INVALID_CONFIGURATION` (details `field`, `packageRoot`, `reason`, `suggestions`, `sideEffects: "none"`) or `PREREQUISITE_MISSING` (details name the folders searched); nothing was started.
 * @example
 * const next = await resolveNextPackage('/repo', 'examples/react/nextjs')
 * next.nextExecutable // => '/repo/node_modules/.pnpm/next@16.4.3/node_modules/next/dist/bin/next'
 * next.classifyModuleId('webpack-internal:///(pages-dir-node)/./src/pages/index.tsx').kind // => 'inside'
 */
export async function resolveNextPackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions = {},
): Promise<ResolvedNextPackage> {
  const declared = packageRoot ?? '.'
  if (declared === '.') return resolveRootPackage(repositoryRoot)
  const shown = sanitizeDeclaredPath(declared)
  // Step 1: the declared folder, by real path, inside the repository.
  const repositoryReal = await realPathOrCode(repositoryRoot)
  if ('code' in repositoryReal)
    throw await invalidPackageRoot(
      declared,
      'unreadable',
      options,
      repositoryReal.code,
    )
  const lexical = resolve(repositoryReal.path, declared)
  if (!isFolderOrInside(repositoryReal.path, lexical))
    throw await invalidPackageRoot(declared, 'outside-repository', options)
  const real = await realPathOrCode(lexical)
  if ('code' in real)
    throw await invalidPackageRoot(
      declared,
      real.code === 'ENOENT'
        ? 'missing'
        : real.code === 'ENOTDIR'
          ? 'not-a-folder'
          : 'unreadable',
      options,
      real.code === 'ENOENT' || real.code === 'ENOTDIR' ? undefined : real.code,
    )
  if (!isFolderOrInside(repositoryReal.path, real.path))
    throw await invalidPackageRoot(declared, 'link-leaves-repository', options)
  // The real path is read again as a folder now, so a path replaced since is named.
  const entry = await stat(real.path).catch(() => undefined)
  if (!entry?.isDirectory())
    throw await invalidPackageRoot(declared, 'not-a-folder', options)
  // Step 2: the folder is a Next app by its own manifest.
  const manifest = await readRepositoryBuildText(
    real.path,
    'package.json',
    PACKAGE_MANIFEST_LIMIT_BYTES,
  ).then(
    (text) => {
      try {
        return manifestSchema.parse(JSON.parse(text))
      } catch {
        return undefined
      }
    },
    () => undefined,
  )
  const namesNext = Boolean(
    manifest &&
    [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ].some((section) => section !== undefined && 'next' in section),
  )
  if (!namesNext)
    throw await invalidPackageRoot(declared, 'not-a-next-app', options)
  // Step 3: the nearest node_modules/next from the package root up to the repository root, never above it.
  const searched: string[] = []
  let nearest: string | undefined
  for (let folder = real.path; ; folder = dirname(folder)) {
    const candidate = join(folder, 'node_modules', 'next')
    searched.push(repositoryPosixPath(repositoryReal.path, candidate))
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      nearest = candidate
      break
    }
    if (
      folder === repositoryReal.path ||
      !isInsideFolder(repositoryReal.path, folder)
    )
      break
  }
  if (nearest === undefined)
    throw await missingNext(repositoryReal.path, shown, searched)
  // The nearest one decides: when it fails containment the package is not installed (no fallback to an ancestor).
  const nextReal = await realPathOrCode(nearest)
  if (
    'code' in nextReal ||
    !isFolderOrInside(repositoryReal.path, nextReal.path)
  )
    throw outsideNext(shown, searched)
  const nextManifest = await readRepositoryBuildText(
    repositoryReal.path,
    repositoryPosixPath(
      repositoryReal.path,
      join(nextReal.path, 'package.json'),
    ),
    PACKAGE_MANIFEST_LIMIT_BYTES,
  ).then(
    (text) => {
      try {
        return nextManifestSchema.parse(JSON.parse(text))
      } catch {
        return undefined
      }
    },
    () => undefined,
  )
  if (nextManifest?.name !== 'next')
    throw await missingNext(repositoryReal.path, shown, searched)
  const executable = await realPathOrCode(join(nextReal.path, 'dist/bin/next'))
  if ('code' in executable)
    throw await missingNext(repositoryReal.path, shown, searched)
  // A contained Next folder whose executable is a link out of the repository is the same outside-the-repository case.
  if (!isFolderOrInside(repositoryReal.path, executable.path))
    throw outsideNext(shown, searched)
  if (!(await stat(executable.path).catch(() => undefined))?.isFile())
    throw await missingNext(repositoryReal.path, shown, searched)
  return buildResolved({
    repositoryRoot: repositoryReal.path,
    packageRoot: real.path,
    packageRootRelative: repositoryPosixPath(repositoryReal.path, real.path),
    declaredPackageRoot: declared,
    isRoot: real.path === repositoryReal.path,
    nextFolder: nextReal.path,
    nextExecutable: executable.path,
  })
}

/**
 * The root app: today's check unchanged (`<root>/node_modules/next/dist/bin/next` exists), today's sentence, no real-path verification.
 * Called by {@link resolveNextPackage} for an absent or `"."` packageRoot so a run without `packageRoot` behaves exactly as in 0.2.74.0.
 */
async function resolveRootPackage(
  repositoryRoot: string,
): Promise<ResolvedNextPackage> {
  const nextFolder = join(repositoryRoot, 'node_modules/next')
  const nextExecutable = join(nextFolder, 'dist/bin/next')
  try {
    await access(nextExecutable)
  } catch {
    throw new StudyError('PREREQUISITE_MISSING', INSTALL_SENTENCE)
  }
  return buildResolved({
    repositoryRoot,
    packageRoot: repositoryRoot,
    packageRootRelative: '.',
    declaredPackageRoot: '.',
    isRoot: true,
    nextFolder,
    nextExecutable,
  })
}

/** The `PREREQUISITE_MISSING` refusal of a nested package with no Next, naming the install command as the learner's decision and the folders searched. */
async function missingNext(
  repositoryReal: string,
  shown: string,
  searched: readonly string[],
): Promise<StudyError> {
  const command = await installCommandOf(repositoryReal)
  const message = `Next is not installed for ${shown} (searched ${searched.join(', ')}). Ask the learner whether to run ${command}; Codebook never runs it.`
  return new StudyError(
    'PREREQUISITE_MISSING',
    message,
    message,
    undefined,
    undefined,
    { packageRoot: shown, searched, sideEffects: 'none' },
  )
}

/** The `PREREQUISITE_MISSING` refusal of a nested package whose nearest Next lies outside the repository. */
function outsideNext(shown: string, searched: readonly string[]): StudyError {
  const message = `Next for ${shown} resolves outside the repository; install the package's dependencies inside it`
  return new StudyError(
    'PREREQUISITE_MISSING',
    message,
    message,
    undefined,
    undefined,
    { packageRoot: shown, searched, sideEffects: 'none' },
  )
}
