import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  GATE_CHECKS,
  pinMismatches,
  readPins,
  runCommand,
  runGate,
} from '../gate.mjs'
import { plainOutputEnvironment } from '../utils/plainOutputEnvironment.mjs'

const GATE_SCRIPT = fileURLToPath(new URL('../gate.mjs', import.meta.url))

/** Runs {@link runGate} on checks named in `codes`, each exiting with its code, with HEAD and the changes the readers answer in turn. @example await gateOver({ a: 0 }) // => { verdict: { passed: true, … }, lines: [...] } */
async function gateOver(
  codes,
  { heads = ['abc', 'abc'], changes = [[], []] } = {},
) {
  const lines = []
  const ran = []
  const verdict = await runGate({
    checks: Object.keys(codes).map((name) => ({ name })),
    out: '/gate-out',
    readHead: async () => heads.shift(),
    listChanges: async () => changes.shift(),
    runCheck: async (check, logPath) => {
      ran.push([check.name, logPath])
      return codes[check.name]
    },
    print: (line) => lines.push(line),
  })
  return { verdict, lines, ran }
}

// Value: protects=the gate's verdict, the reason it exists (Cycle 0058 retro: a gate that piped its summary through `tail` reported success while nine checks had failed with exit 127); fails_when=a failing check stops the later checks, or the verdict passes with a check that exited non-zero; why_new=the gate was an uncommitted shell script with no test; seam=runGate with checks and readers of the test; no_claim=the real checks' commands (their own scripts and workflows)
test('a failing check fails the gate, and every later check still runs', async () => {
  // Arrange
  const codes = { '01-a': 0, '02-b': 127, '03-c': 0 }

  // Act
  const { verdict, lines, ran } = await gateOver(codes)

  // Assert
  assert.equal(verdict.passed, false)
  assert.deepEqual(
    ran.map(([name]) => name),
    ['01-a', '02-b', '03-c'],
  )
  assert.equal(lines.at(-1), 'GATE: fail (02-b) on abc')
})

// Value: protects=a passing gate, its log per check and its verdict line; fails_when=a passing run reports fail, or a check's log is not its own file in the output folder; why_new=Cycle 0058 retro (the gate became a committed script); seam=runGate with checks of the test; no_claim=the logs' contents
test('a run whose checks all pass on an unchanged HEAD passes, with one log per check', async () => {
  // Arrange
  const codes = { '01-a': 0, '02-b': 0 }

  // Act
  const { verdict, lines, ran } = await gateOver(codes)

  // Assert
  assert.equal(verdict.passed, true)
  assert.deepEqual(ran, [
    ['01-a', '/gate-out/01-a.log'],
    ['02-b', '/gate-out/02-b.log'],
  ])
  assert.equal(lines.at(-1), 'GATE: pass on abc')
})

// Value: protects=the exact-HEAD property: a commit or an edit made while the gate runs makes its checks prove no single tree; fails_when=a run whose HEAD moved, or whose checkout changed, still passes; why_new=Cycle 0058 retro; seam=runGate with readers that answer another HEAD or other changes after the checks; no_claim=which of the checks saw which tree
test('a run during which HEAD moved or the checkout changed fails although every check passed', async () => {
  // Arrange
  const codes = { '01-a': 0 }

  // Act
  const movedHead = await gateOver(codes, { heads: ['abc', 'def'] })
  const changedTree = await gateOver(codes, {
    changes: [[], [' M README.md']],
  })

  // Assert
  assert.equal(movedHead.verdict.passed, false)
  assert.ok(movedHead.lines.includes('HEAD moved from abc to def.'))
  assert.equal(changedTree.verdict.passed, false)
  assert.ok(changedTree.lines.includes('the checkout changed during the run.'))
})

// Value: protects=the gate on the pinned toolchain only (Cycle 0058: a version manager's shim ran the suite on Node 24.22.1 under extension/ while .node-version pinned 24.21.0, and an editor's own Node is another); fails_when=a Node or pnpm that differs from its pin passes the check, or the sentence does not name both versions; why_new=Cycle 0058 retro; seam=none; no_claim=how the running pnpm version is read
test('a Node or pnpm that differs from its pin is named with both versions', () => {
  // Arrange
  const pins = { node: '24.22.1', pnpm: '12.4.2' }

  // Act
  const matching = pinMismatches(pins, { node: '24.22.1', pnpm: '12.4.2' })
  const otherNode = pinMismatches(pins, { node: '24.21.0', pnpm: '12.4.2' })
  const unknownPnpm = pinMismatches(pins, { node: '24.22.1', pnpm: undefined })

  // Assert
  assert.deepEqual(matching, [])
  assert.deepEqual(otherNode, [
    'Node 24.21.0 runs here, but .node-version pins 24.22.1.',
  ])
  assert.deepEqual(unknownPnpm, [
    'pnpm of an unknown version runs here, but extension/package.json pins 12.4.2.',
  ])
})

