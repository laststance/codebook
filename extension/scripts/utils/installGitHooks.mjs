import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** First-line marker that identifies a pre-commit hook this installer owns, so reinstalling may replace it. */
export const PRE_COMMIT_HOOK_MARKER = '# codebook-lint-staged-hook'

/** Shared hook body: every worktree runs it, so a checkout without this tooling installed skips it instead of failing. */
export const PRE_COMMIT_HOOK = `#!/bin/sh
${PRE_COMMIT_HOOK_MARKER} (installed by extension/scripts/install-git-hooks.mjs)
# Git runs this for every worktree; a checkout without lint-staged installed commits unchanged.
root=$(git rev-parse --show-toplevel) || exit 0
bin="$root/extension/node_modules/.bin/lint-staged"
[ -x "$bin" ] || exit 0
cd "$root/extension" && exec "$bin"
`

/**
 * Installs the lint-staged pre-commit hook in the repository's shared Git hooks directory.
 *
 * `pnpm install` runs it through the `prepare` script. It never sets `core.hooksPath`, which Git shares
 * across linked worktrees: pointing it at a branch-local directory would silently disable every existing
 * hook (such as a pre-push redaction guard) in worktrees whose checkout lacks that directory.
 *
 * @param options.cwd - Directory inside the repository; defaults to the current directory.
 * @param options.env - Environment to read `CI` and `CODEBOOK_SKIP_GIT_HOOKS` from.
 * @returns
 * - `'installed'` when the hook was written or refreshed
 * - `'skipped-ci'` in CI or when `CODEBOOK_SKIP_GIT_HOOKS=1`
 * - `'skipped-no-git'` outside a Git checkout (for example an unpacked archive)
 * - `'skipped-hooks-path'` when `core.hooksPath` is set, so another hook manager owns the hooks
 * - `'skipped-foreign-hook'` when a pre-commit hook this installer does not own already exists
 * @example
 * ```js
 * await installGitHooks({ cwd: '/repo/extension' }) // => 'installed'
 * ```
 */
export async function installGitHooks({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (env.CI || env.CODEBOOK_SKIP_GIT_HOOKS === '1') return 'skipped-ci'
  const location = await locateSharedHooks(cwd)
  if (location.skipped) return location.skipped
  return writeOwnedPreCommit(location.directory)
}

/**
 * Finds the hooks directory every worktree of the repository shares, for {@link installGitHooks}.
 * @param cwd - Directory inside the repository.
 * @returns
 * - `{ directory }` for the common Git directory's `hooks/`
 * - `{ skipped: 'skipped-no-git' }` outside a Git checkout
 * - `{ skipped: 'skipped-hooks-path' }` when `core.hooksPath` is set, so another hook manager owns the hooks
 * @example
 * ```js
 * await locateSharedHooks('/repo/extension') // => { directory: '/repo/.git/hooks' }
 * ```
 */
async function locateSharedHooks(cwd) {
  const commonDirectory = await readGit(cwd, ['rev-parse', '--git-common-dir'])
  if (!commonDirectory) return { skipped: 'skipped-no-git' }
  // A configured hooks path belongs to another manager; installing beside it would never run.
  if (await readGit(cwd, ['config', '--get', 'core.hooksPath']))
    return { skipped: 'skipped-hooks-path' }
  return { directory: join(resolve(cwd, commonDirectory), 'hooks') }
}

/**
 * Writes {@link PRE_COMMIT_HOOK} unless a pre-commit hook this installer does not own already exists.
 * @param hooksDirectory - Shared hooks directory from {@link locateSharedHooks}.
 * @returns `'installed'`, or `'skipped-foreign-hook'` when another hook was left unchanged.
 * @example
 * ```js
 * await writeOwnedPreCommit('/repo/.git/hooks') // => 'installed'
 * ```
 */
async function writeOwnedPreCommit(hooksDirectory) {
  const target = join(hooksDirectory, 'pre-commit')
  const existing = await readFile(target, 'utf8').catch(() => undefined)
  // Never replace a learner's or another tool's pre-commit hook.
  if (existing !== undefined && !existing.includes(PRE_COMMIT_HOOK_MARKER))
    return 'skipped-foreign-hook'
  await mkdir(hooksDirectory, { recursive: true })
  await writeFile(target, PRE_COMMIT_HOOK)
  await chmod(target, 0o755)
  return 'installed'
}

/**
 * Reads one Git value for {@link locateSharedHooks}.
 * @param cwd - Directory inside the repository.
 * @param args - Git arguments that print one value.
 * @returns The trimmed output, or `''` when Git fails (outside a checkout, or an unset config key).
 * @example
 * ```js
 * await readGit('/repo', ['config', '--get', 'core.hooksPath']) // => ''
 * ```
 */
async function readGit(cwd, args) {
  return run('git', args, { cwd }).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  )
}
