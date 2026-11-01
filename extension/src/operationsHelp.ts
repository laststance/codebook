import {
  ASK_LEARNER_SECRET,
  MILLISECONDS_PER_SECOND,
  OPERATION_SETTLE_BOUND_MS,
  OPERATION_SETTLE_QUIET_MS,
  REPOSITORY_OPERATION_ACTION,
  REPOSITORY_OPERATION_LIMIT,
  SECRET_FRAME_VALUE_COPY_MIN_CHARS,
} from './constants'
import { ERROR_RECOVERY, type ErrorCode } from './errors'

/**
 * Every code a version 3 run adds, in the order the help's error table lists them: the refusals of one operation, then the failures that end a run.
 * The recovery text of each code names the anchor `codebook://help/repository-browser#<CODE>` that {@link operationsHelp} serves.
 */
export const OPERATIONS_ERROR_CODES = [
  'OPERATIONS_NOT_CONFIRMED',
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
  'SIGN_IN_REQUIRED',
  'SIGN_IN_IN_PROGRESS',
  'SIGN_IN_PROFILE_IN_USE',
  'SIGN_IN_PROFILE_UNUSABLE',
  'SIGN_IN_ORIGIN_REFUSED',
] as const satisfies readonly ErrorCode[]

/** One code of {@link OPERATIONS_ERROR_CODES}. */
type OperationsErrorCode = (typeof OPERATIONS_ERROR_CODES)[number]

/**
 * A valid version 3 configuration, generic on purpose: every identity and hash is a placeholder the agent replaces with the value the step named in {@link OPERATIONS_QUICK_START_COPY_FROM} returned.
 * It declares one operation of each kind, the password as `secret: "ask-learner"`. The help serves it as `operationsQuickStart.configuration`, and a test parses it with the public schema so it cannot drift from the schema.
 */
export const OPERATIONS_QUICK_START_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'src/app/signup/form.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 24,
    column: 5,
  },
  participant: 'browser',
  afterOperation: 4,
  entryPath: '/signup',
  before: [{ kind: 'visible', selector: '#email' }],
  after: [
    {
      kind: 'text',
      selector: '[data-testid="result"]',
      equals: 'Account created',
    },
  ],
  operations: [
    {
      kind: 'text',
      title: 'Type the email',
      selector: '#email',
      text: 'learner@example.test',
    },
    {
      kind: 'text',
      title: 'Type the password',
      selector: '#password',
      secret: ASK_LEARNER_SECRET,
    },
    {
      kind: 'choose',
      title: 'Choose the plan',
      selector: '#plan',
      value: 'basic',
      after: [{ kind: 'text', selector: '#plan-summary', equals: 'Basic' }],
    },
    {
      kind: 'click',
      title: 'Submit the form',
      selector: 'button[type="submit"]',
    },
  ],
  inspections: [{ path: 'value', mode: 'value', required: true }],
} as const

/** Where each placeholder of {@link OPERATIONS_QUICK_START_CONFIGURATION} is copied from. */
const OPERATIONS_QUICK_START_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node',
  'source.path, source.hash':
    'the answer of codebook_source for the file the stop is in (the same path and full SHA-256 as the article cites)',
  'source.line, source.column':
    'one-based position in the numberedText of that codebook_source answer, on a line that the operation named by afterOperation makes run',
  'afterOperation (the configuration and every additionalStops entry)':
    'the one-based number of the operation after whose input the stop is armed; the numbers never decrease along the declared stops',
  entryPath:
    'the path of the page the flow starts on, as the browser address bar shows it',
  'before, after':
    'conditions read from the source or the rendered page: before holds on the fresh page, after holds once the last operation took effect (the last operation without its own after uses this one); never guess a library default',
  'operations[].selector':
    'a CSS selector accepted by querySelectorAll that matches exactly one visible enabled control; read from the source or the rendered page',
  'operations[].value of a choose':
    'the value attribute of an option the native select really offers',
  'inspections[].path':
    'a primitive the stop can read at that line, found in the same source',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/** The settle bound in whole seconds, as the help words it. */
const SETTLE_BOUND_SECONDS = OPERATION_SETTLE_BOUND_MS / MILLISECONDS_PER_SECOND

