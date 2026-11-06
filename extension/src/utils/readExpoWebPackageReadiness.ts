import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import {
  EXPO_VERSION_MAX_CHARS,
  EXPO_WEB_DEFAULT_PORT,
  EXPO_WEB_SUPPORTED_MAJOR,
} from '../constants'

import { findPackageInsideRepository } from './findPackageInsideRepository'
import { isSemverLikeVersion } from './isSemverLikeVersion'
import { manifestDeclaresExpo } from './manifestDeclaresPackage'
import {
  parseExpoWebScript,
  type ExpoWebScriptReading,
} from './parseExpoWebScript'
import { reactScriptsManifestFieldsSchema } from './reactScriptsManifest'
import { readJsonInside } from './resolveNextPackage'
import { resolveReadinessFolders } from './resolveReadinessFolders'

/** One reason an Expo app cannot start; the value `codebook_status` lists in `missing` (the words of `expoWebHelp()`'s status text). */
export const EXPO_WEB_GAPS = [
  'expo-installed',
  'expo-sdk',
  'web-dependencies',
  'web-platform',
  'dynamic-config',
  'server-output',
  'web-script',
  'pre-script',
  'not-an-expo-app',
] as const

/** One value of {@link EXPO_WEB_GAPS}. */
type ExpoWebGap = (typeof EXPO_WEB_GAPS)[number]

/** The facts an Expo app shows before any process starts, as `codebook_status` lists them for one app. */
export type ExpoWebAppReadiness = {
  /** Whether `node_modules/expo/package.json` resolves from the app folder upward, inside the repository. */
  installed: boolean
  /** What a start would decide on the app alone; the environment joins the shared prerequisites and a managed run. */
  ready: boolean
  /** The installed Expo version, when it is a short semantic version. */
  version?: string
  /** The gaps, as {@link ExpoWebGap} values (a read failure is a sentence). */
  missing: string[]
  /** The accepted web script (`scripts.web`, else `scripts.start`) with its assignment values hidden; absent when none is accepted. */
  webScript?: string
  /** The port the accepted web script declares (Expo's 8081 without `--port`); absent when no script is accepted. */
  port?: number
}

/** One Expo app below the repository root as `codebook_status` lists it (`packages[]`). */
export type ExpoWebPackageReadiness = ExpoWebAppReadiness & {
  /** The repository-relative folder: the exact value to declare as `packageRoot`. */
  packageRoot: string
}

/** What {@link readExpoWebPackageReadiness} judged: the status facts plus what a start needs to launch and to word a refusal. */
export type ExpoWebPackageJudgement = {
  readiness: ExpoWebAppReadiness
  /** The real folder of the installed `expo` package, when it is installed. */
  installationDirectory?: string
  /** The parsed web script, with its assignments and declared port. */
  script: ExpoWebScriptReading
  /** The name of a `preweb` or `prestart` script the app declares, which a start would skip. */
  preScript?: string
  /** The dynamic configuration file the app holds (`app.config.js` and its siblings). */
  dynamicConfigFile?: string
  /** The web dependencies that do not resolve from the app folder. */
  missingDependencies: string[]
}

/** The configuration files that make an app's Expo configuration dynamic: Expo would evaluate them, and Codebook never runs project code. */
const DYNAMIC_CONFIG_FILES = [
  'app.config.js',
  'app.config.ts',
  'app.config.mjs',
  'app.config.cjs',
] as const

/** The packages Expo's web build needs beside Expo itself. */
const WEB_DEPENDENCIES = ['react-dom', 'react-native-web'] as const

const installedManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
})

/** The `expo` section of an `app.json` (or the whole file, which Expo reads when there is no `expo` key), loosely: the fields the readiness judges. */
const appConfigSchema = z.looseObject({
  platforms: z.array(z.unknown()).optional(),
  web: z
    .looseObject({
      bundler: z.unknown().optional(),
      output: z.unknown().optional(),
    })
    .optional(),
})

/**
 * Finds the installed `expo` of an app and reads its version, inside the repository only.
 * Called by {@link readExpoWebPackageReadiness}.
 * @param appFolder - The app's real folder.
 * @param repositoryRoot - The repository's real root.
 * @returns The installed package's folder and version (absent when it is not a short semantic version), or `undefined` when it is not installed, resolves outside the repository, or is another package.
 * @example await findInstalledExpo('/repo/apps/app', '/repo') // => { directory: '/repo/apps/app/node_modules/expo', version: '57.0.25' }
 */
