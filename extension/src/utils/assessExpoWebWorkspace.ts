import { join } from 'node:path'

import { EXPO_WEB_DEFAULT_PORT } from '../constants'
import type { StudyError } from '../errors'
import {
  expoWebDependenciesRefusal,
  expoWebDynamicConfigRefusal,
  expoWebEnvFileRefusal,
  expoWebNoPlatformRefusal,
  expoWebNotAppRefusal,
  expoWebNotInstalledRefusal,
  expoWebPreScriptRefusal,
  expoWebScriptFormRefusal,
  expoWebServerOutputRefusal,
  expoWebVersionRefusal,
} from '../expoWebRefusals'

import { buildExpoWebEnvironment } from './expoWebChildEnvironment'
import { parseExpoEnvText } from './parseExpoEnvText'
import {
  readExpoWebPackageReadiness,
  type ExpoWebPackageJudgement,
} from './readExpoWebPackageReadiness'
import { readInstallLockfileNames } from './readInstallLockfileNames'
import { loadEnvFiles } from './readReactScriptsAppSettings'
import type { EnvFileReadPolicy } from './readReactScriptsEnvFile'
import type { ResolvedPackage } from './resolveNextPackage'

/** What an app that can run on `expo-web-dev` provides. */
export type ExpoWebWorkspace = {
  /** The installed `expo` folder; its `bin/cli` is what runs. */
  installationDirectory: string
  /** The installed Expo version, a short semantic version (SDK 57 is judged from it). */
  version: string
  /** The leading `NAME=value` assignments of the accepted web script. */
  assignments: Record<string, string>
  /** The port the web script declares, else Expo's default. */
  port: number
  /** Where the port was declared, for the run resource. */
  portSource: string
  /** The environment the Expo CLI settles: the child's own environment with the app's `.env` files loaded and expanded over it; the mask list is built from it. */
  environment: Record<string, string>
}

/** The Expo policy for `.env` files (E-16): a missing file is none, but an existing one that cannot be opened or read is refused, because Expo would still read it and its `EXPO_PUBLIC_*` values could not be masked. */
const EXPO_ENV_FILE_POLICY: EnvFileReadPolicy = {
  refuseUnreadable: true,
  refusal: expoWebEnvFileRefusal,
}

/**
 * Words the refusal of the first gap the shared readiness judgement lists, in the order a start refuses them.
 * Called by {@link assessExpoWebWorkspace}.
 * @param judgement - A not-ready judgement of {@link readExpoWebPackageReadiness}.
 * @param appFolder - The app's folder, read (with its parents up to the repository root) for the lockfile that picks the install command.
 * @param repositoryRoot - The repository root the lockfile search stops at.
 * @param packageRootRelative - The app's canonical repository-relative folder.
 * @returns The refusal to throw.
 * @example await refusalOfGaps(judgement, '/repo/apps/app', 'apps/app') // => StudyError EXPO_WEB_UNSUPPORTED (reason "dynamic-config")
 */
async function refusalOfGaps(
  judgement: ExpoWebPackageJudgement,
  appFolder: string,
  repositoryRoot: string,
  packageRootRelative: string,
): Promise<StudyError> {
  const { readiness, script } = judgement
  const has = (gap: string): boolean => readiness.missing.includes(gap)
  if (has('not-an-expo-app')) return expoWebNotAppRefusal(packageRootRelative)
  if (has('expo-installed'))
    return expoWebNotInstalledRefusal(
      await readInstallLockfileNames(appFolder, repositoryRoot),
    )
  // An unreadable version is passed as `undefined`; the refusal builder words that case itself.
  if (has('expo-sdk')) return expoWebVersionRefusal(readiness.version)
  if (has('dynamic-config'))
    return expoWebDynamicConfigRefusal(
      judgement.dynamicConfigFile ?? 'app.config.js',
    )
  if (has('web-platform')) return expoWebNoPlatformRefusal()
  if (has('server-output')) return expoWebServerOutputRefusal()
  if (has('web-dependencies'))
    return expoWebDependenciesRefusal(judgement.missingDependencies)
  if (has('web-script'))
    // Structural descriptions only: a script's assignment values never reach the refusal.
    return expoWebScriptFormRefusal(
      script.readiness.form === 'refused'
        ? script.readiness.refused.join('; ')
        : '(none)',
    )
  return expoWebPreScriptRefusal(judgement.preScript ?? 'preweb')
}

