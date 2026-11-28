import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
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
  suiteVerdict,
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

// protects=merge-pr.mjs can tell a real gate from an --allow-dirty trial run (Cycle 0068 D13): the summary's first line says the checkout was clean; fails_when=runGate drops the Checkout line or prints it after the checks; no_claim=the summary file itself (main collects the printed lines); injected listChanges stands in for git
test('a gate started on a clean checkout prints "Checkout: clean" as its first line', async () => {
  // Arrange
  const codes = { '01-a': 0 }

  // Act
  const { lines } = await gateOver(codes, { changes: [[], []] })

  // Assert
  assert.deepEqual(lines, [
    'Checkout: clean',
    '01-a exit=0 seconds=0',
    'GATE: pass on abc',
  ])
})

// protects=a trial run on a changed checkout is marked so it never counts as the gate; fails_when=a changed checkout prints "Checkout: clean"; no_claim=the summary file itself; injected listChanges stands in for git
test('a gate started on a changed checkout prints "Checkout: changed (--allow-dirty trial run)" as its first line', async () => {
  // Arrange
  const codes = { '01-a': 0 }

  // Act
  const { lines } = await gateOver(codes, {
    changes: [[' M README.md'], [' M README.md']],
  })

  // Assert
  assert.equal(lines[0], 'Checkout: changed (--allow-dirty trial run)')
})