async function findInstalledExpo(
  appFolder: string,
  repositoryRoot: string,
): Promise<{ directory: string; version?: string } | undefined> {
  const lookup = await findPackageInsideRepository(
    appFolder,
    repositoryRoot,
    'expo',
  )
  if (!lookup.found) return undefined
  const directory = dirname(lookup.packagePath)
  const manifest = await readJsonInside(
    directory,
    'package.json',
    installedManifestSchema,
  )
  if (manifest?.name !== 'expo') return undefined
  return isSemverLikeVersion(manifest.version, EXPO_VERSION_MAX_CHARS)
    ? { directory, version: manifest.version }
    : { directory }
}

/**
 * Finds the first dynamic configuration file the app folder holds.
 * @param appFolder - The app's real folder.
 * @returns The file name, or `undefined` when the app has none.
 * @example await findDynamicConfigFile('/repo/apps/app') // => 'app.config.js'
 */
async function findDynamicConfigFile(
  appFolder: string,
): Promise<string | undefined> {
  for (const name of DYNAMIC_CONFIG_FILES)
    if (
      await lstat(join(appFolder, name)).then(
        () => true,
        () => false,
      )
    )
      return name
  return undefined
}

/**
 * Judges the web platform of an app from its static `app.json`: a platform list without `web` or a bundler other than `metro` is a gap, and `expo.web.output: "server"` is another.
 * @param appFolder - The app's real folder.
 * @returns The gaps the file shows; none for a missing or unreadable `app.json` (Expo's defaults include the web platform with Metro).
 * @example await readAppJsonGaps('/repo/apps/app') // => ['web-platform']
 */
async function readAppJsonGaps(appFolder: string): Promise<ExpoWebGap[]> {
  const file = await readJsonInside(appFolder, 'app.json', z.unknown())
  const section =
    typeof file === 'object' && file !== null && 'expo' in file
      ? file.expo
      : file
  const config = appConfigSchema.safeParse(section)
  if (!config.success) return []
  const { platforms, web } = config.data
  const gaps: ExpoWebGap[] = []
  // A platform list that omits web, or a bundler that is not Metro, leaves no web build to observe.
  if (
    (platforms !== undefined && !platforms.includes('web')) ||
    (web?.bundler !== undefined && web.bundler !== 'metro')
  )
    gaps.push('web-platform')
  if (web?.output === 'server') gaps.push('server-output')
  return gaps
}

/**
 * Renders an accepted web script for `codebook_status` without any assignment value.
 * @param script - The script reading of an accepted script.
 * @returns For example `NAME=… expo start --web --port 4101`.
 * @example describeAcceptedScript({ readiness: { form: 'accepted' }, assignments: { A: 'x' }, port: 4101 }) // => 'A=… expo start --web --port 4101'
 */
function describeAcceptedScript(script: ExpoWebScriptReading): string {
  const assignments = Object.keys(script.assignments).map((name) => `${name}=…`)
  const port = script.port === undefined ? [] : ['--port', String(script.port)]
  return [...assignments, 'expo', 'start', '--web', ...port].join(' ')
}

/**
 * Names the pre-script a start through the Expo CLI would skip: `preweb`, or `prestart` when `start` is the script used (no `web` script).
 * @param scripts - The manifest's `scripts` section, if any.
 * @returns The script name, or `undefined` when the app declares none.
 * @example preScriptOf({ start: 'expo start --web', prestart: 'echo' }) // => 'prestart'
 */
function preScriptOf(
  scripts: Record<string, unknown> | undefined,
): 'preweb' | 'prestart' | undefined {
  if (scripts?.preweb !== undefined) return 'preweb'
  const usesStartScript = scripts?.web === undefined
  return usesStartScript && scripts?.prestart !== undefined
    ? 'prestart'
    : undefined
}

/**
 * Lists the web dependencies that do not resolve from the app folder, inside the repository.
 * @param appFolder - The app's real folder.
 * @param repositoryRoot - The repository's real root.
 * @returns The missing package names; empty when both resolve.
 * @example await findMissingWebDependencies('/repo/apps/app', '/repo') // => ['react-native-web']
 */
async function findMissingWebDependencies(
  appFolder: string,
  repositoryRoot: string,
): Promise<string[]> {
  const lookups = await Promise.all(
    WEB_DEPENDENCIES.map((name) =>
      findPackageInsideRepository(appFolder, repositoryRoot, name),
    ),
  )
  return WEB_DEPENDENCIES.filter((_, index) => !lookups[index]!.found)
}

