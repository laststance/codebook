import { execFile } from 'node:child_process'
import { devNull } from 'node:os'
import { promisify } from 'node:util'

import { GIT_CONFIGURATION_IN_OPENED_FOLDER } from '../constants'

import { gitEnvironmentWithoutInherited } from './gitEnvironmentWithoutInherited'
import { gitExecutablePath } from './gitExecutablePath'

const executeFile = promisify(execFile)

/** The limits of one {@link runOpenedFolderGit} call. */
export type OpenedFolderGitLimits = {
  /** Kills Git after this many milliseconds. */
  timeoutMs: number
  /** Fails the call when Git prints more than this many bytes. */
  maxBuffer: number
  /** Ends the call when the caller gives up. */
  signal?: AbortSignal
}

/**
 * Runs one Git command in an opened folder with the invocation every opened-folder Git command of Codebook uses: Git found by its absolute path from `PATH` alone, no inherited `GIT_*` variable, no system or global configuration, and the repository's own fsmonitor hook switched off.
 *
 * Why it exists: the status discovery of Next apps below the repository root and the nested-folder check read tracked files through the same hardened invocation as {@link RepositorySourceService}, so a repository's own configuration never starts a program there.
 * Called by {@link scanNextPackages} and {@link readGitTopLevel}.
 *
 * @param folder - The opened folder, which is Git's working folder.
 * @param gitArguments - The fixed Git arguments after the hardening configuration.
 * @param limits - The timeout, output cap and cancellation.
 * @returns Git's standard output.
 * @throws What `execFile` throws: a missing Git, a non-zero exit, a timeout (`killed`) or an output past `maxBuffer` (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`).
 * @example
 * await runOpenedFolderGit('/repo', ['rev-parse', '--show-toplevel'], { timeoutMs: 5_000, maxBuffer: 65_536 }) // => '/repo\n'
 */
export async function runOpenedFolderGit(
  folder: string,
  gitArguments: readonly string[],
  limits: OpenedFolderGitLimits,
): Promise<string> {
  const gitProgram = await gitExecutablePath()
  const { stdout } = await executeFile(
    gitProgram,
    [...GIT_CONFIGURATION_IN_OPENED_FOLDER, ...gitArguments],
    {
      cwd: folder,
      maxBuffer: limits.maxBuffer,
      timeout: limits.timeoutMs,
      signal: limits.signal,
      encoding: 'utf8',
      env: {
        ...gitEnvironmentWithoutInherited(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: devNull,
      },
    },
  )
  return stdout
}

/**
 * Reads the top-level folder of the Git repository an opened folder lies in.
 *
 * Called by the status readiness to tell a workspace opened below the Git root (source authoring refuses every run there) from the repository root itself.
 *
 * @param folder - The opened folder.
 * @param limits - The timeout, output cap and cancellation.
 * @returns The top-level path Git printed, without the line break.
 * @throws What {@link runOpenedFolderGit} throws; a folder in no repository fails as Git does.
 * @example
 * await readGitTopLevel('/repo/examples/app', { timeoutMs: 5_000, maxBuffer: 65_536 }) // => '/repo'
 */
export async function readGitTopLevel(
  folder: string,
  limits: OpenedFolderGitLimits,
): Promise<string> {
  const output = await runOpenedFolderGit(
    folder,
    ['rev-parse', '--show-toplevel'],
    limits,
  )
  return output.replace(/\n$/, '')
}
