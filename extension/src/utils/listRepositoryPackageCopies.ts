import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { z } from 'zod'

/** The `package.json` fields the disclosure reads: the direct dependency sections of the Example, and the `version` and `repository` of an installed copy. */
const manifestSchema = z.looseObject({
  version: z.string().optional(),
  repository: z
    .union([z.string(), z.looseObject({ url: z.string() })])
    .optional(),
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  optionalDependencies: z.record(z.string(), z.unknown()).optional(),
})

/** One installed copy of a package that names the opened repository as its source. */
export interface RepositoryPackageCopy {
  /** The dependency's package name. */
  package: string
  /** The `version` of the installed copy's `package.json`, or `null` when it holds none. */
  installedVersion: string | null
  /** Always `unverified`: repository metadata shows where a package comes from, not how it was installed or that it matches the checked-out source. */
  correspondence: 'unverified'
}

/** The hosts a `host:owner/repo` shorthand stands for. */
const SHORTHAND_HOSTS: Readonly<Record<string, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
}

/**
 * Names a repository URL in one comparable form, `host/owner/repo` in lower case.
 *
 * Why it exists: a package's `repository` and the repository's `origin` remote spell one location many ways (`github:o/r`, `o/r`, `git+https://…/r.git`, `git@host:o/r.git`), and the disclosure compares them. Called by {@link listRepositoryPackageCopies} for both sides.
 * @param url - A `repository` string or URL, or a remote URL.
 * @returns The normalized form, or `null` when the text names no host, owner and repository.
 * @example
 * normalizeRepositoryLocation('git+https://github.com/Acme/Tool.git#main') // => 'github.com/acme/tool'
 * normalizeRepositoryLocation('github:acme/tool') // => 'github.com/acme/tool'
 */
