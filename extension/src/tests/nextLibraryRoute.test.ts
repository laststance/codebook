import assert from 'node:assert/strict'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

import { StudyError } from '../errors'
import type {
  LibraryPackageFacts,
  PreparedLibraryCore,
} from '../libraryPackage'
import type { LibraryRouteDependencies } from '../libraryRoute'
import { NextLibraryRoute } from '../nextLibraryRoute'
import type { LibraryDependencyRelation } from '../utils/assertLibraryRouteSupported'

import { removeTestFolder } from './utils/removeTestFolder'

const ORIGIN = 'http://localhost:3010'
const PAGE_HASH = 'a'.repeat(64)
const SERVER_HASH = 'b'.repeat(64)
const OTHER_HASH = 'c'.repeat(64)
const PAGE_ASSET = 'static/chunks/main-app.js'
const SERVER_ASSET = 'vendor-chunks/react-redux.js'

/** Tells the route the test page's origin is the run's own. */
const isOwned = (origin: string): boolean => origin === ORIGIN

/** The origin test of a script that has none (the server session). */
const hasNoOrigin = (): boolean => false

const FACTS: LibraryPackageFacts = {
  package: 'react-redux',
  version: '9.3.1',
  packageRoot: '.',
  revision: 'a'.repeat(40),
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7,
  packMs: 3,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '9.3.0',
}

/** Writes a file below a folder, creating its parents, and returns its path. */
async function put(path: string, text = 'export {}\n'): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

/** A `wrapped` line the Next preload writes when it builds one compiler's configuration. */
function wrappedLine(compiler: string, outputPath: string): string {
  return `${JSON.stringify({ wrapped: true, compiler, outputPath })}\n`
}

