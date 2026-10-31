import { NEXT_WEBPACK_COMPATIBILITY_SENTENCE } from '../constants'

import { describeNextDevPreparation } from './describeNextDevPreparation'
import { devScriptRequestsWebpack } from './devScriptRequestsWebpack'
import { nextDevArguments } from './nextDevArguments'
import { readNextDevPreparation } from './readNextDevPreparation'

/** What {@link describeNextLaunchFailure} needs about the run whose Next did not start or did not compile the page. */
export type NextLaunchFailureFacts = {
  /** The workspace root that holds `package.json`. */
  workspace: string
  /** The `next` package version, when readable. */
  nextVersion?: string
  /** The port Codebook started Next on. */
  port: number
}

/**
 * Words what a learner needs beside a Pages-path launch or compile failure: the preparation Codebook skipped and the environment settings it did not apply from `scripts.dev`, and, when the `dev` script does not ask for webpack, that Codebook ran Next with webpack (the Next version and the command it ran).
 *
 * Why it exists: Codebook never runs the project's own `dev` script, so a skipped `prisma generate`, an unapplied environment setting or a Turbopack-only setting can be why the server did not start or the page did not compile. Called by the configured browser run for an uncoded launch failure and for `NEXT_ROUTE_NOT_COMPILED` in a workspace with a Pages folder; a refusal about settings, redirects or routes gets none of it.
 * @param facts - The workspace, the Next version and the port.
 * @returns
 * - the sentences of {@link describeNextDevPreparation} for the reading: the skipped or unread preparation, a counted pre script that may not run, and the environment settings Codebook does not apply, also for a `none` preparation that names some (`NODE_OPTIONS=… next dev`); none for a plain `next dev`
 * - then {@link NEXT_WEBPACK_COMPATIBILITY_SENTENCE} and the command sentence when `scripts.dev` has no `--webpack`
 * @example
 * await describeNextLaunchFailure({ workspace: '/repo', nextVersion: '16.4.3', port: 3000 })
 * // => ['Codebook runs your Next app with webpack (`next dev --webpack`) even when …', 'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.']
 * // for "NODE_OPTIONS=--max-old-space-size=8192 next dev": ['Codebook does not apply these environment settings from scripts.dev: NODE_OPTIONS.', 'Codebook runs your Next app with webpack …', 'Codebook ran Next 16.4.3 as …']
 */
export async function describeNextLaunchFailure(
  facts: NextLaunchFailureFacts,
): Promise<string[]> {
  // The reading is always described: a plain `next dev` gives no sentence, while a dev script that only sets environment settings (status `none`) still names the ones Codebook does not apply.
  const sentences = describeNextDevPreparation(
    await readNextDevPreparation(facts.workspace),
  )
  if (await devScriptRequestsWebpack(facts.workspace)) return sentences
  const command = ['next', ...nextDevArguments(facts.port)].join(' ')
  return [
    ...sentences,
    NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
    `Codebook ran Next ${facts.nextVersion ?? '(version unread)'} as \`${command}\`.`,
  ]
}
