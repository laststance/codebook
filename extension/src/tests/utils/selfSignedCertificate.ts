import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { removeTestFolder } from './removeTestFolder'

const execFileAsync = promisify(execFile)

/** Bound on the one `openssl` call, so a hung binary fails the test instead of the suite. */
const OPENSSL_TIMEOUT_MS = 20_000

/** A throwaway certificate and its key, both PEM, made by `openssl` at test time. */
export type SelfSignedCertificate = {
  /** The certificate; being self-signed it is also its own trust anchor (pass it as `ca`). */
  certificate: string
  privateKey: string
}

/**
 * Makes a self-signed certificate valid for one host name (and optionally IP addresses) with the system `openssl`.
 *
 * Why it exists: the reverse proxy proof and its callers (the proof transport, the gate, the saved-session tests) need a real TLS certificate whose trust they control; a fixed file would expire and a library would add a dependency. It writes an `openssl` config file (portable across OpenSSL and LibreSSL, unlike `-addext`), a bounded call makes the key (P-256, encoded as the named curve every TLS client reads) and certificate in a private temporary folder, and the folder is removed afterwards.
 * Called by tests only.
 * @param hostname - The DNS name placed in the subject alternative names.
 * @param ipAddresses - Optional IP literals added to the subject alternative names.
 * @returns The PEM certificate and private key.
 * @throws When `openssl` is not installed (a test must fail with this message, never skip) or does not finish within 20 s.
 * @example
 * const { certificate, privateKey } = await createSelfSignedCertificate('app.example.test', ['127.0.0.1'])
 * createServer({ cert: certificate, key: privateKey }) // trusted by a client with ca: [certificate]
 */
export async function createSelfSignedCertificate(
  hostname: string,
  ipAddresses: readonly string[] = [],
): Promise<SelfSignedCertificate> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-test-certificate-'))
  try {
    const configPath = join(folder, 'openssl.cnf')
    await writeFile(configPath, opensslConfigOf(hostname, ipAddresses))
    await runOpenssl(
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        // Name the curve in the key: macOS 27.2.1's LibreSSL otherwise writes its explicit parameters, and Chrome (BoringSSL) and curl end the handshake with a decode error instead of judging the certificate (Cycle 0111).
        '-pkeyopt',
        'ec_param_enc:named_curve',
        '-nodes',
        '-days',
        '2',
        '-config',
        configPath,
        '-keyout',
        join(folder, 'key.pem'),
        '-out',
        join(folder, 'cert.pem'),
      ],
      folder,
    )
    return {
      certificate: await readFile(join(folder, 'cert.pem'), 'utf8'),
      privateKey: await readFile(join(folder, 'key.pem'), 'utf8'),
    }
  } finally {
    await removeTestFolder(folder)
  }
}

/** The `openssl` request configuration: one subject, and the host names as subject alternative names. */
function opensslConfigOf(
  hostname: string,
  ipAddresses: readonly string[],
): string {
  const alternativeNames = [
    `DNS.1 = ${hostname}`,
    ...ipAddresses.map((address, index) => `IP.${index + 1} = ${address}`),
  ]
  return [
    '[req]',
    'distinguished_name = subject',
    'x509_extensions = extensions',
    'prompt = no',
    '[subject]',
    `CN = ${hostname}`,
    '[extensions]',
    'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, digitalSignature, keyCertSign',
    'subjectAltName = @alternative_names',
    '[alternative_names]',
    ...alternativeNames,
    '',
  ].join('\n')
}

/** Runs `openssl` with the 20 s bound; a missing binary or a failure becomes a clear error. */
async function runOpenssl(
  argumentsList: readonly string[],
  cwd: string,
): Promise<void> {
  try {
    await execFileAsync('openssl', [...argumentsList], {
      cwd,
      timeout: OPENSSL_TIMEOUT_MS,
    })
  } catch (error) {
    // A missing binary is a test failure with an actionable message, never a skip.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error(
        'These tests need the openssl command to make a test certificate, but it was not found on PATH. Install OpenSSL (or LibreSSL) and run them again.',
      )
    throw new Error(
      `openssl could not make the test certificate within ${OPENSSL_TIMEOUT_MS} ms: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
