import assert from 'node:assert/strict'
import { readdir, realpath, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { capturePagesServerRun } from './utils/capturePagesServerStudy'
import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { armedEntry, entryRenderHarness } from './utils/entryRenderHarness'
import {
  hitOnLine,
  PAGES_SERVER_PAGE_PATH,
  PAGES_SERVER_PAGE_SOURCE,
  PAGES_SERVER_RETURN_LINE,
  pagesServerRun,
  type PagesServerRunOptions,
} from './utils/pagesServerRunHarness'
import { replaySavedServerStop } from './utils/replaySavedServerStop'

/** The folder of the nested Next app, shaped like P02's `examples/react/nextjs`. */
const PACKAGE_ROOT = 'examples/react/nextjs'

/** The page of P02's example: a Pages page whose data function is `getStaticProps` (the stand-in keeps the line layout of the `getServerSideProps` page: `const count = 3` on line 5, the return on line 6). */
const GET_STATIC_PROPS_PAGE = PAGES_SERVER_PAGE_SOURCE.replace(
  'getServerSideProps({ query })',
  'getStaticProps()',
)

const OPERATION_ACTION = 'repository-operation'

/** A click the stand-in page answers. */
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Toggle',
  selector: '#toggle',
}

/** Harness options of the nested Pages server run: the page, `packageRoot` below a decoy root. */
function nestedPagesOptions(
  packageApp: NonNullable<PagesServerRunOptions['packageApp']> = {
    decoyRoot: true,
  },
): PagesServerRunOptions {
  return {
    packageRoot: PACKAGE_ROOT,
    packageApp,
    fixture: {
      source: GET_STATIC_PROPS_PAGE,
      citationEndLine: 7,
      declaredLine: PAGES_SERVER_RETURN_LINE,
    },
  }
}

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Lists the files a study written to a library folder leaves there.
 * @param context - The test, which removes the folder.
 * @param study - The study to save.
 * @returns The file names in the library folder.
 * @example await savedFileNames(context, study) // => ['<id>.study.v9.json', …]
 */
async function savedFileNames(
  context: TestContext,
  study: Awaited<ReturnType<typeof capturePagesServerRun>>['study'],
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-nested-save-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await new LearningLibrary(directory, study.workspaceKey).saveStudy(study)
  return readdir(directory)
}

// protects=AC 1/E12: a Pages server stop in getStaticProps of an app below a decoy root runs, saves as format 9 with packageRoot, and the saved study replays its recorded values, also after the package folder is removed; fails_when=the entry/route/seal read the decoy root (the run fails or pauses elsewhere), the study is saved without packageRoot or as another format, or the replay needs the folder; no_claim=a real Next server or editor (scripted inspector, stand-in launcher)
test('a getStaticProps stop of a Pages app below the repository root saves as format 9 and replays after the app folder is removed', async (context) => {
  // Arrange
  const { study, run } = await capturePagesServerRun(
    context,
    nestedPagesOptions(),
    'getStaticProps',
  )
  const packageDirectory = join(run.harness.directory, PACKAGE_ROOT)
  // Act
  const files = await savedFileNames(context, study)
  const replayedBefore = await replaySavedServerStop(context, study)
  await rm(packageDirectory, { recursive: true, force: true })
  const replayedAfter = await replaySavedServerStop(context, study)
  // Assert
  assert.equal(study.version, 9)
  assert.equal(
    'packageRoot' in study.configuration && study.configuration.packageRoot,
    'examples/react/nextjs',
  )
  assert.equal(
    files.some((file) => file.endsWith('.study.v9.json')),
    true,
  )
  assert.equal(
    study.configuration.version === 3 && study.configuration.source.path,
    `${PACKAGE_ROOT}/${PAGES_SERVER_PAGE_PATH}`,
  )
  for (const replayed of [replayedBefore, replayedAfter]) {
    assert.equal(replayed.study.version, 9)
    assert.equal(replayed.topFrameName, 'getStaticProps')
    assert.equal(replayed.topFrameLine, 6)
    assert.deepEqual(replayed.variables, [{ name: 'count', value: '3' }])
  }
  assert.deepEqual(replayedAfter.variables, replayedBefore.variables)
})

// protects=AC 3/E10: a packageRoot that is a symlinked alias inside the repository runs and the study saves the target's canonical path; fails_when=the alias is refused, the stop is judged outside the package, or the alias is saved; no_claim=an alias that leaves the repository (resolver tests)
test('a symlinked alias packageRoot runs the target app and saves the target path in format 9', async (context) => {
  // Arrange
  const options = nestedPagesOptions({
    decoyRoot: true,
    declared: 'links/web',
  })
  // Act
  const { study } = await capturePagesServerRun(
    context,
    options,
    'getStaticProps',
  )
  // Assert
  assert.equal(study.version, 9)
  assert.equal(
    'packageRoot' in study.configuration && study.configuration.packageRoot,
    'examples/react/nextjs',
  )
})