/**
 * Reads the audience a recovery text of {@link ERROR_RECOVERY} names, so the help's error table cannot disagree with the error.
 * @param code - A code of {@link OPERATIONS_ERROR_CODES}.
 * @returns `learner` or `chat`; an empty text when the recovery names none.
 * @example operationsAudienceOf('OPERATIONS_NOT_CONFIRMED') // => 'learner'
 */
function operationsAudienceOf(code: OperationsErrorCode): string {
  return /^Audience: (\w+)\./.exec(ERROR_RECOVERY[code])?.[1] ?? ''
}

/**
 * Builds the version 3 part of `codebook://help/repository-browser`: a quick start with a complete valid configuration, the sections "Declare operations" and "Secrets and masking", and the error table with one anchor per code.
 *
 * Why it exists: an agent that must drive several steps of a web flow (type, choose an option, click) needs the whole route, the limits and the secret rules before it reads the long single-click sections. Called by the resource reader for the repository-browser help, which spreads these keys after {@link nextHelp}.
 *
 * @returns Keys to spread into the help object: `operationsQuickStart`, `operationsDeclare`, `operationsSecrets` and `operationsErrorCodes`, the last derived from {@link OPERATIONS_ERROR_CODES} with each code's audience and recovery taken from {@link ERROR_RECOVERY}.
 * @example
 * const help = { ...viteHelp(), ...nextHelp(), ...operationsHelp() }
 * help.operationsErrorCodes.codes.OPTION_NOT_AVAILABLE.anchor // => 'codebook://help/repository-browser#OPTION_NOT_AVAILABLE'
 */
