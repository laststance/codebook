import { redactSecretText } from './redactSecretText'

/** One unexpected failure on a test replay's path, as its producer reports it for the Output › Codebook channel; every text in it is already sanitized ({@link sanitizeCause}). */
export type CodebookDiagnostic = {
  /** The MCP error code, or the surface that failed (`save:stop-rejected`, `open:test-replay`). */
  surface: string
  studyId?: string
  profile?: string
  /** The sanitized cause, whole: the channel keeps what a tooltip cuts. */
  cause: string
  /** The sanitized stack of the thrown error, when there was one. */
  stack?: string
}

/** The builds and the host every entry names, so a reader of the channel knows which extension and editor it came from. */
export type CodebookDiagnosticContext = {
  extensionVersion: string
  apiVersion: string
  hostName: string
  hostVersion: string
}

/**
 * Words one unexpected failure for the Output › Codebook channel: the code or surface, the study id, the profile, the extension and API versions, the host's name and version, the sanitized cause and the stack, one field per line, so a learner can copy it into a report; called by the extension's diagnostics sink for every entry {@link StudyService} and {@link NodeLearningSave} report.
 * @param entry - The failure, already sanitized.
 * @param context - The extension's and the host's identity.
 * @returns The entry's text.
 * @example
 * formatCodebookDiagnostic({ surface: 'HISTORY_SEAL_FAILED', studyId: 'a_b', profile: 'node-test', cause: 'EIO: i/o error' }, { extensionVersion: '0.2.33', apiVersion: '1.8', hostName: 'Visual Studio Code', hostVersion: '1.143.0' })
 * // => 'HISTORY_SEAL_FAILED · study a_b · profile node-test\nCodebook 0.2.33 (API 1.8) · Visual Studio Code 1.143.0\nCause: EIO: i/o error'
 */
export function formatCodebookDiagnostic(
  entry: CodebookDiagnostic,
  context: CodebookDiagnosticContext,
): string {
  const identity = [
    entry.surface,
    ...(entry.studyId ? [`study ${entry.studyId}`] : []),
    ...(entry.profile ? [`profile ${entry.profile}`] : []),
  ].join(' · ')
  // The channel is a durable log the learner copies into reports; mask secret-looking values in the whole entry.
  return redactSecretText(
    [
      identity,
      `Codebook ${context.extensionVersion} (API ${context.apiVersion}) · ${context.hostName} ${context.hostVersion}`,
      `Cause: ${entry.cause}`,
      ...(entry.stack ? [entry.stack] : []),
    ].join('\n'),
  )
}
