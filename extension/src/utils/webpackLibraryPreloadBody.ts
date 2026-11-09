/**
 * The shared body of the webpack library preloads: the part of the generated `node --require` file that the react-scripts tail ({@link buildReactScriptsLibraryPreloadSource}) and the Next tail ({@link buildNextLibraryPreloadSource}) have in common.
 *
 * The preload is one CommonJS text assembled from pieces, so each bundler's file differs only where its configuration factory, its reporter fields or its `realOf` differ, and the react-scripts file stays byte-identical to what it was before the split (a test pins it).
 * Every piece is inert at load. The patch applied to a configuration is: a resolver plugin on the `normal-resolve` step that serves the packed copy, the webpack filesystem cache and the other caches moved into the private folder, source-map names of byte-equal packed sources pointing at the checked-out file (when the devtool template is a function), and a reporter plugin writing one line per compilation at `emit`.
 */

/** What a generated webpack library preload needs to know; it is written into the file as one JSON literal, because the preload runs as `node --require` and cannot rely on the environment. */
export type WebpackLibraryPreloadConfiguration = {
  /** The packed package's name. */
  packageName: string
  /** The real path of the unpacked package folder (`<private>/node_modules/<name>`). */
  packedRoot: string
  /** The run's private folder; `anchor` inside it is where the package name is re-resolved from. */
  privateFolder: string
  /** The real path of the Example's package folder; peers of the packed package resolve from here. */
  exampleRoot: string
  /** The real path of the library's package folder; the packed package's other dependencies resolve from here; byte-equal sources are named by paths below it. */
  libraryRoot: string
  /** The packed package's `peerDependencies` names. */
  peers: readonly string[]
  /** The file the preload appends one JSON line per event to (see {@link WebpackLibraryReportReader}). */
  reportPath: string
  /** The folder the webpack, babel-loader, ESLint and TypeScript caches are redirected into. */
  cacheFolder: string
  /** The most bytes of one report line; a longer compilation line becomes a `truncated` line. */
  lineLimitBytes: number
}

/** The pieces of a generated preload that differ between the bundlers' tails; {@link assembleWebpackLibraryPreloadSource} places them between the shared pieces. */
export type WebpackLibraryPreloadVariant = {
  /** Defines `realOf`: the real path of a file. */
  realOf: string
  /** Defines `describeCompilation`, `reportCompilation` and `createReporterPlugin`. */
  reporter: string
  /** Hooks the bundler's configuration factory (`Module._load`). */
  tail: string
}

/** The start of every preload: modules, helpers and the `CONFIG`-derived constants, up to the definition of `realOf`. Inert at load: nothing is written or created. */
const WEBPACK_PRELOAD_HEAD = `
'use strict'
const Module = require('module')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PLUGIN_NAME = 'CodebookReactScriptsLibrary'
const ANCHOR = path.join(CONFIG.privateFolder, 'anchor')
const packedPrefix = CONFIG.packedRoot + path.sep
const slashed = (file) => file.split(path.sep).join('/')
const isInside = (root, file) => file === root || file.startsWith(root + path.sep)
const isNamed = (specifier, name) => specifier === name || specifier.startsWith(name + '/')
const isBare = (specifier) => /^[A-Za-z0-9@_]/.test(specifier) && !specifier.includes(':')
const stripQuery = (file) => file.split('?')[0]
`

/** The `realOf` of the react-scripts tail: an uncached `realpathSync`. */
export const WEBPACK_PRELOAD_REAL_OF_PLAIN = `const realOf = (file) => {
  try { return fs.realpathSync(stripQuery(file)) } catch { return path.resolve(stripQuery(file)) }
}
`

