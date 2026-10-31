import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  HELP_TEXT,
  productionSeams,
  judgeReview,
  parseReviewLog,
  runQaCandidate,
} from '../qa-candidate.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'
import {
  CANDIDATE_REVIEW_LIMIT_MS,
  cleanReviewAttempt,
  reviewNames,
  runCandidateReview,
} from '../utils/runCandidateReview.mjs'

const HEAD = '0123abcd4567ef890123abcd4567ef890123abcd'
const SHORT = '0123abcd'
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const NOW_MS = Date.parse('2026-11-01T12:00:00.000Z')
const OLD_ATTEMPT = '20261101T100000Z-aaaaaa'
const NEW_ATTEMPT = '20261101T110000Z-bbbbbb'
const SPAWNED_ATTEMPT = '20261101T120000Z-cafe01'
const LIVE_PID = 4242
const DEAD_PID = 4343
const CODEX_PID = 4444

/**
 * Builds a temporary repository folder and every injected effect of the command, so one test reads as one scenario.
 * The file system is real (a temp folder, removed by the caller); the build, git, codex probe, spawner, clock and pid probe are fakes.
 */
async function makeHarness(overrides = {}) {
  const repository = await mkdtemp(join(tmpdir(), 'qa-candidate-'))
  await writeFile(join(repository, 'VERSION'), '0.2.69.0\n')
  const calls = { git: [], build: [], spawn: [] }
  const out = []
  const err = []
  const alivePids = new Set(overrides.alivePids ?? [])
  const seams = {
    repository,
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
    now: () => NOW_MS,
    randomSuffix: () => 'cafe01',
    isPidAlive: (pid) => alivePids.has(pid),
    listChanges: async () => overrides.changes ?? [],
    build: async (root, output) => {
      calls.build.push([root, output])
      if (overrides.buildError) throw overrides.buildError
      await mkdir(join(repository, 'artifacts/qa'), { recursive: true })
      await writeFile(output, 'vsix bytes')
      return {
        output,
        sha256: 'a'.repeat(64),
        bytes: 10,
        entries: 34,
        extension: { version: '0.2.69' },
        build: overrides.buildIdentity ?? { revision: HEAD, dirty: false },
      }
    },
    git: async (args, options) => {
      calls.git.push({ args, timeoutMs: options?.timeoutMs })
      const key = args.join(' ')
      if (overrides.gitFailures?.[key] !== undefined)
        throw new Error(overrides.gitFailures[key])
      if (key === 'rev-parse HEAD') return `${HEAD}\n`
      if (key === 'rev-parse origin/main') return `${BASE}\n`
      if (args[0] === 'rev-parse' && args[1]?.startsWith('qa-base-'))
        throw new Error('unknown revision')
      return ''
    },
    probeCodex: async () => overrides.codexInstalled ?? true,
    spawnRunner: (runnerArguments) => {
      calls.spawn.push(runnerArguments)
      if (overrides.spawnError) throw overrides.spawnError
      return { pid: LIVE_PID }
    },
  }
  return { repository, seams, calls, out, err, alivePids }
}

/** Runs the command like the entry point does and returns the exit code with the printed lines. */
async function runCommand(harness, argv) {
  const exitCode = await runCommandLine(
    (progress) => runQaCandidate(argv, harness.seams, progress),
    { printError: (line) => harness.err.push(line), environment: {} },
  )
  return exitCode
}

/** Writes one attempt's state file (the runner's lines) and an empty review log, both with a modification time `ageMs` before the fixed clock. */
async function writeAttemptLog(repository, attempt, lines, ageMs = 1000) {
  const names = reviewNames(repository, SHORT, attempt)
  await mkdir(join(repository, 'artifacts/qa'), { recursive: true })
  await writeFile(names.state, lines.length ? `${lines.join('\n')}\n` : '')
  await writeFile(names.log, '')
  const time = new Date(NOW_MS - ageMs)
  await utimes(names.state, time, time)
  await utimes(names.log, time, time)
  return names
}

