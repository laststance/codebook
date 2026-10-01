/** Recorded per-file and per-test durations that balance the shard plan; a stale file costs balance only, never coverage. */
export const TEST_TIMINGS_FILE = 'test-timings.json'
/** Estimate for a test file the timings do not know yet, so a new file still gets a lane. */
export const UNKNOWN_TEST_FILE_MS = 1_000
/** A test file whose recorded tests take longer than this is run as several name-selected parts. */
export const SPLIT_TEST_FILE_MS = 8_000
/** Target duration of one part of a split test file. */
export const TEST_PART_TARGET_MS = 8_000
/** Process start and module loading of one extra `node --test` call, counted when lanes are balanced. */
export const TEST_INVOCATION_OVERHEAD_MS = 500
/** Number of test files a recording run executes at the same time; low enough that durations stay close to an uncontended run. */
export const TIMING_RECORD_CONCURRENCY = 4
