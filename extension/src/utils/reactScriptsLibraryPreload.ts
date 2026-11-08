/** What the generated preload needs to know; it is written into the file as one JSON literal, because the preload runs as `node --require` and cannot rely on the environment. */
export type ReactScriptsLibraryPreloadConfiguration = {
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

/**
 * The body of the preload of the react-scripts library route, a CommonJS file run with `node --require`.
 *
 * It expects `CONFIG` ({@link ReactScriptsLibraryPreloadConfiguration}) to be defined above it, which {@link buildReactScriptsLibraryPreloadSource} does.
 * It is inert at load: it only replaces `Module._load`, writing and creating nothing, because forked children inherit it through `process.execArgv`. Only when react-scripts' `config/webpack.config.js` factory is required does it wrap the factory once; the wrapped factory patches the configuration it returns and writes `{"wrapped":true}`, or, when anything throws, undoes every change, writes `{"error":"<message>"}` and returns the configuration unpatched. A failure while describing a later compilation writes `{"reportError":"<message>"}` instead, which does not mean the patch was not applied.
 * The patch: a resolver plugin (tapped on the `normal-resolve` step, after query splitting, alias fields and the `imports` field) that sends the package name to the packed copy and resolves imports from inside the packed copy like the packed package would (peers from the Example, other bare imports from the library); caches moved into the private folder; source-map names of byte-equal packed sources pointing at the checked-out file; a reporter plugin writing, at `emit`, one line per compilation with the SHA-256 of each emitted script and the real paths of the library-looking modules of its chunks.
 */
const REACT_SCRIPTS_PRELOAD_BODY = `
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
const realOf = (file) => {
  try { return fs.realpathSync(stripQuery(file)) } catch { return path.resolve(stripQuery(file)) }
}
const writeLine = (value) => {
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
// Tapped on 'normal-resolve', the one step every bare request passes after enhanced-resolve (5.x) has parsed it (query and fragment are split off), applied the package's alias fields ('browser' on raw-resolve) and expanded the 'imports' field (which re-enters through internal-resolve or imports-resolve, depending on the version). A request the packed package's alias fields map to a relative path or false never reaches it; one mapped to another bare name or expanded from '#name' arrives here with the path of the packed folder and is redirected like a direct bare import.
const createResolverPlugin = () => ({
  apply(resolver) {
    resolver.ensureHook('normal-resolve').tapAsync(PLUGIN_NAME, (request, resolveContext, callback) => {
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
const resourcesOfChunk = (compilation, chunk) => {
  const found = new Set()
  for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
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
const describeCompilation = (compilation) => {
  const assets = []
  const seen = new Set()
  for (const chunk of compilation.chunks) {
    const resources = resourcesOfChunk(compilation, chunk)
    for (const name of chunk.files) {
      if (seen.has(name) || !name.endsWith('.js')) continue
      seen.add(name)
      const asset = compilation.getAsset(name)
      assets.push({ name, sha256: crypto.createHash('sha256').update(asset.source.buffer()).digest('hex'), resources })
    }
  }
  return { compilationHash: String(compilation.hash), publicPath: publicPathOf(compilation), assets }
}
const reportCompilation = (compilation) => {
  try {
    const line = describeCompilation(compilation)
    const text = JSON.stringify(line)
    if (Buffer.byteLength(text) + 1 > CONFIG.lineLimitBytes) {
      writeLine({ compilationHash: line.compilationHash, publicPath: line.publicPath, truncated: true })
    } else writeLine(line)
  } catch (error) { writeLine({ reportError: String(error && error.message || error) }) }
}
const createReporterPlugin = () => ({
  apply(compiler) {
    // emit, not afterEmit: afterwards webpack replaces the sources and buffer() throws.
    compiler.hooks.emit.tap(PLUGIN_NAME, reportCompilation)
  },
})

const patchConfiguration = (config, changes) => {
  if (!isPlainObject(config) || !Array.isArray(config.plugins)) throw new Error('the webpack configuration has no plugins array')
  if (!isPlainObject(config.resolve)) changes.set(config, 'resolve', {})
  changes.set(config.resolve, 'plugins', [createResolverPlugin(), ...entriesOf(config.resolve.plugins)])
  redirectCaches(config, changes)
  if (isPlainObject(config.output) && typeof config.output.devtoolModuleFilenameTemplate === 'function') {
    changes.set(config.output, 'devtoolModuleFilenameTemplate', wrapDevtoolTemplate(config.output.devtoolModuleFilenameTemplate))
  }
  changes.set(config, 'plugins', [...config.plugins, createReporterPlugin()])
}

const wrapped = new WeakMap()
const wrapFactory = (factory) => {
  if (wrapped.has(factory)) return wrapped.get(factory)
  const patched = function codebookWebpackConfigFactory() {
    const config = factory.apply(this, arguments)
    const changes = makeChanges()
    try {
      patchConfiguration(config, changes)
      writeLine({ wrapped: true })
    } catch (error) {
      changes.revert()
      writeLine({ error: String(error && error.message || error) })
    }
    return config
  }
  Object.assign(patched, factory)
  wrapped.set(factory, patched)
  wrapped.set(patched, patched)
  return patched
}

const isReactScriptsConfig = (request, parent, isMain) => {
  if (typeof request !== 'string' || !request.includes('webpack.config')) return false
  return slashed(Module._resolveFilename(request, parent, isMain)).endsWith('react-scripts/config/webpack.config.js')
}
const originalLoad = Module._load
Module._load = function codebookLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments)
  try {
    if (typeof loaded === 'function' && isReactScriptsConfig(request, parent, isMain)) return wrapFactory(loaded)
  } catch {}
  return loaded
}
`

/**
 * Builds the text of the preload file of one react-scripts library run: the run's configuration as a JSON literal, then {@link REACT_SCRIPTS_PRELOAD_BODY}.
 * Called by the react-scripts library route when it prepares a run; the file is written into the run's private folder and passed to the Example's `react-scripts/scripts/start.js` with `node --require`.
 * @param configuration - The paths and names the preload redirects with; none is concatenated into code.
 * @returns CommonJS source text.
 * @example
 * buildReactScriptsLibraryPreloadSource({ packageName: 'lib', packedRoot: '/p/node_modules/lib', privateFolder: '/p', exampleRoot: '/r/ex', libraryRoot: '/r/lib', peers: [], reportPath: '/p/report.jsonl', cacheFolder: '/p/cache', lineLimitBytes: 1048576 }) // => 'const CONFIG = {…}\n…'
 */
export function buildReactScriptsLibraryPreloadSource(
  configuration: ReactScriptsLibraryPreloadConfiguration,
): string {
  return `const CONFIG = ${JSON.stringify(configuration)}\n${REACT_SCRIPTS_PRELOAD_BODY}`
}
