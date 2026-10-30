import { FIRST_UNPRIVILEGED_PORT } from '../constants'
import type { StudyError } from '../errors'
import { viteRefusal } from '../viteRefusals'

import type { PortRefusal } from './assertDevelopmentPortFree'

/**
 * Words a busy-port refusal of a Vite start as `VITE_PORT_UNAVAILABLE`, for the `refuse` option of {@link assertDevelopmentPortFree}.
 *
 * Why it exists: the Next wording names `next dev` flags, which a Vite project does not have. Called by the Vite adapter's start, after the launcher reported the port its config resolves.
 *
 * @param refusal - Why the port cannot be used.
 * @param source - Where the port was declared, such as `the Vite config (vite.config.ts)`.
 * @returns The error to throw.
 * @example
 * vitePortRefusal({ port: 3010, reason: 'in-use' }, 'the Vite config').message // => 'Port 3010 (the Vite config) is in use on this machine. …'
 */
export function vitePortRefusal(
  refusal: PortRefusal,
  source: string,
): StudyError {
  const { port } = refusal
  const subject = `Port ${port} (${source})`
  const fix =
    'Ask the learner to stop the process that listens on it (often their own dev server), or to set another port in the Vite config or the dev script (--port); never end that process yourself.'
  if (refusal.reason === 'not-permitted')
    return viteRefusal(
      'VITE_PORT_UNAVAILABLE',
      `${subject} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it). Ask the learner to use a port from ${FIRST_UNPRIVILEGED_PORT} up.`,
    )
  if (refusal.reason === 'unreadable')
    return viteRefusal(
      'VITE_PORT_UNAVAILABLE',
      `Codebook could not check whether ${subject} is free (${refusal.errorCode ?? 'unknown error'}), so it did not start Vite.`,
    )
  if (refusal.reason === 'held-by-codebook')
    return viteRefusal(
      'VITE_PORT_UNAVAILABLE',
      `${subject} is still held by an earlier Codebook run that ${refusal.heldBy === 'stopping' ? 'has not finished stopping' : 'is still running'}. Stop that run (codebook_stop) and wait for it to finish, then start again.`,
    )
  return viteRefusal(
    'VITE_PORT_UNAVAILABLE',
    `${subject} is in use on this machine, and Codebook never starts the app on another port. ${fix}`,
  )
}
