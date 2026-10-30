import { isAbsolute, relative, resolve, sep } from 'node:path'

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
  /** Whether `server.hmr` is an object with its own `port`, `host` or `server`: a second listener Codebook does not own. */
  hmrOwnListener: boolean
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

/** Whether a folder lies inside the package root or is it. */
function isInside(packageRoot: string, folder: string): boolean {
  const path = relative(resolve(packageRoot), resolve(folder))
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
 * @returns One phrase per unsupported setting, empty when the config is supported.
 * @example
 * assessViteSettings({ …facts, base: '/app/', https: true }, '/repo') // => ['base is "/app/"', 'server.https is set']
 */
export function assessViteSettings(
  facts: ViteFacts,
  packageRoot: string,
): string[] {
  const unsupported: string[] = []
  if (facts.base !== '/')
    unsupported.push(`base is ${JSON.stringify(redactSecretText(facts.base))}`)
  if (resolve(facts.root) !== resolve(packageRoot))
    unsupported.push('root is not the package root')
  if (facts.port === 0)
    unsupported.push('server.port is 0 (a random port Codebook cannot own)')
  if (facts.https) unsupported.push('server.https is set')
  if (facts.origin !== undefined)
    unsupported.push(`server.origin is ${printOrigin(facts.origin)}`)
  if (facts.hmrOwnListener)
    unsupported.push('server.hmr is set (its own port, host or server)')
  if (facts.middlewareMode) unsupported.push('server.middlewareMode is true')
  else if (facts.appType === 'custom') unsupported.push('appType is "custom"')
  if (!isInside(packageRoot, facts.cacheDir))
    unsupported.push('cacheDir is outside the package root')
  return unsupported
}
