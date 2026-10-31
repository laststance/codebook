import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { GATE_CHECKS, runGate } from '../gate.mjs'
import { createCommandRunner, HELP_TEXT, main } from '../merge-pr.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'

const PR = '173'
const HEAD = '1234567890abcdef1234567890abcdef12345678'
const OTHER_HEAD = 'fedcba0987654321fedcba0987654321fedcba09'
const SHORT_HEAD = '12345678'
const MERGE_COMMIT = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'
const MAIN_SHA = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'

const API = 'repos/laststance/codebook'
const KEY_VIEW_PR =
  'gh pr view 173 --json headRefOid,state,isDraft,baseRefName,mergeCommit'
const KEY_RUNS = (head) =>
  `gh api ${API}/actions/runs?head_sha=${head} --paginate --slurp`
const KEY_CHECK_RUNS = (head) =>
  `gh api ${API}/commits/${head}/check-runs --paginate --slurp`
const KEY_STATUS = (head) =>
  `gh api ${API}/commits/${head}/status --paginate --slurp`
const KEY_MERGE = `gh pr merge 173 --squash --match-head-commit ${HEAD}`
const KEY_REREAD = 'gh pr view 173 --json state,headRefOid'
const KEY_MERGE_COMMIT = 'gh pr view 173 --json mergeCommit -q .mergeCommit.oid'

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
const failed = (stderr, status = 1) => ({ status, stdout: '', stderr })
const json = (value) => ok(JSON.stringify(value))

/** The PR as `gh pr view` prints it, open by default. @example prView({ isDraft: true }) */
function prView(overrides = {}) {
  return json({
    headRefOid: HEAD,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    mergeCommit: null,
    ...overrides,
  })
}

/** Runner answers for a head whose gate and CI passed and whose merge works; tests override single keys. @example answers({ [KEY_MERGE]: failed('boom') }) */
function answers(overrides = {}) {
  return {
    [KEY_VIEW_PR]: prView(),
    [KEY_RUNS(HEAD)]: json([
      {
        total_count: 1,
        workflow_runs: [
          {
            name: 'Test',
            status: 'completed',
            conclusion: 'success',
            head_sha: HEAD,
          },
        ],
      },
    ]),
    [KEY_CHECK_RUNS(HEAD)]: json([
      {
        total_count: 1,
        check_runs: [
          { name: 'Test shard 1', status: 'completed', conclusion: 'success' },
        ],
      },
    ]),
    [KEY_STATUS(HEAD)]: json([{ state: 'pending', statuses: [] }]),
    [KEY_MERGE]: ok(),
    [KEY_REREAD]: json({ state: 'MERGED', headRefOid: HEAD }),
    [KEY_MERGE_COMMIT]: ok(`${MERGE_COMMIT}\n`),
    'git branch --show-current': ok('codex/cycle-0068\n'),
    'git fetch origin main:main': ok(),
    'git pull --ff-only origin main': ok(),
    'git fetch origin main': ok(),
    'git rev-parse main': ok(`${MAIN_SHA}\n`),
    'git rev-parse origin/main': ok(`${MAIN_SHA}\n`),
    ...overrides,
  }
}

/**
 * Produces a gate summary with the exported {@link runGate}, so its format has one owner (D33).
 * @param {{ head?: string, changes?: string[], codes?: Record<string, number>, checks?: typeof GATE_CHECKS }} [options] - The head the gate saw, the checkout changes at its start, exit codes by check name, the checks it ran.
 * @returns {Promise<string>} The summary text, as `gate.mjs` main writes it.
 * @example await buildSummary({ changes: [' M a.ts'] })
 */
async function buildSummary({
  head = HEAD,
  changes = [],
  codes = {},
  checks = GATE_CHECKS,
} = {}) {
  const lines = []
  await runGate({
    checks,
    out: '/gate-out',
    readHead: async () => head,
    listChanges: async () => changes,
    runCheck: async (check) => codes[check.name] ?? 0,
    print: (line) => lines.push(line),
  })
  return `${lines.join('\n')}\n`
}