async function readReceipt(repository) {
  return JSON.parse(
    await readFile(
      join(repository, `artifacts/qa/codebook-${SHORT}.json`),
      'utf8',
    ),
  )
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** A fake codex child: emits `close` when a test says so. */
function makeChild() {
  const child = new EventEmitter()
  child.pid = CODEX_PID
  return child
}

/** Builds the runner's injected effects around a log array and a list of git calls. */
function makeRunnerHarness(overrides = {}) {
  const log = []
  const gitCalls = []
  const timers = []
  const ended = []
  const child = makeChild()
  const released = []
  const signalEnds = []
  const seams = {
    pid: 777,
    now: () => new Date(NOW_MS),
    appendState: async (text) => {
      log.push(text)
    },
    git: async (args) => {
      gitCalls.push(args.join(' '))
      if (overrides.gitFailures?.includes(args[0])) throw new Error('git broke')
      if (args[0] === 'rev-parse') return ''
      return ''
    },
    pathExists: async () => true,
    startCodex: (options) => {
      seams.startOptions = options
      if (overrides.startError) throw overrides.startError
      return child
    },
    endTree: async (target) => {
      ended.push(target.pid)
      if (overrides.onEnd) overrides.onEnd(child)
    },
    registerSignalEnd: (end) => {
      signalEnds.push(end)
      return () => released.push(true)
    },
    setTimer: (callback, milliseconds) => {
      timers.push({ callback, milliseconds })
      return timers.length
    },
    clearTimer: () => {},
  }
  return { seams, log, gitCalls, timers, ended, child, released, signalEnds }
}

const RUNNER_OPTIONS = {
  repository: '/work/codebook',
  short: SHORT,
  attempt: NEW_ATTEMPT,
  base: BASE,
}

// protects=--help documents prerequisites, an example, exit codes and error codes; fails_when=help omits the exit-code or error-code list; no_claim=the wording
test('--help prints usage, the example, the exit codes and the error codes and builds nothing', async () => {
  // Arrange
  const harness = await makeHarness()

  // Act
  const exitCode = await runCommand(harness, ['--help'])

  // Assert
  assert.equal(exitCode, 0)
  assert.equal(harness.out.join('\n'), HELP_TEXT.trimEnd())
  assert.match(harness.out[0], /^Usage:/)
  assert.match(HELP_TEXT, /Exit codes: 0 done; 1 refused/)
  assert.match(
    HELP_TEXT,
    /Error codes: E_USAGE, E_DIRTY, E_BUILD, E_CANDIDATE_DIRTY/,
  )
  assert.deepEqual(harness.calls.build, [])
  await rm(harness.repository, { recursive: true })
})

// protects=a bad option is a usage error with its code first and fix last; fails_when=it exits 1/2 or runs a build; no_claim=every usage combination
test('an unknown option exits 64 with E_USAGE and builds nothing', async () => {
  // Arrange
  const harness = await makeHarness()

  // Act
  const exitCode = await runCommand(harness, ['--bogus'])

  // Assert
  assert.equal(exitCode, 64)
  assert.match(harness.err[0], /^E_USAGE: /)
  assert.equal(
    harness.err.at(-1),
    'Fix: node extension/scripts/qa-candidate.mjs --help',
  )
  assert.deepEqual(harness.calls.build, [])
  await rm(harness.repository, { recursive: true })
})

// protects=a candidate is a commit: a changed checkout is refused before any build or write; fails_when=a dirty checkout is built or a receipt appears; no_claim=real git status (listChanges is a fake)
test('a checkout with changes is refused with E_DIRTY, naming the paths, and nothing is built or written', async () => {
  // Arrange
  const harness = await makeHarness({
    changes: [' M extension/src/a.ts', '?? notes.txt'],
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(harness.err, [
    'E_DIRTY: the checkout has changes: extension/src/a.ts, notes.txt',
    'Fix: commit or move the changes, then rerun',
  ])
  assert.deepEqual(harness.calls.build, [])
  assert.equal(await exists(join(harness.repository, 'artifacts')), false)
  await rm(harness.repository, { recursive: true })
})

// protects=the receipt has the documented fields and types for --no-review; fails_when=a field is missing, mistyped or the review is not marked skipped; no_claim=the real build (the builder is a fake returning entries 34)
test('--no-review writes a receipt with head, version, sha256, entries, builtAt and a skipped review, and spawns nothing', async () => {
  // Arrange
  const harness = await makeHarness()

  // Act
  const exitCode = await runCommand(harness, ['--no-review'])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(await readReceipt(harness.repository), {
    head: HEAD,
    version: '0.2.69.0',
    sha256: 'a'.repeat(64),
    entries: 34,
    builtAt: '2026-11-01T12:00:00.000Z',
    review: { state: 'skipped' },
  })
  assert.deepEqual(harness.calls.build, [
    [
      harness.repository,
      join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`),
    ],
  ])
  assert.deepEqual(harness.calls.spawn, [])
  assert.deepEqual(harness.out, [
    `VSIX: ${join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`)}`,
    `SHA-256: ${'a'.repeat(64)}`,
    'Review: skipped (--no-review)',
  ])
  await rm(harness.repository, { recursive: true })
})

// protects=a new review reads the candidate commit through a detached worktree and a base pinned from the fetched origin/main; fails_when=the fetch bound, worktree path, attempt id or runner arguments change; no_claim=a real codex review
test('a new review fetches origin/main within 30 s, adds a detached worktree at HEAD and spawns the runner with the attempt and base', async () => {
  // Arrange
  const harness = await makeHarness()
  const names = reviewNames(harness.repository, SHORT, SPAWNED_ATTEMPT)

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(harness.calls.git, [
    { args: ['rev-parse', 'HEAD'], timeoutMs: undefined },
    { args: ['fetch', 'origin', 'main'], timeoutMs: 30000 },
    { args: ['rev-parse', 'origin/main'], timeoutMs: undefined },
    {
      args: ['worktree', 'add', '--detach', names.worktree, HEAD],
      timeoutMs: undefined,
    },
  ])
  assert.deepEqual(harness.calls.spawn, [
    [
      '--repository',
      harness.repository,
      '--short',
      SHORT,
      '--attempt',
      SPAWNED_ATTEMPT,
      '--base',
      BASE,
    ],
  ])
  assert.equal(
    names.worktree,
    join(harness.repository, `artifacts/qa/review-${SHORT}-${SPAWNED_ATTEMPT}`),
  )
  assert.equal(
    names.log,
    join(
      harness.repository,
      `artifacts/qa/codebook-${SHORT}-${SPAWNED_ATTEMPT}-codex-review.txt`,
    ),
  )
  assert.equal(names.branch, `qa-base-${SHORT}-${SPAWNED_ATTEMPT}`)
  assert.deepEqual((await readReceipt(harness.repository)).review, {
    state: 'started',
    attempt: SPAWNED_ATTEMPT,
    base: BASE,
    pid: LIVE_PID,
    log: names.log,
    stateFile: names.state,
    worktree: names.worktree,
  })
  assert.equal(harness.out.at(-1), `Review log: ${names.log}`)
  await rm(harness.repository, { recursive: true })
})

// protects=a review that still runs is not started twice; fails_when=a live pid with no exit line and a fresh log spawns a second review; no_claim=real pids (the probe is a fake)
test('a review whose runner is alive, has no exit line and a fresh log is reported running and no second review starts', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID] })
  const names = await writeAttemptLog(harness.repository, NEW_ATTEMPT, [
    `CODEX_REVIEW_PID ${LIVE_PID}`,
    `CODEX_REVIEW_CHILD ${CODEX_PID}`,
    'reviewing...',
  ])
  await mkdir(names.worktree, { recursive: true })
  harness.seams.git = async (args) =>
    args.join(' ') === 'rev-parse HEAD'
      ? `${HEAD}\n`
      : args.join(' ') === `rev-parse ${names.branch}`
        ? `${BASE}\n`
        : ''

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(harness.calls.spawn, [])
  assert.deepEqual((await readReceipt(harness.repository)).review, {
    state: 'running',
    attempt: NEW_ATTEMPT,
    pid: LIVE_PID,
    log: names.log,
    stateFile: names.state,
    worktree: names.worktree,
    base: BASE,
  })
  assert.equal(await exists(names.worktree), true)
  await rm(harness.repository, { recursive: true })
})

// protects=an interrupted review (dead runner, no exit line) is replaced by a new one and its leftovers stay for --clean; fails_when=no new review starts or the old worktree/log is touched; no_claim=that --clean later removes them (own test)
test('a log with a dead runner and no exit line starts a new review and leaves the old attempt alone', async () => {
  // Arrange
  const harness = await makeHarness()
  const old = await writeAttemptLog(harness.repository, OLD_ATTEMPT, [
    `CODEX_REVIEW_PID ${DEAD_PID}`,
  ])
  await mkdir(old.worktree, { recursive: true })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.equal(harness.calls.spawn.length, 1)
  assert.equal(
    (await readReceipt(harness.repository)).review.attempt,
    SPAWNED_ATTEMPT,
  )
  assert.equal(await exists(old.worktree), true)
  assert.equal(
    await readFile(old.state, 'utf8'),
    `CODEX_REVIEW_PID ${DEAD_PID}\n`,
  )
  assert.equal(
    harness.calls.git.some((call) => call.args.includes(old.branch)),
    false,
  )
  await rm(harness.repository, { recursive: true })
})

// protects=a live pid in a stale log is a recycled pid, not a review; fails_when=a log older than the limit plus 5 minutes still counts as running; no_claim=the real clock (injected)
test('a log last written 36 minutes ago with a live pid counts as interrupted and a new review starts', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID] })
  await writeAttemptLog(
    harness.repository,
    OLD_ATTEMPT,
    [`CODEX_REVIEW_PID ${LIVE_PID}`],
    36 * 60 * 1000,
  )

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.equal(harness.calls.spawn.length, 1)
  assert.equal((await readReceipt(harness.repository)).review.state, 'started')
  await rm(harness.repository, { recursive: true })
})

