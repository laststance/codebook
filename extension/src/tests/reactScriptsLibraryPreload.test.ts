import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES } from '../constants'
import { buildReactScriptsLibraryPreloadSource } from '../utils/reactScriptsLibraryPreload'
import { ReactScriptsReportReader } from '../utils/reactScriptsLibraryReport'

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

/** The webpack configuration factory of the fixture's react-scripts, shaped like Create React App's development configuration. */
const FACTORY_SOURCE = (appRoot: string, outDir: string, isBroken: boolean) => `
const path = require('path')
class ESLintWebpackPlugin { constructor(options) { this.options = options } apply() {} }
class ForkTsCheckerWebpackPlugin { constructor(options) { this.options = options } apply() {} }
module.exports = function (webpackEnv) {
  const config = {
    mode: webpackEnv,
    target: 'node',
    context: ${JSON.stringify(appRoot)},
    entry: ${JSON.stringify(join(appRoot, 'src/index.js'))},
    devtool: 'cheap-module-source-map',
    output: {
      path: ${JSON.stringify(outDir)},
      filename: 'bundle.js',
      publicPath: '/',
      devtoolModuleFilenameTemplate: (info) => path.resolve(info.absoluteResourcePath).split(path.sep).join('/'),
    },
    cache: { type: 'filesystem', cacheDirectory: path.join(${JSON.stringify(appRoot)}, 'node_modules/.cache/webpack') },
    module: { rules: [{ test: /\\.never$/, use: [{ loader: 'babel-loader', options: { cacheDirectory: true } }] }] },
    plugins: [
      new ESLintWebpackPlugin({ cacheLocation: path.join(${JSON.stringify(appRoot)}, 'node_modules/.cache/.eslintcache') }),
      new ForkTsCheckerWebpackPlugin({ typescript: { configOverwrite: { compilerOptions: { tsBuildInfoFile: '/app/node_modules/.cache/tsconfig.tsbuildinfo' } } } }),
    ],
    resolve: { plugins: [], aliasFields: ['browser'] },
  }
  ${isBroken ? "Object.defineProperty(config, 'resolve', { get() { throw new Error('resolve is not readable') } })" : ''}
  return config
}
`