/**
 * Runs the command through {@link runCommandLine} with a fake runner and a temporary repository root holding the gate summary.
 * @param {{ argv?: string[], responses?: Record<string, any>, summary?: string | null, environment?: NodeJS.ProcessEnv }} [options] - Arguments, runner answers (functions allowed), the summary text (`null`: none written), the environment.
 * @returns {Promise<{ exit: number, out: string[], err: string[], calls: string[] }>} Exit code, stdout lines, stderr lines and every `gh`/`git` call.
 * @example await runCommand({ argv: ['173', '--dry-run'] })
 */
async function runCommand({
  argv = [PR],
  responses = {},
  summary,
  environment = {},
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'merge-pr-test-'))
  try {
    const text = summary === undefined ? await buildSummary() : summary
    if (text !== null) {
      await mkdir(join(root, 'artifacts', 'gate', SHORT_HEAD), {
        recursive: true,
      })
      await writeFile(
        join(root, 'artifacts', 'gate', SHORT_HEAD, 'summary.txt'),
        text,
      )
    }
    const table = answers(responses)
    const calls = []
    const run = async (command, args) => {
      const key = [command, ...args].join(' ')
      calls.push(key)
      if (!(key in table)) throw new Error(`unexpected call: ${key}`)
      const answer = table[key]
      return typeof answer === 'function' ? answer(calls) : answer
    }
    const out = []
    const err = []
    const exit = await runCommandLine(
      (progress) =>
        main(progress, argv, {
          run,
          repositoryRoot: root,
          print: (line) => out.push(line),
          environment,
        }),
      { printError: (line) => err.push(line), environment },
    )
    return { exit, out, err, calls }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const mergeCalls = (calls) =>
  calls.filter((call) => call.startsWith('gh pr merge'))

// protects=a PR whose head passed everything is merged with the exact documented call and local main is synced; fails_when=the merge arguments drift (no squash, no match-head-commit) or the sync is skipped; no_claim=real gh/git behavior; a fake runner stands in for both
test('merges a ready PR with --squash --match-head-commit and fetches main when another branch is checked out', async () => {
  // Arrange
  const options = {}

  // Act
  const { exit, out, calls } = await runCommand(options)

  // Assert
  assert.equal(exit, 0)
  assert.deepEqual(mergeCalls(calls), [KEY_MERGE])
  assert.ok(calls.includes('git fetch origin main:main'))
  assert.deepEqual(out, [
    `checks pass at ${HEAD} (1 workflow runs, 1 check runs, 0 statuses)`,
    `merge commit ${MERGE_COMMIT}`,
    `local main ${MAIN_SHA}`,
  ])
})

// protects=on main the local branch moves with a fast-forward-only pull; fails_when=the script fetches into the checked-out main or merges non-fast-forward; no_claim=git itself; the runner is fake and unrelated local edits are not modelled by git here
test('updates local main with git pull --ff-only when main is checked out, leaving unrelated local edits alone', async () => {
  // Arrange
  const responses = { 'git branch --show-current': ok('main\n') }

  // Act
  const { exit, calls } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 0)
  assert.ok(calls.includes('git pull --ff-only origin main'))
  assert.ok(!calls.includes('git fetch origin main:main'))
})

// protects=a refused fast-forward still reports the merge and names the command; fails_when=exit 0 or exit 1 for an unsynced main; no_claim=Git's own refusal text; the fake returns it
test('exits 3 and prints the fast-forward command when git refuses to update local main', async () => {
  // Arrange
  const responses = {
    'git fetch origin main:main': failed(
      '! [rejected] main -> main (non-fast-forward)',
    ),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 3)
  assert.deepEqual(err, [
    'E_LOCAL_MAIN: git fetch origin main:main failed',
    '! [rejected] main -> main (non-fast-forward)',
    'local main not updated; fix the cause, then run the command above',
    'Fix: git fetch origin main:main',
  ])
})

