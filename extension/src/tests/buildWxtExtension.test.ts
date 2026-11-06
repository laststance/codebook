import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'

import {
  EXTENSION_BUILD_KILL_GRACE_MS,
  EXTENSION_BUILD_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'
import { buildWxtExtension } from '../utils/buildWxtExtension'
import type {
  WxtBuildClock,
  WxtBuildProcess,
  WxtBuildSpawner,
} from '../utils/buildWxtExtension'
import type { WxtBuildExit, WxtBuildSpawnRequest } from '../utils/wxtBuildTypes'

const temporaryFolders: string[] = []
after(() => {
  for (const folder of temporaryFolders)
    rmSync(folder, { recursive: true, force: true })
})

/** A manual clock: delays resolve when `advance` reaches them or their signal aborts. */
function createFakeClock(): WxtBuildClock & {
  advance(ms: number): Promise<void>
} {
  let nowMs = 0
  const pending: { dueMs: number; resolve(): void }[] = []
  return {
    nowMs: () => nowMs,
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
      for (let turn = 0; turn < 5; turn++)
        await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

type FakeControl = {
  request: WxtBuildSpawnRequest
  output(text: string, channel?: 'stdout' | 'stderr'): void
  exit(status: WxtBuildExit): void
}

/** A fake spawner: `onSpawn` scripts the process; `endsOn` says which signal ends its tree (`never` keeps it alive). */
function createFakeSpawner(options: {
  onSpawn(control: FakeControl): void
  endsOn?: 'SIGTERM' | 'SIGKILL' | 'never'
}) {
  const spawned: WxtBuildSpawnRequest[] = []
  const signals: string[] = []
  let notifySpawned = (): void => undefined
  const hasSpawned = new Promise<void>((resolve) => (notifySpawned = resolve))
  const spawner: WxtBuildSpawner = (request) => {
    spawned.push(request)
    let treeIsGone = false
    let resolveExit = (_status: WxtBuildExit): void => undefined
    let resolveTree = (): void => undefined
    const exited = new Promise<WxtBuildExit>(
      (resolve) => (resolveExit = resolve),
    )
    const treeGone = new Promise<void>((resolve) => (resolveTree = resolve))
    const endTree = (): void => {
      treeIsGone = true
      resolveExit({ code: null, signal: 'SIGTERM' })
      resolveTree()
    }
    const build: WxtBuildProcess = {
      exited,
      treeGone,
      isTreeGone: () => treeIsGone,
      signalTree(signal) {
        signals.push(signal)
        if (signal === (options.endsOn ?? 'SIGTERM')) endTree()
      },
    }
    options.onSpawn({
      request,
      output: (text, channel = 'stderr') => request.onOutput(text, channel),
      exit(status) {
        treeIsGone = true
        resolveExit(status)
        resolveTree()
      },
    })
    notifySpawned()
    return build
  }
  return { spawner, spawned, signals, hasSpawned }
}

/** A real Git repository with a WXT project `ext/` whose `wxt` version is installed untracked. */
function createProject(wxtVersion: string | null = '0.21.4') {
  const repositoryRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'codebook-wxt-build-')),
  )
  temporaryFolders.push(repositoryRoot)
  const projectRoot = join(repositoryRoot, 'ext')
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'wxt.config.ts'), 'export default {}\n')
  writeFileSync(join(projectRoot, 'src', 'a.ts'), 'export const a = 1\n')
  if (wxtVersion !== null) {
    mkdirSync(join(projectRoot, 'node_modules', 'wxt'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'node_modules', 'wxt', 'package.json'),
      JSON.stringify({ name: 'wxt', version: wxtVersion }),
    )
  }
  execFileSync('git', ['init', '-q'], { cwd: repositoryRoot })
  execFileSync('git', ['add', 'ext/wxt.config.ts', 'ext/src/a.ts'], {
    cwd: repositoryRoot,
  })
  const privateFolder = join(repositoryRoot, '..', `${Date.now()}-private`)
  mkdirSync(privateFolder, { recursive: true })
  temporaryFolders.push(privateFolder)
  return { repositoryRoot, projectRoot, privateFolder }
}

