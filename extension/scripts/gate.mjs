// Runs the exact-HEAD gate behind `pnpm gate`: the sixteen checks a delivery passes before merge, in order, on a clean
// committed tree, with the Node of `.node-version`, the Bun of `.bun-version` and the pnpm of `extension/package.json`'s
// `packageManager`.
//
//   pnpm --dir extension gate                 every check; logs under artifacts/gate/<short HEAD>/
//   pnpm --dir extension gate --out <folder>  logs in <folder>
//   pnpm --dir extension gate --allow-dirty   also on uncommitted changes (a trial run, not a gate)
//   pnpm --dir extension gate --silence-seconds <n>  end a check silent this long (default 300)
//
// Exit 0: every check passed and HEAD did not move. Exit 1: a check failed, or HEAD or the tree changed during the run.
// Exit 2: refused before any check, because Node, pnpm or Bun differ from the pins or a pin file cannot be read, the checkout has changes, or an option is
// unknown. Each check's output goes to its own log; stdout gets one line per check and the verdict. A check that prints
// nothing for the silence bound has its whole process tree ended and counts as exit 124; SIGINT, SIGTERM or SIGHUP to
// the gate ends the running check's tree and exits 130, 143 or 129.
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { createResettingTimer } from './utils/createResettingTimer.mjs'
import { endChildrenOnSignal } from './utils/endChildrenOnSignal.mjs'
import { endProcessTree } from './utils/endProcessTree.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { listCheckoutChanges } from './utils/listCheckoutChanges.mjs'
import { plainOutputEnvironment } from './utils/plainOutputEnvironment.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const repository = join(extension, '..')

/** The five Reader DOM checks the `reader-dom.yml` workflow runs, each as `node extension/scripts/<name>-qa.mjs verify <folder>`. */
const READER_DOM_CHECKS = [
  'study-bootstrap',
  'wiki-reader-dom',
  'study-reading-pose',
  'understanding-focus',
  'repository-return',
]

/**
 * The gate's checks in the order they run: a package script (`pnpm <script>` in `extension/`), a Reader DOM check (in a
 * fresh folder of its own), or a Node test file run from the repository root.
 */
export const GATE_CHECKS = [
  { name: '01-format-check', script: 'format:check' },
  { name: '02-typecheck', script: 'typecheck' },
  { name: '03-lint', script: 'lint' },
  { name: '04-health-static', script: 'health:static' },
  { name: '05-dupes', script: 'dupes' },
  { name: '06-dead-code', script: 'dead-code' },
  { name: '07-architecture', script: 'architecture' },
  { name: '08-test', script: 'test' },
  ...READER_DOM_CHECKS.map((check, index) => ({
    name: `${String(9 + index).padStart(2, '0')}-${check}`,
    readerDom: check,
  })),
  { name: '14-test-package', script: 'test:package' },
  { name: '15-health', script: 'health' },
  {
    name: '16-restore-context',
    nodeTest: '.codex/restore-product-context.test.mjs',
  },
]

/** Exit code of a refusal before any check. */
const REFUSED_EXIT_CODE = 2
/** How long a check may print nothing before its process tree is ended (seconds): the longest quiet step of a passing check (the package build's progress lines come every 30 s) stays far below it. */
const DEFAULT_SILENCE_SECONDS = 300
/** The exit code a check gets when the silence bound ended it, as `timeout(1)` reports a command it ended. */
const SILENT_EXIT_CODE = 124

/**
 * Reads the versions the repository pins: Node from the root `.node-version`, Bun (the formatter of the format check)
 * from the root `.bun-version`, which the Format workflow installs too, and pnpm from `extension/package.json`'s
 * `packageManager` (its integrity suffix dropped).
 * Called by {@link main} before any check, and by tests with a folder of their own.
 * @param root - The repository's root.
 * @returns `{ node, pnpm, bun }` as written there, for example `{ node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' }`.
 * @example
 * await readPins('/work/codebook') // => { node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' }
 */
export async function readPins(root) {
  const node = await readPinFile(root, '.node-version')
  const bun = await readPinFile(root, '.bun-version')
  const { packageManager } = JSON.parse(
    await readFile(join(root, 'extension/package.json'), 'utf8'),
  )
  const pnpm = /^pnpm@([^+]+)/.exec(String(packageManager))?.[1]
  return { node, pnpm, bun }
}