/** The shared middle: `writeLine`, the change journal, the resolver plugin on `normal-resolve`, the private caches, the devtool template wrap and the resource helpers, up to the reporter. */
const WEBPACK_PRELOAD_COMMON = `const writeLine = (value) => {
  try { fs.appendFileSync(CONFIG.reportPath, JSON.stringify(value) + '\\n') } catch {}
}

// Every assignment goes through here so a failed patch can be undone completely.
const makeChanges = () => {
  const undo = []
  return {
    set(target, key, value) {
      const had = Object.prototype.hasOwnProperty.call(target, key)
      const old = target[key]
      undo.push(() => { if (had) target[key] = old; else delete target[key] })
      target[key] = value
    },
    revert() { while (undo.length > 0) { try { undo.pop()() } catch {} } },
  }
}

// Re-enters the pipeline from the start with a fresh request, so no stale description-file data of the original request leaks into the redirected resolve. The query and fragment were split off by the parser and are put back, because the parser at the 'resolve' hook splits them again.
const redirectRequest = (resolver, request, directory, resolveContext, callback) => {
  const redirected = {
    context: request.context,
    path: directory,
    request: request.request + (request.query || '') + (request.fragment || ''),
  }
  resolver.doResolve(resolver.ensureHook('resolve'), redirected, 'codebook library', resolveContext, callback)
}
const directoryFor = (specifier, context) => {
  if (isInside(CONFIG.packedRoot, context)) {
    if (isNamed(specifier, CONFIG.packageName)) return ''
    if (CONFIG.peers.some((peer) => isNamed(specifier, peer))) return CONFIG.exampleRoot
    return CONFIG.libraryRoot
  }
  if (context === ANCHOR) return ''
  return isNamed(specifier, CONFIG.packageName) ? ANCHOR : ''
}
// Tapped on 'normal-resolve' (enhanced-resolve 5; a resolver without that hook is enhanced-resolve 4, webpack 4, which has no such step and is tapped on 'described-resolve': the step after the description file; on enhanced-resolve 4.5.0 user resolver plugins are applied first, so the tap runs before the alias, alias-field and module-kind steps, and the redirected request re-enters 'resolve' so those steps then apply with the redirect target's description file), the one step every bare request passes after enhanced-resolve (5.x) has parsed it (query and fragment are split off), applied the package's alias fields ('browser' on raw-resolve) and expanded the 'imports' field (which re-enters through internal-resolve or imports-resolve, depending on the version). A request the packed package's alias fields map to a relative path or false never reaches it; one mapped to another bare name or expanded from '#name' arrives here with the path of the packed folder and is redirected like a direct bare import.
const createResolverPlugin = () => ({
  apply(resolver) {
    const hookName = resolver.hooks && resolver.hooks.normalResolve ? 'normal-resolve' : 'described-resolve'
    resolver.ensureHook(hookName).tapAsync(PLUGIN_NAME, (request, resolveContext, callback) => {
      const specifier = request.request
      const context = request.path
      if (typeof specifier !== 'string' || typeof context !== 'string' || !isBare(specifier)) return callback()
      const directory = directoryFor(specifier, context)
      if (directory === '') return callback()
      return redirectRequest(resolver, request, directory, resolveContext, callback)
    })
  },
})

const cachePath = (name) => path.join(CONFIG.cacheFolder, name)
const isPlainObject = (value) => typeof value === 'object' && value !== null
const entriesOf = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const babelEntriesOf = (rules, found) => {
  for (const rule of entriesOf(rules)) {
    if (!isPlainObject(rule)) continue
    if (typeof rule.loader === 'string' && rule.loader.includes('babel-loader')) found.push(rule)
    for (const use of entriesOf(rule.use)) {
      if (isPlainObject(use) && typeof use.loader === 'string' && use.loader.includes('babel-loader')) found.push(use)
    }
    babelEntriesOf(rule.oneOf, found)
    babelEntriesOf(rule.rules, found)
  }
  return found
}
const redirectCaches = (config, changes) => {
  if (isPlainObject(config.cache)) changes.set(config.cache, 'cacheDirectory', cachePath('webpack'))
  const rules = config.module ? config.module.rules : undefined
  for (const entry of babelEntriesOf(rules, [])) {
    if (isPlainObject(entry.options) && entry.options.cacheDirectory) changes.set(entry.options, 'cacheDirectory', cachePath('babel-loader'))
  }
  for (const plugin of config.plugins) {
    const options = plugin && plugin.options
    const name = plugin && plugin.constructor && plugin.constructor.name
    if (name === 'ESLintWebpackPlugin' && isPlainObject(options)) changes.set(options, 'cacheLocation', cachePath('.eslintcache'))
    if (name === 'ForkTsCheckerWebpackPlugin' && isPlainObject(options) && isPlainObject(options.typescript)) {
      if (!isPlainObject(options.typescript.configOverwrite)) changes.set(options.typescript, 'configOverwrite', {})
      const configOverwrite = options.typescript.configOverwrite
      if (!isPlainObject(configOverwrite.compilerOptions)) changes.set(configOverwrite, 'compilerOptions', {})
      changes.set(configOverwrite.compilerOptions, 'tsBuildInfoFile', cachePath('tsconfig.tsbuildinfo'))
    }
  }
}

const sameBytes = (first, second) => {
  try { return fs.readFileSync(first).equals(fs.readFileSync(second)) } catch { return false }
}
const wrapDevtoolTemplate = (original) => {
  const verdicts = new Map()
  const checkedOutFile = (info) => {
    const absolute = info && typeof info.absoluteResourcePath === 'string' ? realOf(info.absoluteResourcePath) : ''
    if (absolute === '' || !absolute.startsWith(packedPrefix)) return ''
    if (!verdicts.has(absolute)) {
      const candidate = path.join(CONFIG.libraryRoot, path.relative(CONFIG.packedRoot, absolute))
      verdicts.set(absolute, sameBytes(absolute, candidate) ? slashed(candidate) : '')
    }
    return verdicts.get(absolute)
  }
  return function devtoolModuleFilenameTemplate(info) {
    try {
      const mapped = checkedOutFile(info)
      if (mapped !== '') return mapped
    } catch {}
    return original.apply(this, arguments)
  }
}

// Keeps the report line small when the library root contains the Example: the Example's own files and every dependency folder are left out, any copy of the library stays.
const hasNodeModulesSegment = (file) => slashed(file).split('/').includes('node_modules')
const isLibraryResource = (file) => {
  if (file.startsWith(packedPrefix)) return true
  if (slashed(file).includes('/node_modules/' + CONFIG.packageName + '/')) return true
  if (!isInside(CONFIG.libraryRoot, file) || isInside(CONFIG.exampleRoot, file)) return false
  return !hasNodeModulesSegment(path.relative(CONFIG.libraryRoot, file))
}
const resourcesOfModule = (module) => {
  const files = []
  const source = module.rootModule || module
  if (typeof source.resource === 'string') files.push(source.resource)
  if (source.modules) for (const inner of source.modules) if (typeof inner.resource === 'string') files.push(inner.resource)
  return files
}
// webpack 5 lists a chunk's modules through the chunk graph, webpack 4 on the chunk itself.
const modulesOfChunk = (compilation, chunk) => (compilation.chunkGraph ? compilation.chunkGraph.getChunkModulesIterable(chunk) : chunk.modulesIterable)
const resourcesOfChunk = (compilation, chunk) => {
  const found = new Set()
  for (const module of modulesOfChunk(compilation, chunk)) {
    for (const file of resourcesOfModule(module)) {
      const real = realOf(file)
      if (isLibraryResource(real)) found.add(real)
    }
  }
  return Array.from(found).sort()
}
const publicPathOf = (compilation) => {
  const publicPath = compilation.outputOptions && compilation.outputOptions.publicPath
  return typeof publicPath === 'string' ? publicPath : ''
}
`

