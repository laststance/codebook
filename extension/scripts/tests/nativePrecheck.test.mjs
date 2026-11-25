import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  countProcessKinds,
  decideVerdict,
  HELP_TEXT,
  parseProcessRows,
  parseSwapUsage,
  runNativePrecheck,
} from '../native-precheck.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'

/** The script as a file, for the tests that start it as a process the way the driving agent does. */
const SCRIPT_PATH = fileURLToPath(
  new URL('../native-precheck.mjs', import.meta.url),
)

/** The counts of a machine on which no build or test process runs. */
const NOTHING_RUNS = {
  nodeTest: 0,
  testShard: 0,
  pregateTests: 0,
  tsc: 0,
  fallow: 0,
  c8: 0,
  pnpmInstall: 0,
  package: 0,
  health: 0,
  gate: 0,
}

/**
 * Runs the command like its entry point does, with the machine readings given, and collects what it prints.
 * @param {string[]} argv - Arguments after the script name.
 * @param {object} readings - What the fake machine reader answers (load averages, cores, swap text, process rows).
 * @returns {Promise<{ exitCode: number, out: string[], err: string[] }>} The exit code and the printed lines.
 */
async function runWithReadings(argv, readings) {
  const out = []
  const err = []
  const seams = {
    ownPid: 4242,
    readMachine: () => readings,
    print: (line) => out.push(line),
  }
  const exitCode = await runCommandLine(
    (progress) => runNativePrecheck(argv, seams, progress),
    { printError: (line) => err.push(line), environment: {} },
  )
  return { exitCode, out, err }
}

// Value: protects=the swap the Mac reports (sysctl -n vm.swapusage on macOS) read as total, used and free MB; fails_when=a field is read from the wrong place, the decimals are dropped or the line is refused; no_claim=other systems' swap reports
test('a macOS swap line is read as total, used and free MB', () => {
  // Arrange
  const line =
    'total = 16384.00M  used = 15564.25M  free = 819.75M  (encrypted)'

  // Act
  const swap = parseSwapUsage(line)

  // Assert
  assert.deepEqual(swap, { totalMb: 16384, usedMb: 15564.25, freeMb: 819.75 })
})

// Value: protects=a swap line in gigabytes counted in MB, so a large swap is not read as a few MB free; fails_when=the G unit is ignored or refused; no_claim=units other than K, M and G
test('a swap line in gigabytes is counted in MB', () => {
  // Arrange
  const line = 'total = 16.00G  used = 15.50G  free = 0.50G  (encrypted)'

  // Act
  const swap = parseSwapUsage(line)

  // Assert
  assert.deepEqual(swap, { totalMb: 16384, usedMb: 15872, freeMb: 512 })
})

// Value: protects=a Mac that has allocated no swap yet read as an empty swap, not as unknown; fails_when=a zero total is refused or read as unknown; no_claim=how the verdict treats it (the verdict tests below)
test('a swap line with no swap allocated is read as zero total, used and free', () => {
  // Arrange
  const line = 'total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)'

  // Act
  const swap = parseSwapUsage(line)

  // Assert
  assert.deepEqual(swap, { totalMb: 0, usedMb: 0, freeMb: 0 })
})

// Value: protects=an unreadable swap report read as unknown instead of as some number; fails_when=an error text or an empty answer yields a swap object; no_claim=none beyond protects
test('an unreadable swap line is read as unknown', () => {
  // Arrange
  const lines = ["sysctl: unknown oid 'vm.swapusage'", '', undefined]

  // Act
  const swaps = lines.map((line) => parseSwapUsage(line))

  // Assert
  assert.deepEqual(swaps, [undefined, undefined, undefined])
})

// Value: protects=each line of `ps -A -ww -o pid=,args=` read as a pid, a command and its arguments; fails_when=the pid is lost, the command is mixed into the arguments, or a blank line becomes a row; no_claim=a command whose path holds a space (read as two words, named in --help)
test('the process listing is read as one row of pid, command and arguments per line', () => {
  // Arrange
  const text =
    '  101 /sbin/launchd\n 5101 /usr/local/bin/node --test dist/tests/a.test.js\n\n'

  // Act
  const rows = parseProcessRows(text)

  // Assert
  assert.deepEqual(rows, [
    { pid: 101, command: '/sbin/launchd', args: [] },
    {
      pid: 5101,
      command: '/usr/local/bin/node',
      args: ['--test', 'dist/tests/a.test.js'],
    },
  ])
})