/**
 * Reads one version pin file of the repository's root, trimmed; called by {@link readPins}.
 * @param root - The repository's root.
 * @param name - The pin file, `.node-version` or `.bun-version`.
 * @returns The version as written, for example `'1.4.4'`.
 * @throws When the file cannot be read, with a sentence naming it, so the gate refuses instead of failing on a raw error.
 * @example await readPinFile('/work/codebook', '.bun-version') // => '1.4.4'
 */
async function readPinFile(root, name) {
  try {
    return (await readFile(join(root, name), 'utf8')).trim()
  } catch (error) {
    throw new Error(`${name} cannot be read (${error.code ?? error.message}).`)
  }
}

/**
 * Says which running tool differs from its pin, one sentence each, so the gate refuses before it runs a check on an
 * unpinned toolchain (an editor's or a version manager's own Node, say).
 * Called by {@link main} with `process.versions.node` and the pnpm and Bun versions {@link readRunningVersion} found.
 * @param pins - The pinned versions ({@link readPins}).
 * @param running - The versions running now; `pnpm` or `bun` is `undefined` when it could not be read.
 * @returns The refusal sentences; empty when all three match.
 * @example
 * pinMismatches({ node: '24.22.1', pnpm: '12.4.2', bun: '1.4.4' }, { node: '24.21.0', pnpm: '12.4.2', bun: '1.4.4' })
 * // => ['Node 24.21.0 runs here, but .node-version pins 24.22.1.']
 */
export function pinMismatches(pins, running) {
  const sentences = []
  if (running.node !== pins.node)
    sentences.push(
      `Node ${running.node} runs here, but .node-version pins ${pins.node}.`,
    )
  if (running.pnpm !== pins.pnpm)
    sentences.push(
      `pnpm ${running.pnpm ?? 'of an unknown version'} runs here, but extension/package.json pins ${pins.pnpm}.`,
    )
  if (running.bun !== pins.bun)
    sentences.push(
      `Bun ${running.bun ?? 'of an unknown version'} runs here, but .bun-version pins ${pins.bun}.`,
    )
  return sentences
}

/**
 * Reads the version of the pnpm the checks will run: the one that started this script (`npm_config_user_agent`), else
 * the `pnpm` on the path, asked in `extension/` so that its `packageManager` applies.
 * @returns The version, for example `'12.4.2'`, or `undefined` when no pnpm answers.
 * @example readRunningPnpm() // => '12.4.2'
 */
function readRunningPnpm() {
  const fromAgent = /\bpnpm\/(\S+)/.exec(
    process.env.npm_config_user_agent ?? '',
  )?.[1]
  if (fromAgent !== undefined) return fromAgent
  return readRunningVersion('pnpm')
}

/**
 * Asks a tool on the checks' path for its version, in `extension/` as the package scripts run it; called by
 * {@link readRunningPnpm} and by {@link main} for the Bun of the format check.
 * @param tool - The command, `pnpm` or `bun`.
 * @returns The version it prints, for example `'1.4.4'`, or `undefined` when it is missing or fails.
 * @example readRunningVersion('bun') // => '1.4.4'
 */
function readRunningVersion(tool) {
  const answer = spawnSync(tool, ['--version'], {
    cwd: extension,
    encoding: 'utf8',
    env: checkEnvironment(),
  })
  return answer.status === 0 ? answer.stdout.trim() : undefined
}

/**
 * The environment of every check: the running Node first on the path (so a child's `node` is the pinned one, whatever a
 * version manager's shim would pick), the Reader DOM tools next, an English locale (the Mac's default `en_NZ` changes
 * the time and Wiki texts some tests read), and no `FORCE_COLOR` (colour would hide the runners' counts).
 * @returns A copy of `process.env` with those changes.
 * @example checkEnvironment().LANG // => 'en_US.UTF-8'
 */
function checkEnvironment() {
  const environment = plainOutputEnvironment(process.env)
  return {
    ...environment,
    PATH: [
      dirname(process.execPath),
      join(repository, '.github/reader-dom/node_modules/.bin'),
      environment.PATH ?? '',
    ].join(delimiter),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  }
}

