import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

import { HELP_TEXT, productionSeams, runQaBuild } from '../qa-build.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'
import { packageGitOptions } from '../utils/packageGitOptions.mjs'

const HEAD = '0123abcd4567ef890123abcd4567ef890123abcd'
const SHORT = '0123abcd'
const NOW_MS = Date.parse('2026-11-01T12:00:00.000Z')

/**
 * Builds a temporary repository folder and every injected effect of the command, so one test reads as one scenario.
 * The file system is real (a temp folder, removed after the test whether it passes or fails); the build, git, change listing and clock are fakes.
 * @param {import('node:test').TestContext} t - The running test, which removes the temp folder afterwards.
 * @param {{ changes?: string[], buildError?: Error, buildIdentity?: object }} [overrides] - What the fakes answer.
 */
async function makeHarness(t, overrides = {}) {
  const repository = await mkdtemp(join(tmpdir(), 'qa-build-'))
  t.after(() => rm(repository, { recursive: true, force: true }))
  await writeFile(join(repository, 'VERSION'), '0.2.69.0\n')
  const calls = { git: [], build: [] }
  const out = []
  const err = []
  const seams = {
    repository,
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
    now: () => NOW_MS,
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
    git: async (args) => {
      calls.git.push(args)
      if (args.join(' ') === 'rev-parse HEAD') return `${HEAD}\n`
      return ''
    },
  }
  return { repository, seams, calls, out, err }
}

