import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES } from '../constants'
import { reactScriptsEnvFileRefusal } from '../reactScriptsRefusals'

import { readUpToLimit } from './readUpToLimit'

/**
 * Reads one `.env*` file of a react-scripts app the way react-scripts' dotenv sees it, without ever following it into a hang.
 *
 * Why it exists: react-scripts reads each file whole and ignores any read error, so Codebook must (a) treat an absent, directory or unreadable file as absent and (b) refuse a file it cannot read within the limit, because react-scripts still would. The file opens with `O_NONBLOCK` and is checked with `fstat` before any read, so a FIFO or device cannot block the extension host. Called by {@link readReactScriptsAppSettings}.
 * @param appRoot - The app's folder.
 * @param name - The fixed `.env*` file name.
 * @returns The file's text, or `undefined` when react-scripts would ignore the file (absent, a directory, unreadable).
 * @throws `REACT_SCRIPTS_UNSUPPORTED` (`env-file-unreadable`) when the file is over {@link REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES} or is not a regular file.
 * @example await readReactScriptsEnvFile('/app', '.env') // => 'A=1\n'
 */
export async function readReactScriptsEnvFile(
  appRoot: string,
  name: string,
): Promise<string | undefined> {
  // dotenv catches every open and read error, so each one means "no file".
  const handle = await open(
    join(appRoot, name),
    constants.O_RDONLY | constants.O_NONBLOCK,
  ).catch(() => undefined)
  if (!handle) return undefined
  try {
    const status = await handle.stat()
    if (status.isDirectory()) return undefined
    if (!status.isFile())
      throw reactScriptsEnvFileRefusal(name, 'it is not a regular file')
    // A read error is caught by dotenv as well; a file that grew past the limit meanwhile is refused like one that was over it.
    const bytes =
      status.size > REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES
        ? undefined
        : await readUpToLimit(
            handle,
            status.size,
            REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES,
          ).catch(() => Buffer.alloc(0))
    if (!bytes)
      throw reactScriptsEnvFileRefusal(
        name,
        `it is over ${REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES} bytes`,
      )
    return bytes.toString('utf8')
  } finally {
    await handle.close()
  }
}
