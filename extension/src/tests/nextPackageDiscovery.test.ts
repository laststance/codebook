import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { StudyError } from '../errors'
import { RepositorySourceService } from '../repositorySource'
import { discoverNextPackages } from '../utils/discoverNextPackages'
import type { RepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'
import { readStatusAdapterReadiness } from '../utils/readStatusAdapterReadiness'
import { selectedNextPackageStartPrerequisites } from '../utils/repositoryBrowserStartPrerequisites'
import { resolveNextPackage } from '../utils/resolveNextPackage'
import {
  scanNextPackages,
  suggestNextPackageRoots,
} from '../utils/scanNextPackages'

import { createHarness } from './helpers'

const executeFile = promisify(execFile)
const SIGNAL = new AbortController().signal
const NEXT_MANIFEST = JSON.stringify({
  name: 'app',
  dependencies: { next: '16.4.3' },
})

/** Makes a temporary Git repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-discovery-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await executeFile('git', ['init', '--quiet', root])
  return root
}

/** Writes a file below the root, creating its folders. */
async function put(root: string, path: string, text = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/** Tracks files in the repository's index. */
async function track(root: string, ...paths: string[]): Promise<void> {
  await executeFile('git', ['add', '--', ...paths], { cwd: root })
}

/** Writes a tracked Next app manifest at `folder`. */
async function trackedApp(root: string, folder: string): Promise<void> {
  await put(root, `${folder}/package.json`, NEXT_MANIFEST)
  await track(root, `${folder}/package.json`)
}

/** Installs Next below `folder` (its own node_modules). */
async function installNext(root: string, folder: string): Promise<void> {
  await put(
    root,
    `${folder}/node_modules/next/package.json`,
    '{"name":"next","version":"16.4.3"}',
  )
  await put(root, `${folder}/node_modules/next/dist/bin/next`)
}

// protects=AC 4: status lists the tracked Next apps shallow-first with exact packageRoot values and the readiness a start decides, ignoring the decoy root, an untracked app, a depth-5 app, foo-package.json and a non-Next package; fails_when=discovery reads the root's package/Next, lists an untracked or too-deep or misnamed manifest, or orders by path alone; no_claim=truncation (own tests)
test('discovery lists tracked Next apps shallow-first with their own readiness', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await put(root, 'package.json', NEXT_MANIFEST)
  await put(root, 'pages/index.tsx')
  await put(root, '.next/dev/lock')
  await track(root, 'package.json')
  await trackedApp(root, 'apps/web')
  await put(root, 'apps/web/app/page.tsx')
  await installNext(root, 'apps/web')
  await trackedApp(root, 'apps/docs')
  await put(root, 'apps/docs/pages/index.tsx')
  await trackedApp(root, 'a/b/c/d')
  await trackedApp(root, 'a/b/c/d/e')
  await put(root, 'apps/misnamed/foo-package.json', NEXT_MANIFEST)
  await track(root, 'apps/misnamed/foo-package.json')
  await put(root, 'tools/cli/package.json', '{"name":"cli"}')
  await track(root, 'tools/cli/package.json')
  await put(root, 'apps/untracked/package.json', NEXT_MANIFEST)
  // Act
  const discovery = await discoverNextPackages(root)
  // Assert
  assert.deepEqual(
    discovery.packages.map((entry) => entry.packageRoot),
    ['apps/docs', 'apps/web', 'a/b/c/d'],
  )
  assert.deepEqual(discovery.packages[1], {
    packageRoot: 'apps/web',
    routerKind: 'app',
    installed: true,
    ready: true,
    version: '16.4.3',
    missing: [],
  })
  assert.equal(discovery.packages[0]?.installed, false)
  assert.equal(discovery.packages[0]?.routerKind, 'pages')
  assert.match(
    discovery.packages[0]?.missing[0] ?? '',
    /^Next is not installed for apps\/docs/,
  )
  assert.equal(discovery.packagesTruncated, false)
})

// protects=AC 13: each entry's ready and missing equal what a start with that packageRoot checks (installed, not installed, a foreign .next/dev lock); fails_when=status says ready for a package whose start is refused, or words a different gap; no_claim=Node/Chrome, which the environment joins
test('each listed package reads ready and missing as a start with that packageRoot does', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedApp(root, 'apps/ready')
  await installNext(root, 'apps/ready')
  await trackedApp(root, 'apps/locked')
  await installNext(root, 'apps/locked')
  await put(root, 'apps/locked/.next/dev/lock')
  await trackedApp(root, 'apps/bare')
  const shared = { ready: true, missing: [] }
  // Act
  const discovery = await discoverNextPackages(root)
  // Assert
  for (const entry of discovery.packages) {
    const start = await selectedNextPackageStartPrerequisites(
      shared,
      'repository-browser',
      { adapter: 'next-dev-webpack', packageRoot: entry.packageRoot },
      root,
      SIGNAL,
    ).then(
      (result) => ({ ready: result?.ready, missing: result?.missing }),
      (error: unknown) => {
        assert.ok(error instanceof StudyError)
        return { ready: false, missing: [error.message] }
      },
    )
    assert.deepEqual(
      [entry.ready, entry.missing],
      [start.ready, start.missing],
      entry.packageRoot,
    )
  }
  assert.deepEqual(
    discovery.packages.map((entry) => [entry.packageRoot, entry.ready]),
    [
      ['apps/bare', false],
      ['apps/locked', false],
      ['apps/ready', true],
    ],
  )
})

