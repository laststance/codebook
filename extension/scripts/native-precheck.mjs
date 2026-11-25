// Prints the Mac's load, swap and running builds before a native check in the macOS Space, and says whether the check may start (Discussion 359).
//
//   node extension/scripts/native-precheck.mjs [--min-free-swap-mb <n>] [--json]
//
// The Space's VM stops when the Mac's swap fills while builds, suites and package tests run on the Mac beside it. The
// driving agent runs this from the repository root on the Mac before each native step and starts the step only on
// `PRECHECK: clear`. See HELP_TEXT (`--help`) for the kinds counted, exit codes and error codes.
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

/** The least free swap that counts as clear when `--min-free-swap-mb` is not given (Discussion 359: the VM stopped at 14 to 15.3 of 16 GB used). */
const DEFAULT_MIN_FREE_SWAP_MB = 2048

/** How long `ps` or `sysctl` may take, and how much `ps` may print: a table with every argument of every process is a few megabytes at most. */
const READ_TIMEOUT_MS = 5_000
const READ_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/** Decimal places of a load average in the report and the JSON. */
const LOAD_DECIMAL_PLACES = 2

/** MB per unit of the swap line: macOS prints `M`, and a larger swap may read in `G`. */
const MB_PER_SWAP_UNIT = { K: 1 / 1024, M: 1, G: 1024 }

/** The swap line of `sysctl -n vm.swapusage`, e.g. `total = 2048.00M  used = 1228.25M  free = 819.75M  (encrypted)`. */
const SWAP_LINE_PATTERN =
  /total = ([\d.]+)([KMG])\s+used = ([\d.]+)([KMG])\s+free = ([\d.]+)([KMG])/

/** The names under which Node runs: a row of one of these is read by the script it runs. */
const NODE_PROGRAMS = new Set(['node', 'node.exe', 'nodejs'])

/** Node options whose value follows as the next word, so that value is not read as the script. */
const NODE_OPTIONS_WITH_VALUE = new Set([
  '--import',
  '--require',
  '-r',
  '--loader',
  '--experimental-loader',
  '-e',
  '--eval',
  '-p',
  '--print',
])

/** A Node option of the test runner: `--test` on the run, `--test-…` on it and on every file's child process. */
const TEST_OPTION_PATTERN = /^--test(?:$|[-=])/