/**
 * Settles the environment the Expo CLI sees: its own environment with the app's `.env` files loaded and expanded over it, in Expo's development load order.
 * @param appRoot - The app's folder.
 * @param assignments - The accepted web script's assignments; with Codebook's own values they are the process environment, which `.env` never overrides.
 * @returns The settled names and values.
 * @throws `EXPO_WEB_UNSUPPORTED` (`env-file-unreadable`) for an `.env` file Codebook cannot read, over the limit, not a regular file, or whose values expand past Codebook's bounds.
 * @example await settleExpoWebEnvironment('/app', {}) // => { CI: '1', EXPO_PUBLIC_API: 'http://localhost:4100', … }
 */
async function settleExpoWebEnvironment(
  appRoot: string,
  assignments: Record<string, string>,
): Promise<Record<string, string>> {
  const environment = new Map<string, string>()
  for (const [name, value] of Object.entries(
    buildExpoWebEnvironment(assignments),
  ))
    if (value !== undefined) environment.set(name, value)
  // Expo starts in development, so a reference to NODE_ENV settles to it.
  environment.set('NODE_ENV', 'development')
  // Expo reads `.env` with dotenv 16 (@expo/env), not react-scripts' dotenv 10.
  await loadEnvFiles(
    appRoot,
    environment,
    EXPO_ENV_FILE_POLICY,
    parseExpoEnvText,
  )
  return Object.fromEntries(environment)
}

/**
 * Checks everything about an Expo app that is known before any process starts and refuses with the first gap the shared readiness judgement lists; nothing is executed.
 *
 * Why it exists: `codebook_status` and the start must use one judgement (DX-2), so a start never runs an app status called not ready; and no project code runs before the start (E-5, E-14). Called by the adapter's `assertWorkspace` and `start`.
 * @param expoPackage - The app the run resolved.
 * @returns The installed `expo` folder and version, the web script's assignments and port, and the settled environment.
 * @throws `EXPO_WEB_UNSUPPORTED` naming the first gap (`not-an-expo-app`, `not-installed`, `expo-version`, `dynamic-config`, `no-web-platform`, `server-output`, `web-dependencies`, `web-script-form`, `pre-script`, `env-file-unreadable`).
 * @example const { installationDirectory } = await assessExpoWebWorkspace(expoPackage)
 */
export async function assessExpoWebWorkspace(
  expoPackage: ResolvedPackage,
): Promise<ExpoWebWorkspace> {
  const judgement = await readExpoWebPackageReadiness(
    expoPackage.repositoryRoot,
    expoPackage.isRoot ? undefined : expoPackage.packageRootRelative,
  )
  const { readiness, installationDirectory, script } = judgement
  if (
    !readiness.ready ||
    installationDirectory === undefined ||
    readiness.version === undefined
  )
    throw await refusalOfGaps(
      judgement,
      expoPackage.packageRoot,
      expoPackage.repositoryRoot,
      expoPackage.packageRootRelative,
    )
  return {
    installationDirectory,
    version: readiness.version,
    assignments: script.assignments,
    port: script.port ?? EXPO_WEB_DEFAULT_PORT,
    portSource:
      script.port === undefined
        ? "Expo's default port"
        : 'the web script --port',
    environment: await settleExpoWebEnvironment(
      expoPackage.packageRoot,
      script.assignments,
    ),
  }
}

/** The path of the Expo CLI inside an installed `expo` folder; the file the adapter runs on Codebook's Node. @example expoWebCliPath('/app/node_modules/expo') // => '/app/node_modules/expo/bin/cli' */
export function expoWebCliPath(installationDirectory: string): string {
  return join(installationDirectory, 'bin/cli')
}
