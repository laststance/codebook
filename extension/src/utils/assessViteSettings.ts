import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { VITE_LOOPBACK_HOST } from '../constants'

import { redactSecretText } from './redactSecretText'

/** The facts the owned Vite launcher reads from `server.config` and sends before it listens. */
export type ViteFacts = {
  viteVersion: string
  /** The `root` Vite resolved. */
  root: string
  base: string
  cacheDir: string
  /** The port the dev server will use: the `dev` script's `--port`, else the config's, else 5173. */
  port: number
  https: boolean
  origin?: string
  /** The resolved `server.host`: a string, `true` (every interface) or `undefined`; only {@link VITE_LOOPBACK_HOST} is supported. */
  host?: string | boolean
  /** Whether `server.hmr` is an object with its own `port`, `host` or `server`: a second listener Codebook does not own. */
  hmrOwnListener: boolean
  /** Whether `server.ws` (Vite 8) is an object with its own `port`, `host` or `server`: a websocket listener Codebook does not own, even with `hmr: false`. */
  wsOwnListener: boolean
  middlewareMode: boolean
  appType: string
  /** The config file Vite loaded, workspace-relative; `undefined` when none. */
  configFile?: string
}

/** Prints a URL without userinfo and with secret shapes masked, for a refusal naming `server.origin`. */
function printOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    url.username = ''
    url.password = ''
    return redactSecretText(url.href)
  } catch {
    return 'set'
  }
}

/**
 * Resolves symlinks of a path that may not exist yet, through its nearest existing ancestor.
 * @param path - The path to resolve, such as a cache folder Vite has not created.
 * @returns The real path of the nearest existing ancestor joined with the missing rest.
 * @example
 * await realPathOfPlanned('/repo/node_modules/.vite') // => '/outside/.vite' when node_modules links outside
 */
async function realPathOfPlanned(path: string): Promise<string> {
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch {
    const parent = dirname(absolute)
    // The filesystem root always exists, so the walk ends there.
    if (parent === absolute) return absolute
    return join(await realPathOfPlanned(parent), relative(parent, absolute))
  }
}

/** Whether a folder lies inside the package root or is it, comparing real paths so a symlinked folder cannot point outside. */
async function isInside(packageRoot: string, folder: string): Promise<boolean> {
  const path = relative(
    await realPathOfPlanned(packageRoot),
    await realPathOfPlanned(folder),
  )
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  )
}

/**
 * Lists every setting of the resolved Vite config that Codebook cannot run, for the launcher handshake of {@link launchViteDevelopmentServer}.
 *
 * Why it exists: the policy is evaluated on the facts of the config the server will really use, so it never differs from the start. All unsupported settings are listed at once, each with a value only when the value is a safe scalar.
 *
 * @param facts - The facts the launcher sent.
 * @param packageRoot - The package root (the workspace root this version).
 * @returns One phrase per unsupported setting, empty when the config is supported. `cacheDir` is judged on real paths, so a symlinked folder that leaves the package root is listed.
 * @example
 * await assessViteSettings({ …facts, base: '/app/', https: true }, '/repo') // => ['base is "/app/"', 'server.https is set']
 */
export async function assessViteSettings(
  facts: ViteFacts,
  packageRoot: string,
): Promise<string[]> {
  const unsupported: string[] = []
  if (facts.base !== '/')
    unsupported.push(`base is ${JSON.stringify(redactSecretText(facts.base))}`)
  if (resolve(facts.root) !== resolve(packageRoot))
    unsupported.push('root is not the package root')
  if (facts.port === 0)
    unsupported.push('server.port is 0 (a random port Codebook cannot own)')
  if (facts.host !== VITE_LOOPBACK_HOST)
    unsupported.push(
      `server.host is not ${VITE_LOOPBACK_HOST} (Codebook owns only the loopback host)`,
    )
  if (facts.https) unsupported.push('server.https is set')
  if (facts.origin !== undefined)
    unsupported.push(`server.origin is ${printOrigin(facts.origin)}`)
  if (facts.hmrOwnListener)
    unsupported.push('server.hmr is set (its own port, host or server)')
  if (facts.wsOwnListener)
    unsupported.push('server.ws is set (its own port, host or server)')
  if (facts.middlewareMode) unsupported.push('server.middlewareMode is true')
  else if (facts.appType === 'custom') unsupported.push('appType is "custom"')
  if (!(await isInside(packageRoot, facts.cacheDir)))
    unsupported.push('cacheDir is outside the package root')
  return unsupported
}
