import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Says whether Node started the module with the given URL as the program, as opposed to another module importing it.
 *
 * Why: a script that also exports its functions for tests must do its work only when it is started directly, and must print nothing when a test imports it. `import.meta.main` would tell, but it needs Node 24.2 or later and the repository only requires Node 24; and a comparison of `import.meta.url` with the path on Node's command line fails when that path runs through a symbolic link (`/tmp` is one on macOS, where worktrees live).
 * Called once, at the entry point of such a script (`watch-background.mjs`, `refuse-closing-keywords.mjs`).
 *
 * It compares real paths on both sides, so a script reached through a link to the file, or through a link to a folder above it, still counts.
 *
 * @param importMetaUrl - The `import.meta.url` of the module that asks.
 * @returns `true` when the file named on Node's command line is that module; `false` when another module imported it, and when the program is no file (code from `node -e`, or from standard input as in `node -`).
 *
 * @example
 * ```js
 * // at the end of script.mjs
 * if (isRunAsScript(import.meta.url)) await main()
 * // `node script.mjs` and `node link-to-script.mjs` run main(); a test that imports script.mjs does not
 * ```
 */
export function isRunAsScript(importMetaUrl) {
  const entryPath = process.argv[1]
  if (entryPath === undefined) return false
  try {
    return (
      realpathSync(entryPath) === realpathSync(fileURLToPath(importMetaUrl))
    )
  } catch {
    // An entry that is not a file (`node -`), or a module whose file is gone, is not the program.
    return false
  }
}
