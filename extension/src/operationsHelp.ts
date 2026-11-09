import {
  ASK_LEARNER_SECRET,
  MILLISECONDS_PER_SECOND,
  OPERATION_PRESS_REASONS,
  OPERATION_SETTLE_BOUND_MS,
  OPERATION_SETTLE_QUIET_MS,
  REPLAY_DEBUG_ENGINE_INTERNAL_NAMES,
  REPLAY_DEBUG_INTERNALS_NOT_RECORDED,
  REPOSITORY_OPERATION_ACTION,
  REPOSITORY_OPERATION_LIMIT,
  PRESS_MINIMUM_API,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  SECONDS_PER_MINUTE,
  SECRET_FRAME_VALUE_COPY_MIN_CHARS,
  SERVER_STOP_IMAGE_UNAVAILABLE_TEXT,
  STOP_IMAGE_UNAVAILABLE_TEXT,
  type PressRefusalReason,
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
  'SERVER_STOP_NOT_REACHED',
  'ENTRY_LOAD_TIMEOUT',
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

/** How long the saved-session confirmation waits for the learner, in whole minutes, as the help words it. */
const CONFIRMATION_WAIT_MINUTES =
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS /
  MILLISECONDS_PER_SECOND /
  SECONDS_PER_MINUTE

/**
 * A neutral `press` operation for the help: a key the app's own handler tests, and an `after` condition only the opened UI satisfies.
 * Every selector and title is a placeholder the agent replaces with values read from the app's source; a test parses it inside a configuration with the live schema, so it cannot drift from the schema.
 */
const OPERATIONS_PRESS_EXAMPLE = {
  kind: 'press',
  title: 'Close the open panel',
  key: 'Escape',
  after: [{ kind: 'visible', selector: '#closed-notice' }],
} as const

/** What each refusal of a press says and how to fix it, keyed by the closed list {@link OPERATION_PRESS_REASONS}; the `Record` type makes a reason added there fail to compile until it has a row. */
const PRESS_REFUSAL_ROWS: Record<
  PressRefusalReason,
  { when: string; path: string; fix: string }
> = {
  'press-focus-in-text-entry': {
    when: 'The press declares no selector and the key would go to the focused text-entry control, where it would be typed: a textarea, a select, a contenteditable element, or an input of any type except button, submit, reset, checkbox, radio, range, image, file, color and hidden.',
    path: 'operations[i]',
    fix: 'Declare operations[i].selector as that control if the key is meant for it; otherwise add an earlier click on a non-text element to move focus away.',
  },
  'press-secret-control': {
    when: 'The key would go to a control that reads as a secret.',
    path: 'operations[i], or operations[i].selector when the press declares a selector',
    fix: `A key never goes to a secret control: click the submit control, or use secret: "${ASK_LEARNER_SECRET}" on a text operation.`,
  },
  'press-target-not-focusable': {
    when: 'The declared selector names an element that cannot take focus.',
    path: 'operations[i].selector',
    fix: 'Omit selector to send the key to the page, or name a focusable element.',
  },
  'press-focus-changed': {
    when: 'Focus moved between the check and the send, so nothing was sent.',
    path: 'operations[i], or operations[i].selector when the press declares a selector',
    fix: 'Start one new run, and ask the learner first when earlier operations ran.',
  },
  'press-focus-in-frame': {
    when: 'The focus or the declared target is a frame (iframe, frame, object or embed) whose content Codebook cannot read.',
    path: 'operations[i], or operations[i].selector when the press declares a selector',
    fix: 'Click an element of the top document to move focus out of the frame, or name a top-document element with operations[i].selector.',
  },
  'press-after-already-holds': {
    when: "The press's own after conditions already hold before the key, so they could not prove it worked.",
    path: 'operations[i].after',
    fix: 'Declare an after condition that only the opened UI satisfies.',
  },
}

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
 * @returns Keys to spread into the help object: `operationsQuickStart`, `operationsDeclare`, `operationsPress`, `operationsSecrets` and `operationsErrorCodes`, the last derived from {@link OPERATIONS_ERROR_CODES} with each code's audience and recovery taken from {@link ERROR_RECOVERY}.
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
          need: 'a screen or menu that only a keyboard shortcut opens',
          use: `version 3 with a press operation (API ${PRESS_MINIMUM_API} or later): read the app's own shortcut handler for the key, then see codebook://help/repository-browser#press`,
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
        'Poll the run resource it names while it reads preparing, until it reads ready, paused (read inspectionUri and sourceUri, then codebook_continue) or a failed state with an error code; read nextActions: it offers repository-operation while an operation is left.',
        `codebook_action ${REPOSITORY_OPERATION_ACTION}: one call per operation, each with a new key; the run takes the next declared operation in order, so a call names no index.`,
        'Read the run resource after every call; its operations[i] tell what the run did.',
        'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource. Send the next operation only when the run reads ready again. A stop declared with hold: "record" (API 1.43) is never paused, so do not wait for it and do not call codebook_continue for it; after the operation\'s result read recordedStops and the recorded observations, then explain them.',
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
      recordedStops: {
        minimumApi: '1.43',
        field:
          'hold: "explain" (the default, and what a stop without the field does) or hold: "record", optional on the top-level stop and on each additionalStops entry of a version 3 configuration. A stop with afterOperation 0 refuses "record" with the field\'s path, and a version 1 or 2 configuration refuses hold as an unknown field.',
        whenToRecord:
          "Declare record for a stop inside a request that the app bounds with its own deadline or timeout, which you find by reading that request's code (a client wrapper, server middleware or a transaction helper): the target's own clocks keep running while a held stop waits, so a long explanation ends the request before the next stop or the result. Never declare record merely to avoid explaining; a stop in code without a deadline stays held.",
        whatHappens:
          "Codebook captures a recorded stop's observation (values, scopes, call stack and image) as for a held stop, then continues at once without the chat. The run never shows it paused; the run resource lists the zero-based declared stop indexes recorded in recordedStops, in order (the top-level stop is 0, additionalStops[i] is i + 1). Held and recorded stops may be mixed.",
        explaining:
          "After the operation's result, explain each recorded stop in order from its recorded observation (its values and call stack). Tell the learner that the program did not wait at a recorded stop. Live inspection at a recorded stop is not available; its recorded values are available in the saved replay's native debugger.",
        stalePause:
          'codebook_continue with the arguments of a recorded stop is refused STALE_PAUSE, and a later held stop stays paused.',
        olderCodebook:
          'Declare record only when codebook_status reports API 1.43 or later; an older Codebook refuses the field as INVALID_CONFIGURATION.',
      },
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
      savedSessionConfirmation: {
        anchor: 'codebook://help/repository-browser#saved-session-confirmation',
        when: `A version 3 run that starts with the learner's saved session (the run resource reads session saved) asks the learner once, before operation 1. The first ${REPOSITORY_OPERATION_ACTION} call opens an editor dialog listing the page (already opened with the saved session), that the run changes the app's real data and keeps the data the app already had, and each operation: a secret as (hidden), a choice by its visible label, or (chosen when sent) when the option is not on the page yet. The call waits for the answer for at most ${CONFIRMATION_WAIT_MINUTES} minutes.`,
        values:
          "The run resource reads confirmation: awaiting-learner until the learner answers (the first repository-operation shows the dialog); confirmed after Run <N> operations; declined after Cancel, a closed dialog or no answer in time; not-needed for a run without the saved session, or with the learner's setting off (then confirmationSetting reads off).",
        declined:
          "After a decline the call answers OPERATIONS_NOT_CONFIRMED with isError true. Nothing was sent, the run stays ready and the key stays unused. Every later repository-operation answers OPERATIONS_NOT_CONFIRMED at once, with no dialog, until the learner chooses Review again in the editor's Operations not confirmed notification or the saved-session status item. Relay it and never ask the learner to confirm in the chat. Read the run resource at most every 10 s for at most 5 minutes, and send the next operation (same or new key) only when confirmation reads confirmed.",
        whileAsking:
          'Another key while the dialog is open answers BUSY with reason awaiting-confirmation; the same key joins the dialog. Codebook cannot close a dialog it stopped waiting for (no answer in time, or codebook_stop); an answer to that dialog is ignored and sends nothing. If your call ends before the learner answers (a client timeout), recover by reading the run resource or by sending the same key again, never a new one.',
        fresh:
          'A run without the saved session shows no dialog: it acts on the app\'s local or seeded data without the learner\'s account, as a single click and an extension run do. A configuration that declares session: "fresh" is described in the saved-session section (codebook://help/repository-browser#set-up-a-saved-session).',
        setting:
          'The learner may turn the dialog off for unattended use with codebook.confirmSavedSessionOperations in their user settings; a workspace setting is ignored. Never change it yourself.',
        noEditor:
          'An editor that cannot show the dialog answers PREREQUISITE_MISSING and sends nothing.',
      },
    },
    operationsPress: {
      anchor: 'codebook://help/repository-browser#press',
      summary: `A press operation sends one keyboard key (optionally with Control, Alt, Shift or Meta) to the page, for a screen or menu that only a key opens. It needs codebook_status to report API ${PRESS_MINIMUM_API} or later: compare the number after the dot as a whole number (1.40 is later than ${PRESS_MINIMUM_API}); on an older API say press is not available and tell the learner to update Codebook; never fall back to version 2 for a keyboard-only screen, because version 2 cannot send a key.`,
      choosing: [
        'Prefer entryPath for a screen that has its own URL (and is not a sign-in path).',
        'Then a click operation on a visible link or button.',
        'Use press only for UI that only a key opens.',
      ],
      findingTheKey: [
        "Read the app's own source; never guess a key. Look for key listeners: keydown, keyup, keypress, onKeyDown, hotkey helpers and accelerator tables.",
        'Read which event property the handler tests (key, code, keyCode, or modifier flags such as ctrlKey and metaKey), its guards (for example it ignores keys while an input has focus), and its target (document, window or one element).',
        'If you find no handler, tell the learner so and do not press a guessed key.',
      ],
      declaration: {
        shape:
          '{ kind: "press", title, key, selector?, after } inside operations; the title is distinct like every operation title.',
        example: OPERATIONS_PRESS_EXAMPLE,
        exampleNote:
          'The example is neutral: replace the title, the key and the after selector with what you read in the app. It is not part of the quick-start configuration.',
        key: 'key is the keyboard key and has nothing to do with the idempotency key argument of codebook_start and codebook_action.',
      },
      keyGrammar: [
        'Modifiers are Control, Alt, Shift and Meta, each at most once and in any order, each followed by +; then exactly one key. Codebook sends them in the order Control, Alt, Shift, Meta and shows that canonical spelling everywhere.',
        'The key is one ASCII character from ! to ~ except +, or a name: Enter, Escape, Tab, Backspace, Delete, Space, Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, F1 to F12. A trailing + after a modifier is the plus key (Control++ is Control+Plus); a bare + is refused, write Plus.',
        'Aliases are refused, not accepted: the INVALID_CONFIGURATION cause names the canonical spelling (Ctrl, Cmd, Command, Option, Esc, Return, Del, Up, Down, Left, Right and a literal space).',
        'Codebook sends what a US-layout keyboard sends. A lowercase letter or a digit sends key as written. An uppercase letter alone and a shifted symbol alone (for example ? or !) are sent with Shift, key as written and code of the unshifted US key. An uppercase letter or a shifted symbol together with Control, Alt or Meta is refused: write the unshifted key and add Shift when the handler needs it.',
        'Platform shortcuts: an app may accept Control on one system and Meta on macOS (ctrlKey || metaKey, or a mod helper); declare the modifier the handler accepts on this machine.',
      ],
      pageSees:
        'The page sees key, code, keyCode and which of a US layout and the four modifier flags, as one keydown, a keypress only for a printable key or Enter without Control, Alt or Meta, and one keyup. Read which of them the handler tests.',
      focus: [
        'Omit selector to send the key to the page: it goes to the element that has focus, and the page-level listeners see it.',
        'Name selector to send it to that control: Codebook focuses it first. It must match one visible enabled focusable element in the top document.',
        "A declared selector that does not match exactly one visible enabled element (outside [inert], on the application's origin) is INPUT_NOT_ACCEPTED at operations[i].selector with no reason: fix the selector.",
        'A key never goes to a secret control, and without a selector it never goes to a text-entry control, where it would be typed (see the refusals table).',
        'Focusing the declared selector runs the app\'s own focus handlers, so a refusal after that step (for example press-after-already-holds) still sent no key, with sent "not-sent", but reports sideEffects "unknown": ask the learner before starting a new run.',
      ],
      afterRequired:
        "A press that is not the last operation must declare its own after: a condition only the opened UI satisfies, derived from the app's own source. Omitting it is INVALID_CONFIGURATION at start, naming operations[i].after. For the last press the run-level after applies. A condition that already holds before the key proves nothing, and the press is refused with press-after-already-holds.",
      ignoredKey:
        "OPERATION_AFTER_NOT_MET on a press means the page did not show the effect (wrong key, focus elsewhere, a handler that tests another property, a handler guard): re-read the handler and fix the press, not the operation after it. A pause that begins between Codebook's check and the key can lose the key; after is the proof that the key worked.",
      refusals: {
        anchor: 'codebook://help/repository-browser#press-refusals',
        code: 'INPUT_NOT_ACCEPTED',
        sent: 'not-sent',
        meaning:
          'Each refusal is an INPUT_NOT_ACCEPTED error with sent "not-sent". operationFailure.reason is one of the reasons below and operationFailure.path is the field to fix. The message names the element by tag, type, id and name only, never a value or text.',
        reasons: Object.fromEntries(
          OPERATION_PRESS_REASONS.map((reason) => [
            reason,
            PRESS_REFUSAL_ROWS[reason],
          ]),
        ),
        pausedPage:
          'A press sent while the page is paused fails with RUN_FAILED_UNEXPECTEDLY, sent "not-sent", and a message that names the page as paused at the press.',
      },
      recovery:
        'An invalid declaration (rejected at start, nothing sent) is repaired with one corrected codebook_start. After a refusal or a failure once earlier operations were sent, sideEffects reads unknown: tell the learner what ran and the exact fix, and run the flow again only when the learner asks.',
      limits: [
        `One key per press operation, within the ${REPOSITORY_OPERATION_LIMIT}-operation limit.`,
        'Page only: not an operating-system, browser or editor shortcut, and not a browser-native popup such as an open select list (use choose or click).',
        'A text field that receives the key types it.',
        'A login form whose only submit is Enter inside the password field cannot be driven, because a key never goes to a secret control.',
        "A stop inside the target's own focus handler is not attributed to the press.",
        "A pause that begins after Codebook's last check and before the key-up reaches the page drops the release; nothing can detect it, and after proves the key's effect, not the release. Only an app that tracks held keys is affected.",
        'A key-up sent after a navigation lands in the new document.',
      ],
      olderCodebook: `Before API ${PRESS_MINIMUM_API}, a configuration with kind "press" fails with INVALID_CONFIGURATION naming operations[i].kind, so check the API version first. A run that declares a press is saved as study format 21 whatever else it declares, and an older Codebook lists it as saved by a newer Codebook and keeps it.`,
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
        'A masked value can be a non-secret value of a secret shape (a Cookie-header string of display preferences, an Authorization-shaped string, a URL whose query holds a code), and you never repeat a credential-like value in the chat, in an explanation or in a learning summary, even when one appears unmasked in a captured value.',
      ],
      frames: `Recorded frames and screenshots show what the browser draws. Codebook relies on the browser drawing a password as dots: once a secret was sent, a frame is kept only while Codebook can verify that the page shows the secret nowhere (the control is still a password input, no other plain control holds the value, and the rendered text, the element attributes (CSS attr() content, tooltips) and canvas text calls (fillText, strokeText) hold no new copy of it), and a frame in any window where that cannot be verified is dropped, which the replay shows as an unrecorded gap. A sign-in form that leaves the page after its submit, a re-render that puts another password input in its place, and a new page after a full navigation show nothing and keep recording. If the page shows the secret, or the check cannot answer, capture stops for the rest of the run and the run fails with SECRET_BECAME_VISIBLE. Not checked: WebGL, drawImage of pre-rendered images, CSS content with a literal string in a stylesheet the page builds, closed shadow roots. The content of a frame from another origin (a captcha, a payment field, a sign-in widget) cannot be read, so once a secret was sent every image in which such a frame is drawn on screen is withheld: a recorded frame becomes an unrecorded gap, and a stop or result image reads captures[].status withheld with withheldReason cross-origin-frame while the stop's source and values are kept. A withheld image never fails the run; the run goes on, ends partial and counts withheld images in withheldImages. A browser stop that pauses right after the previous stop's continue, in the same render, may leave the paused page unable to draw its image: its capture then reads captures[].status failed with the reason "${STOP_IMAGE_UNAVAILABLE_TEXT}", the observation has no imageUri, and the run has not failed: the stop keeps its source and values, can be explained and continued, and the run ends partial. A server stop whose page draws no image within the same bound while the server is paused (seen in Cursor) reads captures[].status failed with the reason "${SERVER_STOP_IMAGE_UNAVAILABLE_TEXT}" and keeps its source and values the same way. A frame from another origin that draws nothing (display none, visibility hidden, opacity 0, zero size or outside the viewport) withholds nothing, and the Application view still shows the page live. A secret shorter than ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters cannot be told from ordinary page text, so none reaches this check: the ask-learner box refuses it and stays open, and a version 1 or 2 prepared one for an input of type password fails with SECRET_INPUT_VISIBLE before it is typed.`,
      limits:
        'Other secrets are masked by name and by format only: a session token, or a secret copied into a plainly named variable or printed as ordinary text, can stay visible in a captured value. Use a local test account, never a real one, for any flow that signs in.',
      internals: `A recorded snapshot (the values a saved replay shows in the native debugger) keeps the stop's values and their object, array, Map, Set and Proxy members, but not a function's members or a prototype chain (${REPLAY_DEBUG_ENGINE_INTERNAL_NAMES.join(', ')}): such an entry keeps its preview and reads "${REPLAY_DEBUG_INTERNALS_NOT_RECORDED}" Never present those members as observed values.`,
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
