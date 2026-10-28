import { execFile } from 'node:child_process'

import { REPOSITORY_GIT_TIMEOUT_MS } from '../constants'

/** The revision a history records for a repository whose Git could not answer: nothing is claimed about its state. */
const UNKNOWN_REVISION = { revision: 'unknown', dirty: true } as const

/** Runs one Git command in the repository and resolves its output, or `undefined` when it failed or ran past its bound. */
function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: REPOSITORY_GIT_TIMEOUT_MS, maxBuffer: 1_048_576 },
      (error, stdout) => resolve(error ? undefined : stdout),
    )
  })
}

/**
 * Reads the opened repository's current commit and whether tracked files differ from it, for the header of a server history.
 * Called by {@link StudyService} when it starts a node-server run's history, inside the history's start bound.
 * @param workspace - The repository root.
 * @returns The commit hash and `dirty` (tracked changes); `{ revision: 'unknown', dirty: true }` when Git did not answer.
 * @example await readRepositoryRevision('/repo') // => { revision: '4f68953…', dirty: false }
 */
export async function readRepositoryRevision(
  workspace: string,
): Promise<{ revision: string; dirty: boolean }> {
  const [head, status] = await Promise.all([
    git(workspace, ['rev-parse', 'HEAD']),
    git(workspace, ['status', '--porcelain', '--untracked-files=no']),
  ])
  const revision = head?.trim()
  if (!revision || status === undefined) return { ...UNKNOWN_REVISION }
  return { revision, dirty: status.trim().length > 0 }
}
