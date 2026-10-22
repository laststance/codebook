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
/** The largest shard total `test-shard.mjs --shard i/total` accepts. CI uses 14; the planner makes `total` times `lanes` bins, so a total in the billions would allocate that many bins and run out of memory, and no real use gets near 1,000. */
export const MAX_SHARD_TOTAL = 1_000
/** The largest lane count `test-shard.mjs --lanes` accepts. CI uses 2 and a machine's default is its thread count, capped at this bound so that no machine is refused for an option it did not give; the planner makes `total` times `lanes` bins, and no real use gets near 1,000 lanes. */
export const MAX_LANES = 1_000
/** Number of test files a recording run executes at the same time; low enough that durations stay close to an uncontended run. */
export const TIMING_RECORD_CONCURRENCY = 4
/** How much longer than the test limit the timings recording waits for any event of its run before it ends the run as stalled: a test that does not end is failed by the runner at the limit, and that event comes first. */
export const RECORD_STALL_MARGIN_MS = 5_000
/** A `node --test` call that prints nothing for this long is hung and is ended with its output so far. The longest single product test waits for a 20 s deadline, and a job has a 10-minute limit. */
export const CALL_SILENCE_TIMEOUT_MS = 120_000
/** How long a call ended for silence may take to stop on SIGTERM before it is killed. */
export const CALL_KILL_GRACE_MS = 5_000
/** The longest delay `setTimeout` accepts; Node fires a timer set above it at once, so a silence limit above it would end every call as hung. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647
/** The shortest delay `setTimeout` keeps; Node runs a shorter one after 1 ms, so a limit under it would end every call before its runner started. */
export const MIN_TIMER_DELAY_MS = 1
/** The build that `run-pregate-tests.mjs` runs before its tests may take this long; the fast build takes seconds, and a hung one would hold the pre-gate with nothing shown. */
export const PREGATE_BUILD_TIMEOUT_MS = 300_000
/** How often a long silent step of a test (the package build in the `before` hook of `package.test.mjs`) writes a line, so the silence watch sees the test alive; it stays well under {@link CALL_SILENCE_TIMEOUT_MS}. */
export const PROGRESS_LINE_INTERVAL_MS = 30_000
/** How much of one call's output the runners keep: the end of it, which holds the report of the failing tests (Node prints the summary block before that report, so the keeper reads the summary as it arrives and repeats it after the kept end when the end does not hold it). A test that prints without end must not grow the memory of the runner that reads it; {@link createBoundedOutput} drops the rest. */
export const TEST_OUTPUT_KEEP_CHARS = 4_000_000
/** How long a line of a run's output may grow in the pre-gate runner before it is written in pieces. A test that prints without a line break must not grow the runner's memory either. */
export const TEST_LINE_FLUSH_CHARS = 100_000
/** How many failed tests a refused recording names; the rest are counted ("and 3 more"), so the refusal stays one readable line. */
export const MAX_NAMED_FAILED_TESTS = 10