// protects=an empty log is judged by the pid the previous receipt recorded; fails_when=an empty log of a live runner starts a second review; no_claim=none beyond protects
test('an empty log whose runner pid the old receipt recorded alive counts as running', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID] })
  const names = await writeAttemptLog(harness.repository, NEW_ATTEMPT, [])
  await writeFile(
    join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
    JSON.stringify({
      review: {
        state: 'started',
        attempt: NEW_ATTEMPT,
        pid: LIVE_PID,
        base: BASE,
        log: names.log,
        stateFile: names.state,
      },
    }),
  )

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(harness.calls.spawn, [])
  assert.deepEqual((await readReceipt(harness.repository)).review, {
    state: 'running',
    attempt: NEW_ATTEMPT,
    pid: LIVE_PID,
    log: names.log,
    stateFile: names.state,
    worktree: names.worktree,
    base: BASE,
  })
  await rm(harness.repository, { recursive: true })
})

// protects=a PID-only log is judged like any other (alive: running, dead: interrupted); fails_when=a PID-only log is treated as finished; no_claim=none beyond protects
test('a log holding only the PID line is running while the pid lives and interrupted once it is gone', () => {
  // Arrange
  const text = `CODEX_REVIEW_PID ${LIVE_PID}\n`
  const base = { text, mtimeMs: NOW_MS - 1000, nowMs: NOW_MS }

  // Act
  const alive = judgeReview({ ...base, isPidAlive: () => true })
  const gone = judgeReview({ ...base, isPidAlive: () => false })

  // Assert
  assert.equal(alive.text, 'running')
  assert.equal(gone.text, 'interrupted')
})

