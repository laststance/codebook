import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { listVitestForRootClaim } from '../utils/listVitestForRootClaim'
import type {
  listVitestTestFiles,
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from '../utils/listVitestTestFiles'

/**
 * Writes a stand-in Vitest program that behaves as the given body and returns its folder and path.
 * @param context - Removes the folder when the test ends.
 * @param body - JavaScript the program runs; `output` holds the `--json=` path it was given.
 * @returns The folder, used as the Vitest root, and the program.
 * @example const vitest = await stubVitest(context, 'process.exit(1)')
 */
async function stubVitest(context: TestContext, body: string) {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-root-claim-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const program = join(folder, 'vitest.mjs')
  await writeFile(
    program,
    `import { writeFileSync } from 'node:fs';
const output = process.argv.slice(2).find(argument => argument.startsWith('--json='))?.slice('--json='.length);
${body}
`,
  )
  return { folder, program }
}

/**
 * Asks the stand-in Vitest for the root claim's listing with the given cancellation and deadline.
 * @param vitest - The stand-in program and its folder.
 * @param run - The cancellation and the deadline; a minute away and never cancelled by default.
 * @param list - The listing to run, the real one by default.
 * @returns The classified listing.
 * @example await claimFrom(vitest) // => { outcome: 'listed', files: [] }
 */
function claimFrom(
  vitest: { folder: string; program: string },
  run: { cancellation?: AbortSignal; deadlineAt?: number } = {},
  list?: typeof listVitestTestFiles,
) {
  return listVitestForRootClaim(
    {
      program: vitest.program,
      vitestRoot: vitest.folder,
      filter: 'browser-extension/tests/unit/popup.test.tsx',
      excludes: [],
    },
    {
      node: process.execPath,
      cancellation: run.cancellation ?? new AbortController().signal,
      deadlineAt: run.deadlineAt ?? Date.now() + 60_000,
    },
    list,
  )
}

// Value: protects=a finished root listing answered with Vitest's own entries, and a listing Vitest ended with an error counted as a clean failure; fails_when=the entries are lost, or an error exit refuses the start instead of leaving the test in its package; why_new=Eng review (only a clean failure falls back); seam=a stand-in Vitest program run by the real listing; no_claim=Vitest's real listing (task 1 spike)
test('a finished root listing returns its files, and one Vitest ended with an error is a clean failure', async (context) => {
  // Arrange
  const listing = await stubVitest(
    context,
    "writeFileSync(output, JSON.stringify([{ file: '/repo/browser-extension/tests/unit/popup.test.tsx' }]));",
  )
  const failing = await stubVitest(
    context,
    "console.error('no config'); process.exit(1);",
  )

  // Act
  const listed = await claimFrom(listing)
  const failed = await claimFrom(failing)

  // Assert
  assert.deepEqual(listed, {
    outcome: 'listed',
    files: [{ file: '/repo/browser-extension/tests/unit/popup.test.tsx' }],
  })
  assert.equal(failed.outcome, 'failed')
})

// Value: protects=a learner's stop and a passed preparation deadline told apart from a clean failure; fails_when=a cancelled or timed-out root listing reads as failed and falls back to package mode; why_new=Eng review (H5 refusals for a cancellation and the deadline); seam=a stand-in Vitest that never finishes; no_claim=the release of the listing's group (listVitestTestFiles tests)
test('a root listing cancelled by the start or outlasting its deadline is told apart from a clean failure', async (context) => {
  // Arrange
  const waiting = await stubVitest(context, 'setInterval(() => {}, 1000);')
  const cancellation = new AbortController()
  setTimeout(() => cancellation.abort(new Error('stopped by the learner')), 200)

  // Act
  const cancelled = await claimFrom(waiting, {
    cancellation: cancellation.signal,
  })
  const timedOut = await claimFrom(waiting, { deadlineAt: Date.now() + 300 })
  const alreadyLate = await claimFrom(waiting, { deadlineAt: Date.now() - 1 })

  // Assert
  assert.equal(cancelled.outcome, 'cancelled')
  assert.equal(timedOut.outcome, 'deadline')
  assert.equal(alreadyLate.outcome, 'deadline')
  assert.match(
    String('error' in alreadyLate && alreadyLate.error),
    /preparation deadline passed before Vitest could list browser-extension\/tests\/unit\/popup\.test\.tsx from the repository root/,
  )
})

// Value: protects=a root claim's deadline read on the clock it was set on, the study service's, which a test may replace; fails_when=the listing compares a deadline set on a fake clock with the real one, so a start whose deadline is still minutes away on its own clock reads as past it and is refused; why_new=Cycle 0053 /ship review pass 4 (the service sets the deadline with its injectable now, the listing read Date.now); seam=a fake clock a minute before the real epoch's start; no_claim=the deadline's length (the cancellation and deadline test)
test("a root listing reads its deadline on the start's own clock", async (context) => {
  // Arrange
  const listing = await stubVitest(
    context,
    "writeFileSync(output, JSON.stringify([{ file: '/repo/browser-extension/tests/unit/popup.test.tsx' }]));",
  )
  const serviceClock = () => 1_000

  // Act
  const claim = await listVitestForRootClaim(
    {
      program: listing.program,
      vitestRoot: listing.folder,
      filter: 'browser-extension/tests/unit/popup.test.tsx',
      excludes: [],
    },
    {
      node: process.execPath,
      cancellation: new AbortController().signal,
      deadlineAt: 1_000 + 60_000,
      now: serviceClock,
    },
  )

  // Assert
  assert.deepEqual(claim, {
    outcome: 'listed',
    files: [{ file: '/repo/browser-extension/tests/unit/popup.test.tsx' }],
  })
})

// Value: protects=a root listing whose process group could not be confirmed as ended refusing the start, also when the listing itself failed, with a sentence naming the group and the kept folder; fails_when=such a listing reads as a clean failure, so a second Vitest starts beside a member that may still run; why_new=Eng review (H5 unconfirmed process-group end); seam=the listing is replaced by one that reports a failed release; no_claim=how the release fails (listVitestTestFiles tests)
test('a root listing whose process group could not be confirmed as ended is unconfirmed, whatever its own result', async (context) => {
  // Arrange
  const vitest = await stubVitest(context, '')
  const unreleased: typeof listVitestTestFiles = async (request) => {
    request.onReleaseFailed?.(
      {
        processGroup: 4242,
        directory: '/tmp/codebook-vitest-list-x',
        reason: 'Error: kill EPERM',
      },
      async () => undefined,
    )
    throw new Error('Vitest could not list the cited test file (exit code 1): ')
  }

  // Act
  const claim = await claimFrom(vitest, {}, unreleased)

  // Assert
  assert.equal(claim.outcome, 'unconfirmed')
  assert.equal(
    String('error' in claim && claim.error),
    "Error: Vitest's listing from the repository root ended, but Codebook could not confirm that its process group 4242 ended (Error: kill EPERM), so a process of that group may still run. The test was not started, and the listing's folder /tmp/codebook-vitest-list-x is kept. Start the run again.",
  )
})

// Value: protects=a root listing whose process group could not be confirmed as ended reading unconfirmed, and its caller hearing of it with the listing's retry, also when the start was stopped meanwhile; fails_when=a stop that races the failed release reads cancelled and drops the failure, so the run reads stopped with no word of a listing member that may still run, or the caller gets no retry to release it with (Cycle 0053 /ship Step 11); why_new=state-machine review of Cycle 0053 (cancelled was checked before the release failure); seam=the listing is replaced by one that reports a failed release after the stop; no_claim=the service's journal of it (nodeTestVitestRootService tests)
test('a stop that races a root listing whose process group was not released still reads unconfirmed and tells the caller', async (context) => {
  // Arrange
  const vitest = await stubVitest(context, '')
  const cancellation = new AbortController()
  cancellation.abort(new Error('stopped by the learner'))
  const heard: [VitestListingReleaseFailure, RetryVitestListingRelease][] = []
  const failure = {
    processGroup: 4242,
    directory: '/tmp/codebook-vitest-list-x',
    reason: 'Error: kill EPERM',
  }
  const retryRelease = async () => undefined
  const unreleased: typeof listVitestTestFiles = async (request) => {
    request.onReleaseFailed?.(failure, retryRelease)
    throw cancellation.signal.reason
  }

  // Act
  const claim = await listVitestForRootClaim(
    {
      program: vitest.program,
      vitestRoot: vitest.folder,
      filter: 'browser-extension/tests/unit/popup.test.tsx',
      excludes: [],
    },
    {
      node: process.execPath,
      cancellation: cancellation.signal,
      deadlineAt: Date.now() + 60_000,
      onReleaseFailed: (released, retry) => heard.push([released, retry]),
    },
    unreleased,
  )

  // Assert
  assert.equal(claim.outcome, 'unconfirmed')
  assert.equal(heard.length, 1)
  assert.deepEqual(heard[0]![0], failure)
  assert.equal(heard[0]![1], retryRelease)
})
