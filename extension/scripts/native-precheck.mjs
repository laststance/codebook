// Prints the Mac's load, swap and running builds before a native check in the macOS Space, and says whether the check may start (Discussion 359).
//
//   node extension/scripts/native-precheck.mjs [--experiment] [--max-used-swap-mb <n>] [--json]
//
// Check current macOS memory pressure and concurrent heavy work. Retained swap is diagnostic.
// A controlled trial may overlap a known workload and record whether the QA Space survives.
import { spawnSync } from 'node:child_process'
import { availableParallelism, loadavg } from 'node:os'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'

import {
  CommandRefusal,
  EXIT,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** Prior swap setting retained in the JSON for existing callers. Admission uses current pressure. */
const DEFAULT_MAX_USED_SWAP_MB = 8192

/** How long `ps` or `sysctl` may take, and how much `ps` may print: a table with every argument of every process is a few megabytes at most. */
const READ_TIMEOUT_MS = 5_000
const READ_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/** Decimal places of a load average in the report and the JSON. */
const LOAD_DECIMAL_PLACES = 2

/** MB per unit of the swap line: macOS prints `M`, and a larger swap may read in `G`. */
const MB_PER_SWAP_UNIT = { K: 1 / 1024, M: 1, G: 1024 }

/** The swap line of `sysctl -n vm.swapusage`, e.g. `total = 2048.00M  used = 1228.25M  free = 819.75M  (encrypted)`. */
const SWAP_LINE_PATTERN =
  /total = (\d+(?:\.\d+)?)([KMG])\s+used = (\d+(?:\.\d+)?)([KMG])\s+free = (\d+(?:\.\d+)?)([KMG])/

/** The names under which Node runs: a row of one of these is read by the script it runs. */
const NODE_PROGRAMS = new Set(['node', 'node.exe', 'nodejs'])

/**
 * Node options that run their value as the program itself (`node -e "…"`, `node --print "…"`): no script file runs, so every later word is a positional argument, never the script. Matched on the option's name, so the `--eval=…` spelling counts too.
 */
const NODE_EVAL_OPTIONS = new Set(['-e', '--eval', '-p', '--print'])

/**
 * Node options whose value follows as the next word, so that value is not read as the script.
 * Every entry accepts both the `--opt value` and the `--opt=value` spelling (checked against the pinned node's parsing); the `=` spelling carries its value attached, so only the bare word eats the next word. Node's other value-taking options take it attached only and never eat a word: the optional-valued `--inspect`/`--inspect-brk` (`--inspect=9229`; a separate word after bare `--inspect` is the script) and the v8 number flags (`--max-old-space-size=4096`, which errors in the separate-word spelling), so they are no entries.
 */
const NODE_OPTIONS_WITH_VALUE = new Set([
  // Module preloaders: tsx, ts-node and dotenv run as `node --import tsx …` or `node --require dotenv/config …`.
  '--import',
  '--require',
  '-r',
  '--loader',
  '--experimental-loader',
  // The test runner's value-taking options.
  '--test-reporter',
  '--test-reporter-destination',
  '--test-concurrency',
  '--test-timeout',
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-shard',
  '--test-random-seed',
  '--test-rerun-failures',
  '--test-global-setup',
  '--test-coverage-include',
  '--test-coverage-exclude',
  '--test-coverage-branches',
  '--test-coverage-lines',
  '--test-coverage-functions',
  '--experimental-test-tag-filter',
  // Inspector setup beyond the optional-valued `--inspect` itself.
  '--inspect-port',
  '--inspect-publish-uid',
  // Run configuration: environment files, watch mode, snapshots.
  '--env-file',
  '--env-file-if-exists',
  '--watch-path',
  '--watch-kill-signal',
  '--snapshot-blob',
  '--build-snapshot-config',
  '--experimental-sea-config',
  '--experimental-package-map',
  // CPU and heap profiling and diagnostic reports.
  '--cpu-prof-dir',
  '--cpu-prof-interval',
  '--cpu-prof-name',
  '--heap-prof-dir',
  '--heap-prof-interval',
  '--heap-prof-name',
  '--heapsnapshot-near-heap-limit',
  '--heapsnapshot-signal',
  '--diagnostic-dir',
  '--report-filename',
  '--report-directory',
  '--report-signal',
  '--tls-keylog',
  '--redirect-warnings',
  // Runtime tuning and module resolution.
  '--title',
  '--icu-data-dir',
  '--openssl-config',
  '--localstorage-file',
  '--trace-event-categories',
  '--trace-event-file-pattern',
  '--trace-require-module',
  '--unhandled-rejections',
  '--use-largepages',
  '--v8-pool-size',
  '--max-http-header-size',
  '--network-family-autoselection-attempt-timeout',
  '--secure-heap',
  '--secure-heap-min',
  '--conditions',
  '-C',
  '--disable-warning',
  '--disable-proto',
  '--dns-result-order',
  '--allow-fs-read',
  '--allow-fs-write',
])

/** A Node option of the test runner: `--test` on the run, `--test-…` on it and on every file's child process. */
const TEST_OPTION_PATTERN = /^--test(?:$|[-=])/

/**
 * The build and test kinds this repository starts, in report order: each kind's label, the program names that run it, for pnpm the commands that install and, for tsc, eslint and fallow, the words that start a server.
 * A process counts under the first kind whose program it runs; `nodeTest` counts a node process with a test-runner option that runs none of the named programs.
 * A program started with one of its `serverOptions` is an editor's language server or an agent's MCP server (`tsc --lsp`, `eslint --mcp`, `fallow lsp-server`, `fallow mcp-server`), which stays open for hours and builds nothing, so it counts under no kind.
 */
const PROCESS_KINDS = [
  { id: 'nodeTest', label: 'node --test', programs: [] },
  { id: 'testShard', label: 'test-shard.mjs', programs: ['test-shard.mjs'] },
  {
    id: 'pregateTests',
    label: 'run-pregate-tests.mjs',
    programs: ['run-pregate-tests.mjs'],
  },
  {
    id: 'tsc',
    label: 'tsc',
    programs: ['tsc', 'tsc.js'],
    serverOptions: ['--lsp'],
  },
  // These two build inside their own process (qa-build.mjs bundles with esbuild between its tsc and vsce children,
  // build-fast.mjs transpiles in-process), so no child names the build while it runs. `esbuild` itself is no program
  // of any kind: other projects' dev servers keep an `esbuild --service` process open for hours, which would read
  // busy while nothing of this repository builds; this repository's esbuild runs inside a counted script.
  {
    id: 'inProcessBuild',
    label: 'qa-build.mjs or build-fast.mjs',
    programs: ['qa-build.mjs', 'build-fast.mjs'],
  },
  // `pnpm lint` runs typed linting (projectService): each worker builds its own TypeScript program. pnpm's shim starts
  // it as `node …/eslint/bin/eslint.js`. An editor's ESLint language server runs the ESLint extension's own
  // `eslintServer.js`, under no name of this kind; `eslint --mcp` (ESLint's MCP setup) stays open while its server runs.
  {
    id: 'eslint',
    label: 'eslint',
    programs: ['eslint', 'eslint.js'],
    serverOptions: ['--mcp'],
  },
  {
    id: 'fallow',
    label: 'fallow',
    programs: ['fallow', 'fallow.exe'],
    serverOptions: ['lsp-server', 'mcp-server'],
  },
  { id: 'c8', label: 'c8', programs: ['c8', 'c8.js'] },
  {
    id: 'pnpmInstall',
    label: 'pnpm install',
    programs: ['pnpm', 'pnpm.native', 'pnpm.cjs', 'pnpm.exe'],
    commands: ['install', 'i', 'add', 'update', 'up'],
  },
  {
    id: 'package',
    label: 'package.mjs, check-package.mjs or vsce',
    programs: ['package.mjs', 'check-package.mjs', 'vsce'],
  },
  { id: 'health', label: 'checkHealth.mjs', programs: ['checkHealth.mjs'] },
  { id: 'gate', label: 'gate.mjs', programs: ['gate.mjs'] },
  // Review processes supply trial context. Their long-running editor or app-server counterparts do not count.
  {
    id: 'codeRabbitReview',
    label: 'CodeRabbit CLI review',
    programs: ['coderabbit'],
    observeOnly: true,
  },
  {
    id: 'codexReview',
    label: 'Codex CLI review',
    programs: ['codex'],
    observeOnly: true,
  },
]

/** Every program name a kind counts: a word of node's script path that ends in one of these ends that path ({@link scriptEndIndexOf}). */
const KNOWN_PROGRAMS = new Set(PROCESS_KINDS.flatMap((kind) => kind.programs))

const VERDICT_CLEAR = 'clear'
const VERDICT_BUSY = 'busy'

/** The `--help` text: usage, what it reads and prints, the kinds, options, example, exit codes and error codes. */
export const HELP_TEXT = `Usage:
  node extension/scripts/native-precheck.mjs [--experiment] [--max-used-swap-mb <n>] [--json]

Run on the Mac from the repository root before each native step in the macOS Space:
read the current macOS memory pressure, the process counts, load averages, cores and
allocated swap. Retained swap (including an unknown reading) is diagnostic only.
  PRECHECK: clear           noncritical memory pressure and no competing heavy work,
                            or a controlled --experiment with known overlapping work
  PRECHECK: busy <reasons>  critical memory pressure, unreadable required evidence,
                            unsupported host, or competing work outside an experiment
It prints kinds and counts only, never a process's arguments, environment or working
directory, and it signals no process.

Kinds: node --test (a node process with a --test option), test-shard.mjs,
run-pregate-tests.mjs, tsc (not an editor's language server, tsc --lsp), qa-build.mjs
or build-fast.mjs (they build inside their own process), eslint (not its MCP server,
eslint --mcp; an editor's ESLint language server runs as eslintServer.js and is not
counted), fallow (not its language or MCP server, fallow lsp-server or mcp-server),
c8, pnpm install (install, i, add, update, up), package.mjs, check-package.mjs or
vsce, checkHealth.mjs, gate.mjs. A process counts once, under the program it runs;
a script that node runs from a path holding a space still counts, but node itself or
a native binary (pnpm's, Fallow's) installed under such a path is read as two words
and is not counted. esbuild is not counted by itself: other projects' dev servers
keep its service process open for hours. CodeRabbit and Codex CLI review counts
are observational in both modes. JSON also includes rssMiBByKind, the sum of the
sampled resident sizes of counted processes in MiB (null if incomplete). Each PID
is assigned once by the same classifier as the count. Shared pages can appear in
multiple processes' RSS, and unclassified subprocesses contribute no measurements.

Options:
  --experiment            admit and report known overlapping work on the local QA
                          Space while macOS pressure is normal or warning
  --max-used-swap-mb <n>  legacy diagnostic setting in MB (default ${DEFAULT_MAX_USED_SWAP_MB});
                          accepted for compatibility and does not affect admission
  --json                  print one JSON object with the process RSS measurements
  --help                  print this text

Prerequisites: Node on PATH; ps (and sysctl on macOS).

Example:
  node extension/scripts/native-precheck.mjs

Exit codes: 0 clear; 3 busy, the verdict line names why; 2 failed before a verdict; 64 usage.

Error codes: E_USAGE, E_INTERNAL.
`

/** One-line message of a thrown value. @example oneLine(new Error('a\nb')) // => 'a b' */
function oneLine(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim()
}

/** The refusal for a usage mistake (exit 64). @example throw usageRefusal('unexpected argument x') */
function usageRefusal(message) {
  return new CommandRefusal('E_USAGE', message, {
    fix: 'node extension/scripts/native-precheck.mjs --help',
    exitCode: EXIT.USAGE,
  })
}

/**
 * Parses the command line into its output, experiment and compatibility options.
 *
 * Why: a bad limit must stop the run before anything is read, under the delivery commands' usage contract. Called by {@link runNativePrecheck}.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ mode: 'help' } | { mode: 'check', json: boolean, experiment: boolean, maxUsedSwapMb: number }} The mode; `check` carries the output form, the experiment choice and the legacy swap setting.
 * @throws {CommandRefusal} `E_USAGE` (exit 64) for an unknown option, a stray argument or a limit that is no whole number.
 * @example
 * parsePrecheckArguments(['--json', '--max-used-swap-mb', '4096']) // => { mode: 'check', json: true, experiment: false, maxUsedSwapMb: 4096 }
 */
function parsePrecheckArguments(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        experiment: { type: 'boolean' },
        'max-used-swap-mb': { type: 'string' },
      },
    }))
  } catch (error) {
    throw usageRefusal(oneLine(error))
  }
  if (values.help) return { mode: 'help' }
  const limitText = values['max-used-swap-mb']
  // Digits only: a sign, a decimal point or `1e3` is no whole number of MB.
  if (limitText !== undefined && !/^\d+$/.test(limitText))
    throw usageRefusal(
      `--max-used-swap-mb takes a whole number of MB (got ${limitText})`,
    )
  return {
    mode: 'check',
    json: values.json === true,
    experiment: values.experiment === true,
    maxUsedSwapMb:
      limitText === undefined ? DEFAULT_MAX_USED_SWAP_MB : Number(limitText),
  }
}