// protects=each reason a review cannot start is named on the last line and exits 3 while the candidate stands; fails_when=exit is 0/2, the line differs or the receipt is lost; no_claim=real codex/git failures
for (const scenario of [
  {
    name: 'codex is not installed',
    overrides: { codexInstalled: false },
    reason: 'codex is not installed or not on PATH',
  },
  {
    name: 'the fetch of origin/main fails',
    overrides: { gitFailures: { 'fetch origin main': 'network down' } },
    reason: 'could not fetch origin/main: network down',
  },
  {
    name: 'the worktree cannot be created',
    overrides: {},
    reason: 'could not create the review worktree: disk full',
    worktreeFailure: 'disk full',
  },
  {
    name: 'the runner cannot be spawned',
    overrides: { spawnError: new Error('EAGAIN') },
    reason: 'could not start the review runner: EAGAIN',
  },
]) {
  test(`when ${scenario.name} the candidate stands, the receipt says not-started and the command exits 3 with the NOT STARTED line last`, async () => {
    // Arrange
    const harness = await makeHarness(scenario.overrides)
    if (scenario.worktreeFailure) {
      const original = harness.seams.git
      harness.seams.git = async (args, options) => {
        if (args[0] === 'worktree' && args[1] === 'add')
          throw new Error(scenario.worktreeFailure)
        return original(args, options)
      }
    }

    // Act
    const exitCode = await runCommand(harness, [])

    // Assert
    assert.equal(exitCode, 3)
    assert.equal(
      harness.out.at(-1),
      `codex review NOT STARTED: ${scenario.reason}`,
    )
    assert.deepEqual((await readReceipt(harness.repository)).review, {
      state: 'not-started',
      reason: scenario.reason,
    })
    assert.equal(
      await exists(
        join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`),
      ),
      true,
    )
    await rm(harness.repository, { recursive: true })
  })
}

// protects=a failed build leaves no receipt, not even the old one; fails_when=the old receipt survives or the code is not E_BUILD/2; no_claim=real build failures
test('a build failure exits 2 with E_BUILD and removes the receipt left for the same HEAD', async () => {
  // Arrange
  const harness = await makeHarness({ buildError: new Error('tsc failed') })
  await mkdir(join(harness.repository, 'artifacts/qa'), { recursive: true })
  await writeFile(
    join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
    '{"old":true}',
  )

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 2)
  assert.equal(harness.err[0], 'E_BUILD: tsc failed')
  assert.equal(harness.err.at(-1), 'Fix: fix the build error above, then rerun')
  assert.equal(
    await exists(
      join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
    ),
    false,
  )
  assert.deepEqual(harness.calls.spawn, [])
  await rm(harness.repository, { recursive: true })
})

// protects=a build that reports dirty is no candidate; fails_when=a receipt or review is written for a dirty build or the VSIX stays; no_claim=readBuildIdentity itself
test('a build identity that says dirty exits 2 with E_CANDIDATE_DIRTY, deletes the VSIX and writes no receipt', async () => {
  // Arrange
  const harness = await makeHarness({
    buildIdentity: { revision: HEAD, dirty: true },
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 2)
  assert.match(harness.err[0], /^E_CANDIDATE_DIRTY: /)
  assert.equal(harness.err.at(-1), 'Fix: commit the change, then rerun')
  assert.deepEqual(await readdir(join(harness.repository, 'artifacts/qa')), [])
  assert.deepEqual(harness.calls.spawn, [])
  await rm(harness.repository, { recursive: true })
})

// protects=a build of another revision than the starting HEAD is no candidate; fails_when=a moved HEAD yields a receipt; no_claim=none beyond protects
test('a build identity that names another revision exits 2 with E_CANDIDATE_DIRTY, deletes the VSIX and writes no receipt', async () => {
  // Arrange
  const harness = await makeHarness({
    buildIdentity: { revision: 'f'.repeat(40), dirty: false },
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 2)
  assert.match(harness.err[0], /^E_CANDIDATE_DIRTY: /)
  assert.deepEqual(await readdir(join(harness.repository, 'artifacts/qa')), [])
  assert.deepEqual(harness.calls.spawn, [])
  await rm(harness.repository, { recursive: true })
})

// protects=--status shows each review state from the log without building; fails_when=a state prints another text or --status builds/spawns; no_claim=the receipt's other fields
for (const scenario of [
  {
    name: 'running',
    lines: [`CODEX_REVIEW_PID ${LIVE_PID}`],
    alive: [LIVE_PID],
    expected: 'running',
  },
  {
    name: 'exited',
    lines: [
      `CODEX_REVIEW_PID ${LIVE_PID}`,
      'CODEX_REVIEW_EXIT 0 2026-11-01T11:30:00.000Z',
    ],
    expected: 'exited 0 2026-11-01T11:30:00.000Z',
  },
  {
    name: 'timeout',
    lines: [
      `CODEX_REVIEW_PID ${LIVE_PID}`,
      'CODEX_REVIEW_EXIT timeout 2026-11-01T11:30:00.000Z',
    ],
    expected: 'timeout 2026-11-01T11:30:00.000Z',
  },
  {
    name: 'error',
    lines: [
      `CODEX_REVIEW_PID ${LIVE_PID}`,
      'CODEX_REVIEW_EXIT error spawn codex ENOENT 2026-11-01T11:30:00.000Z',
    ],
    expected: 'error spawn codex ENOENT 2026-11-01T11:30:00.000Z',
  },
  {
    name: 'interrupted',
    lines: [`CODEX_REVIEW_PID ${DEAD_PID}`],
    expected: 'interrupted',
  },
]) {
  test(`--status reports the ${scenario.name} review state from the log`, async () => {
    // Arrange
    const harness = await makeHarness({ alivePids: scenario.alive ?? [] })
    const names = await writeAttemptLog(
      harness.repository,
      NEW_ATTEMPT,
      scenario.lines,
    )
    await writeFile(
      join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
      JSON.stringify({
        head: HEAD,
        version: '0.2.69.0',
        sha256: 'a'.repeat(64),
        entries: 34,
        builtAt: '2026-11-01T11:00:00.000Z',
        review: {
          state: 'started',
          attempt: NEW_ATTEMPT,
          base: BASE,
          pid: LIVE_PID,
          log: names.log,
          stateFile: names.state,
          worktree: names.worktree,
        },
      }),
    )

    // Act
    const exitCode = await runCommand(harness, ['--status'])

    // Assert
    assert.equal(exitCode, 0)
    assert.ok(
      harness.out.includes(`Review: ${scenario.expected}`),
      harness.out.join('\n'),
    )
    assert.deepEqual(harness.calls.build, [])
    assert.deepEqual(harness.calls.spawn, [])
    await rm(harness.repository, { recursive: true })
  })
}

// protects=--status prints not-started with its reason and skipped; fails_when=the reason is lost; no_claim=none beyond protects
test('--status <short> prints the not-started reason and the skipped state from the receipt', async () => {
  // Arrange
  const harness = await makeHarness()
  await mkdir(join(harness.repository, 'artifacts/qa'), { recursive: true })
  const receiptPath = join(
    harness.repository,
    `artifacts/qa/codebook-${SHORT}.json`,
  )
  const base = {
    head: HEAD,
    version: '0.2.69.0',
    sha256: 'b'.repeat(64),
    entries: 34,
    builtAt: '2026-11-01T11:00:00.000Z',
  }
  await writeFile(
    receiptPath,
    JSON.stringify({
      ...base,
      review: {
        state: 'not-started',
        reason: 'codex is not installed or not on PATH',
      },
    }),
  )

  // Act
  await runCommand(harness, ['--status', SHORT])
  await writeFile(
    receiptPath,
    JSON.stringify({ ...base, review: { state: 'skipped' } }),
  )
  await runCommand(harness, ['--status', SHORT])

  // Assert
  assert.ok(
    harness.out.includes(
      'Review: not-started codex is not installed or not on PATH',
    ),
  )
  assert.ok(harness.out.includes('Review: skipped'))
  await rm(harness.repository, { recursive: true })
})

// protects=--status of a commit with no candidate is a refusal; fails_when=it prints nothing or exits 0; no_claim=none beyond protects
test('--status for a commit without a receipt exits 1 with E_NO_CANDIDATE', async () => {
  // Arrange
  const harness = await makeHarness()

  // Act
  const exitCode = await runCommand(harness, ['--status'])

  // Assert
  assert.equal(exitCode, 1)
  assert.equal(harness.err[0], `E_NO_CANDIDATE: no receipt for ${SHORT}`)
  assert.equal(
    harness.err.at(-1),
    'Fix: node extension/scripts/qa-candidate.mjs',
  )
  await rm(harness.repository, { recursive: true })
})

// protects=--clean removes only attempts that finished and whose processes are gone, and names why it kept the others; fails_when=a running review, a live codex or an exit-less log loses its worktree; no_claim=real worktrees (git is a fake)
test('--clean removes a finished attempt and keeps a running review, a runner that died leaving codex alive and an exit-less log, each with its reason', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID, CODEX_PID] })
  const finished = await writeAttemptLog(
    harness.repository,
    '20261101T090000Z-111111',
    [
      `CODEX_REVIEW_PID ${DEAD_PID}`,
      `CODEX_REVIEW_CHILD ${DEAD_PID}`,
      'CODEX_REVIEW_EXIT 0 2026-11-01T09:10:00.000Z',
    ],
  )
  const running = await writeAttemptLog(
    harness.repository,
    '20261101T100000Z-222222',
    [`CODEX_REVIEW_PID ${LIVE_PID}`],
  )
  const orphan = await writeAttemptLog(
    harness.repository,
    '20261101T110000Z-333333',
    [
      `CODEX_REVIEW_PID ${DEAD_PID}`,
      `CODEX_REVIEW_CHILD ${CODEX_PID}`,
      'CODEX_REVIEW_EXIT error terminated by a signal 2026-11-01T11:10:00.000Z',
    ],
  )
  const interrupted = await writeAttemptLog(
    harness.repository,
    '20261101T113000Z-444444',
    [`CODEX_REVIEW_PID ${DEAD_PID}`],
  )
  for (const names of [finished, running, orphan, interrupted])
    await mkdir(names.worktree, { recursive: true })

  // Act
  const exitCode = await runCommand(harness, ['--clean'])

  // Assert
  assert.equal(exitCode, 0)
  assert.equal(harness.out[0], `removed ${SHORT} 20261101T090000Z-111111`)
  assert.match(
    harness.out[1],
    new RegExp(`^kept ${SHORT} 20261101T100000Z-222222: no exit line`),
  )
  assert.equal(
    harness.out[2],
    `kept ${SHORT} 20261101T110000Z-333333: codex pid ${CODEX_PID} is still running`,
  )
  assert.match(
    harness.out[3],
    new RegExp(`^kept ${SHORT} 20261101T113000Z-444444: no exit line`),
  )
  const gitText = harness.calls.git.map((call) => call.args.join(' '))
  assert.deepEqual(gitText, [
    `worktree remove --force ${finished.worktree}`,
    'worktree prune',
    `rev-parse --verify --quiet refs/heads/${finished.branch}`,
    `branch -D ${finished.branch}`,
  ])
  assert.equal(
    gitText.some((line) => line.includes(running.worktree)),
    false,
  )
  assert.equal(
    gitText.some((line) => line.includes(orphan.worktree)),
    false,
  )
  assert.equal(
    gitText.some((line) => line.includes(interrupted.worktree)),
    false,
  )
  assert.match(
    await readFile(finished.state, 'utf8'),
    /CODEX_REVIEW_CLEANED\n$/,
  )
  await rm(harness.repository, { recursive: true })
})

// protects=an old attempt's cleanup after a newer attempt started touches only its own names; fails_when=--clean passes the newer attempt's worktree or branch to git; no_claim=real git
test('--clean of an old finished attempt never names the newer running attempt of the same commit', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID] })
  const old = await writeAttemptLog(harness.repository, OLD_ATTEMPT, [
    `CODEX_REVIEW_PID ${DEAD_PID}`,
    'CODEX_REVIEW_EXIT 1 2026-11-01T10:10:00.000Z',
  ])
  const current = await writeAttemptLog(harness.repository, NEW_ATTEMPT, [
    `CODEX_REVIEW_PID ${LIVE_PID}`,
  ])
  await mkdir(old.worktree, { recursive: true })
  await mkdir(current.worktree, { recursive: true })
  harness.seams.git = async (args) => {
    harness.calls.git.push({ args })
    if (args[0] === 'rev-parse') return ''
    return ''
  }

  // Act
  await runCommand(harness, ['--clean'])

  // Assert
  const gitText = harness.calls.git
    .map((call) => call.args.join(' '))
    .join('\n')
  assert.ok(gitText.includes(old.worktree))
  assert.ok(gitText.includes(old.branch))
  assert.equal(gitText.includes(current.worktree), false)
  assert.equal(gitText.includes(current.branch), false)
  assert.notEqual(old.branch, current.branch)
  assert.notEqual(old.worktree, current.worktree)
  assert.notEqual(old.log, current.log)
  await rm(harness.repository, { recursive: true })
})

// protects=the log format is parsed the same with a BOM and CRLF line ends; fails_when=a BOM or CR hides the pid or the exit line; no_claim=none beyond protects
test('a log with a byte order mark and CRLF line ends still yields its pids and exit line', () => {
  // Arrange
  const text =
    '﻿CODEX_REVIEW_PID 12\r\nCODEX_REVIEW_CHILD 34\r\nnoise\r\nCODEX_REVIEW_EXIT 2 2026-11-01T10:00:00.000Z\r\nCODEX_REVIEW_CLEANED\r\n'

  // Act
  const facts = parseReviewLog(text)

  // Assert
  assert.deepEqual(facts, {
    runnerPid: 12,
    codexPid: 34,
    exit: { kind: 'exited', text: '2 2026-11-01T10:00:00.000Z' },
    cleaned: true,
  })
})

// protects=the runner records pid, child, exit code with its time, then removes worktree and branch and says CLEANED; fails_when=a line is missing/out of order or cleanup is skipped; no_claim=real codex output
test('the runner logs the pids, the exit code and time, removes the worktree and the branch, then logs CODEX_REVIEW_CLEANED', async () => {
  // Arrange
  const runner = makeRunnerHarness()
  const names = reviewNames(RUNNER_OPTIONS.repository, SHORT, NEW_ATTEMPT)

  // Act
  const finished = runCandidateReview(RUNNER_OPTIONS, runner.seams)
  await waitFor(() => runner.log.length >= 2)
  runner.child.emit('close', 0, null)
  await finished

  // Assert
  assert.deepEqual(runner.log, [
    'CODEX_REVIEW_PID 777\n',
    `CODEX_REVIEW_CHILD ${CODEX_PID}\n`,
    'CODEX_REVIEW_EXIT 0 2026-11-01T12:00:00.000Z\n',
    'CODEX_REVIEW_CLEANED\n',
  ])
  assert.deepEqual(runner.gitCalls, [
    `branch -f ${names.branch} ${BASE}`,
    `worktree remove --force ${names.worktree}`,
    'worktree prune',
    `rev-parse --verify --quiet refs/heads/${names.branch}`,
    `branch -D ${names.branch}`,
  ])
  assert.deepEqual(runner.seams.startOptions, {
    cwd: names.worktree,
    args: ['review', '--base', `qa-base-${SHORT}-${NEW_ATTEMPT}`],
  })
  assert.equal(runner.timers[0].milliseconds, 30 * 60 * 1000)
  assert.equal(CANDIDATE_REVIEW_LIMIT_MS, 1800000)
  assert.deepEqual(runner.released, [true])
})

// protects=a review past the limit is ended as a whole tree and recorded as timeout; fails_when=the tree is not ended, the line says a code or cleanup is skipped; no_claim=real waiting (the timer is fake)
test("when the 30-minute timer fires the runner ends codex's tree and logs CODEX_REVIEW_EXIT timeout", async () => {
  // Arrange
  const runner = makeRunnerHarness()

  // Act
  const finished = runCandidateReview(RUNNER_OPTIONS, runner.seams)
  await waitFor(() => runner.timers.length === 1)
  await runner.timers[0].callback()
  await finished

  // Assert
  assert.deepEqual(runner.ended, [CODEX_PID])
  assert.equal(
    runner.log[2],
    'CODEX_REVIEW_EXIT timeout 2026-11-01T12:00:00.000Z\n',
  )
  assert.equal(runner.log.at(-1), 'CODEX_REVIEW_CLEANED\n')
})

// protects=a runner exception is recorded as an error exit line and cleanup still runs; fails_when=the exception escapes without a line or the worktree stays; no_claim=which real failures occur
test('when the branch reset fails the runner logs CODEX_REVIEW_EXIT error with the message and still cleans up', async () => {
  // Arrange
  const runner = makeRunnerHarness({ gitFailures: ['branch'] })

  // Act
  await runCandidateReview(RUNNER_OPTIONS, runner.seams)

  // Assert
  assert.equal(runner.log[0], 'CODEX_REVIEW_PID 777\n')
  assert.equal(
    runner.log[1],
    'CODEX_REVIEW_EXIT error git broke 2026-11-01T12:00:00.000Z\n',
  )
  assert.match(runner.log.at(-1), /^CODEX_REVIEW_CLEANUP_FAILED /)
  assert.ok(
    runner.gitCalls.some((call) => call.startsWith('worktree remove --force')),
  )
})

// protects=a codex that cannot start is an error line; fails_when=a spawn error leaves no exit line; no_claim=none beyond protects
test('when codex cannot be started the runner logs an error exit line and cleans the worktree', async () => {
  // Arrange
  const runner = makeRunnerHarness({
    startError: new Error('spawn codex ENOENT'),
  })

  // Act
  await runCandidateReview(RUNNER_OPTIONS, runner.seams)

  // Assert
  assert.equal(
    runner.log[1],
    'CODEX_REVIEW_EXIT error spawn codex ENOENT 2026-11-01T12:00:00.000Z\n',
  )
  assert.equal(runner.log.at(-1), 'CODEX_REVIEW_CLEANED\n')
})

// protects=a signal to the runner ends codex's tree and records why; fails_when=the tree is left running or no exit line is written so --clean could never remove the attempt; no_claim=real signals (the handler is captured)
test("a signal to the runner ends codex's tree, logs an error exit line and leaves the worktree and branch for --clean", async () => {
  // Arrange
  const runner = makeRunnerHarness({
    onEnd: (child) =>
      queueMicrotask(() => child.emit('close', null, 'SIGKILL')),
  })

  // Act
  const finished = runCandidateReview(RUNNER_OPTIONS, runner.seams)
  await waitFor(() => runner.signalEnds.length === 1)
  await runner.signalEnds[0]()
  await finished

  // Assert
  assert.deepEqual(runner.ended, [CODEX_PID])
  assert.deepEqual(runner.log, [
    'CODEX_REVIEW_PID 777\n',
    `CODEX_REVIEW_CHILD ${CODEX_PID}\n`,
    'CODEX_REVIEW_EXIT error terminated by a signal 2026-11-01T12:00:00.000Z\n',
  ])
  assert.deepEqual(runner.gitCalls, [
    `branch -f qa-base-${SHORT}-${NEW_ATTEMPT} ${BASE}`,
  ])
})

// protects=git branch -f resets a branch an interrupted run left behind; fails_when=the runner creates the branch without -f; no_claim=real git
test('the runner resets the attempt branch with git branch -f to the recorded base sha', async () => {
  // Arrange
  const runner = makeRunnerHarness()

  // Act
  const finished = runCandidateReview(RUNNER_OPTIONS, runner.seams)
  await waitFor(() => runner.log.length >= 2)
  runner.child.emit('close', 0, null)
  await finished

  // Assert
  assert.equal(
    runner.gitCalls[0],
    `branch -f qa-base-${SHORT}-${NEW_ATTEMPT} ${BASE}`,
  )
})

// protects=cleanup tolerates a worktree or branch that is already gone; fails_when=a missing branch or path is reported as a failure; no_claim=real git
test('cleaning an attempt whose worktree and branch are already gone runs no removal and reports no failure', async () => {
  // Arrange
  const calls = []
  const git = async (args) => {
    calls.push(args.join(' '))
    if (args[0] === 'rev-parse') throw new Error('no such branch')
    return ''
  }

  // Act
  const failures = await cleanReviewAttempt(
    { worktree: '/w/review', branch: 'qa-base-x' },
    { git, pathExists: async () => false },
  )

  // Assert
  assert.deepEqual(failures, [])
  assert.deepEqual(calls, [
    'worktree prune',
    'rev-parse --verify --quiet refs/heads/qa-base-x',
  ])
})

// protects=codex output or a reviewed fixture printing state-looking lines cannot change the judged state; fails_when=a fake EXIT line in the review log makes a running review look finished or a fake PID line replaces the runner pid; no_claim=the real runner (the state file is written by hand here)
test('state-looking lines in the review log do not change the judged state, --status, the no-second-review rule or --clean', async () => {
  // Arrange
  const harness = await makeHarness({ alivePids: [LIVE_PID] })
  const names = await writeAttemptLog(harness.repository, NEW_ATTEMPT, [
    `CODEX_REVIEW_PID ${LIVE_PID}`,
  ])
  await writeFile(
    names.log,
    'CODEX_REVIEW_PID 1\nCODEX_REVIEW_EXIT 0 2026-11-01T11:59:00.000Z\nCODEX_REVIEW_CLEANED\n',
  )
  await writeFile(
    join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
    JSON.stringify({
      head: HEAD,
      version: '0.2.69.0',
      sha256: 'a'.repeat(64),
      entries: 34,
      builtAt: '2026-11-01T11:00:00.000Z',
      review: {
        state: 'started',
        attempt: NEW_ATTEMPT,
        base: BASE,
        pid: LIVE_PID,
        log: names.log,
        stateFile: names.state,
        worktree: names.worktree,
      },
    }),
  )

  // Act
  const statusExit = await runCommand(harness, ['--status'])
  const statusLines = [...harness.out]
  harness.out.length = 0
  const cleanExit = await runCommand(harness, ['--clean'])
  const cleanLines = [...harness.out]
  harness.out.length = 0
  const buildExit = await runCommand(harness, [])

  // Assert
  assert.equal(statusExit, 0)
  assert.ok(statusLines.includes('Review: running'), statusLines.join('\n'))
  assert.ok(statusLines.includes(`Review state: ${names.state}`))
  assert.equal(cleanExit, 0)
  assert.equal(cleanLines.length, 1)
  assert.match(cleanLines[0], /^kept .*: no exit line in the state file/)
  assert.equal(buildExit, 0)
  assert.deepEqual(harness.calls.spawn, [])
  assert.equal((await readReceipt(harness.repository)).review.state, 'running')
  await rm(harness.repository, { recursive: true })
})

// protects=the runner's state file and codex's log are different files; fails_when=the state path equals the log path; no_claim=the real file writes
test('the review log and the review state file of an attempt are different files', () => {
  // Arrange
  const names = reviewNames('/work/codebook', SHORT, NEW_ATTEMPT)

  // Act
  const { log, state } = names

  // Assert
  assert.equal(
    state,
    `/work/codebook/artifacts/qa/codebook-${SHORT}-${NEW_ATTEMPT}-review-state.txt`,
  )
  assert.notEqual(state, log)
})

// protects=an asynchronous spawn failure becomes an error exit line and cleanup, not an unhandled crash; fails_when=the error listener is attached only after an await, so the runner crashes with no exit line; no_claim=real spawn
test('an asynchronous spawn error is logged as an error exit line and the worktree is cleaned', async () => {
  // Arrange
  const runner = makeRunnerHarness()
  const startCodex = runner.seams.startCodex
  runner.seams.startCodex = (options) => {
    const child = startCodex(options)
    // The error arrives on a later turn, while the CHILD line is still being written.
    setImmediate(() => child.emit('error', new Error('spawn codex EACCES')))
    return child
  }
  const append = runner.seams.appendState
  runner.seams.appendState = async (text) => {
    await append(text)
    if (text.startsWith('CODEX_REVIEW_CHILD'))
      await new Promise((resolve) => setTimeout(resolve, 20))
  }

  // Act
  await runCandidateReview(RUNNER_OPTIONS, runner.seams)

  // Assert
  assert.deepEqual(runner.log, [
    'CODEX_REVIEW_PID 777\n',
    `CODEX_REVIEW_CHILD ${CODEX_PID}\n`,
    'CODEX_REVIEW_EXIT error spawn codex EACCES 2026-11-01T12:00:00.000Z\n',
    'CODEX_REVIEW_CLEANED\n',
  ])
})

// protects=a codex that closes before the CHILD line is written still yields its real exit code; fails_when=the close listener is attached after the await, so the review waits for the 30-minute timer and records timeout; no_claim=real processes
test('a codex that closes before the CHILD line is written is logged with its real exit code, not timeout', async () => {
  // Arrange
  const runner = makeRunnerHarness()
  const append = runner.seams.appendState
  runner.seams.appendState = async (text) => {
    await append(text)
    if (text.startsWith('CODEX_REVIEW_CHILD'))
      runner.child.emit('close', 3, null)
  }

  // Act
  await runCandidateReview(RUNNER_OPTIONS, runner.seams)

  // Assert
  assert.deepEqual(runner.log, [
    'CODEX_REVIEW_PID 777\n',
    `CODEX_REVIEW_CHILD ${CODEX_PID}\n`,
    'CODEX_REVIEW_EXIT 3 2026-11-01T12:00:00.000Z\n',
    'CODEX_REVIEW_CLEANED\n',
  ])
})

// protects=a timeout is recorded as timeout even when ending the tree makes codex emit close before the end resolves (Windows taskkill); fails_when=the close with the kill code wins and the line says an exit code; no_claim=a real taskkill (the fake endTree emits close itself)
test('a codex that closes while its tree is being ended at the limit is still logged as timeout', async () => {
  // Arrange
  const runner = makeRunnerHarness({
    onEnd: (child) => child.emit('close', 1, null),
  })

  // Act
  const finished = runCandidateReview(RUNNER_OPTIONS, runner.seams)
  await waitFor(() => runner.timers.length === 1)
  await runner.timers[0].callback()
  await finished

  // Assert
  assert.equal(
    runner.log[2],
    'CODEX_REVIEW_EXIT timeout 2026-11-01T12:00:00.000Z\n',
  )
})

// protects=a runner whose spawn fails asynchronously exits 3 with the NOT STARTED line instead of crashing the command; fails_when=the detached child has no error listener, so its error event is an uncaught exception; no_claim=a real spawn (a fake spawn returns a child with no pid that emits error on a later turn)
test('an asynchronous runner spawn failure is reported as a review that did not start, not an uncaught error', async () => {
  // Arrange
  const harness = await makeHarness()
  const fakeSpawn = () => {
    const child = new EventEmitter()
    child.pid = undefined
    child.unref = () => {}
    setImmediate(() => child.emit('error', new Error('spawn EAGAIN')))
    return child
  }
  harness.seams.spawnRunner = productionSeams(
    harness.repository,
    fakeSpawn,
  ).spawnRunner
  let uncaught = 0
  const onUncaught = () => {
    uncaught += 1
  }
  process.once('uncaughtException', onUncaught)

  // Act
  const exitCode = await runCommand(harness, [])
  await new Promise((resolve) => setImmediate(resolve))
  process.off('uncaughtException', onUncaught)

  // Assert
  assert.equal(exitCode, 3)
  assert.equal(uncaught, 0)
  assert.equal(
    harness.out.at(-1),
    'codex review NOT STARTED: could not start the review runner: the runner has no pid',
  )
  await rm(harness.repository, { recursive: true })
})

/** Waits (by yielding to the event loop, not by time) until a condition holds. */
async function waitFor(condition) {
  for (let turn = 0; turn < 1000 && !condition(); turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
  assert.ok(condition(), 'condition never became true')
}
