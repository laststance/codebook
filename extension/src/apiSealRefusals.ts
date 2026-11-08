import { StudyError } from './errors'
import { expoWebHelpAnchor } from './expoWebRefusals'
import { viteHelpAnchor } from './viteRefusals'

/** The seal-failure codes an API server stop (`apiServer`) can be refused with: one per adapter that runs the API beside its app server. */
export type ApiSealCode = 'EXPO_WEB_SEAL_FAILED' | 'VITE_SEAL_FAILED'

/** The `details.reason` values of an API seal refusal. */
export type ApiSealReason = 'source-drift' | 'source-unverifiable'

/** The fields an API seal refusal carries and an API seal failure text restores: the reason, the participant, the stop file and the side effects. */
export type ApiSealFailureDetails = {
  reason: ApiSealReason
  participant: 'apiServer'
  file: string
  sideEffects: 'partial'
}

/** The sentence an API seal refusal carries: the API and the app's servers were stopped, and the operations already sent are not undone. */
const API_SERVER_STOPPED =
  "The API and the app were stopped; an operation already sent may have changed the application's data."

/** The prefix of an API seal failure variant: `api-seal:<reason>:<encoded file>`. */
const API_SEAL_VARIANT_PREFIX = 'api-seal:'

/**
 * Words the static recovery of an API seal refusal, which names fields and never values (a recovery override reaches MCP unsanitized).
 *
 * Why it exists: the refusal builders and the restore of a failure text must give the same recovery, so one place words it. Called by {@link apiSourceDriftRefusal}, {@link apiSourceUnverifiableRefusal} and {@link refusalFailureOf}.
 * @param code - The adapter's seal code, which selects the help anchor.
 * @param reason - Why the API's executed source could not be tied to the stop file.
 * @returns The recovery: what to tell the learner, that nothing is edited or built, and where the help lives.
 * @example
 * apiSealRecoveryOf('VITE_SEAL_FAILED', 'source-drift') // => "Tell the learner the API ran another version of details.file … See codebook://help/repository-browser#VITE_SEAL_FAILED."
 */
export function apiSealRecoveryOf(
  code: ApiSealCode,
  reason: ApiSealReason,
): string {
  const anchor =
    code === 'VITE_SEAL_FAILED' ? viteHelpAnchor(code) : expoWebHelpAnchor(code)
  const ending = `${API_SERVER_STOPPED} Recovery: fix it, then one new start. See ${anchor}.`
  // The drift fix is a new declaration from the current file; the unverifiable fix is the TypeScript source the dev script runs through tsx.
  return reason === 'source-drift'
    ? `Tell the learner the API ran another version of details.file than the repository's current one (a stale build, or an edit after the study was declared); never edit the project. Declare the stop again from the current file, then one new start. ${ending}`
    : `Tell the learner the API's executed script carries no inline source map with the contents of details.file (a prebuilt dist entry, an external map or no map); declare apiServer.entry as the TypeScript source the package's own dev script runs through tsx, then one new start; never edit or build the project. ${ending}`
}

/**
 * Builds the seal refusal of an API script whose executed source differs from the stop file's declared hash (API 1.37; Vite since Cycle 0100).
 *
 * Why it exists: the source map the API ran carries the file's contents, and those must equal the hash the stop declares; a stale prebuilt file or an edit after the declaration would otherwise show the declared line on code that did not run. Called by the API stop's seal in {@link ConfiguredBrowserRun} at the script's announcement or at the pause; the API's process group is ended first.
 * @param code - The adapter's seal code.
 * @param file - The repository-relative stop file.
 * @returns The refusal: `details.reason: "source-drift"`, `details.participant: "apiServer"`, `file` and `sideEffects: "partial"`.
 * @example
 * apiSourceDriftRefusal('VITE_SEAL_FAILED', 'apps/api/src/handler.ts').details?.participant // => 'apiServer'
 */
export function apiSourceDriftRefusal(
  code: ApiSealCode,
  file: string,
): StudyError {
  return apiSealRefusal(
    code,
    'source-drift',
    file,
    `The API ran a different version of ${file} than the stop declares (the source its map carries is not the declared file), so the stop was not shown. ${API_SERVER_STOPPED}`,
  )
}

