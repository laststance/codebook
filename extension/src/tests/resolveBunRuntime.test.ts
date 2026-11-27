import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import {
  resolveBunRuntime,
  runBunProgram,
  type RunBunProgram,
} from '../utils/resolveBunRuntime'

import { removeTestFolder } from './utils/removeTestFolder'

/** An error as `execFile` raises it when no such program exists. */
function missingProgram(): Error {
  return Object.assign(new Error('spawn bun ENOENT'), { code: 'ENOENT' })
}

/** The identity line a Bun prints for the lookup's script. */
function identity(version: string, executable: string): string {
  return `${JSON.stringify({ version, executable })}\n`
}

/** A program reader that answers per program and records what was asked. */
function scriptedPrograms(answers: Record<string, () => Promise<string>>) {
  const asked: string[] = []
  const runProgram: RunBunProgram = async (program) => {
    asked.push(program)
    const answer = answers[program]
    if (!answer) throw missingProgram()
    return answer()
  }
  return { asked, runProgram }
}

/** Awaits a refusal and returns it, failing the test when the lookup resolves instead. */
async function refusalOf(promise: Promise<unknown>): Promise<StudyError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(
    error instanceof StudyError,
    `expected a refusal, got ${String(error)}`,
  )
  return error
}

// Value: protects=a learner whose Bun is on the editor's PATH runs on that Bun, named by its real path and release; fails_when=the lookup skips the PATH, records the bare command instead of the binary it launches, or asks the home fallback anyway; seam=a scripted program reader; no_claim=a real Bun installation (the real-Bun launch test covers one)
test('the first bun on the PATH answers with its real path and release, and the home fallback is not asked', async () => {
  // Arrange
  const programs = scriptedPrograms({
    bun: async () => identity('1.4.5', '/opt/homebrew/bin/bun'),
  })
  // Act
  const bun = await resolveBunRuntime(programs.runProgram, '/Users/learner')
  // Assert
  assert.deepEqual(bun, {
    executable: '/opt/homebrew/bin/bun',
    version: '1.4.5',
  })
  assert.deepEqual(programs.asked, ['bun'])
})

// Value: protects=Bun's own installer puts bun in ~/.bun/bin, which an editor started from the Dock may not have on its PATH; fails_when=a missing PATH entry refuses the run although ~/.bun/bin/bun exists; seam=a scripted program reader; no_claim=the editor's real PATH
test('a Bun missing from the PATH is found in ~/.bun/bin', async () => {
  // Arrange
  const programs = scriptedPrograms({
    '/Users/learner/.bun/bin/bun': async () =>
      identity('1.4.4', '/Users/learner/.bun/bin/bun'),
  })
  // Act
  const bun = await resolveBunRuntime(programs.runProgram, '/Users/learner')
  // Assert
  assert.deepEqual(bun, {
    executable: '/Users/learner/.bun/bin/bun',
    version: '1.4.4',
  })
  assert.deepEqual(programs.asked, ['bun', '/Users/learner/.bun/bin/bun'])
})

// Value: protects=no Bun at all refuses before launch with the code and a recovery that names how to install it; fails_when=the run launches anyway, or the refusal leaves out where Codebook looked; seam=a reader with no programs; no_claim=the installer itself
test('no Bun anywhere is refused with NODE_SERVER_SOURCE_REFUSED and an install recovery', async () => {
  // Arrange
  const programs = scriptedPrograms({})
  // Act
  const error = await refusalOf(
    resolveBunRuntime(programs.runProgram, '/Users/learner'),
  )
  // Assert
  assert.equal(error.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    error.message,
    `node-server's loader "bun" needs Bun 1.4.4 or later, and no bun was found (the first bun on the editor's PATH, then ~/.bun/bin/bun), so nothing was launched.`,
  )
  assert.equal(
    error.recoveryOverride,
    "Install Bun 1.4.4 or later (https://bun.sh) so that `bun` is on the editor's PATH or in ~/.bun/bin, reload the editor window, then start a new run.",
  )
})

