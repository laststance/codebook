/** Recorded per-file and per-test durations that balance the shard plan; the recorded test names of a slow file also select its parts. A file or top-level test it does not know still runs exactly once. */
export const TEST_TIMINGS_FILE = 'test-timings.json'
/** Estimate for a test file the timings do not know yet, so a new file still gets a lane. */
export const UNKNOWN_TEST_FILE_MS = 1_000
/** A test file whose recorded tests take longer than this is run as several name-selected parts. */
export const SPLIT_TEST_FILE_MS = 8_000
/** Target duration of one part of a split test file. */
export const TEST_PART_TARGET_MS = 8_000
/** Process start and module loading of one extra `node --test` call, counted when lanes are balanced. */
export const TEST_INVOCATION_OVERHEAD_MS = 500
/** Process start, module loading and coverage writing of one whole test file, measured on the CI runner. */
export const TEST_FILE_OVERHEAD_MS = 400
/** Number of test files a recording run executes at the same time; low enough that durations stay close to an uncontended run. */
export const TIMING_RECORD_CONCURRENCY = 4
/** A `node --test` call that prints nothing for this long is hung and is ended with its output so far. The longest single product test waits for a 20 s deadline, and a job has a 10-minute limit. */
export const CALL_SILENCE_TIMEOUT_MS = 120_000
/** How long a call ended for silence may take to stop on SIGTERM before it is killed. */
export const CALL_KILL_GRACE_MS = 5_000
