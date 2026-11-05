import {
  SIGN_IN_REQUIRED_REASONS,
  type SignInRequiredReason,
} from '../constants'
import { PACKAGE_ROOT_FRESH_SESSION_RECOVERY, type ErrorCode } from '../errors'
import {
  libraryDetailsOfFailure,
  libraryRecoveryOf,
  libraryRecoveryRouterOfFailure,
  NEXT_PAGES_FAILURE_VARIANT,
  NEXT_REFUSAL_CODES,
  nextSetupDeadlineRecovery,
  PAGES_STOP_REFUSAL_DETAILS,
} from '../nextRefusals'
import { REACT_SCRIPTS_REFUSAL_CODES } from '../reactScriptsRefusals'
import {
  VITE_LIBRARY_BUILD_CHANGED_VARIANT,
  VITE_LIBRARY_LAZY_IMPORT_VARIANT,
  type ViteLibraryStopIdentity,
} from '../viteLibraryRefusals'
import { viteFailureOf, type ViteRefusalCode } from '../viteRefusals'

import { decodeViteLibraryVariant } from './viteLibraryFailureIdentity'

/** The codes a run's failure text can lead with besides the Vite ones: every Next Pages refusal, a source change found during a run (a Fast Refresh of a sealed module) and a secret control that stopped being a safe password control. */
const CODED_FAILURE_CODES = [
  ...NEXT_REFUSAL_CODES,
  // The react-scripts-dev refusals a timer raises (a setup deadline) reach the service as text too.
  ...REACT_SCRIPTS_REFUSAL_CODES,
  'SOURCE_CHANGED',
  // The failures of one operation of a version 3 run, raised by timers and events after the action's receipt.
  'OPTION_NOT_AVAILABLE',
  'INPUT_NOT_ACCEPTED',
  'CONTROL_KIND_NOT_SUPPORTED',
  'SECRET_INPUT_FROM_CHAT',
  'SECRET_INPUT_VISIBLE',
  'NAVIGATION_BEFORE_LAST_OPERATION',
  'NAVIGATION_NOT_SETTLED',
  'OPERATION_AFTER_NOT_MET',
  'RUN_FAILED_UNEXPECTEDLY',
  'SECRET_BECAME_VISIBLE',
  // The page asked for sign-in; the variant names why (SIGN_IN_REQUIRED_REASONS).
  'SIGN_IN_REQUIRED',
  // A server-render stop the page never reached, and an entry page that did not load after the last pause (Cycle 0071).
  'SERVER_STOP_NOT_REACHED',
  'ENTRY_LOAD_TIMEOUT',
  // A library stop's build that changed after the freeze, only with its `library-build-changed` variant ({@link refusalFailureOf}).
  'RUNTIME_FAILED',
] as const satisfies readonly ErrorCode[]

/** A code a run's failure text can lead with, so the service restores it as a coded error. */
export type RefusalFailureCode =
  ViteRefusalCode | (typeof CODED_FAILURE_CODES)[number]

/** A refusal restored from a run's failure text: its code, the text after the lead, and the static recovery its variant selects. */
export type RefusalFailure = {
  code: RefusalFailureCode
  message: string
  /** Present only for a known variant of a code that has variants (`NEXT_SETUP_DEADLINE`, `SIGN_IN_REQUIRED` led by `package-root-fresh-session`, and a library reason variant). */
  recoveryOverride?: string
  /** Present only for `SIGN_IN_REQUIRED` led by a known reason: the fields the agent reads as `details.reason`. */
  details?: { reason: SignInRequiredReason }
  /** Present only for `NEXT_ENTRY_REDIRECTED` led by the `pages` variant ({@link NEXT_PAGES_FAILURE_VARIANT}): the fields of a Pages entry refusal after the readiness request, which the agent reads as `details`. */
  pagesDetails?: typeof PAGES_STOP_REFUSAL_DETAILS
  /** Present only for a library refusal raised at a pause or an event (`NEXT_STOP_NOT_SEALED(library-place-ambiguous)`, `RUNTIME_FAILED(library-build-changed)`): the library fields (`reason`, `sideEffects` and, for an App Router refusal, `router: "app"`) that {@link libraryDetailsOfFailure} restores. */
  libraryDetails?:
    | NonNullable<ReturnType<typeof libraryDetailsOfFailure>>
    | ViteLibraryFailureDetails
}

