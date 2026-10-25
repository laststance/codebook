import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  listVitestTestFiles,
  type RetryVitestListingRelease,
  type VitestListingReleaseFailure,
} from '../utils/listVitestTestFiles'

import { keptListingFolderOf } from './utils/keptListingFolderOf'

/**
 * Writes a stand-in Vitest CLI that records how it was started, then behaves as the given script body.
 *
 * @param body - JavaScript run after recording; `output` holds the `--json=` path Vitest was given.
 * @returns The stand-in program path and a reader for its recorded start.
 * @example
 * ```ts
 * const vitest = await stubVitest('writeFileSync(output, "[]")'); await vitest.started() // => { argv: ['list', ...], cwd: '/repo', env: {...} }
 * ```
 */
async function stubVitest(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-stub-'))
  const program = join(directory, 'vitest.mjs')
  await writeFile(
    program,
    `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(join(directory, 'started.json'))}, JSON.stringify({ argv, cwd: process.cwd(), env: process.env }));
const output = argv.find(argument => argument.startsWith('--json='))?.slice('--json='.length);
${body}
`,
  )
  return {
    directory,
    program,
    started: async () =>
      JSON.parse(await readFile(join(directory, 'started.json'), 'utf8')) as {
        argv: string[]
        cwd: string
        env: Record<string, string>
      },
  }
}

/**
 * Removes the private folder a listing kept because its release failed, so that a test of such a listing leaves nothing in the temporary directory, also when it fails.
 * Only a listing folder directly in the temporary directory is deleted ({@link keptListingFolderOf}); a recorded start that names any other path removes nothing.
 * @param vitest - The stand-in Vitest of the test, whose recorded start names the folder.
 * @example
 * await removeKeptListingFolder(vitest) // the folder of '--json=/tmp/codebook-vitest-list-x/files.json' is gone
 */
async function removeKeptListingFolder(
  vitest: Awaited<ReturnType<typeof stubVitest>>,
): Promise<void> {
  const started = await vitest.started().catch(() => undefined)
  const folder = keptListingFolderOf(started?.argv ?? [], tmpdir())
  if (folder) await rm(folder, { recursive: true, force: true })
}

test('listing runs the owned Vitest in the repository with the run environment and returns the files it would select', async () => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }, { file: '/repo/src/a.test.ts', projectName: 'browser' }]));`,
  )
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-vitest-workspace-'))
  process.env.CODEBOOK_LIST_TEST_SECRET = 'must-not-reach-vitest'
  try {
    // Act
    const files = await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: workspace,
      filter: 'src/a.test.ts',
      excludes: ['/repo/copy/src/a.test.ts'],
      signal: new AbortController().signal,
    })
    // Assert
    assert.deepEqual(files, [
      { file: '/repo/src/a.test.ts' },
      { file: '/repo/src/a.test.ts', projectName: 'browser' },
    ])
    const started = await vitest.started()
    const output = started.argv[2]!.slice('--json='.length)
    assert.deepEqual(started.argv, [
      'list',
      '--filesOnly',
      `--json=${output}`,
      'src/a.test.ts',
      '--exclude=/repo/copy/src/a.test.ts',
    ])
    assert.equal(started.cwd, await realpath(workspace))
    assert.equal(started.env.CI, 'true')
    assert.equal(started.env.NODE_ENV, 'test')
    assert.equal(
      started.env.CODEBOOK_LIST_TEST_SECRET,
      undefined,
      'unrelated credentials stay out of the Vitest process',
    )
    await assert.rejects(
      stat(dirname(output)),
      { code: 'ENOENT' },
      'the private listing folder is removed',
    )
  } finally {
    delete process.env.CODEBOOK_LIST_TEST_SECRET
    await rm(vitest.directory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a Vitest listing that fails reports its exit code and bounded error text', async () => {
  // Arrange
  const vitest = await stubVitest(
    `process.stderr.write('Config error: ' + 'x'.repeat(10_000)); process.exit(3);`,
  )
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
    })
    // Assert
    await assert.rejects(
      listing,
      (error: Error) =>
        /exit code 3/.test(error.message) &&
        /Config error/.test(error.message) &&
        error.message.length < 2_300,
    )
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

test('a Vitest listing that does not write a list of files is refused', async () => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify({ files: 'src/a.test.ts' }));`,
  )
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
    })
    // Assert
    await assert.rejects(listing, /Vitest wrote an unreadable test file list/)
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

