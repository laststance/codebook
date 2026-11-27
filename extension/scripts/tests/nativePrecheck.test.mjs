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
  readProcessSample,
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
  inProcessBuild: 0,
  eslint: 0,
  fallow: 0,
  c8: 0,
  pnpmInstall: 0,
  package: 0,
  health: 0,
  gate: 0,
  codeRabbitReview: 0,
  codexReview: 0,
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
    readMachine: () => ({ platform: 'darwin', pressureText: '1', ...readings }),
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

// Value: protects=a malformed or non-finite swap amount read as unknown instead of as a valid amount within the limit; fails_when=a line with `1..2`, `1.2.3` or a digit string large enough to become Infinity yields a swap object, so a broken sysctl answer can end as clear; no_claim=why sysctl printed it
test('a malformed or non-finite swap amount is read as unknown', () => {
  // Arrange
  const lines = [
    'total = 1..2M  used = 0.00M  free = 0.00M  (encrypted)',
    'total = 16.00G  used = 1.2.3G  free = 0.50G  (encrypted)',
    `total = ${'9'.repeat(400)}M  used = 0.00M  free = 0.00M  (encrypted)`,
  ]

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

// Value: protects=every build or test kind this repository starts on the Mac counted, each process once, by the program it runs (node's script, or the binary), the QA build and the fast compile included, which build inside their own process; fails_when=a kind is missed, a process counts under two kinds (c8 runs `node --test` as its arguments), or pnpm's install is not seen behind --dir; no_claim=kinds this repository does not start
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
      command: `${modules}/.pnpm/@fallow-cli+darwin-arm64@3.49.0/node_modules/@fallow-cli/darwin-arm64/fallow`,
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
    { pid: 5115, command: node, args: ['extension/scripts/qa-build.mjs'] },
    {
      pid: 5116,
      command: 'node',
      args: ['scripts/build-fast.mjs', '--check'],
    },
    {
      pid: 5117,
      command: node,
      args: [
        `${modules}/eslint/bin/eslint.js`,
        '.',
        '--concurrency=auto',
        '--max-warnings=0',
      ],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, {
    nodeTest: 2,
    testShard: 1,
    pregateTests: 1,
    tsc: 1,
    inProcessBuild: 2,
    eslint: 1,
    fallow: 2,
    c8: 1,
    pnpmInstall: 1,
    package: 3,
    health: 1,
    gate: 1,
    codeRabbitReview: 0,
    codexReview: 0,
  })
})

// Value: protects=a clear verdict while only unrelated programs run (the editor's TypeScript server, an agent's node CLI, pnpm running a non-install command, a shell whose command line names a test, a commit message naming a script, another project's dev server keeping an `esbuild --service` process open, the editor's ESLint language server, which the ESLint extension forks as its `server/out/eslintServer.js` under the editor's own runtime or under node when `eslint.runtime` is set); fails_when=one of them is counted, so the check says busy on a quiet machine; no_claim=every other program on a Mac
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
    {
      pid: 6106,
      command:
        '/Users/example/other-app/node_modules/@esbuild/darwin-arm64/bin/esbuild',
      args: ['--service=0.25.0', '--ping'],
    },
    {
      pid: 6107,
      // The editor's helper path holds spaces, so ps's words split it as parseProcessRows reads it.
      command: '/Applications/Visual',
      args: [
        'Studio',
        'Code.app/Contents/Frameworks/Code',
        'Helper',
        '(Plugin).app/Contents/MacOS/Code',
        'Helper',
        '(Plugin)',
        '/Users/example/.vscode/extensions/dbaeumer.vscode-eslint-3.0.34/server/out/eslintServer.js',
        '--node-ipc',
        '--clientProcessId=4100',
      ],
    },
    {
      pid: 6108,
      command: node,
      args: [
        '/Users/example/.vscode/extensions/dbaeumer.vscode-eslint-3.0.34/server/out/eslintServer.js',
        '--node-ipc',
        '--clientProcessId=4100',
      ],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, NOTHING_RUNS)
})