/** The fields a Vite library failure text restores: the reason (and cause) with `sideEffects: "unknown"`, and the package root, library and file its variant carries. */
type ViteLibraryFailureDetails = ViteLibraryStopIdentity & {
  reason: 'library-build-changed' | 'library-build-unmapped'
  cause?: 'lazy-import'
  sideEffects: 'unknown'
}

/** The lead of a coded failure text: `<CODE>: ` or `<CODE>(<variant>): `; a variant holds no parenthesis and no line break. */
const CODED_FAILURE_LEAD = /^([A-Z][A-Z_]*)(?:\(([^()\n]*)\))?: /

/**
 * Finds the coded failure a failure text's lead names.
 *
 * Why: `RUNTIME_FAILED` counts as coded only as a Next library build change, Pages or App Router ({@link libraryDetailsOfFailure}; the Vite one is restored earlier by {@link restoredViteFailure}), so any other run failure text keeps today's uncoded handling. Called by {@link refusalFailureOf}.
 * @param lead - The match of the coded-failure lead, or `null` when the text has none.
 * @returns The known code, or `undefined` for no lead, an unknown code or a `RUNTIME_FAILED` without the Next `library-build-changed` variant.
 * @example codedFailureCodeOf(CODED_FAILURE_LEAD.exec('RUNTIME_FAILED: The run failed.')) // => undefined
 */
function codedFailureCodeOf(
  lead: RegExpExecArray | null,
): (typeof CODED_FAILURE_CODES)[number] | undefined {
  const code = CODED_FAILURE_CODES.find((known) => known === lead?.[1])
  return code === 'RUNTIME_FAILED' && !libraryDetailsOfFailure(code, lead?.[2])
    ? undefined
    : code
}

/**
 * Restores the refusal a run's failure text leads with, for the service that turns a failed run's reason into the error an agent reads.
 *
 * Why it exists: a failure raised by a timer or an event (a setup deadline, a reload after the click, a Fast Refresh of a sealed module) has no thrown error, so the run records `<CODE>: <message>` or `<CODE>(<variant>): <message>` ({@link formatRefusalFailure}), and the code, its recovery and its help anchor must survive that text. Called by {@link StudyService.runtimeFailureError} and {@link StudyService.preparationError}.
 * Vite codes are read by {@link viteFailureOf}, exactly as before; every `NEXT_*` code and `SOURCE_CHANGED` are read here. Only a known `NEXT_SETUP_DEADLINE` variant selects a static recovery override; an unknown variant restores the code with its general recovery. A `NEXT_ENTRY_REDIRECTED` led by the `pages` variant restores {@link PAGES_STOP_REFUSAL_DETAILS}, which a Pages redirect found by a timer or an event would otherwise lose.
 * @param text - A run's failure reason.
 * @returns
 * - `{ code, message }` for a text led by a Vite code, a Next code or `SOURCE_CHANGED`
 * - `{ code, message, recoveryOverride }` for a `NEXT_SETUP_DEADLINE` led by a known variant
 * - `{ code, message, pagesDetails }` for a `NEXT_ENTRY_REDIRECTED` led by the `pages` variant
 * - `undefined` for any other text
 * @example
 * refusalFailureOf('VITE_PAGE_RELOADED: The page reloaded') // => { code: 'VITE_PAGE_RELOADED', message: 'The page reloaded' }
 * refusalFailureOf('NEXT_SETUP_DEADLINE(router-late): Repository setup deadline (90 s) exceeded …') // => { code: 'NEXT_SETUP_DEADLINE', message: 'Repository setup deadline (90 s) exceeded …', recoveryOverride: 'Start once more with a new key … See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.' }
 * refusalFailureOf('NEXT_ENTRY_REDIRECTED(pages): The page left the entry path / for /login …') // => { code: 'NEXT_ENTRY_REDIRECTED', message: 'The page left the entry path / for /login …', pagesDetails: { router: 'pages', sideEffects: 'unknown' } }
 * refusalFailureOf('Repository setup deadline exceeded') // => undefined
 */
