#!/usr/bin/env node
// Writes the five places that hold the release version in one run, and checks that they agree (Cycle 0068, Implementation 1).
import { randomBytes } from 'node:crypto'
import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  CommandRefusal,
  EXIT,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** The repository root, resolved from this file's own path (`extension/scripts/bump-version.mjs`). */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Repository-relative paths of the five places, as printed. */
const VERSION_PATH = 'VERSION'
const MANIFEST_PATH = 'extension/package.json'
const CONSTANTS_PATH = 'extension/src/constants.ts'
const PACKAGE_TEST_PATH = 'extension/scripts/tests/package.test.mjs'
const CHANGELOG_PATH = 'CHANGELOG.md'

/** A version with four parts, no leading zeros (`0.2.69.0`). */
const FOUR_PART_VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){3}$/
/** A version with three parts, as the extension manifest holds it (`0.2.69`). */
const THREE_PART_VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}$/

/** Matches a CHANGELOG version heading and captures what is inside the brackets. */
const CHANGELOG_HEADING_PATTERN = /^## \[([^\]]+)\]/

/**
 * Where each three-part place keeps its version: a pattern with exactly one capture group, and the source text that replaces the captured value.
 * The manifest pattern anchors on the two-space indent so a nested `"version"` key never matches.
 */