/**
 * Reads the swap line of `sysctl -n vm.swapusage` as MB.
 *
 * The load report and trial recorder keep allocated swap as context alongside live pressure. Called by {@link gatherFacts}; tests call it with hard-coded lines.
 *
 * @param {string | undefined} text - The line `sysctl` printed, or `undefined` when it could not run (another system).
 * @returns {{ totalMb: number, usedMb: number, freeMb: number } | undefined} The three amounts in MB; `undefined` when the text holds no swap line.
 * @example
 * parseSwapUsage('total = 2048.00M  used = 1228.25M  free = 819.75M  (encrypted)') // => { totalMb: 2048, usedMb: 1228.25, freeMb: 819.75 }
 * parseSwapUsage("sysctl: unknown oid 'vm.swapusage'") // => undefined
 */
export function parseSwapUsage(text) {
  const match = SWAP_LINE_PATTERN.exec(text ?? '')
  if (match === null) return undefined
  const inMb = (amount, unit) => Number(amount) * MB_PER_SWAP_UNIT[unit]
  const swap = {
    totalMb: inMb(match[1], match[2]),
    usedMb: inMb(match[3], match[4]),
    freeMb: inMb(match[5], match[6]),
  }
  // A digit string large enough to become Infinity cannot describe the machine.
  return Object.values(swap).every(Number.isFinite) ? swap : undefined
}