// Value: protects=every build or test kind this repository starts on the Mac counted, each process once, by the program it runs (node's script, or the binary); fails_when=a kind is missed, a process counts under two kinds (c8 runs `node --test` as its arguments), or pnpm's install is not seen behind --dir; no_claim=kinds this repository does not start
test('each build and test kind the repository starts is counted once per process', () => {
  // Arrange
  const node = '/Users/example/.vite-plus/js_runtime/node/24.22.1/bin/node'
  const modules = '/Users/example/codebook/extension/node_modules'
  const rows = [
    {
      pid: 5101,
      command: 'node',
      args: [
        '--test',
        '--test-concurrency=4',
        'scripts/tests/qaBuild.test.mjs',
      ],
    },
    {
      pid: 5102,
      command: node,
      args: [
        '--test-concurrency=4',
        '--test-isolation=process',
        '--test-timeout=0',
        'scripts/tests/qaBuild.test.mjs',
      ],
    },
    {
      pid: 5103,
      command: 'node',
      args: ['scripts/test-shard.mjs', '--shard', '3/14', '--lanes', '2'],
    },
    {
      pid: 5104,
      command: node,
      args: [
        'extension/scripts/run-pregate-tests.mjs',
        'extension/scripts/tests/gate.test.mjs',
      ],
    },
    {
      pid: 5105,
      command: node,
      args: [`${modules}/typescript/bin/tsc`, '-p', 'tsconfig.json'],
    },
    {
      pid: 5106,
      command: 'node',
      args: [`${modules}/fallow/bin/fallow`, 'dupes', '--fail-on-issues'],
    },
    {
      pid: 5107,
      command: `${modules}/.pnpm/@fallow-cli+darwin-arm64@3.47.0/node_modules/@fallow-cli/darwin-arm64/fallow`,
      args: ['dupes', '--fail-on-issues'],
    },
    {
      pid: 5108,
      command: node,
      args: [
        `${modules}/c8/bin/c8.js`,
        'node',
        '--test',
        'dist/tests/a.test.js',
      ],
    },
    {
      pid: 5109,
      command:
        '/Users/example/.vite-plus/package_manager/pnpm/12.15.0/pnpm/bin/pnpm.native',
      args: ['--dir', 'extension', 'install', '--frozen-lockfile'],
    },
    {
      pid: 5110,
      command: 'node',
      args: [
        'scripts/package.mjs',
        '--out',
        'artifacts/packages/codebook.vsix',
      ],
    },
    {
      pid: 5111,
      command: node,
      args: [
        'extension/scripts/check-package.mjs',
        'artifacts/packages/codebook.vsix',
      ],
    },
    {
      pid: 5112,
      command: node,
      args: [`${modules}/@vscode/vsce/vsce`, 'package', '--no-dependencies'],
    },
    {
      pid: 5113,
      command: 'node',
      args: [
        'scripts/checkHealth.mjs',
        '--shard',
        '1/4',
        '--out',
        'artifacts/h',
      ],
    },
    { pid: 5114, command: node, args: ['scripts/gate.mjs'] },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, {
    nodeTest: 2,
    testShard: 1,
    pregateTests: 1,
    tsc: 1,
    fallow: 2,
    c8: 1,
    pnpmInstall: 1,
    package: 3,
    health: 1,
    gate: 1,
  })
})

// Value: protects=a clear verdict while only unrelated programs run (the editor's TypeScript server, an agent's node CLI, pnpm running a non-install command, a shell whose command line names a test, a commit message naming a script); fails_when=one of them is counted, so the check says busy on a quiet machine; no_claim=every other program on a Mac
test('unrelated node programs, a pnpm command that installs nothing and a shell are not counted', () => {
  // Arrange
  const node = '/Users/example/.vite-plus/js_runtime/node/24.22.1/bin/node'
  const rows = [
    {
      pid: 6101,
      command: node,
      args: [
        '/Applications/Editor/resources/typescript/lib/tsserver.js',
        '--serverMode',
        'partialSemantic',
      ],
    },
    {
      pid: 6102,
      command: node,
      args: ['/Users/example/.local/lib/agent-cli/cli.js', '--resume'],
    },
    {
      pid: 6103,
      command: 'pnpm.native',
      args: ['--dir', 'extension', 'test'],
    },
    {
      pid: 6104,
      command: '/bin/zsh',
      args: ['-c', 'node', '--test', 'dist/tests/a.test.js'],
    },
    {
      pid: 6105,
      command: '/usr/bin/git',
      args: ['commit', '-m', 'fix', 'gate.mjs'],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, NOTHING_RUNS)
})

// Value: protects=the precheck never counting itself or the `ps` it starts, also when it reads the machine from inside a node --test run; fails_when=the own pid is counted as a node --test process, so the check says busy because it runs; no_claim=the parent test run, which is another process and counts
test("the precheck's own process and its ps are not counted, even inside a node --test run", () => {
  // Arrange
  const rows = [
    {
      pid: 4242,
      command: '/usr/local/bin/node',
      args: [
        '--test-isolation=process',
        '--test-timeout=0',
        'extension/scripts/tests/nativePrecheck.test.mjs',
      ],
    },
    { pid: 4243, command: 'ps', args: ['-A', '-ww', '-o', 'pid=,args='] },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, NOTHING_RUNS)
})

// Value: protects=a clear verdict on a quiet Mac with free swap at or above the limit; fails_when=a zero count or enough free swap gives a reason; no_claim=the printed lines (the run tests below)
test('a quiet machine with enough free swap is clear', () => {
  // Arrange
  const facts = {
    swap: { totalMb: 4096, usedMb: 2048, freeMb: 2048 },
    processes: NOTHING_RUNS,
  }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, { verdict: 'clear', reasons: [] })
})