function normalizeRepositoryLocation(url: string): string | null {
  // Drop a fragment (`#main`) and trailing slashes before looking at the form.
  const text = url.trim().replace(/#.*$/, '').replace(/\/+$/, '')
  const [, shorthandName = '', shorthandPath = ''] =
    /^([a-z]+):(?!\/\/)([^@/\s]+\/[^/\s]+)$/i.exec(text) ?? []
  const shorthandHost = SHORTHAND_HOSTS[shorthandName.toLowerCase()]
  const [, scpHost = '', scpPath = ''] =
    /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(text) ?? []
  let host: string
  let path: string
  if (shorthandHost !== undefined) {
    // `github:owner/repo` and its siblings.
    host = shorthandHost
    path = shorthandPath
  } else if (scpHost !== '') {
    // scp-like `git@host:owner/repo.git`.
    host = scpHost
    path = scpPath
  } else if (/^[^/\s:]+\/[^/\s:]+$/.test(text)) {
    // npm's bare `owner/repo` means GitHub.
    host = 'github.com'
    path = text
  } else {
    try {
      // `git+https://`, `git://`, `ssh://` and `https://` forms.
      const parsed = new URL(text.replace(/^git\+/, ''))
      host = parsed.hostname
      path = parsed.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  }
  const parts = path
    .replace(/\.git$/i, '')
    .split('/')
    .filter((part) => part !== '')
  if (host === '' || parts.length < 2) return null
  return `${host}/${parts.slice(0, 2).join('/')}`.toLowerCase()
}

/**
 * Reads and parses a `package.json`, or `null` when it is missing or not a JSON object.
 * @param file - Absolute path of the file.
 * @returns The fields the disclosure reads.
 * @example await readManifest('/repo/node_modules/tool/package.json') // => { version: '1.2.3' }
 */
async function readManifest(
  file: string,
): Promise<z.infer<typeof manifestSchema> | null> {
  try {
    const parsed = manifestSchema.safeParse(
      JSON.parse(await readFile(file, 'utf8')),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Finds the folder Node would load a dependency from: the nearest `node_modules/<name>` from the Example's folder up to the repository root.
 * @param exampleRoot - Absolute folder of the Example's package.
 * @param repositoryRoot - Absolute root of the opened repository; the walk stops there.
 * @param name - The dependency's package name.
 * @returns The folder as found (a link is not followed), or `null` when none holds a `package.json`.
 * @example await findInstalledFolder('/repo/examples/app', '/repo', 'tool') // => '/repo/node_modules/tool'
 */
async function findInstalledFolder(
  exampleRoot: string,
  repositoryRoot: string,
  name: string,
): Promise<string | null> {
  let folder = exampleRoot
  for (;;) {
    const candidate = join(folder, 'node_modules', name)
    if ((await readManifest(join(candidate, 'package.json'))) !== null)
      return candidate
    // Stop at the repository root, or at the filesystem root when the Example lies elsewhere.
    if (folder === repositoryRoot || dirname(folder) === folder) return null
    folder = dirname(folder)
  }
}

/**
 * Says whether a real path is an installed copy: it holds a `node_modules` segment.
 * Inside the repository only the part below its root counts, so a checkout that itself sits under a `node_modules` folder does not turn its source packages into copies.
 * @param realFolder - The real path of the package folder.
 * @param realRepository - The real path of the repository root.
 * @returns `true` for an npm copy or a pnpm store copy; `false` for a workspace link to a source folder.
 * @example isInstalledCopyPath('/repo/node_modules/.pnpm/tool@1.0.0/node_modules/tool', '/repo') // => true
 */
function isInstalledCopyPath(
  realFolder: string,
  realRepository: string,
): boolean {
  const below = relative(realRepository, realFolder)
  // A folder outside the repository (a global store) is judged by its whole path.
  const outside = below.startsWith('..') || isAbsolute(below)
  return (outside ? realFolder : below).split(sep).includes('node_modules')
}

/** The places one disclosure looks in: the Example, the repository (as given and as resolved) and the normalized origin. */
interface DisclosureScope {
  exampleRoot: string
  repositoryRoot: string
  realRepository: string
  origin: string
}

/**
 * Decides whether one dependency of the Example is an installed copy of the opened repository's own package.
 * @param scope - The Example, repository and origin the dependency is judged against.
 * @param name - The dependency's package name.
 * @returns The disclosure entry, or `null` when the dependency is not installed, names another repository, or links to the source folder.
 * @example await classifyDependency(scope, 'tool') // => { package: 'tool', installedVersion: '1.2.3', correspondence: 'unverified' }
 */
async function classifyDependency(
  scope: DisclosureScope,
  name: string,
): Promise<RepositoryPackageCopy | null> {
  const folder = await findInstalledFolder(
    scope.exampleRoot,
    scope.repositoryRoot,
    name,
  )
  if (folder === null) return null
  const installed = await readManifest(join(folder, 'package.json'))
  const repository =
    typeof installed?.repository === 'string'
      ? installed.repository
      : installed?.repository?.url
  // A copy that names another repository, or none, is not the opened repository's.
  if (
    repository === undefined ||
    normalizeRepositoryLocation(repository) !== scope.origin
  )
    return null
  const realFolder = await realpath(folder).catch(() => null)
  // A workspace link resolves to a source folder without a node_modules segment.
  if (
    realFolder === null ||
    !isInstalledCopyPath(realFolder, scope.realRepository)
  )
    return null
  return {
    package: name,
    installedVersion: installed?.version ?? null,
    correspondence: 'unverified',
  }
}

/**
 * Lists the direct dependencies of an Example that are installed copies of the opened repository's own packages.
 *
 * Why it exists: a `node-script` run without `library` loads whatever the Example's `node_modules` holds, and a chat that forgot `library` would otherwise say nothing while calling that copy the checked-out library. The run resource carries this list so the chat can say the copy's correspondence to the checked-out source is unverified. Called by the `node-script` run when its configuration declares no `library`.
 * A dependency is listed when its installed `package.json` `repository` names `originUrl` and its real path holds a `node_modules` segment; a workspace link to the source folder is not listed.
 * @param exampleRoot - Absolute folder of the Example's package.
 * @param repositoryRoot - Absolute root of the opened repository.
 * @param originUrl - The repository's `origin` remote URL, or `null` when it has none (then nothing is listed).
 * @returns The copies, sorted by package name.
 * @example
 * await listRepositoryPackageCopies('/repo/examples/app', '/repo', 'https://github.com/acme/tool.git')
 * // => [{ package: 'tool', installedVersion: '1.2.3', correspondence: 'unverified' }]
 */
export async function listRepositoryPackageCopies(
  exampleRoot: string,
  repositoryRoot: string,
  originUrl: string | null,
): Promise<RepositoryPackageCopy[]> {
  const origin =
    originUrl === null ? null : normalizeRepositoryLocation(originUrl)
  if (origin === null) return []
  const example = await readManifest(join(exampleRoot, 'package.json'))
  if (example === null) return []
  const realRepository = await realpath(repositoryRoot).catch(
    () => repositoryRoot,
  )
  const names = new Set([
    ...Object.keys(example.dependencies ?? {}),
    ...Object.keys(example.devDependencies ?? {}),
    ...Object.keys(example.optionalDependencies ?? {}),
  ])
  const copies: RepositoryPackageCopy[] = []
  for (const name of [...names].sort()) {
    const copy = await classifyDependency(
      { exampleRoot, repositoryRoot, realRepository, origin },
      name,
    )
    if (copy !== null) copies.push(copy)
  }
  return copies
}
