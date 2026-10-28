import { execFile } from 'node:child_process'

import { REPOSITORY_REVISION_BOUND_MS } from '../constants'

/** The revision a history records for a repository whose Git could not answer: nothing is claimed about its state. */
const UNKNOWN_REVISION = { revision: 'unknown', dirty: true } as const

/** Runs one Git command in the repository and resolves its output, or `undefined` when it failed or ran past its bound. Optional locks stay off (`GIT_OPTIONAL_LOCKS=0`), so a status never takes the index lock a concurrent commit needs. */
function git(
  cwd: string,
  command: string,
  args: string[],
  timeout: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ['--no-optional-locks', ...args],
      {
        cwd,
        timeout,
        maxBuffer: 1_048_576,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    )
  })
}

/**
 * Reads the opened repository's current commit and whether tracked files differ from it, for the header of a server history.
 * Called by {@link StudyService} when it starts a node-server run's history, inside the history's start bound.
 * @param workspace - The repository root.
 * @param options - `boundMs` is the read's own bound (default {@link REPOSITORY_REVISION_BOUND_MS}), `command` the Git executable (a test names its own).
 * @returns The commit hash and `dirty` (tracked changes); `{ revision: 'unknown', dirty: true }` when Git did not answer within its own bound.
 * @example await readRepositoryRevision('/repo') // => { revision: '4f68953…', dirty: false }
 */
export async function readRepositoryRevision(
  workspace: string,
  options: { boundMs?: number; command?: string } = {},
): Promise<{ revision: string; dirty: boolean }> {
  const boundMs = options.boundMs ?? REPOSITORY_REVISION_BOUND_MS
  const command = options.command ?? 'git'
  const [head, status] = await Promise.all([
    git(workspace, command, ['rev-parse', 'HEAD'], boundMs),
    git(
      workspace,
      command,
      ['status', '--porcelain', '--untracked-files=no'],
      boundMs,
    ),
  ])
  const revision = head?.trim()
  if (!revision || status === undefined) return { ...UNKNOWN_REVISION }
  return { revision, dirty: status.trim().length > 0 }
}