/** One compilation line of the report, as the Next preload writes it at `emit`. */
function compilationLine(
  compiler: string,
  outputPath: string,
  assets: { name: string; sha256: string; resources: string[] }[],
  extra: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({ compiler, outputPath, compilationHash: `h-${compiler}`, publicPath: '/_next/', assets, ...extra })}\n`
}

/** A staged Next library run over fake build seams, before `plan`. */
async function buildRoute(context: TestContext) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-next-route-')),
  )
  context.after(() => removeTestFolder(root))
  const appRoot = join(root, 'examples', 'rr-rsc-context')
  const libraryRoot = root
  const privateFolder = join(
    root,
    '..',
    `next-private-${Date.now()}-${Math.random()}`,
  )
  await mkdir(appRoot, { recursive: true })
  await mkdir(privateFolder, { recursive: true })
  const realPrivateFolder = await realpath(privateFolder)
  context.after(() => removeTestFolder(realPrivateFolder))
  const serverOutput = join(appRoot, '.next', 'dev', 'server')
  const clientOutput = join(appRoot, '.next', 'dev')
  const edgeOutput = join(appRoot, '.next', 'dev', 'server', 'edge')
  await mkdir(serverOutput, { recursive: true })
  const journal: { type: string; detail?: unknown }[] = []
  const relations: (LibraryDependencyRelation | undefined)[] = []
  const packedRoot = join(realPrivateFolder, 'node_modules', 'react-redux')
  const dependencies: LibraryRouteDependencies = {
    confirm: async () => true,
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async (inputs) => {
      relations.push(inputs.dependencyRelation)
      return {
        libraryRoot,
        relativeRoot: '.',
        name: 'react-redux',
        version: '9.3.1',
        peers: [],
        packageManager: {
          ok: true,
          name: 'pnpm',
          version: '11.23.0',
          executable: '/bin/pnpm',
        },
      }
    },
    readManifest: async () => ({ peers: [] }),
    allocatePrivateFolder: async () => realPrivateFolder,
    prepareCore: async (_declared, _roots, prepareDependencies) => {
      relations.push(prepareDependencies.dependencyRelation)
      await mkdir(packedRoot, { recursive: true })
      const prepared: PreparedLibraryCore = {
        facts: FACTS,
        packedRoot,
        peers: [],
        imports: undefined,
        libraryRoot,
        privateFolder: realPrivateFolder,
        dispose: async () => {
          await removeTestFolder(realPrivateFolder)
          return { cleanup: 'removed' }
        },
        failLink: async (sentence) => {
          throw new Error(sentence)
        },
      }
      return prepared
    },
  }
  const route = new NextLibraryRoute({
    runId: 'run-0001',
    declared: '.',
    workspace: root,
    appRoot,
    appRootRelative: 'examples/rr-rsc-context',
    record: (type, detail) => journal.push({ type, detail }),
    dependencies,
  })
  return {
    appRoot,
    packedRoot,
    serverOutput,
    clientOutput,
    edgeOutput,
    privateFolder: realPrivateFolder,
    reportPath: join(realPrivateFolder, 'report.jsonl'),
    route,
    journal,
    relations,
    controller: new AbortController(),
  }
}

/** A staged run after `plan` and `prepare`. */
async function stage(context: TestContext) {
  const run = await buildRoute(context)
  await run.route.plan(run.controller.signal)
  await run.route.prepare(run.controller.signal)
  return run
}

type StagedRun = Awaited<ReturnType<typeof stage>>

/** Appends the three `wrapped` lines Next's preload writes at Ready. */
async function writeWrappedLines(run: StagedRun): Promise<void> {
  await appendFile(
    run.reportPath,
    wrappedLine('server', run.serverOutput) +
      wrappedLine('edge-server', run.edgeOutput) +
      wrappedLine('client', run.clientOutput),
  )
}

/** The script the page parses for its client chunk (the URL carries a version query, as Next's does). */
function pageScript(scriptId = '1', hash = PAGE_HASH) {
  return {
    url: `${ORIGIN}/_next/${PAGE_ASSET}?v=1`,
    participant: 'browser' as const,
    scriptId,
    hash,
    isOwnedOrigin: isOwned,
  }
}

/** The script the server inspector parses for one emitted server chunk. */
function serverScript(run: StagedRun, scriptId = '1', hash = SERVER_HASH) {
  return {
    url: pathToFileURL(join(run.serverOutput, SERVER_ASSET)).href,
    participant: 'server' as const,
    scriptId,
    hash,
    isOwnedOrigin: hasNoOrigin,
  }
}

/** Writes the three wrapped lines, a client compilation with a page chunk and a server compilation whose chunk holds the given resources. */
async function writeCompilations(
  run: StagedRun,
  serverResources: string[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeWrappedLines(run)
  await appendFile(
    run.reportPath,
    compilationLine('client', run.clientOutput, [
      { name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] },
    ]) +
      compilationLine(
        'server',
        run.serverOutput,
        [
          {
            name: SERVER_ASSET,
            sha256: SERVER_HASH,
            resources: serverResources,
          },
        ],
        extra,
      ),
  )
}

/** Runs `action` and returns what it threw. */
async function thrownBy(action: () => unknown): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  return undefined
}

// Value: protects=a Next library run asks for the direct relation twice and writes a preload that hooks Next's webpack-config module into the private folder; fails_when=the relation is left at direct-or-installed or the react-scripts preload is written; why_new=the Next flavor is new; seam=none; no_claim=a real Next start
test('plans with the direct relation and writes the Next preload into the private folder', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  const preload = await readFile(run.route.preloadPath(), 'utf8')
  // Assert
  assert.deepEqual(run.relations, ['direct', 'direct'])
  assert.equal(run.route.preloadPath(), join(run.privateFolder, 'preload.cjs'))
  assert.match(preload, /^const CONFIG = \{"packageName":"react-redux"/)
  assert.match(preload, /webpack-config/)
})

// Value: protects=a server script and a page script that carry the same scriptId are both judged, the server one by its real path under the server outputPath and its hash; fails_when=script ids collide across participants (the server script is skipped as already judged) or the server script is matched like a page script; why_new=route tests so far feed page scripts only; seam=none; no_claim=js-debug's real URL spelling (the fixture copies the journaled file:// form)
test('counts the packed library of a server script that shares its scriptId with a page script', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript('1'))
  run.route.observeParsedScript(serverScript(run, '1'))
  await run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'complete')
  assert.equal(view.loaded, true)
  assert.equal(view.loadCount, 1)
  assert.equal(view.publishedCopyLoaded, false)
})

// Value: protects=server scripts outside every server outputPath (Node internals, next/dist) are ignored and a file URL of the server folder is owned without any page origin; fails_when=a foreign server script makes the observation unreadable or the server script needs an origin; why_new=the server participant is new; seam=none; no_claim=which scripts a real server announces
test('ignores server scripts outside the server output folder', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript({
    url: 'node:internal/main/run_main_module',
    participant: 'server',
    scriptId: '7',
    hash: OTHER_HASH,
    isOwnedOrigin: hasNoOrigin,
  })
  run.route.observeParsedScript({
    url: pathToFileURL(
      join(run.appRoot, 'node_modules', 'next', 'dist', 'a.js'),
    ).href,
    participant: 'server',
    scriptId: '8',
    hash: OTHER_HASH,
    isOwnedOrigin: hasNoOrigin,
  })
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(run.route.view().loaded, false)
})

// Value: protects=a server chunk holding both the packed copy and an installed copy reports the published copy and the packed count; fails_when=the other copy of a server asset is not classified; why_new=C97 states table has no server case; seam=none; no_claim=real module resolution
test('reports an installed copy inside a matched server chunk beside the packed copy', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  const installed = await put(
    join(run.appRoot, 'node_modules', 'react-redux', 'dist', 'rsc.mjs'),
  )
  await writeCompilations(run, [packed, installed])
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'complete')
  assert.equal(view.loaded, true)
  assert.equal(view.publishedCopyLoaded, true)
  assert.equal(view.publishedCopyPath, installed)
})

// Value: protects=a server script in the server folder that matches no emitted asset (wrong hash) ends unreadable and never reads as not loaded; fails_when=an unmatched owned server script is ignored; why_new=the unmatched-owned rule had page scripts only; seam=none; no_claim=none beyond protects
test('marks the observation unreadable for an owned server script with an unknown hash', async (context) => {
  // Arrange
  const run = await stage(context)
  await writeCompilations(run, [])
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run, '2', OTHER_HASH))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'script-matches-no-asset' },
  )
})

// Value: protects=an owned server script the debugger gave no hash cannot be tied to an asset and ends unreadable; fails_when=a hashless server script is matched by name or ignored; why_new=new participant; seam=none; no_claim=none beyond protects
test('marks the observation unreadable for an owned server script without a hash', async (context) => {
  // Arrange
  const run = await stage(context)
  await writeCompilations(run, [])
  const { hash: _hash, ...withoutHash } = serverScript(run)
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(withoutHash)
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'script-without-hash' },
  )
})

// Value: protects=a server compilation the server parsed scripts of but the report holds no line for (only its wrapped line) ends unreadable; fails_when=the missing compilation reads as not loaded; why_new=new participant; seam=none; no_claim=none beyond protects
test('marks the observation unreadable when the server parsed a chunk of a compilation with no report line', async (context) => {
  // Arrange
  const run = await stage(context)
  await writeWrappedLines(run)
  await appendFile(
    run.reportPath,
    compilationLine('client', run.clientOutput, [
      { name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] },
    ]),
  )
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
})

// Value: protects=an external module whose request names the package ends the observation unreadable with the external named, because Node loads that copy from outside the report's sight; fails_when=complete and publishedCopyLoaded false are claimed beside an external require of the installed copy; why_new=D23 is new; seam=none; no_claim=Next's own externals function (the line is a fixture)
test('marks the observation unreadable when the package is an external module', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed], { externals: ['react-redux'] })
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'library-externalized: react-redux' },
  )
})

// Value: protects=an edge-server asset holding a library resource ends the observation unreadable, because the edge runtime is not observed; fails_when=complete is claimed with an unobserved edge compile; why_new=D24 is new; seam=none; no_claim=a real edge runtime
test('marks the observation unreadable when an edge asset holds a library resource', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  await appendFile(
    run.reportPath,
    compilationLine('edge-server', run.edgeOutput, [
      { name: 'edge-chunks/lib.js', sha256: OTHER_HASH, resources: [packed] },
    ]),
  )
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'edge-unobserved' },
  )
})

// Value: protects=a report error line (a later compilation could not be described) ends the observation unreadable; fails_when=the observation reads complete after a compilation went undescribed; why_new=A7 rule for Next; seam=none; no_claim=none beyond protects
test('marks the observation unreadable when the preload reported it could not describe a compilation', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  await appendFile(run.reportPath, '{"reportError":"boom"}\n')
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'report-error: boom' },
  )
})

// Value: protects=a server compiler announced without an output folder ends the observation unreadable with the compiler named; fails_when=its server scripts read not-owned and the observation ends complete; why_new=review F12; seam=none; no_claim=what the preload does when config.output.path is absent
test('marks the observation unreadable when a server compiler announced no output folder', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  await appendFile(
    run.reportPath,
    '{"wrapped":true,"compiler":"edge-server","outputPath":""}\n',
  )
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'server-output-unknown: edge-server' },
  )
})

// Value: protects=a truncated server compilation line makes the owned server script of that compilation unreadable; fails_when=a script of a torn compilation is ignored; why_new=server truncation; seam=none; no_claim=none beyond protects
test('marks the observation unreadable for a server script of a truncated compilation', async (context) => {
  // Arrange
  const run = await stage(context)
  await writeWrappedLines(run)
  await appendFile(
    run.reportPath,
    compilationLine('client', run.clientOutput, [
      { name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] },
    ]) +
      `${JSON.stringify({ compiler: 'server', outputPath: run.serverOutput, compilationHash: 'h-server', truncated: true })}\n`,
  )
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'truncated-compilation' },
  )
})

// Value: protects=a page script whose name the report lists but whose hash differs (a torn or stale chunk) ends unreadable; fails_when=a known name with an unknown hash is ignored; why_new=A7 rule for Next; seam=none; no_claim=none beyond protects
test('marks the observation unreadable for a page script whose name is reported with another hash', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript('1', OTHER_HASH))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
})

// Value: protects=a compilation line from a compiler no wrapped line announced ends the observation unreadable with cause redirect-not-applied; fails_when=an unpatched compiler's output reads as not loaded; why_new=D20's second half; seam=none; no_claim=none beyond protects
test('marks the observation unreadable for a compilation of a compiler that was never wrapped', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    wrappedLine('server', run.serverOutput) +
      wrappedLine('client', run.clientOutput) +
      compilationLine('client', run.clientOutput, [
        { name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] },
      ]) +
      compilationLine('edge-server', run.edgeOutput, []),
  )
  // Act
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'redirect-not-applied' },
  )
})

// Value: protects=a script announced after finalization started is not counted, so a late server request cannot change a closed observation; fails_when=the late unmatched script turns the observation unreadable; why_new=D12 is new; seam=none; no_claim=the server stop order of the run
test('ignores scripts announced after finalization started', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  run.route.serverAttached()
  run.route.observeParsedScript(pageScript())
  run.route.observeParsedScript(serverScript(run))
  // Act
  const finalizing = run.route.finalize(true)
  run.route.observeParsedScript(serverScript(run, '9', OTHER_HASH))
  await finalizing
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(run.route.view().loaded, true)
})

// Value: protects=a run whose server session was never attached cannot end complete even though the page was observed and closed; fails_when=complete is claimed from the page alone; why_new=D21 is new; seam=none; no_claim=a real attach
test('ends incomplete when the page was observed but the server session was never attached', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'rsc.mjs'))
  await writeCompilations(run, [packed])
  // Act
  run.route.observeParsedScript(pageScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'incomplete')
  assert.ok(
    run.journal.some((entry) => entry.type === 'library.server-not-attached'),
  )
})

// Value: protects=a run that never prepared the library (nothing served) journals no missing server attach on Stop; fails_when=library.server-not-attached is journaled for an unprepared route; no_claim=the declined-confirmation prompt itself
test('journals no missing server attach when the library was never prepared', async (context) => {
  // Arrange
  const run = await buildRoute(context)
  await run.route.plan(run.controller.signal)
  // Act
  await run.route.finalize(true)
  // Assert
  assert.equal(
    run.journal.some((entry) => entry.type === 'library.server-not-attached'),
    false,
  )
  assert.equal(run.route.view().observation, 'pending')
})

// Value: protects=the redirect check passes only when the client, server and edge-server compilers each wrote a wrapped line, and a line that arrives within the bound is waited for; fails_when=the check passes with a compiler missing or refuses a line that arrives within the bound; why_new=D20 is new; seam=none; no_claim=Next's real timing (0.76 s after Ready per the E1 addendum)
test('waits within the bound until every compiler wrote its wrapped line', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, wrappedLine('server', run.serverOutput))
  setTimeout(() => {
    void appendFile(
      run.reportPath,
      wrappedLine('edge-server', run.edgeOutput) +
        wrappedLine('client', run.clientOutput),
    )
  }, 150)
  // Act
  await run.route.awaitRedirectApplied(run.controller.signal, 3000)
  // Assert
  assert.doesNotThrow(() => run.route.assertRedirectApplied())
})

// Value: protects=a compiler still unwrapped after the bound refuses with library-redirect-not-applied naming that compiler and partial effects; fails_when=the run proceeds to its readiness request with an unpatched compiler or the refusal does not name it; why_new=D20 is new; seam=none; no_claim=none beyond protects
test('refuses library-redirect-not-applied naming the compiler that never wrote a wrapped line', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    wrappedLine('server', run.serverOutput) +
      wrappedLine('client', run.clientOutput),
  )
  // Act
  const refusal = await thrownBy(() =>
    run.route.awaitRedirectApplied(run.controller.signal, 200),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'NEXT_UNSUPPORTED_SETTING')
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
  assert.deepEqual(refusal.details?.compilers, ['edge-server'])
  assert.equal(refusal.details?.sideEffects, 'partial')
})

// Value: protects=a preload error line of one compiler refuses at once, with the error as cause, without waiting out the bound; fails_when=the check waits for a patch that already failed or drops the cause; why_new=D20 is new; seam=none; no_claim=none beyond protects
test('refuses at once with the cause when a compiler wrote an error line', async (context) => {
  // Arrange
  const run = await stage(context)
  await writeWrappedLines(run)
  await appendFile(
    run.reportPath,
    `${JSON.stringify({ error: 'patch failed', compiler: 'server' })}\n`,
  )
  const startedAt = Date.now()
  // Act
  const refusal = await thrownBy(() =>
    run.route.awaitRedirectApplied(run.controller.signal, 4000),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.cause, 'patch failed')
  assert.deepEqual(refusal.details?.compilers, ['server'])
  assert.ok(Date.now() - startedAt < 2000)
})

// Value: protects=a stopped run ends the redirect wait with the stop's own error; fails_when=the wait outlives an aborted run; why_new=the wait is new; seam=none; no_claim=none beyond protects
test('ends the redirect wait when the run is stopped', async (context) => {
  // Arrange
  const run = await stage(context)
  run.controller.abort(new Error('stopped'))
  // Act
  const error = await thrownBy(() =>
    run.route.awaitRedirectApplied(run.controller.signal, 4000),
  )
  // Assert
  assert.ok(error instanceof Error)
  assert.equal(error.message, 'stopped')
})

// Value: protects=a failed server stop keeps the private folder of a Next library run (the server may still run on the packed copy and the webpack cache) with cleanup pending until the retried Stop removes it; fails_when=the Next route drops the serverStopped option and removes the folder; why_new=the Next route has its own dispose forwarding; seam=none; no_claim=a real server process
test('keeps the private folder while the server stop failed and removes it on the retried Stop', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  await run.route.dispose({ serverStopped: false })
  const afterFailedStop = {
    cleanup: run.route.view().cleanup,
    folder: await stat(run.privateFolder).then(
      () => 'exists',
      () => 'missing',
    ),
  }
  await run.route.dispose()
  // Assert
  assert.deepEqual(afterFailedStop, { cleanup: 'pending', folder: 'exists' })
  assert.equal(run.route.view().cleanup, 'removed')
  await assert.rejects(stat(run.privateFolder))
})