/** Runs the command like the entry point does and returns the exit code with the printed lines. */
async function runCommand(harness, argv) {
  const exitCode = await runCommandLine(
    (progress) => runQaBuild(argv, harness.seams, progress),
    { printError: (line) => harness.err.push(line), environment: {} },
  )
  return exitCode
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

// protects=--help documents prerequisites, an example, exit codes and error codes; fails_when=help omits the exit-code or error-code list; no_claim=the wording
test('--help prints usage, the example, the exit codes and the error codes and builds nothing', async (t) => {
  // Arrange
  const harness = await makeHarness(t)

  // Act
  const exitCode = await runCommand(harness, ['--help'])

  // Assert
  assert.equal(exitCode, 0)
  assert.equal(harness.out.join('\n'), HELP_TEXT.trimEnd())
  assert.match(harness.out[0], /^Usage:/)
  assert.match(HELP_TEXT, /Exit codes: 0 done; 1 refused/)
  assert.match(
    HELP_TEXT,
    /Error codes: E_USAGE, E_DIRTY, E_BUILD, E_BUILD_DIRTY/,
  )
  assert.deepEqual(harness.calls.build, [])
})

// protects=a bad option, and each option the retired background review had (--no-review, --clean), is a usage error with its code first and fix last; fails_when=it exits 1/2 or runs a build; no_claim=every usage combination
for (const option of ['--bogus', '--no-review', '--clean']) {
  test(`the unknown option ${option} exits 64 with E_USAGE and builds nothing`, async (t) => {
    // Arrange
    const harness = await makeHarness(t)

    // Act
    const exitCode = await runCommand(harness, [option])

    // Assert
    assert.equal(exitCode, 64)
    assert.match(harness.err[0], /^E_USAGE: /)
    assert.equal(
      harness.err.at(-1),
      'Fix: node extension/scripts/qa-build.mjs --help',
    )
    assert.deepEqual(harness.calls.build, [])
  })
}

// protects=--status names one commit: a second argument is a usage error with its code first and fix last, and nothing is read or built; fails_when=the second argument is ignored and a receipt of the first is printed, or the exit code is 1/2; no_claim=every usage combination
test('--status with two commits exits 64 with E_USAGE and reads nothing', async (t) => {
  // Arrange
  const harness = await makeHarness(t)

  // Act
  const exitCode = await runCommand(harness, ['--status', SHORT, 'f'.repeat(8)])

  // Assert
  assert.equal(exitCode, 64)
  assert.deepEqual(harness.err, [
    'E_USAGE: --status takes at most one <short>',
    'Fix: node extension/scripts/qa-build.mjs --help',
  ])
  assert.deepEqual(harness.out, [])
  assert.deepEqual(harness.calls.git, [])
  assert.deepEqual(harness.calls.build, [])
})

// protects=--status takes exactly the first 8 lower-case hex characters of a commit: a shorter, longer, upper-case or non-hex value (also a full 40-character hash) is a usage error before any git call or receipt read; fails_when=the value is looked up as typed and the answer is E_NO_BUILD (exit 1) instead of E_USAGE (exit 64), or the full hash is accepted; no_claim=a value of 8 hex characters that names no commit (E_NO_BUILD)
for (const short of ['0123abc', '0123abcd4', '0123ABCD', '0123abcg', HEAD]) {
  test(`--status ${short} exits 64 with E_USAGE because it is not 8 lower-case hex characters`, async (t) => {
    // Arrange
    const harness = await makeHarness(t)

    // Act
    const exitCode = await runCommand(harness, ['--status', short])

    // Assert
    assert.equal(exitCode, 64)
    assert.deepEqual(harness.err, [
      'E_USAGE: <short> is the first 8 hex characters of a commit',
      'Fix: node extension/scripts/qa-build.mjs --help',
    ])
    assert.deepEqual(harness.out, [])
    assert.deepEqual(harness.calls.git, [])
  })
}

// protects=a build takes no argument: a commit typed without --status is a usage error naming it, and nothing is checked, built or written; fails_when=the stray value is ignored and a build starts, or the exit code is 1/2; no_claim=every usage combination
test('a commit typed without --status exits 64 with E_USAGE naming it and builds nothing', async (t) => {
  // Arrange
  const harness = await makeHarness(t)

  // Act
  const exitCode = await runCommand(harness, [SHORT])

  // Assert
  assert.equal(exitCode, 64)
  assert.deepEqual(harness.err, [
    `E_USAGE: unexpected argument ${SHORT}`,
    'Fix: node extension/scripts/qa-build.mjs --help',
  ])
  assert.deepEqual(harness.calls.git, [])
  assert.deepEqual(harness.calls.build, [])
  assert.equal(await exists(join(harness.repository, 'artifacts')), false)
})

// protects=a QA build is of a commit: a changed checkout is refused before any build or write; fails_when=a dirty checkout is built or a receipt appears; no_claim=real git status (listChanges is a fake)
test('a checkout with changes is refused with E_DIRTY, naming the paths, and nothing is built or written', async (t) => {
  // Arrange
  const harness = await makeHarness(t, {
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
})

// protects=a dirty refusal names at most five changed paths and counts the rest, so a long list does not flood the terminal and still tells how many paths hide; fails_when=all seven paths are named, the "and N more" count is missing or wrong, or the status prefix of a path is kept; no_claim=real git status (listChanges is a fake)
test('a checkout with seven changed paths is refused with E_DIRTY naming five of them and "and 2 more"', async (t) => {
  // Arrange
  const harness = await makeHarness(t, {
    changes: [
      ' M extension/src/a.ts',
      ' M extension/src/b.ts',
      '?? c.txt',
      'A  d.txt',
      ' D e.txt',
      '?? f.txt',
      '?? g.txt',
    ],
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(harness.err, [
    'E_DIRTY: the checkout has changes: extension/src/a.ts, extension/src/b.ts, c.txt, d.txt, e.txt, and 2 more',
    'Fix: commit or move the changes, then rerun',
  ])
  assert.deepEqual(harness.calls.build, [])
  assert.equal(await exists(join(harness.repository, 'artifacts')), false)
})

// protects=a dirty refusal with exactly five changed paths names all five and adds no "and N more" tail; fails_when=the tail appears at the limit itself ("and 0 more") or the fifth path is cut; no_claim=six or more paths (the test above)
test('a checkout with exactly five changed paths is refused with E_DIRTY naming all five and no "more" tail', async (t) => {
  // Arrange
  const harness = await makeHarness(t, {
    changes: [' M a.txt', ' M b.txt', ' M c.txt', ' M d.txt', ' M e.txt'],
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(harness.err, [
    'E_DIRTY: the checkout has changes: a.txt, b.txt, c.txt, d.txt, e.txt',
    'Fix: commit or move the changes, then rerun',
  ])
  assert.deepEqual(harness.calls.build, [])
})

// protects=the receipt has exactly the documented fields and types and the command prints the VSIX path and SHA-256; fails_when=a field is missing, mistyped or a review field comes back; no_claim=the real build (the builder is a fake returning entries 34)
test('a QA build writes a receipt with head, version, sha256, entries and builtAt and prints the VSIX path and SHA-256', async (t) => {
  // Arrange
  const harness = await makeHarness(t)

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(await readReceipt(harness.repository), {
    head: HEAD,
    version: '0.2.69.0',
    sha256: 'a'.repeat(64),
    entries: 34,
    builtAt: '2026-11-01T12:00:00.000Z',
  })
  assert.deepEqual(harness.calls.build, [
    [
      harness.repository,
      join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`),
    ],
  ])
  assert.deepEqual(harness.out, [
    `VSIX: ${join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`)}`,
    `SHA-256: ${'a'.repeat(64)}`,
  ])
})

// protects=the retired background review stays retired: a build starts no codex and leaves only the VSIX and its receipt; fails_when=a build probes or launches codex (the PATH shim leaves a marker) or writes a review log or state file; no_claim=Windows (the shim is a POSIX script), the real package build (the builder is a fake)
test(
  'a QA build starts no codex process and writes no review state or log file',
  { skip: process.platform === 'win32' },
  async (t) => {
    // Arrange
    const repository = await mkdtemp(join(tmpdir(), 'qa-build-git-'))
    const shimDirectory = await mkdtemp(join(tmpdir(), 'qa-build-shim-'))
    const marker = join(shimDirectory, 'codex-was-started.txt')
    await writeFile(
      join(shimDirectory, 'codex'),
      `#!/bin/sh\necho "$@" >> '${marker}'\n`,
    )
    await chmod(join(shimDirectory, 'codex'), 0o755)
    await writeFile(join(repository, 'VERSION'), '0.2.69.0\n')
    await writeFile(join(repository, '.gitignore'), 'artifacts/\n')
    // Ambient GIT_* overrides are left out, as the command's own git calls do, so the temp repository is the one read.
    const git = (args) =>
      execFileSync('git', args, packageGitOptions(repository))
    git(['init', '--quiet'])
    git(['add', 'VERSION', '.gitignore'])
    git([
      '-c',
      'user.name=QA Build Test',
      '-c',
      'user.email=qa-build@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'qa build',
    ])
    const head = git(['rev-parse', 'HEAD']).trim()
    const short = head.slice(0, 8)
    const originalPath = process.env.PATH
    process.env.PATH = `${shimDirectory}${delimiter}${originalPath}`
    t.after(async () => {
      process.env.PATH = originalPath
      await rm(repository, { recursive: true, force: true })
      await rm(shimDirectory, { recursive: true, force: true })
    })
    const out = []
    const harness = {
      err: [],
      seams: {
        ...productionSeams(repository),
        print: (line) => out.push(line),
        build: async (_root, output) => {
          await writeFile(output, 'vsix bytes')
          return {
            sha256: 'b'.repeat(64),
            entries: 34,
            build: { revision: head, dirty: false },
          }
        },
      },
    }

    // Act
    const exitCode = await runCommand(harness, [])

    // Assert
    assert.equal(await exists(marker), false)
    assert.equal(exitCode, 0, harness.err.join('\n'))
    assert.deepEqual((await readdir(join(repository, 'artifacts/qa'))).sort(), [
      `codebook-${short}.json`,
      `codebook-${short}.vsix`,
    ])
    assert.deepEqual(out, [
      `VSIX: ${join(repository, `artifacts/qa/codebook-${short}.vsix`)}`,
      `SHA-256: ${'b'.repeat(64)}`,
    ])
  },
)

// protects=a failed build leaves no receipt, not even the old one; fails_when=the old receipt survives or the code is not E_BUILD/2; no_claim=real build failures
test('a build failure exits 2 with E_BUILD and removes the receipt left for the same HEAD', async (t) => {
  // Arrange
  const harness = await makeHarness(t, { buildError: new Error('tsc failed') })
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
})

// protects=a build that reports dirty is no QA build; fails_when=a receipt is written for a dirty build or the VSIX stays; no_claim=readBuildIdentity itself
test('a build identity that says dirty exits 2 with E_BUILD_DIRTY, deletes the VSIX and writes no receipt', async (t) => {
  // Arrange
  const harness = await makeHarness(t, {
    buildIdentity: { revision: HEAD, dirty: true },
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 2)
  assert.match(harness.err[0], /^E_BUILD_DIRTY: /)
  assert.equal(harness.err.at(-1), 'Fix: commit the change, then rerun')
  assert.deepEqual(await readdir(join(harness.repository, 'artifacts/qa')), [])
})

// protects=a build of another revision than the starting HEAD is no QA build; fails_when=a moved HEAD yields a receipt; no_claim=none beyond protects
test('a build identity that names another revision exits 2 with E_BUILD_DIRTY, deletes the VSIX and writes no receipt', async (t) => {
  // Arrange
  const harness = await makeHarness(t, {
    buildIdentity: { revision: 'f'.repeat(40), dirty: false },
  })

  // Act
  const exitCode = await runCommand(harness, [])

  // Assert
  assert.equal(exitCode, 2)
  assert.match(harness.err[0], /^E_BUILD_DIRTY: /)
  assert.deepEqual(await readdir(join(harness.repository, 'artifacts/qa')), [])
})

// protects=--status prints the receipt only, also for a receipt written while the review existed; fails_when=a line is missing or a Review line is printed, or --status builds; no_claim=none beyond protects
test('--status <short> prints the commit, version, VSIX path, SHA-256 and build time and no review line', async (t) => {
  // Arrange
  const harness = await makeHarness(t)
  await mkdir(join(harness.repository, 'artifacts/qa'), { recursive: true })
  await writeFile(
    join(harness.repository, `artifacts/qa/codebook-${SHORT}.json`),
    JSON.stringify({
      head: HEAD,
      version: '0.2.69.0',
      sha256: 'b'.repeat(64),
      entries: 34,
      builtAt: '2026-11-01T11:00:00.000Z',
      review: { state: 'skipped' },
    }),
  )

  // Act
  const exitCode = await runCommand(harness, ['--status', SHORT])

  // Assert
  assert.equal(exitCode, 0)
  assert.deepEqual(harness.out, [
    `Commit: ${SHORT} (${HEAD})`,
    'Version: 0.2.69.0',
    `VSIX: ${join(harness.repository, `artifacts/qa/codebook-${SHORT}.vsix`)}`,
    `SHA-256: ${'b'.repeat(64)}`,
    'Built: 2026-11-01T11:00:00.000Z',
  ])
  assert.deepEqual(harness.calls.build, [])
})

// protects=--status of a commit with no QA build is a refusal; fails_when=it prints nothing or exits 0; no_claim=none beyond protects
test('--status for a commit without a receipt exits 1 with E_NO_BUILD', async (t) => {
  // Arrange
  const harness = await makeHarness(t)

  // Act
  const exitCode = await runCommand(harness, ['--status'])

  // Assert
  assert.equal(exitCode, 1)
  assert.equal(harness.err[0], `E_NO_BUILD: no receipt for ${SHORT}`)
  assert.equal(harness.err.at(-1), 'Fix: node extension/scripts/qa-build.mjs')
})
