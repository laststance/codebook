import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { z } from 'zod'

import { REVERSE_PROXY_SYSTEM_CERTIFICATES_MAX_BUFFER_BYTES } from '../constants'

const execFileAsync = promisify(execFile)

/** The one-line program the learner's Node runs to print its view of the operating system's trust store. */
const PRINT_SYSTEM_CERTIFICATES_PROGRAM =
  'process.stdout.write(JSON.stringify(require("node:tls").getCACertificates("system")))'

const certificateListSchema = z.array(z.string())

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
  signal.throwIfAborted()
  try {
    const { stdout } = await execFileAsync(
      input.nodeExecutable,
      ['-e', PRINT_SYSTEM_CERTIFICATES_PROGRAM],
      {
        env: input.environment,
        timeout: input.timeoutMs,
        maxBuffer: REVERSE_PROXY_SYSTEM_CERTIFICATES_MAX_BUFFER_BYTES,
        signal,
        windowsHide: true,
      },
    )
    return certificatesOf(stdout)
  } catch {
    // The run's own cancellation is no store failure.
    signal.throwIfAborted()
    return { ok: false }
  }
}

/**
 * Parses the child's output into a non-empty certificate list.
 * @param stdout - What the child printed.
 * @returns The list, or `{ ok: false }` for invalid JSON, a wrong shape or an empty list.
 * @example
 * certificatesOf('["-----BEGIN CERTIFICATE-----"]') // => { ok: true, certificates: ['-----BEGIN CERTIFICATE-----'] }
 */
function certificatesOf(stdout: string): SystemCertificatesResult {
  try {
    const certificates = certificateListSchema.parse(JSON.parse(stdout))
    return certificates.length > 0 ? { ok: true, certificates } : { ok: false }
  } catch {
    return { ok: false }
  }
}