// protects=S4/S20 50-cap: the 51st matching app is not listed and the list says why; fails_when=more than 50 are listed or packagesTruncated stays false; no_claim=readiness of the entries
test('discovery lists at most 50 apps and reports the limit', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (let index = 0; index < 51; index += 1)
    await trackedApp(root, `apps/app${String(index).padStart(2, '0')}`)
  // Act
  const scan = await scanNextPackages(root, async (app) => app.packageRoot)
  // Assert
  assert.equal(scan.items.length, 50)
  assert.equal(scan.items[49], 'apps/app49')
  assert.equal(scan.truncation, 'limit')
})

// protects=S4/S20 500-manifest cap: at most 500 manifests are read, shallow-first, and the list says why; fails_when=the 501st manifest is read or the truncation reason is missing; no_claim=timing
test('discovery reads at most 500 manifests and reports the manifest cap', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (let index = 0; index < 501; index += 1)
    await put(
      root,
      `pkgs/p${String(index).padStart(3, '0')}/package.json`,
      '{"name":"p"}',
    )
  // the only app lies after the 500th manifest in path order
  await trackedApp(root, 'pkgs/zzz')
  await track(root, 'pkgs')
  // Act
  const scan = await scanNextPackages(root, async (app) => app.packageRoot)
  // Assert
  assert.deepEqual(scan.items, [])
  assert.equal(scan.truncation, 'manifest-cap')
})

// protects=E15 safe reads: a manifest over 256 KiB, a symlinked manifest and a FIFO manifest are never read, the safe app is still listed, and the list is truncated as skipped-path; fails_when=an unsafe manifest is read or listed, or the skip is silent; no_claim=Windows links
test('discovery skips oversized, linked and FIFO manifests without blocking', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedApp(root, 'apps/ok')
  await put(
    root,
    'apps/big/package.json',
    JSON.stringify({
      dependencies: { next: '16.4.3' },
      padding: 'x'.repeat(300 * 1024),
    }),
  )
  await put(root, 'apps/link/package.json', NEXT_MANIFEST)
  await put(root, 'apps/fifo/package.json', NEXT_MANIFEST)
  await track(
    root,
    'apps/big/package.json',
    'apps/link/package.json',
    'apps/fifo/package.json',
  )
  await unlink(join(root, 'apps/link/package.json'))
  await symlink(
    join(root, 'apps/ok/package.json'),
    join(root, 'apps/link/package.json'),
  )
  await unlink(join(root, 'apps/fifo/package.json'))
  await executeFile('mkfifo', [join(root, 'apps/fifo/package.json')])
  // Act
  const scan = await scanNextPackages(root, async (app) => app.packageRoot)
  // Assert
  assert.deepEqual(scan.items, ['apps/ok'])
  assert.equal(scan.truncation, 'skipped-path')
})

// protects=S3 path rule: a path over 256 characters and a path with a control character are not listed and truncate the list; fails_when=either is read or the skip is silent; no_claim=file systems that refuse the name
test('discovery skips a path that is too long or holds a control character', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedApp(root, 'apps/ok')
  await trackedApp(
    root,
    `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(60)}`,
  )
  await trackedApp(root, 'apps/bell\u0007')
  // Act
  const scan = await scanNextPackages(root, async (app) => app.packageRoot)
  // Assert
  assert.deepEqual(scan.items, ['apps/ok'])
  assert.equal(scan.truncation, 'skipped-path')
})

