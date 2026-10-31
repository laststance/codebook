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
 * Words what a learner needs beside a Pages-path launch or compile failure: the preparation Codebook skipped from `scripts.dev`, and, when the `dev` script does not ask for webpack, that Codebook ran Next with webpack (the Next version and the command it ran).
 *
 * Why it exists: Codebook never runs the project's own `dev` script, so a skipped `prisma generate`, an unapplied environment setting or a Turbopack-only setting can be why the server did not start or the page did not compile. Called by the configured browser run for an uncoded launch failure and for `NEXT_ROUTE_NOT_COMPILED` in a workspace with a Pages folder; a refusal about settings, redirects or routes gets none of it.
 * @param facts - The workspace, the Next version and the port.
 * @returns
 * - the preparation sentences of {@link describeNextDevPreparation} when the preparation is `skipped` or `unknown`, none for `none`
 * - then {@link NEXT_WEBPACK_COMPATIBILITY_SENTENCE} and the command sentence when `scripts.dev` has no `--webpack`
 * @example
 * await describeNextLaunchFailure({ workspace: '/repo', nextVersion: '16.4.3', port: 3000 })
 * // => ['Codebook runs your Next app with webpack (`next dev --webpack`) even when …', 'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.']
 */
export async function describeNextLaunchFailure(
  facts: NextLaunchFailureFacts,
): Promise<string[]> {
  const reading = await readNextDevPreparation(facts.workspace)
  // A plain `next dev` leaves nothing out, so a failure says nothing about preparation.
  const sentences =
    reading.preparation.status === 'none'
      ? []
      : describeNextDevPreparation(reading)
  if (await devScriptRequestsWebpack(facts.workspace)) return sentences
  const command = ['next', ...nextDevArguments(facts.port)].join(' ')
  return [
    ...sentences,
    NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
    `Codebook ran Next ${facts.nextVersion ?? '(version unread)'} as \`${command}\`.`,
  ]
}
