import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

import { isInsideFolder } from './utils/isInsideFolder'

/**
 * The conditions an `imports` entry of the packed `package.json` is matched with (the conditions of Vite's client environment, as the dev server applies them to the installed copy); `default` always matches.
 */
const IMPORTS_CONDITIONS: readonly string[] = ['import', 'browser', 'module']

/** The file extensions whose served module gets a source map rewrite. */
const MAPPED_MODULE_PATTERN = /\.(?:m?js|cjs)$/

/** The trailing `sourceMappingURL` comment of a built module. */
const SOURCE_MAP_COMMENT_PATTERN = /\n?\/\/[#@] sourceMappingURL=[^\n]*\s*$/

/** Where an import made in the libraries' world is resolved from. */
export type LibraryImportRoute = 'library' | 'peer' | 'dependency' | 'untouched'

/** What {@link createLibraryRedirectPlugin} needs to know; every path is absolute, and `packedRoot` and `libraryRoot` are real paths. */
export type LibraryRedirectOptions = {
  /** The checked-out library's package name (for example `@reduxjs/toolkit`). */
  packageName: string
  /** The real path of the unpacked package folder (`<private>/node_modules/<name>`); it may still be empty or absent when the plugin is created. */
  packedRoot: string
  /** A real file inside the private folder (`<private>/codebook-anchor.js`): Vite resolves from the project root when the importer file does not exist, so the redirect needs a file that does. */
  anchorFile: string
  /** The Example's package root; peers of the packed package resolve from here. */
  exampleRoot: string
  /** The real path of the library's package folder; the packed package's other dependencies resolve from here. */
  libraryRoot: string
  /** The `peerDependencies` names of the packed `package.json`. */
  peers: readonly string[]
  /** The `imports` field of the packed `package.json`, when it has one. */
  imports?: Readonly<Record<string, unknown>>
  /** Reads a text file; `undefined` when it cannot be read. Tests replace it; the default reads from disk. */
  readText?: (path: string) => string | undefined
}

/** The part of Vite's plugin context the redirect uses. */
type RedirectContext = {
  resolve(
    source: string,
    importer: string,
    options: Record<string, unknown>,
  ): Promise<unknown>
}

/** The Vite plugin object {@link createLibraryRedirectPlugin} returns (Vite's own types are not imported: the app's Vite is loaded by the launcher). */
export type LibraryRedirectPlugin = {
  name: string
  enforce: 'pre'
  resolveId(
    this: RedirectContext,
    source: string,
    importer: string | undefined,
    options: Record<string, unknown>,
  ): Promise<unknown>
  load(id: string): { code: string; map: Record<string, unknown> } | null
}

/** Reads a file as UTF-8 text; `undefined` when it does not exist or cannot be read. */
function readTextFromDisk(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Tells whether a specifier is `name` or a subpath of it.
 *
 * Why it exists: the redirect and the `#` import handling name the library and its peers by package, as the Node hook does. Called by {@link routeLibraryImport}.
 *
 * @param specifier - The import specifier.
 * @param name - A package name.
 * @returns `true` for `name` and `name/…`, not for `name-other`.
 * @example
 * isNamedPackage('@acme/widgets/sub', '@acme/widgets') // => true
 */
function isNamedPackage(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`)
}

/**
 * Tells a bare package specifier from a relative, absolute, `#`, URL-scheme, virtual (`\0`) or Node built-in one.
 *
 * Why it exists: only bare specifiers are the redirect's business, as in the Node hook. Called by {@link routeLibraryImport}.
 *
 * @param specifier - The import specifier.
 * @returns `true` for a package name or a subpath of one.
 * @example
 * isBareSpecifier('react') // => true
 * isBareSpecifier('./local.js') // => false
 */
function isBareSpecifier(specifier: string): boolean {
  return (
    specifier !== '' &&
    !/^[./#\0]/.test(specifier) &&
    !specifier.includes(':') &&
    !isBuiltin(specifier)
  )
}

/**
 * Picks the entry of an `imports` map for a specifier: an exact key, else the single-star key with the longest prefix.
 *
 * Why it exists: Node's `imports` matching decides which `#` imports of the packed package point at another package. Called by {@link externalImportsTarget}.
 *
 * @param imports - The packed package's `imports` field.
 * @param specifier - A `#` specifier.
 * @returns The target and the part of the specifier a `*` matched; `undefined` when no key matches.
 * @example
 * matchImportsKey({ '#lib/*': 'lib/*' }, '#lib/a') // => { target: 'lib/*', matched: 'a' }
 */
function matchImportsKey(
  imports: Readonly<Record<string, unknown>>,
  specifier: string,
): { target: unknown; matched: string } | undefined {
  if (Object.hasOwn(imports, specifier) && !specifier.includes('*'))
    return { target: imports[specifier], matched: '' }
  let best:
    { prefixLength: number; target: unknown; matched: string } | undefined
  for (const key of Object.keys(imports)) {
    const star = key.indexOf('*')
    // Only keys with exactly one star are patterns.
    if (star === -1 || star !== key.lastIndexOf('*')) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (
      specifier.length < key.length ||
      !specifier.startsWith(prefix) ||
      !specifier.endsWith(suffix)
    )
      continue
    // The longest prefix wins.
    if (best === undefined || prefix.length > best.prefixLength)
      best = {
        prefixLength: prefix.length,
        target: imports[key],
        matched: specifier.slice(
          prefix.length,
          specifier.length - suffix.length,
        ),
      }
  }
  return best
}

/**
 * Applies Node's target forms of an `imports` entry: a string, a conditions object (first key that is `default` or an active condition, recursively) or an array (first entry that yields a string).
 *
 * Why it exists: the target of a `#` import may depend on conditions. Called by {@link externalImportsTarget}.
 *
 * @param target - One target value of the `imports` map.
 * @param conditions - The active conditions.
 * @returns The target string; `''` when nothing applies.
 * @example
 * pickImportsTarget({ import: 'react', default: './x.js' }, ['import']) // => 'react'
 */
function pickImportsTarget(
  target: unknown,
  conditions: readonly string[],
): string {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) return pickFirstTarget(target, conditions)
  if (target !== null && typeof target === 'object')
    return pickFirstTarget(
      // Only `default` and the active conditions apply, in the map's key order.
      Object.entries(target)
        .filter(([key]) => key === 'default' || conditions.includes(key))
        .map(([, value]: [string, unknown]) => value),
      conditions,
    )
  return ''
}

/** The first target of a list that yields a string, `''` when none does. */
function pickFirstTarget(
  targets: readonly unknown[],
  conditions: readonly string[],
): string {
  for (const entry of targets) {
    const picked = pickImportsTarget(entry, conditions)
    if (picked !== '') return picked
  }
  return ''
}

/**
 * Finds the bare package specifier a `#` import of the packed package points at.
 *
 * Why it exists: a `#` import whose `imports` target is another package resolves like that package imported directly from the packed copy, as the Node hook documents. Called by {@link routeLibraryImport}.
 *
 * @param imports - The packed package's `imports` field, when it has one.
 * @param specifier - A `#` specifier.
 * @returns The bare target (for example `react`); `''` when the target is relative, absent or not matched.
 * @example
 * externalImportsTarget({ '#peer': 'react' }, '#peer') // => 'react'
 */
function externalImportsTarget(
  imports: Readonly<Record<string, unknown>> | undefined,
  specifier: string,
): string {
  if (imports === undefined) return ''
  const match = matchImportsKey(imports, specifier)
  if (match === undefined) return ''
  const picked = pickImportsTarget(match.target, IMPORTS_CONDITIONS)
  const target = picked.split('*').join(match.matched)
  return isBareSpecifier(target) ? target : ''
}

/** Where a bare specifier made from inside the packed folder goes. */
function routeBareFromPacked(
  specifier: string,
  options: Pick<LibraryRedirectOptions, 'packageName' | 'peers'>,
): LibraryImportRoute {
  if (isNamedPackage(specifier, options.packageName)) return 'library'
  // A name listed as both peer and dependency counts as a peer: peers are checked first.
  if (options.peers.some((peer) => isNamedPackage(specifier, peer)))
    return 'peer'
  return 'dependency'
}

/**
 * Decides how one import is resolved, the policy the Node hook of the library route applies.
 *
 * Why it exists: one pure function holds the resolution policy, so a table of cases can run against it and against the Node hook (decision D14). Called by the plugin's `resolveId` of {@link createLibraryRedirectPlugin}.
 *
 * @param specifier - The import specifier.
 * @param isFromPacked - Whether the importing file lies inside the packed folder.
 * @param options - The package name, its peers and the packed `imports`.
 * @returns `library` (resolve through the anchor), `peer` (from the Example), `dependency` (from the library's folder) or `untouched` (left to Vite). From outside the packed folder only the library and its subpaths are redirected; relative, absolute, virtual, URL-scheme and built-in specifiers are always untouched; a `#` import follows the packed `imports` when its target is another package.
 * @example
 * routeLibraryImport('react', true, { packageName: '@acme/widgets', peers: ['react'] }) // => 'peer'
 */
function routeLibraryImport(
  specifier: string,
  isFromPacked: boolean,
  options: Pick<LibraryRedirectOptions, 'packageName' | 'peers' | 'imports'>,
): LibraryImportRoute {
  if (isNamedPackage(specifier, options.packageName)) return 'library'
  if (!isFromPacked) return 'untouched'
  // A `#` alias to another package resolves like that package imported directly from the packed copy.
  if (specifier.startsWith('#')) {
    const aliased = externalImportsTarget(options.imports, specifier)
    return aliased === '' ? 'untouched' : routeBareFromPacked(aliased, options)
  }
  if (!isBareSpecifier(specifier)) return 'untouched'
  return routeBareFromPacked(specifier, options)
}

/**
 * Rewrites the `sources` of a built module's source map to the checked-out files, only where the map's text equals the checked-out file.
 *
 * Why it exists: the existing library seal and the native breakpoint binding match a map source to the checked-out file (decision D7); the packed copy's own `src/` path would neither seal nor bind. Called by the plugin's `load` of {@link createLibraryRedirectPlugin}.
 *
 * @param map - The parsed source map of one packed module.
 * @param moduleFile - The packed module file the map belongs to.
 * @param options - The packed and checked-out roots and the file reader.
 * @returns The map with `sources` rewritten and `sourceRoot` dropped. An entry keeps its original text unless it resolves inside the packed folder and its `sourcesContent` is byte-equal to the checked-out file.
 * @example
 * rewriteMapSources({ sources: ['../src/a.ts'], sourcesContent: ['x'] }, '/p/dist/a.mjs', { packedRoot: '/p', libraryRoot: '/lib', readText }) // => { sources: ['/lib/src/a.ts'], … }
 */
function rewriteMapSources(
  map: Record<string, unknown>,
  moduleFile: string,
  options: Pick<LibraryRedirectOptions, 'packedRoot' | 'libraryRoot'> & {
    readText: (path: string) => string | undefined
  },
): Record<string, unknown> {
  const sources = Array.isArray(map.sources) ? map.sources : []
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : []
  const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
  const rewritten = sources.map((source: unknown, index: number): unknown => {
    if (typeof source !== 'string') return source
    // A source with a URL scheme (webpack://, file://) is not a path inside the packed folder.
    if (
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source) &&
      !/^[a-zA-Z]:[\\/]/.test(source)
    )
      return source
    const packedSource = resolve(dirname(moduleFile), sourceRoot, source)
    if (!isInsideFolder(options.packedRoot, packedSource)) return source
    const checkedOut = join(
      options.libraryRoot,
      relative(options.packedRoot, packedSource),
    )
    const content: unknown = contents[index]
    // Only a source whose embedded text is the checked-out file is shown from it: the editor must never show text that did not run.
    if (typeof content === 'string' && options.readText(checkedOut) === content)
      return checkedOut
    return source
  })
  const { sourceRoot: _dropped, ...rest } = map
  void _dropped
  return { ...rest, sources: rewritten }
}

/**
 * Creates the Vite plugin of the library route: it serves the packed checked-out library wherever the Example imports the installed one.
 *
 * Why it exists: the Example resolves its imports of the library to a published copy; this plugin (`enforce: 'pre'`, added by the owned launcher, never by editing the Example) resolves them to the packed copy and keeps the packed copy's own imports on the right dependency copies (peers from the Example so the page keeps one React, other dependencies from the library's install). Called by the owned Vite launcher ({@link run} in `viteLauncher.ts`) when its options declare `library`.
 * The plugin never reads the packed folder when it is created: the pack may land after the server exists (E2(c) of Cycle 0096).
 * `resolveId` applies {@link routeLibraryImport}; the redirected import goes through `this.resolve` from a real importer file so Vite applies the package `exports` with its client conditions. `load` returns a packed module with its map rewritten by {@link rewriteMapSources}.
 *
 * @param options - The library's names and roots ({@link LibraryRedirectOptions}).
 * @returns The plugin object.
 * @example
 * const plugin = createLibraryRedirectPlugin({ packageName: '@acme/widgets', packedRoot, anchorFile, exampleRoot, libraryRoot, peers: ['react'] })
 * // vite.createServer({ plugins: [plugin] })
 */
export function createLibraryRedirectPlugin(
  options: LibraryRedirectOptions,
): LibraryRedirectPlugin {
  const readText = options.readText ?? readTextFromDisk
  // Importers a redirected import is resolved from: a file that exists in each world.
  const importerOf: Record<Exclude<LibraryImportRoute, 'untouched'>, string> = {
    library: options.anchorFile,
    peer: join(options.exampleRoot, 'package.json'),
    dependency: join(options.libraryRoot, 'package.json'),
  }
  return {
    name: 'codebook-library-redirect',
    enforce: 'pre',
    async resolveId(source, importer, resolveOptions) {
      // An entry (no importer) is never redirected.
      if (importer === undefined) return null
      const importerFile = importer.split('?')[0] ?? importer
      const route = routeLibraryImport(
        source,
        isInsideFolder(options.packedRoot, importerFile),
        options,
      )
      if (route === 'untouched') return null
      // A `#` alias is resolved as its target package, not as the `#` text.
      const target = source.startsWith('#')
        ? externalImportsTarget(options.imports, source)
        : source
      return this.resolve(target, importerOf[route], {
        ...resolveOptions,
        skipSelf: true,
      })
    },
    load(id) {
      const file = id.split('?')[0] ?? id
      if (
        !MAPPED_MODULE_PATTERN.test(file) ||
        !isInsideFolder(options.packedRoot, file)
      )
        return null
      const code = readText(file)
      const mapText = readText(`${file}.map`)
      if (code === undefined || mapText === undefined) return null
      let map: unknown
      try {
        map = JSON.parse(mapText)
      } catch {
        return null
      }
      if (typeof map !== 'object' || map === null || Array.isArray(map))
        return null
      return {
        code: code.replace(SOURCE_MAP_COMMENT_PATTERN, '\n'),
        map: rewriteMapSources(map as Record<string, unknown>, file, {
          packedRoot: options.packedRoot,
          libraryRoot: options.libraryRoot,
          readText,
        }),
      }
    },
  }
}

/** The settings of a resolved Vite config the library blockers read. */
type ResolvedConfigForLibrary = {
  resolve?: { alias?: unknown }
  optimizeDeps?: { include?: unknown }
  environments?: { client?: { optimizeDeps?: { include?: unknown } } }
}

/** What stops the redirect from working, read from the resolved config before the library is built. */
export type LibraryBlockers = {
  /** The alias `find` values (a string, or a regular expression's text) that match the package or one of its subpaths. */
  aliased: string[]
  /** The `optimizeDeps.include` entries that are the package or one of its subpaths. */
  optimizeInclude: string[]
}

/** Lists the `find` values of a resolved `resolve.alias` (object or array form); an entry without a usable `find` is skipped. */
function aliasFinds(alias: unknown): (string | RegExp)[] {
  if (Array.isArray(alias))
    return alias.flatMap((entry: unknown) => {
      const find = (entry as { find?: unknown } | null)?.find
      return typeof find === 'string' || find instanceof RegExp ? [find] : []
    })
  if (typeof alias === 'object' && alias !== null) return Object.keys(alias)
  return []
}

/** Tells whether an alias `find` rewrites an import of the package or of one of its subpaths. */
function aliasMatchesPackage(
  find: string | RegExp,
  packageName: string,
): boolean {
  if (typeof find === 'string')
    // A string find covers the name itself and `name/…`; one that names a subpath of the package covers that subpath.
    return (
      isNamedPackage(packageName, find) || isNamedPackage(find, packageName)
    )
  // A global or sticky regular expression keeps state between tests; a fresh copy never does.
  const pattern = new RegExp(find.source, find.flags.replace(/[gy]/g, ''))
  return [packageName, `${packageName}/`, `${packageName}/subpath`].some(
    (sample) => pattern.test(sample),
  )
}

/** Lists the `optimizeDeps.include` values of a config part as strings. */
function includeEntries(include: unknown): string[] {
  return Array.isArray(include)
    ? include.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * Finds the settings of the app's resolved Vite config that would defeat the redirect.
 *
 * Why it exists: an alias of the package, or a pre-bundled `optimizeDeps.include` of it, takes the import away from the plugin or pulls the installed copy into the optimizer, so the run must be refused before anything is built (Cycle 0096 D9). Called by the owned Vite launcher right after it created the server, to put the result into its facts message.
 *
 * @param resolvedConfig - The server's resolved config (`server.config`).
 * @param packageName - The library's package name.
 * @returns The offending alias finds and include entries; both empty when nothing blocks. A regular expression `find` is judged on the package name and two sample subpaths; an `include` entry in Vite's `parent > nested` form counts when its last segment is the package or a subpath.
 * @example
 * readLibraryBlockers({ resolve: { alias: [{ find: '@acme/widgets', replacement: '/x' }] } }, '@acme/widgets') // => { aliased: ['@acme/widgets'], optimizeInclude: [] }
 */
export function readLibraryBlockers(
  resolvedConfig: unknown,
  packageName: string,
): LibraryBlockers {
  const config = resolvedConfig as ResolvedConfigForLibrary
  const aliased = aliasFinds(config.resolve?.alias)
    .filter((find) => aliasMatchesPackage(find, packageName))
    .map((find) => String(find))
  const optimizeInclude = [
    ...includeEntries(config.optimizeDeps?.include),
    ...includeEntries(config.environments?.client?.optimizeDeps?.include),
  ].filter((entry) => {
    // `parent > nested`: the dependency that is pre-bundled is the last segment.
    const last = (entry.split('>').pop() ?? entry).trim()
    return isNamedPackage(last, packageName)
  })
  return {
    aliased: [...new Set(aliased)],
    optimizeInclude: [...new Set(optimizeInclude)],
  }
}