test('cancelling the run stops a Vitest listing that is still working', async () => {
  // Arrange
  const vitest = await stubVitest(
    `setTimeout(() => writeFileSync(output, '[]'), 30_000);`,
  )
  const cancellation = new AbortController()
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: cancellation.signal,
    })
    setTimeout(() => cancellation.abort(new Error('run cancelled')), 200)
    const startedAt = performance.now()
    // Assert
    await assert.rejects(listing, /run cancelled/)
    assert.ok(
      performance.now() - startedAt < 5_000,
      'the listing ends with the run instead of its own deadline',
    )
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

test('a Vitest listing that outlives its deadline is stopped and reported', async () => {
  // Arrange
  const vitest = await stubVitest(
    `setTimeout(() => writeFileSync(output, '[]'), 30_000);`,
  )
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      timeoutMs: 300,
    })
    // Assert
    await assert.rejects(listing, /did not list its test files within 300 ms/)
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

test('cancelling a listing keeps the reason of the run while an exited member of its group is not reaped yet', async (context) => {
  // Arrange
  const vitest = await stubVitest(
    `setTimeout(() => writeFileSync(output, '[]'), 30_000);`,
  )
  const cancellation = new AbortController()
  const kill = process.kill.bind(process)
  context.mock.property(process, 'platform', 'darwin')
  let unreapedProbes = 2
  // macOS answers EPERM to a probe of a group that holds only exited members their parent has not reaped yet.
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0 && signal === 0 && unreapedProbes > 0) {
        unreapedProbes -= 1
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      return kill(pid, signal)
    },
  )
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: cancellation.signal,
    })
    setTimeout(() => cancellation.abort(new Error('run cancelled')), 200)
    // Assert
    await assert.rejects(listing, /run cancelled/)
    assert.equal(unreapedProbes, 0)
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Added by the Cycle 0041 /ship coverage audit. Red at 6f245cd: the release reports EPERM from the signal it sends, not only from its probe.
// Value: protects=a finished listing returning its files while an exited member of its group is not reaped yet; fails_when=the release reports EPERM from the signal it sends to that group instead of waiting; why_new=the test above answers EPERM only to the signal-0 probe; seam=none
test('a finished listing still returns its files while an exited member of its group is not reaped yet', async (context) => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const kill = process.kill.bind(process)
  context.mock.property(process, 'platform', 'darwin')
  let unreapedAnswers = 2
  // macOS answers EPERM to every signal sent to a group that holds only exited members their parent has not reaped yet, not only to signal 0.
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0 && unreapedAnswers > 0) {
        unreapedAnswers -= 1
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      return kill(pid, signal)
    },
  )
  try {
    // Act
    const outcome = await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
    }).then(
      (files) => files,
      (error: unknown) => error,
    )
    // Assert
    assert.deepEqual(outcome, [{ file: '/repo/src/a.test.ts' }])
    assert.equal(unreapedAnswers, 0)
  } finally {
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Cycle 0044 (0041-F4): red while a release that never saw the group end threw inside `finally`, replacing the finished list, and the folder was removed anyway.
// Cycle 0045 (C-L2): red while that failed release was dropped without a word to the caller.
// Cycle 0046 (row 15, PL-7): red while a release whose wait for the group's end ran out returned the finished list, so the Node test run started while a member of the listing could still run.
test('a finished listing whose process group does not end after SIGTERM and SIGKILL is refused like a refused signal, reports the failed release and keeps its folder', async (context) => {
  // Arrange: the system accepts both signals for the listing's group and keeps answering that the group still exists.
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const reported: VitestListingReleaseFailure[] = []
  const signalsToGroup: (string | number | undefined)[] = []
  const kill = process.kill.bind(process)
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid >= 0) return kill(pid, signal)
      if (signal !== 0) signalsToGroup.push(signal)
      return true
    },
  )
  try {
    // Act
    const outcome: unknown = await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      onReleaseFailed: (failure) => reported.push(failure),
    }).then(
      (files) => files,
      (error: unknown) => error,
    )
    // Assert
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))
    assert.deepEqual(signalsToGroup, ['SIGTERM', 'SIGKILL'])
    assert.equal(reported.length, 1)
    const processGroup = reported[0]!.processGroup
    assert.equal(Number.isInteger(processGroup), true)
    assert.deepEqual(reported, [
      {
        processGroup,
        directory,
        reason:
          'Error: Timed out waiting for Vitest listing process group exit',
      },
    ])
    assert.ok(outcome instanceof Error)
    assert.equal(
      outcome.message,
      `Vitest listed the test files, but Codebook could not end the listing's process group ${processGroup} (Error: Timed out waiting for Vitest listing process group exit), so a process of that group may still run. The test was not started, and the listing's folder ${directory} is kept. Start the run again.`,
    )
    assert.ok(
      (await stat(directory)).isDirectory(),
      'the listing folder is kept while the group may still write it',
    )
  } finally {
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Cycle 0045 (AD-12): red while every failed release was dropped, so a finished listing was returned although a member of its group could not be signalled.
test('a finished listing whose process group has a member the user may not signal fails with that refusal instead of returning its files, and reports the folder it left', async (context) => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const reported: VitestListingReleaseFailure[] = []
  const kill = process.kill.bind(process)
  context.mock.property(process, 'platform', 'linux')
  // Outside macOS, EPERM for a group means a live member of another user.
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0)
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      return kill(pid, signal)
    },
  )
  try {
    // Act
    const outcome: unknown = await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      onReleaseFailed: (failure) => reported.push(failure),
    }).then(
      (files) => files,
      (error: unknown) => error,
    )
    // Assert
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))
    assert.equal(reported.length, 1)
    const processGroup = reported[0]!.processGroup
    assert.equal(Number.isInteger(processGroup), true)
    assert.deepEqual(reported, [
      { processGroup, directory, reason: 'Error: kill EPERM' },
    ])
    assert.ok(outcome instanceof Error)
    assert.equal(
      outcome.message,
      `Vitest listed the test files, but Codebook could not end the listing's process group ${processGroup} (Error: kill EPERM), so a process of that group may still run. The test was not started, and the listing's folder ${directory} is kept. Start the run again.`,
    )
    assert.deepEqual(
      outcome.cause,
      Object.assign(new Error('kill EPERM'), { code: 'EPERM' }),
    )
    assert.ok(
      (await stat(directory)).isDirectory(),
      'the listing folder is kept while a member of the group may still write it',
    )
  } finally {
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Value: protects=a listing whose release failed handing its owner a retry that runs the release again: it fails with its sentence while a member of the group still refuses its signal, and removes the kept folder once the group has ended; fails_when=the retry is missing, succeeds while the group may still run, or leaves the folder behind after the group ended, so the run that owns the listing reads released too early or never; why_new=Cycle 0053 /ship Step 11 (Codex adversarial review: an unreleased root listing was owned by nobody); seam=process.kill refuses group signals until the test lets them through; no_claim=who runs the retry (ownedNodeTestRun and nodeTestVitestRootService tests)
test('a listing whose release failed hands over a retry that fails while the group refuses its signal and removes the kept folder once it has ended', async (context) => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const retries: RetryVitestListingRelease[] = []
  const kill = process.kill.bind(process)
  let groupSignalsRefused = true
  context.mock.property(process, 'platform', 'linux')
  // Outside macOS, EPERM for a group means a live member of another user.
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0 && groupSignalsRefused)
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      return kill(pid, signal)
    },
  )
  try {
    await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      onReleaseFailed: (_failure, retryRelease) => retries.push(retryRelease),
    }).catch(() => undefined)
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))
    assert.equal(retries.length, 1)

    // Act
    const whileRefused = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )
    const keptWhileRefused = await stat(directory).then(
      (entry) => entry.isDirectory(),
      () => false,
    )
    groupSignalsRefused = false
    const onceEnded = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(whileRefused instanceof Error)
    assert.match(
      whileRefused.message,
      /^Codebook still could not confirm that the Vitest listing's process group \d+ ended \(Error: kill EPERM\), so a process of that group may still run, and its folder .+ is kept\. Stop the run again\.$/,
    )
    assert.equal(keptWhileRefused, true)
    assert.equal(onceEnded, undefined)
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  } finally {
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Value: protects=a retried listing release sending no signal to a process group that has ended since its first release failed, since by the retry, which runs at a later stop, the group's id may name another process's group; fails_when=the retry sends SIGTERM and SIGKILL to the old group id whatever its state, so a stop long after the failure can end an unrelated process group the system gave that id; why_new=Cycle 0053 /ship review pass 4 (three reviewers: the retry widened the window from seconds to a later stop); seam=process.kill refuses SIGTERM and SIGKILL to groups and records them, while its probe reaches the system; no_claim=a group id reused before the probe (cannot be told apart by id)
test('a retried listing release sends no signal to a group that has ended since and removes the kept folder', async (context) => {
  // Arrange
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const retries: RetryVitestListingRelease[] = []
  const signalsToGroups: (string | number | undefined)[] = []
  const kill = process.kill.bind(process)
  context.mock.property(process, 'platform', 'linux')
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0 && signal !== 0) {
        signalsToGroups.push(signal)
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      return kill(pid, signal)
    },
  )
  try {
    await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      onReleaseFailed: (_failure, retryRelease) => retries.push(retryRelease),
    }).catch(() => undefined)
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))
    const signalsOfFirstRelease = signalsToGroups.splice(0)

    // Act
    const retried = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.deepEqual(signalsOfFirstRelease, ['SIGTERM'])
    assert.equal(retried, undefined)
    assert.deepEqual(signalsToGroups, [])
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  } finally {
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Cycle 0045 (AD-12): a helper outside the group that holds the error stream also holds the listing's end, so the listing ends only with its deadline or the run; red while the release that then fails was dropped without a word.
test('a listing whose helper left the process group and keeps its error stream open is reported as not released and names its folder', async () => {
  // Arrange: the helper starts its own process group, inherits the listing's error stream and outlives the launcher, which writes its list and ends.
  const vitest = await stubVitest(`
import { spawn } from 'node:child_process';
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
helper.unref();
writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));
writeFileSync('started-helper.json', JSON.stringify({ launcher: process.pid, helper: helper.pid }));
`)
  const reported: VitestListingReleaseFailure[] = []
  const cancellation = new AbortController()
  let processes: { launcher: number; helper: number } | undefined
  try {
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: cancellation.signal,
      onReleaseFailed: (failure) => reported.push(failure),
    }).then(
      (files) => files,
      (error: unknown) => error,
    )
    processes = await waitUntil(
      async () =>
        readFile(join(vitest.directory, 'started-helper.json'), 'utf8').then(
          (text) => JSON.parse(text) as { launcher: number; helper: number },
          () => undefined,
        ),
      'listing helper start',
      5_000,
    )
    const launcher = processes.launcher
    await waitUntil(
      () => {
        try {
          process.kill(launcher, 0)
          return false
        } catch {
          return true
        }
      },
      'listing launcher exit',
      5_000,
    )
    // Act: the launcher has written its list and ended, and the listing still waits for the stream the helper holds.
    cancellation.abort(new Error('run cancelled'))
    const outcome: unknown = await listing
    // Assert
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))
    assert.ok(outcome instanceof Error)
    assert.equal(outcome.message, 'run cancelled')
    assert.deepEqual(reported, [
      {
        processGroup: launcher,
        directory,
        reason: 'Error: Timed out waiting for Vitest listing exit',
      },
    ])
    assert.ok(
      (await stat(directory)).isDirectory(),
      'the listing folder is kept while the helper may still write it',
    )
    assert.doesNotThrow(
      () => process.kill(processes!.helper, 0),
      'the helper outside the group still runs, which is what the report is about',
    )
  } finally {
    // Only this test's own synthetic helper is ended.
    cancellation.abort(new Error('run cancelled'))
    if (processes)
      try {
        process.kill(processes.helper, 'SIGKILL')
      } catch {}
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Value: protects=a listing whose helper left the process group and holds the error stream being released by its retry once the group has ended, so the run that owns it can stop and the next start is not BUSY for as long as the helper lives; fails_when=the retry waits again for the stream the helper holds, fails at every stop, and every start answers BUSY until the helper exits or the editor reloads; why_new=Cycle 0053 /ship review pass 5 (red team); seam=a stand-in Vitest whose helper starts its own process group and inherits the error stream; no_claim=the helper itself, which is outside the group and is not Codebook's to end
test('a retried release of a listing whose helper holds its error stream succeeds once the group has ended and removes the kept folder', async () => {
  // Arrange: the helper starts its own process group, inherits the listing's error stream and outlives the launcher, which writes its list and ends.
  const vitest = await stubVitest(`
import { spawn } from 'node:child_process';
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
helper.unref();
writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));
writeFileSync('started-helper.json', JSON.stringify({ launcher: process.pid, helper: helper.pid }));
`)
  const retries: RetryVitestListingRelease[] = []
  const cancellation = new AbortController()
  let processes: { launcher: number; helper: number } | undefined
  try {
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: cancellation.signal,
      onReleaseFailed: (_failure, retryRelease) => retries.push(retryRelease),
    }).then(
      (files) => files,
      (error: unknown) => error,
    )
    processes = await waitUntil(
      async () =>
        readFile(join(vitest.directory, 'started-helper.json'), 'utf8').then(
          (text) => JSON.parse(text) as { launcher: number; helper: number },
          () => undefined,
        ),
      'listing helper start',
      5_000,
    )
    const launcher = processes.launcher
    await waitUntil(
      () => {
        try {
          process.kill(launcher, 0)
          return false
        } catch {
          return true
        }
      },
      'listing launcher exit',
      5_000,
    )
    cancellation.abort(new Error('run cancelled'))
    await listing
    const started = await vitest.started()
    const directory = dirname(started.argv[2]!.slice('--json='.length))

    // Act
    const retried = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.equal(retries.length, 1)
    assert.equal(retried, undefined)
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  } finally {
    // Only this test's own synthetic helper is ended.
    cancellation.abort(new Error('run cancelled'))
    if (processes)
      try {
        process.kill(processes.helper, 'SIGKILL')
      } catch {}
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

// Value: protects=a retry that found the listing's group ended never probing or signalling that group id again, also when the folder's removal failed and a later stop retries; fails_when=a later retry probes and signals the old id, which by then may name another process's group, so a stop ends an unrelated process group; why_new=Cycle 0053 Step 11 round 2 (Codex adversarial, High); seam=process.kill refuses the first release's signals and records every call to a group, and the kept folder is made unwritable once; no_claim=a group id reused before the first probe (cannot be told apart by id)
test('a retry that found the group ended and could not remove the folder touches no group again on the next retry', async (context) => {
  // Arrange
  if (process.getuid?.() === 0)
    return context.skip('chmod 0o500 does not deny the root user')
  const vitest = await stubVitest(
    `writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }]));`,
  )
  const retries: RetryVitestListingRelease[] = []
  const callsToGroups: (string | number | undefined)[] = []
  const kill = process.kill.bind(process)
  let firstReleaseRefused = true
  context.mock.property(process, 'platform', 'linux')
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid < 0) {
        callsToGroups.push(signal)
        if (firstReleaseRefused)
          throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      return kill(pid, signal)
    },
  )
  let directory: string | undefined
  try {
    await listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: new AbortController().signal,
      onReleaseFailed: (_failure, retryRelease) => retries.push(retryRelease),
    }).catch(() => undefined)
    const started = await vitest.started()
    directory = dirname(started.argv[2]!.slice('--json='.length))
    firstReleaseRefused = false
    await chmod(directory, 0o500)
    const firstRetry = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )
    await chmod(directory, 0o700)
    callsToGroups.splice(0)

    // Act
    const secondRetry = await retries[0]!().then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(firstRetry instanceof Error)
    assert.match(
      firstRetry.message,
      /^The Vitest listing's process group \d+ has ended, but Codebook could not remove its folder .+ \(Error: EACCES/,
    )
    assert.equal(secondRetry, undefined)
    assert.deepEqual(callsToGroups, [])
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  } finally {
    if (directory) await chmod(directory, 0o700).catch(() => undefined)
    await removeKeptListingFolder(vitest)
    await rm(vitest.directory, { recursive: true, force: true })
  }
})