/**
 * Reads the process list as PID, command and arguments, with optional leading RSS in KiB.
 *
 * Why: the classification works on rows, so the reading of the machine stays apart from the judgement. Called by {@link productionSeams}' reader; tests call it with hard-coded text.
 * A command line is split at whitespace, so a path that holds a space becomes several words; {@link scriptEndIndexOf} finds the end of node's script path again, and a command path cut so stays unknown (`--help` says so).
 *
 * @param {string | undefined} text - What `ps` printed, or `undefined` when it could not run.
 * @param {boolean} withRss - The caller requested the leading RSS column from ps.
 * @returns {Array<{ pid: number, command: string, args: string[], rssKiB?: number }> | undefined} One row per line with a pid; `undefined` when there is no text.
 * @example
 * parseProcessRows(' 5101 node --test a.test.js\n') // => [{ pid: 5101, command: 'node', args: ['--test', 'a.test.js'] }]
 */
export function parseProcessRows(text, withRss = false) {
  if (text === undefined) return undefined
  const rows = []
  for (const line of text.split('\n')) {
    // RSS comes first so a denied or blank value still leaves the complete PID and command columns.
    const prefix = withRss ? /^\s*(\S+)\s+(?=\d+\s+\S)/.exec(line) : null
    const processLine = prefix ? line.slice(prefix[0].length) : line
    const match = /^\s*(\d+)\s+(\S.*)$/.exec(processLine)
    // A blank line, or one without a pid, is no process.
    if (match === null) continue
    const [command, ...args] = match[2].trim().split(/\s+/)
    const row = { pid: Number(match[1]), command, args }
    if (prefix && /^\d+$/.test(prefix[1])) {
      const rssKiB = Number(prefix[1])
      if (Number.isSafeInteger(rssKiB)) row.rssKiB = rssKiB
    }
    rows.push(row)
  }
  return rows
}