/** Runs webpack on the factory and prints what the patched configuration and the compilation look like. */
const RUNNER_SOURCE = `
const [factoryPath, webpackPath] = process.argv.slice(2)
const config = require(factoryPath)('development')
const webpack = require(webpackPath)
const summary = {
  cacheDirectory: config.cache && config.cache.cacheDirectory,
  babelCacheDirectory: config.module.rules[0].use[0].options.cacheDirectory,
  eslintCacheLocation: config.plugins[0].options.cacheLocation,
  tsBuildInfoFile: config.plugins[1].options.typescript.configOverwrite.compilerOptions.tsBuildInfoFile,
}
if (process.env.SKIP_COMPILE) { console.log(JSON.stringify(summary)); process.exit(0) }
const compiler = webpack(config, (error, stats) => {
  if (error) { console.error(error); process.exit(1) }
  const modules = Array.from(stats.compilation.modules, (module) => module.resource).filter(Boolean)
  const errors = stats.compilation.errors.map(String)
  compiler.close(() => console.log(JSON.stringify({ ...summary, modules, errors })))
})
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

/** Writes the whole fixture tree and the generated preload; nothing is committed, all of it lives in a temporary folder. */
function createFixture(
  isBroken = false,
  libraryContainsExample = false,
): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codebook-rs-preload-')))
  temporaryRoots.push(root)
  // The P03 shape: the library root is the repository root and the Example lives below it.
  const appRoot = join(root, libraryContainsExample ? 'examples/app' : 'app')
  const libraryRoot = libraryContainsExample ? root : join(root, 'lib-repo')
  const privateFolder = join(root, 'private')
  const packedRoot = join(privateFolder, 'node_modules/lib')
  const outDir = join(root, 'out')
  const cacheFolder = join(privateFolder, 'cache')
  const reportPath = join(privateFolder, 'report.jsonl')
  const factoryPath = join(
    appRoot,
    'node_modules/react-scripts/config/webpack.config.js',
  )
  const runnerPath = join(root, 'runner.js')
  const preloadPath = join(root, 'preload.cjs')

  writeAt(join(appRoot, 'package.json'), '{"name":"app"}')
  writeAt(
    join(appRoot, 'src/index.js'),
    "module.exports = [require('lib'), require('lib/sub'), require('importer'), require('peer')]\n",
  )
  writeAt(factoryPath, FACTORY_SOURCE(appRoot, outDir, isBroken))
  // The installed copy of the library, its importer, the peer and a decoy dependency.
  writeAt(
    join(appRoot, 'node_modules/lib/package.json'),
    '{"name":"lib","main":"index.js"}',
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
  writeAt(join(appRoot, 'node_modules/dep/package.json'), '{"name":"dep"}')
  writeAt(
    join(appRoot, 'node_modules/dep/index.js'),
    "module.exports = 'app-dep'\n",
  )
  // The checked-out library: its dependency, a decoy peer and the sources.
  writeAt(join(libraryRoot, 'package.json'), '{"name":"lib"}')
  writeAt(join(libraryRoot, 'node_modules/dep/package.json'), '{"name":"dep"}')
  writeAt(
    join(libraryRoot, 'node_modules/dep/index.js'),
    "module.exports = 'library-dep'\n",
  )
  writeAt(
    join(libraryRoot, 'node_modules/peer/package.json'),
    '{"name":"peer"}',
  )
  writeAt(
    join(libraryRoot, 'node_modules/peer/index.js'),
    "module.exports = 'library-peer'\n",
  )
  writeAt(join(libraryRoot, 'src/same.js'), "module.exports = 'same'\n")
  writeAt(
    join(libraryRoot, 'src/differs.js'),
    "module.exports = 'checked-out'\n",
  )
  // The packed copy: exports, peer, dependency, own subpath and two sources.
  writeAt(
    join(packedRoot, 'package.json'),
    JSON.stringify({
      name: 'lib',
      exports: { '.': './index.js', './sub': './sub.js' },
    }),
  )
  writeAt(
    join(packedRoot, 'index.js'),
    "module.exports = [require('peer'), require('dep'), require('lib/sub'), require('./src/same.js'), require('./src/differs.js')]\n",
  )
  writeAt(join(packedRoot, 'sub.js'), "module.exports = 'packed-sub'\n")
  writeAt(join(packedRoot, 'src/same.js'), "module.exports = 'same'\n")
  writeAt(join(packedRoot, 'src/differs.js'), "module.exports = 'packed'\n")
  writeAt(join(privateFolder, 'package.json'), '{"name":"private"}')
  mkdirSync(join(privateFolder, 'anchor'), { recursive: true })

  writeAt(runnerPath, RUNNER_SOURCE)
  writeAt(
    preloadPath,
    buildReactScriptsLibraryPreloadSource({
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
  cacheDirectory: string
  babelCacheDirectory: string
  eslintCacheLocation: string
  tsBuildInfoFile: string
  modules?: string[]
  errors?: string[]
}

/** Spawns `node --require <preload> <runner>` and parses the runner's JSON line. */
async function runWithPreload(
  fixture: Fixture,
  environment: Record<string, string> = {},
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
    ],
    {
      env: { ...process.env, ...environment },
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

test('Example and installed importer imports of the library resolve to the packed copy, never the installed copy', async () => {
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const modules = output.modules ?? []
  assert.deepEqual(output.errors, [])
  assert.ok(modules.includes(join(fixture.packedRoot, 'index.js')))
  assert.ok(modules.includes(join(fixture.packedRoot, 'sub.js')))
  assert.equal(
    modules.some((file) =>
      file.startsWith(join(fixture.appRoot, 'node_modules/lib')),
    ),
    false,
  )
  assert.ok(
    modules.includes(join(fixture.appRoot, 'node_modules/importer/index.js')),
  )
})

test('packed copy imports its peer from the Example and its dependency from the library folder', async () => {
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const modules = output.modules ?? []
  assert.ok(
    modules.includes(join(fixture.appRoot, 'node_modules/peer/index.js')),
  )
  assert.ok(
    modules.includes(join(fixture.libraryRoot, 'node_modules/dep/index.js')),
  )
  assert.equal(
    modules.includes(join(fixture.libraryRoot, 'node_modules/peer/index.js')),
    false,
  )
  assert.equal(
    modules.includes(join(fixture.appRoot, 'node_modules/dep/index.js')),
    false,
  )
})

test('webpack, babel-loader, ESLint and TypeScript caches are redirected into the private folder', async () => {
  // Arrange
  const fixture = createFixture()

  // Act
  const output = await runWithPreload(fixture, { SKIP_COMPILE: '1' })

  // Assert
  assert.equal(output.cacheDirectory, join(fixture.cacheFolder, 'webpack'))
  assert.equal(
    output.babelCacheDirectory,
    join(fixture.cacheFolder, 'babel-loader'),
  )
  assert.equal(
    output.eslintCacheLocation,
    join(fixture.cacheFolder, '.eslintcache'),
  )
  assert.equal(
    output.tsBuildInfoFile,
    join(fixture.cacheFolder, 'tsconfig.tsbuildinfo'),
  )
})

test('report starts with the wrapped line and then names the emitted script by its SHA-256 with the packed resources', async () => {
  // Arrange
  const fixture = createFixture()

  // Act
  await runWithPreload(fixture)

  // Assert
  const lines = readReportLines(fixture.reportPath)
  assert.deepEqual(lines[0], { wrapped: true })
  const emittedHash = createHash('sha256')
    .update(readFileSync(join(fixture.outDir, 'bundle.js')))
    .digest('hex')
  const compilation = lines[1] as {
    publicPath: string
    assets: { name: string; sha256: string; resources: string[] }[]
  }
  assert.equal(compilation.publicPath, '/')
  assert.equal(compilation.assets.length, 1)
  const [asset] = compilation.assets
  assert.equal(asset?.name, 'bundle.js')
  assert.equal(asset?.sha256, emittedHash)
  assert.ok(asset?.resources.includes(join(fixture.packedRoot, 'index.js')))
  assert.ok(asset?.resources.includes(join(fixture.packedRoot, 'sub.js')))
  // The reader agrees with the generator about the line format.
  const reader = new ReactScriptsReportReader()
  reader.refresh(fixture.reportPath, true)
  assert.equal(reader.wrapped, true)
  assert.equal(reader.unreadableCause, undefined)
  assert.equal(
    reader.match('http://localhost:3000/bundle.js?x=1', emittedHash).kind,
    'matched',
  )
})

test('source map names a byte-equal packed source by its checked-out path and keeps a differing one at the packed path', async () => {
  // Arrange
  const fixture = createFixture()

  // Act
  await runWithPreload(fixture)

  // Assert
  const map = JSON.parse(
    readFileSync(join(fixture.outDir, 'bundle.js.map'), 'utf8'),
  ) as {
    sources: string[]
  }
  assert.ok(map.sources.includes(join(fixture.libraryRoot, 'src/same.js')))
  assert.equal(
    map.sources.includes(join(fixture.packedRoot, 'src/same.js')),
    false,
  )
  assert.ok(map.sources.includes(join(fixture.packedRoot, 'src/differs.js')))
})

test('loading the preload without the react-scripts configuration writes nothing into the private folder', async () => {
  // Arrange
  const fixture = createFixture()
  const before = readdirSync(fixture.privateFolder).sort()

  // Act
  await run(process.execPath, ['--require', fixture.preloadPath, '-e', '1'])

  // Assert
  assert.deepEqual(readdirSync(fixture.privateFolder).sort(), before)
  assert.equal(existsSync(fixture.reportPath), false)
  assert.equal(existsSync(fixture.cacheFolder), false)
})

test('a configuration the patch cannot handle writes an error line, no wrapped line, and runs unpatched', async () => {
  // Arrange
  const fixture = createFixture(true)

  // Act
  const result = await run(
    process.execPath,
    [
      '--require',
      fixture.preloadPath,
      '-e',
      `const config = require(${JSON.stringify(fixture.factoryPath)})('development'); console.log(JSON.stringify({ plugins: config.plugins.length }))`,
    ],
    { cwd: fixture.root },
  )

  // Assert
  assert.equal(result.stdout.trim(), '{"plugins":2}')
  const lines = readReportLines(fixture.reportPath)
  assert.deepEqual(lines, [{ error: 'resolve is not readable' }])
})

test('report resources keep the packed files but none of the Example or its dependencies when the library root contains the Example', async () => {
  // Arrange
  const fixture = createFixture(false, true)

  // Act
  await runWithPreload(fixture)

  // Assert
  const compilation = readReportLines(fixture.reportPath)[1] as {
    assets: { resources: string[] }[]
  }
  const resources = compilation.assets[0]?.resources ?? []
  assert.ok(resources.includes(join(fixture.packedRoot, 'index.js')))
  assert.deepEqual(
    resources.filter(
      (file) =>
        file.startsWith(fixture.appRoot) ||
        file.startsWith(join(fixture.libraryRoot, 'node_modules')),
    ),
    [],
  )
})

test('a failure while describing a later compilation writes a reportError line, never an error line', async () => {
  // Arrange
  const fixture = createFixture()
  const failing = join(fixture.root, 'failing-runner.js')
  writeAt(
    failing,
    `const config = require(${JSON.stringify(fixture.factoryPath)})('development')