test('cancelling a listing releases a SIGTERM-resistant launcher and its helper before rejecting', async () => {
  // Arrange
  const vitest = await stubVitest(`
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
const helper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
helper.stdout.once('data', () => writeFileSync('ready.json', JSON.stringify({ launcher: process.pid, helper: helper.pid })));
setInterval(() => {}, 1000);
`)
  const cancellation = new AbortController()
  let processes: { launcher: number; helper: number } | undefined
  try {
    // Act
    const listing = listVitestTestFiles({
      node: process.execPath,
      program: vitest.program,
      vitestRoot: vitest.directory,
      filter: 'src/a.test.ts',
      excludes: [],
      signal: cancellation.signal,
    })
    const rejected = assert.rejects(listing, /run cancelled/)
    processes = await waitUntil(
      async () =>
        readFile(join(vitest.directory, 'ready.json'), 'utf8').then(
          (text) => JSON.parse(text) as { launcher: number; helper: number },
          () => undefined,
        ),
      'listing helper readiness',
      5_000,
    )
    cancellation.abort(new Error('run cancelled'))
    await rejected
    // Assert
    for (const pid of [processes.launcher, processes.helper])
      assert.throws(
        () => process.kill(pid, 0),
        { code: 'ESRCH' },
        'rejection must mean the owned process ended',
      )
    const output = (await vitest.started()).argv[2]!.slice('--json='.length)
    await assert.rejects(stat(dirname(output)), { code: 'ENOENT' })
  } finally {
    // A failing negative control still releases only its own synthetic processes.
    cancellation.abort(new Error('run cancelled'))
    if (processes)
      for (const pid of [processes.helper, processes.launcher])
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
    await rm(vitest.directory, { recursive: true, force: true })
  }
})