export function refusalFailureOf(text: string): RefusalFailure | undefined {
  const viteFailure = restoredViteFailure(text)
  if (viteFailure) return viteFailure
  const lead = CODED_FAILURE_LEAD.exec(text)
  const code = codedFailureCodeOf(lead)
  if (!lead || !code) return undefined
  const message = text.slice(lead[0].length),
    variant = lead[2]
  // A sign-in refusal carries its reason as the variant; an unknown reason restores the code alone.
  if (code === 'SIGN_IN_REQUIRED') {
    const reason = SIGN_IN_REQUIRED_REASONS.find((known) => known === variant)
    if (reason === undefined) return { code, message }
    // A run of a package below the root has no saved session to set up: its own recovery replaces the setup one.
    return reason === 'package-root-fresh-session'
      ? {
          code,
          message,
          recoveryOverride: PACKAGE_ROOT_FRESH_SESSION_RECOVERY,
          details: { reason },
        }
      : { code, message, details: { reason } }
  }
  // A Pages entry redirect carries the Pages fields as its variant; any other variant restores the code alone.
  if (code === 'NEXT_ENTRY_REDIRECTED')
    return variant === NEXT_PAGES_FAILURE_VARIANT
      ? { code, message, pagesDetails: { ...PAGES_STOP_REFUSAL_DETAILS } }
      : { code, message }
  // A library refusal after the readiness request carries its reason as the variant.
  const libraryDetails = libraryDetailsOfFailure(code, variant)
  if (libraryDetails)
    return {
      code,
      message,
      recoveryOverride: libraryRecoveryOf(
        libraryDetails.reason,
        'next',
        libraryRecoveryRouterOfFailure(variant),
      ),
      libraryDetails,
    }
  // Of the other codes only a deadline has variants, and only a known name selects its static recovery.
  const recoveryOverride =
    code === 'NEXT_SETUP_DEADLINE' && variant !== undefined
      ? nextSetupDeadlineRecovery(variant)
      : undefined
  return recoveryOverride === undefined
    ? { code, message }
    : { code, message, recoveryOverride }
}

/**
 * Restores the Vite failures a run records as text: a lazy-import refusal and a served library module that changed, then every other Vite code ({@link viteFailureOf}).
 *
 * Why it exists: both are raised inside a tracked activity or an event, so only their text survives to the service. Called first by {@link refusalFailureOf}.
 * @param text - A run's failure reason.
 * @returns The refusal with its static Vite recovery and the restored reason fields; `undefined` for any other text.
 * @example
 * restoredViteFailure('RUNTIME_FAILED(vite-library-build-changed): The served module …')?.libraryDetails?.reason // => 'library-build-changed'
 */
function restoredViteFailure(text: string): RefusalFailure | undefined {
  const changed = viteLibraryFailureLead(
    text,
    'RUNTIME_FAILED',
    VITE_LIBRARY_BUILD_CHANGED_VARIANT,
  )
  if (changed)
    return {
      code: 'RUNTIME_FAILED',
      message: changed.message,
      recoveryOverride: libraryRecoveryOf('library-build-changed', 'vite'),
      libraryDetails: {
        reason: 'library-build-changed',
        ...changed.identity,
        sideEffects: 'unknown',
      },
    }
  const lazy = viteLibraryFailureLead(
    text,
    'VITE_SEAL_FAILED',
    VITE_LIBRARY_LAZY_IMPORT_VARIANT,
  )
  if (lazy)
    return {
      code: 'VITE_SEAL_FAILED',
      message: lazy.message,
      recoveryOverride: libraryRecoveryOf('library-build-unmapped', 'vite'),
      libraryDetails: {
        reason: 'library-build-unmapped',
        cause: 'lazy-import',
        ...lazy.identity,
        sideEffects: 'unknown',
      },
    }
  return viteFailureOf(text)
}

/**
 * Reads the lead `<code>(<variant>:<identity>): ` of a Vite library failure text.
 *
 * Why it exists: {@link restoredViteFailure} reads two such leads and needs the message after it and the stop identity the variant carries. A lead whose identity cannot be read is not a library failure of this version, so it restores nothing.
 * @param text - A run's failure reason.
 * @param code - The code the lead must start with.
 * @param variant - The variant name before the identity.
 * @returns The message after the lead and the decoded identity; `undefined` for any other text.
 * @example
 * viteLibraryFailureLead('VITE_SEAL_FAILED(lazy-import:%5B…%5D): The library …', 'VITE_SEAL_FAILED', 'lazy-import')?.identity.library // => '@scope/core'
 */
function viteLibraryFailureLead(
  text: string,
  code: string,
  variant: string,
): { message: string; identity: ViteLibraryStopIdentity } | undefined {
  const lead = CODED_FAILURE_LEAD.exec(text)
  if (lead?.[1] !== code) return undefined
  const identity = decodeViteLibraryVariant(lead[2], variant)
  return identity && { message: text.slice(lead[0].length), identity }
}