// Value: protects=a Mac that has allocated no swap at all counting as free (macOS allocates swap only under pressure); fails_when=a zero total with zero free is judged below the limit; no_claim=none beyond protects
test('a machine with no swap allocated is clear', () => {
  // Arrange
  const facts = {
    swap: { totalMb: 0, usedMb: 0, freeMb: 0 },
    processes: NOTHING_RUNS,
  }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, { verdict: 'clear', reasons: [] })
})

// Value: protects=a running suite stopping the native check (Discussion 359: parallel suites filled the swap and stopped the Space's VM); fails_when=running node --test processes give a clear verdict or the reason does not name the kind and count; no_claim=none beyond protects
test('a running suite makes the machine busy and the reason names it', () => {
  // Arrange
  const facts = {
    swap: { totalMb: 4096, usedMb: 1024, freeMb: 3072 },
    processes: { ...NOTHING_RUNS, nodeTest: 5 },
  }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, { verdict: 'busy', reasons: ['5 node --test'] })
})

// Value: protects=low free swap stopping the native check while nothing builds (the swap stays full after the builds end); fails_when=free swap below the limit gives a clear verdict or the reason does not name the free MB and the limit; no_claim=none beyond protects
test('free swap below the limit makes the machine busy and the reason names both numbers', () => {
  // Arrange
  const facts = {
    swap: { totalMb: 16384, usedMb: 15564.25, freeMb: 819.75 },
    processes: NOTHING_RUNS,
  }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, {
    verdict: 'busy',
    reasons: ['free swap 819.75 MB below 2048 MB'],
  })
})

// Value: protects=every reason of a busy machine named at once, so one rerun is enough after fixing them; fails_when=the verdict stops at the first reason; no_claim=none beyond protects
test('a machine that builds and is low on swap names both reasons', () => {
  // Arrange
  const facts = {
    swap: { totalMb: 16384, usedMb: 15564.25, freeMb: 819.75 },
    processes: { ...NOTHING_RUNS, tsc: 1, pnpmInstall: 2 },
  }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, {
    verdict: 'busy',
    reasons: ['1 tsc', '2 pnpm install', 'free swap 819.75 MB below 2048 MB'],
  })
})

// Value: protects=a machine whose swap or process list cannot be read never judged clear (the rule needs the swap shown free and no build seen); fails_when=an unknown swap or process list gives a clear verdict or no reason; no_claim=why the reading failed
test('a machine whose swap and process list cannot be read is busy and says so', () => {
  // Arrange
  const facts = { swap: undefined, processes: undefined }

  // Act
  const judgement = decideVerdict(facts, 2048)

  // Assert
  assert.deepEqual(judgement, {
    verdict: 'busy',
    reasons: ['process list unknown', 'swap unknown'],
  })
})

// Value: protects=the printed report: one line for the load and cores, one for the swap, one per kind, and the verdict last, with exit 3 when busy; fails_when=a line is missing or reordered, the verdict is not last, or busy exits 0; no_claim=the real machine's numbers (the run reported by the fixer)
test('a busy machine prints load, swap, one line per kind and the busy verdict last, and exits 3', async () => {
  // Arrange
  const readings = {
    loadAverages: [7.5, 6.256, 4],
    cores: 16,
    swapText:
      'total = 16384.00M  used = 15564.25M  free = 819.75M  (encrypted)',
    processRows: [
      { pid: 5101, command: 'node', args: ['--test', 'dist/tests/a.test.js'] },
      { pid: 5114, command: 'node', args: ['scripts/gate.mjs'] },
    ],
  }

  // Act
  const result = await runWithReadings([], readings)

  // Assert
  assert.equal(result.exitCode, 3)
  assert.deepEqual(result.err, [])
  assert.deepEqual(result.out, [
    'Load: 7.50, 6.26, 4.00 (1, 5, 15 min) on 16 cores',
    'Swap: total 16384 MB, used 15564.25 MB, free 819.75 MB',
    'Running node --test: 1',
    'Running test-shard.mjs: 0',
    'Running run-pregate-tests.mjs: 0',
    'Running tsc: 0',
    'Running fallow: 0',
    'Running c8: 0',
    'Running pnpm install: 0',
    'Running package.mjs, check-package.mjs or vsce: 0',
    'Running checkHealth.mjs: 0',
    'Running gate.mjs: 1',
    'PRECHECK: busy 1 node --test, 1 gate.mjs, free swap 819.75 MB below 2048 MB',
  ])
})

