import { dirname } from 'node:path'

import { z } from 'zod'

import {
  REACT_SCRIPTS_SUPPORTED_MAJOR,
  REACT_SCRIPTS_VERSION_MAX_CHARS,
} from '../constants'

import { findPackageInsideRepository } from './findPackageInsideRepository'
import { isSemverLikeVersion } from './isSemverLikeVersion'
import {
  parseReactScriptsStartScript,
  type ReactScriptsStartScriptReadiness,
} from './parseReactScriptsStartScript'
import {
  manifestDeclaresReactScripts,
  reactScriptsManifestFieldsSchema,
} from './reactScriptsManifest'
import { readJsonInside } from './resolveNextPackage'
import { resolveReadinessFolders } from './resolveReadinessFolders'

export type { ReactScriptsStartScriptReadiness }

/** One reason a react-scripts app cannot start; the value `codebook_status` lists in `missing`. */
type ReactScriptsGap =
  | 'react-scripts-installed'
  | 'react-scripts-5'
  | 'start-script'
  | 'prestart-script'
  | 'not-a-react-scripts-app'

/** The facts a react-scripts app shows before any process starts, as `codebook_status` lists them for one app. */
export type ReactScriptsAppReadiness = {
  /** Whether `node_modules/react-scripts/package.json` resolves from the app folder upward, inside the repository. */
  installed: boolean
  /** What a start would decide on the app alone; the environment joins the shared prerequisites and a managed run. */
  ready: boolean
  /** The installed version, when it is a short semantic version. */
  version?: string
  /** The gaps, as {@link ReactScriptsGap} values (a read failure is a sentence). */
  missing: string[]
  startScript: ReactScriptsStartScriptReadiness
}

/** One react-scripts app below the repository root as `codebook_status` lists it (`packages[]`); see {@link discoverPackages}. */
export type ReactScriptsPackageReadiness = ReactScriptsAppReadiness & {
  /** The repository-relative folder: the exact value to declare as `packageRoot`. */
  packageRoot: string
}

/** What {@link readReactScriptsPackageReadiness} judged: the status facts plus what a start needs to launch. */
export type ReactScriptsPackageJudgement = {
  readiness: ReactScriptsAppReadiness
  /** The real folder of the installed react-scripts, when it is installed. */
  installationDirectory?: string
  /** Leading `NAME=value` assignments of an accepted `start` script. */
  assignments: Record<string, string>
}

const installedManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
})

/**
 * Finds the installed react-scripts of an app and reads its version, inside the repository only.
 * Called by {@link readReactScriptsPackageReadiness}.
 * @param appFolder - The app's real folder.
 * @param repositoryRoot - The repository's real root.
 * @returns The installed package's folder and version (absent when it is not a short semantic version), or `undefined` when it is not installed, resolves outside the repository, or is another package.
 * @example await findInstalledReactScripts('/repo/examples/counter', '/repo') // => { directory: '/repo/node_modules/react-scripts', version: '5.0.1' }
 */
async function findInstalledReactScripts(
  appFolder: string,
  repositoryRoot: string,
): Promise<{ directory: string; version?: string } | undefined> {
  const lookup = await findPackageInsideRepository(
    appFolder,
    repositoryRoot,
    'react-scripts',
  )
  if (!lookup.found) return undefined
  const directory = dirname(lookup.packagePath)
  const manifest = await readJsonInside(
    directory,
    'package.json',
    installedManifestSchema,
  )
  if (manifest?.name !== 'react-scripts') return undefined
  return isSemverLikeVersion(manifest.version, REACT_SCRIPTS_VERSION_MAX_CHARS)
    ? { directory, version: manifest.version }
    : { directory }
}

/**
 * Judges one react-scripts app: installed inside the repository, major 5, an accepted `start` script and no `prestart`.
 *
 * Why it exists: `codebook_status` and the adapter's start must use one judgement (DX-9), so the chat never starts an app status called not ready. A not-ready app is a typed gap list, never a throw. Called by {@link discoverPackages} for each listed app, by {@link readRepositoryAdapterReadiness} for the root app, and by the adapter's workspace assessment.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @returns The judgement; `missing` lists `not-a-react-scripts-app` for a folder whose manifest does not declare react-scripts or is unreadable, else `react-scripts-installed`, `react-scripts-5`, `start-script` and `prestart-script` as they apply.
 * @throws `INVALID_CONFIGURATION` when `packageRoot` is no folder inside the repository ({@link resolveReadinessFolders}).
 * @example await readReactScriptsPackageReadiness('/repo', 'examples/counter') // => { readiness: { installed: true, ready: true, version: '5.0.1', missing: [], startScript: { form: 'accepted' } }, installationDirectory: '/repo/node_modules/react-scripts', assignments: {} }
 */
export async function readReactScriptsPackageReadiness(
  repositoryRoot: string,
  packageRoot: string | undefined,
): Promise<ReactScriptsPackageJudgement> {
  const folders = await resolveReadinessFolders(
    repositoryRoot,
    packageRoot,
    'reactScripts',
  )
  const manifest = await readJsonInside(
    folders.packageRoot,
    'package.json',
    reactScriptsManifestFieldsSchema,
  )
  if (!manifestDeclaresReactScripts(manifest))
    return {
      readiness: {
        installed: false,
        ready: false,
        missing: ['not-a-react-scripts-app'],
        startScript: { form: 'absent' },
      },
      assignments: {},
    }
  const installation = await findInstalledReactScripts(
    folders.packageRoot,
    folders.repositoryRoot,
  )
  const start = parseReactScriptsStartScript(manifest?.scripts?.start)
  const missing: ReactScriptsGap[] = []
  if (!installation) missing.push('react-scripts-installed')
  // An installed react-scripts whose version cannot be read as a short semantic version cannot be shown to be major 5.
  else if (
    installation.version === undefined ||
    Number.parseInt(installation.version, 10) !== REACT_SCRIPTS_SUPPORTED_MAJOR
  )
    missing.push('react-scripts-5')
  if (start.readiness.form !== 'accepted') missing.push('start-script')
  // A start through start.js would skip a `prestart` script, so it is refused as Vite refuses `predev`.
  if (manifest?.scripts?.prestart !== undefined) missing.push('prestart-script')
  return {
    readiness: {
      installed: installation !== undefined,
      ready: missing.length === 0,
      ...(installation?.version === undefined
        ? {}
        : { version: installation.version }),
      missing,
      startScript: start.readiness,
    },
    ...(installation ? { installationDirectory: installation.directory } : {}),
    assignments: start.assignments,
  }
}