/** The option's name without an attached value: `--require=tsx` is `--require`. @example optionNameOf('--require=tsx') // => '--require' */
function optionNameOf(arg) {
  const equalsIndex = arg.indexOf('=')
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex)
}

/**
 * Finds the index of the script a node process runs: the first word that is no option and no option's value.
 * @param {string[]} args - The node process's arguments.
 * @returns {number} The script's index, or -1 when node runs no script (`node --test` with no file, `node -e …`).
 * @example scriptIndexOf(['--import', 'tsx', 'scripts/gate.mjs']) // => 2
 */
function scriptIndexOf(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    // `--` ends node's own options: the next word is the script even when it starts with a dash.
    if (arg === '--') return index + 1 < args.length ? index + 1 : -1
    if (!arg.startsWith('-')) return index
    // `-e`/`--eval` and `-p`/`--print` run their value as the program itself: the words after it are positional arguments, never a script file.
    if (NODE_EVAL_OPTIONS.has(optionNameOf(arg))) return -1
    // The value of `--import x` is no script; the `--import=x` spelling carries its value attached, so only the bare word eats the next word.
    if (!arg.includes('=') && NODE_OPTIONS_WITH_VALUE.has(arg)) index += 1
  }
  return -1
}

/**
 * Finds the word that ends node's script path when `ps` cut that path at its spaces.
 *
 * Why: `ps` prints a command line with its spaces, so `node /Users/a/Codebook Work/…/tsc -p x` reaches {@link parseProcessRows} as the words `/Users/a/Codebook` and `Work/…/tsc`. The script's path runs from its first word up to the first option, and a word there whose last segment is a known program ends it. Called by {@link programOf}.
 * The search stops at the first option, so a word of the script's own arguments (`--out gate.mjs`) never counts.
 *
 * @param {string[]} args - The node process's arguments.
 * @param {number} scriptIndex - Where the script's path starts ({@link scriptIndexOf}).
 * @returns {number} The index of the first word up to the first option whose last segment is a known program; `scriptIndex` when there is none.
 * @example scriptEndIndexOf(['/Users/a/Codebook', 'Work/scripts/gate.mjs'], 0) // => 1
 */
