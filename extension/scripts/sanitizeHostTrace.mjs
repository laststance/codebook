#!/usr/bin/env node
// Re-applies the host event recorder's sanitizer to a take before a trace is committed as a fixture, and refuses
// (exit 2) when any absolute path, home folder or user name remains. Defense in depth: the recorder already
// sanitizes what it writes, but a fixture enters a public repository.

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  CommandRefusal,
  EXIT,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'

const require = createRequire(import.meta.url)
const {
  sanitizeTraceLine,
} = require('../../tools/host-event-recorder/traceFormat.js')

/** Text printed by `--help`. */
export const HELP_TEXT = `Usage: node extension/scripts/sanitizeHostTrace.mjs <take.jsonl> <out.jsonl> --repository <path> [--forbid <text>]...

Re-applies the host event recorder's sanitizer to every line of <take.jsonl> and writes <out.jsonl>.
Refuses (exit 2, nothing written) when a string value still holds an absolute path, this machine's home folder
or user name, the repository path, or a --forbid text.

Exit codes: 0 written; 2 refused (E_TRACE_NOT_CLEAN, E_TRACE_LINE) ; 64 usage.`

/** The text a path may follow: the string start, white space, a quote, a bracket, `=`, `:`, `,` or `;`. */
const AFTER = String.raw`(?:^|[\s"'(=:,;\[{<])`

/**
 * A string that starts at, or contains after a separator, an absolute path or a file URL: POSIX, Windows drive,
 * rooted backslash or UNC, home (`~` or `~user`).
 */
const ABSOLUTE_PATH = new RegExp(
  String.raw`${AFTER}(?:\/[^\s/]+\/|\/[^\s/]+$|[A-Za-z]:[\\/]|~[^\s/\\]*[\\/]|\\{1,2}[^\s\\]+\\)|file:\/\/`,
)

/** The machine user of the recorded takes; a trace never names it. */
const RECORDING_MACHINE_USER = 'lume'

/**
 * Collects every string value of a parsed JSON value, with its key path for the message.
 *
 * @param {unknown} value - A parsed JSON value.
 * @param {string} where - The key path so far.
 * @returns {{ where: string, text: string }[]} Every string leaf.
 */
function stringLeaves(value, where) {
  if (typeof value === 'string') return [{ where, text: value }]
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      stringLeaves(item, `${where}[${index}]`),
    )
  if (value && typeof value === 'object')
    // A key is text too: a path used as a key must be found (its text is checked, its name is not repeated).
    return Object.entries(value).flatMap(([key, item]) => [
      { where: `${where} (a key)`, text: key },
      ...stringLeaves(item, `${where}.${key}`),
    ])
  return []
}

/**
 * Names what a string still reveals, or nothing.
 *
 * @param {string} text - A string value of a trace line.
 * @param {RegExp[]} forbidden - Whole-word, case-insensitive matchers of texts that must not appear (home folder, user names, repository path, extras), from {@link forbiddenMatchers}.
 * @returns {string | undefined} A short reason, or `undefined` for a clean string.
 */
function leakOf(text, forbidden) {
  // A percent-encoded path (`%2FUsers%2F...`) is checked in its decoded form too, up to twice for double encoding.
  const forms = [text]
  for (let pass = 0; pass < 2; pass++) {
    try {
      const decoded = decodeURIComponent(forms.at(-1))
      if (decoded === forms.at(-1)) break
      forms.push(decoded)
    } catch {
      break
    }
  }
  if (forms.some((form) => ABSOLUTE_PATH.test(form))) return 'an absolute path'
  return forms.some((form) => forbidden.some((matcher) => matcher.test(form)))
    ? 'a home folder, user name or repository path'
    : undefined
}

/**
 * Builds the matchers of the forbidden texts: each must appear as a whole word (so a two-letter user name is still
 * found, and `lume` is not found inside `volume`), in any letter case.
 *
 * @param {string[]} items - Forbidden texts; one without a letter or digit (a bare `/` home folder) is ignored.
 * @returns {RegExp[]} One matcher per text.
 * @example forbiddenMatchers(['ab'])[0].test('notes of AB') // => true
 */
