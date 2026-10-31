import {
  MILLISECONDS_PER_SECOND,
  NEXT_SETUP_STEPS,
  type NextSetupStep,
} from './constants'
import { StudyError, type ErrorCode } from './errors'

/**
 * The stable codes a Next Pages run refuses with, in the run's precedence order for the checks after the entry page answered (setting, redirect, not compiled, conflict, not found), then the seal refusals and the setup deadline.
 * The help writer lists one anchor per entry, and a test holds this list equal to the `NEXT_*` keys of {@link ERROR_RECOVERY}.
 */
export const NEXT_REFUSAL_CODES = [
  'NEXT_UNSUPPORTED_SETTING',
  'NEXT_ENTRY_REDIRECTED',
  'NEXT_ROUTE_NOT_COMPILED',
  'NEXT_ROUTE_CONFLICT',
  'NEXT_ROUTE_NOT_FOUND',
  'NEXT_SERVER_ONLY_STOP',
  'NEXT_STOP_NOT_SEALED',
  'NEXT_SETUP_DEADLINE',
] as const satisfies readonly ErrorCode[]

/** One code of {@link NEXT_REFUSAL_CODES}. */
export type NextRefusalCode = (typeof NEXT_REFUSAL_CODES)[number]

/** What the router-ready wait of a Pages run saw at the deadline: no `window.next.router` at all, or a router that never turned ready. */
export type NextRouterState = 'absent' | 'late'

/**
 * The help anchor of a Next refusal code: `codebook://help/repository-browser#<CODE>`.
 *
 * Why it exists: the recovery texts and the help writer name the same anchor, so an agent that follows a code lands on its section. Called by the help writer and the tests.
 * @param code - A Next refusal code.
 * @returns The resource address with the code as its anchor.
 * @example
 * nextHelpAnchor('NEXT_ROUTE_NOT_FOUND') // => 'codebook://help/repository-browser#NEXT_ROUTE_NOT_FOUND'
 */
export function nextHelpAnchor(code: NextRefusalCode): string {
  return `codebook://help/repository-browser#${code}`
}

/**
 * Builds the refusal an agent reads for a Next Pages run: a {@link StudyError} with the code's static recovery from {@link ERROR_RECOVERY}.
 *
 * Why it exists: the recovery never carries a value, because a recovery override reaches MCP unsanitized; every dynamic value (the entry path, a setting, the step, a file, quoted development-server output) goes into the message and the cause, which the service sanitizes and bounds. Called by the configured browser run before input, where a thrown refusal reaches the service's preparation error with its code.
 * @param code - The refusal code.
 * @param message - What was refused, naming the path, file, setting or value, ending with the fix or the limit; it is the cause as well.
 * @returns The error to throw.
 * @example
 * throw nextRefusal('NEXT_UNSUPPORTED_SETTING', 'This Next 16.4.3 project sets basePath (/docs); Codebook\'s browser run does not support basePath or i18n routing.')
 */
export function nextRefusal(
  code: NextRefusalCode,
  message: string,
): StudyError {
  return new StudyError(code, message)
}

/** The side-effect sentence of a Pages setup deadline once the browser Codebook opened was closed: no input and no click went out. */
const BROWSER_CLOSED_NOTHING_SENT =
  'The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource).'

/** The anchor sentence every `NEXT_SETUP_DEADLINE` recovery ends with. */
const SETUP_DEADLINE_ANCHOR =
  'See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'

/**
 * The static recovery of a `NEXT_SETUP_DEADLINE`, per variant of the step the run had reached.
 * Each text names fields, never values: it is passed as the {@link StudyError} recovery override, which reaches MCP without the sanitizer the message and cause pass through.
 */
