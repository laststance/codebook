import { readdir } from 'node:fs/promises'

import type { StudyError } from '../errors'
import {
  reactScriptsHttpsRefusal,
  reactScriptsNotAppRefusal,
  reactScriptsNotInstalledRefusal,
  reactScriptsPrestartRefusal,
  reactScriptsStartScriptRefusal,
  reactScriptsVersionRefusal,
} from '../reactScriptsRefusals'

import { reactScriptsPublicPathOf } from './reactScriptsPublicPath'
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
  /** The environment react-scripts builds: the start script's assignments over the app's `.env` files. */
  environment: Record<string, string>
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
 * Checks everything about a react-scripts app that is known before any process starts and refuses with the first gap the shared readiness judgement lists.
 *
 * Why it exists: `codebook_status` and the start must use one judgement (DX-9), so a start never runs an app status called not ready. Called by the adapter's `assertWorkspace` and `start`.
 * @param reactScriptsPackage - The app the run resolved.
 * @returns The installed `react-scripts` folder, the start script's assignments, the settled environment and the public path.
 * @throws `REACT_SCRIPTS_UNSUPPORTED` naming the first gap (`not-a-react-scripts-app`, `not-installed`, `react-scripts-version`, `start-script-not-react-scripts`, `prestart-script`, `https`).
 * @example const { installationDirectory } = await assessReactScriptsWorkspace(reactScriptsPackage)
 */
export async function assessReactScriptsWorkspace(
  reactScriptsPackage: ResolvedPackage,
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
  const { environment, homepage } = await readReactScriptsAppSettings(
    reactScriptsPackage.packageRoot,
    judgement.assignments,
  )
  // An HTTPS server cannot be observed over http://, so nothing starts.
  if (environment.HTTPS === 'true') throw reactScriptsHttpsRefusal()
  return {
    installationDirectory: judgement.installationDirectory,
    assignments: judgement.assignments,
    environment,
    publicPath: reactScriptsPublicPathOf(homepage, environment.PUBLIC_URL),
  }
}
