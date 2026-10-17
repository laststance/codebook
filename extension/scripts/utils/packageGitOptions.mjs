import {
  PACKAGE_COMMAND_OUTPUT_BYTES,
  PACKAGE_COMMAND_TIMEOUT_MS,
} from './packageConstants.mjs'

/**
 * Gives the options every Git call of the package build runs with, so that the build's identity and the list of a checkout's changes are read in the same way; called by {@link readBuildIdentity} and {@link listCheckoutChanges}.
 * Ambient Git overrides (`GIT_DIR`, `GIT_INDEX_FILE`, …) are left out of the environment: a recorded revision must name the stored tree of this repository.
 * @param repository - The repository's root, which the Git call runs in.
 * @returns The options of `execFileSync`: the working directory, the environment without `GIT_*`, text output, and the package command's time and output limits.
 * @example
 * execFileSync('git', ['rev-parse', 'HEAD'], packageGitOptions('/work/codebook')) // => '074d9b0…\n'
 */
export function packageGitOptions(repository) {
  return {
    cwd: repository,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    ),
    encoding: 'utf8',
    timeout: PACKAGE_COMMAND_TIMEOUT_MS,
    maxBuffer: PACKAGE_COMMAND_OUTPUT_BYTES,
  }
}
