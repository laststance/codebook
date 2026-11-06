import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

import type {
  BuildClock,
  BuildProcess,
  BuildProcessExit,
  BuildSpawner,
  BuildSpawnRequest,
} from '../../utils/buildProcessTypes'

import { writeTestTarball } from './writeTestTarball'

const temporaryFolders: string[] = []
after(() => {
  for (const folder of temporaryFolders)
    rmSync(folder, { recursive: true, force: true })
})

/** A manual clock: `tick` moves the time the facts read; `advance` also fires the delays that came due. */
export function createLibraryClock(): BuildClock & {
  tick(ms: number): void
  advance(ms: number): Promise<void>
} {
  let nowMs = 0
  const pending: { dueMs: number; resolve(): void }[] = []
  return {
    nowMs: () => nowMs,
    tick(ms): void {
      nowMs += ms
    },
    delay(delayMs, signal): Promise<void> {
      return new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        pending.push({ dueMs: nowMs + delayMs, resolve })
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
    async advance(ms): Promise<void> {
      nowMs += ms
      for (const entry of pending) if (entry.dueMs <= nowMs) entry.resolve()
      // Lets the build step's continuations run before the test looks again.
      for (let turn = 0; turn < 8; turn++)
        await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

/** What a fake process handler can do. */
export type RouteControl = {
  request: BuildSpawnRequest
  output(text: string): void
  exit(status: BuildProcessExit): void
}

/** What a test scripts of the build and the pack; the default build exits 0 and the default pack writes the real tarball of the library folder. */
export type RouteScript = {
  onBuild?(control: RouteControl): void
  onPack?(control: RouteControl): void
  /** Which signal ends a process tree; `never` keeps it alive. */
  endsOn?: 'SIGTERM' | 'SIGKILL' | 'never'
}

/** The files `pnpm pack` would put in the tarball of the fixture library: its manifest and its `dist/` folder. */
export function readLibraryPackFiles(
  libraryRoot: string,
): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': readFileSync(join(libraryRoot, 'package.json'), 'utf8'),
  }
  const dist = join(libraryRoot, 'dist')
  for (const name of readdirSync(dist))
    if (statSync(join(dist, name)).isFile())
      files[`dist/${name}`] = readFileSync(join(dist, name), 'utf8')
  return files
}

/** A fake spawner for the build and the pack; it records each request and each signal. */
export function createRouteSpawner(
  libraryRoot: string,
  script: RouteScript = {},
) {
  const requests: BuildSpawnRequest[] = []
  const signals: string[] = []
  const spawner: BuildSpawner = (request) => {
    requests.push(request)
    let treeIsGone = false
    let resolveExit = (_status: BuildProcessExit): void => undefined
    let resolveTree = (): void => undefined
    const exited = new Promise<BuildProcessExit>(
      (resolve) => (resolveExit = resolve),
    )
    const treeGone = new Promise<void>((resolve) => (resolveTree = resolve))
    const process: BuildProcess = {
      exited,
      treeGone,
      isTreeGone: () => treeIsGone,
      signalTree(signal) {
        signals.push(signal)
        if (signal === (script.endsOn ?? 'SIGTERM')) {
          treeIsGone = true
          resolveExit({ code: null, signal: 'SIGTERM' })
          resolveTree()
        }
      },
    }
    const control: RouteControl = {
      request,
      output: (text) => request.onOutput(text, 'stderr'),
      exit(status) {
        treeIsGone = true
        resolveExit(status)
        resolveTree()
      },
    }
    const isBuild = request.arguments[0] === 'run'
    const handler = isBuild ? script.onBuild : script.onPack
    if (handler) handler(control)
    else if (isBuild) control.exit({ code: 0, signal: null })
    else {
      const destination = request.arguments[2] ?? ''
      writeTestTarball(
        readLibraryPackFiles(libraryRoot),
        join(destination, 'lib-2.0.0.tgz'),
      )
      control.exit({ code: 0, signal: null })
    }
    return process
  }
  return { spawner, requests, signals }
}

/** How a fixture repository differs from the usual supported one. */
export type FixtureOptions = {
  /** The root `packageManager` field; `null` leaves it out. */
  packageManagerField?: string | null
  /** The lockfiles the root holds. */
  lockfiles?: string[]
  hasBuildScript?: boolean
  libraryHasName?: boolean
  /** Whether the Example's package.json depends on the library. */
  exampleDependsOnLibrary?: boolean
  /** Whether the library's dependency `dep` is installed (hoisted at the repository root). */
  installDependency?: boolean
  /** Whether the Example has the library's peer installed. */
  installPeer?: boolean
}

const CONSUMER_SCRIPTS = {
  'run-import.mjs': `import { origin, dep, peer } from 'lib'
import { origin as subOrigin } from 'lib/sub'
import other from 'other'
import examplePeer from 'peer'
import { origin as midOrigin } from 'mid'
const hidden = await import('lib/hidden').then(() => 'loaded', (error) => error.code)
console.log(JSON.stringify({ origin, subOrigin, dep: dep.name, other: other.name, samePeer: peer === examplePeer, midOrigin, hidden }))
`,
  'run-require.cjs': `const lib = require('lib')
const sub = require('lib/sub')
const other = require('other')
const examplePeer = require('peer')
let hidden
try { require('lib/hidden'); hidden = 'loaded' } catch (error) { hidden = error.code }
console.log(JSON.stringify({ origin: lib.origin, subOrigin: sub.origin, dep: lib.dep.name, other: other.name, samePeer: lib.peer === examplePeer, hidden }))
`,
  'run-resolve-only.cjs': `console.log(require.resolve('lib'))\n`,
  'run-published-by-path.mjs': `const published = await import(new URL('./node_modules/lib/dist/index.mjs', import.meta.url))
console.log(published.origin)
`,
} as const

/** Writes a file, creating its folder. */
function put(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** A packed or published copy of the fixture library's dist, marked with where it came from. */
function libraryDist(origin: string): Record<string, string> {
  return {
    'dist/index.mjs': `import dep from 'dep'\nimport peer from 'peer'\nexport const origin = '${origin}'\nexport { dep, peer }\n`,
    'dist/index.cjs': `const dep = require('dep')\nconst peer = require('peer')\nmodule.exports = { origin: '${origin}', dep, peer }\n`,
    'dist/sub.mjs': `export const origin = '${origin}-sub'\n`,
    'dist/sub.cjs': `module.exports = { origin: '${origin}-sub' }\n`,
    'dist/hidden.mjs': `export const origin = '${origin}-hidden'\n`,
  }
}

const LIBRARY_EXPORTS = {
  '.': { import: './dist/index.mjs', require: './dist/index.cjs' },
  './sub': { import: './dist/sub.mjs', require: './dist/sub.cjs' },
}

/**
 * Makes a real Git repository (committed) with a library `packages/lib` (version 2.0.0, built `dist/` ignored), an Example `examples/node` that holds a published copy of the library (version 1.0.0), a peer, an unrelated package and a package that imports the library, plus a private folder beside it.
 * @param options - How this fixture differs from the usual supported one.
 * @returns The roots, the library's configuration and the paths tests change.
 * @example
 * const fixture = createLibraryFixture()
 * // fixture.configuration => { library: { packageRoot: 'packages/lib' } }
 */
export function createLibraryFixture(options: FixtureOptions = {}) {
  const repositoryRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'codebook-library-')),
  )
  temporaryFolders.push(repositoryRoot)
  const privateFolder = realpathSync(
    mkdtempSync(join(tmpdir(), 'codebook-library-private-')),
  )
  temporaryFolders.push(privateFolder)
  const field =
    options.packageManagerField === undefined
      ? 'pnpm@11.23.0'
      : options.packageManagerField
  put(
    repositoryRoot,
    'package.json',
    JSON.stringify({
      name: 'root',
      private: true,
      ...(field === null ? {} : { packageManager: field }),
    }),
  )
  for (const lockfile of options.lockfiles ?? [])
    put(repositoryRoot, lockfile, '')
  put(repositoryRoot, '.gitignore', 'node_modules\ndist\n')
  const libraryRoot = join(repositoryRoot, 'packages', 'lib')
  put(
    libraryRoot,
    'package.json',
    JSON.stringify({
      ...(options.libraryHasName === false ? {} : { name: 'lib' }),
      version: '2.0.0',
      ...(options.hasBuildScript === false
        ? {}
        : { scripts: { build: 'tsc' } }),
      dependencies: { dep: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      exports: LIBRARY_EXPORTS,
    }),
  )
  put(libraryRoot, 'src/index.ts', 'export const origin = "source"\n')
  for (const [path, text] of Object.entries(libraryDist('packed')))
    put(libraryRoot, path, text)
  const examplePackageRoot = join(repositoryRoot, 'examples', 'node')
  put(
    examplePackageRoot,
    'package.json',
    JSON.stringify({
      name: 'example',
      private: true,
      dependencies: {
        ...(options.exampleDependsOnLibrary === false ? {} : { lib: '^1.0.0' }),
        other: '1.0.0',
        mid: '1.0.0',
      },
    }),
  )
  for (const [path, text] of Object.entries(CONSUMER_SCRIPTS))
    put(examplePackageRoot, path, text)
  // The Example's published copy of the library and its other installs, untracked.
  const modules = join(examplePackageRoot, 'node_modules')
  put(
    modules,
    'lib/package.json',
    JSON.stringify({ name: 'lib', version: '1.0.0', exports: LIBRARY_EXPORTS }),
  )
  for (const [path, text] of Object.entries(libraryDist('published')))
    put(join(modules, 'lib'), path, text)
  put(
    modules,
    'other/package.json',
    JSON.stringify({ name: 'other', version: '1.0.0', main: 'index.js' }),
  )
  put(modules, 'other/index.js', "module.exports = { name: 'other' }\n")
  put(
    modules,
    'mid/package.json',
    JSON.stringify({
      name: 'mid',
      version: '1.0.0',
      type: 'module',
      exports: './index.mjs',
    }),
  )
  put(modules, 'mid/index.mjs', "export { origin } from 'lib'\n")
  // A decoy `dep` the library must not pick up: its own install is hoisted to the repository root.
  put(
    modules,
    'dep/package.json',
    JSON.stringify({ name: 'dep', version: '9.9.9', main: 'index.js' }),
  )
  put(
    modules,
    'dep/index.js',
    "module.exports = { name: 'example-dependency' }\n",
  )
  if (options.installPeer !== false) {
    put(
      modules,
      'peer/package.json',
      JSON.stringify({ name: 'peer', version: '1.0.0', main: 'index.js' }),
    )
    put(modules, 'peer/index.js', "module.exports = { name: 'example-peer' }\n")
  }
  if (options.installDependency !== false) {
    put(
      repositoryRoot,
      'node_modules/dep/package.json',
      JSON.stringify({ name: 'dep', version: '1.0.0', main: 'index.js' }),
    )
    put(
      repositoryRoot,
      'node_modules/dep/index.js',
      "module.exports = { name: 'library-dependency' }\n",
    )
  }
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repositoryRoot, stdio: 'pipe' })
  }
  git('init', '-q')
  git('add', '-A')
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '-m',
    'fixture',
  )
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  return {
    repositoryRoot,
    examplePackageRoot,
    libraryRoot,
    privateFolder,
    revision,
    configuration: { library: { packageRoot: 'packages/lib' } },
    roots: { repositoryRoot, examplePackageRoot, privateFolder },
    git,
  }
}

/** The external Node 24 every fake-process test passes. */
export const FIXTURE_NODE = {
  executable: process.execPath,
  version: '24.1.0',
}

/** Says every candidate path is a program, so `pnpm` and `npm` are found without being installed. */
export const EVERY_PATH_IS_A_PROGRAM = (): Promise<boolean> =>
  Promise.resolve(true)

/** Lists the paths, sizes and link targets under a folder, for a before/after equality check. */
export function listFolderState(folder: string): string[] {
  const lines: string[] = []
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      const stats = lstatSync(full)
      lines.push(
        `${prefix}${name} ${stats.isSymbolicLink() ? `-> ${readlinkSync(full)}` : stats.isDirectory() ? 'dir' : stats.size}`,
      )
      if (stats.isDirectory()) walk(full, `${prefix}${name}/`)
    }
  }
  walk(folder, '')
  return lines
}
