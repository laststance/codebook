import { StudyError } from './errors'

/** The sentence every refusal here carries: the checks run before any process starts. */
const NOTHING_STARTED = 'Nothing started.'

/** The recovery tail shared by the refusals here: one fix, one new start. */
const FIX_THEN_START = 'Recovery: fix it, then one new start.'

/**
 * Builds the `INVALID_CONFIGURATION` refusal of an API folder that is, by real path, equal to or containing the app's folder (a symbolic link hides it from the schema's lexical rule, D36).
 *
 * Why it exists: the schema is lexical and pure, so a link that makes `apiServer.packageRoot` reach the app's folder is caught only when the run resolves both real paths. Called by {@link ConfiguredBrowserRun} before the API is checked or started, for a `vite-dev` run that declares `apiServer`.
 * @param apiPackageRoot - The declared `apiServer.packageRoot`.
 * @returns The refusal: `details.reason: "api-folder-nesting"`, `details.field: "apiServer.packageRoot"` and `sideEffects: "none"`.
 * @example
 * apiFolderNestingRefusal('server').details?.reason // => 'api-folder-nesting'
 */
export function apiFolderNestingRefusal(apiPackageRoot: string): StudyError {
  const message = `apiServer.packageRoot "${apiPackageRoot}" is, by its real path, the app's folder or a folder that contains it (a symbolic link can make it so); the API's folder may lie inside the app's folder but must not equal or contain it. ${NOTHING_STARTED}`
  return new StudyError(
    'INVALID_CONFIGURATION',
    message,
    message,
    `Correct apiServer.packageRoot to a folder that does not equal or contain the app's folder by its real path; never edit the project or move its links. ${FIX_THEN_START}`,
    undefined,
    {
      reason: 'api-folder-nesting',
      field: 'apiServer.packageRoot',
      sideEffects: 'none',
    },
  )
}

/**
 * Builds the `INVALID_CONFIGURATION` refusal of a stop whose real path is on the other participant's side of `apiServer.packageRoot` (D47).
 *
 * Why it exists: the schema judges stop files lexically; a symbolic link in the app's folder to an API file would be sealed as a browser stop, and a link in the API's folder to an app file as a server stop. Called by {@link ConfiguredBrowserRun} while it collects the API stops, before any process starts.
 * @param stop - The stop's declared participant and repository-relative file.
 * @param stop.participant - The participant the stop declares.
 * @param stop.file - The stop's repository-relative file.
 * @returns The refusal: `details.reason: "stop-participant-folder"`, `details.participant` (the declared one), `details.file` and `sideEffects: "none"`; the message names the participant to declare.
 * @example
 * apiStopParticipantFolderRefusal({ participant: 'server', file: 'apps/web/src/a.ts' }).details?.participant // => 'server'
 */
export function apiStopParticipantFolderRefusal(stop: {
  participant: 'browser' | 'server'
  file: string
}): StudyError {
  const { participant, file } = stop
  const advice =
    participant === 'server'
      ? 'a server stop must lie inside apiServer.packageRoot by its real path; declare participant "browser" for a file outside the API folder'
      : 'a browser stop must lie outside apiServer.packageRoot by its real path; declare participant "server" for a file in the API folder'
  const message = `${file} is declared with participant "${participant}", but by its real path (a symbolic link can change it) ${advice}. ${NOTHING_STARTED}`
  return new StudyError(
    'INVALID_CONFIGURATION',
    message,
    message,
    `Declare the participant of the stop in details.file to match the folder its real path lies in (server inside apiServer.packageRoot, browser outside it); never edit the project or its links. ${FIX_THEN_START}`,
    undefined,
    {
      reason: 'stop-participant-folder',
      participant,
      file,
      sideEffects: 'none',
    },
  )
}
