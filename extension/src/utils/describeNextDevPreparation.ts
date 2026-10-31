import type { NextDevPreparationReading } from './readNextDevPreparation'

/** The note for a counted pre script whose package manager, or that manager's version, Codebook cannot tell. */
const UNCERTAIN_PRE_SCRIPT_NOTE =
  'Codebook could not tell which package manager, or which version of it, runs these scripts, so a pre script counted among the skipped statements (such as predev) may or may not run.'

/**
 * Words a {@link readNextDevPreparation} reading as the sentences an agent tells the learner: the skipped statements, a pre script that may not run, an unread script, and the environment settings Codebook does not apply, by name only.
 *
 * Why it exists: the `next-dev-webpack` readiness of `codebook_status` carries these sentences as notes beside `ready`, which they never change. Called by {@link readRepositoryAdapterReadiness} and {@link describeNextLaunchFailure}; the words are fixed here so every surface that names skipped preparation says the same.
 *
 * @param reading - The reading of {@link readNextDevPreparation}: its preparation and whether a counted pre script may not run.
 * @returns
 * - no sentence for `none` without environment settings
 * - the skipped sentence with the count for `skipped`, then the uncertain pre-script sentence when a counted pre script's package manager is unknown
 * - the could-not-read sentence for `unknown`
 * - then, when environment settings are named, the sentence that lists their names
 * @example
 * describeNextDevPreparation({ preparation: { status: 'skipped', statements: 1, envSettings: ['NODE_OPTIONS'] }, preScriptUncertain: false })
 * // => ['Codebook starts Next with --webpack and skips 1 statement(s) before `next dev` in package.json scripts.dev. Whether that preparation is done has not been checked.', 'Codebook does not apply these environment settings from scripts.dev: NODE_OPTIONS.']
 */
export function describeNextDevPreparation(
  reading: NextDevPreparationReading,
): string[] {
  const { preparation } = reading
  const sentences: string[] = []
  if (preparation.status === 'unknown')
    return [
      'Codebook starts Next with --webpack and could not read package.json scripts.dev; whether it runs preparation before `next dev` has not been checked.',
    ]
  if (preparation.status === 'skipped')
    sentences.push(
      `Codebook starts Next with --webpack and skips ${preparation.statements} statement(s) before \`next dev\` in package.json scripts.dev. Whether that preparation is done has not been checked.`,
    )
  if (reading.preScriptUncertain) sentences.push(UNCERTAIN_PRE_SCRIPT_NOTE)
  if (preparation.envSettings?.length)
    sentences.push(
      `Codebook does not apply these environment settings from scripts.dev: ${preparation.envSettings.join(', ')}.`,
    )
  return sentences
}