/** The start of `patchConfiguration`, up to the statement that appends the reporter plugin. */
const WEBPACK_PRELOAD_PATCH = `const patchConfiguration = (config, changes) => {
  if (!isPlainObject(config) || !Array.isArray(config.plugins)) throw new Error('the webpack configuration has no plugins array')
  if (!isPlainObject(config.resolve)) changes.set(config, 'resolve', {})
  changes.set(config.resolve, 'plugins', [createResolverPlugin(), ...entriesOf(config.resolve.plugins)])
  redirectCaches(config, changes)
  if (isPlainObject(config.output) && typeof config.output.devtoolModuleFilenameTemplate === 'function') {
    changes.set(config.output, 'devtoolModuleFilenameTemplate', wrapDevtoolTemplate(config.output.devtoolModuleFilenameTemplate))
  }
`

/** The statement of `patchConfiguration` that appends the reporter plugin (each tail's `createReporterPlugin` takes no argument). */
const WEBPACK_PRELOAD_REPORTER_STATEMENT = `  changes.set(config, 'plugins', [...config.plugins, createReporterPlugin()])
`

/** The end of `patchConfiguration`. */
const WEBPACK_PRELOAD_PATCH_END = `}

`

/**
 * Joins the shared pieces and one tail's variant pieces into the text of a preload file, after the run's configuration as a JSON literal.
 *
 * Called by {@link buildReactScriptsLibraryPreloadSource} and {@link buildNextLibraryPreloadSource} when their route prepares a run; the file is written into the run's private folder.
 * @param configuration - The paths and names the preload redirects with; none is concatenated into code.
 * @param variant - The bundler-specific pieces.
 * @returns CommonJS source text.
 * @example
 * assembleWebpackLibraryPreloadSource(configuration, { realOf, reporter, tail }) // => 'const CONFIG = {…}\n…'
 */
export function assembleWebpackLibraryPreloadSource(
  configuration: WebpackLibraryPreloadConfiguration,
  variant: WebpackLibraryPreloadVariant,
): string {
  const body =
    WEBPACK_PRELOAD_HEAD +
    variant.realOf +
    WEBPACK_PRELOAD_COMMON +
    variant.reporter +
    WEBPACK_PRELOAD_PATCH +
    WEBPACK_PRELOAD_REPORTER_STATEMENT +
    WEBPACK_PRELOAD_PATCH_END +
    variant.tail
  return `const CONFIG = ${JSON.stringify(configuration)}\n${body}`
}