const NODE_24 = { executable: '/usr/local/bin/node', version: '24.1.0' }

/** Writes what a successful WXT run leaves behind: the result file and the Chrome build's manifest. */
function writeSuccessfulBuild(privateFolder: string): void {
  const loadRoot = join(privateFolder, 'wxt-build', 'chrome-mv3-dev')
  mkdirSync(loadRoot, { recursive: true })
  writeFileSync(join(loadRoot, 'manifest.json'), '{}')
  writeFileSync(
    join(privateFolder, 'wxt-build-result.json'),
    JSON.stringify({ ok: true, wxtVersion: '0.21.4' }),
  )
}

async function refusalOf(promise: Promise<unknown>): Promise<StudyError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudyError) return error
    throw error
  }
  throw new Error('Expected the build step to refuse.')
}

let refusesBeforeSpawn = createFakeSpawner({ onSpawn: () => undefined })
// Each test starts with a spawner that has seen no call.
beforeEach(() => {
  refusesBeforeSpawn = createFakeSpawner({ onSpawn: () => undefined })
})

// protects=a project folder without any wxt.config file is refused before a process starts; fails_when=the build is spawned or the reason is another; no_claim=the wording of the sentence
test('refuses a project without a WXT config before any process starts', async () => {
  // Arrange
  const project = createProject()
  rmSync(join(project.projectRoot, 'wxt.config.ts'))
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: refusesBeforeSpawn.spawner,
    }),
  )
  // Assert
  assert.equal(refusal.code, 'EXTENSION_BUILD_UNSUPPORTED')
  assert.equal(refusal.details?.reason, 'no-wxt-config')
  assert.equal(refusesBeforeSpawn.spawned.length, 0)
})

// protects=a project whose dependencies are not installed is refused as wxt-not-installed; fails_when=the project is built anyway or refused with another reason; no_claim=a wxt found in a parent folder's node_modules (Node resolution would find it)
test('refuses a project where WXT is not installed before any process starts', async () => {
  // Arrange
  const project = createProject(null)
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: refusesBeforeSpawn.spawner,
    }),
  )
  // Assert
  assert.equal(refusal.code, 'EXTENSION_BUILD_UNSUPPORTED')
  assert.equal(refusal.details?.reason, 'wxt-not-installed')
  assert.equal(refusesBeforeSpawn.spawned.length, 0)
})

for (const version of ['0.20.9', '0.22.0', '0.21.0-beta.1']) {
  // protects=only a 0.21.x release builds, so an older, newer or prerelease WXT is refused with its version; fails_when=a neighbouring minor or a prerelease is built; no_claim=that 0.21.x builds (the native check)
  test(`refuses WXT ${version} as an unsupported version before any process starts`, async () => {
    // Arrange
    const project = createProject(version)
    // Act
    const refusal = await refusalOf(
      buildWxtExtension({
        ...project,
        node: NODE_24,
        signal: new AbortController().signal,
        spawner: refusesBeforeSpawn.spawner,
      }),
    )
    // Assert
    assert.equal(refusal.code, 'EXTENSION_BUILD_UNSUPPORTED')
    assert.equal(refusal.details?.reason, 'wxt-version')
    assert.equal(refusal.details?.version, version)
    assert.equal(refusesBeforeSpawn.spawned.length, 0)
  })
}

