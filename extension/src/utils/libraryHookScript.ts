/** What the generated hook file needs to know; it is written into the file as one JSON literal, because the hook runs as `node --import` and cannot rely on the environment. */
export type LibraryHookConfiguration = {
  /** The packed package's name. */
  packageName: string
  /** The real path of the unpacked package folder (`<private>/node_modules/<name>`). */
  packedRoot: string
  /** The run's private folder; `node_modules/<name>` inside it is the only installed copy the hook shows. */
  privateFolder: string
  /** The real path of the Example's package folder; peers of the packed package resolve from here. */
  exampleRoot: string
  /** The real path of the library's package folder; the packed package's other dependencies resolve from here. */
  libraryRoot: string
  /** The packed package's `peerDependencies` names. */
  peers: readonly string[]
  /** The file the hook appends one JSON line per event to. */
  observationFile: string
}

/** The static imports of the hook file; they stay at the top level, outside the main-thread guard that wraps {@link LIBRARY_HOOK_BODY}. */
const LIBRARY_HOOK_IMPORTS = `
import { registerHooks, createRequire, isBuiltin } from 'node:module'
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { isMainThread } from 'node:worker_threads'
`

/**
 * The body of the resolve and load hook of the library route, a module run with `node --import`.
 *
 * It expects `CONFIG` ({@link LibraryHookConfiguration}) to be defined above it, which {@link buildLibraryHookSource} does.
 * `resolve`: the package and its subpaths go to the packed copy (a `require` is resolved with `createRequire` from the private folder and short-circuited under a re-entry guard, because a synchronous resolve hook ignores a `parentURL` override for `require`; an `import` uses the `parentURL` override); a peer imported from inside the packed copy resolves from the Example; any other bare import from inside it resolves from the library's folder.
 * `load`: records loads inside the packed copy and loads of a package with the same name from any other real path.
 * Every event is one JSON line; a closing line is written on a normal exit.
 * It runs on the main thread only: a worker thread inherits `--import`, and its copy of the hook would truncate the main thread's observation and write a closing line when the worker ends.
 * A specifier starting with `#` is a package-internal import of the importing package, so it is never treated as a bare package name.
 * Only files under a `node_modules` folder can be another copy of the package: an Example outside it is the repository's own source.
 */
const LIBRARY_HOOK_BODY = `
const packedRoot = realpathSync(CONFIG.packedRoot) + sep
const privateResolver = CONFIG.privateFolder + sep + 'resolver.js'
const privateParent = pathToFileURL(privateResolver).href
const privateRequire = createRequire(privateResolver)
const exampleParent = pathToFileURL(CONFIG.exampleRoot + sep + 'package.json').href
const exampleRequire = createRequire(CONFIG.exampleRoot + sep + 'package.json')
const libraryParent = pathToFileURL(CONFIG.libraryRoot + sep + 'package.json').href
const libraryRequire = createRequire(CONFIG.libraryRoot + sep + 'package.json')
const record = (event) => appendFileSync(CONFIG.observationFile, JSON.stringify(event) + '\\n')
writeFileSync(CONFIG.observationFile, '')
record({ event: 'start' })

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('#') && !specifier.startsWith('/') && !specifier.includes(':') && !isBuiltin(specifier)
const isRequire = (context) => Array.isArray(context.conditions) && context.conditions.includes('require')
const isNamed = (specifier, name) => specifier === name || specifier.startsWith(name + '/')
const isTarget = (specifier) => isNamed(specifier, CONFIG.packageName)
const isPeer = (specifier) => CONFIG.peers.some((peer) => isNamed(specifier, peer))
const realPathOf = (url) => {
  try { return realpathSync(fileURLToPath(url)) } catch { return '' }
}
const inPacked = (url) => typeof url === 'string' && url.startsWith('file:') && (realPathOf(url) + sep).startsWith(packedRoot)

const nameOfFolder = new Map()
const packageNameAbove = (folder) => {
  const walked = []
  let current = folder
  let found = ''
  for (;;) {
    if (nameOfFolder.has(current)) { found = nameOfFolder.get(current); break }
    walked.push(current)
    try {
      const name = JSON.parse(readFileSync(current + sep + 'package.json', 'utf8')).name
      if (typeof name === 'string' && name !== '') { found = name; break }
    } catch {}
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const visited of walked) nameOfFolder.set(visited, found)
  return found
}

let isResolvingForRequire = false
const resolveForRequire = (specifier, requireFrom) => {
  isResolvingForRequire = true
  try { return requireFrom.resolve(specifier) } finally { isResolvingForRequire = false }
}
const redirect = (kind, specifier, context, nextResolve, parentURL, requireFrom) => {
  if (isRequire(context)) {
    const url = pathToFileURL(resolveForRequire(specifier, requireFrom)).href
    record({ event: kind, specifier, url, via: 'require' })
    return { url, shortCircuit: true }
  }
  const result = nextResolve(specifier, { ...context, parentURL })
  record({ event: kind, specifier, url: result.url, via: 'import' })
  return result
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isResolvingForRequire) return nextResolve(specifier, context)
    if (isTarget(specifier)) return redirect('resolve', specifier, context, nextResolve, privateParent, privateRequire)
    if (isBare(specifier) && inPacked(context.parentURL)) {
      if (isPeer(specifier)) return redirect('peer', specifier, context, nextResolve, exampleParent, exampleRequire)
      return redirect('dependency', specifier, context, nextResolve, libraryParent, libraryRequire)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) {
      const real = realPathOf(url)
      if ((real + sep).startsWith(packedRoot)) record({ event: 'load', path: real })
      else if (real !== '' && real.includes(sep + 'node_modules' + sep) && packageNameAbove(dirname(real)) === CONFIG.packageName) record({ event: 'other-copy', path: real })
    }
    return nextLoad(url, context)
  },
})
process.on('exit', (code) => record({ event: 'closing', code }))
`

/**
 * Builds the text of the hook file of one library run: the run's configuration as a JSON literal, then {@link LIBRARY_HOOK_BODY}.
 * Called by {@link prepareLibraryPackage}, which writes it into the run's private folder and passes it to the script with `--import`.
 * @param configuration - The paths and names the hook redirects with.
 * @returns The module text.
 * @example
 * buildLibraryHookSource({ packageName: 'lib', packedRoot: '/p/node_modules/lib', privateFolder: '/p', exampleRoot: '/r/ex', libraryRoot: '/r/lib', peers: [], observationFile: '/p/observation.jsonl' }) // => 'const CONFIG = {…}\nimport …'
 */
export function buildLibraryHookSource(
  configuration: LibraryHookConfiguration,
): string {
  // Imports are hoisted, so the literal above them is read by the body that follows; the body is guarded so a worker thread installs nothing.
  return `const CONFIG = ${JSON.stringify(configuration)}\n${LIBRARY_HOOK_IMPORTS}\nif (isMainThread) {${LIBRARY_HOOK_BODY}}\n`
}