// protects=E15 deadline: when the injected clock passes the one deadline the apps finished so far are listed with reason deadline; fails_when=the scan ignores the clock, lists an unfinished app or loses the reason; no_claim=real timers
test('discovery stops at the deadline of the injected clock and lists what it read', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (const name of ['a', 'b', 'c', 'd'])
    await trackedApp(root, `apps/${name}`)
  let clock = 0
  // Act
  const scan = await scanNextPackages(
    root,
    async (app) => {
      clock += 2_000
      return app.packageRoot
    },
    { now: () => clock, timeoutMs: 5_000, limits: { concurrency: 1 } },
  )
  // Assert
  assert.deepEqual(scan.items, ['apps/a', 'apps/b', 'apps/c'])
  assert.equal(scan.truncation, 'deadline')
})

// protects=E15 status wait: a package read that never answers ends the discovery at its deadline with the finished entries, not the status call; fails_when=the discovery waits for the hanging read; no_claim=exact timing
test('discovery returns at its deadline although one package read never answers', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedApp(root, 'apps/fast')
  await trackedApp(root, 'apps/zz-hangs')
  const startedAt = Date.now()
  // Act
  const discovery = await discoverNextPackages(root, {
    timeoutMs: 300,
    limits: { concurrency: 1 },
    readPackage: async (_root, packageRoot) =>
      packageRoot === 'apps/fast'
        ? {
            packageRoot,
            routerKind: 'none',
            installed: false,
            ready: false,
            missing: [],
          }
        : new Promise(() => undefined),
  })
  // Assert
  assert.ok(Date.now() - startedAt < 3_000)
  assert.deepEqual(
    discovery.packages.map((entry) => entry.packageRoot),
    ['apps/fast'],
  )
  assert.equal(discovery.packagesTruncatedReason, 'deadline')
})

// protects=E15 Git failure: a folder in no repository and a listing past maxBuffer end as git-failed with an empty list; fails_when=a Git failure throws out of status or reads as complete; no_claim=a missing Git binary
test('discovery reports git-failed when Git cannot list the files', async (context) => {
  // Arrange
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-nogit-')),
  )
  context.after(() => rm(outside, { recursive: true, force: true }))
  const root = await makeRepository(context)
  await trackedApp(root, 'apps/web')
  // Act
  const notARepository = await discoverNextPackages(outside)
  const overflow = await scanNextPackages(
    root,
    async (app) => app.packageRoot,
    {
      limits: { gitBytes: 8 },
    },
  )
  // Assert
  assert.deepEqual(notARepository, {
    packages: [],
    packagesTruncated: true,
    packagesTruncatedReason: 'git-failed',
  })
  assert.deepEqual(overflow, { items: [], truncation: 'git-failed' })
})

// protects=E3: rootIsApp is true only when the root package.json names next and the root has a route folder; a hoisted root node_modules/next with a nested app is not the root app; fails_when=a hoisted Next or a dependency without routes makes the root the choice; no_claim=root ready, which keeps its meaning
test('rootIsApp needs a next dependency and a route folder at the root', async (context) => {
  // Arrange
  const app = await makeRepository(context)
  await put(app, 'package.json', NEXT_MANIFEST)
  await put(app, 'app/page.tsx')
  const noRoutes = await makeRepository(context)
  await put(noRoutes, 'package.json', NEXT_MANIFEST)
  const hoisted = await makeRepository(context)
  await put(hoisted, 'package.json', '{"name":"monorepo"}')
  await installNext(hoisted, '.')
  await trackedApp(hoisted, 'apps/web')
  // Act
  const readiness = await Promise.all(
    [app, noRoutes, hoisted].map((root) =>
      readStatusAdapterReadiness(root, process.execPath, SIGNAL),
    ),
  )
  // Assert
  assert.deepEqual(
    readiness.map((report) => report['next-dev-webpack'].rootIsApp),
    [true, false, false],
  )
  assert.equal(readiness[2]?.['next-dev-webpack'].ready, true)
  assert.deepEqual(
    readiness[2]?.['next-dev-webpack'].packages?.map((entry) => [
      entry.packageRoot,
      entry.ready,
    ]),
    [['apps/web', true]],
  )
})