const reporter = config.plugins[config.plugins.length - 1]
reporter.apply({ hooks: { emit: { tap: (name, callback) => callback({ chunks: [], get hash() { throw new Error('hash failed') } }) } } })`,
  )

  // Act
  await run(process.execPath, ['--require', fixture.preloadPath, failing], {
    cwd: fixture.root,
  })

  // Assert
  assert.deepEqual(readReportLines(fixture.reportPath), [
    { wrapped: true },
    { reportError: 'hash failed' },
  ])
})

/** Rewrites the packed and checked-out manifests of a fixture. */
function writePackedManifest(
  fixture: Fixture,
  packed: Record<string, unknown>,
  checkedOut?: Record<string, unknown>,
): void {
  writeAt(
    join(fixture.packedRoot, 'package.json'),
    JSON.stringify({ name: 'lib', exports: { '.': './index.js' }, ...packed }),
  )
  if (checkedOut)
    writeAt(
      join(fixture.libraryRoot, 'package.json'),
      JSON.stringify({ name: 'lib', ...checkedOut }),
    )
}

// Value: protects=imports-field targets of the packed package resolve like direct bare imports; fails_when=#dep is looked up from the packed folder and the build cannot resolve it; no_claim=conditions or nested imports maps.
test('packed copy imports of #dep and #peer resolve the dependency from the library folder and the peer from the Example', async () => {
  // Arrange
  const fixture = createFixture()
  writeAt(
    join(fixture.appRoot, 'src/index.js'),
    "module.exports = require('lib')\n",
  )
  writePackedManifest(fixture, {
    imports: { '#dep': 'dep', '#peer': 'peer' },
  })
  writeAt(
    join(fixture.packedRoot, 'index.js'),
    "module.exports = [require('#dep'), require('#peer')]\n",
  )

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const modules = output.modules ?? []
  assert.deepEqual(output.errors, [])
  assert.ok(
    modules.includes(join(fixture.libraryRoot, 'node_modules/dep/index.js')),
  )
  assert.ok(
    modules.includes(join(fixture.appRoot, 'node_modules/peer/index.js')),
  )
  assert.equal(
    modules.includes(join(fixture.appRoot, 'node_modules/dep/index.js')),
    false,
  )
})

// Value: protects=the packed package's browser field maps a bare import to the packed file; fails_when=the import is redirected to the checked-out copy before the alias field applies; no_claim=alias mapped to another bare name.
test('packed copy loads its own browser-field file for a mapped bare import, never the checked-out copy', async () => {
  // Arrange
  const fixture = createFixture()
  const browserField = { browser: { dep: './browser.js' } }
  writeAt(
    join(fixture.appRoot, 'src/index.js'),
    "module.exports = require('lib')\n",
  )
  writePackedManifest(fixture, browserField, browserField)
  writeAt(
    join(fixture.packedRoot, 'index.js'),
    "module.exports = require('dep')\n",
  )
  writeAt(
    join(fixture.packedRoot, 'browser.js'),
    "module.exports = 'packed-browser'\n",
  )
  writeAt(
    join(fixture.libraryRoot, 'browser.js'),
    "module.exports = 'checked-out-browser'\n",
  )

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const modules = output.modules ?? []
  assert.deepEqual(output.errors, [])
  assert.ok(modules.includes(join(fixture.packedRoot, 'browser.js')))
  assert.equal(modules.includes(join(fixture.libraryRoot, 'browser.js')), false)
  const compilation = readReportLines(fixture.reportPath)[1] as {
    assets: { resources: string[] }[]
  }
  assert.equal(
    compilation.assets[0]?.resources.includes(
      join(fixture.libraryRoot, 'browser.js'),
    ),
    false,
  )
})

// Value: protects=a query on the package name still reaches the packed copy; fails_when=lib?query resolves to the Example's installed copy; no_claim=query forwarded to loaders.
test('Example import of lib with a query string is served from the packed copy', async () => {
  // Arrange
  const fixture = createFixture()
  writeAt(
    join(fixture.appRoot, 'src/index.js'),
    "module.exports = require('lib?query')\n",
  )
  // Without an exports map, so the query is the only thing that differs from a plain import.
  writeAt(
    join(fixture.packedRoot, 'package.json'),
    '{"name":"lib","main":"index.js"}',
  )
  writeAt(join(fixture.packedRoot, 'index.js'), "module.exports = 'packed'\n")

  // Act
  const output = await runWithPreload(fixture)

  // Assert
  const modules = output.modules ?? []
  assert.deepEqual(output.errors, [])
  // webpack keeps the query in the module resource
  assert.ok(modules.includes(join(fixture.packedRoot, 'index.js') + '?query'))
  assert.equal(
    modules.some((file) =>
      file.startsWith(join(fixture.appRoot, 'node_modules/lib')),
    ),
    false,
  )
})