// protects=success needs main equal to origin/main, not just a zero exit of git; fails_when=a fetch that exits 0 but leaves main behind passes; no_claim=real refs
test('exits 3 when local main still differs from origin/main after the update', async () => {
  // Arrange
  const responses = { 'git rev-parse main': ok('cccc3333\n') }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 3)
  assert.equal(
    err[0],
    `E_LOCAL_MAIN: local main (cccc3333) differs from origin/main (${MAIN_SHA})`,
  )
})

// protects=a draft, closed or foreign-base PR is never merged; fails_when=any of the three reaches gh pr merge; no_claim=GitHub's own state names beyond OPEN/MERGED/CLOSED
test('refuses a draft PR, a closed PR and a PR with another base with E_PR_STATE and no merge call', async () => {
  // Arrange
  const cases = [
    [{ isDraft: true }, 'E_PR_STATE: PR 173 is a draft'],
    [{ state: 'CLOSED' }, 'E_PR_STATE: PR 173 is CLOSED, not open'],
    [
      { baseRefName: 'release' },
      'E_PR_STATE: PR 173 targets release, not main',
    ],
  ]

  for (const [overrides, firstLine] of cases) {
    // Act
    const { exit, err, calls } = await runCommand({
      responses: { [KEY_VIEW_PR]: prView(overrides) },
    })

    // Assert
    assert.equal(exit, 1)
    assert.equal(err[0], firstLine)
    assert.equal(err.at(-1), 'Fix: gh pr view 173')
    assert.deepEqual(mergeCalls(calls), [])
  }
})

// protects=no gate summary means no merge; fails_when=a missing summary file is skipped; no_claim=the contents of a present file
test('refuses with E_GATE_MISSING and the gate command when the head has no summary', async () => {
  // Arrange
  const options = { summary: null }

  // Act
  const { exit, err, calls } = await runCommand(options)

  // Assert
  assert.equal(exit, 1)
  assert.match(
    err[0],
    /^E_GATE_MISSING: no gate summary at .*12345678.summary\.txt$/,
  )
  assert.equal(err.at(-1), 'Fix: pnpm --dir extension gate')
  assert.deepEqual(mergeCalls(calls), [])
})

// protects=a summary from a gate older than the Checkout line is recognised; fails_when=an old summary passes or is called a failure; no_claim=how old summaries are cleaned
test('refuses with E_GATE_SUMMARY_OLD when the summary has no Checkout line', async () => {
  // Arrange
  const withCheckout = await buildSummary()
  const summary = withCheckout.split('\n').slice(1).join('\n')

  // Act
  const { exit, err } = await runCommand({ summary })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_SUMMARY_OLD: .* has no "Checkout:" line/)
  assert.equal(err.at(-1), 'Fix: pnpm --dir extension gate')
})

// protects=an --allow-dirty trial pass never counts as the gate; fails_when=Checkout: changed passes; no_claim=none beyond the summary text
test('refuses a summary whose gate ran on a changed checkout', async () => {
  // Arrange
  const summary = await buildSummary({ changes: [' M extension/src/a.ts'] })

  // Act
  const { exit, err } = await runCommand({ summary })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_NOT_PASSED: /)
  assert.ok(err.includes('the line "Checkout: clean" is missing'))
  assert.ok(err.includes('found: Checkout: changed (--allow-dirty trial run)'))
})

// protects=a gate that ran another commit does not prove this head; fails_when=GATE: pass on another sha is accepted; no_claim=nothing
test('refuses a summary that passed on another HEAD', async () => {
  // Arrange
  const summary = await buildSummary({ head: OTHER_HEAD })

  // Act
  const { exit, err } = await runCommand({ summary })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_NOT_PASSED: /)
  assert.ok(err.includes(`the line "GATE: pass on ${HEAD}" is missing`))
})

// protects=a failed gate blocks the merge; fails_when=a summary with GATE: fail passes; no_claim=nothing
test('refuses a summary whose gate failed', async () => {
  // Arrange
  const summary = await buildSummary({ codes: { '02-typecheck': 1 } })

  // Act
  const { exit, err } = await runCommand({ summary })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_NOT_PASSED: /)
  assert.ok(err.includes('no passing line for check 02-typecheck'))
  assert.ok(err.includes(`found: GATE: fail (02-typecheck) on ${HEAD}`))
})

