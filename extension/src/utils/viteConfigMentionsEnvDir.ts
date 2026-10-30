import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  VITE_CONFIG_SOURCE_LIMIT_BYTES,
  VITE_DEFAULT_CONFIG_FILE_NAMES,
} from '../constants'

/**
 * Tells whether the project's Vite config file names `envDir`, without evaluating the config.
 *
 * Why it exists: a config that throws before it resolves never reports its `envDir`, so the launcher cannot know which folder's env files to mask. Reading the config's source text answers whether that folder may differ from the package root. Called by the Vite launcher (`viteLauncher.ts`) when the config failed before it resolved.
 * It is deliberately conservative: a comment or an unrelated word `envDir` also counts, and a file over {@link VITE_CONFIG_SOURCE_LIMIT_BYTES} counts as mentioning it.
 *
 * @param root - The package root.
 * @param configFile - The dev script's `--config`, relative to the root; the default config names are tried when it is absent.
 * @returns `true` when a config file that exists names `envDir` (or is too large to read); `false` otherwise, including when no file can be read.
 * @example
 * viteConfigMentionsEnvDir('/repo', undefined) // => true when /repo/vite.config.ts has `envDir: '../env'`
 */
export function viteConfigMentionsEnvDir(
  root: string,
  configFile: string | undefined,
): boolean {
  const candidates = configFile
    ? [configFile]
    : [...VITE_DEFAULT_CONFIG_FILE_NAMES]
  for (const name of candidates) {
    const path = resolve(root, name)
    try {
      // A file too large to read cannot be shown free of the key.
      if (statSync(path).size > VITE_CONFIG_SOURCE_LIMIT_BYTES) return true
      if (/\benvDir\b/.test(readFileSync(path, 'utf8'))) return true
    } catch {
      // A missing or unreadable candidate says nothing; the next one is tried.
    }
  }
  return false
}
