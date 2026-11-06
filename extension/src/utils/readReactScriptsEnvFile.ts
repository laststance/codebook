import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES } from '../constants'
import type { StudyError } from '../errors'
import { reactScriptsEnvFileRefusal } from '../reactScriptsRefusals'

import { readUpToLimit } from './readUpToLimit'

/**
 * How an `.env` reader treats a file that exists but cannot be opened or read, and how it words a refusal.
 *
 * Why it exists (E-16): react-scripts' dotenv ignores every open and read error, while Expo's loader fails on an existing file it cannot read, and a value that could not be read could not be masked. Passed by {@link readReactScriptsAppSettings} (the default) and by the Expo settings reader.
 */
export type EnvFileReadPolicy = {
  /** `true` refuses an existing file that cannot be opened, read or is a directory; `false` reads such a file as absent, as dotenv does. */
  refuseUnreadable: boolean
  /** Words the refusal of a file Codebook cannot read within its limits. */
  refusal: (name: string, reason: string) => StudyError
}

/** The react-scripts policy: dotenv-compatible, any open or read error means "no file". */
export const REACT_SCRIPTS_ENV_FILE_POLICY: EnvFileReadPolicy = {
  refuseUnreadable: false,
  refusal: reactScriptsEnvFileRefusal,
}

/** Says whether an open failure means the file is simply not there. @example isAbsentFileError({ code: 'ENOENT' }) // => true */
function isAbsentFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/**
 * Reads one `.env*` file of an app, without ever following it into a hang.
 *
 * Why it exists: the dev servers read each file whole, so Codebook must refuse a file it cannot read within the limit, because the server still would. The file opens with `O_NONBLOCK` and is checked with `fstat` before any read, so a FIFO or device cannot block the extension host. With react-scripts' policy an absent, directory or unreadable file is absent, as dotenv sees it; with a refusing policy (Expo) an existing file that cannot be opened or read is refused. Called by {@link readReactScriptsAppSettings} and the Expo settings reader.
 * @param appRoot - The app's folder.
 * @param name - The fixed `.env*` file name.
 * @param policy - How an unreadable file is treated and worded; react-scripts' own by default.
 * @returns The file's text, or `undefined` when the file is absent (or, under the dotenv policy, a directory or unreadable).
 * @throws The policy's refusal when the file is over {@link REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES} or is not a regular file, and under a refusing policy when an existing file cannot be opened or read.
 * @example await readReactScriptsEnvFile('/app', '.env') // => 'A=1\n'
 */
export async function readReactScriptsEnvFile(
  appRoot: string,
  name: string,
  policy: EnvFileReadPolicy = REACT_SCRIPTS_ENV_FILE_POLICY,
): Promise<string | undefined> {
  let openFailure: unknown
  const handle = await open(
    join(appRoot, name),
    constants.O_RDONLY | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    openFailure = error
    return undefined
  })
  if (!handle) {
    // A file that is not there is absent under every policy; any other open failure is refused only when the policy says so.
    if (policy.refuseUnreadable && !isAbsentFileError(openFailure))
      throw policy.refusal(name, 'it could not be opened')
    return undefined
  }
  try {
    const status = await handle.stat()
    if (status.isDirectory() && !policy.refuseUnreadable) return undefined
    if (!status.isFile()) throw policy.refusal(name, 'it is not a regular file')
    // Under dotenv's policy a read error means an empty file; a refusing policy words it.
    const bytes =
      status.size > REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES
        ? undefined
        : await readUpToLimit(
            handle,
            status.size,
            REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES,
          ).catch(() => {
            if (policy.refuseUnreadable)
              throw policy.refusal(name, 'it could not be read')
            return Buffer.alloc(0)
          })
    if (!bytes)
      throw policy.refusal(
        name,
        `it is over ${REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES} bytes`,
      )
    return bytes.toString('utf8')
  } finally {
    await handle.close()
  }
}