function scriptEndIndexOf(args, scriptIndex) {
  for (
    let index = scriptIndex;
    index < args.length && !args[index].startsWith('-');
    index += 1
  )
    if (KNOWN_PROGRAMS.has(basename(args[index]))) return index
  return scriptIndex
}

/**
 * Says which program a row runs: node's script for a node process, the binary's own name otherwise.
 * @param {{ command: string, args: string[] }} row - One process.
 * @returns {{ program: string, programArgs: string[], nodeOptions: string[] }} The program's file name, the words after it, and node's own options (empty for another binary).
 * @example programOf({ command: '/usr/bin/node', args: ['--test', 'scripts/gate.mjs'] }) // => { program: 'gate.mjs', programArgs: [], nodeOptions: ['--test'] }
 */
function programOf({ command, args }) {
  const commandName = basename(command)
  if (!NODE_PROGRAMS.has(commandName))
    return { program: commandName, programArgs: args, nodeOptions: [] }
  const scriptIndex = scriptIndexOf(args)
  // `node --test` without a file runs no script; its options still say it runs tests.
  if (scriptIndex === -1)
    return { program: commandName, programArgs: [], nodeOptions: args }
  const scriptEndIndex = scriptEndIndexOf(args, scriptIndex)
  return {
    program: basename(args[scriptEndIndex]),
    programArgs: args.slice(scriptEndIndex + 1),
    nodeOptions: args.slice(0, scriptIndex),
  }
}

/**
 * Names the kind of one process, or none.
 * @param {{ command: string, args: string[] }} row - One process.
 * @returns {string | undefined} The id of the first {@link PROCESS_KINDS} entry it matches; `nodeTest` for a node process with a test-runner option that runs no named program.
 * @example kindOf({ command: 'node', args: ['scripts/gate.mjs'] }) // => 'gate'
 */
