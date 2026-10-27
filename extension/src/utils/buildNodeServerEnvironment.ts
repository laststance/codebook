import { INHERITED_VARIABLES } from './buildNodeTestEnvironment'

/** Certificate settings a server may need to reach its own services over TLS (a database or an API with a private CA); they name files, never secrets. */
const CERTIFICATE_VARIABLES = [
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const

/**
 * Builds the restricted environment of an owned node-server process: the basic settings Node and the repository's tools need, plus certificate locations, and nothing else.
 * `NODE_ENV` and `CI` are left unset so the server's own default applies (both pinned targets default to development), proxy variables stay out so the server's own requests are not rerouted, and the server's own `.env` file, which it loads itself, is never read or written by Codebook.
 * Called by {@link launchNodeServer} for the spawned server.
 * @param inherited - The editor host environment to copy the allowed settings from.
 * @returns Only the allowed settings present in `inherited`.
 * @example
 * buildNodeServerEnvironment({ PATH: '/usr/bin', HTTP_PROXY: 'http://proxy:8080', NODE_ENV: 'production', SSL_CERT_FILE: '/etc/ssl/cert.pem' })
 * // => { PATH: '/usr/bin', SSL_CERT_FILE: '/etc/ssl/cert.pem' }
 */
export function buildNodeServerEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of [...INHERITED_VARIABLES, ...CERTIFICATE_VARIABLES])
    if (inherited[name]) environment[name] = inherited[name]
  return environment
}
