export const BUILD_PACKAGES = ['extension']
export const COMPILED_DIRECTORIES = ['extension/dist']
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 2048
export const PACKAGE_MANIFEST_PATH = 'package-manifest.json'
export const PACKAGE_COMMAND_TIMEOUT_MS = 180_000
export const PACKAGE_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024
export const PACKAGE_COMMAND_EXIT_TIMEOUT_MS = 5_000
export const PACKAGE_COMMAND_EXIT_POLL_MS = 25
/** The smallest process group id the package command signals. `kill(-1)` addresses every process the user may signal and not group 1, and `kill(-0)` the caller's own group, so neither 0 nor 1 names a group that can be stopped as one. */
export const SIGNALLED_PROCESS_GROUP_ID_MIN = 2
/** The largest id a process or a process group can have: the largest value of the system's `pid_t`, a signed 32-bit integer on Linux and macOS, which is also the largest `process.kill` takes. The systems' own limits lie below it (at most 4,194,304 on Linux, 99,998 on macOS) and would have to be read per system; `ps` prints a group id it could not read as 4294967295, which is above this bound. */
export const PROCESS_ID_MAX = 2 ** 31 - 1