function kindOf(row) {
  const { program, programArgs, nodeOptions } = programOf(row)
  // Only the explicit CLI review modes are measured, never ordinary Codex sessions or argument text.
  if (program === 'coderabbit')
    return ['review', '--agent'].includes(programArgs[0])
      ? 'codeRabbitReview'
      : undefined
  if (program === 'codex')
    return programArgs[0] === 'review' ||
      (programArgs[0] === 'exec' && programArgs[1] === 'review')
      ? 'codexReview'
      : undefined
  const named = PROCESS_KINDS.find(
    (kind) =>
      kind.programs.includes(program) &&
      (kind.commands === undefined ||
        programArgs.some((word) => kind.commands.includes(word))) &&
      // A language or MCP server of that program (`tsc --lsp`, `fallow lsp-server`) is no build.
      !programArgs.some((word) => kind.serverOptions?.includes(word)),
  )
  if (named !== undefined) return named.id
  return nodeOptions.some((option) => TEST_OPTION_PATTERN.test(option))
    ? 'nodeTest'
    : undefined
}

/**
 * Summarize the PIDs in a single workload sample for {@link gatherFacts}.
 * The first classified row for a PID wins. {@link kindOf} prefers a named program over the generic Node test runner.
 * Missing RSS on any counted process makes the sum unknown while preserving every count.
 * @param {Array<{ pid: number, command: string, args: string[], rssKiB?: number }>} rows - One process table.
 * @param {number} ownPid - Exclude the precheck itself.
 * @example summarizeWorkloads([{pid: 5, command: 'tsc', args: [], rssKiB: 2048}], 1).rssMiBByKind.tsc // => 2
 */
function summarizeWorkloads(rows, ownPid) {
  const processes = Object.fromEntries(
    PROCESS_KINDS.map((kind) => [kind.id, 0]),
  )
  const rssMiBByKind = { ...processes }
  const counted = new Set()
  // A counts-only ps fallback has no RSS samples, even on an otherwise quiet host.
  let rssAvailable = rows.some(
    (row) => Number.isSafeInteger(row.rssKiB) && row.rssKiB >= 0,
  )
  for (const row of rows) {
    if (row.pid === ownPid || counted.has(row.pid)) continue
    const kind = kindOf(row)
    if (kind === undefined) continue
    counted.add(row.pid)
    processes[kind] += 1
    if (Number.isSafeInteger(row.rssKiB) && row.rssKiB >= 0)
      rssMiBByKind[kind] += row.rssKiB / 1024
    else rssAvailable = false
  }
  return { processes, rssMiBByKind: rssAvailable ? rssMiBByKind : null }
}

/**
 * Count the classified processes for callers that need only the totals.
 * @param {Parameters<typeof summarizeWorkloads>[0]} rows - The sampled process table.
 * @param {number} ownPid - The excluded precheck PID.
 * @example countProcessKinds([{ pid: 7, command: 'node', args: ['scripts/gate.mjs'] }], 1).gate // => 1
 */
export function countProcessKinds(rows, ownPid) {
  return summarizeWorkloads(rows, ownPid).processes
}

/**
 * Decide whether the QA Space may start under the workload that the Mac actually reports.
 * {@link runNativePrecheck} uses experiment mode only when the caller explicitly selects that trial.
 * @param {ReturnType<typeof gatherFacts>} facts - The host pressure and heavy process counts.
 * @param {boolean} experiment - Permit a known overlap and record the observed counts.
 * @example decideVerdict({ memoryPressure: 'normal', processes: {} }).verdict // => 'clear'
 */
export function decideVerdict(
  { memoryPressure, processes },
  experiment = false,
) {
  const reasons = []
  const observations = []
  if (processes === undefined) reasons.push('process list unknown')
  else {
    // A controlled overlap still reports every competing workload, even when pressure blocks admission.
    const workloads = experiment === true ? observations : reasons
    for (const kind of PROCESS_KINDS)
      if (!kind.observeOnly && processes[kind.id] > 0)
        workloads.push(`${processes[kind.id]} ${kind.label}`)
  }
  if (memoryPressure === 'critical') reasons.push('critical memory pressure')
  else if (memoryPressure === 'unsupported') reasons.push('macOS host required')
  else if (memoryPressure !== 'normal' && memoryPressure !== 'warning')
    reasons.push('memory pressure unknown')
  return {
    verdict: reasons.length === 0 ? VERDICT_CLEAR : VERDICT_BUSY,
    reasons,
    observations,
  }
}