for (const [label, node, nodeVersion] of [
  ['no Node', undefined, 'none'],
  [
    'Node 22',
    { executable: '/usr/local/bin/node', version: '22.14.0' },
    '22.14.0',
  ],
] as const) {
  // protects=a missing or older-than-24 external Node is refused by name; fails_when=the build is attempted with it or details.nodeVersion is missing; no_claim=that resolveExternalNode finds a Node
  test(`refuses ${label} for the WXT build before any process starts`, async () => {
    // Arrange
    const project = createProject()
    // Act
    const refusal = await refusalOf(
      buildWxtExtension({
        ...project,
        node,
        signal: new AbortController().signal,
        spawner: refusesBeforeSpawn.spawner,
      }),
    )
    // Assert
    assert.equal(refusal.code, 'EXTENSION_BUILD_UNSUPPORTED')
    assert.equal(refusal.details?.reason, 'node-version')
    assert.equal(refusal.details?.nodeVersion, nodeVersion)
    assert.equal(refusesBeforeSpawn.spawned.length, 0)
  })
}

// protects=a tracked .wxt folder is refused because a build would rewrite tracked files; fails_when=the build starts with a tracked .wxt; no_claim=an untracked .wxt (the normal case)
test('refuses a project whose .wxt folder is tracked by Git before any process starts', async () => {
  // Arrange
  const project = createProject()
  mkdirSync(join(project.projectRoot, '.wxt'))
  writeFileSync(join(project.projectRoot, '.wxt', 'tsconfig.json'), '{}')
  execFileSync('git', ['add', 'ext/.wxt/tsconfig.json'], {
    cwd: project.repositoryRoot,
  })
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: refusesBeforeSpawn.spawner,
    }),
  )
  // Assert
  assert.equal(refusal.code, 'EXTENSION_BUILD_UNSUPPORTED')
  assert.equal(refusal.details?.reason, 'wxt-dir-tracked')
  assert.equal(refusesBeforeSpawn.spawned.length, 0)
})

// protects=the build runs the external Node with the inline WXT config (development mode, source maps, no minify) and the project, output and result paths, in the project folder; fails_when=the script loses the inline config, the paths move or the cwd is not the project root; no_claim=that real WXT accepts the config (the native check); the spawner is a fake
test('starts the external Node with the inline source-map config and the private output paths', async () => {
  // Arrange
  const project = createProject()
  const fake = createFakeSpawner({
    onSpawn(control) {
      writeSuccessfulBuild(project.privateFolder)
      control.exit({ code: 0, signal: null })
    },
  })
  // Act
  await buildWxtExtension({
    ...project,
    node: NODE_24,
    signal: new AbortController().signal,
    spawner: fake.spawner,
    clock: createFakeClock(),
  })
  // Assert
  const request = fake.spawned[0]
  assert.equal(request?.executable, '/usr/local/bin/node')
  assert.equal(request?.cwd, project.projectRoot)
  assert.deepEqual(request?.arguments.slice(0, 2), [
    '--input-type=module',
    '--eval',
  ])
  assert.deepEqual(request?.arguments.slice(3), [
    project.projectRoot,
    join(project.privateFolder, 'wxt-build'),
    join(project.privateFolder, 'wxt-build-result.json'),
  ])
  const script = request?.arguments[2] ?? ''
  assert.match(script, /mode: 'development'/)
  assert.match(script, /sourcemap: true, minify: false/)
})

// protects=a failed WXT build is refused as build-error with only masked output lines, the versions and the exit code; fails_when=a token the build printed reaches the message or the details are missing; no_claim=every secret shape (the redactor's own tests)
test('reports a failed build as build-error with masked output lines', async () => {
  // Arrange
  const project = createProject()
  const token = `ghp_${'a'.repeat(36)}`
  const fake = createFakeSpawner({
    onSpawn(control) {
      control.output(`using key ${token}\nError: boom in App.tsx\n`)
      writeFileSync(
        join(project.privateFolder, 'wxt-build-result.json'),
        JSON.stringify({ ok: false, message: 'boom' }),
      )
      control.exit({ code: 1, signal: null })
    },
  })
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock: createFakeClock(),
    }),
  )
  // Assert
  assert.equal(refusal.code, 'EXTENSION_BUILD_FAILED')
  assert.equal(refusal.details?.reason, 'build-error')
  assert.match(refusal.message, /Error: boom in App\.tsx/)
  assert.doesNotMatch(refusal.message, /ghp_/)
  assert.equal(refusal.details?.exitCode, 1)
  assert.equal(refusal.details?.wxtVersion, '0.21.4')
  assert.equal(refusal.details?.nodeVersion, '24.1.0')
})

