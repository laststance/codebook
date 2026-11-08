import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES } from '../constants'
import { buildNextLibraryPreloadSource } from '../utils/nextLibraryPreload'
import { WebpackLibraryReportReader } from '../utils/webpackLibraryReport'

const run = promisify(execFile)
/** The longest a child that compiles with webpack may run. */
const WEBPACK_CHILD_TIMEOUT_MS = 60_000
const temporaryRoots: string[] = []

after(() => {
  for (const root of temporaryRoots)
    rmSync(root, { recursive: true, force: true })
})

/** Writes a file, creating its folder. */
function writeAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** What a scenario changes in the stand-in configuration factory. */
type Scenario = {
  /** Server configuration lists the package as a webpack external. */
  externalizeLibrary?: boolean
  /** Server configuration cannot be patched after two of its fields were. */
  breakServer?: boolean
  /** Server compilation emits a `.js` asset that belongs to no chunk. */
  emitExtraAsset?: boolean
}

/**
 * A minimal stand-in of Next's `next/dist/build/webpack-config.js`: `default` is defined with a getter (as Next's compiled output does) and is an async factory that builds one webpack configuration per compiler name.
 */
const STAND_IN_FACTORY_SOURCE = (
  appRoot: string,
  outDir: string,
  cacheRoot: string,
) => `
const path = require('path')
async function getBaseWebpackConfig(dir, options) {
  const name = options.name
  const isServer = name === 'server'
  const scenario = options.scenario
  const config = {
    name,
    mode: 'none',
    target: isServer ? 'node' : 'web',
    context: ${JSON.stringify(appRoot)},
    entry: path.join(${JSON.stringify(appRoot)}, isServer ? 'src/server.js' : 'src/client.js'),
    devtool: false,
    output: { path: path.join(${JSON.stringify(outDir)}, name), filename: 'main.js', publicPath: '/_next/', devtoolModuleFilenameTemplate: 'webpack://[resource-path]' },
    cache: { type: 'filesystem', cacheDirectory: path.join(${JSON.stringify(cacheRoot)}, 'webpack') },
    resolve: { plugins: [], conditionNames: isServer ? ['react-server', 'node', 'import', 'require'] : ['browser', 'import', 'require'] },
    plugins: [],
  }
  if (isServer && scenario.externalizeLibrary) config.externals = { lib: 'commonjs lib' }
  if (isServer && scenario.emitExtraAsset) {
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('StandInManifest', (compilation) => {
          compilation.hooks.processAssets.tap({ name: 'StandInManifest', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
            compilation.emitAsset('server-reference-manifest.js', new compiler.webpack.sources.RawSource('self.manifest = {}'))
          })
        })
      },
    })
  }
  if (isServer && scenario.breakServer) {
    // The patch changes the resolver plugins and the cache first, then fails on this read-only function template.
    const template = (info) => info.resourcePath
    Object.defineProperty(config.output, 'devtoolModuleFilenameTemplate', {
      enumerable: true,
      configurable: true,
      get() { return template },
      set() { throw new Error('the template is read-only') },
    })
  }
  return config
}
Object.defineProperty(exports, '__esModule', { value: true })
Object.defineProperty(exports, 'default', { enumerable: true, get: function () { return getBaseWebpackConfig } })
`

/** Builds the configurations through the (possibly wrapped) factory, compiles them as one multi-compiler and prints what the patched configurations and the compilations look like. */
const RUNNER_SOURCE = `
const [factoryPath, webpackPath, scenarioJson] = process.argv.slice(2)
const scenario = JSON.parse(scenarioJson)
const webpack = require(webpackPath)
;(async () => {
  const factory = require(factoryPath).default
  const configs = []
  for (const name of ['client', 'server']) configs.push(await factory('/dir', { name, scenario }))
  const summary = configs.map((config) => ({
    name: config.name,
    cacheDirectory: config.cache.cacheDirectory,
    resolvePluginCount: config.resolve.plugins.length,
  }))
  const compiler = webpack(configs, (error, stats) => {
    if (error) { console.error(error); process.exit(1) }
    const compilations = stats.stats.map((one) => ({
      name: one.compilation.name,
      modules: Array.from(one.compilation.modules, (module) => module.resource).filter(Boolean),
      errors: one.compilation.errors.map(String),
    }))
    compiler.close(() => console.log(JSON.stringify({ summary, compilations })))
  })
})().catch((error) => { console.error(error); process.exit(1) })
`

type Fixture = {
  root: string
  appRoot: string
  libraryRoot: string
  privateFolder: string
  packedRoot: string
  outDir: string
  reportPath: string
  cacheFolder: string
  factoryPath: string
  runnerPath: string
  preloadPath: string
}