// Value: protects=a Bun older than the release the inspector probes passed on is refused with its release and an update recovery; fails_when=1.4.3 is accepted, or 1.4.10 is read as older than 1.4.4 by a text comparison; seam=a scripted reader; no_claim=behaviour of real old Bun releases
test('a Bun older than 1.4.4 is refused naming its release, and 1.4.10 is accepted as newer', async () => {
  // Arrange
  const old = scriptedPrograms({
    bun: async () => identity('1.4.3', '/usr/local/bin/bun'),
  })
  const newer = scriptedPrograms({
    bun: async () => identity('1.4.10', '/usr/local/bin/bun'),
  })
  // Act
  const error = await refusalOf(
    resolveBunRuntime(old.runProgram, '/Users/learner'),
  )
  const accepted = await resolveBunRuntime(newer.runProgram, '/Users/learner')
  // Assert
  assert.equal(error.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.match(
    error.message,
    /the Bun found \(.*\) is 1\.4\.3, so nothing was launched\.$/,
  )
  assert.equal(
    error.recoveryOverride,
    'Update Bun to 1.4.4 or later (`bun upgrade`), then start a new run.',
  )
  assert.equal(accepted.version, '1.4.10')
})

// Value: protects=a pre-release is placed by SemVer precedence: below its own release when that is the minimum, above the minimum when it belongs to a later release, and reported as the Bun printed it; fails_when=`1.4.4-canary.1` is accepted as 1.4.4, `1.4.5-canary.1` is refused or reported as `1.4.5`, or a release suffix is dropped; seam=a scripted reader; no_claim=canary Bun behaviour
test('a pre-release of the minimum is refused, a pre-release of a later release is accepted as reported', async () => {
  // Arrange
  const belowMinimum = scriptedPrograms({
    bun: async () => identity('1.4.4-canary.1+local', '/usr/local/bin/bun'),
  })
  const laterRelease = scriptedPrograms({
    bun: async () => identity('1.4.5-canary.1', '/usr/local/bin/bun'),
  })
  const minimum = scriptedPrograms({
    bun: async () => identity('1.4.4', '/usr/local/bin/bun'),
  })
  // Act
  const refused = await refusalOf(
    resolveBunRuntime(belowMinimum.runProgram, '/Users/learner'),
  )
  const later = await resolveBunRuntime(
    laterRelease.runProgram,
    '/Users/learner',
  )
  const exact = await resolveBunRuntime(minimum.runProgram, '/Users/learner')
  // Assert
  assert.match(
    refused.message,
    /the Bun found \(.*\) is 1\.4\.4-canary\.1\+local, so nothing was launched\.$/,
  )
  assert.deepEqual(later, {
    executable: '/usr/local/bin/bun',
    version: '1.4.5-canary.1',
  })
  assert.equal(exact.version, '1.4.4')
})

// Value: protects=a non-executable bun earlier on the PATH does not hide a valid ~/.bun/bin/bun; fails_when=EACCES refuses the run although the home fallback answers; seam=a scripted reader whose bun throws EACCES; no_claim=the real file permission
test('a PATH bun that is not executable falls through to ~/.bun/bin', async () => {
  // Arrange
  const asked: string[] = []
  const runProgram: RunBunProgram = async (program) => {
    asked.push(program)
    if (program === 'bun')
      throw Object.assign(new Error('spawn bun EACCES'), { code: 'EACCES' })
    return identity('1.4.5', '/Users/learner/.bun/bin/bun')
  }
  // Act
  const bun = await resolveBunRuntime(runProgram, '/Users/learner')
  // Assert
  assert.deepEqual(bun, {
    executable: '/Users/learner/.bun/bin/bun',
    version: '1.4.5',
  })
  assert.deepEqual(asked, ['bun', '/Users/learner/.bun/bin/bun'])
})

// Value: protects=a Bun that exists but hangs or crashes is refused as not answering, and the lookup does not silently fall back to another Bun; fails_when=a timeout reads as missing and a different Bun runs, or the run launches on an unverified Bun; seam=a reader whose bun throws a timeout; no_claim=the real timeout length
test('a Bun that does not answer is refused and no other Bun is tried', async () => {
  // Arrange
  const programs = scriptedPrograms({
    bun: async () => {
      throw Object.assign(new Error('Command failed: bun -e'), {
        code: 'ETIMEDOUT',
      })
    },
    '/Users/learner/.bun/bin/bun': async () =>
      identity('1.4.5', '/Users/learner/.bun/bin/bun'),
  })
  // Act
  const error = await refusalOf(
    resolveBunRuntime(programs.runProgram, '/Users/learner'),
  )
  // Assert
  assert.equal(error.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.match(error.message, /did not answer `bun -e` within 5 s/)
  assert.deepEqual(programs.asked, ['bun'])
})

// Value: protects=a Bun that fails at once is refused with the way it failed, not as a slow Bun: an exit code, a signal or an error code is named, and a run its timeout ended still reads as not answering in time; fails_when=every failure that is not ENOENT is worded as a 5 s timeout (Cycle 0152 review finding), or the refusal quotes Bun's output; seam=scripted readers throwing execFile-shaped errors; no_claim=which failures real Bun produces
test('a Bun that fails at once is refused naming its exit code or signal, and a timed-out one as not answering in time', async () => {
  // Arrange
  const failingWith = (failure: object) =>
    scriptedPrograms({
      bun: async () => {
        throw Object.assign(new Error('Command failed: bun -e'), failure)
      },
    })
  const exited = failingWith({ code: 1 })
  const signalled = failingWith({ code: null, signal: 'SIGKILL' })
  const timedOut = failingWith({ code: null, signal: 'SIGTERM', killed: true })
  // Act
  const exitedError = await refusalOf(
    resolveBunRuntime(exited.runProgram, '/Users/learner'),
  )
  const signalledError = await refusalOf(
    resolveBunRuntime(signalled.runProgram, '/Users/learner'),
  )
  const timedOutError = await refusalOf(
    resolveBunRuntime(timedOut.runProgram, '/Users/learner'),
  )
  // Assert
  assert.equal(
    exitedError.message,
    `node-server's loader "bun" found a Bun (the first bun on the editor's PATH, then ~/.bun/bin/bun) that ended \`bun -e\` with exit code 1, so nothing was launched.`,
  )
  assert.equal(
    signalledError.message,
    `node-server's loader "bun" found a Bun (the first bun on the editor's PATH, then ~/.bun/bin/bun) that was ended by SIGKILL while answering \`bun -e\`, so nothing was launched.`,
  )
  assert.equal(
    timedOutError.message,
    `node-server's loader "bun" found a Bun (the first bun on the editor's PATH, then ~/.bun/bin/bun) that did not answer \`bun -e\` within 5 s, so nothing was launched.`,
  )
  assert.deepEqual(
    [exited.asked, signalled.asked, timedOut.asked],
    [['bun'], ['bun'], ['bun']],
  )
})

// Value: protects=an answer that is not Bun's identity (a wrapper's banner, a relative path) is refused as unreadable; fails_when=a relative executable or garbage version is launched; seam=scripted readers; no_claim=every wrapper's output
test('an unreadable identity or a relative executable is refused as unreadable', async () => {
  // Arrange
  const banner = scriptedPrograms({ bun: async () => 'sfw: wrapped bun\n' })
  const relative = scriptedPrograms({
    bun: async () => identity('1.4.5', 'bin/bun'),
  })
  // Act
  const bannerError = await refusalOf(
    resolveBunRuntime(banner.runProgram, '/Users/learner'),
  )
  const relativeError = await refusalOf(
    resolveBunRuntime(relative.runProgram, '/Users/learner'),
  )
  // Assert
  for (const error of [bannerError, relativeError]) {
    assert.equal(error.code, 'NODE_SERVER_SOURCE_REFUSED')
    assert.match(
      error.message,
      /could not read the release of the Bun it found/,
    )
  }
})

// Value: protects=the Bun identity probe never hands the editor's credentials or the opened repository's folder to a Bun wrapper or a bunfig preload, even when the version check refuses the run; fails_when=the probe inherits the full parent environment (a variable outside the server launch allowlist reaches the program) or runs in the editor's working folder; seam=the default reader run against a fake bun script that prints its own environment and folder; no_claim=a real Bun installation
test('the identity probe runs with the restricted server environment and a neutral working folder', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bun-probe-'))
  const fakeBun = join(folder, 'fake-bun')
  await writeFile(
    fakeBun,
    '#!/bin/sh\necho "parent=${CODEBOOK_TEST_PARENT_ONLY:-absent}"\necho "path=${PATH:+present}"\npwd -P\n',
  )
  await chmod(fakeBun, 0o755)
  const previous = process.env.CODEBOOK_TEST_PARENT_ONLY
  process.env.CODEBOOK_TEST_PARENT_ONLY = 'leaked'
  try {
    // Act
    const output = await runBunProgram(fakeBun, ['-e', 'ignored'])
    // Assert
    const [parent, path, probeFolder = ''] = output.trim().split('\n')
    assert.deepEqual([parent, path], ['parent=absent', 'path=present'])
    const temp = await realpath(tmpdir())
    assert.notEqual(probeFolder, temp)
    assert.equal(join(probeFolder, '..'), temp)
  } finally {
    if (previous === undefined) delete process.env.CODEBOOK_TEST_PARENT_ONLY
    else process.env.CODEBOOK_TEST_PARENT_ONLY = previous
    await removeTestFolder(folder)
  }
})

// Value: protects=the probe's working folder is private to the learner (nobody else can plant bunfig.toml or .env in it); fails_when=the probe folder is group or world accessible; seam=the default reader against a fake bun that prints its folder's mode; no_claim=Windows permissions
test('the identity probe folder is private to the learner', async (context) => {
  // Arrange
  if (process.platform === 'win32') {
    context.skip('POSIX modes do not apply on Windows')
    return
  }
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bun-probe-'))
  const fakeBun = join(folder, 'fake-bun')
  await writeFile(
    fakeBun,
    '#!/bin/sh\nstat -c %a . 2>/dev/null || stat -f %Lp .\n',
  )
  await chmod(fakeBun, 0o755)
  try {
    // Act
    const output = await runBunProgram(fakeBun, [])
    // Assert
    assert.equal(output.trim(), '700')
  } finally {
    await removeTestFolder(folder)
  }
})

// Value: protects=the probe leaves no folder behind after a successful read; fails_when=the private working folder still exists after the probe returned; seam=the default reader against a fake bun that prints its folder; no_claim=a removal that fails
test('the identity probe removes its working folder after it answers', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bun-probe-'))
  const fakeBun = join(folder, 'fake-bun')
  await writeFile(fakeBun, '#!/bin/sh\npwd -P\n')
  await chmod(fakeBun, 0o755)
  try {
    // Act
    const probeFolder = (await runBunProgram(fakeBun, [])).trim()
    // Assert
    await assert.rejects(stat(probeFolder), { code: 'ENOENT' })
  } finally {
    await removeTestFolder(folder)
  }
})

