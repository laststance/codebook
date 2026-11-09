import {
  DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES,
  REDACTION_MASK,
  REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
  REVERSE_PROXY_PROOF_SECRET_ENV,
} from '../constants'

/**
 * Builds the complete environment of the owned `next dev` process.
 *
 * Called by {@link launchDevelopmentServer} when it spawns the app.
 * Credentials and unrelated application configuration stay outside: only the variables named in {@link DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES} are inherited.
 *
 * @param host - The extension host's environment to inherit from.
 * @param proofSecret - The identity secret of a run that declares `reverseProxy`; it is the only way the secret reaches the server, as {@link REVERSE_PROXY_PROOF_SECRET_ENV}. Absent for every other run.
 * @returns A new environment object; entries the host lacks are `undefined`.
 *
 * @example
 * ```ts
 * const environment = buildDevelopmentServerEnvironment({ PATH: '/bin' }) // PATH, CI and HUSKY are set
 * buildDevelopmentServerEnvironment({}, 'ab12').CODEBOOK_PROOF_SECRET // => 'ab12'
 * ```
 */
export function buildDevelopmentServerEnvironment(
  host: NodeJS.ProcessEnv = process.env,
  proofSecret?: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NEXT_TELEMETRY_DISABLED: '1',
    // Next's default 100 ms child cutoff can kill native lock cleanup before this closer's bounded wait.
    NEXT_EXIT_TIMEOUT_MS: String(REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS),
    HUSKY: '0',
    CI: 'true',
  }
  // Inherit only basic process settings; credentials and unrelated application configuration stay outside the owned process.
  for (const name of DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES)
    environment[name] = host[name]
  // The identity secret is added after the inherited names, so no host variable can replace it.
  if (proofSecret !== undefined)
    environment[REVERSE_PROXY_PROOF_SECRET_ENV] = proofSecret
  return environment
}

/**
 * Gives the output handling of a Next server: the caller's mask, extended so the identity secret reads as the mask wherever the server prints it.
 *
 * Why it exists: the app's own code can read the secret from its environment and print it; the published output tail and the journal must never carry it, also when the secret is split over two output chunks. Called by {@link launchDevelopmentServer} for every Next launch.
 * @param outputMask - The caller's mask for the Next server, if any; it runs first.
 * @param secret - The run's identity secret; absent for a run that declares no `reverseProxy`.
 * @returns The mask to use (the caller's own when there is no secret) and how many characters of output stay unpublished so a split secret can be matched whole.
 * @example
 * nextOutputHandling(undefined, 'ab12cd').mask?.('token ab12cd') // => 'token [masked]'
 * nextOutputHandling(undefined, undefined) // => { mask: undefined, holdbackCharacters: 0 }
 */
export function nextOutputHandling(
  outputMask: ((text: string) => string) | undefined,
  secret: string | undefined,
): {
  mask: ((text: string) => string) | undefined
  holdbackCharacters: number
} {
  // No secret: the caller's mask stands and nothing is held back.
  if (secret === undefined) return { mask: outputMask, holdbackCharacters: 0 }
  return {
    mask: (text) =>
      (outputMask ? outputMask(text) : text).split(secret).join(REDACTION_MASK),
    holdbackCharacters: secret.length,
  }
}
