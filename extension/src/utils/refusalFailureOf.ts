import {
  apiSealFailureOf,
  apiSealRecoveryOf,
  type ApiSealFailureDetails,
} from '../apiSealRefusals'
import {
  API_SERVER_EXITED_RECOVERY,
  API_SERVER_EXITED_VARIANT,
  apiServerOutputTailOf,
} from '../apiServerRefusals'
import {
  SIGN_IN_REQUIRED_REASONS,
  type SignInRequiredReason,
} from '../constants'
import { PACKAGE_ROOT_FRESH_SESSION_RECOVERY, type ErrorCode } from '../errors'
import {
  EXPO_WEB_REFUSAL_CODES,
  expoWebSetupDeadlineDetailsOf,
  type ExpoWebSetupDeadlineFailureDetails,
} from '../expoWebRefusals'
import {
  libraryDetailsOfFailure,
  libraryRecoveryOf,
  libraryRecoveryRouterOfFailure,
  NEXT_PAGES_FAILURE_VARIANT,
  NEXT_REFUSAL_CODES,
  nextSetupDeadlineRecovery,
  PAGES_STOP_REFUSAL_DETAILS,
} from '../nextRefusals'
import {
  REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_RECOVERY,
  REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_VARIANT,
  REACT_SCRIPTS_REFUSAL_CODES,
  reactScriptsSetupDeadlineDetailsOf,
  type ReactScriptsSetupDeadlineFailureDetails,
} from '../reactScriptsRefusals'
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
  // The expo-web-dev refusals a timer raises (a setup deadline) reach the service as text too.
  ...EXPO_WEB_REFUSAL_CODES,
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
  // The app's own API server that exited during an `expo-web-dev` run, only with its `api-server` variant ({@link refusalFailureOf}).
  'SERVER_EXITED',
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
    // The service forwards this slot as the error's `details`, so the react-scripts setup deadline's fields ride here too.
    | ReactScriptsSetupDeadlineFailureDetails
    | ExpoWebSetupDeadlineFailureDetails
    | ApiServerExitedFailureDetails
    | ApiSealFailureDetails
}

/** The fields an API exit failure text restores: the participant and the side effects (the API was started and stopped); the exit code, signal and output tail live in the message. */
type ApiServerExitedFailureDetails = {
  participant: 'apiServer'
  sideEffects: 'partial'
  /** The API's masked last output, read back from the message; `''` when it printed nothing. */
  outputTail: string
  /** Absent: lets code that reads `libraryDetails?.reason` keep one shape across the union. */
  reason?: undefined
}