// Value: protects=the probe leaves no folder behind when Bun exits non-zero, and still raises Bun's own error; fails_when=the working folder survives a failed probe or a cleanup error hides the failure; seam=the default reader against a fake bun that records its folder and exits 3; no_claim=a timeout
test('the identity probe removes its working folder when Bun fails', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bun-probe-'))
  const fakeBun = join(folder, 'fake-bun')
  const recorded = join(folder, 'recorded-folder')
  await writeFile(
    fakeBun,
    `#!/bin/sh\npwd -P > "${recorded}"\necho oops >&2\nexit 3\n`,
  )
  await chmod(fakeBun, 0o755)
  try {
    // Act
    const failure = runBunProgram(fakeBun, [])
    // Assert
    await assert.rejects(failure, { code: 3 })
    const probeFolder = (await readFile(recorded, 'utf8')).trim()
    assert.notEqual(probeFolder, '')
    await assert.rejects(stat(probeFolder), { code: 'ENOENT' })
  } finally {
    await removeTestFolder(folder)
  }
})

// Value: protects=a bun wrapper that starts the real Bun as a child and waits leaves nothing running after the probe's deadline; fails_when=only the wrapper is killed and its child survives; seam=the default reader against a fake wrapper that starts a long-lived child and records its pid; no_claim=Windows taskkill
test('the identity probe ends a wrapper and the child it started at the deadline', async (context) => {
  // Arrange
  if (process.platform === 'win32') {
    context.skip('process groups do not apply on Windows')
    return
  }
  const folder = await mkdtemp(join(tmpdir(), 'codebook-bun-probe-'))
  const fakeBun = join(folder, 'fake-bun')
  const childPidFile = join(folder, 'child-pid')
  await writeFile(
    fakeBun,
    `#!/bin/sh\nsleep 30 &\necho $! > "${childPidFile}"\nwait\n`,
  )
  await chmod(fakeBun, 0o755)
  let childPid = 0
  try {
    // Act
    const failure = runBunProgram(fakeBun, [], 500)
    // Assert
    await assert.rejects(failure, { code: 'ETIMEDOUT' })
    childPid = Number((await readFile(childPidFile, 'utf8')).trim())
    assert.ok(childPid > 1)
    const waitDeadline = Date.now() + 5_000
    let alive = true
    while (alive && Date.now() < waitDeadline) {
      try {
        process.kill(childPid, 0)
        await new Promise((resolve) => setTimeout(resolve, 50))
      } catch {
        alive = false
      }
    }
    assert.equal(alive, false, 'the wrapper child must be gone')
  } finally {
    if (childPid > 1) {
      try {
        process.kill(childPid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    await removeTestFolder(folder)
  }
})