const THREE_PART_PLACES = [
  {
    path: MANIFEST_PATH,
    description: 'top-level "version" line',
    pattern: /^( {2}"version": ")([^"]*)(")/gm,
  },
  {
    path: CONSTANTS_PATH,
    description: 'EXTENSION_VERSION constant',
    pattern: /(export const EXTENSION_VERSION = ')([^']*)(')/g,
  },
  {
    path: PACKAGE_TEST_PATH,
    description: 'checked.extension.version assertion',
    pattern: /(assert\.equal\(checked\.extension\.version, ')([^']*)('\))/g,
  },
]

/** The `--help` text: usage, prerequisites, example, exit codes and error codes (Implementation 0). */
export const HELP_TEXT = `Usage:
  node extension/scripts/bump-version.mjs <MAJOR.MINOR.PATCH.MICRO>
  node extension/scripts/bump-version.mjs --check
  node extension/scripts/bump-version.mjs --help

Writes the release version into the five places that hold it, or checks that they agree:
  VERSION                                      all four parts
  extension/package.json                       "version", first three parts
  extension/src/constants.ts                   EXTENSION_VERSION, first three parts
  extension/scripts/tests/package.test.mjs     checked.extension.version, first three parts
  CHANGELOG.md                                 a "## [<version>] - <date> (development candidate)" heading

A version equal to the current VERSION propagates it: only the places that lag are written.
That is the /ship order: Step 12 writes VERSION and the CHANGELOG heading, then this command writes the rest.
--check exits 0 when the three-part places equal the first three parts of VERSION and the first
CHANGELOG heading other than "## [Unreleased]" equals VERSION.

Prerequisites:
  The Node and pnpm versions the repository pins (.node-version, extension/package.json). No network,
  no git and no signed-in account are needed. The repository is found from this script's own path.

Example:
  node extension/scripts/bump-version.mjs 0.2.69.0

Exit codes:
  0   done, "already at <version>", or --check found the five places in agreement
  1   refused before anything was written, or --check found a disagreement
  2   failed before anything was written (including a write that changed no file)
  3   some files were written and a later write failed; rerun the same command
  4   unexpected failure after a write started; check what changed before retrying
  64  usage error

Error codes:
  E_USAGE            wrong or missing arguments (exit 64)
  E_VERSION_FORMAT   the argument is not MAJOR.MINOR.PATCH.MICRO without leading zeros
  E_VERSION_LOWER    the version is lower than the current VERSION
  E_PATTERN          a place is missing or does not match its pattern exactly once
  E_PLACE_MISMATCH   a place holds a version that is neither the current VERSION nor the target (or is beyond the target)
  E_CHANGELOG        the target version heading is doubled, buried below another version, or sits beside "## [Unreleased]"
  E_VERSION_MISMATCH --check found places that disagree
  E_WRITE            a file could not be written (exit 3 if some files changed, 2 if none did)
  E_INTERNAL         unexpected exception (exit 2 before any write, 4 after one)`

/**
 * Splits a version string into its integer parts.
 *
 * Why: versions compare as integers left to right (`0.2.100.0` is greater than `0.2.99.0`), never as text.
 * Called by {@link compareVersionParts} users inside this file only.
 *
 * @param {string} version - A version such as `0.2.68` or `0.2.68.0`.
 * @returns {number[]} The parts as integers.
 * @example parseVersionParts('0.2.100.0') // => [0, 2, 100, 0]
 */
function parseVersionParts(version) {
  return version.split('.').map((part) => Number(part))
}

/**
 * Compares two versions part by part, a missing part counting as zero.
 *
 * @param {string} left - First version.
 * @param {string} right - Second version.
 * @returns {number} A negative number when `left` is lower, zero when equal, a positive number when greater.
 * @example compareVersions('0.2.100.0', '0.2.99.0') // => 1
 */
export function compareVersions(left, right) {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Takes the first three parts of a four-part version.
 * @param {string} version - Such as `0.2.69.0`.
 * @returns {string} Such as `0.2.69`.
 * @example firstThreeParts('0.2.69.1') // => '0.2.69'
 */
function firstThreeParts(version) {
  return version.split('.').slice(0, 3).join('.')
}

/**
 * Formats a date as `YYYY-MM-DD` in the local time zone.
 * @param {Date} date - The date to format.
 * @returns {string} The local calendar date.
 * @example formatLocalDate(new Date(2026, 9, 31)) // => '2026-10-31'
 */
function formatLocalDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Writes a file through a temporary file in the same folder and a rename, so a reader never sees half a file.
 *
 * Why: the bump writes five files in a fixed order and a crash must leave each one whole; on Windows the rename fails while another program holds the file open, which `E_WRITE` reports.
 * Default of the `writeFileAtomic` seam in {@link runBump}; tests inject a failing one.
 *
 * @param {string} absolutePath - File to replace.
 * @param {string} content - New contents.
 * @example await writeFileAtomically('/repo/VERSION', '0.2.69.0\n')
 */
export async function writeFileAtomically(absolutePath, content) {
  const temporaryPath = `${absolutePath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  const { mode } = await stat(absolutePath)
  await writeFile(temporaryPath, content, 'utf8')
  // Keep the original permission bits (the temporary file gets the default ones).
  await chmod(temporaryPath, mode)
  await rename(temporaryPath, absolutePath)
}

/**
 * Reads one three-part place and finds its single version value.
 *
 * @param {string} path - Repository-relative path, for messages.
 * @param {string} text - File contents.
 * @param {{ description: string, pattern: RegExp }} place - Where the value lives.
 * @returns {string} The version text found.
 * @throws {CommandRefusal} `E_PATTERN` unless the pattern matches exactly once.
 */
function findThreePartValue(path, text, place) {
  const matches = [...text.matchAll(place.pattern)]
  if (matches.length !== 1) {
    throw new CommandRefusal(
      'E_PATTERN',
      `${path}: expected exactly one ${place.description}, found ${matches.length}`,
      { fix: `repair ${path} so the ${place.description} appears once` },
    )
  }
  return matches[0][2]
}

/**
 * Lists the CHANGELOG's `## [` headings with their line index and bracketed text.
 * @param {string[]} lines - CHANGELOG lines.
 * @returns {{ index: number, version: string }[]} Headings in file order.
 */
function listChangelogHeadings(lines) {
  const headings = []
  for (const [index, line] of lines.entries()) {
    const match = CHANGELOG_HEADING_PATTERN.exec(line)
    if (match) headings.push({ index, version: match[1] })
  }
  return headings
}

/**
 * Reads the five places from a repository folder.
 *
 * Why: both the bump and `--check` start from the same reading, so they judge the same facts.
 * Called by {@link runBump}.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<{ versionText: string, current: string, threePart: { path: string, text: string, value: string, place: object }[], changelogText: string, headings: { index: number, version: string }[] }>} What was read.
 * @throws {CommandRefusal} `E_PATTERN` when a place does not match its pattern exactly once.
 */
async function readPlaces(root) {
  const versionText = await readFile(join(root, VERSION_PATH), 'utf8')
  const current = versionText.trim()
  if (!FOUR_PART_VERSION_PATTERN.test(current)) {
    throw new CommandRefusal(
      'E_PATTERN',
      `${VERSION_PATH}: expected one MAJOR.MINOR.PATCH.MICRO version, found "${current}"`,
      { fix: `repair ${VERSION_PATH} so it holds one four-part version` },
    )
  }
  const threePart = []
  for (const place of THREE_PART_PLACES) {
    const text = await readFile(join(root, place.path), 'utf8')
    threePart.push({
      path: place.path,
      text,
      value: findThreePartValue(place.path, text, place),
      place,
    })
  }
  const changelogText = await readFile(join(root, CHANGELOG_PATH), 'utf8')
  const headings = listChangelogHeadings(changelogText.split('\n'))
  return { versionText, current, threePart, changelogText, headings }
}

/**
 * Finds the first CHANGELOG heading other than `## [Unreleased]`.
 * @param {{ index: number, version: string }[]} headings - From {@link listChangelogHeadings}.
 * @returns {{ index: number, version: string } | undefined} The heading, or `undefined` when none exists.
 */
function findFirstVersionHeading(headings) {
  return headings.find((heading) => heading.version !== 'Unreleased')
}

/**
 * Checks that the five places agree, for `--check`.
 *
 * Why: a partial bump must fail CI (`test:package`) and the release commit; a feature branch's `## [Unreleased]` section must not.
 * Called by {@link runBump} for `--check`.
 *
 * @param {string} root - Repository root.
 * @param {(line: string) => void} print - Where the success line goes.
 * @returns {Promise<number>} `EXIT.DONE`.
 * @throws {CommandRefusal} `E_VERSION_MISMATCH` (exit 1) naming each disagreeing place and its value; `E_PATTERN` when a place cannot be read.
 */
async function checkAgreement(root, print) {
  const places = await readPlaces(root)
  const expectedThreePart = firstThreeParts(places.current)
  const disagreements = []
  for (const entry of places.threePart) {
    if (entry.value !== expectedThreePart) {
      disagreements.push(
        `${entry.path}: ${entry.value} (expected ${expectedThreePart})`,
      )
    }
  }
  const heading = findFirstVersionHeading(places.headings)
  if (heading?.version !== places.current) {
    disagreements.push(
      `${CHANGELOG_PATH}: first version heading is ${heading ? heading.version : 'missing'} (expected ${places.current})`,
    )
  }
  if (disagreements.length > 0) {
    throw new CommandRefusal(
      'E_VERSION_MISMATCH',
      `${disagreements.length} place${disagreements.length === 1 ? ' disagrees' : 's disagree'} with ${VERSION_PATH} ${places.current}`,
      {
        details: disagreements,
        fix: `node extension/scripts/bump-version.mjs ${places.current}`,
      },
    )
  }
  print(`all five places agree at ${places.current}`)
  return EXIT.DONE
}

/**
 * Decides what the CHANGELOG needs for the target version.
 *
 * Why: `/ship` Step 12 may already have written the heading (never doubled); a top `## [Unreleased]` is renamed; a buried or doubled heading would make `--check` fail, so it is refused before anything is written.
 *
 * @param {string} text - CHANGELOG contents.
 * @param {{ index: number, version: string }[]} headings - Its `## [` headings.
 * @param {string} target - Target four-part version.
 * @param {string} current - Current `VERSION`.
 * @param {string} date - Local date for a new heading.
 * @returns {{ oldValue: string, newValue: string, text: string } | undefined} The change, or `undefined` when the heading is already right.
 * @throws {CommandRefusal} `E_CHANGELOG` or `E_PLACE_MISMATCH` as described in {@link HELP_TEXT}.
 */
function planChangelog(text, headings, target, current, date) {
  const lines = text.split('\n')
  const targetHeadings = headings.filter(
    (heading) => heading.version === target,
  )
  const firstVersionHeading = findFirstVersionHeading(headings)
  const topHeading = headings[0]
  const topIsUnreleased = topHeading?.version === 'Unreleased'
  if (targetHeadings.length > 1) {
    throw new CommandRefusal(
      'E_CHANGELOG',
      `${CHANGELOG_PATH}: the heading "## [${target}]" appears ${targetHeadings.length} times`,
      { fix: `remove the duplicate "## [${target}]" heading` },
    )
  }
  if (targetHeadings.length === 1) {
    if (firstVersionHeading?.index !== targetHeadings[0].index) {
      throw new CommandRefusal(
        'E_CHANGELOG',
        `${CHANGELOG_PATH}: the heading "## [${target}]" sits below "## [${firstVersionHeading?.version}]"`,
        { fix: `move "## [${target}]" above the older version heading` },
      )
    }
    if (topIsUnreleased) {
      throw new CommandRefusal(
        'E_CHANGELOG',
        `${CHANGELOG_PATH}: "## [Unreleased]" sits above the existing "## [${target}]" heading`,
        { fix: 'merge the Unreleased entries into the version heading' },
      )
    }
    return undefined
  }
  // No heading for the target yet: the newest existing version heading must be the current VERSION (or lag it).
  const existing = firstVersionHeading?.version
  const isCurrent = existing === current
  const isLagging =
    existing !== undefined &&
    FOUR_PART_VERSION_PATTERN.test(existing) &&
    compareVersions(target, current) === 0 &&
    compareVersions(existing, target) < 0
  if (!isCurrent && !isLagging) {
    throw new CommandRefusal(
      'E_PLACE_MISMATCH',
      `${CHANGELOG_PATH}: first version heading is ${existing ?? 'missing'}, neither ${current} nor ${target}`,
      { fix: 'repair the CHANGELOG headings by hand, then rerun' },
    )
  }
  const newHeading = `## [${target}] - ${date} (development candidate)`
  if (topIsUnreleased) {
    // Rename the Unreleased heading in place, as `gstack-version-bump write` does.
    lines[topHeading.index] = newHeading
    return { oldValue: 'Unreleased', newValue: target, text: lines.join('\n') }
  }
  if (!topHeading) {
    throw new CommandRefusal(
      'E_PATTERN',
      `${CHANGELOG_PATH}: expected at least one "## [" heading, found 0`,
      { fix: 'restore the CHANGELOG headings' },
    )
  }
  lines.splice(topHeading.index, 0, newHeading, '')
  return {
    oldValue: existing ?? '',
    newValue: target,
    text: lines.join('\n'),
  }
}

/**
 * Computes every file change for the target version, refusing before anything is written when a place cannot take it.
 *
 * @param {Awaited<ReturnType<typeof readPlaces>>} places - From {@link readPlaces}.
 * @param {string} target - Target four-part version.
 * @param {string} date - Local date for a new CHANGELOG heading.
 * @returns {{ path: string, oldValue: string, newValue: string, content: string }[]} Changes in write order, `VERSION` last; empty when everything is at the target.
 * @throws {CommandRefusal} `E_VERSION_LOWER`, `E_PLACE_MISMATCH`, `E_CHANGELOG`, `E_PATTERN`.
 */
function planChanges(places, target, date) {
  const { current } = places
  const relation = compareVersions(target, current)
  if (relation < 0) {
    throw new CommandRefusal(
      'E_VERSION_LOWER',
      `${target} is lower than the current ${VERSION_PATH} ${current}`,
      { fix: `use a version of at least ${current}` },
    )
  }
  const targetThreePart = firstThreeParts(target)
  const currentThreePart = firstThreeParts(current)
  const changes = []
  const mismatches = []
  for (const entry of places.threePart) {
    const comparison = THREE_PART_VERSION_PATTERN.test(entry.value)
      ? compareVersions(entry.value, targetThreePart)
      : Number.NaN
    // An equal target propagates: any lower place lags and is written. A greater target accepts only the current or the target value.
    const accepted =
      relation === 0
        ? comparison <= 0
        : entry.value === currentThreePart || comparison === 0
    if (!accepted) {
      mismatches.push(
        `${entry.path}: ${entry.value} (expected ${currentThreePart} or ${targetThreePart})`,
      )
      continue
    }
    if (comparison !== 0) {
      const content = entry.text.replace(
        entry.place.pattern,
        (_match, before, _old, after) => `${before}${targetThreePart}${after}`,
      )
      changes.push({
        path: entry.path,
        oldValue: entry.value,
        newValue: targetThreePart,
        content,
      })
    }
  }
  const changelogChange = planChangelog(
    places.changelogText,
    places.headings,
    target,
    current,
    date,
  )
  if (mismatches.length > 0) {
    throw new CommandRefusal(
      'E_PLACE_MISMATCH',
      `${mismatches.length} place${mismatches.length === 1 ? ' holds a version' : 's hold a version'} that is neither ${current} nor ${target}`,
      {
        details: mismatches,
        fix: 'repair these places by hand, then rerun',
      },
    )
  }
  if (changelogChange) {
    changes.push({
      path: CHANGELOG_PATH,
      oldValue: changelogChange.oldValue,
      newValue: changelogChange.newValue,
      content: changelogChange.text,
    })
  }
  if (relation > 0) {
    // VERSION last: a rerun after an interrupted write sees the old VERSION and finishes the rest.
    const trailingNewline = places.versionText.endsWith('\n') ? '\n' : ''
    changes.push({
      path: VERSION_PATH,
      oldValue: current,
      newValue: target,
      content: `${target}${trailingNewline}`,
    })
  }
  return changes
}

/**
 * Runs the command: bump the five places to a version, or check that they agree.
 *
 * Why: the release commit used to be edited by hand in five places, and Cycle 0067 shipped with one lagging; this makes the bump one reviewed step and its check a CI test.
 * Called by the entry point below through {@link runCommandLine}, and by `bumpVersion.test.mjs` with a temporary root, a fixed clock and a recording `print`.
 *
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker for `E_INTERNAL`.
 * @param {{ argv: string[], root?: string, now?: () => Date, print?: (line: string) => void, writeFileAtomic?: (absolutePath: string, content: string) => Promise<void> }} options - `argv`: arguments after the script name; `root`: repository root (default: derived from this file); `now`: clock; `print`: stdout line sink; `writeFileAtomic`: file writer seam.
 * @returns {Promise<number>} The exit code.
 * @throws {CommandRefusal} A refusal as listed in {@link HELP_TEXT}.
 * @example
 * ```js
 * process.exitCode = await runCommandLine((progress) => runBump(progress, { argv: ['0.2.69.0'] }))
 * ```
 */
export async function runBump(
  progress,
  {
    argv,
    root = REPOSITORY_ROOT,
    now = () => new Date(),
    print = (line) => console.log(line),
    writeFileAtomic = writeFileAtomically,
  },
) {
  progress.enter('read arguments')
  const usageFix = 'node extension/scripts/bump-version.mjs --help'
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        check: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      allowPositionals: true,
    })
  } catch (error) {
    throw new CommandRefusal('E_USAGE', error.message, {
      fix: usageFix,
      exitCode: EXIT.USAGE,
    })
  }
  if (parsed.values.help) {
    print(HELP_TEXT)
    return EXIT.DONE
  }
  const { positionals } = parsed
  const check = parsed.values.check === true
  if (check ? positionals.length > 0 : positionals.length !== 1) {
    throw new CommandRefusal(
      'E_USAGE',
      check
        ? '--check takes no version'
        : 'expected one version argument, or --check',
      { fix: usageFix, exitCode: EXIT.USAGE },
    )
  }
  if (check) {
    progress.enter('check the five places')
    return checkAgreement(root, print)
  }

  const [target] = positionals
  if (!FOUR_PART_VERSION_PATTERN.test(target)) {
    throw new CommandRefusal(
      'E_VERSION_FORMAT',
      `"${target}" is not MAJOR.MINOR.PATCH.MICRO without leading zeros`,
      { fix: 'node extension/scripts/bump-version.mjs 0.2.69.0' },
    )
  }
  progress.enter('read the five places')
  const places = await readPlaces(root)
  const changes = planChanges(places, target, formatLocalDate(now()))
  if (changes.length === 0) {
    print(`already at ${target}`)
    return EXIT.DONE
  }

  // Everything is computed and valid; from here on files change.
  const written = []
  for (const change of changes) {
    progress.enter(`write ${change.path}`, { sideEffect: true })
    try {
      await writeFileAtomic(join(root, change.path), change.content)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new CommandRefusal(
        'E_WRITE',
        `could not write ${change.path} (${reason}); ${written.length} file${written.length === 1 ? '' : 's'} changed`,
        {
          details: written.map((path) => `changed: ${path}`),
          fix: `rerun the same command: node extension/scripts/bump-version.mjs ${target}`,
          exitCode: written.length > 0 ? EXIT.FOLLOW_UP : EXIT.FAILED,
        },
      )
    }
    written.push(change.path)
    print(`${change.path}: ${change.oldValue} -> ${change.newValue}`)
  }
  return EXIT.DONE
}

if (isRunAsScript(import.meta.url)) {
  process.exitCode = await runCommandLine((progress) =>
    runBump(progress, { argv: process.argv.slice(2) }),
  )
}
