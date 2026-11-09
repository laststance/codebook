import {
  assembleWebpackLibraryPreloadSource,
  WEBPACK_PRELOAD_REAL_OF_PLAIN,
  type WebpackLibraryPreloadConfiguration,
} from './webpackLibraryPreloadBody'

/** What the generated react-scripts preload needs to know; see {@link WebpackLibraryPreloadConfiguration}. */
export type ReactScriptsLibraryPreloadConfiguration =
  WebpackLibraryPreloadConfiguration

/*
 * The react-scripts tail of the shared preload ({@link assembleWebpackLibraryPreloadSource}).
 *
 * It is inert at load: it only replaces `Module._load`, writing and creating nothing, because forked children inherit it through `process.execArgv`. Only when react-scripts' `config/webpack.config.js` factory is required does it wrap the factory once; the wrapped factory patches the configuration it returns and writes `{"wrapped":true}`, or, when anything throws, undoes every change, writes `{"error":"<message>"}` and returns the configuration unpatched. A failure while describing a later compilation writes `{"reportError":"<message>"}` instead, which does not mean the patch was not applied.
 * Its lines carry no compiler name and no output path: react-scripts builds one compilation, matched by its public path.
 */

/** The react-scripts reporter: one line per compilation, without compiler name or output path. */
const REACT_SCRIPTS_REPORTER = `// webpack 5 has getAsset; webpack 4 keeps the sources in compilation.assets, and its older sources may lack buffer().
const bytesOfAsset = (compilation, name) => {
  const source = typeof compilation.getAsset === 'function' ? compilation.getAsset(name).source : compilation.assets[name]
  return typeof source.buffer === 'function' ? source.buffer() : Buffer.from(source.source())
}
const describeCompilation = (compilation) => {
  const assets = []
  const seen = new Set()
  for (const chunk of compilation.chunks) {
    const resources = resourcesOfChunk(compilation, chunk)
    for (const name of chunk.files) {
      if (seen.has(name) || !name.endsWith('.js')) continue
      seen.add(name)
      assets.push({ name, sha256: crypto.createHash('sha256').update(bytesOfAsset(compilation, name)).digest('hex'), resources })
    }
  }
  // Written before the assets so it survives a line cut at the bound.
  const packed = assets.some((asset) => asset.resources.some((file) => isInside(CONFIG.packedRoot, file)))
  return { compilationHash: String(compilation.hash), ...(packed ? { packed: true } : {}), publicPath: publicPathOf(compilation), assets }
}
const reportCompilation = (compilation) => {
  try {
    const line = describeCompilation(compilation)
    const text = JSON.stringify(line)
    if (Buffer.byteLength(text) + 1 > CONFIG.lineLimitBytes) {
      writeLine({ compilationHash: line.compilationHash, ...(line.packed ? { packed: true } : {}), publicPath: line.publicPath, truncated: true })
    } else writeLine(line)
  } catch (error) { writeLine({ reportError: String(error && error.message || error) }) }
}
const createReporterPlugin = () => ({
  apply(compiler) {
    // emit, not afterEmit: afterwards webpack replaces the sources and buffer() throws.
    compiler.hooks.emit.tap(PLUGIN_NAME, reportCompilation)
  },
})

`
/** Wraps the sync factory of react-scripts' `config/webpack.config.js` and hooks it through `Module._load`. */
const REACT_SCRIPTS_TAIL = `const wrapped = new WeakMap()
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
 * Builds the text of the preload file of one react-scripts library run: the run's configuration as a JSON literal, then the shared body ({@link assembleWebpackLibraryPreloadSource}) with the react-scripts tail.
 * Called by the react-scripts library route when it prepares a run; the file is written into the run's private folder and passed to the Example's `react-scripts/scripts/start.js` with `node --require`. The text is pinned byte for byte by a test.
 * @param configuration - The paths and names the preload redirects with; none is concatenated into code.
 * @returns CommonJS source text.
 * @example
 * buildReactScriptsLibraryPreloadSource({ packageName: 'lib', packedRoot: '/p/node_modules/lib', privateFolder: '/p', exampleRoot: '/r/ex', libraryRoot: '/r/lib', peers: [], reportPath: '/p/report.jsonl', cacheFolder: '/p/cache', lineLimitBytes: 1048576 }) // => 'const CONFIG = {…}\n…'
 */
export function buildReactScriptsLibraryPreloadSource(
  configuration: ReactScriptsLibraryPreloadConfiguration,
): string {
  return assembleWebpackLibraryPreloadSource(configuration, {
    realOf: WEBPACK_PRELOAD_REAL_OF_PLAIN,
    reporter: REACT_SCRIPTS_REPORTER,
    tail: REACT_SCRIPTS_TAIL,
  })
}
