import { OWNED_APPLICATION_LOOPBACK_HOSTS } from '../constants'
import { StudyError } from '../errors'

/**
 * Refuses to open the learner's saved session on an origin that is not the loopback address of the development server Codebook started.
 *
 * Why it exists: the saved folder holds the cookies of the app's own sign-in; a run whose server reports another host (a LAN address, a tunnel) would hand them to a page Codebook does not own. Called by {@link ConfiguredBrowserRun} after the readiness check and before any browser launch of a run admitted with the saved session, and by {@link startSavedSessionServer} before the setup opens its browser at a declared origin.
 * @param ownedOrigin - The origin the owned server reported, such as `http://127.0.0.1:3000`; it keeps the loopback rule with or without a declaration.
 * @param declared - A run that declared `reverseProxy` (API 1.40): the declared origin and whether this run's proof still admits it (the gate's `admits`, which is true only for the normalized declared origin while the spawned CLI and the answering server process live). Absent for every other run, which keeps the loopback rule only.
 * @throws {@link StudyError} `SIGN_IN_ORIGIN_REFUSED`, naming only the scheme, host and port: `origin-not-loopback` when the host is not `localhost`, `127.0.0.1` or `[::1]`; `origin-not-proven` when a declaration is given and its proof no longer admits the declared origin (a Codebook defect, not the learner's setup).
 * @example
 * assertSavedSessionOrigin('http://127.0.0.1:3000') // returns
 * assertSavedSessionOrigin('http://192.0.2.10:3000') // throws SIGN_IN_ORIGIN_REFUSED
 * assertSavedSessionOrigin('http://127.0.0.1:4310', { origin: 'https://app.example.test', admits: () => false }) // throws SIGN_IN_ORIGIN_REFUSED (origin-not-proven)
 */
export function assertSavedSessionOrigin(
  ownedOrigin: string,
  declared?: { origin: string; admits: () => boolean },
): void {
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
  if (isLoopback) {
    // A declared origin is trusted only while this run's proof admits it; the loopback rule above still held.
    if (declared && !declared.admits()) throw originNotProven(declared.origin)
    return
  }
  throw new StudyError(
    'SIGN_IN_ORIGIN_REFUSED',
    `The saved session opens only on the loopback origin of the development server Codebook starts, and this run would open ${origin ? origin.origin : 'an origin that is no URL'}, so nothing was opened.`,
    undefined,
    undefined,
    undefined,
    { reason: 'origin-not-loopback', sideEffects: 'none' },
  )
}

/**
 * Builds the refusal of a declared origin that no proof of this run admits.
 * @param declaredOrigin - The normalized declared origin, such as `https://app.example.test`.
 * @returns A {@link StudyError} `SIGN_IN_ORIGIN_REFUSED` with `details.reason` `origin-not-proven`.
 * @example
 * originNotProven('https://app.example.test').details?.reason // => 'origin-not-proven'
 */
function originNotProven(declaredOrigin: string): StudyError {
  return new StudyError(
    'SIGN_IN_ORIGIN_REFUSED',
    `The saved session opens only at an origin Codebook proved for this run, and the declared origin ${declaredOrigin} has no proof from this run, so nothing was opened. This is a Codebook defect and not your setup: start one new run.`,
    undefined,
    undefined,
    undefined,
    { reason: 'origin-not-proven', sideEffects: 'none' },
  )
}
