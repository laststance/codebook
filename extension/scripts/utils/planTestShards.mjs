import { testNamePattern } from './testNamePattern.mjs'
import {
  SPLIT_TEST_FILE_MS,
  TEST_FILE_OVERHEAD_MS,
  TEST_INVOCATION_OVERHEAD_MS,
  TEST_PART_TARGET_MS,
  UNKNOWN_TEST_FILE_MS,
} from './testShardConstants.mjs'

/** Puts each item on the currently lightest bin, heaviest item first, so the bins end close to equal. @example packLightestFirst([{ ms: 5 }, { ms: 3 }, { ms: 3 }], 2) // => [[{ ms: 5 }], [{ ms: 3 }, { ms: 3 }]] */
function packLightestFirst(items, binCount) {
  const bins = Array.from({ length: binCount }, () => ({ ms: 0, items: [] }))
  // Ties keep the given order, which callers sort by name, so the plan is the same on every runner.
  for (const item of items.toSorted((left, right) => right.ms - left.ms)) {
    const lightest = bins.reduce((best, bin) => (bin.ms < best.ms ? bin : best))
    lightest.items.push(item)
    lightest.ms += item.ms
  }
  return bins.map((bin) => bin.items)
}

/** Splits one slow test file into name-selected parts; the lightest part runs "every test not named elsewhere", so a test the timings do not know still runs exactly once. @example splitTestFile('a.test.js', { tests: { slow: 9000, quick: 10 } }) */
function splitTestFile(file, tests) {
  const named = Object.entries(tests)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, ms]) => ({ name, ms }))
  const total = named.reduce((sum, test) => sum + test.ms, 0)
  const parts = packLightestFirst(named, Math.ceil(total / TEST_PART_TARGET_MS))
    .filter((part) => part.length > 0)
    .map((part) => ({
      names: part.map((test) => test.name),
      ms: part.reduce((sum, test) => sum + test.ms, 0),
    }))
    .toSorted((left, right) => left.ms - right.ms)
  const [rest, ...selected] = parts
  return [
    {
      file,
      ms: rest.ms + TEST_INVOCATION_OVERHEAD_MS,
      // The complement of every other part: unknown tests of this file land here.
      skipPattern: testNamePattern(selected.flatMap((part) => part.names)),
    },
    ...selected.map((part) => ({
      file,
      ms: part.ms + TEST_INVOCATION_OVERHEAD_MS,
      namePattern: testNamePattern(part.names),
    })),
  ]
}

/** Tells whether a recorded file is slow enough, and has enough named tests, to run in parts. @example isSplit({ totalMs: 9000, tests: { a: 5000, b: 4000 } }) // => true */
function isSplit(timing) {
  return (
    timing.totalMs > SPLIT_TEST_FILE_MS &&
    Object.keys(timing.tests ?? {}).length > 1
  )
}

/** Turns one test file into the units a lane can take: the whole file, or its name-selected parts when its recorded tests are slow. @example unitsOfTestFile('a.test.js', { totalMs: 300 }) // => [{ file: 'a.test.js', ms: 700 }] */
function unitsOfTestFile(file, timing) {
  if (!timing) return [{ file, ms: UNKNOWN_TEST_FILE_MS }]
  return isSplit(timing)
    ? splitTestFile(file, timing.tests)
    : [{ file, ms: timing.totalMs + TEST_FILE_OVERHEAD_MS }]
}

/**
 * Plans which `node --test` calls each CI shard makes so that every lane takes about the same time; called by `scripts/test-shard.mjs` on every shard with the same inputs, which is why the plan must be deterministic.
 *
 * Every test file is planned exactly once. A slow file is run in parts selected by test name, and exactly one part of it runs the complement of the others.
 * @param input.files - Base names of the compiled test files, for example `service.test.js`.
 * @param input.timings - Parsed timings file: `{ files: { [file]: { totalMs, tests? } } }`.
 * @param input.shards - Number of CI jobs.
 * @param input.lanes - Number of sequences one job runs at the same time.
 * @returns One entry per shard, each a list of lanes, each a list of invocations: `{ files }` for whole files, or `{ files: [file], namePattern }` / `{ files: [file], skipPattern }` for a part.
 * @example
 * planTestShards({ files: ['a.test.js'], timings: { files: {} }, shards: 1, lanes: 1 })
 * // => [[[{ files: ['a.test.js'], ms: 1000 }]]]
 */
export function planTestShards({ files, timings, shards, lanes }) {
  const units = files
    .toSorted()
    .flatMap((file) => unitsOfTestFile(file, timings.files[file]))
  const packed = packLightestFirst(units, shards * lanes)
  return Array.from({ length: shards }, (_, shard) =>
    Array.from({ length: lanes }, (_, lane) => {
      const lanesUnits = packed[lane * shards + shard]
      const wholeFiles = lanesUnits.filter(
        (unit) => !unit.namePattern && !unit.skipPattern,
      )
      const parts = lanesUnits.filter(
        (unit) => unit.namePattern || unit.skipPattern,
      )
      return [
        // Whole files share one call; a part needs its own call because its pattern applies to every file of a call.
        ...(wholeFiles.length > 0
          ? [
              {
                files: wholeFiles.map((unit) => unit.file).toSorted(),
                ms: wholeFiles.reduce((sum, unit) => sum + unit.ms, 0),
              },
            ]
          : []),
        ...parts.map(({ file, ...part }) => ({ files: [file], ...part })),
      ]
    }),
  )
}