/**
 * Interpret the current pressure exposed by the macOS sysctl for {@link gatherFacts}.
 * XNU's sysctl handler returns NOTE_MEMORYSTATUS_PRESSURE flags (normal 1, warning 2, critical 4).
 * @example memoryPressureOf('darwin', '4\n') // => 'critical'
 */
function memoryPressureOf(platform, text) {
  if (platform !== 'darwin') return 'unsupported'
  switch (typeof text === 'string' ? text.trim() : '') {
    case '1':
      return 'normal'
    case '2':
      return 'warning'
    case '4':
      return 'critical'
    default:
      return 'unknown'
  }
}

/** Rounds a load average for the report. @example roundLoad(6.256) // => 6.26 */
function roundLoad(value) {
  const scale = 10 ** LOAD_DECIMAL_PLACES
  return Math.round(value * scale) / scale
}

/**
 * Turns the raw readings into the facts the report and the verdict use.
 * @param {{ loadAverages: number[], cores: number, platform: string, pressureText?: string, swapText?: string, processRows?: Array<{ pid: number, command: string, args: string[] }> }} readings - What the machine reader answered.
 * @param {number} ownPid - This precheck's process id.
 * @returns {{ load: { oneMinute: number, fiveMinutes: number, fifteenMinutes: number, cores: number }, memoryPressure: string, swap?: object, processes?: Record<string, number>, rssMiBByKind: Record<string, number> | null }} The facts; `swap` and `processes` are `undefined` when unreadable.
 * @example gatherFacts({ platform: 'darwin', loadAverages: [1, 2, 3], cores: 8, processRows: [] }, 1).swap // => undefined
 */
export function gatherFacts(readings, ownPid) {
  const [oneMinute, fiveMinutes, fifteenMinutes] =
    readings.loadAverages.map(roundLoad)
  return {
    load: { oneMinute, fiveMinutes, fifteenMinutes, cores: readings.cores },
    swap: parseSwapUsage(readings.swapText),
    memoryPressure: memoryPressureOf(readings.platform, readings.pressureText),
    ...(readings.processRows?.length
      ? summarizeWorkloads(readings.processRows, ownPid)
      : { processes: undefined, rssMiBByKind: null }),
  }
}

/** The report's swap line. @example swapLine(undefined) // => 'Swap: unknown' */
function swapLine(swap) {
  if (swap === undefined) return 'Swap: unknown'
  return `Swap: total ${swap.totalMb} MB, used ${swap.usedMb} MB, free ${swap.freeMb} MB`
}

/**
 * Prints load, swap, current memory pressure, workload counts, experimental overlaps and the final verdict.
 * @param {ReturnType<typeof gatherFacts>} facts - The facts.
 * @param {ReturnType<typeof decideVerdict>} judgement - The verdict and its reasons.
 * @returns {string[]} The lines; only kinds, counts and amounts.
 * @example reportLines(facts, { verdict: 'clear', reasons: [], observations: [] }).at(-1) // => 'PRECHECK: clear'
 */
function reportLines(
  { load, swap, memoryPressure, processes },
  { verdict, reasons, observations },
) {
  const loads = [load.oneMinute, load.fiveMinutes, load.fifteenMinutes]
    .map((value) => value.toFixed(LOAD_DECIMAL_PLACES))
    .join(', ')
  const processLines =
    processes === undefined
      ? ['Running: unknown (no process list)']
      : PROCESS_KINDS.map(
          (kind) => `Running ${kind.label}: ${processes[kind.id]}`,
        )
  const verdictLine =
    verdict === VERDICT_CLEAR
      ? `PRECHECK: ${VERDICT_CLEAR}`
      : `PRECHECK: ${VERDICT_BUSY} ${reasons.join(', ')}`
  return [
    `Load: ${loads} (1, 5, 15 min) on ${load.cores} cores`,
    swapLine(swap),
    `Memory pressure: ${memoryPressure}`,
    ...processLines,
    ...observations.map((item) => `Experimental overlap: ${item}`),
    verdictLine,
  ]
}

/**
 * Runs a command and answers its standard output, or `undefined` when it cannot run, fails or runs out of time.
 * @param {string} command - The program (`ps`, `sysctl`).
 * @param {string[]} args - Its arguments.
 * @returns {string | undefined} The output on exit 0.
 * @example readCommandOutput('sysctl', ['-n', 'vm.swapusage']) // => 'total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)\n'
 */