/**
 * The build and test kinds this repository starts, in report order: each kind's label, the program names that run it, for pnpm the commands that install and, for tsc, the option that starts a language server.
 * A process counts under the first kind whose program it runs; `nodeTest` counts a node process with a test-runner option that runs none of the named programs.
 * A program started with one of its `serverOptions` is an editor's language server, which stays open for hours and builds nothing, so it counts under no kind.
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
  { id: 'fallow', label: 'fallow', programs: ['fallow', 'fallow.exe'] },
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
]

const VERDICT_CLEAR = 'clear'
const VERDICT_BUSY = 'busy'

/** The `--help` text: usage, what it reads and prints, the kinds, options, example, exit codes and error codes. */
export const HELP_TEXT = `Usage:
  node extension/scripts/native-precheck.mjs [--min-free-swap-mb <n>] [--json]

Run on the Mac from the repository root before each native step in the macOS Space:
the Space's VM stops when the Mac's swap fills. Prints the 1, 5 and 15 minute load
averages and the core count, the swap's total, used and free MB (sysctl -n
vm.swapusage on macOS; "unknown" elsewhere) and, per kind, how many build or test
processes run on this machine, then one verdict line:
  PRECHECK: clear           no such process runs and free swap is at the limit or
                            above (no swap allocated counts as free)
  PRECHECK: busy <reasons>  a kind runs, free swap is below the limit, or the swap
                            or the process list cannot be read
It prints kinds and counts only, never a process's arguments, environment or working
directory, and it signals no process.

Kinds: node --test (a node process with a --test option), test-shard.mjs,
run-pregate-tests.mjs, tsc (not an editor's language server, tsc --lsp), fallow, c8,
pnpm install (install, i, add, update, up), package.mjs, check-package.mjs or vsce,
checkHealth.mjs, gate.mjs. A process counts once, under the program it runs; a
program whose path holds a space is read as two words and is not counted.

Options:
  --min-free-swap-mb <n>  the least free swap that counts as clear, in MB
                          (default ${DEFAULT_MIN_FREE_SWAP_MB})
  --json                  print the same facts as one JSON object instead of lines
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
 * Parses the command line into one mode and its limit.
 *
 * Why: a bad limit must stop the run before anything is read, under the delivery commands' usage contract. Called by {@link runNativePrecheck}.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ mode: 'help' } | { mode: 'check', json: boolean, minFreeSwapMb: number }} The mode; `check` carries the output form and the swap limit in MB.
 * @throws {CommandRefusal} `E_USAGE` (exit 64) for an unknown option, a stray argument or a limit that is no whole number.
 * @example
 * parsePrecheckArguments(['--json', '--min-free-swap-mb', '512']) // => { mode: 'check', json: true, minFreeSwapMb: 512 }
 */
function parsePrecheckArguments(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        'min-free-swap-mb': { type: 'string' },
      },
    }))
  } catch (error) {
    throw usageRefusal(oneLine(error))
  }
  if (values.help) return { mode: 'help' }
  const limitText = values['min-free-swap-mb']
  // Digits only: a sign, a decimal point or `1e3` is no whole number of MB.
  if (limitText !== undefined && !/^\d+$/.test(limitText))
    throw usageRefusal(
      `--min-free-swap-mb takes a whole number of MB (got ${limitText})`,
    )
  return {
    mode: 'check',
    json: values.json === true,
    minFreeSwapMb:
      limitText === undefined ? DEFAULT_MIN_FREE_SWAP_MB : Number(limitText),
  }
}

/**
 * Reads the swap line of `sysctl -n vm.swapusage` as MB.
 *
 * Why: the Space's VM stops when the Mac's swap fills, so free swap is one of the two facts the verdict rests on. Called by {@link gatherFacts}; tests call it with hard-coded lines.
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
  return {
    totalMb: inMb(match[1], match[2]),
    usedMb: inMb(match[3], match[4]),
    freeMb: inMb(match[5], match[6]),
  }
}

/**
 * Reads the text of `ps -A -ww -o pid=,args=` as rows of pid, command and arguments.
 *
 * Why: the classification works on rows, so the reading of the machine stays apart from the judgement. Called by {@link productionSeams}' reader; tests call it with hard-coded text.
 * A command line is split at whitespace, so a path that holds a space becomes two words (`--help` says so).
 *
 * @param {string | undefined} text - What `ps` printed, or `undefined` when it could not run.
 * @returns {Array<{ pid: number, command: string, args: string[] }> | undefined} One row per line with a pid; `undefined` when there is no text.
 * @example
 * parseProcessRows(' 5101 node --test a.test.js\n') // => [{ pid: 5101, command: 'node', args: ['--test', 'a.test.js'] }]
 */
export function parseProcessRows(text) {
  if (text === undefined) return undefined
  const rows = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\S.*)$/.exec(line)
    // A blank line, or one without a pid, is no process.
    if (match === null) continue
    const [command, ...args] = match[2].trim().split(/\s+/)
    rows.push({ pid: Number(match[1]), command, args })
  }
  return rows
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
    if (!arg.startsWith('-')) return index
    // The value of `--import x` is no script.
    if (NODE_OPTIONS_WITH_VALUE.has(arg)) index += 1
  }
  return -1
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
  return {
    program: basename(args[scriptIndex]),
    programArgs: args.slice(scriptIndex + 1),
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
  const named = PROCESS_KINDS.find(
    (kind) =>
      kind.programs.includes(program) &&
      (kind.commands === undefined ||
        programArgs.some((word) => kind.commands.includes(word))) &&
      // An editor's language server of that program (`tsc --lsp`) is no build.
      !programArgs.some((word) => kind.serverOptions?.includes(word)),
  )
  if (named !== undefined) return named.id
  return nodeOptions.some((option) => TEST_OPTION_PATTERN.test(option))
    ? 'nodeTest'
    : undefined
}

/**
 * Counts the build and test processes per kind.
 *
 * Why: a native check in the Space starts only while no build, suite, package test or measured health runs on the Mac (Discussion 359). Called by {@link gatherFacts}; tests call it with hard-coded rows.
 * Only kinds and counts leave this function: no argument of any row does.
 *
 * @param {Array<{ pid: number, command: string, args: string[] }>} rows - The machine's processes.
 * @param {number} ownPid - This precheck's process id; its row is never counted (it may run inside a `node --test` run).
 * @returns {Record<string, number>} One count per {@link PROCESS_KINDS} id, in report order.
 * @example
 * countProcessKinds([{ pid: 7, command: 'node', args: ['scripts/gate.mjs'] }], 1).gate // => 1
 */
export function countProcessKinds(rows, ownPid) {
  const counts = Object.fromEntries(PROCESS_KINDS.map((kind) => [kind.id, 0]))
  for (const row of rows) {
    if (row.pid === ownPid) continue
    const kind = kindOf(row)
    if (kind !== undefined) counts[kind] += 1
  }
  return counts
}

/**
 * Decides from the facts whether the native check may start, and why not.
 *
 * Why: the judgement stays a pure function of the facts and the limit, so the tests pin it without a machine. Called by {@link runNativePrecheck}.
 * - Each kind with a count names `<count> <label>`.
 * - Free swap below the limit names both numbers; no swap allocated (total 0) counts as free.
 * - A process list or swap that could not be read is a reason too: the rule needs the swap shown free and no build seen.
 *
 * @param {{ swap?: { totalMb: number, freeMb: number }, processes?: Record<string, number> }} facts - What {@link gatherFacts} read.
 * @param {number} minFreeSwapMb - The least free swap that counts as clear, in MB.
 * @returns {{ verdict: 'clear' | 'busy', reasons: string[] }} `clear` with no reason, or `busy` with every reason in report order.
 * @example
 * decideVerdict({ swap: { totalMb: 0, usedMb: 0, freeMb: 0 }, processes: { nodeTest: 2 } }, 2048) // => { verdict: 'busy', reasons: ['2 node --test'] }
 */
export function decideVerdict({ swap, processes }, minFreeSwapMb) {
  const reasons = []
  if (processes === undefined) reasons.push('process list unknown')
  else
    for (const kind of PROCESS_KINDS)
      if (processes[kind.id] > 0)
        reasons.push(`${processes[kind.id]} ${kind.label}`)
  if (swap === undefined) reasons.push('swap unknown')
  else if (swap.totalMb > 0 && swap.freeMb < minFreeSwapMb)
    reasons.push(`free swap ${swap.freeMb} MB below ${minFreeSwapMb} MB`)
  return {
    verdict: reasons.length === 0 ? VERDICT_CLEAR : VERDICT_BUSY,
    reasons,
  }
}

/** Rounds a load average for the report. @example roundLoad(6.256) // => 6.26 */
function roundLoad(value) {
  const scale = 10 ** LOAD_DECIMAL_PLACES
  return Math.round(value * scale) / scale
}

/**
 * Turns the raw readings into the facts the report and the verdict use.
 * @param {{ loadAverages: number[], cores: number, swapText?: string, processRows?: Array<{ pid: number, command: string, args: string[] }> }} readings - What the machine reader answered.
 * @param {number} ownPid - This precheck's process id.
 * @returns {{ load: { oneMinute: number, fiveMinutes: number, fifteenMinutes: number, cores: number }, swap?: object, processes?: Record<string, number> }} The facts; `swap` and `processes` are `undefined` when unreadable.
 * @example gatherFacts({ loadAverages: [1, 2, 3], cores: 8, swapText: undefined, processRows: [] }, 1).swap // => undefined
 */
function gatherFacts(readings, ownPid) {
  const [oneMinute, fiveMinutes, fifteenMinutes] =
    readings.loadAverages.map(roundLoad)
  return {
    load: { oneMinute, fiveMinutes, fifteenMinutes, cores: readings.cores },
    swap: parseSwapUsage(readings.swapText),
    processes:
      readings.processRows === undefined
        ? undefined
        : countProcessKinds(readings.processRows, ownPid),
  }
}

/** The report's swap line. @example swapLine(undefined) // => 'Swap: unknown' */
function swapLine(swap) {
  if (swap === undefined) return 'Swap: unknown'
  return `Swap: total ${swap.totalMb} MB, used ${swap.usedMb} MB, free ${swap.freeMb} MB`
}

/**
 * Prints the report as lines: load, swap, one line per kind, and the verdict last.
 * @param {ReturnType<typeof gatherFacts>} facts - The facts.
 * @param {ReturnType<typeof decideVerdict>} judgement - The verdict and its reasons.
 * @returns {string[]} The lines; only kinds, counts and amounts.
 * @example reportLines(facts, { verdict: 'clear', reasons: [] }).at(-1) // => 'PRECHECK: clear'
 */
function reportLines({ load, swap, processes }, { verdict, reasons }) {
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
    ...processLines,
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
  return answer.status === 0 && typeof answer.stdout === 'string'
    ? answer.stdout
    : undefined
}

/**
 * The production seams: this process's id, the real machine reader and stdout.
 *
 * Why: the reading of the machine is the one thin part the tests replace; everything it answers goes through {@link gatherFacts} and {@link decideVerdict}. Called by {@link main}.
 * The reader runs `sysctl -n vm.swapusage` on macOS only and `ps -A -ww -o pid=,args=` on POSIX systems; it signals nothing.
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
      swapText:
        process.platform === 'darwin'
          ? readCommandOutput('sysctl', ['-n', 'vm.swapusage'])
          : undefined,
      processRows:
        process.platform === 'win32'
          ? undefined
          : parseProcessRows(
              readCommandOutput('ps', ['-A', '-ww', '-o', 'pid=,args=']),
            ),
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
  const judgement = decideVerdict(facts, parsed.minFreeSwapMb)
  // One JSON object for a caller that parses, else one line per fact.
  if (parsed.json)
    seams.print(
      JSON.stringify({
        load: facts.load,
        swap: facts.swap ?? null,
        processes: facts.processes ?? null,
        minFreeSwapMb: parsed.minFreeSwapMb,
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
