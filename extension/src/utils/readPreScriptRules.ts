import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_BUN_LOCKFILES,
  DEVELOPMENT_PNPM_PRE_SCRIPTS_DEFAULT_MAJOR,
  DEVELOPMENT_YARN_BERRY_MIN_MAJOR,
  DEVELOPMENT_YARN_LOCKFILE_HEAD_BYTES,
} from '../constants'

import { readProjectFile } from './readDeclaredDevelopmentPort'

/** Whether a package manager runs a script's `pre<name>` script before it: `runs`, `skips`, or `unknown` when Codebook cannot tell which manager (or which version of it) runs the script. */
export type PreScriptRun = 'runs' | 'skips' | 'unknown'

/** What runs a project's pre scripts, read by {@link readPreScriptRules}. */
export type PreScriptRules = {
  /** The project's own package manager, which runs `scripts.dev` and its `predev` when the learner starts the app. */
  project: PreScriptRun
  /** The rule of each manager a delegation names (`npm run x`, `pnpm x`, `yarn x`, `bun run x`), by its program name. */
  byManager: ReadonlyMap<string, PreScriptRun>
}

/** A package manager whose pre-script rule Codebook models. */
type ScriptManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** A Corepack `packageManager` value of a modeled manager: `<name>@<major>.<minor>.<patch>`, with an optional prerelease or `+sha…` hash. */
const PACKAGE_MANAGER_FIELD =
  /^(npm|pnpm|yarn|bun)@(\d+)\.\d+\.\d+(?:[-+][\w.+-]*)?$/

/** The `.npmrc` line that turns pnpm 7 and 8's pre scripts on; the first `.npmrc` (nearest folder first) that sets the key decides. */
const PNPM_PRE_POST_SETTING =
  /^[ \t]*enable-pre-post-scripts[ \t]*=[ \t]*(\S*)/m

/** The key Yarn 2 and later write into `yarn.lock` and Yarn 1 never does. */
const YARN_BERRY_LOCKFILE_KEY = /^__metadata:/m

/** The lockfiles that name a project's package manager when `package.json` declares none. */
const LOCKFILE_MANAGERS: ReadonlyMap<string, ScriptManager> = new Map([
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ...DEVELOPMENT_BUN_LOCKFILES.map((name) => [name, 'bun'] as const),
])

/**
 * Reads whether the project's package managers run a script's `pre<name>` script, so the skipped preparation counts only what the learner's own start runs.
 * Called by {@link readNextDevPreparation} once per read. npm, Yarn 1 and Bun run pre scripts; pnpm 9 and later run them by default (pnpm 7 and 8 only with `enable-pre-post-scripts=true` in an `.npmrc`); Yarn 2 and later never do. The project's manager is read from `packageManager`, else from the one lockfile kind in the nearest folder of `folders` that holds one; no field and no lockfile, several lockfile kinds, or a field Codebook does not read leave it `unknown`. Only those files are read: no other configuration, environment or global setting.
 * @param folders - The folders a project marker is searched in, the opened one first ({@link projectMarkerFolders}).
 * @param packageManager - The `packageManager` field of the opened `package.json`, if any.
 * @returns The project's rule and each delegating manager's rule:
 * - npm and Bun: `runs`
 * - pnpm: `runs` for a declared major of 9 or more or with the `.npmrc` setting, `skips` for a declared older major without it, else `unknown`
 * - Yarn: `runs` for Yarn 1, `skips` for Yarn 2 and later, read from a declared `yarn@` or from the nearest `yarn.lock` (`__metadata:` marks Yarn 2 and later), else `unknown`
 * @example
 * await readPreScriptRules(['/repo'], 'pnpm@8.15.9') // => { project: 'skips', byManager: Map { 'npm' => 'runs', 'pnpm' => 'skips', 'yarn' => 'unknown', 'bun' => 'runs' } }
 * await readPreScriptRules(['/repo'], undefined)     // => { project: 'unknown', … } when /repo holds no lockfile
 */
export async function readPreScriptRules(
  folders: readonly string[],
  packageManager: unknown,
): Promise<PreScriptRules> {
  const declared = declaredManagerOf(packageManager)
  const lockfiles = await nearestLockfiles(folders)
  const byManager = new Map<ScriptManager, PreScriptRun>([
    ['npm', 'runs'],
    ['pnpm', pnpmRule(declared, await pnpmPreScriptsSetting(folders))],
    ['yarn', await yarnRule(declared, lockfiles)],
    ['bun', 'runs'],
  ])
  return { project: projectRule(declared, lockfiles, byManager), byManager }
}

