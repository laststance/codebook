import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { NodeScriptConfiguration } from '../nodeScriptConfigSchemas'
import {
  createOwnedNodeScriptRun,
  type NodeScriptRunDependencies,
} from '../ownedNodeScriptRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'

import { realNodeServerDependencies } from './utils/realNodeServerDependencies'

/** One declared stop of a fixture script: a repository file and the text of the line to stop on. */
type FixtureStop = {
  file: string
  lineText: string
  inspect: string
  required?: boolean
}

const LIBRARY = `exports.compute = function compute(count) {
  let sum = 0
  for (let index = 1; index <= count; index++) sum += index
  return sum
}
`

const ESM_ENTRY = `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { compute } = require('./lib.cjs')
const total = compute(3)
console.log('total', total)
`

/**
 * Builds a script run of real files in a new repository folder, through the real launcher and the CDP debugger stand-in; the folder and every process are cleaned up after the test.
 * @param t - The test, whose end removes the folder and stops the run.
 * @param files - The repository files by path.
 * @param entry - The script file, relative to `packageRoot`.
 * @param stops - The declared stops.
 * @param options - `packageRoot` and a changed-file hook that edits a file after its hash was cited.
 * @returns The run, its events and the folder.
 */
async function fixtureScriptRun(
  t: TestContext,
  files: Record<string, string>,
  entry: string,
  stops: FixtureStop[],
  options: { packageRoot?: string; editAfterCiting?: string } = {},
) {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-script-run-')),
  )
  t.after(() => rm(workspace, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  const declared = await Promise.all(
    stops.map(async (stop, index) => {
      const text = await readFile(join(workspace, stop.file), 'utf8')
      const line =
        text.split('\n').findIndex((row) => row === stop.lineText) + 1
      assert.ok(line > 0, `${stop.lineText} not found in ${stop.file}`)
      return {
        path: stop.file,
        hash: sha256(text),
        line,
        column: 1,
        anchorIndex: index,
        inspections: [
          {
            path: stop.inspect,
            mode: 'value' as const,
            required: stop.required ?? true,
          },
        ],
      }
    }),
  )
  if (options.editAfterCiting)
    await writeFile(join(workspace, options.editAfterCiting), '// edited\n')
  const [first, ...rest] = declared
  assert.ok(first)
  const configuration: NodeScriptConfiguration = {
    version: 1,
    adapter: 'node-script',
    book: { bookId: 'script', revision: 1, nodeId: 'run', anchorIndex: 0 },
    packageRoot: options.packageRoot ?? '.',
    entry,
    loader: 'node',
    source: { path: first.path, hash: first.hash, line: first.line, column: 1 },
    inspections: first.inspections,
    additionalStops: rest.length > 0 ? rest : undefined,
  }
  const events: Array<{ type: string; detail: unknown }> = []
  const orphanStore = new Map<string, unknown>()
  const real = realNodeServerDependencies(
    { executable: process.execPath, version: process.versions.node },
    20_000,
    orphanStore,
  )
  let debuggerSession: ReturnType<typeof real.createDebugger> | undefined
  const dependencies: NodeScriptRunDependencies = {
    ...real,
    createDebugger: (input) => {
      debuggerSession = real.createDebugger(input)
      return debuggerSession
    },
    readListeningPorts: async () => [],
    confirmRun: async () => true,
  }
  const run = createOwnedNodeScriptRun({
    workspace,
    configuration,
    record: (type, detail) => {
      events.push({ type, detail })
      // js-debug ends its session itself when Node announces it waits for the debugger; the CDP stand-in is told the same here, never by the run.
      if (
        type === 'node-server.output' &&
        String(Reflect.get(detail as object, 'text')).includes(
          'Waiting for the debugger to disconnect',
        )
      )
        void debuggerSession?.release()
    },
    citedSources: [],
    runId: 'script-process-run',
    dependencies,
  })
  // A failed test still ends the script it started.
  t.after(() => run.stop().catch(() => undefined))
  return { run, events, workspace }
}

/** Waits until the run's view satisfies a condition, by listening to its changes. */
function untilView(
  run: ReturnType<typeof createOwnedNodeScriptRun>,
  condition: (view: ReturnType<typeof run.view>) => boolean,
) {
  if (condition(run.view())) return Promise.resolve(run.view())
  return new Promise<ReturnType<typeof run.view>>((resolve) => {
    const subscription = run.onDidChange(() => {
      if (!condition(run.view())) return
      subscription.dispose()
      resolve(run.view())
    })
  })
}

/** Whether a process with this pid exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// protects=a real .mjs entry that requires a .cjs file pauses in both files with their values, continues to exit 0 with its output and leaves no process; fails_when=a stop in the entry or the required file does not bind, a value is wrong, the end or output is missing, or the group survives; no_claim=the DAP binding, pwa-node attach and js-debug ending its own session at Node's end (a direct inspector connection stands in and is told by the test)
test('a real ESM script requiring a CommonJS file pauses in both, ends with exit 0 and its output, and leaves no process', async (t) => {
  // Arrange
  const { run, events } = await fixtureScriptRun(
    t,
    { 'run.mjs': ESM_ENTRY, 'lib.cjs': LIBRARY },
    'run.mjs',
    [
      {
        file: 'run.mjs',
        lineText: "console.log('total', total)",
        inspect: 'total',
      },
      { file: 'lib.cjs', lineText: '  return sum', inspect: 'sum' },
    ],
  )

  // Act
  await run.prepare()
  const library = await untilView(run, (view) => view.state === 'paused')
  assert.ok(library.pause)
  await run.continue(library.pause)
  const entry = await untilView(
    run,
    (view) => view.state === 'paused' && view.pauseGeneration > 1,
  )
  assert.ok(entry.pause)
  await run.continue(entry.pause)
  const ended = await untilView(run, (view) => view.end !== undefined)
  const pid = ended.pid!

  // Assert
  assert.equal(library.captures[0]?.path, 'lib.cjs')
  assert.equal(library.captures[0]?.facts['value:sum'], '6')
  assert.equal(entry.captures[1]?.path, 'run.mjs')
  assert.equal(entry.captures[1]?.facts['value:total'], '6')
  assert.equal(ended.state, 'ended')
  assert.equal(ended.end?.kind, 'exited')
  assert.equal(ended.end?.exitCode, 0)
  assert.deepEqual(ended.end?.stopsNeverReached, [])
  assert.match(ended.end?.output.tail ?? '', /total 6/)
  assert.ok(
    events.some((event) => event.type === 'node-server.output'),
    'the output reached the journal',
  )
  assert.equal(isProcessGroupGone(pid), true)
})

// protects=a stop on the statement right after the entry pause, in a CommonJS entry and in an ES module entry, pauses before that statement ran; fails_when=arming races the first lines so the script runs past the stop; no_claim=a stop on the very first statement (V8 does not re-hit a breakpoint at the location the entry pause already holds, so only js-debug in the Space can show it), other Node majors, and js-debug's entry-pause variance (a direct inspector connection stands in)
test('a stop on the statement after the entry pause, in a CommonJS and in an ES module entry, pauses', async (t) => {
  // Arrange
  const first =
    "const seed = 7\nconst doubled = seed * 2\nconsole.log('seed', doubled)\n"
  for (const entry of ['first.cjs', 'first.mjs']) {
    const { run } = await fixtureScriptRun(t, { [entry]: first }, entry, [
      { file: entry, lineText: 'const doubled = seed * 2', inspect: 'seed' },
    ])

    // Act
    await run.prepare()
    const paused = await untilView(run, (view) => view.state === 'paused')

    // Assert
    assert.equal(paused.pause?.declaredStopIndex, 0, entry)
    assert.equal(paused.captures[0]?.line, 2, entry)
    assert.equal(paused.captures[0]?.facts['value:seed'], '7', entry)
    await run.continue(paused.pause)
    const ended = await untilView(run, (view) => view.end !== undefined)
    assert.equal(ended.end?.exitCode, 0, entry)
  }
})

// protects=a file edited after the article cited it refuses the start as SOURCE_CHANGED and spawns nothing; fails_when=the script runs against a source the article did not cite; no_claim=editor-held documents (the debugger fake covers them)
test('a stop file changed since it was cited refuses the start as SOURCE_CHANGED before any process', async (t) => {
  // Arrange
  const { run, events } = await fixtureScriptRun(
    t,
    { 'run.mjs': ESM_ENTRY, 'lib.cjs': LIBRARY },
    'run.mjs',
    [{ file: 'lib.cjs', lineText: '  return sum', inspect: 'sum' }],
    { editAfterCiting: 'lib.cjs' },
  )

  // Act
  const failure = await run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SOURCE_CHANGED')
  assert.equal(
    events.some((event) => event.type === 'node-server.started'),
    false,
  )
})

// protects=a stop outside the package folder and a stop under node_modules are refused with their reasons before any process; fails_when=either arms; no_claim=symlinked layouts
test('stops outside the package and under node_modules are refused before any process', async (t) => {
  // Arrange
  const files = {
    'pkg/run.mjs': "console.log('hi')\n",
    'outside.js': 'const outside = 1\n',
    'pkg/node_modules/dep/index.js': 'const inside = 1\n',
  }
  const outside = await fixtureScriptRun(
    t,
    files,
    'run.mjs',
    [{ file: 'outside.js', lineText: 'const outside = 1', inspect: 'outside' }],
    { packageRoot: 'pkg' },
  )
  const modules = await fixtureScriptRun(
    t,
    files,
    'run.mjs',
    [
      {
        file: 'pkg/node_modules/dep/index.js',
        lineText: 'const inside = 1',
        inspect: 'inside',
      },
    ],
    { packageRoot: 'pkg' },
  )

  // Act
  const outsideFailure = await outside.run
    .prepare()
    .catch((error: unknown) => error)
  const modulesFailure = await modules.run
    .prepare()
    .catch((error: unknown) => error)

  // Assert
  assert.ok(outsideFailure instanceof StudyError)
  assert.equal(outsideFailure.code, 'NODE_SCRIPT_SOURCE_REFUSED')
  assert.equal(outsideFailure.details?.reason, 'outside-package')
  assert.ok(modulesFailure instanceof StudyError)
  assert.equal(modulesFailure.details?.reason, 'node-modules')
  assert.equal(
    outside.events.some((event) => event.type === 'node-server.started'),
    false,
  )
})

// protects=codebook_stop during a pause ends the script and the child it started, leaving no owned process; fails_when=the child outlives the stop or the paused script runs on; no_claim=processes that leave the group on purpose (detached children)
test('stopping a paused script ends the whole group, a child process included', async (t) => {
  // Arrange
  const script = `const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
console.log('child', child.pid)
const marker = 1
console.log('after', marker)
`
  const { run, events } = await fixtureScriptRun(
    t,
    { 'child.cjs': script },
    'child.cjs',
    [
      {
        file: 'child.cjs',
        lineText: 'const marker = 1',
        inspect: 'marker',
        required: false,
      },
    ],
  )
  await run.prepare()
  const paused = await untilView(run, (view) => view.state === 'paused')
  const output = events
    .filter((event) => event.type === 'node-server.output')
    .map((event) => String(Reflect.get(event.detail as object, 'text')))
    .join('')
  const childPid = Number(/child (\d+)/.exec(output)?.[1])
  assert.ok(childPid > 0, output)
  assert.equal(isAlive(childPid), true)

  // Act
  await run.stop()
  const stopped = run.view()

  // Assert
  assert.equal(stopped.end?.kind, 'stopped')
  assert.equal(stopped.state, 'stopped')
  assert.equal(isProcessGroupGone(paused.pid!), true)
  assert.equal(isAlive(childPid), false)
})