// Value: protects=the pins the gate compares with: .node-version as written, and the pnpm version of packageManager without its integrity suffix; fails_when=a trailing newline or the `+sha512…` suffix makes every run a mismatch; why_new=Cycle 0058 retro; seam=a repository folder of the test; no_claim=a packageManager naming another tool
test('the pins are read from .node-version and from packageManager without its integrity suffix', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-gate-pins-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'extension'))
  await writeFile(join(root, '.node-version'), '24.22.1\n')
  await writeFile(
    join(root, 'extension/package.json'),
    JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.08adc661' }),
  )

  // Act
  const pins = await readPins(root)

  // Assert
  assert.deepEqual(pins, { node: '24.22.1', pnpm: '12.4.2' })
})

// Value: protects=the gate's composition and order, the fifteen checks AGENTS.md names; fails_when=a check is dropped, added or reordered without this list changing with it; why_new=Cycle 0058 retro (the list lived in a copied shell script); seam=none; no_claim=each check's command
test('the gate runs the fifteen delivery checks in their order', () => {
  // Arrange
  const expected = [
    '01-format-check',
    '02-typecheck',
    '03-lint',
    '04-health-static',
    '05-dupes',
    '06-dead-code',
    '07-test',
    '08-study-bootstrap',
    '09-wiki-reader-dom',
    '10-study-reading-pose',
    '11-understanding-focus',
    '12-repository-return',
    '13-test-package',
    '14-health',
    '15-restore-context',
  ]

  // Act
  const names = GATE_CHECKS.map((check) => check.name)

  // Assert
  assert.deepEqual(names, expected)
})

// Value: protects=the command line's refusal before any check, with exit 2 and one sentence; fails_when=an unknown option is ignored and the checks start, or the refusal exits 0 or 1; why_new=Cycle 0058 retro; seam=the script started as a process; no_claim=the refusal of a dirty checkout or a toolchain mismatch (their own functions are tested above)
test('an unknown option is refused with exit 2 before any check runs', () => {
  // Arrange
  const environment = plainOutputEnvironment(process.env)

  // Act
  const result = spawnSync(
    process.execPath,
    [GATE_SCRIPT, '--no-such-option'],
    {
      encoding: 'utf8',
      env: environment,
      timeout: 30_000,
    },
  )

  // Assert
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^Gate refused: /)
  assert.equal(result.stdout, '')
})

// Value: protects=one Node for the whole repository: vite-plus's `node` shim reads the nearest package's `engines.node` under extension/ instead of the root `.node-version` (Cycle 0058: 24.22.1 ran there while the root pinned 24.21.0), so extension/.node-version repeats the root pin; fails_when=one of the two files changes without the other; why_new=Cycle 0058 retro; seam=the repository's own files; no_claim=what a version manager reads
test('extension/.node-version pins the same Node as the root .node-version', async () => {
  // Arrange
  const repository = fileURLToPath(new URL('../../../', import.meta.url))

  // Act
  const [root, extension] = await Promise.all([
    readFile(join(repository, '.node-version'), 'utf8'),
    readFile(join(repository, 'extension/.node-version'), 'utf8'),
  ])

  // Assert
  assert.equal(extension, root)
})

// Value: protects=a gate that cannot hang: a check that prints nothing for the silence bound has its process tree ended and fails as exit 124, with a sentence in its log (local CodeRabbit CLI on the retro PR); fails_when=the gate waits for a silent check without end, or reports it as passed; why_new=the committed gate had no bound; seam=a real Node process that stays silent; no_claim=the 300 s default, and the end on a signal (endChildrenOnSignal's own tests)
test('a check silent past the bound is ended and fails with exit 124', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-gate-silence-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const logPath = join(folder, 'silent.log')
  const startedAt = Date.now()

  // Act
  const code = await runCommand(
    {
      file: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      cwd: folder,
    },
    logPath,
    300,
  )

  // Assert
  assert.equal(code, 124)
  assert.match(
    await readFile(logPath, 'utf8'),
    /Gate: no output for 0\.3 s; the check's process tree was ended\./,
  )
  // gstack-timing-ok: the bound is 0.3 s and the process would run 60 s; 20 s only says the gate did not wait for it.
  assert.ok(Date.now() - startedAt < 20_000)
})

// Value: protects=the silence option's refusal before any check; fails_when=a bound of 0, a negative or a non-number starts the checks; why_new=local CodeRabbit CLI on the retro PR (the option was added with the bound); seam=the script started as a process; no_claim=other options
test('a silence bound that is no whole number of seconds is refused with exit 2', () => {
  // Arrange
  const environment = plainOutputEnvironment(process.env)

  // Act
  const result = spawnSync(
    process.execPath,
    [GATE_SCRIPT, '--silence-seconds', '0'],
    { encoding: 'utf8', env: environment, timeout: 30_000 },
  )

  // Assert
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--silence-seconds takes a whole number/)
})