// protects=a gate with another check set cannot authorize a merge; fails_when=a summary lacking one GATE_CHECKS line passes; no_claim=nothing
test('refuses a summary that lacks the line of one gate check', async () => {
  // Arrange
  const summary = await buildSummary({ checks: GATE_CHECKS.slice(1) })

  // Act
  const { exit, err } = await runCommand({ summary })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_NOT_PASSED: /)
  assert.ok(err.includes(`no passing line for check ${GATE_CHECKS[0].name}`))
})

// protects=a still-running CI check blocks the merge; fails_when=pending is read as pass; no_claim=GitHub's statuses beyond the ones modelled
test('refuses with E_CHECKS_PENDING when a check run is still in progress', async () => {
  // Arrange
  const responses = {
    [KEY_CHECK_RUNS(HEAD)]: json([
      {
        check_runs: [
          { name: 'Test shard 1', status: 'in_progress', conclusion: null },
        ],
      },
    ]),
  }

  // Act
  const { exit, err, calls } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.deepEqual(err, [
    `E_CHECKS_PENDING: 1 check(s) of ${HEAD} are still running`,
    'check Test shard 1: in_progress/none',
    'Fix: gh pr checks 173 --watch, then rerun this command',
  ])
  assert.deepEqual(mergeCalls(calls), [])
})