/**
 * Reads a declared `packageManager` value of a modeled manager; called by {@link readPreScriptRules}.
 * @param packageManager - The field's value.
 * @returns
 * - `undefined` when the field is absent
 * - `{ name, major }` for a value of a modeled manager
 * - `'unread'` for a value of another manager or another form
 * @example
 * declaredManagerOf('yarn@4.5.0+sha224.abc') // => { name: 'yarn', major: 4 }
 * declaredManagerOf('pnpm@latest')           // => 'unread'
 */
function declaredManagerOf(
  packageManager: unknown,
): { name: ScriptManager; major: number } | 'unread' | undefined {
  if (packageManager === undefined) return undefined
  if (typeof packageManager !== 'string') return 'unread'
  const match = PACKAGE_MANAGER_FIELD.exec(packageManager)
  const name = managerNamed(match?.[1])
  return match && name ? { name, major: Number(match[2]) } : 'unread'
}

/**
 * Names the modeled manager a field's name part names; called by {@link declaredManagerOf}.
 * @param name - The name before the `@`.
 * @returns The manager, or `undefined` for any other name.
 * @example
 * managerNamed('pnpm') // => 'pnpm'
 */
function managerNamed(name: string | undefined): ScriptManager | undefined {
  return [...LOCKFILE_MANAGERS.values()].find((manager) => manager === name)
}

/**
 * Finds the lockfiles of the nearest folder that holds any, the opened folder first; called by {@link readPreScriptRules}.
 * @param folders - The folders from {@link projectMarkerFolders}.
 * @returns The folder and the lockfile names it holds, or `undefined` when no folder holds one.
 * @example
 * await nearestLockfiles(['/repo/apps/web', '/repo']) // => { folder: '/repo', names: ['pnpm-lock.yaml'] }
 */
async function nearestLockfiles(
  folders: readonly string[],
): Promise<{ folder: string; names: string[] } | undefined> {
  for (const folder of folders) {
    const names: string[] = []
    for (const name of LOCKFILE_MANAGERS.keys())
      if (await isRegularFile(join(folder, name))) names.push(name)
    // The nearest folder with a lockfile decides, as the package manager finds its project there.
    if (names.length) return { folder, names }
  }
  return undefined
}

/**
 * Reads what an `.npmrc` says about pnpm's pre scripts, so an explicit setting can override pnpm's default for its version; called by {@link readPreScriptRules}.
 * @param folders - The folders from {@link projectMarkerFolders}, the opened one first.
 * @returns
 * - `true` or `false` as the first `.npmrc` that sets `enable-pre-post-scripts` sets it (any value other than `true` reads as `false`)
 * - `undefined` when no `.npmrc` sets it
 * @example
 * await pnpmPreScriptsSetting(['/repo']) // => false for an .npmrc line "enable-pre-post-scripts=false"
 */
async function pnpmPreScriptsSetting(
  folders: readonly string[],
): Promise<boolean | undefined> {
  for (const folder of folders) {
    const text = await readProjectFile(join(folder, '.npmrc'))
    const value =
      typeof text === 'string'
        ? PNPM_PRE_POST_SETTING.exec(text)?.[1]
        : undefined
    // A nearer `.npmrc` that sets the key wins over one further up.
    if (value !== undefined) return value === 'true'
  }
  return undefined
}

/**
 * Gives pnpm's pre-script rule: an explicit `.npmrc` setting decides; without one, on by default since pnpm 9 and off in pnpm 7 and 8; called by {@link readPreScriptRules}.
 * @param declared - The declared manager ({@link declaredManagerOf}).
 * @param setting - What an `.npmrc` sets for `enable-pre-post-scripts` ({@link pnpmPreScriptsSetting}), `undefined` when none does.
 * @returns `runs` with the setting on, `skips` with it off; otherwise `runs` for a declared pnpm 9 or later, `skips` for a declared older pnpm, `unknown` when no pnpm version is declared.
 * @example
 * pnpmRule({ name: 'pnpm', major: 9 }, false)     // => 'skips' (an explicit setting wins over the version default)
 * pnpmRule({ name: 'pnpm', major: 8 }, undefined) // => 'skips'
 * pnpmRule(undefined, undefined)                  // => 'unknown' (a pnpm-lock.yaml alone does not tell pnpm 8 from pnpm 9)
 */