/**
 * Builds the seal refusal of an API script that no source map ties to the stop file: a prebuilt entry without inline source contents, an external map, or no map.
 *
 * Why it exists: without the executed source Codebook cannot prove which code ran, and the current file on disk is never taken as proof. Called by the API stop's seal in {@link ConfiguredBrowserRun}; the API's process group is ended first.
 * @param code - The adapter's seal code.
 * @param file - The repository-relative stop file.
 * @returns The refusal: `details.reason: "source-unverifiable"`, `details.participant: "apiServer"`, `file` and `sideEffects: "partial"`.
 * @example
 * apiSourceUnverifiableRefusal('EXPO_WEB_SEAL_FAILED', 'apps/api/src/handler.ts').details?.reason // => 'source-unverifiable'
 */
export function apiSourceUnverifiableRefusal(
  code: ApiSealCode,
  file: string,
): StudyError {
  return apiSealRefusal(
    code,
    'source-unverifiable',
    file,
    `Codebook cannot tell which source the API ran for ${file} (no inline source map with the file's contents), so the stop was not shown. ${API_SERVER_STOPPED}`,
  )
}

/**
 * Assembles an API seal refusal from its reason, file and message.
 * Called by {@link apiSourceDriftRefusal} and {@link apiSourceUnverifiableRefusal}.
 * @param code - The adapter's seal code.
 * @param reason - The `details.reason`.
 * @param file - The repository-relative stop file.
 * @param message - What was refused.
 * @returns The error to throw.
 * @example
 * apiSealRefusal('VITE_SEAL_FAILED', 'source-drift', 'a.ts', 'No.').code // => 'VITE_SEAL_FAILED'
 */
function apiSealRefusal(
  code: ApiSealCode,
  reason: ApiSealReason,
  file: string,
  message: string,
): StudyError {
  const details: ApiSealFailureDetails = {
    reason,
    participant: 'apiServer',
    file,
    sideEffects: 'partial',
  }
  return new StudyError(
    code,
    message,
    message,
    apiSealRecoveryOf(code, reason),
    undefined,
    details,
  )
}

/**
 * Writes the variant of an API seal failure text (`<CODE>(api-seal:<reason>:<file>)`), so the reason and file survive the text a failed run records.
 *
 * Why it exists: the seal refusal is raised inside an event and passes through the run's failure string; without a variant {@link refusalFailureOf} would restore the code alone. Called by {@link ConfiguredBrowserRun} when the API seal fails.
 * @param error - The seal refusal ({@link apiSourceDriftRefusal} or {@link apiSourceUnverifiableRefusal}).
 * @returns The variant; `undefined` when the error carries no API seal details.
 * @example
 * apiSealVariantOf(apiSourceDriftRefusal('VITE_SEAL_FAILED', 'apps/api/a.ts')) // => 'api-seal:source-drift:apps%2Fapi%2Fa.ts'
 */
export function apiSealVariantOf(error: StudyError): string | undefined {
  const details = error.details
  if (
    details?.participant !== 'apiServer' ||
    typeof details.file !== 'string' ||
    (details.reason !== 'source-drift' &&
      details.reason !== 'source-unverifiable')
  )
    return undefined
  // Parentheses would end the lead, so they are encoded too.
  const file = encodeURIComponent(details.file)
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
  return `${API_SEAL_VARIANT_PREFIX}${details.reason}:${file}`
}

/**
 * Reads an API seal variant back into the details {@link apiSourceDriftRefusal} and {@link apiSourceUnverifiableRefusal} carry.
 * Called by {@link refusalFailureOf}.
 * @param variant - The lead's variant.
 * @returns The details; `undefined` for any other variant or an undecodable file.
 * @example
 * apiSealFailureOf('api-seal:source-drift:apps%2Fapi%2Fa.ts') // => { reason: 'source-drift', participant: 'apiServer', file: 'apps/api/a.ts', sideEffects: 'partial' }
 */
export function apiSealFailureOf(
  variant: string | undefined,
): ApiSealFailureDetails | undefined {
  if (!variant?.startsWith(API_SEAL_VARIANT_PREFIX)) return undefined
  const rest = variant.slice(API_SEAL_VARIANT_PREFIX.length)
  const colon = rest.indexOf(':')
  const reason = rest.slice(0, colon)
  const encoded = rest.slice(colon + 1)
  if (
    colon < 0 ||
    (reason !== 'source-drift' && reason !== 'source-unverifiable') ||
    !encoded
  )
    return undefined
  try {
    return {
      reason,
      participant: 'apiServer',
      file: decodeURIComponent(encoded),
      sideEffects: 'partial',
    }
  } catch {
    return undefined
  }
}