// protects=R4/DX-14/DX-19: a root without Next points to packages and packageRoot when apps exist, and says discovery was incomplete (and why) when the list is empty and truncated; fails_when=the root keeps only the install sentence; no_claim=the learner's install decision
test('a root without Next points to packages and says why an empty list is incomplete', async (context) => {
  // Arrange
  const withApps = await makeRepository(context)
  await trackedApp(withApps, 'apps/web')
  const noGit = await realpath(await mkdtemp(join(tmpdir(), 'codebook-nogit-')))
  context.after(() => rm(noGit, { recursive: true, force: true }))
  // Act
  const pointed = await readStatusAdapterReadiness(
    withApps,
    process.execPath,
    SIGNAL,
  )
  const incomplete = await readStatusAdapterReadiness(
    noGit,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.match(
    pointed['next-dev-webpack'].missing[0] ?? '',
    /^Next is not installed at the repository root.*packages.*packageRoot/,
  )
  assert.equal(pointed['next-dev-webpack'].ready, false)
  assert.deepEqual(incomplete['next-dev-webpack'].missing, [
    'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
    "The list of Next apps below the repository root is incomplete: Git could not list the tracked files. Only Git-tracked package.json files are listed; if the app the question names is not in packages, declare its packageRoot from the repository's files and let the start check it.",
  ])
})

// protects=AC 5/K4/C7: a workspace opened below the Git root reports every repository-browser adapter not ready, an empty packages list and the adapter-aware recovery naming the Git root folder and the exact packageRoot; fails_when=an adapter reads ready there or the recovery omits the folder name, packageRoot or the do-not-retry instruction; no_claim=the start refusal (own test)
test('a workspace below the Git root reports every adapter not ready with the nested-folder recovery', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedApp(root, 'examples/web')
  await installNext(root, 'examples/web')
  const gitRootName = basename(root)
  // Act
  const readiness = await readStatusAdapterReadiness(
    join(root, 'examples/web'),
    process.execPath,
    SIGNAL,
  )
  // Assert
  const next = readiness['next-dev-webpack']
  assert.equal(next.ready, false)
  assert.equal(readiness['vite-dev'].ready, false)
  assert.deepEqual(next.packages, [])
  assert.equal(
    next.missing[0],
    `This folder lies inside the Git repository "${gitRootName}" at "examples/web", and no adapter can run from it. Ask the learner to open the "${gitRootName}" folder (the repository root) in the editor; do not retry in this window. A Next app (next-dev-webpack) then runs from the repository root with packageRoot "examples/web". Other adapters (vite-dev, node-server, node-test, chrome-extension) do not support a folder below the repository root yet and have no workaround.`,
  )
  assert.deepEqual(readiness['vite-dev'].missing, next.missing)
})

// protects=DX-13/AC 5: source authoring in a folder below the Git root is refused PREREQUISITE_MISSING with the Git root's folder name, the exact packageRoot and its own recovery, with no absolute path; fails_when=the old generic sentence returns, a path leaks, or the recovery stays the generic one; no_claim=Next start
test('source authoring below the Git root is refused with the folder name and packageRoot', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await put(root, 'examples/web/src/a.ts', 'export {}')
  await track(root, 'examples/web/src/a.ts')
  // Act
  const refusal = await new RepositorySourceService(join(root, 'examples/web'))
    .list()
    .catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  const described = refusal.describe()
  assert.equal(described.code, 'PREREQUISITE_MISSING')
  assert.match(described.message, new RegExp(`repository "${basename(root)}"`))
  assert.match(described.message, /packageRoot "examples\/web"/)
  assert.match(described.recovery, /do not retry in this window/)
  assert.equal(described.message.includes(tmpdir()), false)
  assert.deepEqual(described.details, {
    reason: 'nested-workspace',
    gitRoot: basename(root),
    packageRoot: 'examples/web',
    sideEffects: 'none',
  })
})

// protects=DX-5/DX-9: a refused packageRoot carries up to 5 discovered suggestions; fails_when=suggestions stay empty or exceed 5; no_claim=their order beyond shallow-first
test('a refused packageRoot suggests up to five discovered apps', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (let index = 0; index < 6; index += 1)
    await trackedApp(root, `apps/a${index}`)
  // Act
  const refusal = await resolveNextPackage(root, 'apps/missing', {
    suggest: () => suggestNextPackageRoots(root),
  }).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.deepEqual(refusal.details?.suggestions, [
    'apps/a0',
    'apps/a1',
    'apps/a2',
    'apps/a3',
    'apps/a4',
  ])
})