function pnpmRule(
  declared: ReturnType<typeof declaredManagerOf>,
  setting: boolean | undefined,
): PreScriptRun {
  // An explicit `.npmrc` setting decides whatever pnpm's default for its version is.
  if (setting !== undefined) return setting ? 'runs' : 'skips'
  if (typeof declared !== 'object' || declared.name !== 'pnpm') return 'unknown'
  return declared.major >= DEVELOPMENT_PNPM_PRE_SCRIPTS_DEFAULT_MAJOR
    ? 'runs'
    : 'skips'
}

/**
 * Reads Yarn's pre-script rule: from a declared `yarn@` major, else from the nearest `yarn.lock`; called by {@link readPreScriptRules}.
 * @param declared - The declared manager ({@link declaredManagerOf}).
 * @param lockfiles - The nearest lockfiles ({@link nearestLockfiles}).
 * @returns `runs` for Yarn 1, `skips` for Yarn 2 and later, `unknown` when neither tells the version.
 * @example
 * await yarnRule(undefined, { folder: '/repo', names: ['yarn.lock'] }) // => 'skips' for a lockfile with "__metadata:"
 */
async function yarnRule(
  declared: ReturnType<typeof declaredManagerOf>,
  lockfiles: Awaited<ReturnType<typeof nearestLockfiles>>,
): Promise<PreScriptRun> {
  if (typeof declared === 'object' && declared.name === 'yarn')
    return declared.major >= DEVELOPMENT_YARN_BERRY_MIN_MAJOR ? 'skips' : 'runs'
  if (!lockfiles?.names.includes('yarn.lock')) return 'unknown'
  const head = await readFileHead(
    join(lockfiles.folder, 'yarn.lock'),
    DEVELOPMENT_YARN_LOCKFILE_HEAD_BYTES,
  )
  if (head === undefined) return 'unknown'
  return YARN_BERRY_LOCKFILE_KEY.test(head) ? 'skips' : 'runs'
}

/**
 * Chooses the project's own rule: the declared manager's, else the one lockfile kind's, else `unknown`; called by {@link readPreScriptRules}.
 * @param declared - The declared manager ({@link declaredManagerOf}).
 * @param lockfiles - The nearest lockfiles ({@link nearestLockfiles}).
 * @param byManager - Each manager's rule.
 * @returns The rule of the manager that runs `scripts.dev`.
 * @example
 * projectRule(undefined, { folder: '/repo', names: ['package-lock.json'] }, byManager) // => 'runs'
 */
function projectRule(
  declared: ReturnType<typeof declaredManagerOf>,
  lockfiles: Awaited<ReturnType<typeof nearestLockfiles>>,
  byManager: ReadonlyMap<ScriptManager, PreScriptRun>,
): PreScriptRun {
  if (declared === 'unread') return 'unknown'
  if (declared) return byManager.get(declared.name) ?? 'unknown'
  const managers = new Set(
    (lockfiles?.names ?? []).map((name) => LOCKFILE_MANAGERS.get(name)),
  )
  // Lockfiles of several managers (or none) leave the manager unknown.
  if (managers.size !== 1) return 'unknown'
  const [manager] = managers
  return manager ? (byManager.get(manager) ?? 'unknown') : 'unknown'
}

/**
 * Tells whether a path is a regular file; a folder, FIFO or missing path is not. Called by {@link nearestLockfiles}.
 * @param path - An absolute path.
 * @returns Whether it is a regular file.
 * @example
 * await isRegularFile('/repo/yarn.lock') // => true
 */
async function isRegularFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  )
}

/**
 * Reads at most the first bytes of a regular file as text; a large lockfile is never read whole. Called by {@link yarnRule}.
 * @param path - An absolute path.
 * @param limitBytes - The most bytes read.
 * @returns The text of the first bytes, or `undefined` when the path is no regular file or cannot be read.
 * @example
 * await readFileHead('/repo/yarn.lock', 4096) // => '# This file is generated by running "yarn install" …'
 */
async function readFileHead(
  path: string,
  limitBytes: number,
): Promise<string | undefined> {
  // A FIFO or device is never opened: an open of one blocks and cannot be cancelled.
  if (!(await isRegularFile(path))) return undefined
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return undefined
  try {
    const buffer = Buffer.alloc(limitBytes)
    const { bytesRead } = await handle.read(buffer, 0, limitBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return undefined
  } finally {
    await handle.close()
  }
}