export function operationsHelp() {
  return {
    operationsQuickStart: {
      anchor: 'codebook://help/repository-browser#operations-quick-start',
      summary: `For a web flow of several steps, configuration version 3 declares up to ${REPOSITORY_OPERATION_LIMIT} ordered operations (type text, choose an option of a native select, click) and sends them one at a time with ${REPOSITORY_OPERATION_ACTION}. Use it only when codebook_status lists 3 in profiles[].configurationVersions; otherwise use version 2.`,
      decision: [
        {
          need: 'one click, with optional prepared text typed before it',
          use: 'version 1 (one source file) or version 2 (cross-file or server stops): initialInputs and one action, sent with repository-click',
        },
        {
          need: 'several operations in order (text, choose, click), or stops after different operations',
          use: `version 3: operations, sent with ${REPOSITORY_OPERATION_ACTION}, one call per operation`,
        },
        {
          need: 'a password, a one-time code or another secret typed into the page',
          use: `version 3 with a text operation declared secret: "${ASK_LEARNER_SECRET}": the learner types it in the editor; a secret never comes from the chat`,
        },
      ],
      configuration: OPERATIONS_QUICK_START_CONFIGURATION,
      copyFrom: OPERATIONS_QUICK_START_COPY_FROM,
      callOrder: [
        'codebook_status: confirm 3 is in profiles[].configurationVersions and the adapter you configure is ready under profiles[].prerequisites.adapters; copy instanceId.',
        'codebook_sources, then codebook_source: read the file each stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file; copy bookId, revision and nodeId.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key; the answer is a receipt with a run id, not success.',
        'Poll the run resource it names until the run reads ready, or a failed state with an error code; read nextActions: it offers repository-operation while an operation is left.',
        `codebook_action ${REPOSITORY_OPERATION_ACTION}: one call per operation, each with a new key; the run takes the next declared operation in order, so a call names no index.`,
        'Read the run resource after every call; its operations[i] tell what the run did.',
        'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource. Send the next operation only when the run reads ready again.',
      ],
      receipt: {
        shape: '{ operationId, key, runUri, operationIndex, accepted: true }',
        meaning:
          'An acceptance receipt only: the run took operation operationIndex (numbered from 1). It does not say the text arrived, the option was chosen, the click happened or the page changed. Repeat the same key with the same action only after a lost response; each new key takes the next operation, so a new key never repeats one.',
      },
      progress: {
        where:
          'The run resource lists every declared operation in operations[], each as { index, kind, title, state, ack, valueCheck, effect }.',
        state:
          'not-run, sending, paused (a stop of the operation is open), done or failed. It only moves forward; done and failed are final.',
        ack: "pending or yes: the page took the input. It stays pending while a stop inside the control's input or change handler is paused.",
        valueCheck:
          'pending, passed, failed or n/a (a click has no value): the control holds the value the operation set.',
        effect:
          "pending, dispatched or after-verified: after-verified once the operation's own after conditions held. A non-last operation without its own after reads dispatched when done: Codebook sent it and no condition checked its result. For the last operation, the run-level after decides, and observed.afterVerified reads true.",
        failure:
          'After a refusal or failure the resource adds operationFailure { code, operationIndex, path, sent, sideEffects, logId }: path is the configuration field to fix, sent says whether anything reached the page, sideEffects says whether the app may have changed (unknown too when an earlier operation of the run was sent, so a rerun would repeat it), and logId matches one line in Output > Codebook.',
      },
      firstSuccess:
        'The chat knows the first operation took effect only when the run resource shows operations[0].state done with ack yes, valueCheck passed or n/a and, if you claim its result, effect after-verified. A receipt or a ready state is not that evidence. The whole flow succeeded when every operation reads done and observed.afterVerified is true.',
      stops:
        "Every stop declares afterOperation, the one-based operation after whose input the stop is armed; Codebook arms a stop only in its operation's turn. The declared stops stay in order and afterOperation never decreases from one to the next.",
    },
    operationsDeclare: {
      anchor: 'codebook://help/repository-browser#declare-operations',
      kinds: [
        'text: { kind: "text", title, selector, text } types text into a text-like input, a textarea or a number input. Or { kind: "text", title, selector, secret: "ask-learner" } for a secret, with no text. Exactly one of text and secret.',
        'choose: { kind: "choose", title, selector, value } selects the enabled option with that value in a native single <select>. A custom select (shadcn, Base UI and the like) is no native select: drive it with click operations, one to open it and one for its option.',
        'click: { kind: "click", title, selector } presses the one visible enabled target at its centre.',
      ],
      limits: `Up to ${REPOSITORY_OPERATION_LIMIT} operations; titles are distinct; a text or choose selector must match one visible enabled control, otherwise the operation answers INPUT_NOT_ACCEPTED and nothing is sent. An optional after on an operation is checked before the next operation is offered.`,
      afterOperation:
        "Each stop (the first and every additionalStops entry) declares afterOperation, from 1 to the number of operations, never lower than the stop before it. Stops of different operations are armed one operation at a time, so a stop's line cannot pause the run before its turn.",
      navigation: [
        "Client-side navigation within the app's origin between operations is followed.",
        'A full document load before the last operation fails a Next run with NAVIGATION_BEFORE_LAST_OPERATION: the next operation would act on another page. A load after the last operation is the result (a redirect, for example) and is accepted. Split a flow that navigates in the middle into two runs, the first ending with the operation that navigates. The vite-dev adapter keeps its own reload handling.',
      ],
      settleWait: `Before each operation Codebook waits for the page to be complete with no main-frame navigation for ${OPERATION_SETTLE_QUIET_MS} ms. It watches navigation events and document.readyState only; network traffic and long-lived connections do not delay it. The wait is bounded at ${SETTLE_BOUND_SECONDS} s with no override: past it the run fails with NAVIGATION_NOT_SETTLED and sends nothing more. A route that compiles slowly on first use (a Next development server compiles on demand) is the usual cause: warm it in the run-level before conditions, or split the flow into two runs.`,
      cannotDrive:
        'A send cannot drive a multiple select, a date, range, checkbox or radio input given text, or a contenteditable element: it answers CONTROL_KIND_NOT_SUPPORTED. Use a click operation where the control takes a click (a checkbox, a radio, a custom select).',
      failedFlow:
        'After a failure that may have changed data (operationFailure reads sent "sent" or sideEffects "unknown"), tell the learner which operations the run resource shows as done, offer to save the partial replay, and do not run the flow again unless the learner asks: changes the app made are not undone.',
    },
    operationsSecrets: {
      anchor: 'codebook://help/repository-browser#secrets-and-masking',
      askLearner: `A text operation declared secret: "${ASK_LEARNER_SECRET}" asks the learner. When you send that operation, the editor shows a masked input box titled with the repository and the operation title, and the call waits for the answer; the value goes straight into the page and is never in the chat, the configuration, a receipt or a resource. The box refuses a secret shorter than ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters and stays open, so tell the learner to use a test account password of that length or more. If the learner dismisses the box, leaves it empty or does not answer in time, the call answers OPERATIONS_NOT_CONFIRMED, nothing is sent and the run stays ready: tell the learner what the question was for and ask whether to try again.`,
      neverFromChat:
        'A control that reads as a secret (type password, or a name, id or autocomplete such as current-password, new-password or one-time-code) never receives text from the chat: a text operation with text into it answers SECRET_INPUT_FROM_CHAT and sends nothing. A secret select answers SECRET_INPUT_VISIBLE. Never put a secret in the configuration, the chat or an article.',
      passwordInputOnly:
        'An ask-learner secret goes only into an <input type="password">, which the browser draws as dots; into any other control the operation answers SECRET_INPUT_VISIBLE.',
      masked: [
        `In version 1 and 2 runs, prepared text (initialInputs, and a chrome-extension click's inputs) typed into a secret control reads [masked] in the manifest, the run resource, the saved study and the configuration hash; every prepared text reads [pending] in the run resource until its control is resolved. The page still receives the real text. A prepared secret text into an input of type password is armed on the frame gate with its value before it is typed; one shorter than ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters cannot be told from page text, so the run fails with SECRET_INPUT_VISIBLE and sends nothing: use a test password of that length or more. This changes what a version 1 or 2 run served before API 1.14.`,
        'A value the learner typed for an ask-learner operation is masked wherever Codebook writes or serves run data: inspection values, debugger previews and recorded snapshots, errors, logs, tool results and saved studies.',
      ],
      frames: `Recorded frames and screenshots show what the browser draws. Codebook relies on the browser drawing a password as dots: once a secret was sent, a frame is kept only while Codebook can verify that the page shows the secret nowhere (the control is still a password input, no other plain control holds the value, and the rendered text, the element attributes (CSS attr() content, tooltips) and canvas text calls (fillText, strokeText) hold no new copy of it), and a frame in any window where that cannot be verified is dropped, which the replay shows as an unrecorded gap. A sign-in form that leaves the page after its submit, a re-render that puts another password input in its place, and a new page after a full navigation show nothing and keep recording. If the page shows the secret, or the check cannot answer, capture stops for the rest of the run and the run fails with SECRET_BECAME_VISIBLE. Not checked: WebGL, drawImage of pre-rendered images, CSS content with a literal string in a stylesheet the page builds, closed shadow roots. The content of a frame from another origin (a captcha, a payment field, a sign-in widget) cannot be read, so once a secret was sent every image in which such a frame is drawn on screen is withheld: a recorded frame becomes an unrecorded gap, and a stop or result image reads captures[].status withheld with withheldReason cross-origin-frame while the stop's source and values are kept. A withheld image never fails the run; the run goes on, ends partial and counts withheld images in withheldImages. A frame from another origin that draws nothing (display none, visibility hidden, opacity 0, zero size or outside the viewport) withholds nothing, and the Application view still shows the page live. A secret shorter than ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters cannot be told from ordinary page text, so none reaches this check: the ask-learner box refuses it and stays open, and a version 1 or 2 prepared one for an input of type password fails with SECRET_INPUT_VISIBLE before it is typed.`,
      limits:
        'Other secrets are masked by name and by format only: a session token, or a secret copied into a plainly named variable or printed as ordinary text, can stay visible in a captured value. Use a local test account, never a real one, for any flow that signs in.',
    },
    operationsErrorCodes: {
      anchor: 'codebook://help/repository-browser#error-codes',
      codes: Object.fromEntries(
        OPERATIONS_ERROR_CODES.map((code) => [
          code,
          {
            anchor: `codebook://help/repository-browser#${code}`,
            audience: operationsAudienceOf(code),
            recovery: ERROR_RECOVERY[code],
          },
        ]),
      ),
    },
  }
}
