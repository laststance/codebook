import type { NextDevPreparation } from './readNextDevPreparation'

/**
 * Words a {@link NextDevPreparation} reading as the sentences an agent tells the learner: the skipped statements, an unread script, and the environment settings Codebook does not apply, by name only.
 *
 * Why it exists: the `next-dev-webpack` readiness of `codebook_status` carries these sentences as notes beside `ready`, which they never change. Called by {@link readRepositoryAdapterReadiness}; the words are fixed here so every surface that names skipped preparation says the same.
 *
 * @param preparation - The reading of {@link readNextDevPreparation}.
 * @returns
 * - no sentence for `none` without environment settings
 * - the skipped sentence with the count for `skipped`
 * - the could-not-read sentence for `unknown`
 * - then, when environment settings are named, the sentence that lists their names
 * @example
 * describeNextDevPreparation({ status: 'skipped', statements: 1, envSettings: ['NODE_OPTIONS'] })
 * // => ['Codebook starts Next with --webpack and skips 1 statement(s) before `next dev` in package.json scripts.dev. Whether that preparation is done has not been checked.', 'Codebook does not apply these environment settings from scripts.dev: NODE_OPTIONS.']
 */
export function describeNextDevPreparation(
  preparation: NextDevPreparation,
): string[] {
  const sentences: string[] = []
  if (preparation.status === 'unknown')
    return [
      'Codebook starts Next with --webpack and could not read package.json scripts.dev; whether it runs preparation before `next dev` has not been checked.',
    ]
  if (preparation.status === 'skipped')
    sentences.push(
      `Codebook starts Next with --webpack and skips ${preparation.statements} statement(s) before \`next dev\` in package.json scripts.dev. Whether that preparation is done has not been checked.`,
    )
  if (preparation.envSettings?.length)
    sentences.push(
      `Codebook does not apply these environment settings from scripts.dev: ${preparation.envSettings.join(', ')}.`,
    )
  return sentences
}