// protects=AC 2/AC 15: a server stop of an App Router app below a decoy root is sealed through the package, and every Next reader and the debugger attach receive the package folder, never the repository root; fails_when=a reader or the attach takes the repository root (launch cwd, source map override, bundle read, port read, workspace check); no_claim=the real readers of the mocked seam (their own decoy-root tests)
test('a server stop of an App Router app below the repository root reaches the readers and the debugger with the package folder', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
  })
  const packageDirectory = await realpath(join(harness.directory, PACKAGE_ROOT))
  const prepared = harness.run.prepare()
  // Act
  await armedEntry(harness)
  harness.server!.hit({ route: '/dashboard' })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published entry-render pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
  // Assert
  const roots = harness.readerRoots
  assert.deepEqual(roots.developmentBundle, [packageDirectory])
  assert.deepEqual(roots.assertedWorkspace, [packageDirectory])
  assert.deepEqual(roots.declaredPort, [packageDirectory])
  assert.equal(roots.launchRequests[0], packageDirectory)
  const attach = harness.serverLaunches[0]
  assert.equal(attach?.cwd, packageDirectory)
  assert.deepEqual(attach?.sourceMapPathOverrides, {
    'webpack://_N_E/./*': `${packageDirectory}/*`,
  })
  // The package-relative module the server sealed maps to <packageRoot>/<file> on disk.
  const sealed = harness.run.view().snapshots[0]?.source
  assert.equal(sealed?.scriptUrl, 'webpack-internal:///(rsc)/./src/theme.ts')
  assert.equal(
    join(packageDirectory, 'src/theme.ts'),
    join(harness.directory, PACKAGE_ROOT, 'src/theme.ts'),
  )
})

// protects=AC 2/E7: a browser stop of an App Router app below a decoy root, reached by a declared operation (afterOperation 1), pauses on the package-relative module and completes; fails_when=the browser stop is refused or sealed against the repository root; no_claim=a real browser
test('a browser stop reached by an operation in an app below the repository root pauses and completes', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
  })
  await harness.run.prepare()
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the browser stop',
  )
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
  // Assert
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
  assert.equal(
    harness.definition.configuration.source.path,
    `${PACKAGE_ROOT}/src/theme.ts`,
  )
  assert.equal(
    stop.source.scriptUrl,
    'webpack-internal:///(app-pages-browser)/./src/theme.ts',
  )
  assert.deepEqual(harness.readerRoots.developmentBundle.length > 0, true)
  for (const root of harness.readerRoots.developmentBundle)
    assert.equal(root, await realpath(join(harness.directory, PACKAGE_ROOT)))
})

// protects=AC 3: a stop file outside the package folder is refused NEXT_STOP_NOT_SEALED outside-package before any process starts; fails_when=the server is launched, or the stop is sealed against a package file; no_claim=every other refusal row (resolver tests)
test('a stop outside the package folder is refused before any server starts', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true, stopsOutside: true },
    operations: { operations: [CLICK], stopOperations: [1] },
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    plain(Reflect.get(Object(failure), 'details')).reason,
    'outside-package',
  )
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3: Next hoisted to the repository root node_modules runs the nested app; fails_when=the run demands node_modules/next inside the package folder; no_claim=a hoisted Next outside the repository (resolver tests)
test('a nested app whose Next is hoisted to the repository root runs', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE_ROOT,
    packageApp: { next: 'hoisted' },
    operations: { operations: [CLICK], stopOperations: [1] },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(harness.developmentServerLaunches(), 1)
})

/**
 * Runs the Pages server entry-load fixture of nextPagesServerRun.test.ts (a stop on the return line of getServerSideProps) at the repository root or below a decoy root, and reads the evidence its pause carries without the path prefix.
 * @param context - The test.
 * @param nested - Whether the app lives in {@link PACKAGE_ROOT} with `packageRoot` declared.
 * @returns The pause's evidence with the path relative to the app.
 * @example await pagesServerEvidence(context, true)
 */
async function pagesServerEvidence(context: TestContext, nested: boolean) {
  const harness = await pagesServerRun(
    context,
    nested
      ? { packageRoot: PACKAGE_ROOT, packageApp: { decoyRoot: true } }
      : {},
  )
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  const pause = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the published server pause')
  const evidence = plain({
    execution: pause.execution,
    attribution: pause.attribution,
    declaredIndex: pause.declaredIndex,
    executionIndex: pause.executionIndex,
    count: pause.values['value:count'],
    scriptUrl: pause.source.scriptUrl,
    line: pause.source.line,
    dataFunctions: harness.run.view().dataFunctions,
  })
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  return evidence
}

// protects=E17: the Pages server entry-load fixture moved below a decoy root with packageRoot yields the same evidence apart from the path prefix; fails_when=a reader takes the decoy root (another route, module or value) or the module id keeps the prefix; no_claim=the other fixtures of E17 (App browser and App server above)
test('the Pages server entry-load fixture below a decoy root yields the root run evidence apart from the path prefix', async (context) => {
  // Arrange / Act
  const atRoot = await pagesServerEvidence(context, false)
  const nested = await pagesServerEvidence(context, true)
  // Assert
  assert.deepEqual(nested, atRoot)
})