function forbiddenMatchers(items) {
  return items
    .filter((item) => /[A-Za-z0-9]/.test(item))
    .map(
      (item) =>
        new RegExp(
          String.raw`(?<![A-Za-z0-9_])${item.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(?![A-Za-z0-9_])`,
          'i',
        ),
    )
}

/**
 * Sanitizes a whole take and checks the result.
 *
 * Called by {@link main}; tests call it with fixed forbidden texts.
 *
 * @param {string} text - The take's JSONL text.
 * @param {{ repository: string, forbid: string[] }} options - The repository folder (an absolute path) and extra forbidden texts.
 * @returns {string} The sanitized JSONL text.
 * @throws {CommandRefusal} `E_TRACE_LINE` for a line that is not JSON, `E_TRACE_NOT_CLEAN` naming the first line that still reveals a path or name.
 * @example sanitizeTake(raw, { repository: '/repo', forbid: [] })
 */
export function sanitizeTake(text, { repository, forbid }) {
  const context = {
    workspaceFolders: [
      { scheme: 'file', path: repository.replaceAll('\\', '/') },
    ],
  }
  // The repository is forbidden in both spellings; the recording machine's user always is.
  const forbidden = forbiddenMatchers([
    ...forbid,
    repository,
    repository.replaceAll('\\', '/'),
    RECORDING_MACHINE_USER,
  ])
  const output = []
  text.split('\n').forEach((raw, index) => {
    if (!raw.trim()) return
    let line
    try {
      line = JSON.parse(raw)
    } catch {
      throw new CommandRefusal(
        'E_TRACE_LINE',
        `line ${index + 1} is not JSON`,
        {
          exitCode: EXIT.FAILED,
          fix: 'pass a take written by the host event recorder',
        },
      )
    }
    const clean = sanitizeTraceLine(line, context)
    for (const leaf of stringLeaves(clean, '$')) {
      const reason = leakOf(leaf.text, forbidden)
      if (reason)
        throw new CommandRefusal(
          'E_TRACE_NOT_CLEAN',
          `line ${index + 1} (${leaf.where}) still holds ${reason}`,
          {
            exitCode: EXIT.FAILED,
            fix: 'remove or rename what the line reveals in the take, then rerun',
          },
        )
    }
    output.push(JSON.stringify(clean))
  })
  return `${output.join('\n')}\n`
}

/**
 * The command's entry: reads the take, sanitizes it, writes the output.
 *
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @param {string[]} [argv] - Arguments after the script name.
 * @returns {Promise<number>} The exit code.
 */
export async function main(progress, argv = process.argv.slice(2)) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repository: { type: 'string' },
        forbid: { type: 'string', multiple: true },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    throw new CommandRefusal('E_USAGE', error.message, {
      exitCode: EXIT.USAGE,
      fix: 'node extension/scripts/sanitizeHostTrace.mjs --help',
    })
  }
  if (parsed.values.help) {
    console.log(HELP_TEXT)
    return EXIT.DONE
  }
  const [input, output, ...extra] = parsed.positionals
  if (!input || !output || extra.length || !parsed.values.repository)
    throw new CommandRefusal(
      'E_USAGE',
      'expected <take.jsonl> <out.jsonl> --repository <path>',
      {
        exitCode: EXIT.USAGE,
        fix: 'node extension/scripts/sanitizeHostTrace.mjs --help',
      },
    )
  progress.enter('sanitize')
  const sanitized = sanitizeTake(await readFile(input, 'utf8'), {
    repository: resolve(parsed.values.repository),
    forbid: [homedir(), userInfo().username, ...(parsed.values.forbid ?? [])],
  })
  progress.enter('write output', { sideEffect: true })
  await writeFile(output, sanitized)
  return EXIT.DONE
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
