import {
  assembleWebpackLibraryPreloadSource,
  type WebpackLibraryPreloadConfiguration,
} from './webpackLibraryPreloadBody'

/** What the generated Next preload needs to know; see {@link WebpackLibraryPreloadConfiguration}. */
export type NextLibraryPreloadConfiguration = WebpackLibraryPreloadConfiguration

/** `realOf` of the Next tail: the real path of a file, remembered per path. Next's server compilation holds thousands of modules and every rebuild would otherwise call `realpathSync` again for each; only successful lookups are remembered, because a path that does not exist yet may exist later. */
const NEXT_REAL_OF = `const realCache = new Map()
const realOf = (file) => {
  const key = stripQuery(file)
  const known = realCache.get(key)
  if (known !== undefined) return known
  try {
    const real = fs.realpathSync(key)
    realCache.set(key, real)
    return real
  } catch { return path.resolve(key) }
}
`

/**
 * The reporter of the Next tail.
 *
 * A compilation line names its compiler (`client`, `server` or `edge-server`, webpack's `compiler.name`) and the `outputPath` it writes to, so a script the server inspector parsed is matched against the server compilation's files and a page script against the client's. It also lists the external modules whose request names the package (their code is loaded by Node at run time from wherever Node finds it, so no resource shows it) and, beside the chunk files, every other emitted `.js` asset with no resources (Next writes manifests with the compilation's assets that belong to no chunk), so a parsed script of such an asset is matched instead of unmatched.
 */
const NEXT_REPORTER = `const isPackageRequest = (request) => {
  const text = slashed(request)
  return isNamed(text, CONFIG.packageName) || text.includes('node_modules/' + CONFIG.packageName + '/') || text.endsWith('node_modules/' + CONFIG.packageName)
}
const requestsOf = (module) => {
  const request = module.request
  if (typeof request === 'string') return [request]
  return Array.isArray(request) ? request.filter((item) => typeof item === 'string') : []
}
const externalsOf = (compilation) => {
  const found = new Set()
  for (const module of compilation.modules) {
    if (!module || !module.constructor || module.constructor.name !== 'ExternalModule') continue
    for (const request of requestsOf(module)) if (isPackageRequest(request)) found.add(request)
  }
  return Array.from(found).sort()
}
const sha256Of = (compilation, name) => crypto.createHash('sha256').update(compilation.getAsset(name).source.buffer()).digest('hex')
const compilerNameOf = (compilation) => (compilation.compiler && typeof compilation.compiler.name === 'string' ? compilation.compiler.name : '')
const outputPathOf = (compilation) => {
  const outputPath = compilation.outputOptions && compilation.outputOptions.path
  return typeof outputPath === 'string' ? outputPath : ''
}
const describeCompilation = (compilation) => {
  const assets = []
  const seen = new Set()
  for (const chunk of compilation.chunks) {
    const resources = resourcesOfChunk(compilation, chunk)
    for (const name of chunk.files) {
      if (seen.has(name) || !name.endsWith('.js')) continue
      seen.add(name)
      assets.push({ name, sha256: sha256Of(compilation, name), resources })
    }
  }
  for (const name of Object.keys(compilation.assets)) {
    if (seen.has(name) || !name.endsWith('.js')) continue
    seen.add(name)
    // An asset whose bytes cannot be read is left out: a script of it then reads as unmatched, which makes the observation unreadable.
    try { assets.push({ name, sha256: sha256Of(compilation, name), resources: [] }) } catch {}
  }
  return {
    compilationHash: String(compilation.hash),
    compiler: compilerNameOf(compilation),
    outputPath: outputPathOf(compilation),
    publicPath: publicPathOf(compilation),
    assets,
    externals: externalsOf(compilation),
  }
}
const reportCompilation = (compilation) => {
  try {
    const line = describeCompilation(compilation)
    const text = JSON.stringify(line)
    if (Buffer.byteLength(text) + 1 > CONFIG.lineLimitBytes) {
      writeLine({ compilationHash: line.compilationHash, compiler: line.compiler, outputPath: line.outputPath, publicPath: line.publicPath, truncated: true })
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

/**
 * The Next tail: hooks `next/dist/build/webpack-config.js` and patches every configuration it builds.
 *
 * Inert at load, like the react-scripts tail: it only replaces `Module._load` and writes nothing. When Next's `webpack-config.js` is required (in the process that builds the compilers' configurations, a forked child of the one Codebook spawns that inherits `--require`), it returns a `Proxy` over the module's exports whose `default` is the wrapped factory. The export may be a getter, so it is read on each access. The factory is async and is called once per compiler (client, server, edge-server); each configuration is patched and a `{"wrapped":true,"compiler","outputPath"}` line is written when its patch is in place, or its changes are undone and `{"error","compiler"}` is written, and the configuration runs unpatched.
 */
const NEXT_TAIL = `const wrapped = new WeakMap()
const compilerNameOfConfig = (config) => (isPlainObject(config) && typeof config.name === 'string' ? config.name : '')
const outputPathOfConfig = (config) => (isPlainObject(config) && isPlainObject(config.output) && typeof config.output.path === 'string' ? config.output.path : '')
const wrapFactory = (factory) => {
  if (wrapped.has(factory)) return wrapped.get(factory)
  const patched = async function codebookNextWebpackConfigFactory() {
    const config = await factory.apply(this, arguments)
    const changes = makeChanges()
    try {
      patchConfiguration(config, changes)
      writeLine({ wrapped: true, compiler: compilerNameOfConfig(config), outputPath: outputPathOfConfig(config) })
    } catch (error) {
      changes.revert()
      writeLine({ error: String(error && error.message || error), compiler: compilerNameOfConfig(config) })
    }
    return config
  }
  wrapped.set(factory, patched)
  wrapped.set(patched, patched)
  return patched
}

