import { readFile } from 'node:fs/promises'

/** The command that writes the timings file again; named in every refusal so the reader has a way out. */
const RECORD_COMMAND = 'pnpm --dir extension test:shard --record'

/**
 * Reads the timings file that balances the shard plan, and refuses a missing or damaged one with the file's name and the command that writes it again; called by `scripts/test-shard.mjs` before every planned run.
 * @param timingsPath - Absolute path of `test-timings.json`.
 * @returns The parsed `{ files: { [file]: { totalMs, tests? } } }`.
 * @throws When the file cannot be read, is not JSON, or has no `files` object; the message names the file and `test:shard --record`.
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
  return timings
}