function readCommandOutput(command, args) {
  const answer = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: READ_TIMEOUT_MS,
    maxBuffer: READ_MAX_BUFFER_BYTES,
    // Its diagnostics are not relayed: the answer is the output or none.
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return answer.error === undefined &&
    answer.status === 0 &&
    typeof answer.stdout === 'string'
    ? answer.stdout
    : undefined
}

/**
 * Collect the classification and RSS from one ps invocation so the memory belongs to the same PID sample.
 * {@link productionSeams} falls back to counts alone when the host rejects the resident-size column.
 * @param {typeof readCommandOutput} read - The process-table reader, injectable for a denied RSS column.
 * @example readProcessSample()?.length // => number of process rows sampled
 */
export function readProcessSample(read = readCommandOutput) {
  const rows = parseProcessRows(
    read('ps', ['-A', '-ww', '-o', 'rss=,pid=,args=']),
    true,
  )
  if (rows?.length) return rows
  return parseProcessRows(read('ps', ['-A', '-ww', '-o', 'pid=,args=']))
}

/**
 * The production seams: this process's id, the real machine reader and stdout.
 *
 * Why: the reading of the machine is the one thin part the tests replace; everything it answers goes through {@link gatherFacts} and {@link decideVerdict}. Called by {@link main}.
 * The reader uses sysctl for macOS pressure and swap, and ps for POSIX process classification and RSS.
 *
 * @returns {{ ownPid: number, readMachine: () => object, print: (line: string) => void }} The seams.
 * @example productionSeams().readMachine().cores // => 16
 */
export function productionSeams() {
  return {
    ownPid: process.pid,
    readMachine: () => ({
      loadAverages: loadavg(),
      cores: availableParallelism(),
      platform: process.platform,
      pressureText:
        process.platform === 'darwin'
          ? readCommandOutput('sysctl', [
              '-n',
              'kern.memorystatus_vm_pressure_level',
            ])
          : undefined,
      swapText:
        process.platform === 'darwin'
          ? readCommandOutput('sysctl', ['-n', 'vm.swapusage'])
          : undefined,
      processRows:
        process.platform === 'win32' ? undefined : readProcessSample(),
    }),
    print: (line) => console.log(line),
  }
}

/**
 * Runs the precheck for one argument list under injected effects.
 *
 * Why: tests drive the whole command with a fake machine; production wires {@link productionSeams}. Called by {@link main} and by `nativePrecheck.test.mjs`.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker (every stage only reads).
 * @returns {Promise<number>} {@link EXIT.DONE} for `--help` and a clear verdict, {@link EXIT.FOLLOW_UP} (3) for busy.
 * @throws {CommandRefusal} `E_USAGE` for a usage mistake.
 * @example
 * process.exitCode = await runNativePrecheck(['--json'], productionSeams(), progress)
 */
export async function runNativePrecheck(argv, seams, progress) {
  const parsed = parsePrecheckArguments(argv)
  if (parsed.mode === 'help') {
    seams.print(HELP_TEXT.trimEnd())
    return EXIT.DONE
  }
  progress.enter('read the machine')
  const facts = gatherFacts(seams.readMachine(), seams.ownPid)
  progress.enter('judge the facts')
  const judgement = decideVerdict(facts, parsed.experiment)
  // One JSON object for a caller that parses, else one line per fact.
  if (parsed.json)
    seams.print(
      JSON.stringify({
        load: facts.load,
        swap: facts.swap ?? null,
        memoryPressure: facts.memoryPressure,
        experiment: parsed.experiment,
        processes: facts.processes ?? null,
        rssMiBByKind: facts.rssMiBByKind,
        maxUsedSwapMb: parsed.maxUsedSwapMb,
        ...judgement,
      }),
    )
  else for (const line of reportLines(facts, judgement)) seams.print(line)
  return judgement.verdict === VERDICT_CLEAR ? EXIT.DONE : EXIT.FOLLOW_UP
}

/** Entry point body: wires production seams. @example process.exitCode = await runCommandLine(main) */
async function main(progress) {
  return runNativePrecheck(process.argv.slice(2), productionSeams(), progress)
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