const NEXT_SETUP_DEADLINE_RECOVERIES = {
  'before-browser': `Start once more with a new key (the first compile is warm after it); a second deadline means the project does not start in time for Codebook, so tell the learner the step the message names. Recovery: one retry, then the learner. The owned server was stopped; no browser was opened; no input was sent (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  'browser-opened': `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the entry page does not load in time, so tell the learner the step the message names. Recovery: one retry, then the learner. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  'router-absent': `Tell the learner the page at entryPath is not a Next Pages page: it exposes no Next router. Set entryPath to the Pages page the question is about, then one new start; never retry with the same entryPath. Recovery: fix the configuration, then one new start. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  'router-late': `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page router does not become ready in time, so tell the learner. Recovery: one retry, then the learner. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  inputs: `Check the input selector the message names against the entry page, then start once more with a new key; a second deadline means the page does not take that input in time, so tell the learner. Recovery: one retry, then the learner. The inputs before the one the message names were written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  arming: `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page does not get ready in time to arm the first stop, so tell the learner. Recovery: one retry, then the learner. Every declared initial input was written (or there were none) and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  'input-outcome-unknown': `Read the run's captured history before any new start: the reply to the input the message names was lost, so that input may have been written. Tell the learner, and start a new run only if the learner asks. Recovery: read, never resend. An input may have been written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
} as const

/** One variant of a `NEXT_SETUP_DEADLINE`, which chooses its static recovery ({@link nextSetupDeadlineRecovery}). */
export type NextSetupDeadlineVariant =
  keyof typeof NEXT_SETUP_DEADLINE_RECOVERIES

/**
 * Gives the static recovery of a `NEXT_SETUP_DEADLINE` variant, or nothing for a name that is no variant.
 *
 * Why it exists: the failure text of a deadline carries its variant as text (`NEXT_SETUP_DEADLINE(<variant>): …`), and a name read back from text is untrusted, so only a known name selects a recovery. Called by {@link refusalFailureOf} when it restores a deadline from a run's failure text.
 * @param variant - The variant name as read from a failure text.
 * @returns
 * - The variant's static recovery for a known name
 * - `undefined` for any other text
 * @example
 * nextSetupDeadlineRecovery('router-absent') // => 'Tell the learner the page at entryPath is not a Next Pages page: … See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'
 * nextSetupDeadlineRecovery('router-gone')   // => undefined
 */
export function nextSetupDeadlineRecovery(variant: string): string | undefined {
  return Object.entries(NEXT_SETUP_DEADLINE_RECOVERIES).find(
    ([name]) => name === variant,
  )?.[1]
}

/** Where a setup step stands relative to the browser and the page, the part of the deadline's variant the step alone decides. */
type NextSetupStage =
  'before-browser' | 'browser-opened' | 'router' | 'inputs' | 'arming'

/** What a setup deadline says about the browser per step, and the stage that chooses its variant. A record, so a new step cannot be added without choosing both. */
const NEXT_SETUP_STEP_FACTS: Record<
  NextSetupStep,
  { browserState: string; stage: NextSetupStage }
> = {
  [NEXT_SETUP_STEPS.validatingProject]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.startingNext]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.waitingForServer]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.readingManifests]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.sealingStops]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.openingBrowser]: {
    browserState:
      'the browser Codebook was opening was closed and no input or click was sent',
    stage: 'browser-opened',
  },
  [NEXT_SETUP_STEPS.loadingEntryPage]: {
    browserState:
      'the browser Codebook opened was closed and no input or click was sent',
    stage: 'browser-opened',
  },
  [NEXT_SETUP_STEPS.waitingForRouter]: {
    browserState:
      'the browser Codebook opened was closed and no input or click was sent',
    stage: 'router',
  },
  [NEXT_SETUP_STEPS.writingInputs]: {
    browserState:
      'the browser Codebook opened was closed and no click was sent',
    stage: 'inputs',
  },
  [NEXT_SETUP_STEPS.armingFirstStop]: {
    browserState:
      'the browser Codebook opened was closed and no click was sent',
    stage: 'arming',
  },
}

/**
 * Chooses the `NEXT_SETUP_DEADLINE` variant of the step a Pages run had reached, so its static recovery fits what had already run.
 *
 * Why it exists: the recovery class depends on the step (a retry before the browser, a fixed `entryPath` for a page with no Next router, reading the history when an input may have been written), and the recovery must stay static. Called by the configured browser run when the setup deadline of a Pages run expires, beside {@link nextSetupDeadlineSentence}.
 * @param step - The setup step reached, one of {@link NEXT_SETUP_STEPS}.
 * @param routerState - At the router step: whether `window.next.router` was never seen (`absent`, also when not given) or never turned ready (`late`).
 * @param inputOutcomeUnknown - At the input step: whether an input was dispatched and its reply was lost.
 * @returns
 * - `before-browser` for the steps up to sealing the stops
 * - `browser-opened` while opening the browser or loading the entry page
 * - `router-absent` or `router-late` at the router step
 * - `inputs`, or `input-outcome-unknown` when an input's outcome is unknown, at the input step
 * - `arming` once every input was written, while the first stop is armed
 * @example
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.sealingStops) // => 'before-browser'
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.waitingForRouter, 'late') // => 'router-late'
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.writingInputs, undefined, true) // => 'input-outcome-unknown'
 */
export function nextSetupDeadlineVariantOf(
  step: NextSetupStep,
  routerState?: NextRouterState,
  inputOutcomeUnknown = false,
): NextSetupDeadlineVariant {
  const { stage } = NEXT_SETUP_STEP_FACTS[step]
  // A router never seen counts as absent: only a router that was seen and never turned ready is late.
  if (stage === 'router')
    return routerState === 'late' ? 'router-late' : 'router-absent'
  if (stage === 'inputs')
    return inputOutcomeUnknown ? 'input-outcome-unknown' : 'inputs'
  return stage
}

/**
 * Words the clause of a setup deadline that only the router step and the input step have: the router case, or the input being written.
 * @param stage - The stage of the step reached.
 * @param budgetSeconds - The setup budget in whole seconds.
 * @param routerState - What the router wait saw, at the router step.
 * @param pendingInputSelector - The selector of the input being written, at the input step.
 * @returns The clause, led by a colon or a comma, or an empty text when the step has none.
 * @example
 * stepDetail('router', 90, 'absent', undefined) // => ': the page exposes no Next router (window.next.router is absent)'
 * stepDetail('inputs', 90, undefined, '#email') // => ', at the input #email (the inputs before it were written)'
 */
function stepDetail(
  stage: NextSetupStage,
  budgetSeconds: number,
  routerState: NextRouterState | undefined,
  pendingInputSelector: string | undefined,
): string {
  if (stage === 'router' && routerState === 'absent')
    return ': the page exposes no Next router (window.next.router is absent)'
  if (stage === 'router' && routerState === 'late')
    return `: the router did not become ready within ${budgetSeconds} s`
  if (stage === 'inputs' && pendingInputSelector !== undefined)
    return `, at the input ${pendingInputSelector} (the inputs before it were written)`
  return ''
}

/**
 * Words the setup-deadline sentence of a Next Pages run without its code, naming the budget, the step it reached and what happened to the browser.
 *
 * Why it exists: a deadline expiry has no thrown error, so the run's timer builds this text and leads it with its code and variant ({@link formatRefusalFailure}); it mirrors {@link viteSetupDeadlineSentence}. Called by the configured browser run when a Pages run's setup budget expires.
 * @param step - The setup step reached, one of {@link NEXT_SETUP_STEPS}.
 * @param budgetMs - The setup budget that expired.
 * @param routerState - At the router step: `absent` when the page exposes no `window.next.router`, `late` when it never turned ready; ignored at any other step.
 * @param pendingInputSelector - At the input step: the selector of the input being written, whose earlier inputs were written; ignored at any other step.
 * @returns The sentence; the dynamic values (the step, the budget, the selector) stay in this message, never in the recovery.
 * @example
 * nextSetupDeadlineSentence(NEXT_SETUP_STEPS.waitingForRouter, 90_000, 'absent')
 * // => 'Repository setup deadline (90 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the page exposes no Next router (window.next.router is absent). Codebook stopped the server it started; the browser Codebook opened was closed and no input or click was sent.'
 */
export function nextSetupDeadlineSentence(
  step: NextSetupStep,
  budgetMs: number,
  routerState?: NextRouterState,
  pendingInputSelector?: string,
): string {
  const { browserState, stage } = NEXT_SETUP_STEP_FACTS[step],
    budgetSeconds = Math.round(budgetMs / MILLISECONDS_PER_SECOND)
  const detail = stepDetail(
    stage,
    budgetSeconds,
    routerState,
    pendingInputSelector,
  )
  return `Repository setup deadline (${budgetSeconds} s) exceeded while ${step}${detail}. Codebook stopped the server it started; ${browserState}.`
}