/** Writes the whole fixture tree and the generated Next preload into a temporary folder. */
function createFixture(): Fixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'codebook-next-preload-')),
  )
  temporaryRoots.push(root)
  const appRoot = join(root, 'examples/app')
  const libraryRoot = root
  const privateFolder = join(root, 'private')
  const packedRoot = join(privateFolder, 'node_modules/lib')
  const outDir = join(root, 'out')
  const cacheFolder = join(privateFolder, 'cache')
  const reportPath = join(privateFolder, 'report.jsonl')
  const factoryPath = join(
    appRoot,
    'node_modules/next/dist/build/webpack-config.js',
  )
  const runnerPath = join(root, 'runner.js')
  const preloadPath = join(root, 'preload.cjs')

  writeAt(join(appRoot, 'package.json'), '{"name":"app"}')
  const entry =
    "module.exports = [require('lib'), require('lib/sub'), require('importer'), require('peer')]\n"
  writeAt(join(appRoot, 'src/client.js'), entry)
  writeAt(join(appRoot, 'src/server.js'), entry)
  writeAt(
    factoryPath,
    STAND_IN_FACTORY_SOURCE(appRoot, outDir, join(appRoot, '.next-cache')),
  )
  // The installed copy of the library, an importer of it and the Example's peer.
  writeAt(
    join(appRoot, 'node_modules/lib/package.json'),
    JSON.stringify({
      name: 'lib',
      exports: { '.': './index.js', './sub': './sub.js' },
    }),
  )
  writeAt(
    join(appRoot, 'node_modules/lib/index.js'),
    "module.exports = 'installed'\n",
  )
  writeAt(
    join(appRoot, 'node_modules/lib/sub.js'),
    "module.exports = 'installed-sub'\n",
  )
  writeAt(
    join(appRoot, 'node_modules/importer/package.json'),
    '{"name":"importer"}',
  )
  writeAt(
    join(appRoot, 'node_modules/importer/index.js'),
    "module.exports = require('lib')\n",
  )
  writeAt(join(appRoot, 'node_modules/peer/package.json'), '{"name":"peer"}')
  writeAt(
    join(appRoot, 'node_modules/peer/index.js'),
    "module.exports = 'app-peer'\n",
  )
  // The checked-out library holds a decoy peer that must not be used.
  writeAt(join(libraryRoot, 'package.json'), '{"name":"lib"}')
  writeAt(
    join(libraryRoot, 'node_modules/peer/package.json'),
    '{"name":"peer"}',
  )
  writeAt(
    join(libraryRoot, 'node_modules/peer/index.js'),
    "module.exports = 'library-peer'\n",
  )
  // The packed copy: a react-server entry, a default entry that needs the peer, and a subpath.
  writeAt(
    join(packedRoot, 'package.json'),
    JSON.stringify({
      name: 'lib',
      exports: {
        '.': { 'react-server': './rsc.js', default: './index.js' },
        './sub': './sub.js',
      },
    }),
  )
  writeAt(
    join(packedRoot, 'index.js'),
    "module.exports = [require('peer'), 'packed-index']\n",
  )
  writeAt(join(packedRoot, 'rsc.js'), "module.exports = 'packed-rsc'\n")
  writeAt(join(packedRoot, 'sub.js'), "module.exports = 'packed-sub'\n")
  writeAt(join(privateFolder, 'package.json'), '{"name":"private"}')
  mkdirSync(join(privateFolder, 'anchor'), { recursive: true })
  writeAt(runnerPath, RUNNER_SOURCE)
  writeAt(
    preloadPath,
    buildNextLibraryPreloadSource({
      packageName: 'lib',
      packedRoot,
      privateFolder,
      exampleRoot: appRoot,
      libraryRoot,
      peers: ['peer'],
      reportPath,
      cacheFolder,
      lineLimitBytes: REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
    }),
  )
  return {
    root,
    appRoot,
    libraryRoot,
    privateFolder,
    packedRoot,
    outDir,
    reportPath,
    cacheFolder,
    factoryPath,
    runnerPath,
    preloadPath,
  }
}

type RunnerOutput = {
  summary: {
    name: string
    cacheDirectory: string
    resolvePluginCount: number
  }[]
  compilations: { name: string; modules: string[]; errors: string[] }[]
}

