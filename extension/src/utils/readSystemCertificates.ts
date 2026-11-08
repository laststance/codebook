/** What {@link readSystemCertificates} needs to run the learner's own Node. */
export type SystemCertificatesInput = {
  /** The run's resolved Node executable. */
  nodeExecutable: string
  /** The environment of `buildDevelopmentServerEnvironment()`. */
  environment: NodeJS.ProcessEnv
  /** Bound on the child, {@link REVERSE_PROXY_SYSTEM_CERTIFICATES_TIMEOUT_MS}. */
  timeoutMs: number
}

/** What {@link readSystemCertificates} answers: the PEM certificates of the operating system's store, or that the store could not be read. */
export type SystemCertificatesResult =
  { ok: true; certificates: string[] } | { ok: false }

/**
 * Reads the operating system's trusted certificates in the learner's own Node, each time.
 *
 * Why it exists: the proof must trust exactly what the system trusts and never bypass a check, and a fresh read in a child sees an issuer the learner installed after the editor started. An error, a timeout, invalid JSON or an empty list is `{ ok: false }` (the gate words `proof-unclassified` with the Output line `reverse proxy: system trust store unreadable`). Called by `ReverseProxyGate.prove()`.
 * @param input - {@link SystemCertificatesInput}.
 * @param signal - The run's signal; it kills the child.
 * @returns The certificates, or `{ ok: false }`.
 * @throws The signal's reason when the run is cancelled.
 * @example
 * await readSystemCertificates({ nodeExecutable: '/usr/bin/node', environment: process.env, timeoutMs: 5_000 }, signal) // => { ok: true, certificates: ['-----BEGIN CERTIFICATE-----…'] }
 */
export async function readSystemCertificates(
  input: SystemCertificatesInput,
  signal: AbortSignal,
): Promise<SystemCertificatesResult> {
  void input
  void signal
  throw new Error('not implemented')
}