// Value: protects=--json printing the same facts and verdict as one JSON object, and --min-free-swap-mb setting the limit; fails_when=the object lacks a fact, the limit is not applied, or more than one line is printed; no_claim=none beyond protects
test('--json prints the facts and the verdict as one object, judged against --min-free-swap-mb, and exits 0 when clear', async () => {
  // Arrange
  const readings = {
    loadAverages: [1.234, 2, 3.5],
    cores: 8,
    swapText: 'total = 2048.00M  used = 1228.25M  free = 819.75M  (encrypted)',
    processRows: [],
  }

  // Act
  const result = await runWithReadings(
    ['--json', '--min-free-swap-mb', '512'],
    readings,
  )

  // Assert
  assert.equal(result.exitCode, 0)
  assert.equal(result.out.length, 1)
  assert.deepEqual(JSON.parse(result.out[0]), {
    load: { oneMinute: 1.23, fiveMinutes: 2, fifteenMinutes: 3.5, cores: 8 },
    swap: { totalMb: 2048, usedMb: 1228.25, freeMb: 819.75 },
    processes: NOTHING_RUNS,
    minFreeSwapMb: 512,
    verdict: 'clear',
    reasons: [],
  })
})

// Value: protects=a process's arguments (they can hold tokens and private paths) never reaching the printed lines or the JSON; fails_when=any argument of a counted process appears in either output; no_claim=a process's environment and working directory, which the reader never reads (ps prints pid and args only), and what other programs print
test("a process's token-holding arguments reach neither the printed lines nor the JSON", async () => {
  // Arrange
  const readings = {
    loadAverages: [1, 1, 1],
    cores: 8,
    swapText: 'total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)',
    processRows: [
      {
        pid: 5101,
        command: 'node',
        args: [
          '--test',
          '--test-name-pattern=ghp_exampletoken123',
          '/Users/example/private-project/a.test.js',
        ],
      },
      {
        pid: 5109,
        command: 'pnpm.native',
        args: [
          'install',
          '--registry=https://registry.example/npm_exampletoken456/',
        ],
      },
    ],
  }

  // Act
  const plain = await runWithReadings([], readings)
  const json = await runWithReadings(['--json'], readings)

  // Assert
  const printed = [...plain.out, ...plain.err, ...json.out, ...json.err].join(
    '\n',
  )
  assert.equal(plain.exitCode, 3)
  assert.equal(json.exitCode, 3)
  assert.ok(!printed.includes('exampletoken'), printed)
  assert.ok(!printed.includes('private-project'), printed)
  assert.ok(!printed.includes('registry.example'), printed)
  assert.equal(plain.out.at(-1), 'PRECHECK: busy 1 node --test, 1 pnpm install')
})

// Value: protects=--help under the delivery commands' contract: usage, exit codes and error codes on stdout, exit 0, from the real entry point; fails_when=--help reads the machine, exits otherwise, or omits the exit-code or error-code list; no_claim=the wording beyond the listed parts
test('--help prints the usage, the exit codes and the error codes and exits 0', () => {
  // Arrange
  const argv = [SCRIPT_PATH, '--help']

  // Act
  const result = spawnSync(process.execPath, argv, { encoding: 'utf8' })

  // Assert
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `${HELP_TEXT.trimEnd()}\n`)
  assert.equal(result.stderr, '')
  assert.match(
    HELP_TEXT,
    /^Usage:\n {2}node extension\/scripts\/native-precheck\.mjs/,
  )
  assert.match(
    HELP_TEXT,
    /Exit codes: 0 clear; 3 busy, the verdict line names why; 2 failed before a verdict; 64 usage\./,
  )
  assert.match(HELP_TEXT, /Error codes: E_USAGE, E_INTERNAL\./)
})

// Value: protects=a usage error under the delivery commands' contract: code on the first line, fix on the last, exit 64, nothing on stdout, from the real entry point; fails_when=a bad limit is accepted, the check runs anyway, or the lines or exit code change; no_claim=every bad combination of options
test('a limit that is no whole number is a usage error with its code first and its fix last', () => {
  // Arrange
  const argv = [SCRIPT_PATH, '--min-free-swap-mb', 'lots']

  // Act
  const result = spawnSync(process.execPath, argv, { encoding: 'utf8' })

  // Assert
  assert.equal(result.status, 64)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.stderr.trimEnd().split('\n'), [
    'E_USAGE: --min-free-swap-mb takes a whole number of MB (got lots)',
    'Fix: node extension/scripts/native-precheck.mjs --help',
  ])
})