// Value: protects=the gate on the pinned toolchain only (Cycle 0058: a version manager's shim ran the suite on Node 24.22.1 under extension/ while .node-version pinned 24.21.0, and an editor's own Node is another); fails_when=a Node or pnpm that differs from its pin passes the check, or the sentence does not name both versions; why_new=Cycle 0058 retro; seam=none; no_claim=how the running pnpm version is read
test('a Node or pnpm that differs from its pin is named with both versions', () => {
  // Arrange
  const pins = { node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' }

  // Act
  const matching = pinMismatches(pins, {
    node: '24.22.1',
    pnpm: '12.4.2',
    bun: '1.4.4',
  })
  const otherNode = pinMismatches(pins, {
    node: '24.21.0',
    pnpm: '12.4.2',
    bun: '1.4.4',
  })
  const unknownPnpm = pinMismatches(pins, {
    node: '24.22.1',
    pnpm: undefined,
    bun: '1.4.4',
  })

  // Assert
  assert.deepEqual(matching, [])
  assert.deepEqual(otherNode, [
    'Node 24.21.0 runs here, but .node-version pins 24.22.1.',
  ])
  assert.deepEqual(unknownPnpm, [
    'pnpm of an unknown version runs here, but extension/package.json pins 12.4.2.',
  ])
})

// Value: protects=the format check on the Bun CI installs (Cycle 0062 pt2 review: `bun fmt` ran on whatever Bun the PATH held, while the Format workflow pins one, so the gate and CI could format differently); fails_when=a Bun of another version, or no Bun at all, passes the toolchain check, or the sentence does not name both versions; why_new=Cycle 0062 pt2 OCR finding F2; seam=none; no_claim=how the running Bun version is read
test('a Bun that differs from .bun-version, or no Bun on the path, is named with the pinned version', () => {
  // Arrange
  const pins = { node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' }

  // Act
  const otherBun = pinMismatches(pins, {
    node: '24.22.1',
    pnpm: '12.4.2',
    bun: '1.4.3',
  })
  const missingBun = pinMismatches(pins, {
    node: '24.22.1',
    pnpm: '12.4.2',
    bun: undefined,
  })

  // Assert
  assert.deepEqual(otherBun, [
    'Bun 1.4.3 runs here, but .bun-version pins 1.4.4.',
  ])
  assert.deepEqual(missingBun, [
    'Bun of an unknown version runs here, but .bun-version pins 1.4.4.',
  ])
})

// Value: protects=the pins the gate compares with: .node-version and .bun-version as written, and the pnpm version of packageManager without its integrity suffix; fails_when=a trailing newline or the `+sha512…` suffix makes every run a mismatch, or the Bun pin is not read; why_new=Cycle 0058 retro, Cycle 0062 pt2 OCR finding F2; seam=a repository folder of the test; no_claim=a packageManager naming another tool
test('the pins are read from .node-version, .bun-version and from packageManager without its integrity suffix', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-gate-pins-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'extension'))
  await writeFile(join(root, '.node-version'), '24.22.1\n')
  await writeFile(join(root, '.bun-version'), '1.4.4\n')
  await writeFile(
    join(root, 'extension/package.json'),
    JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.08adc661' }),
  )

  // Act
  const pins = await readPins(root)

  // Assert
  assert.deepEqual(pins, { node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' })
})

// Value: protects=a refusal, not a crash, when a pin file is missing (a stripped checkout or worktree): readPins names the file, which the gate prints as its refusal with exit 2; fails_when=readPins rejects with Node's raw ENOENT text, so the gate fails with exit 1 and a stack instead of the documented refusal; why_new=Cycle 0062 pt2 native adversarial finding 5; seam=a repository folder of the test; no_claim=the exit code of the process (main is not exported; its catch prints this message)
test('a missing .bun-version is named, so the gate refuses instead of failing on a raw file error', async (context) => {
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
  const reading = readPins(root)

  // Assert
  await assert.rejects(reading, {
    message: '.bun-version cannot be read (ENOENT).',
  })
})

// Value: protects=the pnpm pin never passing as a match when it cannot be read: a packageManager without a pnpm version, or a manifest that is no JSON, is named, so the gate refuses instead of comparing an undefined pin with an unreadable running pnpm; fails_when=readPins returns pnpm undefined (undefined === undefined passes) or rejects with a raw SyntaxError; why_new=Cycle 0062 pt2 native adversarial round 2; seam=a repository folder of the test; no_claim=the process exit code (main prints this message as its refusal)
test('a manifest without a pnpm version, or not JSON, is named, so an unreadable pnpm pin never passes as a match', async (context) => {
  // Arrange
  const withoutPnpm = await mkdtemp(join(tmpdir(), 'codebook-gate-pins-'))
  const notJson = await mkdtemp(join(tmpdir(), 'codebook-gate-pins-'))
  context.after(() => rm(withoutPnpm, { recursive: true, force: true }))
  context.after(() => rm(notJson, { recursive: true, force: true }))
  for (const root of [withoutPnpm, notJson]) {
    await mkdir(join(root, 'extension'))
    await writeFile(join(root, '.node-version'), '24.22.1\n')
    await writeFile(join(root, '.bun-version'), '1.4.4\n')
  }
  await writeFile(
    join(withoutPnpm, 'extension/package.json'),
    JSON.stringify({ name: 'codebook' }),
  )
  await writeFile(join(notJson, 'extension/package.json'), '{ not json')

  // Act: both rejections are caught as they happen, so neither is unhandled while the other is awaited.
  const [withoutPnpmError, notJsonError] = await Promise.all(
    [withoutPnpm, notJson].map((root) =>
      readPins(root).then(
        () => undefined,
        (error) => error,
      ),
    ),
  )

  // Assert
  assert.equal(
    withoutPnpmError?.message,
    'extension/package.json names no pnpm version in packageManager.',
  )
  assert.match(
    notJsonError?.message ?? '',
    /^extension\/package\.json cannot be read \(/,
  )
})

// Value: protects=the gate's composition and order, the sixteen checks AGENTS.md names, the architecture check CI requires included; fails_when=a check is dropped, added or reordered without this list changing with it; why_new=Cycle 0058 retro (the list lived in a copied shell script), Cycle 0062 pt2 OCR finding F3 (the architecture job was not in the gate); seam=none; no_claim=each check's command
test('the gate runs the sixteen delivery checks in their order, the import-cycle check included', () => {
  // Arrange
  const expected = [
    '01-format-check',
    '02-typecheck',
    '03-lint',
    '04-health-static',
    '05-dupes',
    '06-dead-code',
    '07-architecture',
    '08-build',
    '09-study-bootstrap',
    '10-wiki-reader-dom',
    '11-study-reading-pose',
    '12-understanding-focus',
    '13-repository-return',
    '14-test-package',
    '15-health',
    '16-restore-context',
  ]

  // Act
  const names = GATE_CHECKS.map((check) => check.name)

  // Assert
  assert.deepEqual(names, expected)
})

// protects=the gate runs the extension's suite once: 08 only builds, and 15-health, which runs every test under c8, is the one check that carries the suite's verdict; fails_when=a second suite run returns to the gate, or no check carries the suite, so the gate could pass without one; no_claim=that the health script runs every test file, which its own tests pin
test('the gate builds in step 08 and takes the suite verdict from the measured-health check alone', () => {
  // Arrange
  const byName = new Map(GATE_CHECKS.map((check) => [check.name, check]))

  // Act
  const carriers = GATE_CHECKS.filter((check) => check.carriesSuite).map(
    (check) => check.name,
  )

  // Assert
  assert.deepEqual(byName.get('08-build'), {
    name: '08-build',
    script: 'build',
  })
  assert.deepEqual(carriers, ['15-health'])
  assert.equal(
    GATE_CHECKS.some((check) => check.script === 'test'),
    false,
  )
})

// protects=a passed suite is reported with the test runner's own counts, read from the last summary block of the carrying check's log; fails_when=the gate passes the suite without counts, or reads a line a test printed instead of the runner's summary; no_claim=none beyond protects
test('the check that carries the suite passes with the runner’s counts in the gate’s output', async () => {
  // Arrange
  const log =
    'ℹ tests 99\n✔ a test that printed a summary-like line\nℹ tests 15644\nℹ suites 0\nℹ pass 15626\nℹ fail 0\nℹ cancelled 0\nℹ skipped 10\nℹ todo 8\nℹ duration_ms 250000.5\nFallow: no finding beyond the baseline\n'
  const lines = []

  // Act
  const verdict = await runGate({
    checks: [{ name: '15-health', script: 'health', carriesSuite: true }],
    out: '/gate-out',
    readHead: async () => 'abc',
    listChanges: async () => [],
    runCheck: async () => 0,
    print: (line) => lines.push(line),
    readLog: async () => log,
  })

  // Assert
  assert.equal(verdict.passed, true)
  assert.equal(
    lines[1],
    '15-health suite: tests=15644 pass=15626 fail=0 skipped=10 todo=8',
  )
  assert.equal(lines.at(-1), 'GATE: pass on abc')
})

for (const [situation, log, line] of [
  [
    'holds no summary of a test run',
    'Fallow: no finding beyond the baseline\n',
    '15-health suite verdict missing: its log holds no summary of a test run.',
  ],
  [
    'counts a failed test',
    'ℹ tests 3\nℹ pass 2\nℹ fail 1\n',
    '15-health suite verdict missing: the test run counts no test, or a failed or cancelled one (suite: tests=3 pass=2 fail=1 skipped=0 todo=0).',
  ],
  [
    'counts a cancelled test',
    'ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ cancelled 1\n',
    '15-health suite verdict missing: the test run counts no test, or a failed or cancelled one (suite: tests=3 pass=2 fail=0 skipped=0 todo=0).',
  ],
  [
    'counts no test',
    'ℹ tests 0\nℹ pass 0\nℹ fail 0\n',
    '15-health suite verdict missing: the test run counts no test, or a failed or cancelled one (suite: tests=0 pass=0 fail=0 skipped=0 todo=0).',
  ],
])
  // protects=the gate fails when the check that carries the suite exits 0 without proof of a passed test run; fails_when=a health check that ran no suite, or whose suite failed or was cut short, passes the gate; no_claim=none beyond protects
  test(`the gate fails when the log of the check that carries the suite ${situation}`, async () => {
    // Arrange
    const lines = []

    // Act
    const verdict = await runGate({
      checks: [{ name: '15-health', script: 'health', carriesSuite: true }],
      out: '/gate-out',
      readHead: async () => 'abc',
      listChanges: async () => [],
      runCheck: async () => 0,
      print: (printed) => lines.push(printed),
      readLog: async () => log,
    })

    // Assert
    assert.equal(verdict.passed, false)
    assert.deepEqual(verdict.results, [
      { name: '15-health', code: 3, seconds: 0 },
    ])
    assert.equal(lines[1], line)
    assert.equal(suiteVerdict(log).passed, false)
    assert.equal(lines.at(-1), 'GATE: fail (15-health) on abc')
  })

// Value: protects=the gate's import-cycle check fails a new cycle: 07-architecture runs a package script that fails on findings beyond a baseline holding no cycle, and every script the gate runs exists; fails_when=a retake absorbs a cycle into the baseline, the script loses --fail-on-issues or its baseline, or a gate script is missing from package.json; why_new=Cycle 0062 pt2 task 20 (no new cycle may appear); seam=none; no_claim=that Fallow finds every cycle
test('the gate fails a new import cycle: its architecture script fails beyond a baseline that holds no cycle', async () => {
  // Arrange
  const extensionRoot = fileURLToPath(new URL('../../', import.meta.url))
  const manifest = JSON.parse(
    await readFile(join(extensionRoot, 'package.json'), 'utf8'),
  )
  const baseline = JSON.parse(
    await readFile(
      join(extensionRoot, 'fallow-architecture-baseline.json'),
      'utf8',
    ),
  )

  // Act
  const architectureCheck = GATE_CHECKS.find(
    (check) => check.name === '07-architecture',
  )
  const missingScripts = GATE_CHECKS.flatMap((check) =>
    check.script === undefined ? [] : [check.script],
  ).filter((script) => typeof manifest.scripts[script] !== 'string')
  const recordedCycles = {
    circular_dependencies: baseline.circular_dependencies,
    re_export_cycles: baseline.re_export_cycles,
    package_cycles: baseline.package_cycles,
  }

  // Assert
  assert.equal(architectureCheck?.script, 'architecture')
  assert.equal(
    manifest.scripts.architecture,
    'fallow architecture --fail-on-issues --baseline fallow-architecture-baseline.json',
  )
  assert.deepEqual(recordedCycles, {
    circular_dependencies: [],
    re_export_cycles: [],
    package_cycles: [],
  })
  assert.deepEqual(missingScripts, [])
})

// Value: protects=the gate refusing, before any check, a Bun other than .bun-version's on the path the checks use, or none at all (the format check runs bun fmt); fails_when=main stops asking the path's Bun for its version, or a mismatch or a missing Bun no longer refuses with exit 2; why_new=Cycle 0062 pt2 OCR finding F2 (pinMismatches alone does not prove the wiring); seam=none; no_claim=the Node and pnpm parts of the refusal (tested above)
test(
  'the gate refuses with exit 2 a Bun of another version on the path, or none, before any check runs',
  // POSIX only: the stand-in Bun is a shell script, which Windows cannot start as `bun`.
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange: the gate puts its own Node's folder first on the checks' path, so it runs from a copy of this Node in a folder
    // of its own, where a real Bun installed beside Node (Homebrew, a version manager) cannot answer for the fake one.
    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
    const pins = await readPins(repositoryRoot)
    const isolatedBin = await mkdtemp(join(tmpdir(), 'codebook-gate-bun-'))
    context.after(() => rm(isolatedBin, { recursive: true, force: true }))
    const isolatedNode = join(isolatedBin, 'node')
    await copyFile(process.execPath, isolatedNode)
    await chmod(isolatedNode, 0o755)
    const fakeBun = join(isolatedBin, 'bun')
    await writeFile(fakeBun, '#!/bin/sh\necho 1.4.3\n', { mode: 0o755 })
    const environment = {
      ...plainOutputEnvironment(process.env),
      PATH: isolatedBin,
      npm_config_user_agent: `pnpm/${pins.pnpm} node/v${process.versions.node}`,
    }

    // Act
    const otherBun = spawnSync(isolatedNode, [GATE_SCRIPT], {
      encoding: 'utf8',
      env: environment,
      timeout: 30_000,
    })
    await rm(fakeBun)
    const noBun = spawnSync(isolatedNode, [GATE_SCRIPT], {
      encoding: 'utf8',
      env: environment,
      timeout: 30_000,
    })

    // Assert
    assert.equal(otherBun.status, 2)
    assert.ok(
      otherBun.stderr.includes(
        `Bun 1.4.3 runs here, but .bun-version pins ${pins.bun}.`,
      ),
    )
    assert.equal(otherBun.stdout, '')
    assert.equal(noBun.status, 2)
    assert.ok(
      noBun.stderr.includes(
        `Bun of an unknown version runs here, but .bun-version pins ${pins.bun}.`,
      ),
    )
    assert.equal(noBun.stdout, '')
  },
)

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
