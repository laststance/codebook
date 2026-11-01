import { OWNED_APPLICATION_LOOPBACK_HOSTS } from '../constants'
import { StudyError } from '../errors'

/**
 * Refuses to open the learner's saved session on an origin that is not the loopback address of the development server Codebook started.
 *
 * Why it exists: the saved folder holds the cookies of the app's own sign-in; a run whose server reports another host (a LAN address, a tunnel) would hand them to a page Codebook does not own. Called by {@link ConfiguredBrowserRun} after the readiness check and before any browser launch of a run admitted with the saved session.
 * @param ownedOrigin - The origin the owned server reported, such as `http://127.0.0.1:3000`.
 * @throws {@link StudyError} `SIGN_IN_ORIGIN_REFUSED`, naming only the scheme, host and port, when the host is not `localhost`, `127.0.0.1` or `[::1]`.
 * @example
 * assertSavedSessionOrigin('http://127.0.0.1:3000') // returns
 * assertSavedSessionOrigin('http://192.0.2.10:3000') // throws SIGN_IN_ORIGIN_REFUSED
 */
export function assertSavedSessionOrigin(ownedOrigin: string): void {
  let origin: URL | undefined
  try {
    origin = new URL(ownedOrigin)
  } catch {
    origin = undefined
  }
  const isLoopback =
    origin !== undefined &&
    origin.protocol === 'http:' &&
    // `URL.hostname` keeps the brackets of an IPv6 host, as the constant spells it.
    OWNED_APPLICATION_LOOPBACK_HOSTS.some((host) => host === origin.hostname)
  if (isLoopback) return
  throw new StudyError(
    'SIGN_IN_ORIGIN_REFUSED',
    `The saved session opens only on the loopback origin of the development server Codebook starts, and this run would open ${origin ? origin.origin : 'an origin that is no URL'}, so nothing was opened.`,
    undefined,
    undefined,
    undefined,
    { reason: 'origin-not-loopback', sideEffects: 'none' },
  )
}
