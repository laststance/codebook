// Runs the exact-HEAD gate behind `pnpm gate`: the fifteen checks a delivery passes before merge, in order, on a clean
// committed tree, with the Node of `.node-version` and the pnpm of `extension/package.json`'s `packageManager`.
//
//   pnpm --dir extension gate                 every check; logs under artifacts/gate/<short HEAD>/
//   pnpm --dir extension gate --out <folder>  logs in <folder>
//   pnpm --dir extension gate --allow-dirty   also on uncommitted changes (a trial run, not a gate)
//
// Exit 0: every check passed and HEAD did not move. Exit 1: a check failed, or HEAD or the tree changed during the run.
// Exit 2: refused before any check, because Node or pnpm differ from the pins, the checkout has changes, or an option is
// unknown. Each check's output goes to its own log; stdout gets one line per check and the verdict.
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

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
  { name: '07-test', script: 'test' },
  ...READER_DOM_CHECKS.map((check, index) => ({
    name: `${String(8 + index).padStart(2, '0')}-${check}`,
    readerDom: check,
  })),
  { name: '13-test-package', script: 'test:package' },
  { name: '14-health', script: 'health' },
  {
    name: '15-restore-context',
    nodeTest: '.codex/restore-product-context.test.mjs',
  },
]

/** Exit code of a refusal before any check. */
const REFUSED_EXIT_CODE = 2

/**
 * Reads the versions the repository pins: Node from the root `.node-version`, pnpm from `extension/package.json`'s
 * `packageManager` (its integrity suffix dropped).
 * Called by {@link main} before any check, and by tests with a folder of their own.
 * @param root - The repository's root.
 * @returns `{ node, pnpm }` as written there, for example `{ node: '24.22.1', pnpm: '12.4.2' }`.
 * @example
 * await readPins('/work/codebook') // => { node: '24.22.1', pnpm: '12.4.2' }
 */
export async function readPins(root) {
  const node = (await readFile(join(root, '.node-version'), 'utf8')).trim()
  const { packageManager } = JSON.parse(
    await readFile(join(root, 'extension/package.json'), 'utf8'),
  )
  const pnpm = /^pnpm@([^+]+)/.exec(String(packageManager))?.[1]
  return { node, pnpm }
}

/**
 * Says which running tool differs from its pin, one sentence each, so the gate refuses before it runs a check on an
 * unpinned toolchain (an editor's or a version manager's own Node, say).
 * Called by {@link main} with `process.versions.node` and the pnpm version {@link readRunningPnpm} found.
 * @param pins - The pinned versions ({@link readPins}).
 * @param running - The versions running now; `pnpm` is `undefined` when it could not be read.
 * @returns The refusal sentences; empty when both match.
 * @example
 * pinMismatches({ node: '24.22.1', pnpm: '12.4.2' }, { node: '24.21.0', pnpm: '12.4.2' })
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
  const answer = spawnSync('pnpm', ['--version'], {
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
 * Runs one check to its end with its output in `logPath`, never rejecting.
 * Called by {@link runGate} for each check in turn.
 * @param check - One of {@link GATE_CHECKS}.
 * @param logPath - The log file of the check.
 * @param out - The gate's output folder; a Reader DOM check makes its own folder in it.
 * @returns The check's exit code (`127` when it could not start, `1` when a signal ended it).
 * @example await runCheck(GATE_CHECKS[0], '/tmp/gate/01-format-check.log', '/tmp/gate') // => 0
 */
async function runCheck(check, logPath, out) {
  const log = createWriteStream(logPath)
  let command
  // A package script runs in the package, the other checks from the repository root.
  if (check.script !== undefined)
    command = { file: 'pnpm', args: [check.script], cwd: extension }
  else if (check.readerDom !== undefined)
    command = {
      file: process.execPath,
      args: [
        `extension/scripts/${check.readerDom}-qa.mjs`,
        'verify',
        await mkdtemp(join(out, `${check.readerDom}-`)),
      ],
      cwd: repository,
    }
  else
    command = {
      file: process.execPath,
      args: ['--test', check.nodeTest],
      cwd: repository,
    }
  const code = await new Promise((settle) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      env: checkEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.once('error', (error) => {
      log.write(`${error.message}\n`)
      settle(127)
    })
    child.once('close', (exitCode) => settle(exitCode ?? 1))
  })
  await new Promise((done) => log.end(done))
  return code
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
      },
    }).values
  } catch (error) {
    console.error(`Gate refused: ${error.message}`)
    return REFUSED_EXIT_CODE
  }
  const mismatches = pinMismatches(await readPins(repository), {
    node: process.versions.node,
    pnpm: readRunningPnpm(),
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
    runCheck,
    print,
  })
  await writeFile(join(out, 'summary.txt'), `${lines.join('\n')}\n`)
  return passed ? 0 : 1
}

if (isRunAsScript(import.meta.url)) process.exitCode = await main()