/** The fields a Vite library failure text restores: the reason (and cause) with `sideEffects: "unknown"`, and the package root, library and file its variant carries. */
type ViteLibraryFailureDetails = ViteLibraryStopIdentity & {
  reason: 'library-build-changed' | 'library-build-unmapped'
  cause?: 'lazy-import'
  // A react-scripts library build change is `partial` (its help row); the Vite ones are `unknown`.
  sideEffects: 'unknown' | 'partial'
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
  // `SERVER_EXITED` is coded only as the API server's exit (the node-server profile restores its own through its error).
  if (code === 'SERVER_EXITED')
    return lead?.[2] === API_SERVER_EXITED_VARIANT ? code : undefined
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
 * - `{ code, message, libraryDetails }` for a `REACT_SCRIPTS_SETUP_DEADLINE` whose message names its step: `libraryDetails` holds `{ reason: 'setup-deadline', step, sideEffects: 'partial' }`, which the service forwards as `details`
 * - `{ code: 'SERVER_EXITED', message, recoveryOverride, libraryDetails }` for `SERVER_EXITED(api-server)`: the API server's exit words and `{ participant: 'apiServer', sideEffects: 'partial' }`
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
  // The API server's exit carries its words and details as the variant (DX-6, E-6).
  if (code === 'SERVER_EXITED') return apiServerExitFailure(message)
  // An API seal refusal carries its reason and file as the variant.
  const apiSeal = code === 'EXPO_WEB_SEAL_FAILED' && apiSealFailureOf(variant)
  if (apiSeal)
    return {
      code,
      message,
      recoveryOverride: apiSealRecoveryOf(code, apiSeal.reason),
      libraryDetails: apiSeal,
    }
  if (code === 'SIGN_IN_REQUIRED')
    return signInRequiredFailure(message, variant)
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
 * Restores a sign-in refusal: the reason is the variant, and an unknown reason restores the code alone.
 * Called by {@link refusalFailureOf}.
 * @param message - The text after the lead.
 * @param variant - The lead's variant, a sign-in reason when known.
 * @returns The refusal with `details.reason`; a run of a package below the root gets its own recovery.
 * @example signInRequiredFailure('The app asked for sign-in.', 'redirected-to-sign-in').details // => { reason: 'redirected-to-sign-in' }
 */
function signInRequiredFailure(
  message: string,
  variant: string | undefined,
): RefusalFailure {
  const code = 'SIGN_IN_REQUIRED'
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

/**
 * Restores the API server's exit failure (`SERVER_EXITED(api-server)`): its message, the API recovery and the participant and side effects its text implies.
 * Called by {@link refusalFailureOf}.
 * @param message - The text after the lead.
 * @returns The refusal with the API recovery and `{ participant: 'apiServer', sideEffects: 'partial' }`.
 * @example apiServerExitFailure('The API exited with code 1.').libraryDetails // => { participant: 'apiServer', sideEffects: 'partial' }
 */
function apiServerExitFailure(message: string): RefusalFailure {
  return {
    code: 'SERVER_EXITED',
    message,
    recoveryOverride: API_SERVER_EXITED_RECOVERY,
    libraryDetails: {
      participant: 'apiServer',
      sideEffects: 'partial',
      outputTail: apiServerOutputTailOf(message),
    },
  }
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
  const reactScriptsChanged = viteLibraryFailureLead(
    text,
    'RUNTIME_FAILED',
    REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_VARIANT,
  )
  if (reactScriptsChanged)
    return {
      code: 'RUNTIME_FAILED',
      message: reactScriptsChanged.message,
      recoveryOverride: REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_RECOVERY,
      libraryDetails: {
        reason: 'library-build-changed',
        ...reactScriptsChanged.identity,
        sideEffects: 'partial',
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
  const apiSeal = restoredViteApiSealFailure(text)
  if (apiSeal) return apiSeal
  // The react-scripts and Expo deadlines are read here too, so it is restored before the general Next and run codes.
  return viteFailureOf(text) ?? restoredSetupDeadline(text)
}

/**
 * Restores the API seal failure of a Vite run (`VITE_SEAL_FAILED(api-seal:<reason>:<file>)`): its message, the API recovery and the reason, participant, file and side effects.
 *
 * Why it exists: the API seal is raised inside an event, so only its text survives to the service; plain `VITE_SEAL_FAILED: ` and the `lazy-import` variant are read elsewhere and stay as they were. Called by {@link restoredViteFailure}.
 * @param text - A run's failure reason.
 * @returns The refusal with {@link apiSealRecoveryOf} and the restored details; `undefined` for any other text.
 * @example
 * restoredViteApiSealFailure('VITE_SEAL_FAILED(api-seal:source-drift:api%2Fa.ts): Drift.')?.libraryDetails // => { reason: 'source-drift', participant: 'apiServer', file: 'api/a.ts', sideEffects: 'partial' }
 */
function restoredViteApiSealFailure(text: string): RefusalFailure | undefined {
  const lead = CODED_FAILURE_LEAD.exec(text)
  const details =
    lead?.[1] === 'VITE_SEAL_FAILED' ? apiSealFailureOf(lead[2]) : undefined
  if (!lead || !details) return undefined
  return {
    code: 'VITE_SEAL_FAILED',
    message: text.slice(lead[0].length),
    recoveryOverride: apiSealRecoveryOf('VITE_SEAL_FAILED', details.reason),
    libraryDetails: details,
  }
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

/** The setup-deadline codes whose timer-raised text restores `details`, each with the reader of its message. */
const SETUP_DEADLINE_RESTORERS = [
  ['REACT_SCRIPTS_SETUP_DEADLINE', reactScriptsSetupDeadlineDetailsOf],
  ['EXPO_WEB_SETUP_DEADLINE', expoWebSetupDeadlineDetailsOf],
] as const

/**
 * Restores a react-scripts or Expo setup-deadline failure raised by a timer: the code and message plus the reason, step and side effects its text carries.
 *
 * Why it exists: the timer has no thrown error, so the details the API note promises must come from the text. Called by {@link restoredViteFailure} as its last step, on the way from {@link refusalFailureOf}.
 * @param text - A run's failure reason.
 * @returns The refusal with `libraryDetails` set when the message names its step; the code and message alone when it does not; `undefined` for any other text.
 * @example
 * restoredSetupDeadline('REACT_SCRIPTS_SETUP_DEADLINE: Setup took too long.') // => { code: 'REACT_SCRIPTS_SETUP_DEADLINE', message: 'Setup took too long.' }
 * restoredSetupDeadline('EXPO_WEB_SETUP_DEADLINE: Setup took too long.') // => { code: 'EXPO_WEB_SETUP_DEADLINE', message: 'Setup took too long.' }
 */
function restoredSetupDeadline(text: string): RefusalFailure | undefined {
  const lead = CODED_FAILURE_LEAD.exec(text)
  const restorer = SETUP_DEADLINE_RESTORERS.find(
    ([known]) => known === lead?.[1],
  )
  if (!lead || !restorer) return undefined
  const [code, detailsOf] = restorer
  const message = text.slice(lead[0].length)
  const details = detailsOf(message)
  return details
    ? { code, message, libraryDetails: details }
    : { code, message }
}
