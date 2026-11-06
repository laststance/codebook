import { access, readFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

import { isProgramFile } from './isProgramFile'

/** The most characters of a declared `packageManager` text that status and error details quote. */
const PACKAGE_MANAGER_TEXT_LIMIT_CHARS = 200

/**
 * Makes a declared `packageManager` text safe to quote: control characters removed, then cut to {@link PACKAGE_MANAGER_TEXT_LIMIT_CHARS}.
 * Used by the manager decision and by `codebook_status`, because the field is the repository's own text.
 * @param text - The raw field text, a lockfile list or a manager name.
 * @returns The text without control characters, at most 200 characters.
 * @example
 * boundedPackageManagerText('pnpm\u001b[0m') // => 'pnpm[0m'
 */
export function boundedPackageManagerText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, PACKAGE_MANAGER_TEXT_LIMIT_CHARS)
}

/** The package managers the library route can build with. */
export type RepositoryPackageManagerName = 'pnpm' | 'npm'

/** The reasons {@link resolveRepositoryPackageManager} gives for a repository it cannot build with. */
export type PackageManagerRefusalReason =
  | 'package-manager-unsupported'
  | 'package-manager-unknown'
  | 'package-manager-missing'

/** The answer of {@link resolveRepositoryPackageManager}. */
export type RepositoryPackageManagerResult =
  | {
      ok: true
      name: RepositoryPackageManagerName
      /** The version the root `packageManager` field declares; `null` when the manager was chosen by its lockfile. */
      version: string | null
      /** The absolute path of the program found on the searched `PATH`. */
      executable: string
    }
  | {
      ok: false
      reason: PackageManagerRefusalReason
      /** The declared `packageManager` text, the lockfile names found, or the manager name that was not found; for `details.packageManager`. */
      packageManager: string
    }

/** What {@link resolveRepositoryPackageManager} looks with; each is the real one unless a test names its own. */
export type PackageManagerLookupInputs = {
  /** The text of the `PATH` the build will run with (the external Node's folder first). */
  pathText: string
  /** The system whose program names apply. */
  platform?: NodeJS.Platform
  /** Says whether a path is a program this user may start. */
  isProgramFile?: (path: string) => Promise<boolean>
}

/** The manager decision before the program is looked up. */
type ManagerDecision =
  | { ok: true; name: RepositoryPackageManagerName; version: string | null }
  | { ok: false; reason: PackageManagerRefusalReason; packageManager: string }

/** The lockfiles that decide the manager when the root declares none, mapped to the manager each belongs to. */
const LOCKFILE_MANAGERS = {
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
} as const

/** The shape of a `packageManager` field: a name, `@`, a version, and an optional `+hash`. */
const PACKAGE_MANAGER_FIELD = /^([a-z][a-z0-9-]*)@(\d[0-9A-Za-z.-]*)(?:\+.+)?$/

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/** Reads the root `packageManager` field: `undefined` when the file or the field is absent, otherwise the raw value (which may not be text). */
async function readDeclaredField(repositoryRoot: string): Promise<unknown> {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    )
    return typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'packageManager')
      : undefined
  } catch {
    return undefined
  }
}

/** Judges a declared `packageManager` value. */
function judgeDeclared(declared: unknown): ManagerDecision {
  // A value that is not text (JSON allows an object) is unsupported; it is never converted to text, which can throw.
  if (typeof declared !== 'string')
    return {
      ok: false,
      reason: 'package-manager-unsupported',
      packageManager: declared === null ? 'null' : typeof declared,
    }
  const match = PACKAGE_MANAGER_FIELD.exec(declared)
  // A malformed value cannot be trusted to name the manager.
  if (match === null)
    return {
      ok: false,
      reason: 'package-manager-unsupported',
      packageManager: boundedPackageManagerText(declared),
    }
  const [, name, version] = match
  if (name === 'pnpm' || name === 'npm')
    return { ok: true, name, version: version ?? null }
  return {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: boundedPackageManagerText(declared),
  }
}

/** Decides the manager from the declared field or, without one, the single lockfile. */
async function decideManager(repositoryRoot: string): Promise<ManagerDecision> {
  const declared = await readDeclaredField(repositoryRoot)
  if (declared !== undefined) return judgeDeclared(declared)
  const lockfiles = Object.keys(LOCKFILE_MANAGERS) as Array<
    keyof typeof LOCKFILE_MANAGERS
  >
  const found: Array<keyof typeof LOCKFILE_MANAGERS> = []
  for (const lockfile of lockfiles)
    if (await exists(join(repositoryRoot, lockfile))) found.push(lockfile)
  // Both lockfiles or none cannot decide.
  if (found.length !== 1)
    return {
      ok: false,
      reason: 'package-manager-unknown',
      packageManager: found.join(', '),
    }
  const name = LOCKFILE_MANAGERS[found[0] ?? 'pnpm-lock.yaml']
  if (name === 'pnpm' || name === 'npm')
    return { ok: true, name, version: null }
  return {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: name,
  }
}

/** Finds a program by name in the absolute folders of `PATH`, in order. */
async function findOnPath(
  programName: string,
  inputs: PackageManagerLookupInputs,
): Promise<string | undefined> {
  const platform = inputs.platform ?? process.platform
  const isProgram = inputs.isProgramFile ?? isProgramFile
  const names =
    platform === 'win32'
      ? [`${programName}.exe`, `${programName}.com`]
      : [programName]
  const folders = inputs.pathText
    .split(platform === 'win32' ? ';' : delimiter)
    // An empty or relative entry means the current folder, which is the learner's project and is never searched.
    .filter((folder) => folder !== '' && isAbsolute(folder))
  for (const folder of folders)
    for (const name of names) {
      const candidate = join(folder, name)
      if (await isProgram(candidate)) return candidate
    }
  return undefined
}

/**
 * Decides which package manager builds a repository's library and finds it on the run's `PATH`.
 *
 * The root `package.json` `packageManager` field wins (`pnpm@…` or `npm@…`); a malformed value, Yarn or Bun are unsupported. Without the field the single lockfile decides; several or none are unknown.
 * Called by {@link prepareLibraryPackage} before the library route starts anything, and by `codebook_status` for the `node-script` prerequisite.
 * @param repositoryRoot - The opened repository's root.
 * @param inputs - The `PATH` the build runs with and, for tests, the platform and program check.
 * @returns
 * - `{ ok: true, name, version, executable }` for pnpm or npm found on `PATH`; `version` is `null` when a lockfile chose the manager
 * - `{ ok: false, reason, packageManager }` with `package-manager-unsupported`, `package-manager-unknown` or `package-manager-missing`
 * @example
 * await resolveRepositoryPackageManager('/repo', { pathText: '/node/bin:/usr/bin' }) // => { ok: true, name: 'pnpm', version: '11.23.0', executable: '/usr/bin/pnpm' }
 */
export async function resolveRepositoryPackageManager(
  repositoryRoot: string,
  inputs: PackageManagerLookupInputs,
): Promise<RepositoryPackageManagerResult> {
  const decision = await decideManager(repositoryRoot)
  if (!decision.ok) return decision
  const executable = await findOnPath(decision.name, inputs)
  if (executable === undefined)
    return {
      ok: false,
      reason: 'package-manager-missing',
      packageManager: decision.name,
    }
  return { ...decision, executable }
}
