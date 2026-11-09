import { readdir } from 'node:fs/promises'

import type { StudyError } from '../errors'
import {
  reactScriptsHttpsRefusal,
  reactScriptsNotAppRefusal,
  reactScriptsNodeVersionRefusal,
  reactScriptsNotInstalledRefusal,
  reactScriptsPrestartRefusal,
  reactScriptsStartScriptRefusal,
  reactScriptsVersionRefusal,
} from '../reactScriptsRefusals'

import type { ReactScriptsRuntime } from './reactScriptsChildEnvironment'
import { reactScriptsPublicPathOf } from './reactScriptsPublicPath'
import { readNodeVersion } from './readNodeVersion'
import { readReactScriptsAppSettings } from './readReactScriptsAppSettings'
import {
  readReactScriptsPackageReadiness,
  type ReactScriptsPackageJudgement,
} from './readReactScriptsPackageReadiness'
import type { ResolvedPackage } from './resolveNextPackage'

/** What an app that can run on `react-scripts-dev` provides. */
export type ReactScriptsWorkspace = {
  /** The installed `react-scripts` folder; its `scripts/start.js` is what runs. */
  installationDirectory: string
  /** The leading `NAME=value` assignments of the accepted `start` script. */
  assignments: Record<string, string>
  /** The environment react-scripts settles: the child's own environment with the app's `.env` files loaded and expanded over it; the mask list is built from it. */
  environment: Record<string, string>
  /** The installed react-scripts major and the major of the Node that runs `start.js` (read only for react-scripts 4), which decide the child's `NODE_OPTIONS`. */
  runtime: ReactScriptsRuntime
  /** The path the development server serves the app at (`/` unless a `homepage` or `PUBLIC_URL` moves it). */
  publicPath: string
}

/**
 * Words the refusal of the first gap the shared readiness judgement lists, in the order an agent can act on them.
 * Called by {@link assessReactScriptsWorkspace}.
 * @param judgement - A not-ready judgement of {@link readReactScriptsPackageReadiness}.
 * @param appFolder - The app's folder, read for the lockfile that picks the install command.
 * @returns The refusal to throw.
 * @example await refusalOfGaps(judgement, '/repo/app') // => StudyError REACT_SCRIPTS_UNSUPPORTED (reason "prestart-script")
 */
async function refusalOfGaps(
  judgement: ReactScriptsPackageJudgement,
  appFolder: string,
  packageRootRelative: string,
): Promise<StudyError> {
  const { readiness } = judgement
  const has = (gap: string): boolean => readiness.missing.includes(gap)
  if (has('not-a-react-scripts-app'))
    return reactScriptsNotAppRefusal(packageRootRelative)
  if (has('react-scripts-installed')) {
    const names = await readdir(appFolder).catch(() => [])
    return reactScriptsNotInstalledRefusal(names)
  }
  if (has('react-scripts-5'))
    // An unreadable version is passed as `undefined`; the refusal builder words that case itself.
    return reactScriptsVersionRefusal(readiness.version)
  if (has('start-script')) {
    const { startScript } = readiness
    return reactScriptsStartScriptRefusal(
      // Structural descriptions only: a script's assignment values never reach the refusal.
      startScript.form === 'refused'
        ? startScript.refused.join('; ')
        : '(none)',
    )
  }
  return reactScriptsPrestartRefusal()
}

/**
 * Reads what decides the child's Node options: the installed major and, for react-scripts 4 only, the Node major of the executable that runs `start.js`.
 * Called by {@link assessReactScriptsWorkspace} once per assessment.
 * @param version - The installed react-scripts version the readiness judgement accepted.
 * @param node - The Node executable of the run.
 * @param signal - Ends the version read when the run is cancelled.
 * @returns The runtime facts.
 * @throws `REACT_SCRIPTS_UNSUPPORTED` (`node-version-unreadable`) for react-scripts 4 when the Node version cannot be read.
 * @example await readReactScriptsRuntime('5.0.1', '/usr/bin/node', signal) // => { reactScriptsMajor: 5 }
 */
async function readReactScriptsRuntime(
  version: string | undefined,
  node: string,
  signal: AbortSignal,
): Promise<ReactScriptsRuntime> {
  const reactScriptsMajor = Number.parseInt(version ?? '', 10)
  // Only webpack 4 needs the Node major, so a react-scripts 5 run starts no extra process.
  if (reactScriptsMajor !== 4) return { reactScriptsMajor }
  const text = await readNodeVersion(node, signal).catch(() => undefined)
  const nodeMajor = /^v(\d+)\./.exec(text ?? '')?.[1]
  if (nodeMajor === undefined) throw reactScriptsNodeVersionRefusal()
  return { reactScriptsMajor, nodeMajor: Number(nodeMajor) }
}

/**
 * Checks everything about a react-scripts app that is known before any process starts and refuses with the first gap the shared readiness judgement lists.
 *
 * Why it exists: `codebook_status` and the start must use one judgement (DX-9), so a start never runs an app status called not ready. Called by the adapter's `assertWorkspace` and `start`.
 * @param reactScriptsPackage - The app the run resolved.
 * @param node - The Node executable that runs `start.js` (`Codebook: Node Executable`); its version is read once, and only for react-scripts 4.
 * @param signal - Ends the Node version read when the run is cancelled.
 * @returns The installed `react-scripts` folder, the start script's assignments, the settled environment and the public path.
 * @throws `REACT_SCRIPTS_UNSUPPORTED` naming the first gap (`not-a-react-scripts-app`, `not-installed`, `react-scripts-version`, `start-script-not-react-scripts`, `prestart-script`, `https`, `env-file-unreadable`, and for react-scripts 4 `node-version-unreadable`).
 * @example const { installationDirectory } = await assessReactScriptsWorkspace(reactScriptsPackage, node, signal)
 */
export async function assessReactScriptsWorkspace(
  reactScriptsPackage: ResolvedPackage,
  node: string,
  signal: AbortSignal,
): Promise<ReactScriptsWorkspace> {
  const judgement = await readReactScriptsPackageReadiness(
    reactScriptsPackage.repositoryRoot,
    reactScriptsPackage.isRoot
      ? undefined
      : reactScriptsPackage.packageRootRelative,
  )
  if (!judgement.readiness.ready || !judgement.installationDirectory)
    throw await refusalOfGaps(
      judgement,
      reactScriptsPackage.packageRoot,
      reactScriptsPackage.packageRootRelative,
    )
  const runtime = await readReactScriptsRuntime(
    judgement.readiness.version,
    node,
    signal,
  )
  const { environment, homepage } = await readReactScriptsAppSettings(
    reactScriptsPackage.packageRoot,
    judgement.assignments,
    runtime,
  )
  // An HTTPS server cannot be observed over http://, so nothing starts.
  if (environment.HTTPS === 'true') throw reactScriptsHttpsRefusal()
  return {
    installationDirectory: judgement.installationDirectory,
    assignments: judgement.assignments,
    environment,
    runtime,
    publicPath: reactScriptsPublicPathOf(homepage, environment.PUBLIC_URL),
  }
}
