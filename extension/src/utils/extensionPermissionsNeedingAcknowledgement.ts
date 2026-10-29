import { EXTENSION_ACKNOWLEDGED_API_PERMISSIONS } from '../constants'

/** The host part of a match pattern such as `https://printer.local:8080/*`, or `undefined` when the pattern has no scheme and host. */
const MATCH_PATTERN_HOST = /^(?:\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)/i
/**
 * Private-network, loopback, link-local and unspecified hosts: `localhost` and `*.localhost`, `*.local` names, IPv4 `0.*`, `10.*`, `100.64.0.0/10`, `127.*`, `169.254.*` (link-local, cloud metadata), `172.16-31.*`, `192.168.*`, and bracketed IPv6 loopback, unspecified, IPv4-mapped, unique-local (`fc00::/7`) and link-local (`fe80::/10`) addresses.
 */
const PRIVATE_HOST =
  /^(?:(?:[^.]+\.)*localhost|(?:[^.]+\.)*local|(?:0|10|127)\.[\d.]*|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.[\d.]*|169\.254\.[\d.]*|172\.(?:1[6-9]|2\d|3[01])\.[\d.]*|192\.168\.[\d.]*|\[(?:::1?|(?:0{1,4}:)+0{0,3}[01]|::ffff:[0-9a-f.:]*|f[cd][0-9a-f]{2}:[0-9a-f:]*|fe[89ab][0-9a-f]:[0-9a-f:]*)\])$/i

/** True when a host permission matches every host or a private-network host. */
function reachesOutsideTestProfile(hostPattern: string): boolean {
  if (hostPattern === '<all_urls>') return true
  const host = MATCH_PATTERN_HOST.exec(hostPattern)?.[1]
  if (host === undefined) return false
  // A port is no part of a match pattern's host but may be written (digits or `*`); ignore it.
  const hostWithoutPort = host.replace(/:(?:\d+|\*)$/, '')
  return hostWithoutPort === '*' || PRIVATE_HOST.test(hostWithoutPort)
}

/**
 * Lists the manifest entries that reach outside the run's test profile and so need `acknowledgedPermissions` (ER5): `nativeMessaging`, `debugger`, `management`, `downloads`, `proxy`, `privacy`, host permissions matching all hosts, and private-network hosts.
 * Called by {@link resolveChromeExtensionRun} before launch.
 * @param permissions - The manifest's `permissions`.
 * @param hostPermissions - The manifest's `host_permissions`.
 * @returns The flagged entries as written, API permissions first, each in manifest order.
 * @example
 * extensionPermissionsNeedingAcknowledgement(['storage', 'debugger'], ['<all_urls>', 'https://example.com/*'])
 * // => ['debugger', '<all_urls>']
 */
export function extensionPermissionsNeedingAcknowledgement(
  permissions: readonly string[],
  hostPermissions: readonly string[],
): string[] {
  const flaggedApis = permissions.filter((permission) =>
    EXTENSION_ACKNOWLEDGED_API_PERMISSIONS.some(
      (flagged) => flagged === permission,
    ),
  )
  return [...flaggedApis, ...hostPermissions.filter(reachesOutsideTestProfile)]
}
