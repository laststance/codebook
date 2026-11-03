// Builds the QA VSIX of a clean commit (the commit /ship reviews) and writes its receipt (Cycle 0068, Implementation 2; the background review was retired in Cycle 0073).
//
//   node extension/scripts/qa-build.mjs
//   node extension/scripts/qa-build.mjs --status [<short>]
//
// See HELP_TEXT (`--help`) for prerequisites, exit codes and error codes.
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

import { buildPackage } from './utils/buildPackage.mjs'
import {
  CommandRefusal,
  EXIT,
  redactSecrets,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { listCheckoutChanges } from './utils/listCheckoutChanges.mjs'
import { packageGitOptions } from './utils/packageGitOptions.mjs'

const execFileAsync = promisify(execFile)

/** The repository this script belongs to (two folders above `extension/scripts`). */
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url))

/** A git call (rev-parse) may take this long. */
const GIT_TIMEOUT_MS = 60 * 1000

/** How many changed paths a dirty refusal names. */
const DIRTY_PATHS_SHOWN = 5

/** The `--help` text: usage, prerequisites, example, exit codes and error codes. */
export const HELP_TEXT = `Usage:
  node extension/scripts/qa-build.mjs
  node extension/scripts/qa-build.mjs --status [<short>]

Builds artifacts/qa/codebook-<short>.vsix (<short> = first 8 hex characters of HEAD)
from a clean commit and writes the receipt artifacts/qa/codebook-<short>.json (head,
version, sha256, entries, builtAt).

Options:
  --status [<s>]   print the receipt of the QA build of commit <s> (default: HEAD);
                   builds nothing
  --help           print this text

Prerequisites: the pinned Node and pnpm on PATH; git; a checkout with no changes; no test,
gate, health or other package run using this checkout while the build runs.

Example:
  node extension/scripts/qa-build.mjs

Exit codes: 0 done; 1 refused before any side effect; 2 failed before the receipt was
written; 4 outcome unknown, check before retrying; 64 usage.

Error codes: E_USAGE, E_DIRTY, E_BUILD, E_BUILD_DIRTY, E_NO_BUILD, E_INTERNAL.
`

/** One-line message of a thrown value. @example oneLine(new Error('a\nb')) // => 'a b' */
function oneLine(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim()
}

/** The production seams: real build, git, file system, change listing and clock. @example const seams = productionSeams(REPOSITORY) */
export function productionSeams(repository) {
  return {
    repository,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
    now: () => Date.now(),
    listChanges: (root) => listCheckoutChanges(root),
    build: (root, output) => buildPackage(root, output),
    git: async (args) => {
      try {
        const { stdout } = await execFileAsync('git', args, {
          ...packageGitOptions(repository),
          timeout: GIT_TIMEOUT_MS,
        })
        return stdout
      } catch (error) {
        throw new Error(
          redactSecrets(`git ${args.join(' ')} failed: ${oneLine(error)}`),
        )
      }
    },
  }
}

/** Reads a file's text, or `undefined` when it is missing. @example await readIfExists('/a/b.txt') */
async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The refusal for a usage mistake (exit 64). @example throw usageRefusal('--status takes at most one <short>') */
function usageRefusal(message) {
  return new CommandRefusal('E_USAGE', message, {
    fix: 'node extension/scripts/qa-build.mjs --help',
    exitCode: EXIT.USAGE,
  })
}

/** Parses the command line into one mode. @example parseQaBuildArguments(['--status', '0123abcd']) // => { mode: 'status', short: '0123abcd' } */
export function parseQaBuildArguments(argv) {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        status: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }))
  } catch (error) {
    throw usageRefusal(oneLine(error))
  }
  if (values.help) return { mode: 'help' }
  if (values.status) {
    if (positionals.length > 1)
      throw usageRefusal('--status takes at most one <short>')
    const short = positionals[0]
    if (short !== undefined && !/^[0-9a-f]{8}$/.test(short))
      throw usageRefusal('<short> is the first 8 hex characters of a commit')
    return { mode: 'status', short }
  }
  if (positionals.length > 0)
    throw usageRefusal(`unexpected argument ${positionals[0]}`)
  return { mode: 'build' }
}

/**
 * Builds the QA VSIX of HEAD and writes its receipt (the default mode).
 *
 * Why: a native trial needs a VSIX that provably comes from one clean commit, with the SHA-256 the trial records.
 * Called by {@link runQaBuild}.
 *
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @returns {Promise<number>} {@link EXIT.DONE}; every failure throws a {@link CommandRefusal} (`E_DIRTY`, `E_BUILD`, `E_BUILD_DIRTY`).
 * @example
 * await buildQaVsix(productionSeams(REPOSITORY), progress) // => 0, prints "VSIX: …" and "SHA-256: …"
 */