// Value: protects=a clear verdict while an editor keeps a TypeScript language server open (the compiler started as `tsc --lsp --stdio`, which an IDE starts once and leaves running for hours); fails_when=that server is counted as a tsc build, so the check says busy for as long as the IDE is open; no_claim=a `tsc --watch` build, which still counts, and a language server started under another program name
test("an editor's TypeScript language server started as tsc --lsp is not counted as a build", () => {
  // Arrange
  const rows = [
    {
      pid: 6201,
      command:
        '/Users/example/Library/Caches/Editor/ts-native/node_modules/@typescript/typescript-darwin-arm64/lib/tsc',
      args: ['--lsp', '--stdio'],
    },
    {
      pid: 6202,
      command: '/Users/example/.vite-plus/js_runtime/node/24.22.1/bin/node',
      args: [
        '/Users/example/project/node_modules/typescript/bin/tsc',
        '--lsp',
        '--stdio',
      ],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, NOTHING_RUNS)
})

// Value: protects=a clear verdict while an editor's Fallow language server or an agent's Fallow MCP server stays open (`fallow-lsp` and `fallow-mcp` start the native binary as `fallow lsp-server` and `fallow mcp-server` and leave it running for hours); fails_when=either server is counted as a fallow run, so the check says busy although nothing is analysed; no_claim=a server started under another program name, and whether a Fallow analysis counts (the next test)
test("an editor's Fallow language server and an agent's Fallow MCP server are not counted", () => {
  // Arrange
  const node = '/Users/example/.vite-plus/js_runtime/node/24.22.1/bin/node'
  const modules = '/Users/example/codebook/extension/node_modules'
  const nativeFallow = `${modules}/.pnpm/@fallow-cli+darwin-arm64@3.49.0/node_modules/@fallow-cli/darwin-arm64/fallow`
  const rows = [
    { pid: 6301, command: node, args: [`${modules}/fallow/bin/fallow-lsp`] },
    { pid: 6302, command: nativeFallow, args: ['lsp-server'] },
    { pid: 6303, command: node, args: [`${modules}/fallow/bin/fallow-mcp`] },
    { pid: 6304, command: nativeFallow, args: ['mcp-server'] },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, NOTHING_RUNS)
})

// Value: protects=a running Fallow analysis counted as a build beside the servers the skip drops (`fallow health` shares the binary the language and MCP servers run under, so the server exclusion must not reach past the server's own words); fails_when=the server exclusion also drops a `fallow health` run, so the check says clear while an analysis builds; no_claim=a server started under another program name
test('a Fallow analysis is counted as a build', () => {
  // Arrange
  const nativeFallow =
    '/Users/example/codebook/extension/node_modules/.pnpm/@fallow-cli+darwin-arm64@3.49.0/node_modules/@fallow-cli/darwin-arm64/fallow'
  const rows = [
    {
      pid: 6305,
      command: nativeFallow,
      args: ['health', '--complexity', '--max-crap', 'inf'],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, { ...NOTHING_RUNS, fallow: 1 })
})

// Value: protects=a clear verdict while an editor or an agent keeps ESLint's MCP server open (`eslint --mcp`, ESLint's documented MCP setup, stays running as `eslint.js --mcp` while it waits on the `@eslint/mcp` server it starts), while a lint run beside it still counts; fails_when=the MCP server is counted as a lint run, so the check says busy for as long as the editor or agent is open, or the skip also drops `eslint .`; no_claim=the `@eslint/mcp` child, which runs under its own program name
test('an ESLint MCP server started as eslint --mcp is not counted, while a lint run still is', () => {
  // Arrange
  const node = '/Users/example/.vite-plus/js_runtime/node/24.22.1/bin/node'
  const eslint =
    '/Users/example/codebook/extension/node_modules/eslint/bin/eslint.js'
  const rows = [
    { pid: 6401, command: node, args: [eslint, '--mcp'] },
    {
      pid: 6402,
      command: node,
      args: [eslint, '.', '--concurrency=auto', '--max-warnings=0'],
    },
  ]

  // Act
  const counts = countProcessKinds(rows, 4242)

  // Assert
  assert.deepEqual(counts, { ...NOTHING_RUNS, eslint: 1 })
})

// Value: protects=a build counted when node runs it from a path that holds a space (ps prints the command line with its spaces, so the script's path reaches the reader cut into several words), while a script of such a path that is no known program, and a known name after its first option, stay uncounted; fails_when=the running tsc or gate.mjs under `Codebook Work` counts under no kind, so the check says clear during a build, or the search runs past the script's first option and counts a word of its arguments; no_claim=node itself or a native binary installed under a path with a space, which still reads as two words (--help says so)
test('a build that node runs from a path holding a space is counted under its program', () => {
  // Arrange
  const text = [
    ' 7101 node /Users/example/Codebook Work/extension/node_modules/typescript/bin/tsc -p tsconfig.json',
    ' 7102 node /Users/example/Codebook Work/extension/scripts/gate.mjs',
    ' 7103 node /Users/example/Codebook Work/tools/report.mjs --out gate.mjs',
  ].join('\n')

  // Act
  const counts = countProcessKinds(parseProcessRows(text), 4242)

  // Assert
  assert.deepEqual(counts, { ...NOTHING_RUNS, tsc: 1, gate: 1 })
})

// Value: protects=a build that node runs behind an option whose value is the next word counted under its program — the value is no script (`node --env-file .env --import tsx scripts/gate.mjs` read `.env` as the script and counted nothing, so a running gate.mjs would not have stopped the native check); fails_when=a valued option's separate-word value is read as the script or the script shifts out from under its kind; no_claim=an option spelling node itself refuses
test('a node option that takes its value as the next word does not pass that value off as the script', () => {
  // Arrange
  const invocations = [
    ['--require', 'tsx', 'scripts/gate.mjs'],
    ['--import', 'tsx', 'scripts/gate.mjs'],
    ['--env-file', '.env', 'scripts/gate.mjs'],
    ['--inspect-port', '9229', 'scripts/gate.mjs'],
    ['--watch-path', 'src', 'scripts/gate.mjs'],
    ['--cpu-prof-dir', '/tmp/profiles', 'scripts/gate.mjs'],
    // Stacked valued options: each value is eaten in turn before the script.
    ['--env-file', '.env', '--import', 'tsx', 'scripts/gate.mjs'],
    ['--inspect-port', '9229', '--watch-path', 'src', 'scripts/gate.mjs'],
    // `--` ends node's own options: the next word is the script.
    ['--', 'scripts/gate.mjs'],
  ]

  // Act
  const counts = invocations.map((args) =>
    countProcessKinds([{ pid: 7101, command: 'node', args }], 4242),
  )

  // Assert
  for (const count of counts)
    assert.deepEqual(count, { ...NOTHING_RUNS, gate: 1 })
})

// Value: protects=a build that node runs behind an option in its `--opt=value` spelling counted under its program — the attached value is part of the option's word, so nothing is eaten and the next word stays the script (`--inspect=9229` is the whole inspector setup; bare `--inspect` takes no word either, and the v8 number flags like `--max-old-space-size=4096` only exist in the attached spelling); fails_when=an attached value eats the script, or a bare `--inspect` swallows the script as a port; no_claim=an option spelling node itself refuses
test("a node option's attached value is no script and swallows nothing", () => {
  // Arrange
  const invocations = [
    ['--require=tsx', 'scripts/gate.mjs'],
    ['--import=tsx', 'scripts/gate.mjs'],
    ['--env-file=.env', 'scripts/gate.mjs'],
    ['--inspect=9229', 'scripts/gate.mjs'],
    ['--inspect', 'scripts/gate.mjs'],
    ['--max-old-space-size=4096', 'scripts/gate.mjs'],
  ]

  // Act
  const counts = invocations.map((args) =>
    countProcessKinds([{ pid: 7201, command: 'node', args }], 4242),
  )

  // Assert
  for (const count of counts)
    assert.deepEqual(count, { ...NOTHING_RUNS, gate: 1 })
})

// Value: protects=a quiet machine while someone runs a node one-liner whose positional arguments name a build script — `-e`/`--eval` and `-p`/`--print` run their value as the program itself, so a word after it (`node -e "…" gate.mjs`) is an argument to the one-liner, not a running gate.mjs; fails_when=the word after the eval value is read as the script, so a one-liner reads as a running build and the check says busy on a quiet machine; no_claim=the eval value itself, which ps cuts into words that are never a script path
test('node running an eval or print option runs no script, so the words after its value count as nothing', () => {
  // Arrange
  const invocations = [
    ['-e', 'console.log(1)', 'gate.mjs'],
    ['--eval', 'console.log(1)', 'gate.mjs'],
    ['--eval=console.log(1)', 'scripts/gate.mjs'],
    ['-p', '1+1', 'tsc'],
    ['--print=1+1', 'scripts/gate.mjs'],
  ]

  // Act
  const counts = invocations.map((args) =>
    countProcessKinds([{ pid: 7301, command: 'node', args }], 4242),
  )

  // Assert
  for (const count of counts) assert.deepEqual(count, NOTHING_RUNS)
})

// Value: protects=a test run whose test-runner options take separate-word values counted as node --test in any option order (`node --test --test-concurrency 4 …` and `node --test --test-reporter spec …` are spellings node accepts beside the `=` forms), also when a valued option that is no test option stands before `--test` (`node --env-file .env --test …` — read `.env` as the script and the `--test` after it never reaches the run's options, so a running suite counts under no kind); fails_when=a valued option's separate-word value is read as the script; no_claim=test files themselves, which are no known program
test('a test run whose test-runner options take separate-word values is counted as node --test', () => {
  // Arrange
  const invocations = [
    ['--test', '--test-concurrency', '4', 'scripts/tests/a.test.mjs'],
    ['--test-concurrency', '4', '--test', 'scripts/tests/a.test.mjs'],
    ['--test', '--test-reporter', 'spec', 'scripts/tests/a.test.mjs'],
    ['--test', '--test-timeout', '5000', 'scripts/tests/a.test.mjs'],
    // The valued option is no test option, so only the consumed `--test` marks the run.
    ['--env-file', '.env', '--test', 'scripts/tests/a.test.mjs'],
  ]

  // Act
  const counts = invocations.map((args) =>
    countProcessKinds([{ pid: 7401, command: 'node', args }], 4242),
  )

  // Assert
  for (const count of counts)
    assert.deepEqual(count, { ...NOTHING_RUNS, nodeTest: 1 })
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

// Value: protects=solo native work can proceed despite retained swap, at the default and with a legacy override; fails_when=swap alone or an idle editor server blocks admission; no_claim=how much memory a later workload uses
test('a quiet Mac admits native work with 12 to 20 GiB retained swap, including with a former hard limit', async () => {
  // Arrange
  for (const [usedMb, options] of [
    [12288, []],
    [20480, ['--max-used-swap-mb', '1024']],
  ]) {
    const readings = {
      loadAverages: [1, 1, 1],
      cores: 8,
      pressureText: '1\n',
      swapText: `total = 24576M  used = ${usedMb}M  free = ${24576 - usedMb}M`,
      processRows: [{ pid: 11, command: 'tsc', args: ['--lsp'] }],
    }

    // Act
    const result = await runWithReadings(['--json', ...options], readings)

    // Assert
    assert.equal(result.exitCode, 0)
    const report = JSON.parse(result.out[0])
    assert.equal(report.memoryPressure, 'normal')
    assert.equal(report.swap.usedMb, usedMb)
    assert.deepEqual(report.processes, NOTHING_RUNS)
    assert.deepEqual(report.reasons, [])
  }
})

// Value: protects=only an explicit experiment may overlap an actual build or suite; fails_when=normal work is admitted or a controlled overlap loses the observations; no_claim=whether the VM survives a particular trial
test('a warning-pressure Mac serializes an ordinary build but admits and reports its controlled overlap', async () => {
  // Arrange
  const readings = {
    loadAverages: [1, 1, 1],
    cores: 8,
    pressureText: '2',
    processRows: [{ pid: 12, command: 'node', args: ['scripts/qa-build.mjs'] }],
  }

  // Act
  const ordinary = await runWithReadings(['--json'], readings)
  const trial = await runWithReadings(['--experiment', '--json'], readings)
  const plainTrial = await runWithReadings(['--experiment'], readings)

  // Assert
  const ordinaryReport = JSON.parse(ordinary.out[0])
  const trialReport = JSON.parse(trial.out[0])
  assert.equal(ordinary.exitCode, 3)
  assert.deepEqual(ordinaryReport.reasons, ['1 qa-build.mjs or build-fast.mjs'])
  assert.equal(trial.exitCode, 0)
  assert.equal(trialReport.experiment, true)
  assert.equal(trialReport.memoryPressure, 'warning')
  assert.deepEqual(trialReport.observations, [
    '1 qa-build.mjs or build-fast.mjs',
  ])
  assert.deepEqual(trialReport.reasons, [])
  assert.equal(trialReport.swap, null)
  assert.ok(
    plainTrial.out.includes(
      'Experimental overlap: 1 qa-build.mjs or build-fast.mjs',
    ),
  )
  assert.equal(plainTrial.out.at(-1), 'PRECHECK: clear')
})

// Value: protects=observational CLI review counts in either lane with no private arguments; fails_when=an unrelated session counts or a review alone blocks native work; no_claim=review tool resource usage
test('active CLI reviews are counted without admitting editor sessions as review work or blocking native QA', async () => {
  // Arrange
  const readings = {
    loadAverages: [1, 1, 1],
    cores: 8,
    processRows: [
      {
        pid: 21,
        command: '/bin/codex',
        args: ['review', '--base', 'private-branch'],
      },
      {
        pid: 22,
        command: 'codex',
        args: ['exec', 'review', '--base', 'private-branch'],
      },
      { pid: 23, command: 'codex', args: ['app-server', 'review'] },
      {
        pid: 24,
        command: 'coderabbit',
        args: ['--agent', '--base', 'private-branch'],
      },
      {
        pid: 25,
        command: '/bin/coderabbit',
        args: ['review', '--base', 'private-branch'],
      },
      {
        pid: 26,
        command: 'coderabbit',
        args: ['config', 'validate', 'review'],
      },
    ],
  }

  // Act
  const ordinary = await runWithReadings(['--json'], readings)
  const trial = await runWithReadings(['--experiment', '--json'], readings)

  // Assert
  for (const result of [ordinary, trial]) {
    assert.equal(result.exitCode, 0)
    const report = JSON.parse(result.out[0])
    assert.equal(report.processes.codexReview, 2)
    assert.equal(report.processes.codeRabbitReview, 2)
    assert.deepEqual(report.reasons, [])
    assert.ok(!result.out[0].includes('private-branch'))
  }
})

// Value: protects=review counts, RSS and admission with root CLI options; fails_when=an option value or later prompt is counted as a review; no_claim=arguments with spaces flattened by ps
test('Codex review counts and RSS follow the subcommand after root options', async () => {
  // Arrange
  const cases = [
    ['-C /private-workdir review --base main', 1],
    ['--cd=/private-workdir --search -m review exec review', 1],
    ['-C/private-workdir e review --base main', 1],
    ['--image screen.png --cd /private-workdir review', 1],
    ['--image=screen.png review', 1],
    ['--cd review app-server', 0],
    ['-m review exec build', 0],
    ['--cd /private-workdir exec build review', 0],
    ['--image screen.png review', 0],
    ['-C --search review', 0],
    ['--image --search review', 0],
    ['-- review', 0],
    ['--unknown-option review', 0],
  ]
  for (const [args, expected] of cases) {
    const processRows = parseProcessRows(`2048 41 /bin/codex ${args}`, true)

    // Act
    const result = await runWithReadings(['--json'], {
      loadAverages: [1, 1, 1],
      cores: 8,
      processRows,
    })

    // Assert
    const report = JSON.parse(result.out[0])
    assert.equal(report.processes.codexReview, expected, args)
    assert.equal(report.rssMiBByKind.codexReview, expected ? 2 : 0, args)
    assert.equal(report.verdict, 'clear', args)
    assert.ok(!result.out[0].includes('private-workdir'))
  }
})

// Value: protects=per-workload RSS sums the exact process IDs that were counted; fails_when=shared classification, duplicate rows, or unclassified children inflate the total; no_claim=unique physical memory or unobserved children
test('workload RSS sums sampled resident sizes once per classified PID in MiB', async () => {
  // Arrange
  const rows = parseProcessRows(
    [
      ' 1536 101 node --test scripts/gate.mjs',
      '  512 102 node scripts/gate.mjs',
      ' 2048 101 tsc --build',
      '  256 103 codex review --base private-name',
      ' 8192 104 esbuild --service',
      '    - 105 editor app',
      '  100 4242 node --test',
    ].join('\n'),
    true,
  )

  // Act
  const result = await runWithReadings(['--experiment', '--json'], {
    loadAverages: [1, 1, 1],
    cores: 8,
    processRows: rows,
  })

  // Assert
  const report = JSON.parse(result.out[0])
  assert.equal(result.exitCode, 0)
  assert.deepEqual(report.processes, {
    ...NOTHING_RUNS,
    gate: 2,
    codexReview: 1,
  })
  assert.deepEqual(report.rssMiBByKind, {
    ...NOTHING_RUNS,
    gate: 2,
    codexReview: 0.25,
  })
  assert.ok(!result.out[0].includes('private-name'))
})

// Value: protects=missing RSS is explicit and never drops a busy PID or changes admission; fails_when=a restricted RSS reading becomes zero, hides a build, or blocks an experiment; no_claim=why RSS is unavailable
test('unavailable or malformed RSS keeps workload counts and makes the RSS total unknown', async () => {
  // Arrange
  const samples = [
    parseProcessRows('101 tsc --build\n102 node app.js'),
    ...['-', '', 'bad', '-1', '9'.repeat(320)].map((rss) =>
      parseProcessRows(`${rss} 101 tsc --build\n20 102 node app.js`, true),
    ),
  ]

  // Act
  for (const processRows of samples) {
    const readings = { loadAverages: [1, 1, 1], cores: 8, processRows }
    const ordinary = await runWithReadings(['--json'], readings)
    const experiment = await runWithReadings(
      ['--json', '--experiment'],
      readings,
    )

    // Assert
    assert.equal(ordinary.exitCode, 3)
    assert.equal(experiment.exitCode, 0)
    for (const result of [ordinary, experiment]) {
      const report = JSON.parse(result.out[0])
      assert.equal(report.rssMiBByKind, null)
      assert.equal(report.processes.tsc, 1)
    }
  }
})

// Value: protects=the production ps reader retains process occupancy when the host denies the RSS column; fails_when=RSS denial hides the running build or invents memory; no_claim=host-specific permissions
test('a host rejecting the RSS column still reports a busy build from the counts-only process list', async () => {
  // Arrange
  for (const restricted of [undefined, '']) {
    const columns = []
    const read = (_command, args) => {
      columns.push(args.at(-1))
      return args.at(-1) === 'rss=,pid=,args='
        ? restricted
        : '101 node scripts/qa-build.mjs'
    }

    // Act
    const result = await runWithReadings(['--json'], {
      loadAverages: [1, 1, 1],
      cores: 8,
      processRows: readProcessSample(read),
    })

    // Assert
    assert.deepEqual(columns, ['rss=,pid=,args=', 'pid=,args='])
    assert.equal(result.exitCode, 3)
    const report = JSON.parse(result.out[0])
    assert.equal(report.rssMiBByKind, null)
    assert.equal(report.processes.inProcessBuild, 1)
  }
})

// Value: protects=actual critical pressure stops ordinary and controlled trials even with zero swap; fails_when=experiment waives real pressure or masks the heavy process; no_claim=elapsed time until recovery
test('critical memory pressure stops a controlled trial while its workload remains visible', async () => {
  // Arrange
  const readings = {
    loadAverages: [1, 1, 1],
    cores: 8,
    pressureText: '4\n',
    swapText: 'total = 0M  used = 0M  free = 0M',
    processRows: [
      { pid: 13, command: 'node', args: ['scripts/checkHealth.mjs'] },
    ],
  }

  // Act
  const ordinary = await runWithReadings(['--json'], readings)
  const trial = await runWithReadings(['--experiment', '--json'], readings)

  // Assert
  assert.equal(ordinary.exitCode, 3)
  assert.deepEqual(JSON.parse(ordinary.out[0]).reasons, [
    '1 checkHealth.mjs',
    'critical memory pressure',
  ])
  assert.equal(trial.exitCode, 3)
  assert.deepEqual(JSON.parse(trial.out[0]).reasons, [
    'critical memory pressure',
  ])
  assert.deepEqual(JSON.parse(trial.out[0]).observations, ['1 checkHealth.mjs'])
})

// Value: protects=only exact supported kernel pressure values admit a Mac, with unreadable input kept private; fails_when=partial numbers or non-Mac readings are treated as valid; no_claim=why the reading was unavailable
test('missing and malformed pressure or an unsupported operating system yield explicit reasons', async () => {
  // Arrange
  const cases = [
    ...[
      undefined,
      '',
      '0',
      '3',
      '1junk',
      '1\n4',
      'unexpected-private-text',
      1,
    ].map((pressureText) => [
      'darwin',
      pressureText,
      'unknown',
      'memory pressure unknown',
    ]),
    ['linux', '1', 'unsupported', 'macOS host required'],
  ]
  for (const [platform, pressureText, pressure, reason] of cases) {
    const readings = {
      platform,
      pressureText,
      loadAverages: [1, 1, 1],
      cores: 8,
      processRows: [{ pid: 1, command: '/sbin/launchd', args: [] }],
    }

    // Act
    const result = await runWithReadings(['--json', '--experiment'], readings)

    // Assert
    assert.equal(result.exitCode, 3)
    const report = JSON.parse(result.out[0])
    assert.equal(report.memoryPressure, pressure)
    assert.deepEqual(report.reasons, [reason])
    assert.ok(!result.out[0].includes('unexpected-private-text'))
  }
})

// Value: protects=unknown workload occupancy stays explicit in an experiment; fails_when=unreadable process counts admit a blind overlap; no_claim=other system limits
test('an experiment requires a readable process list', () => {
  // Arrange
  const facts = { memoryPressure: 'normal', processes: undefined }

  // Act
  const judgement = decideVerdict(facts, true)

  // Assert
  assert.deepEqual(judgement, {
    verdict: 'busy',
    reasons: ['process list unknown'],
    observations: [],
  })
})

// Value: protects=an empty process table read as an unknown process list instead of as proof that nothing builds (`ps` always prints at least its own row; an empty or truncated table is unreadable); fails_when=an empty rows array yields all-zero counts and a clear verdict; no_claim=why the table was empty
test('an empty process table is busy as an unknown process list', async () => {
  // Arrange
  const readings = {
    loadAverages: [1, 1, 1],
    cores: 8,
    swapText: 'total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)',
    processRows: [],
  }

  // Act
  const result = await runWithReadings([], readings)

  // Assert
  assert.equal(result.exitCode, 3)
  assert.equal(result.err.length, 0)
  assert.ok(result.out.includes('Running: unknown (no process list)'))
  assert.equal(result.out.at(-1), 'PRECHECK: busy process list unknown')
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
    'Memory pressure: normal',
    'Running node --test: 1',
    'Running test-shard.mjs: 0',
    'Running run-pregate-tests.mjs: 0',
    'Running tsc: 0',
    'Running qa-build.mjs or build-fast.mjs: 0',
    'Running eslint: 0',
    'Running fallow: 0',
    'Running c8: 0',
    'Running pnpm install: 0',
    'Running package.mjs, check-package.mjs or vsce: 0',
    'Running checkHealth.mjs: 0',
    'Running gate.mjs: 1',
    'Running CodeRabbit CLI review: 0',
    'Running Codex CLI review: 0',
    'PRECHECK: busy 1 node --test, 1 gate.mjs',
  ])
})

// Value: protects=legacy JSON consumers keep their configured swap setting and receive actual pressure separately; fails_when=an old threshold blocks a healthy host or the reported facts change shape; no_claim=the real host's load
test('--json preserves the former swap setting as a diagnostic field', async () => {
  // Arrange
  const readings = {
    loadAverages: [1.234, 2, 3.5],
    cores: 8,
    swapText: 'total = 2048.00M  used = 1228.25M  free = 819.75M  (encrypted)',
    processRows: [{ pid: 1, command: '/sbin/launchd', args: [] }],
  }

  // Act
  const result = await runWithReadings(
    ['--json', '--max-used-swap-mb', '1024'],
    readings,
  )

  // Assert
  assert.equal(result.exitCode, 0)
  assert.equal(result.out.length, 1)
  assert.deepEqual(JSON.parse(result.out[0]), {
    load: { oneMinute: 1.23, fiveMinutes: 2, fifteenMinutes: 3.5, cores: 8 },
    swap: { totalMb: 2048, usedMb: 1228.25, freeMb: 819.75 },
    memoryPressure: 'normal',
    experiment: false,
    processes: NOTHING_RUNS,
    rssMiBByKind: null,
    maxUsedSwapMb: 1024,
    verdict: 'clear',
    reasons: [],
    observations: [],
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
  // --help prints and exits before the machine is read, so ten seconds is far past any honest run; SIGKILL keeps even a wedged child bounded.
  const result = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  })

  // Assert
  assert.ifError(result.error)
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
  assert.match(HELP_TEXT, /--max-used-swap-mb <n>/)
  assert.match(
    HELP_TEXT,
    /tsc \(not [^)]*\), qa-build\.mjs\s+or build-fast\.mjs/,
  )
  assert.match(HELP_TEXT, /eslint \(not its MCP server,\s+eslint --mcp;/)
  assert.doesNotMatch(HELP_TEXT, /min-free-swap/)
  assert.match(
    HELP_TEXT,
    /a script that node runs from a path\s+holding a space still counts/,
  )
})

// Value: protects=a usage error under the delivery commands' contract: code on the first line, fix on the last, exit 64, nothing on stdout, from the real entry point; fails_when=a bad limit is accepted, the check runs anyway, or the lines or exit code change; no_claim=every bad combination of options
test('a limit that is no whole number is a usage error with its code first and its fix last', () => {
  // Arrange
  const argv = [SCRIPT_PATH, '--max-used-swap-mb', 'lots']

  // Act
  // A usage error is refused before the machine is read, so ten seconds is far past any honest run; SIGKILL keeps even a wedged child bounded.
  const result = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  })

  // Assert
  assert.ifError(result.error)
  assert.equal(result.status, 64)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.stderr.trimEnd().split('\n'), [
    'E_USAGE: --max-used-swap-mb takes a whole number of MB (got lots)',
    'Fix: node extension/scripts/native-precheck.mjs --help',
  ])
})

// Value: protects=the replaced option refused instead of silently ignored (--min-free-swap-mb was added this cycle, is unreleased and keeps no alias); fails_when=the old option is accepted, so a caller believes a free-swap limit applies; no_claim=none beyond protects
test('the replaced --min-free-swap-mb option is a usage error', () => {
  // Arrange
  const argv = [SCRIPT_PATH, '--min-free-swap-mb', '2048']

  // Act
  // A usage error is refused before the machine is read, so ten seconds is far past any honest run; SIGKILL keeps even a wedged child bounded.
  const result = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  })

  // Assert
  assert.ifError(result.error)
  assert.equal(result.status, 64)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^E_USAGE: .*--min-free-swap-mb/)
  assert.equal(
    result.stderr.trimEnd().split('\n').at(-1),
    'Fix: node extension/scripts/native-precheck.mjs --help',
  )
})
