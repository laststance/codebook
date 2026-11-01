import { z } from 'zod'

import { recordedOwnerSchema } from '../../utils/readRecordedOwner'
import { readWikiRegularFile } from '../../utils/readWikiRegularFile'

/**
 * The record of a saved-session lock: the owner (pid, machine, boot, process start) plus what the holder is doing.
 * The lock is a sibling file of the folder it guards (`<hash>.signin.lock`), never inside it, so deleting the folder cannot race a new owner's lock (Codex correction 1). `token` tells two holds of the same process apart, so a release removes only its own.
 */
const signInLockRecordSchema = recordedOwnerSchema.extend({
  holder: z.enum(['setup', 'run', 'removal']),
  runId: z.string().min(1).optional(),
  windowSession: z.string().min(1),
  token: z.string().min(1),
  createdAt: z.iso.datetime(),
})

/** The content of a saved-session lock file. */
export type SignInLockRecord = z.infer<typeof signInLockRecordSchema>

/** What a caller wants the folder for. */
export type SignInLockPurpose = SignInLockRecord['holder']

/** The refusal a held lock answers a purpose with. */
export type SignInLockConflict = {
  code: 'SIGN_IN_IN_PROGRESS' | 'SIGN_IN_PROFILE_IN_USE' | 'BUSY'
  /** What the holder is doing (for `BUSY` details `heldBy`); absent when the lock could not be read. */
  heldBy?: 'setup' | 'run' | 'removal'
  /** Set when the holder is a run of this window: the removal can offer Stop run and remove. */
  runInThisWindow?: string
}

/**
 * Reads a lock file without following links; called by the store to classify a lock it cannot take.
 * @param lockPath - The lock file.
 * @returns The record, or `undefined` when the file is absent, no regular file or not a saved-session lock record.
 * @example
 * await readSignInLock('/storage/sign-in-profiles/ab12.signin.lock') // => { pid: 4242, holder: 'setup', … }
 */
export async function readSignInLock(
  lockPath: string,
): Promise<SignInLockRecord | undefined> {
  const file = await readWikiRegularFile(lockPath)
  if (!file) return undefined
  try {
    const parsed = signInLockRecordSchema.safeParse(
      JSON.parse(file.bytes.toString('utf8')),
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Maps a live holder and the purpose of the one who asks to the refusal the contract names; called by the store when the lock is held and not stale.
 * - run vs setup: `SIGN_IN_IN_PROGRESS`; run vs run or removal: `BUSY` (reason profile-in-use)
 * - setup vs setup: `SIGN_IN_IN_PROGRESS`; setup vs run or removal: `SIGN_IN_PROFILE_IN_USE`
 * - removal vs setup: `SIGN_IN_IN_PROGRESS`; removal vs run or removal: `SIGN_IN_PROFILE_IN_USE`
 * - a holder whose record cannot be read: `SIGN_IN_PROFILE_IN_USE` (nothing is proven, nothing is taken)
 * @param holder - The lock's record, or `undefined` when unreadable.
 * @param purpose - What the asker wants.
 * @param windowSession - The asker's window session.
 * @param ownPid - The asker's process id.
 * @returns The refusal.
 * @example
 * lockConflictOf({ holder: 'setup', … }, 'run', 'w1', 10) // => { code: 'SIGN_IN_IN_PROGRESS', heldBy: 'setup' }
 */
export function lockConflictOf(
  holder: SignInLockRecord | undefined,
  purpose: SignInLockPurpose,
  windowSession: string,
  ownPid: number,
): SignInLockConflict {
  if (holder === undefined) return { code: 'SIGN_IN_PROFILE_IN_USE' }
  const inThisWindow =
    holder.pid === ownPid && holder.windowSession === windowSession
  const runInThisWindow =
    holder.holder === 'run' && inThisWindow ? holder.runId : undefined
  const base = {
    heldBy: holder.holder,
    ...(runInThisWindow !== undefined && { runInThisWindow }),
  }
  if (holder.holder === 'setup') return { code: 'SIGN_IN_IN_PROGRESS', ...base }
  if (purpose === 'run') return { code: 'BUSY', ...base }
  return { code: 'SIGN_IN_PROFILE_IN_USE', ...base }
}