// protects=a build that exits without a result file is a build-error; fails_when=a crashed script is read as success; no_claim=why it crashed
test('reports a build that left no result file as build-error', async () => {
  // Arrange
  const project = createProject()
  const fake = createFakeSpawner({
    onSpawn: (control) => control.exit({ code: 0, signal: null }),
  })
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock: createFakeClock(),
    }),
  )
  // Assert
  assert.equal(refusal.details?.reason, 'build-error')
})

// protects=a build that succeeds without a chrome-mv3-dev manifest is no-output; fails_when=a missing manifest is loaded as success; no_claim=the manifest's content
test('reports a build without a Chrome manifest as no-output', async () => {
  // Arrange
  const project = createProject()
  const fake = createFakeSpawner({
    onSpawn(control) {
      writeFileSync(
        join(project.privateFolder, 'wxt-build-result.json'),
        JSON.stringify({ ok: true, wxtVersion: '0.21.4' }),
      )
      control.exit({ code: 0, signal: null })
    },
  })
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock: createFakeClock(),
    }),
  )
  // Assert
  assert.equal(refusal.details?.reason, 'no-output')
})

// protects=a build past its budget ends its process tree with SIGTERM and is reported as timeout; fails_when=the tree is left running or another reason is reported; no_claim=the real 120 s wait (a fake clock stands in)
test('ends the process tree and reports timeout when the build exceeds its budget', async () => {
  // Arrange
  const project = createProject()
  const clock = createFakeClock()
  const fake = createFakeSpawner({ onSpawn: () => undefined })
  const building = refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock,
    }),
  )
  await fake.hasSpawned
  // Act
  await clock.advance(EXTENSION_BUILD_TIMEOUT_MS)
  const refusal = await building
  // Assert
  assert.equal(refusal.code, 'EXTENSION_BUILD_FAILED')
  assert.equal(refusal.details?.reason, 'timeout')
  assert.deepEqual(fake.signals, ['SIGTERM'])
})

// protects=a tracked file a failing build changed is reported as tracked-file-changed (repository-relative path), not as build-error; fails_when=the failure hides the change; no_claim=that Codebook restores anything (it never does)
test('reports tracked-file-changed when a failed build changed a tracked file', async () => {
  // Arrange
  const project = createProject()
  const fake = createFakeSpawner({
    onSpawn(control) {
      writeFileSync(
        join(project.projectRoot, 'src', 'a.ts'),
        'export const a = 2\n',
      )
      control.exit({ code: 1, signal: null })
    },
  })
  // Act
  const refusal = await refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock: createFakeClock(),
    }),
  )
  // Assert
  assert.equal(refusal.details?.reason, 'tracked-file-changed')
  assert.equal(refusal.details?.path, 'ext/src/a.ts')
})

// protects=a tracked file changed during a build that then timed out is reported as tracked-file-changed, not timeout; fails_when=timeout takes precedence over the change; no_claim=the real timer
test('reports tracked-file-changed when a timed-out build changed a tracked file', async () => {
  // Arrange
  const project = createProject()
  const clock = createFakeClock()
  const fake = createFakeSpawner({
    onSpawn() {
      writeFileSync(
        join(project.projectRoot, 'wxt.config.ts'),
        'export default { x: 1 }\n',
      )
    },
  })
  const building = refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock,
    }),
  )
  await fake.hasSpawned
  // Act
  await clock.advance(EXTENSION_BUILD_TIMEOUT_MS)
  const refusal = await building
  // Assert
  assert.equal(refusal.details?.reason, 'tracked-file-changed')
  assert.equal(refusal.details?.path, 'ext/wxt.config.ts')
})