const isNextWebpackConfig = (request, parent, isMain) => {
  if (typeof request !== 'string' || !request.includes('webpack-config')) return false
  return slashed(Module._resolveFilename(request, parent, isMain)).endsWith('next/dist/build/webpack-config.js')
}
const proxies = new WeakMap()
const originalLoad = Module._load
Module._load = function codebookLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments)
  try {
    if (isPlainObject(loaded) && isNextWebpackConfig(request, parent, isMain)) {
      if (!proxies.has(loaded)) {
        proxies.set(loaded, new Proxy(loaded, {
          get(target, key) {
            const value = Reflect.get(target, key)
            return key === 'default' && typeof value === 'function' ? wrapFactory(value) : value
          },
        }))
      }
      return proxies.get(loaded)
    }
  } catch {}
  return loaded
}
`

/**
 * Builds the text of the preload file of one Next library run: the run's configuration as a JSON literal, then the shared body ({@link assembleWebpackLibraryPreloadSource}) with the Next tail.
 *
 * Called by the Next library route when it prepares a run; the file is written into the run's private folder and passed to Next's executable with `node --require`, which reaches the forked server process that builds the webpack configurations.
 * @param configuration - The paths and names the preload redirects with; none is concatenated into code.
 * @returns CommonJS source text.
 * @example
 * buildNextLibraryPreloadSource({ packageName: 'lib', packedRoot: '/p/node_modules/lib', privateFolder: '/p', exampleRoot: '/r/ex', libraryRoot: '/r/lib', peers: [], reportPath: '/p/report.jsonl', cacheFolder: '/p/cache', lineLimitBytes: 1048576 }) // => 'const CONFIG = {…}\n…'
 */
export function buildNextLibraryPreloadSource(
  configuration: NextLibraryPreloadConfiguration,
): string {
  return assembleWebpackLibraryPreloadSource(configuration, {
    realOf: NEXT_REAL_OF,
    reporter: NEXT_REPORTER,
    tail: NEXT_TAIL,
  })
}
