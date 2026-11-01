import { lstat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { z } from 'zod'

import {
  SIGN_IN_RECORD_FILE,
  SIGN_IN_RECORD_LIMIT_BYTES,
  SIGN_IN_RECORD_VERSION,
} from '../../constants'
import { signInPathSchema } from '../../repositoryConfigSchemas'
import { atomicPrivateWrite } from '../../utils/atomicPrivateWrite'
import { readWikiRegularFile } from '../../utils/readWikiRegularFile'
import type { SavedSessionUnusableReason } from '../savedSessionTypes'

import { sha256 } from './sha256'

/** The shape of `signin.json` (version 1): what the last setup of a saved session recorded. Unknown keys are kept through a read and a rewrite, so that a later build may add some under this version and an older build's accepted Chrome upgrade does not drop them. */
const signInRecordSchema = z.looseObject({
  version: z.literal(SIGN_IN_RECORD_VERSION),
  /** `true` only after Done; Close setup, a timeout and a forced close write `false`. */
  confirmed: z.boolean(),
  /** ISO time the last setup ended. */
  setupAt: z.iso.datetime(),
  signInPaths: z.array(signInPathSchema).min(1).max(4),
  /** The Chrome major version that set the session up (D12: a lower major later is refused). */
  chromeMajor: z.number().int().positive(),
  /** The repository's real path; the session list names it, and {@link readSignInRecord} refuses a record whose path does not hash to its folder's name. */
  repositoryRoot: z.string().min(1),
  appCookies: z.enum(['persistent', 'session-only', 'none', 'unknown']),
})

/** The content of `signin.json`. @example const record: SignInRecord = { version: 1, confirmed: true, setupAt: '2026-11-02T12:10:00.000Z', signInPaths: ['/login'], chromeMajor: 154, repositoryRoot: '/work/app', appCookies: 'persistent' } */
export type SignInRecord = z.infer<typeof signInRecordSchema>

/** What reading a folder's `signin.json` found. */
export type SignInRecordRead =
  | { kind: 'absent' }
  | { kind: 'record'; record: SignInRecord }
  | {
      kind: 'unusable'
      reason: Extract<
        SavedSessionUnusableReason,
        'unreadable-record' | 'newer-record' | 'not-a-session-folder'
      >
    }

/**
 * Reads `signin.json` of a saved-session folder without following links, within {@link SIGN_IN_RECORD_LIMIT_BYTES}; called by the store for every status, admission and setup.
 * A file that is no regular file, too large, not JSON or not the schema is `unreadable-record`; a numeric `version` above the one this build writes is `newer-record`; a record whose `repositoryRoot` does not hash to the folder's name (a folder copied from another repository, or edited by hand) is `not-a-session-folder`, so no run uses another repository's session. None is ever rewritten or deleted here; the removal deletes such a folder after its own path proof.
 * @param folder - The saved-session folder, named by the sha256 of its repository's real path.
 * @returns The record, `absent` when no file stands there, or `unusable` with the reason.
 * @example
 * await readSignInRecord('/storage/sign-in-profiles/ab12…') // => { kind: 'absent' }
 */
export async function readSignInRecord(
  folder: string,
): Promise<SignInRecordRead> {
  const path = join(folder, SIGN_IN_RECORD_FILE)
  const file = await readWikiRegularFile(
    path,
    undefined,
    SIGN_IN_RECORD_LIMIT_BYTES,
  )
  if (!file)
    return (await entryExists(path))
      ? { kind: 'unusable', reason: 'unreadable-record' }
      : { kind: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(file.bytes.toString('utf8'))
  } catch {
    return { kind: 'unusable', reason: 'unreadable-record' }
  }
  const version =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'version')
      : undefined
  // A record of a newer build is kept untouched and reported as such.
  if (typeof version === 'number' && version > SIGN_IN_RECORD_VERSION)
    return { kind: 'unusable', reason: 'newer-record' }
  const result = signInRecordSchema.safeParse(parsed)
  if (!result.success) return { kind: 'unusable', reason: 'unreadable-record' }
  // A record of another repository's session is not this folder's.
  if (sha256(result.data.repositoryRoot) !== basename(folder))
    return { kind: 'unusable', reason: 'not-a-session-folder' }
  return { kind: 'record', record: result.data }
}

/** Says whether anything (a link or a special file included) stands at the path. */
async function entryExists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

/**
 * Writes `signin.json` atomically (temporary file, fsync, rename), so a failure before the rename leaves the earlier record intact; called by the store's setup lease and by an accepted Chrome upgrade, which rewrites the record it read with its unknown keys.
 * @param folder - The saved-session folder.
 * @param record - The record to publish.
 * @param beforePublish - Runs before the rename; a test makes it throw to prove atomicity.
 * @example
 * await writeSignInRecord(folder, record)
 */
export async function writeSignInRecord(
  folder: string,
  record: SignInRecord,
  beforePublish?: () => void,
): Promise<void> {
  await atomicPrivateWrite(
    join(folder, SIGN_IN_RECORD_FILE),
    signInRecordSchema.parse(record),
    SIGN_IN_RECORD_LIMIT_BYTES,
    beforePublish,
  )
}