// protects=a workflow still starting (no check run yet) is pending, not unseen; fails_when=an in-progress workflow run with zero check runs reads as none or pass; no_claim=nothing
test('treats a queued workflow run with no check run yet as pending', async () => {
  // Arrange
  const responses = {
    [KEY_RUNS(HEAD)]: json([
      { workflow_runs: [{ name: 'Test', status: 'queued', conclusion: null }] },
    ]),
    [KEY_CHECK_RUNS(HEAD)]: json([{ total_count: 0, check_runs: [] }]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.equal(
    err[0],
    `E_CHECKS_PENDING: 1 check(s) of ${HEAD} are still running`,
  )
})

// protects=a failed, cancelled or action_required check blocks the merge; fails_when=any of these reads as pass; no_claim=nothing
test('refuses with E_CHECKS_FAILED for a failing, cancelled and action_required check run', async () => {
  // Arrange
  const responses = {
    [KEY_CHECK_RUNS(HEAD)]: json([
      {
        check_runs: [
          { name: 'lint', status: 'completed', conclusion: 'failure' },
          { name: 'windows', status: 'completed', conclusion: 'cancelled' },
          {
            name: 'deploy',
            status: 'completed',
            conclusion: 'action_required',
          },
          { name: 'ok', status: 'completed', conclusion: 'success' },
        ],
      },
    ]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.deepEqual(err, [
    `E_CHECKS_FAILED: 3 check(s) of ${HEAD} failed`,
    'check lint: completed/failure',
    'check windows: completed/cancelled',
    'check deploy: completed/action_required',
    'Fix: node extension/scripts/ci-failures.mjs 173',
  ])
})

// protects=a failed workflow run blocks the merge even when its check runs vanished; fails_when=workflow runs are not read; no_claim=nothing
test('refuses when a workflow run of the head completed with failure', async () => {
  // Arrange
  const responses = {
    [KEY_RUNS(HEAD)]: json([
      {
        workflow_runs: [
          { name: 'Test', status: 'completed', conclusion: 'failure' },
        ],
      },
    ]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.equal(err[1], 'workflow Test: completed/failure')
})

// protects=a failing commit status blocks the merge and an empty status list is ignored; fails_when=statuses unread, or an empty list counts as pending; no_claim=nothing
test('refuses a failing commit status', async () => {
  // Arrange
  const responses = {
    [KEY_STATUS(HEAD)]: json([
      {
        state: 'failure',
        statuses: [{ context: 'ci/external', state: 'failure' }],
      },
    ]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.equal(err[1], 'status ci/external: failure')
})

// protects=a head with no CI at all is refused, not merged; fails_when=zero workflow runs and zero check runs pass; no_claim=nothing
test('refuses with E_CHECKS_NONE when the head has no workflow run and no check run', async () => {
  // Arrange
  const responses = {
    [KEY_RUNS(HEAD)]: json([{ total_count: 0, workflow_runs: [] }]),
    [KEY_CHECK_RUNS(HEAD)]: json([{ total_count: 0, check_runs: [] }]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.equal(err[0], `E_CHECKS_NONE: no workflow run exists for ${HEAD}`)
})

// protects=a CodeRabbit check is listed but never gates, and alone it is no CI; fails_when=a pending CodeRabbit blocks, or only-CodeRabbit heads pass; no_claim=nothing
test('lists a pending CodeRabbit check without letting it gate, and refuses a head with only CodeRabbit checks', async () => {
  // Arrange
  const pendingCodeRabbit = {
    [KEY_CHECK_RUNS(HEAD)]: json([
      {
        check_runs: [
          { name: 'CodeRabbit', status: 'in_progress', conclusion: null },
          { name: 'Test shard 1', status: 'completed', conclusion: 'success' },
        ],
      },
    ]),
  }
  const onlyCodeRabbit = {
    [KEY_CHECK_RUNS(HEAD)]: json([
      {
        check_runs: [
          { name: 'CodeRabbit', status: 'completed', conclusion: 'success' },
        ],
      },
    ]),
  }

  // Act
  const merged = await runCommand({ responses: pendingCodeRabbit })
  const refused = await runCommand({ responses: onlyCodeRabbit })

  // Assert
  assert.equal(merged.exit, 0)
  assert.equal(merged.out[0], 'not gating: check CodeRabbit: in_progress/none')
  assert.equal(refused.exit, 1)
  assert.equal(
    refused.err[0],
    `E_CHECKS_NONE: no check run other than CodeRabbit exists for ${HEAD}`,
  )
})

// protects=all pages of workflow runs and check runs are read, so a failure past 100 entries is seen; fails_when=only the first page is read; no_claim=gh's own pagination
test('reads every page of workflow runs and check runs and finds a failure on the second page', async () => {
  // Arrange
  const passing = (count) =>
    Array.from({ length: count }, (_, index) => ({
      name: `job ${index}`,
      status: 'completed',
      conclusion: 'success',
    }))
  const responses = {
    [KEY_RUNS(HEAD)]: json([
      { total_count: 101, workflow_runs: passing(100) },
      {
        total_count: 101,
        workflow_runs: [
          { name: 'Late', status: 'completed', conclusion: 'failure' },
        ],
      },
    ]),
    [KEY_CHECK_RUNS(HEAD)]: json([
      { total_count: 101, check_runs: passing(100) },
      {
        total_count: 101,
        check_runs: [
          { name: 'late job', status: 'completed', conclusion: 'timed_out' },
        ],
      },
    ]),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 1)
  assert.deepEqual(err.slice(0, 3), [
    `E_CHECKS_FAILED: 2 check(s) of ${HEAD} failed`,
    'workflow Late: completed/failure',
    'check late job: completed/timed_out',
  ])
})

// protects=CI and the merge use the head of step 1 although a later PR view would name another head; fails_when=the script re-reads the PR head for the CI calls or the merge call; no_claim=a real push race; the fake answers OTHER_HEAD to every PR view after the first
test('reads the CI and merges the head seen first even when a later PR view reports another head', async () => {
  // Arrange
  let views = 0
  const responses = {
    [KEY_VIEW_PR]: () => {
      views += 1
      return prView({ headRefOid: views === 1 ? HEAD : OTHER_HEAD })
    },
  }

  // Act
  const { exit, calls } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 0)
  assert.equal(views, 1)
  assert.deepEqual(mergeCalls(calls), [KEY_MERGE])
  assert.ok(calls.includes(KEY_CHECK_RUNS(HEAD)))
  assert.ok(!calls.some((call) => call.includes(OTHER_HEAD)))
})

// protects=--dry-run changes nothing; fails_when=a merge, fetch or pull is called; no_claim=nothing
test('a dry run prints what it would merge and calls no merge, fetch or pull', async () => {
  // Arrange
  const argv = [PR, '--dry-run']

  // Act
  const { exit, out, calls } = await runCommand({ argv })

  // Assert
  assert.equal(exit, 0)
  assert.equal(out.at(-1), `would merge 173 at ${HEAD}`)
  assert.ok(calls.every((call) => !/^(gh pr merge|git )/.test(call)))
})

// protects=a dry run still refuses what a real run refuses; fails_when=dry run exits 0 with failing checks; no_claim=nothing
test('a dry run exits 1 when a check failed', async () => {
  // Arrange
  const responses = {
    [KEY_STATUS(HEAD)]: json([
      { state: 'failure', statuses: [{ context: 'x', state: 'error' }] },
    ]),
  }

  // Act
  const { exit } = await runCommand({ argv: [PR, '--dry-run'], responses })

  // Assert
  assert.equal(exit, 1)
})

// protects=gh failures in the read-only steps are one refusal with redacted stderr; fails_when=a token reaches output, or the exit code is not 1; no_claim=gh's real messages
test('reports a gh failure as E_GH with exit 1 and hides the token in its stderr', async () => {
  // Arrange
  const environment = { GH_TOKEN: 'ghp_exampletoken123' }
  const responses = {
    [KEY_VIEW_PR]: failed('HTTP 401: bad credentials ghp_exampletoken123'),
  }

  // Act
  const { exit, err, calls } = await runCommand({ responses, environment })

  // Assert
  assert.equal(exit, 1)
  assert.deepEqual(err, [
    'E_GH: gh pr view failed: HTTP 401: bad credentials [redacted]',
    'Fix: gh auth status',
  ])
  assert.deepEqual(mergeCalls(calls), [])
})

// protects=a failed merge on a still-open PR is exit 2 and does not touch main; fails_when=exit 1/3/4 or a sync after the failure; no_claim=GitHub's reasons
test('exits 2 with E_MERGE_FAILED when gh pr merge fails and the PR is still open', async () => {
  // Arrange
  const responses = {
    [KEY_MERGE]: failed(
      'Head branch was modified. Review and try the merge again.',
    ),
    [KEY_REREAD]: json({ state: 'OPEN', headRefOid: HEAD }),
  }

  // Act
  const { exit, err, calls } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 2)
  assert.equal(
    err[0],
    'E_MERGE_FAILED: gh pr merge failed and PR 173 is still OPEN: Head branch was modified. Review and try the merge again.',
  )
  assert.ok(!calls.includes('git fetch origin main:main'))
})

// protects=a lost merge response is not reported as failure; fails_when=a failed call whose re-check reads MERGED at the step-1 head exits nonzero; no_claim=nothing
test('continues as merged when the merge call failed but the PR reads MERGED at the head', async () => {
  // Arrange
  const responses = { [KEY_MERGE]: failed('connection reset') }

  // Act
  const { exit, out } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 0)
  assert.equal(out.at(-1), `local main ${MAIN_SHA}`)
})

// protects=another actor's merge is never reported as ours; fails_when=MERGED at another head counts as success; no_claim=nothing
test('exits 4 with E_MERGED_OTHER_HEAD when the PR reads MERGED at another head after a failed merge call', async () => {
  // Arrange
  const responses = {
    [KEY_MERGE]: failed('already merged'),
    [KEY_REREAD]: json({ state: 'MERGED', headRefOid: OTHER_HEAD }),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 4)
  assert.equal(
    err[0],
    `E_MERGED_OTHER_HEAD: PR 173 is MERGED at ${OTHER_HEAD}, not at ${HEAD}`,
  )
  assert.equal(
    err.at(-1),
    'Fix: audit gh pr view 173 --json state,headRefOid,mergeCommit',
  )
})

// protects=an unreadable outcome is unknown (4), never "not merged"; fails_when=the failed re-check exits 1/2; no_claim=nothing
test('exits 4 with E_MERGE_UNKNOWN when the re-check after a failed merge call fails', async () => {
  // Arrange
  const responses = {
    [KEY_MERGE]: failed('timeout'),
    [KEY_REREAD]: failed('network down'),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 4)
  assert.equal(
    err[0],
    'E_MERGE_UNKNOWN: could not read PR 173 after the merge call (exit 1)',
  )
  assert.equal(
    err.at(-1),
    'Fix: gh pr view 173 --json state,mergeCommit, then rerun merge-pr',
  )
})

// protects=an exit-0 merge is verified, not trusted; fails_when=an exit 0 with the PR still OPEN, or MERGED at another head, is success; no_claim=merge queues (the repository uses none)
test('re-reads the PR after an exit-0 merge and exits 4 unless it is MERGED at the step-1 head', async () => {
  // Arrange
  const stillOpen = { [KEY_REREAD]: json({ state: 'OPEN', headRefOid: HEAD }) }
  const otherHead = {
    [KEY_REREAD]: json({ state: 'MERGED', headRefOid: OTHER_HEAD }),
  }

  // Act
  const open = await runCommand({ responses: stillOpen })
  const moved = await runCommand({ responses: otherHead })

  // Assert
  assert.equal(open.exit, 4)
  assert.equal(
    open.err[0],
    'E_MERGE_UNKNOWN: gh pr merge exited 0 but PR 173 reads OPEN',
  )
  assert.equal(moved.exit, 4)
  assert.match(moved.err[0], /^E_MERGED_OTHER_HEAD: /)
})

// protects=a rerun after exit 3 or 4 resumes at the local sync without a second merge; fails_when=gh pr merge or the CI reads run again; no_claim=nothing
test('a rerun on an already merged PR whose gate passed skips CI and merge and syncs local main', async () => {
  // Arrange
  const responses = {
    [KEY_VIEW_PR]: prView({
      state: 'MERGED',
      mergeCommit: { oid: MERGE_COMMIT },
    }),
  }

  // Act
  const { exit, out, calls } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 0)
  assert.deepEqual(out, [
    `already merged at ${MERGE_COMMIT}`,
    `merge commit ${MERGE_COMMIT}`,
    `local main ${MAIN_SHA}`,
  ])
  assert.deepEqual(mergeCalls(calls), [])
  assert.ok(!calls.some((call) => call.startsWith('gh api')))
  assert.ok(calls.includes('git fetch origin main:main'))
})

// protects=a merged PR without a passing gate summary is still refused; fails_when=resume skips step 2; no_claim=nothing
test('a rerun on a merged PR still requires the gate summary', async () => {
  // Arrange
  const responses = { [KEY_VIEW_PR]: prView({ state: 'MERGED' }) }

  // Act
  const { exit, err } = await runCommand({ responses, summary: null })

  // Assert
  assert.equal(exit, 1)
  assert.match(err[0], /^E_GATE_MISSING: /)
})

// protects=an unreadable merge commit does not fail a completed merge; fails_when=the command stops or exits nonzero; no_claim=nothing
test('prints "merge commit unknown" and still syncs main when the merge commit cannot be read', async () => {
  // Arrange
  const responses = { [KEY_MERGE_COMMIT]: failed('boom') }

  // Act
  const { exit, out } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 0)
  assert.ok(out.includes('merged; merge commit unknown (boom)'))
  assert.ok(out.includes('merge commit unknown'))
})

// protects=PR numbers are validated before any gh call; fails_when=a non-digit reaches gh arguments; no_claim=nothing
test('refuses a PR number that is not digits, a missing number and an unknown option with exit 64 and no call', async () => {
  // Arrange
  const argvs = [['17x'], ['--', '-5'], [], ['173', '--merge']]

  for (const argv of argvs) {
    // Act
    const { exit, err, calls } = await runCommand({ argv })

    // Assert
    assert.equal(exit, 64)
    assert.match(err[0], /^E_USAGE: /)
    assert.equal(err.at(-1), 'Fix: node extension/scripts/merge-pr.mjs --help')
    assert.deepEqual(calls, [])
  }
})

// protects=--help documents usage, example, exit codes and every error code; fails_when=a code the script throws is missing from the help; no_claim=wording
test('--help prints usage, the example, exit codes and error codes', async () => {
  // Arrange
  const argv = ['--help']

  // Act
  const { exit, out, calls } = await runCommand({ argv })

  // Assert
  assert.equal(exit, 0)
  assert.equal(out.join('\n'), HELP_TEXT)
  assert.deepEqual(calls, [])
  for (const code of [
    'E_USAGE',
    'E_GH',
    'E_PR_STATE',
    'E_GATE_MISSING',
    'E_GATE_SUMMARY_OLD',
    'E_GATE_NOT_PASSED',
    'E_CHECKS_PENDING',
    'E_CHECKS_FAILED',
    'E_CHECKS_NONE',
    'E_MERGE_FAILED',
    'E_MERGE_UNKNOWN',
    'E_MERGED_OTHER_HEAD',
    'E_LOCAL_MAIN',
    'E_INTERNAL',
  ])
    assert.ok(HELP_TEXT.includes(code), code)
  assert.ok(HELP_TEXT.includes('node extension/scripts/merge-pr.mjs 173'))
})

// protects=an unexpected exception after the merge call is outcome unknown (4); fails_when=E_INTERNAL exits 2 after a side effect; no_claim=nothing
test('an unexpected exception after the merge started exits 4 with E_INTERNAL', async () => {
  // Arrange
  const responses = {
    'git rev-parse main': () => {
      throw new Error('disk gone')
    },
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 4)
  assert.equal(err[0], 'E_INTERNAL: disk gone')
  assert.equal(err[1], 'Stage: sync the local main')
})

// protects=a failed merge call on a PR that reads CLOSED is not reported as still open; fails_when=the message says "still CLOSED"; no_claim=GitHub's reasons
test('words E_MERGE_FAILED by the actual state when the PR reads CLOSED after a failed merge call', async () => {
  // Arrange
  const responses = {
    [KEY_MERGE]: failed('Pull request is closed'),
    [KEY_REREAD]: json({ state: 'CLOSED', headRefOid: HEAD }),
  }

  // Act
  const { exit, err } = await runCommand({ responses })

  // Assert
  assert.equal(exit, 2)
  assert.equal(
    err[0],
    'E_MERGE_FAILED: gh pr merge failed and PR 173 reads CLOSED: Pull request is closed',
  )
})

// protects=a stalled external call ends as a failed call; fails_when=the runner waits past its time limit; no_claim=the 120 s production limit; a 200 ms limit and a node child stand in
test('createCommandRunner ends a call that exceeds its time limit with a failure status', async () => {
  // Arrange
  const run = createCommandRunner(tmpdir(), process.env, 200)

  // Act
  const startedAt = Date.now()
  const result = await run(process.execPath, [
    '-e',
    'setTimeout(() => {}, 10000)',
  ])

  // Assert
  assert.equal(result.status, 127)
  // gstack-timing-ok: the bound is the contract (the 10 s child is ended near the 200 ms limit); 5 s is far above any load delay and far below 10 s.
  assert.ok(Date.now() - startedAt < 5000)
})

// protects=git never waits on a credential prompt; fails_when=git runs without GIT_TERMINAL_PROMPT=0; no_claim=a real prompt; a git alias echoing the variable stands in
test('createCommandRunner runs git with GIT_TERMINAL_PROMPT=0', async () => {
  // Arrange
  const run = createCommandRunner(tmpdir(), { PATH: process.env.PATH })

  // Act
  const result = await run('git', [
    '-c',
    'alias.show-prompt=!echo $GIT_TERMINAL_PROMPT',
    'show-prompt',
  ])

  // Assert
  assert.equal(result.stdout, '0\n')
})
