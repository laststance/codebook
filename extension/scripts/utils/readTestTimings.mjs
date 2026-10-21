import { readFile } from 'node:fs/promises'

/** The command that writes the timings file again; named in every refusal so the reader has a way out. */
const RECORD_COMMAND = 'pnpm --dir extension test:shard --record'

/** Tells whether a value is a duration the planner can add up: a finite number of 0 or more. @example isDuration(12) // => true; isDuration('12') // => false */
function isDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Tells whether one file's entry has the form `buildTestTimings` writes: an object with a duration `totalMs` and, when present, `tests` as an object of durations by test name. @example isTimingEntry({ totalMs: 12 }) // => true; isTimingEntry({ totalMs: 'x' }) // => false */
function isTimingEntry(entry) {
  if (typeof entry !== 'object' || entry === null || !isDuration(entry.totalMs))
    return false
  if (entry.tests === undefined) return true
  return (
    typeof entry.tests === 'object' &&
    entry.tests !== null &&
    !Array.isArray(entry.tests) &&
    Object.values(entry.tests).every(isDuration)
  )
}

/**
 * Reads the timings file that balances the shard plan, and refuses a missing or damaged one with the file's name and the command that writes it again; called by `scripts/test-shard.mjs` before every planned run.
 * @param timingsPath - Absolute path of `test-timings.json`.
 * @returns The parsed `{ files: { [file]: { totalMs, tests? } } }`.
 * @throws When the file cannot be read, is not JSON, has no `files` object, or has an entry that is no `{ totalMs, tests? }` of finite durations of 0 or more (the entry's file name is quoted); the message names the file and `test:shard --record`.
 * @example
 * await readTestTimings('/repo/extension/test-timings.json') // => { files: { 'a.test.js': { totalMs: 12 } } }
 */
export async function readTestTimings(timingsPath) {
  const refuse = (reason) =>
    new Error(
      `${timingsPath} ${reason}. Build, then record it again with \`${RECORD_COMMAND}\`.`,
    )
  const text = await readFile(timingsPath, 'utf8').catch((error) => {
    throw refuse(`cannot be read (${error.code ?? error.message})`)
  })
  let timings
  try {
    timings = JSON.parse(text)
  } catch {
    throw refuse('is not valid JSON')
  }
  const files = timings?.files
  if (typeof files !== 'object' || files === null || Array.isArray(files))
    throw refuse('has no "files" object')
  for (const [file, entry] of Object.entries(files))
    if (!isTimingEntry(entry))
      throw refuse(
        `has an entry for ${JSON.stringify(file.slice(0, 80))} that is not { totalMs, tests? } with finite durations of 0 or more`,
      )
  return timings
}