/**
 * Runs one command to its end with its output in `logPath`, never rejecting; ends its whole process tree when it prints
 * nothing for `silenceMs`, and when the gate gets SIGINT, SIGTERM or SIGHUP ({@link endChildrenOnSignal}).
 * Why: a check that hangs would hold the gate forever, and a check left running after the gate was ended keeps
 * rebuilding `extension/dist` under the next run. Called by {@link runCheck} for each check, and by tests.
 * @param command - `{ file, args, cwd }` of the process to start.
 * @param logPath - The log file that receives its stdout and stderr.
 * @param silenceMs - How long it may print nothing.
 * @returns Its exit code: {@link SILENT_EXIT_CODE} when the silence bound ended it, `127` when it could not start, `1` when a signal ended it.
 * @example await runCommand({ file: 'pnpm', args: ['lint'], cwd: extension }, '/tmp/gate/03-lint.log', 300_000) // => 0
 */
export async function runCommand(command, logPath, silenceMs) {
  const log = createWriteStream(logPath)
  const code = await new Promise((settle) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      env: checkEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const endTree = () =>
      endProcessTree(child, {
        platform: process.platform,
        environment: process.env,
      })
    const releaseSignalEnd = endChildrenOnSignal(endTree)
    let wasSilent = false
    const silence = createResettingTimer(silenceMs, () => {
      wasSilent = true
      log.write(
        `\nGate: no output for ${silenceMs / 1000} s; the check's process tree was ended.\n`,
      )
      void endTree()
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', () => silence.reset())
      stream.pipe(log, { end: false })
    }
    child.once('error', (error) => {
      log.write(`${error.message}\n`)
      silence.stop()
      releaseSignalEnd()
      settle(127)
    })
    child.once('close', (exitCode) => {
      silence.stop()
      releaseSignalEnd()
      settle(wasSilent ? SILENT_EXIT_CODE : (exitCode ?? 1))
    })
  })
  await new Promise((done) => log.end(done))
  return code
}

/**
 * Runs one of {@link GATE_CHECKS} through {@link runCommand}: a package script in `extension/`, a Reader DOM check in a
 * fresh folder of its own, or a Node test file from the repository root.
 * Called by {@link runGate} for each check in turn.
 * @param check - One of {@link GATE_CHECKS}.
 * @param logPath - The log file of the check.
 * @param out - The gate's output folder; a Reader DOM check makes its own folder in it.
 * @param silenceMs - How long the check may print nothing.
 * @returns The check's exit code ({@link runCommand}).
 * @example await runCheck(GATE_CHECKS[0], '/tmp/gate/01-format-check.log', '/tmp/gate', 300_000) // => 0
 */
async function runCheck(check, logPath, out, silenceMs) {
  // A package script runs in the package, the other checks from the repository root.
  if (check.script !== undefined)
    return runCommand(
      { file: 'pnpm', args: [check.script], cwd: extension },
      logPath,
      silenceMs,
    )
  if (check.readerDom !== undefined)
    return runCommand(
      {
        file: process.execPath,
        args: [
          `extension/scripts/${check.readerDom}-qa.mjs`,
          'verify',
          await mkdtemp(join(out, `${check.readerDom}-`)),
        ],
        cwd: repository,
      },
      logPath,
      silenceMs,
    )
  return runCommand(
    {
      file: process.execPath,
      args: ['--test', check.nodeTest],
      cwd: repository,
    },
    logPath,
    silenceMs,
  )
}

/**
 * Runs every check of the gate in order, each to its end even after an earlier one failed, and decides the verdict.
 * Why: the verdict is the gate's whole purpose, so it comes from the checks' own exit codes and from HEAD and the tree
 * before and after, never from a wrapper's exit; a run whose HEAD or tree moved proves nothing about either.
 * Called by {@link main}, and by tests with checks and readers of their own.
 * @param input - The checks, the output folder, the reader of HEAD, the reader of the checkout's changes, the runner of
 * one check and the writer of one line.
 * @returns `{ passed, results }`: `passed` is `true` only when every check exited 0 and HEAD and the changes stayed as
 * they were; `results` holds each check's `{ name, code, seconds }`.
 * @example
 * await runGate({ checks: GATE_CHECKS, out, readHead, listChanges, runCheck, print: console.log })
 * // => { passed: true, results: [{ name: '01-format-check', code: 0, seconds: 9 }, …] }
 */