/**
 * Orders the gaps of an app in the order a start refuses them.
 * @param facts - What the judgement found.
 * @returns The {@link ExpoWebGap} values that apply.
 * @example listExpoWebGaps({ installation: undefined, dynamicConfigFile: undefined, appJsonGaps: [], missingDependencies: [], isScriptAccepted: true, preScript: undefined }) // => ['expo-installed']
 */
function listExpoWebGaps(facts: {
  installation: { version?: string } | undefined
  dynamicConfigFile: string | undefined
  appJsonGaps: readonly ExpoWebGap[]
  missingDependencies: readonly string[]
  isScriptAccepted: boolean
  preScript: string | undefined
}): ExpoWebGap[] {
  const { installation } = facts
  // An installed Expo whose version is unreadable cannot be shown to be SDK 57.
  const isSupportedSdk =
    Number.parseInt(installation?.version ?? '', 10) ===
    EXPO_WEB_SUPPORTED_MAJOR
  return [
    ...(installation ? [] : (['expo-installed'] as const)),
    ...(installation && !isSupportedSdk ? (['expo-sdk'] as const) : []),
    ...(facts.dynamicConfigFile === undefined
      ? []
      : (['dynamic-config'] as const)),
    ...facts.appJsonGaps,
    ...(facts.missingDependencies.length > 0
      ? (['web-dependencies'] as const)
      : []),
    ...(facts.isScriptAccepted ? [] : (['web-script'] as const)),
    ...(facts.preScript === undefined ? [] : (['pre-script'] as const)),
  ]
}

/**
 * Judges one Expo app: installed inside the repository, SDK 57, static `app.json` with a Metro web platform, an accepted web script and no pre-script.
 *
 * Why it exists: `codebook_status` and the adapter's start must use one judgement, so the chat never starts an app status called not ready (DX-2, E-5). A not-ready app is a typed gap list, never a throw; nothing is executed (a dynamic configuration is a gap, never evaluated, E-14). Called by the discovery for each listed app, by the status for the root app and by the adapter's workspace assessment.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @returns The judgement; `missing` lists `not-an-expo-app` for a folder whose manifest does not declare expo, else the gaps that apply, in the order a start refuses them.
 * @throws `INVALID_CONFIGURATION` when `packageRoot` is no folder inside the repository ({@link resolveReadinessFolders}).
 * @example await readExpoWebPackageReadiness('/repo', 'apps/app') // => { readiness: { installed: true, ready: true, version: '57.0.25', missing: [], webScript: 'expo start --web --port 4101', port: 4101 }, … }
 */
export async function readExpoWebPackageReadiness(
  repositoryRoot: string,
  packageRoot: string | undefined,
): Promise<ExpoWebPackageJudgement> {
  const folders = await resolveReadinessFolders(
    repositoryRoot,
    packageRoot,
    'expoWeb',
  )
  const manifest = await readJsonInside(
    folders.packageRoot,
    'package.json',
    reactScriptsManifestFieldsSchema,
  )
  const script = parseExpoWebScript(
    manifest?.scripts?.web ?? manifest?.scripts?.start,
  )
  if (!manifestDeclaresExpo(manifest))
    return {
      readiness: {
        installed: false,
        ready: false,
        missing: ['not-an-expo-app'],
      },
      script,
      missingDependencies: [],
    }
  const [installation, dynamicConfigFile, appJsonGaps, missingDependencies] =
    await Promise.all([
      findInstalledExpo(folders.packageRoot, folders.repositoryRoot),
      findDynamicConfigFile(folders.packageRoot),
      readAppJsonGaps(folders.packageRoot),
      findMissingWebDependencies(folders.packageRoot, folders.repositoryRoot),
    ])
  const preScript = preScriptOf(manifest?.scripts)
  const isAccepted = script.readiness.form === 'accepted'
  const missing: string[] = listExpoWebGaps({
    installation,
    dynamicConfigFile,
    appJsonGaps,
    missingDependencies,
    isScriptAccepted: isAccepted,
    preScript,
  })
  return {
    readiness: {
      installed: installation !== undefined,
      ready: missing.length === 0,
      ...(installation?.version === undefined
        ? {}
        : { version: installation.version }),
      missing,
      ...(isAccepted
        ? {
            webScript: describeAcceptedScript(script),
            port: script.port ?? EXPO_WEB_DEFAULT_PORT,
          }
        : {}),
    },
    ...(installation ? { installationDirectory: installation.directory } : {}),
    script,
    ...(preScript === undefined ? {} : { preScript }),
    ...(dynamicConfigFile === undefined ? {} : { dynamicConfigFile }),
    missingDependencies,
  }
}