/** Spawns `node --require <preload> <runner>` and parses the runner's JSON line. */
async function runWithPreload(
  fixture: Fixture,
  scenario: Scenario = {},
): Promise<RunnerOutput> {
  // A hung webpack compile is killed after the bound and fails this test by name instead of stalling the suite.
  const { stdout } = await run(
    process.execPath,
    [
      '--require',
      fixture.preloadPath,
      fixture.runnerPath,
      fixture.factoryPath,
      require.resolve('webpack'),
      JSON.stringify(scenario),
    ],
    {
      cwd: fixture.root,
      timeout: WEBPACK_CHILD_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  ).catch((error: unknown) => {
    if (error instanceof Error && 'killed' in error && error.killed === true)
      throw new Error(
        `the webpack child did not finish within ${WEBPACK_CHILD_TIMEOUT_MS} ms and was killed`,
      )
    throw error
  })
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as RunnerOutput
}

/** The lines of the report as parsed objects. */
function readReportLines(reportPath: string): Record<string, unknown>[] {
  return readFileSync(reportPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** The modules of one compiler's compilation. */
function modulesOf(output: RunnerOutput, compiler: string): string[] {
  return output.compilations.find((one) => one.name === compiler)?.modules ?? []
}

test('the client and the server compilation serve the packed copy for a direct import, an installed importer and a subpath', async () => {
  // Value: protects=real webpack serves the packed copy in a client and a react-server compiler; fails_when=resolver plugin tapped on the wrong hook, a condition lost, or one compiler left unpatched; no_claim=real Next factory shape (stand-in; E1 and native cover it)
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  assert.deepEqual(
    output.compilations.map((one) => one.errors),
    [[], []],
  )
  const clientModules = modulesOf(output, 'client')
  const serverModules = modulesOf(output, 'server')
  assert.ok(clientModules.includes(join(fixture.packedRoot, 'index.js')))
  assert.ok(clientModules.includes(join(fixture.packedRoot, 'sub.js')))
  // The server compiler resolves the react-server condition inside the packed copy.
  assert.ok(serverModules.includes(join(fixture.packedRoot, 'rsc.js')))
  assert.ok(serverModules.includes(join(fixture.packedRoot, 'sub.js')))
  assert.equal(
    serverModules.includes(join(fixture.packedRoot, 'index.js')),
    false,
  )
  for (const modules of [clientModules, serverModules]) {
    assert.equal(
      modules.some((file) =>
        file.startsWith(join(fixture.appRoot, 'node_modules/lib')),
      ),
      false,
    )
    assert.ok(
      modules.includes(join(fixture.appRoot, 'node_modules/importer/index.js')),
    )
  }
})

test('the packed copy takes its peer from the Example and the webpack cache lands in the private folder', async () => {
  // Value: protects=a peer of the packed copy resolves from the Example root and no cache file appears under the Example; fails_when=a peer resolves to the library folder or a cache is written beside the Example; no_claim=Next's own SWC cache
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const clientModules = modulesOf(output, 'client')
  assert.ok(
    clientModules.includes(join(fixture.appRoot, 'node_modules/peer/index.js')),
  )
  assert.equal(
    clientModules.includes(
      join(fixture.libraryRoot, 'node_modules/peer/index.js'),
    ),
    false,
  )
  assert.deepEqual(
    output.summary.map((one) => one.cacheDirectory),
    [
      join(fixture.cacheFolder, 'webpack'),
      join(fixture.cacheFolder, 'webpack'),
    ],
  )
  assert.equal(existsSync(join(fixture.appRoot, '.next-cache')), false)
  assert.equal(existsSync(join(fixture.cacheFolder, 'webpack')), true)
})

test('each compiler writes its own wrapped line naming the compiler and its output folder', async () => {
  // Value: protects=one wrapped line per compiler with the folder it writes to; fails_when=the line lacks the compiler or one compiler is not wrapped; no_claim=edge-server (the stand-in builds two compilers)
  // Arrange
  const fixture = createFixture()

  // Act
  await runWithPreload(fixture)

  // Assert
  const wrappedLines = readReportLines(fixture.reportPath).filter(
    (line) => line.wrapped === true,
  )
  assert.deepEqual(wrappedLines, [
    {
      wrapped: true,
      compiler: 'client',
      outputPath: join(fixture.outDir, 'client'),
    },
    {
      wrapped: true,
      compiler: 'server',
      outputPath: join(fixture.outDir, 'server'),
    },
  ])
})

test('a patch that throws writes an error line naming the compiler and leaves that configuration as it was', async () => {
  // Value: protects=a half-patched configuration never runs: the changes are undone and the compiler is named; fails_when=the resolver plugin or the private cache stays on a configuration whose patch threw; no_claim=refusal wording of the run
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture, { breakServer: true })

  // Assert
  const lines = readReportLines(fixture.reportPath)
  const errorLines = lines.filter((line) => 'error' in line)
  assert.equal(errorLines.length, 1)
  assert.equal(errorLines[0]?.compiler, 'server')
  assert.equal(
    lines
      .filter((line) => line.wrapped === true)
      .map((line) => line.compiler)
      .join(),
    'client',
  )
  const server = output.summary.find((one) => one.name === 'server')
  assert.equal(server?.resolvePluginCount, 0)
  assert.equal(
    server?.cacheDirectory,
    join(fixture.appRoot, '.next-cache/webpack'),
  )
})

test('an external module of the package is reported by its compiler', async () => {
  // Value: protects=an externalized request of the package is visible to the reader; fails_when=an external require of the installed copy leaves no trace in the report; no_claim=Next's own externals function (a webpack externals object stands in)
  // Arrange
  const fixture = createFixture()

  // Act
  await runWithPreload(fixture, { externalizeLibrary: true })

  // Assert
  const reader = new WebpackLibraryReportReader()
  reader.refresh(fixture.reportPath, true)
  assert.deepEqual(reader.externalsOf(), ['lib'])
  const serverLine = readReportLines(fixture.reportPath).find(
    (line) => line.compiler === 'server' && 'assets' in line,
  )
  assert.deepEqual(serverLine?.externals, ['lib'])
})

test('loading the preload writes nothing and hooks only webpack-config.js', async () => {
  // Value: protects=the preload is inert at load and leaves other modules untouched; fails_when=a file is written at load or a module named like a webpack config elsewhere is wrapped; no_claim=real Next
  // Arrange
  const fixture = createFixture()
  const otherPath = join(fixture.root, 'other/webpack-config.js')
  writeAt(
    otherPath,
    'async function other() { return 1 }\nmodule.exports = { default: other, other }\n',
  )

  // Act
  const { stdout } = await run(
    process.execPath,
    [
      '--require',
      fixture.preloadPath,
      '-e',
      `const loaded = require(${JSON.stringify(otherPath)}); console.log(String(loaded.default === loaded.other))`,
    ],
    { cwd: fixture.root, timeout: WEBPACK_CHILD_TIMEOUT_MS },
  )

  // Assert
  assert.equal(stdout.trim(), 'true')
  assert.equal(existsSync(fixture.reportPath), false)
  assert.equal(existsSync(join(fixture.privateFolder, 'cache')), false)
})

test('a script of the server compilation matches the report by real path and hash, and the page and the server do not collide', async () => {
  // Value: protects=the report the real preload writes lets the reader match the emitted server file and client file, each only on its own side; fails_when=a server file is judged as a page script or a page file as a server script; no_claim=js-debug URL spelling (journaled in the engineering review)
  // Arrange
  const fixture = createFixture()
  await runWithPreload(fixture)
  const reader = new WebpackLibraryReportReader()
  reader.refresh(fixture.reportPath, true)
  const sha = (file: string) =>
    createHash('sha256').update(readFileSync(file)).digest('hex')
  const serverFile = join(fixture.outDir, 'server/main.js')
  const clientFile = join(fixture.outDir, 'client/main.js')

  // Act
  const server = reader.matchServer(
    pathToFileURL(serverFile).href,
    sha(serverFile),
  )
  const page = reader.matchPage(
    'http://localhost:3000/_next/main.js?v=1',
    sha(clientFile),
  )
  const serverAsPage = reader.matchPage(
    'http://localhost:3000/_next/main.js',
    sha(serverFile),
  )
  const clientAsServer = reader.matchServer(
    pathToFileURL(clientFile).href,
    sha(clientFile),
  )

  // Assert
  assert.equal(server.kind, 'matched')
  assert.deepEqual(server.kind === 'matched' ? server.asset.resources : [], [
    join(fixture.packedRoot, 'rsc.js'),
    join(fixture.packedRoot, 'sub.js'),
  ])
  assert.equal(page.kind, 'matched')
  assert.equal(page.kind === 'matched' ? page.asset.compiler : '', 'client')
  assert.equal(serverAsPage.kind, 'unmatched-owned')
  assert.equal(clientAsServer.kind, 'not-owned')
})

test('a non-chunk script asset of the server compilation is listed with no resources and matches', async () => {
  // Value: protects=a script Next writes outside the chunks (a manifest) is matched instead of read as unmatched; fails_when=an emitted .js asset that belongs to no chunk is missing from the report; no_claim=the names of Next's manifests
  // Arrange
  const fixture = createFixture()
  await runWithPreload(fixture, { emitExtraAsset: true })
  const reader = new WebpackLibraryReportReader()
  reader.refresh(fixture.reportPath, true)
  const manifest = join(fixture.outDir, 'server/server-reference-manifest.js')
  const manifestSha = createHash('sha256')
    .update('self.manifest = {}')
    .digest('hex')

  // Act
  const verdict = reader.matchServer(pathToFileURL(manifest).href, manifestSha)

  // Assert
  assert.equal(verdict.kind, 'matched')
  assert.deepEqual(
    verdict.kind === 'matched' ? verdict.asset.resources : ['x'],
    [],
  )
})
