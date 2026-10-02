// Writes the compiler's output without type checking, for jobs that only run the compiled tests.
//
//   node scripts/build-fast.mjs           replace dist with the unchecked emit
//   node scripts/build-fast.mjs --check   compare the unchecked emit with an existing `tsc` build of dist
//
// Type errors are reported by `pnpm typecheck` and `pnpm build`, not here.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitWithoutTypeCheck } from './utils/emitWithoutTypeCheck.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const dist = join(extension, 'dist')
// Written into dist by scripts/build-metadata.mjs after either build; it is not compiler output.
const METADATA_FILE = 'build.json'

/** Lists every file below a directory as a path relative to it, so compiled outputs of deleted sources are noticed. @example await listFiles('/repository/extension/dist') // => ['build.json', 'constants.js', …] */
async function listFiles(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .toSorted()
}

/** Compares one emitted file with the compiler's file of the same path. @example await differenceOf('constants.js', '"use strict";…') // => undefined when equal */
async function differenceOf(path, content) {
  const built = await readFile(join(dist, path), 'utf8').catch(() => undefined)
  if (built === undefined) return `missing in dist: ${path}`
  return built === content ? undefined : `differs: ${path}`
}

/** Names every difference between the unchecked emit and the compiler's dist; an empty list means the test shards run the same bytes the compiler writes. @example await compareWithDist(outputs) // => [] */
async function compareWithDist(outputs) {
  const compared = await Promise.all(
    [...outputs].map(([path, content]) => differenceOf(path, content)),
  )
  // A file only the compiler wrote would be a source this emit skipped, or an output of a deleted source.
  const leftovers = (await listFiles(dist))
    .filter((path) => !outputs.has(path) && path !== METADATA_FILE)
    .map((path) => `only in dist: ${path}`)
  return [...compared.filter(Boolean), ...leftovers]
}

const outputs = await emitWithoutTypeCheck(extension)
if (process.argv.includes('--check')) {
  const differences = await compareWithDist(outputs)
  for (const difference of differences) console.error(difference)
  console.log(
    `Unchecked emit compared with dist: ${outputs.size} files, ${differences.length} differences.`,
  )
  if (differences.length > 0) process.exitCode = 1
} else {
  // Start empty: the compiler leaves outputs of deleted sources behind, and a stale compiled test would still run.
  await rm(dist, { recursive: true, force: true })
  for (const [path, content] of outputs) {
    await mkdir(dirname(join(dist, path)), { recursive: true })
    await writeFile(join(dist, path), content)
  }
  console.log(`Wrote ${outputs.size} files to dist without type checking.`)
}