// protects=a tree that survives SIGTERM and SIGKILL makes the tracked-file check unverified (no retry); fails_when=the build is reported as an ordinary timeout while processes may still run; no_claim=that a real stuck process is handled by the production spawner
test('reports tracked-files-unverified when the build tree cannot be confirmed ended', async () => {
  // Arrange
  const project = createProject()
  const clock = createFakeClock()
  const fake = createFakeSpawner({ onSpawn: () => undefined, endsOn: 'never' })
  const building = refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: new AbortController().signal,
      spawner: fake.spawner,
      clock,
    }),
  )
  await fake.hasSpawned
  // Act
  await clock.advance(EXTENSION_BUILD_TIMEOUT_MS)
  await clock.advance(EXTENSION_BUILD_KILL_GRACE_MS)
  await clock.advance(EXTENSION_BUILD_KILL_GRACE_MS)
  const refusal = await building
  // Assert
  assert.equal(refusal.details?.reason, 'tracked-files-unverified')
  assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL'])
})

// protects=a cancellation after the build changed a tracked file still reports tracked-file-changed; fails_when=a stop hides the change as a plain cancellation; no_claim=how the caller words its stop error
test('reports tracked-file-changed when a cancelled build had changed a tracked file', async () => {
  // Arrange
  const project = createProject()
  const controller = new AbortController()
  const fake = createFakeSpawner({
    onSpawn() {
      writeFileSync(
        join(project.projectRoot, 'src', 'a.ts'),
        'export const a = 3\n',
      )
    },
  })
  const building = refusalOf(
    buildWxtExtension({
      ...project,
      node: NODE_24,
      signal: controller.signal,
      spawner: fake.spawner,
      clock: createFakeClock(),
    }),
  )
  await fake.hasSpawned
  // Act
  controller.abort()
  const refusal = await building
  // Assert
  assert.equal(refusal.details?.reason, 'tracked-file-changed')
  assert.deepEqual(fake.signals, ['SIGTERM'])
})

// protects=a cancellation with unchanged tracked files returns the typed cancelled outcome after ending the tree; fails_when=a cancelled build throws a build failure or leaves the tree running; no_claim=the caller's mapping to its stop error
test('returns a cancelled outcome when the signal ends a build that changed nothing', async () => {
  // Arrange
  const project = createProject()
  const controller = new AbortController()
  const fake = createFakeSpawner({ onSpawn: () => undefined })
  const building = buildWxtExtension({
    ...project,
    node: NODE_24,
    signal: controller.signal,
    spawner: fake.spawner,
    clock: createFakeClock(),
  })
  await fake.hasSpawned
  // Act
  controller.abort()
  const result = await building
  // Assert
  assert.deepEqual(result, { kind: 'cancelled' })
  assert.deepEqual(fake.signals, ['SIGTERM'])
})

// protects=a successful build returns the chrome-mv3-dev load root inside the private folder with the WXT version and the clock's duration; fails_when=the load root, version or duration is wrong; no_claim=that Chrome loads the build
test('returns the Chrome development build as the load root after a successful build', async () => {
  // Arrange
  const project = createProject()
  const clock = createFakeClock()
  const fake = createFakeSpawner({
    onSpawn(control) {
      writeSuccessfulBuild(project.privateFolder)
      void clock.advance(2_500)
      control.exit({ code: 0, signal: null })
    },
  })
  // Act
  const result = await buildWxtExtension({
    ...project,
    node: NODE_24,
    signal: new AbortController().signal,
    spawner: fake.spawner,
    clock,
  })
  // Assert
  assert.equal(result.kind, 'built')
  assert.equal(
    result.kind === 'built' && result.loadRoot,
    join(project.privateFolder, 'wxt-build', 'chrome-mv3-dev'),
  )
  assert.equal(result.kind === 'built' && result.wxtVersion, '0.21.4')
  assert.equal(result.kind === 'built' && result.durationMs, 2_500)
})
