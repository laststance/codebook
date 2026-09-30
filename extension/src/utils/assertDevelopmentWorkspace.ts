import { access, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { StudyError } from '../errors'

export type DevelopmentLockIdentity = { dev: number; ino: number }

/** Rejects missing Next/default-build ownership before the configured runtime acquires a process; existing locks remain untouched. @example await assertDevelopmentWorkspace(root, signal) */
export async function assertDevelopmentWorkspace(
  root: string,
  signal: AbortSignal,
  ownedLock?: DevelopmentLockIdentity,
): Promise<void> {
  signal.throwIfAborted()
  try {
    await access(join(root, 'node_modules/next/dist/bin/next'))
  } catch {
    throw new StudyError(
      'PREREQUISITE_MISSING',
      'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
    )
  }
  for (const path of ['.next', '.next/dev', '.next/dev/lock']) {
    const identity = await lstat(join(root, path)).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    signal.throwIfAborted()
    if (path === '.next/dev/lock') {
      if (
        identity?.isFile() &&
        !identity.isSymbolicLink() &&
        ownedLock?.dev === identity.dev &&
        ownedLock.ino === identity.ino
      )
        continue
      if (identity || ownedLock)
        throw new StudyError(
          'PREREQUISITE_MISSING',
          'The selected Next development build lock is missing or belongs to another process. Stop its owner explicitly; Codebook does not reuse or remove another lock.',
        )
      continue
    }
    if (!identity) continue
    if (!identity.isDirectory() || identity.isSymbolicLink())
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'next-dev-webpack requires regular workspace-owned .next/dev directories.',
      )
  }
}