export async function runGate({
  checks,
  out,
  readHead,
  listChanges,
  runCheck: runOne,
  print,
}) {
  const headBefore = await readHead()
  const changesBefore = (await listChanges()).join('\n')
  const results = []
  for (const check of checks) {
    const startedAt = Date.now()
    const code = await runOne(check, join(out, `${check.name}.log`), out)
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    results.push({ name: check.name, code, seconds })
    print(`${check.name} exit=${code} seconds=${seconds}`)
  }
  const headAfter = await readHead()
  const changesAfter = (await listChanges()).join('\n')
  const failed = results.filter((result) => result.code !== 0)
  const moved = []
  if (headAfter !== headBefore)
    moved.push(`HEAD moved from ${headBefore} to ${headAfter}`)
  if (changesAfter !== changesBefore)
    moved.push('the checkout changed during the run')
  for (const sentence of moved) print(`${sentence}.`)
  const passed = failed.length === 0 && moved.length === 0
  print(
    passed
      ? `GATE: pass on ${headAfter}`
      : `GATE: fail${failed.length > 0 ? ` (${failed.map((result) => result.name).join(', ')})` : ''} on ${headAfter}`,
  )
  return { passed, results }
}

/** Reads the commit the checkout is on. @example readHead() // => 'ad13920cd16fe8406df662eab904c56b087b843b' */
function readHead() {
  return spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).stdout.trim()
}

/**
 * The command line: refuses an unknown option, a toolchain that differs from the pins and, without `--allow-dirty`, a
 * checkout with changes; then runs the gate and writes `summary.txt` beside the logs.
 * @returns The exit code ({@link REFUSED_EXIT_CODE} for a refusal).
 * @example await main() // => 0
 */
async function main() {
  let options
  try {
    options = parseArgs({
      options: {
        out: { type: 'string' },
        'allow-dirty': { type: 'boolean', default: false },
        'silence-seconds': {
          type: 'string',
          default: String(DEFAULT_SILENCE_SECONDS),
        },
      },
    }).values
  } catch (error) {
    console.error(`Gate refused: ${error.message}`)
    return REFUSED_EXIT_CODE
  }
  const silenceSeconds = Number(options['silence-seconds'])
  if (!Number.isInteger(silenceSeconds) || silenceSeconds < 1) {
    console.error(
      `Gate refused: --silence-seconds takes a whole number of seconds, 1 or more (got ${options['silence-seconds']}).`,
    )
    return REFUSED_EXIT_CODE
  }
  let pins
  // A missing or unreadable pin file is a refusal before any check, like a mismatch, not a crash with exit 1.
  try {
    pins = await readPins(repository)
  } catch (error) {
    console.error(`Gate refused: ${error.message}`)
    return REFUSED_EXIT_CODE
  }
  const mismatches = pinMismatches(pins, {
    node: process.versions.node,
    pnpm: readRunningPnpm(),
    bun: readRunningVersion('bun'),
  })
  if (mismatches.length > 0) {
    console.error(`Gate refused: ${mismatches.join(' ')}`)
    return REFUSED_EXIT_CODE
  }
  const changes = await listCheckoutChanges(repository)
  // The gate proves a commit, so uncommitted changes make it a trial run only, which needs its option.
  if (changes.length > 0 && !options['allow-dirty']) {
    console.error(
      `Gate refused: the checkout has changes (${changes.slice(0, 5).join(', ')}); commit them, or pass --allow-dirty for a trial run.`,
    )
    return REFUSED_EXIT_CODE
  }
  const head = readHead()
  const out = resolve(
    options.out ?? join(repository, 'artifacts/gate', head.slice(0, 8)),
  )
  await mkdir(out, { recursive: true })
  const lines = [`HEAD ${head}`]
  const print = (line) => {
    lines.push(line)
    console.log(line)
  }
  print(`Logs in ${out}`)
  const { passed } = await runGate({
    checks: GATE_CHECKS,
    out,
    readHead,
    listChanges: () => listCheckoutChanges(repository),
    runCheck: (check, logPath, folder) =>
      runCheck(check, logPath, folder, silenceSeconds * 1000),
    print,
  })
  await writeFile(join(out, 'summary.txt'), `${lines.join('\n')}\n`)
  return passed ? 0 : 1
}

if (isRunAsScript(import.meta.url)) process.exitCode = await main()
