import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

/**
 * Lists the variable names the env files of a mode define, parsed with Node's dotenv parser.
 *
 * Why it exists: Vite's `loadEnv(mode, dir, '')` also returns every `process.env` entry, so the values of the env files cannot be told from `HOME` or `PATH`. The names the files define tell which of `loadEnv`'s (expanded) values to keep. Called by the Vite launcher (`viteLauncher.ts`) to learn the values to mask.
 * It reads the four files Vite reads in `envDir`: `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local`.
 *
 * @param envDir - The folder Vite loads env files from.
 * @param mode - The Vite mode.
 * @returns The distinct names the existing files define; empty when none is readable.
 * @example
 * readEnvFileKeys('/repo', 'development') // => ['VITE_API_URL', 'DB_PASSWORD']
 */
export function readEnvFileKeys(envDir: string, mode: string): string[] {
  const names = new Set<string>()
  for (const file of [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]) {
    try {
      for (const name of Object.keys(
        parseEnv(readFileSync(join(envDir, file), 'utf8')),
      ))
        names.add(name)
    } catch {
      // A missing or unreadable file defines nothing.
    }
  }
  return [...names]
}