async function buildQaVsix(seams, progress) {
  const { repository } = seams
  progress.enter('check the checkout')
  const changes = await seams.listChanges(repository)
  if (changes.length > 0)
    throw new CommandRefusal(
      'E_DIRTY',
      `the checkout has changes: ${changes
        .slice(0, DIRTY_PATHS_SHOWN)
        .map((entry) => entry.slice(3))
        .join(
          ', ',
        )}${changes.length > DIRTY_PATHS_SHOWN ? `, and ${changes.length - DIRTY_PATHS_SHOWN} more` : ''}`,
      { fix: 'commit or move the changes, then rerun' },
    )
  progress.enter('read HEAD')
  const head = (await seams.git(['rev-parse', 'HEAD'])).trim()
  const short = head.slice(0, 8)
  const qaDirectory = join(repository, 'artifacts/qa')
  const vsixPath = join(qaDirectory, `codebook-${short}.vsix`)
  const receiptPath = join(qaDirectory, `codebook-${short}.json`)

  progress.enter('remove the old receipt', { sideEffect: true })
  await mkdir(qaDirectory, { recursive: true })
  await rm(receiptPath, { force: true })

  progress.enter('build the package', { sideEffect: true })
  let built
  try {
    built = await seams.build(repository, vsixPath)
  } catch (error) {
    const stack =
      error instanceof Error && error.stack
        ? error.stack.split('\n').slice(1)
        : []
    throw new CommandRefusal('E_BUILD', oneLine(error), {
      fix: 'fix the build error above, then rerun',
      exitCode: EXIT.FAILED,
      details: stack.map((line) => redactSecrets(line)),
    })
  }
  // A build counts only when it says it came from this commit with no changes.
  if (built.build?.dirty !== false || built.build?.revision !== head) {
    await rm(vsixPath, { force: true })
    throw new CommandRefusal(
      'E_BUILD_DIRTY',
      `the build of ${short} reports dirty=${String(built.build?.dirty)} at revision ${String(built.build?.revision).slice(0, 8)}, not a clean ${short}`,
      { fix: 'commit the change, then rerun', exitCode: EXIT.FAILED },
    )
  }

  const version = (await readFile(join(repository, 'VERSION'), 'utf8')).trim()
  const receipt = {
    head,
    version,
    sha256: built.sha256,
    entries: built.entries,
    builtAt: new Date(seams.now()).toISOString(),
  }
  progress.enter('write the receipt', { sideEffect: true })
  const temporary = `${receiptPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
  await rename(temporary, receiptPath)

  seams.print(`VSIX: ${vsixPath}`)
  seams.print(`SHA-256: ${built.sha256}`)
  return EXIT.DONE
}

/**
 * Prints the receipt of a commit's QA build (`--status`); builds and writes nothing.
 *
 * Why: before installing or recording a trial, the driving agent checks which commit, version and SHA-256 the QA VSIX has.
 * Called by {@link runQaBuild}.
 *
 * @param {{ short?: string }} options - The commit's first 8 hex characters; default HEAD.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @returns {Promise<number>} {@link EXIT.DONE}, or refuses with `E_NO_BUILD` when no receipt exists.
 * @example
 * await printStatus({ short: '0123abcd' }, productionSeams(REPOSITORY)) // => 0, prints Commit, Version, VSIX, SHA-256 and Built lines
 */
async function printStatus({ short }, seams) {
  const { repository } = seams
  const wanted =
    short ?? (await seams.git(['rev-parse', 'HEAD'])).trim().slice(0, 8)
  const receiptPath = join(
    repository,
    'artifacts/qa',
    `codebook-${wanted}.json`,
  )
  const text = await readIfExists(receiptPath)
  if (text === undefined)
    throw new CommandRefusal('E_NO_BUILD', `no receipt for ${wanted}`, {
      fix: 'node extension/scripts/qa-build.mjs',
    })
  const receipt = JSON.parse(text)
  seams.print(`Commit: ${wanted} (${receipt.head})`)
  seams.print(`Version: ${receipt.version}`)
  seams.print(
    `VSIX: ${join(repository, 'artifacts/qa', `codebook-${wanted}.vsix`)}`,
  )
  seams.print(`SHA-256: ${receipt.sha256}`)
  seams.print(`Built: ${receipt.builtAt}`)
  return EXIT.DONE
}

/**
 * Runs the command for one argument list under injected effects.
 *
 * Why: tests drive the whole command with fakes; production wires {@link productionSeams}.
 * Called by {@link main} and by `qaBuild.test.mjs`.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @returns {Promise<number>} The exit code (a value of {@link EXIT}).
 * @example
 * process.exitCode = await runQaBuild([], productionSeams(REPOSITORY), progress)
 */
export async function runQaBuild(argv, seams, progress) {
  const parsed = parseQaBuildArguments(argv)
  if (parsed.mode === 'help') {
    seams.print(HELP_TEXT.trimEnd())
    return EXIT.DONE
  }
  if (parsed.mode === 'status') return printStatus(parsed, seams)
  return buildQaVsix(seams, progress)
}

/** Entry point body: wires production seams. @example process.exitCode = await runCommandLine(main) */
async function main(progress) {
  return runQaBuild(
    process.argv.slice(2),
    productionSeams(REPOSITORY),
    progress,
  )
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