/** Installs a ready Next app at examples/web in the harness repository. */
async function installNestedApp(directory: string): Promise<void> {
  await put(directory, 'examples/web/package.json', NEXT_MANIFEST)
  await installNext(directory, 'examples/web')
}

/** Starts a version 3 next-dev-webpack run and waits for its preparation. */
async function startRun(
  harness: Awaited<ReturnType<typeof createHarness>>,
  key: string,
  packageRoot?: string,
) {
  const reference = harness.configuration
  const { service } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key,
    configuration: {
      version: 3,
      adapter: 'next-dev-webpack',
      book: reference.book,
      source: reference.source,
      participant: 'browser',
      afterOperation: 1,
      before: reference.action.before,
      after: reference.action.after,
      operations: [{ kind: 'click', title: 'Toggle', selector: '#toggle' }],
      inspections: reference.inspections,
      ...(packageRoot === undefined ? {} : { packageRoot }),
    },
  })
  const record = service.record(receipt)
  await record.preparation
  return { receipt, record, state: service.state(record) }
}

// protects=E10: a symlinked alias of packageRoot and its target are one idempotency key; fails_when=the retry under the alias is an IDEMPOTENCY_CONFLICT or a second run; no_claim=that the alias run is accepted by the resolver
test('a symlinked alias and its target share one start key', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  await installNestedApp(harness.directory)
  await symlink(
    join(harness.directory, 'examples/web'),
    join(harness.directory, 'alias-web'),
  )
  const first = await startRun(harness, 'same-key', 'examples/web')
  // Act
  const retry = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: 'repository-browser',
    key: 'same-key',
    configuration: {
      ...first.record.configuration,
      packageRoot: 'alias-web',
    },
  })
  // Assert
  assert.equal(retry.runUri, first.receipt.runUri)
})

// protects=DX-19: a root start at a root without Next points to the tracked Next apps below it; fails_when=the install sentence alone returns although apps exist, or an untracked app is named; no_claim=the nested start itself
test('a root start without Next names the tracked apps below the root', async (context) => {
  // Arrange
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: true,
      missing: [],
      profiles: {
        'repository-browser': {
          ready: false,
          missing: [
            'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
          ],
        },
      },
    }),
  })
  context.after(() => harness.close())
  await installNestedApp(harness.directory)
  await track(harness.directory, 'examples/web/package.json')
  // Act
  const { state } = await startRun(harness, 'root-start')
  // Assert
  assert.equal(state.error?.code, 'PREREQUISITE_MISSING')
  assert.match(
    state.error?.message ?? '',
    /Next apps below it \(for example "examples\/web"\)/,
  )
})

// protects=S4/DX-14: codebook_status asks the environment to discover packages and sanitizes each entry's missing sentence; fails_when=status skips discovery or an entry keeps the repository path; no_claim=how entries are found
test('codebook_status discovers packages and words their gaps without a private path', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const asked: unknown[] = []
  const ready = { ready: true, missing: [] }
  harness.service.environment.prerequisites = async (options) => {
    asked.push(options)
    return {
      ready: true,
      missing: [],
      profiles: {
        'repository-browser': {
          ready: true,
          missing: [],
          adapters: {
            'next-dev-webpack': {
              ...ready,
              packages: [
                {
                  packageRoot: 'apps/web',
                  routerKind: 'app' as const,
                  installed: false,
                  ready: false,
                  missing: [
                    `EACCES: permission denied, lstat '${harness.directory}/apps/web/.next'`,
                  ],
                },
              ],
              packagesTruncated: false,
            },
            'vite-dev': {
              ...ready,
              installed: false,
              supportedMajor: 8,
              yarnPnp: false,
            },
          },
        },
      },
    }
  }
  // Act
  const status = await harness.service.status()
  // Assert
  assert.deepEqual(asked, [{ discoverPackages: true }])
  // The status type leaves the profile's adapters open, so the test reads them by name.
  const adapters: RepositoryAdapterReadiness | undefined = Reflect.get(
    status.profiles[0]?.prerequisites ?? {},
    'adapters',
  )
  assert.deepEqual(adapters?.['next-dev-webpack'].packages?.[0]?.missing, [
    "EACCES: permission denied, lstat '<storage>/apps/web/.next'",
  ])
})
