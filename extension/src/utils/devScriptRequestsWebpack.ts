import { join } from 'node:path'

import { z } from 'zod'

import { readProjectFile } from './readDeclaredDevelopmentPort'

/** The one `package.json` field read: the `dev` script's text. */
const devScriptManifestSchema = z.object({
  scripts: z.object({ dev: z.string() }),
})

/** The `--webpack` flag as a word of a script (not part of a longer flag such as `--webpack-foo`). */
const WEBPACK_FLAG = /(?:^|\s)--webpack(?=\s|$)/

/**
 * Tells whether the project's own `dev` script already asks Next for webpack (`next dev --webpack`), for the compatibility sentence a Pages launch or compile failure adds otherwise.
 *
 * Why it exists: Next 16 runs Turbopack by default while Codebook always starts `next dev --webpack`; when the learner's own script does not, a failure may come from that difference, and the learner is told so. Called by {@link describeNextLaunchFailure}. Only the `dev` script's own text is read (a script it delegates to is not followed), through the bounded {@link readProjectFile}.
 * @param workspace - The workspace root that holds `package.json`.
 * @returns `true` when `scripts.dev` has the word `--webpack`; `false` when it does not, or `package.json` or its `dev` script cannot be read.
 * @example
 * await devScriptRequestsWebpack('/repo') // => false for "next dev"
 * await devScriptRequestsWebpack('/repo') // => true for "next dev --webpack -p 3000"
 */
export async function devScriptRequestsWebpack(
  workspace: string,
): Promise<boolean> {
  const file = await readProjectFile(join(workspace, 'package.json'))
  if (typeof file !== 'string') return false
  try {
    const parsed = devScriptManifestSchema.safeParse(JSON.parse(file))
    return parsed.success && WEBPACK_FLAG.test(parsed.data.scripts.dev)
  } catch {
    // A package.json that is no JSON asks for nothing.
    return false
  }
}
