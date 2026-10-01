import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * Runs one planned `node --test` call and keeps its output together, so two lanes of a shard never interleave their reports; called by `scripts/test-shard.mjs` for every invocation of {@link planTestShards}.
 * @param invocation - `{ files, namePattern?, skipPattern? }` from the plan; a pattern applies to every file of the call.
 * @param testDirectory - Directory of the compiled test files.
 * @returns `{ code, signal, output, elapsedMs }` once the process and its streams have closed. Coverage is collected through the inherited `NODE_V8_COVERAGE`.
 * @example
 * await runTestInvocation({ files: ['service.test.js'] }, 'dist/tests')
 * // => { code: 0, signal: null, output: '✔ …', elapsedMs: 412 }
 */
export function runTestInvocation(invocation, testDirectory) {
  const selection = [
    ...(invocation.namePattern
      ? [`--test-name-pattern=${invocation.namePattern}`]
      : []),
    ...(invocation.skipPattern
      ? [`--test-skip-pattern=${invocation.skipPattern}`]
      : []),
  ]
  // A part ends when its selected tests end. Without this, each part would wait for timers its tests left behind
  // (up to a 20 s product deadline), which the unsplit file absorbs while its later tests run.
  const patterns =
    selection.length > 0 ? ['--test-force-exit', ...selection] : []
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(
      process.execPath,
      [
        '--test',
        // A lane is one sequence: its files run one after another, as each file's own tests do.
        '--test-concurrency=1',
        '--test-reporter=spec',
        ...patterns,
        ...invocation.files.map((file) => join(testDirectory, file)),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        // A call started from inside a test (the package suite tests this function) must not look like a nested
        // file of that test run, or `node --test` skips its files.
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
      },
    )
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        output: Buffer.concat(chunks).toString('utf8'),
        elapsedMs: performance.now() - startedAt,
      })
    })
  })
}
