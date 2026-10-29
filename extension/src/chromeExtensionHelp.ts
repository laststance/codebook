import { z } from 'zod'

import { chromeExtensionConfigSchema } from './chromeExtensionConfigSchemas'
import {
  ACTIVE_TIMEOUT_MS,
  CHROME_EXTENSION_MIN_VERSION,
  CHROME_EXTENSION_PROFILE,
  CHROME_EXTENSION_SAVE_REFUSAL,
  EXTENSION_ACKNOWLEDGED_API_PERMISSIONS,
  EXTENSION_BUNDLED_LINE_LIMIT_CHARS,
  EXTENSION_CLICK_ACTION,
  EXTENSION_CLICK_LIMIT,
  EXTENSION_OBSERVE_BOUND_MS,
  EXTENSION_OBSERVE_READ_LIMIT_BYTES,
  EXTENSION_OBSERVE_SETTLE_MS,
  EXTENSION_OUTPUT_EVENT_LIMIT,
  EXTENSION_SEED_BOOKMARK_LIMIT,
  EXTENSION_SEED_DEPTH_LIMIT,
  EXTENSION_SEED_STORAGE_KEY_LIMIT,
  EXTENSION_SEED_STORAGE_LIMIT_BYTES,
  EXTENSION_STATIC_LOAD_DEPTH_LIMIT,
  EXTENSION_STOP_LIMIT,
  EXTENSION_WAKE_BOUND_MS,
  EXTENSION_WORKER_PAUSE_HOLD_MS,
  MILLISECONDS_PER_SECOND,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from './constants'
import { ERROR_RECOVERY } from './errors'
import {
  CHROME_EXTENSION_EVENT_TYPES,
  chromeExtensionEventFieldNames,
} from './utils/chromeExtensionEventDetail'

/** The prefix of every anchor of this help's refusal table. */
const HELP_URI = 'codebook://help/chrome-extension'

/** When each journaled `chrome-extension.*` event is written; one entry per type of the run's whitelist ({@link CHROME_EXTENSION_EVENT_TYPES}), which a test checks, so a new event cannot reach the journal without a line here. */
const CHROME_EXTENSION_EVENT_WHEN: Record<string, string> = {
  'chrome-extension.click': 'each declared click that was dispatched',
  'chrome-extension.output': `console output of the page or the service worker, at most ${EXTENSION_OUTPUT_EVENT_LIMIT} per run`,
  'chrome-extension.output-dropped':
    'once, with how many output lines the run dropped after its output limit',
  'chrome-extension.prepare-pause':
    'a declared line paused before the run was ready; Codebook resumed it and never offers it as a stop',
  'chrome-extension.repeat-hit':
    'a declared stop that was already captured ran again; it is resumed',
  'chrome-extension.surface-lost':
    'the popup or page closed or left the extension',
  'chrome-extension.context-mismatch':
    'a declared line paused in the other context than the stop declares; it is resumed',
  'chrome-extension.intervention':
    'Codebook stopped or started the service worker, resumed a prepare-pause or re-armed a stop after a worker restart',
  'chrome-extension.phase':
    'every phase transition of the preparation, so a slow or failed start shows where it stopped',
  'chrome-extension.dialog':
    'a JavaScript dialog opened on the surface: answered as the owning click declares, or refused (answer none); clickIndex names the owning click when there is one',
  'chrome-extension.debugger-error':
    'a failure inside the run’s own debugger or dialog handling that it reported instead of failing silently',
  'chrome-extension.view-unavailable':
    'the editor refused to place the Application view (for example a preview tab in the editor group it would use); the run goes on without it, and chromeExtension.viewUnavailable gives the same reason',
}

/**
 * The journal events a chrome-extension run writes (SR32, ER24), generated from the run's whitelist ({@link CHROME_EXTENSION_EVENT_TYPES}): each type with the fields its row publishes and when it is written; the help lists them so a reader of `events/<cursor>` knows what it sees.
 */
export const CHROME_EXTENSION_HELP_EVENTS: readonly {
  type: string
  fields: string
  when: string
}[] = CHROME_EXTENSION_EVENT_TYPES.map((type) => ({
  type,
  fields: chromeExtensionEventFieldNames(type).join(', '),
  when: CHROME_EXTENSION_EVENT_WHEN[type] ?? '',
}))

/** What each code of the table says when it arises and the sentence the refusal carries; the recovery of each is {@link ERROR_RECOVERY}'s, so the table cannot drift from `codebook://help/errors`. `<…>` marks a value the refusal fills in. */
const CODE_FACTS: Record<string, { when: string; sentence: string }> = {
  CHROME_VERSION_UNSUPPORTED: {
    when: 'start (and codebook_status): Chrome is older than 149',
    sentence: `Chrome ${CHROME_EXTENSION_MIN_VERSION} or later is needed to load an unpacked extension; found <version>.`,
  },
  CHROME_COMMAND_UNAVAILABLE: {
    when: 'start: Chrome does not know an Extensions or ServiceWorker command',
    sentence:
      'This Chrome (<version>) does not offer the extension commands Codebook uses; set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later.',
  },
  MANIFEST_UNREADABLE: {
    when: 'start: manifest.json is missing or not valid JSON, or its key is not a public key',
    sentence:
      'The manifest.json could not be read. / The manifest key is not a valid public key.',
  },
  MANIFEST_NOT_V3: {
    when: 'start: manifest_version is not 3',
    sentence: 'The extension root needs a Manifest V3 manifest.json.',
  },
  MANIFEST_SURFACE_MISSING: {
    when: 'start: a popup surface without action.default_popup, or a service-worker stop without background.service_worker',
    sentence:
      'The manifest declares no popup. / The manifest declares no service worker.',
  },
  INVALID_CONFIGURATION: {
    when: 'start: a path outside extensionRoot or the repository, an unknown key (such as inspections), a missing or long click title, duplicate input selectors or a string book',
    sentence:
      '<field> must stay inside the extension root. (other causes name the field)',
  },
  SEED_INVALID: {
    when: 'start: a seed bookmark with both a url and children, a url that is not http or https, or another seed edge',
    sentence:
      'Seed node <path> has both a url and children. / Seed node <path> needs an http or https url.',
  },
  STOP_DUPLICATE: {
    when: 'start: two stops at the same path, line and context',
    sentence: 'Stops <a> and <b> are the same.',
  },
  STOP_FILE_NOT_LOADED: {
    when: 'start: a stop file the surface or the worker does not load statically, an unfollowed specifier form, or an inline script',
    sentence:
      'Stop <n> is in a file the <context> does not load. / Stop <n> is in an inline script; declare it in a script file.',
  },
  BUNDLED_EXTENSION_UNSUPPORTED: {
    when: 'start: a stop file with a sourceMappingURL comment, or a stop line over the bundled-line limit',
    sentence:
      'Stop <n> is in a bundled file; this version explains unbundled extension sources only.',
  },
  PERMISSIONS_NEED_ACKNOWLEDGEMENT: {
    when: 'start: the manifest declares permissions that reach outside the test profile and acknowledgedPermissions does not list exactly those entries',
    sentence:
      'The manifest declares permissions that reach outside the test profile: <list>. Pass them in acknowledgedPermissions after telling the learner.',
  },
  EXTENSION_LINK_OUTSIDE: {
    when: 'start: a link inside the extension folder leaves the repository',
    sentence:
      'The extension folder holds a link outside the repository: <link>.',
  },
  EXTENSION_LOAD_FAILED: {
    when: 'start: Chrome rejected the unpacked extension (manifest field errors, missing files, policy)',
    sentence: "Chrome did not load the extension: <Chrome's message>.",
  },
  EXTENSION_ID_MISMATCH: {
    when: 'start: Chrome loaded the extension under another id than the one computed from its folder',
    sentence: 'Chrome loaded the extension under another id than expected.',
  },
  SEED_NOT_APPLIED: {
    when: 'start: the seeded storage read back differently (the extension overwrote it)',
    sentence: 'The seeded storage was not applied: <key>.',
  },
  SOURCE_CHANGED: {
    when: 'run: a pinned source file changed on disk or in an open editor after the run started',
    sentence: '<file> changed after the run started.',
  },
  SERVICE_WORKER_NOT_ATTACHED: {
    when: 'start, or a click: the worker did not start and attach in time',
    sentence:
      "The extension's service worker did not start while <surface> was open.",
  },
  SERVICE_WORKER_LOST: {
    when: 'run: the worker ended while it was paused',
    sentence: "The extension's service worker stopped while it was paused.",
  },
  SERVICE_WORKER_RESTARTED: {
    when: 'click: the worker restarted during a click',
    sentence: "The extension's service worker restarted during a click.",
  },
  STOP_NOT_BOUND: {
    when: 'start, or after a worker restart: a stop could not be set in its context',
    sentence: 'Stop <n> could not be set in the <context>.',
  },
  RUN_PAUSED: {
    when: 'codebook_action: a declared stop is paused',
    sentence: 'A stop is paused; continue it before the next click.',
  },
  ACTION_IN_PROGRESS: {
    when: 'codebook_action: another click is still in progress',
    sentence: 'A click is still in progress.',
  },
  SELECTOR_NOT_FOUND: {
    when: 'codebook_action: no element matches the click selector; nothing was consumed',
    sentence: 'No element matches <selector> in the extension surface.',
  },
  NO_MORE_ACTIONS: {
    when: 'codebook_action: every declared click was performed',
    sentence: 'Every declared click was performed.',
  },
  INPUT_PARTIAL: {
    when: 'click: a failure after an input was typed, or a lost answer after one',
    sentence:
      'Input <i> of click <n> failed after earlier inputs were typed; the extension may have reacted.',
  },
  CLICK_OUTCOME_UNKNOWN: {
    when: 'click: the answer was lost after the mouse press',
    sentence: "The click's outcome is unknown; the extension may have reacted.",
  },
  OBSERVATION_UNAVAILABLE: {
    when: 'run: the observed result could not be read; the run is completed and claimable is false',
    sentence: 'The result could not be read: <cause>.',
  },
  BROWSER_LOST: {
    when: 'run: the test browser stopped unexpectedly',
    sentence: "The extension's browser stopped unexpectedly.",
  },
  SURFACE_LOST: {
    when: 'run: the popup or page closed or left the extension',
    sentence: 'The extension surface closed or left the extension.',
  },
  POPUP_NOT_OPENED: {
    when: 'start: the extension action opened no popup within five seconds',
    sentence: "The extension's action opened no popup with the seeded state.",
  },
  SURFACE_NOT_ATTACHED: {
    when: 'start: the debugger found no surface to attach to within five seconds',
    sentence: 'The debugger could not attach to the extension <surface>.',
  },
  DIALOG_UNDECLARED: {
    when: 'click: a click opened a JavaScript dialog without a declared dialog answer',
    sentence:
      'Click <n> opened a <type> dialog; declare dialog: accept or dismiss for it.',
  },
}

/** The existing codes this profile answers beside its own, with what each means for an extension run (their recovery text in `codebook://help/errors` is shared with the other profiles). */
const SHARED_CODES = [
  {
    code: 'LEARNER_PAUSED',
    when: 'codebook_action or codebook_continue: the learner paused the extension, set a breakpoint or enabled an exception pause in the native debugger',
    inThisProfile:
      'Codebook never resumes a learner pause: ask the learner to continue in the debugger, then read the run resource.',
  },
  {
    code: 'IDEMPOTENCY_CONFLICT',
    when: 'codebook_action or codebook_start: a key used again with other arguments',
    inThisProfile:
      'Send the original arguments with that key, or a new key for a new click; the same key with the same arguments returns the original receipt.',
  },
  {
    code: 'BUSY',
    when: 'codebook_start: another run is active, or the action is not extension-click',
    inThisProfile:
      'A completed or failed extension run is released at once and does not make a new start busy.',
  },
  {
    code: 'STALE_PAUSE',
    when: 'codebook_continue: the arguments name a pause that is no longer open (for example from a replaced worker)',
    inThisProfile:
      'Read the run resource and copy continueArguments from one entry of chromeExtension.pauses.',
  },
  {
    code: 'NO_PAUSE',
    when: 'codebook_continue: nothing is paused at a declared stop',
    inThisProfile:
      'Read the run resource; continue only a pause it lists in chromeExtension.pauses.',
  },
  {
    code: 'RUN_NOT_READY',
    when: 'codebook_action: the run is not ready (still preparing, failed or released)',
    inThisProfile:
      'Read the run resource until chromeExtension.phase is ready; the click-sending advice for other profiles does not apply.',
  },
] as const

/** The three extension source files of the worked example, line by line; the stops of its configuration are found by their marker comment, so the line numbers cannot drift from the listing. */
const WORKED_EXAMPLE_FILES = {
  'manifest.json': [
    '{',
    '  "manifest_version": 3,',
    '  "name": "Ping demo",',
    '  "version": "1.0.0",',
    '  "permissions": ["storage"],',
    '  "action": { "default_popup": "popup.html" },',
    '  "background": { "service_worker": "background.js" }',
    '}',
  ],
  'popup.html': [
    '<!doctype html>',
    '<button id="ping">Ping</button>',
    '<p id="status">idle</p>',
    '<script src="popup.js"></script>',
  ],
  'popup.js': [
    "document.getElementById('ping').addEventListener('click', async () => {",
    "  const reply = await chrome.runtime.sendMessage({ type: 'ping' }) // STOP page",
    "  document.getElementById('status').textContent = reply.answer",
    '})',
  ],
  'background.js': [
    'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {',
    "  if (message.type !== 'ping') return",
    "  const answer = 'pong' // STOP worker",
    '  chrome.storage.local.set({ lastAnswer: answer })',
    '  sendResponse({ answer })',
    '  return true',
    '})',
  ],
} as const

/**
 * Finds the 1-based line of a marker comment in one worked-example file.
 * @param file - The example file's name.
 * @param marker - The marker comment at the end of the stop's line.
 * @returns The line number a stop declares.
 * @example markedLine('popup.js', 'STOP page') // => 2
 */
function markedLine(
  file: keyof typeof WORKED_EXAMPLE_FILES,
  marker: string,
): number {
  return (
    WORKED_EXAMPLE_FILES[file].findIndex((line) => line.includes(marker)) + 1
  )
}

/** The book selection every sample shares: values that come from another answer are written as placeholders naming that answer; a test replaces them before it parses a sample with {@link chromeExtensionConfigSchema}. */
const SAMPLE_BOOK = {
  bookId: '<bookId from codebook_publish_book>',
  revision: '<revision from codebook_publish_book>',
  nodeId: '<id of the published node that cites the extension files>',
  anchorIndex: 0,
}

/**
 * Builds a start of the chrome-extension profile around a declaration.
 * @param configuration - The declaration's fields after `version`, `adapter` and `book`.
 * @returns The `codebook_start` arguments with placeholders for what another answer gives.
 * @example sampleStart({ extensionRoot: 'extension' }).profile // => 'chrome-extension'
 */
function sampleStart(configuration: Record<string, unknown>) {
  return {
    instanceId: '<instanceId from codebook_status>',
    profile: CHROME_EXTENSION_PROFILE,
    key: '<a new key for this start>',
    configuration: {
      version: 1,
      adapter: 'chrome-mv3-unpacked',
      book: SAMPLE_BOOK,
      ...configuration,
    },
  }
}

/** The smallest valid declaration (SR27's generic shape): a popup, one titled click, one page stop and the popup observation. */
const QUICK_START_EXAMPLE = sampleStart({
  extensionRoot: '<folder holding manifest.json, from codebook_sources>',
  surface: { kind: 'popup' },
  clicks: [{ title: 'Press the main button', selector: '#main-button' }],
  stops: [
    {
      path: '<popup script, relative to extensionRoot>',
      line: 12,
      context: 'page',
    },
  ],
  observe: { kind: 'popup' },
})

/** The declaration of the worked example: the popup button sends a message, the worker answers; one stop in each context, the worker's stored answer observed. */
const WORKED_EXAMPLE_CONFIGURATION = sampleStart({
  extensionRoot: 'ping-extension',
  surface: { kind: 'popup' },
  clicks: [{ title: 'Press Ping', selector: '#ping' }],
  stops: [
    {
      path: 'popup.js',
      line: markedLine('popup.js', 'STOP page'),
      context: 'page',
    },
    {
      path: 'background.js',
      line: markedLine('background.js', 'STOP worker'),
      context: 'service-worker',
    },
  ],
  observe: { kind: 'text', selector: '#status' },
})

/** The three failure examples (DXR14): each with what the chat sent, the answer it got and the declaration that works. */
const FAILURE_EXAMPLES = [
  {
    name: 'A stop in a bundled file',
    sent: {
      stops: [{ path: 'dist/popup.bundle.js', line: 4021, context: 'page' }],
    },
    answer: {
      code: 'BUNDLED_EXTENSION_UNSUPPORTED',
      message:
        'Stop 1 is in a bundled file; this version explains unbundled extension sources only. (It names the rule that fired: a sourceMappingURL comment, or a stop line over the limit.)',
      anchor: `${HELP_URI}#BUNDLED_EXTENSION_UNSUPPORTED`,
    },
    corrected:
      'Point the stop at the unbundled source the extension is built from only when that source is the file the manifest and the popup load; otherwise choose another file the extension loads unbundled, or explain that part from source in the chat.',
    correctedStops: [{ path: 'popup.js', line: 2, context: 'page' }],
  },
  {
    name: 'A worker stop on startup code',
    sent: {
      stops: [{ path: 'background.js', line: 1, context: 'service-worker' }],
    },
    answer: {
      code: undefined,
      message:
        "Not a refusal: the run completes with result 'partial' and chromeExtension.stopsNotReached: [1], because worker startup code ran before the run was ready and no stop pauses there.",
      anchor: `${HELP_URI}#stop-rules`,
    },
    corrected:
      'Declare a stop inside a handler an event runs after ready (a message, alarm or storage listener), not on a top-level line.',
    correctedStops: [
      {
        path: 'background.js',
        line: markedLine('background.js', 'STOP worker'),
        context: 'service-worker',
      },
    ],
  },
  {
    name: 'A popup surface in a manifest without action.default_popup',
    sent: { surface: { kind: 'popup' } },
    answer: {
      code: 'MANIFEST_SURFACE_MISSING',
      message: 'The manifest declares no popup.',
      anchor: `${HELP_URI}#MANIFEST_SURFACE_MISSING`,
    },
    corrected:
      'Declare the popup in the manifest ("action": { "default_popup": "popup.html" }), or choose the page surface with an .html file of the extension.',
    correctedSurface: { kind: 'page', path: 'options.html' },
  },
] as const

/** The seconds of the pause hold and the continuation wait the help names. */
const PAUSE_HOLD_SECONDS =
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS / MILLISECONDS_PER_SECOND

/**
 * Builds the body of `codebook://help/chrome-extension`: the quick start first (the minimal declaration and the call order with the answer each value is copied from), then the configuration schema, vocabulary, phase and click-outcome table, stop rules, seed rules, limits, the disclosures, the refusal table generated from {@link ERROR_RECOVERY}, the journal events, three failure examples and a worked example of a generic extension.
 * Called by {@link readResource}; it holds nothing about any repository's extension.
 * @returns The JSON-serializable help.
 * @example
 * chromeExtensionHelp().codes[0].anchor // => 'codebook://help/chrome-extension#CHROME_VERSION_UNSUPPORTED'
 */
export function chromeExtensionHelp() {
  // The table follows errors.ts: every code whose recovery names this help's anchor, then the shared codes this profile answers.
  const ownCodes = Object.entries(ERROR_RECOVERY)
    .filter(([code, recovery]) => recovery.includes(`${HELP_URI}#${code}`))
    .map(([code, recovery]) => ({
      code,
      anchor: `${HELP_URI}#${code}`,
      when: CODE_FACTS[code]?.when ?? 'see the recovery',
      sentence: CODE_FACTS[code]?.sentence ?? '',
      recovery,
    }))
  const sharedCodes = SHARED_CODES.map(({ code, when, inThisProfile }) => ({
    code,
    anchor: `${HELP_URI}#${code}`,
    when,
    sentence: 'The existing sentence of the code.',
    recovery: ERROR_RECOVERY[code],
    inThisProfile,
  }))
  return {
    profile: CHROME_EXTENSION_PROFILE,
    quickStart: {
      summary:
        "Use codebook_start with profile chrome-extension to load the repository's own unpacked Manifest V3 extension into a fresh test Chrome, perform up to three declared clicks in its popup or an extension page, stop in its page or service-worker source in the native debugger, and read the observed result. The run executes the repository's extension code with the permissions its manifest declares, against seeded test data.",
      callOrder: [
        'codebook_status: copy instanceId; chrome-extension is ready when Google Chrome or Chrome for Testing 149 or later is found (codebook.chromeExecutable names another), on macOS or Linux. A missing item is named with its fix.',
        `${HELP_URI} (this resource): the minimal declaration below, then the reference sections.`,
        'codebook_sources, then codebook_source: find the folder that holds manifest.json (extensionRoot), then read the popup or page script, the service worker and the lines to stop at. Copy each path (relative to extensionRoot) and choose the 1-based stop lines from numberedText. Each stop is a line an event or a click runs after the page loaded.',
        'codebook_publish_book: only the published book is needed, and only when the book object of the declaration has to name one: publish an article whose node cites the extension files, and copy bookId, revision and the node id into configuration.book (the same shared object and the same source discovery and publication steps as codebook://help/node-server).',
        'codebook_start with the declaration and a new key: it answers after the extension was loaded, with the manifest name, permissions and host_permissions the run uses (tell the learner), or with the refusal and the run state; copy instanceId and runId from the answer. A preparation still under way after 40 s answers its phase without the manifest: read the run resource until chromeExtension.phase is ready (chromeExtension.manifest then names the same fields) or failed, before the first click.',
        `codebook_action with action ${EXTENSION_CLICK_ACTION} and a new key per click: it performs the next declared click and answers clickIndex, outcome, inputsApplied, clickDispatched, inputEffects and clickEffect. clickDispatched is true once Chrome answered the press; clickEffect unknown with clickDispatched false means the press was sent and is not answered yet, as when a stop paused inside the click's handler. Reuse the same key if the answer is lost.`,
        "Read the run resource (runUri): while chromeExtension.phase is paused, explain each entry of chromeExtension.pauses from its captured values in the chat and in the native debugger, then codebook_continue with that entry's continueArguments copied exactly (participant extension, sessionId, threadId, generation). After outcome running, read the run resource instead of continuing.",
        'When chromeExtension.phase is completed, report the result from chromeExtension.observed, as observed only when claimable is true; codebook_stop releases a run that is still live.',
      ],
      copiedFrom: {
        instanceId: 'codebook_status',
        'configuration.book': 'codebook_publish_book',
        'configuration.extensionRoot': 'codebook_sources',
        'configuration.stops[].path and line': 'codebook_source numberedText',
        'configuration.clicks[].selector':
          'the surface HTML read with codebook_source',
        'runId (every call after the start)': 'the answer of codebook_start',
        continueArguments:
          'one entry of chromeExtension.pauses of the run resource',
      },
      example: QUICK_START_EXAMPLE,
    },
    configurationSchema: z.toJSONSchema(chromeExtensionConfigSchema, {
      io: 'input',
    }),
    vocabulary: [
      { term: 'profile', meaning: CHROME_EXTENSION_PROFILE },
      { term: 'action', meaning: EXTENSION_CLICK_ACTION },
      { term: 'participant', meaning: 'extension (codebook_continue)' },
      {
        term: 'contexts',
        meaning:
          'page (the popup or extension page) and service-worker (the extension background)',
      },
      { term: 'adapter', meaning: 'chrome-mv3-unpacked' },
      {
        term: 'surface',
        meaning:
          "popup (the manifest's action.default_popup) or page (an .html file of the extension)",
      },
      {
        term: 'index base',
        meaning:
          'Every index in answers, the run resource and sentences is 1-based: clickIndex, stopsNotReached, stopIndex; stop 1 is the first declared stop and click 1 the first declared click. A seed node path is its titles joined with / from the top, for example Work/Docs.',
      },
    ],
    phases: [
      {
        phase:
          'starting, launching, installing, opening, attaching, waking, arming',
        meaning:
          'Preparation. Nothing here is a learning stop; a declared line that pauses here is resumed by Codebook (chrome-extension.prepare-pause).',
        clickOutcome: 'no click is accepted yet (RUN_NOT_READY)',
      },
      {
        phase: 'ready',
        meaning:
          'The observation baseline was read; the next declared click can be sent.',
        clickOutcome:
          'outcome running: the click counts as performed and the run is still working; read the run resource. outcome settled: the work ended without a stop.',
      },
      {
        phase: 'paused',
        meaning:
          'A declared stop is paused; chromeExtension.pauses lists every open pause with its own continueArguments.',
        clickOutcome:
          'outcome paused (the click ran into a stop); another click answers RUN_PAUSED until the pauses are continued.',
      },
      {
        phase: 'observing',
        meaning: `After the last click, once nothing is paused and no stop is reached for ${EXTENSION_OBSERVE_SETTLE_MS / MILLISECONDS_PER_SECOND} s, the run reads the observed result (up to ${EXTENSION_OBSERVE_BOUND_MS / MILLISECONDS_PER_SECOND} s).`,
        clickOutcome:
          'none: every declared click was performed (NO_MORE_ACTIONS)',
      },
      {
        phase: 'completed',
        meaning:
          'The observation ended. result is complete, or partial when any declared stop was not reached (stopsNotReached). The run is released at once and its resource stays readable; a new start is not busy.',
        clickOutcome: 'none',
      },
      {
        phase: 'failed',
        meaning:
          'A failure ended the run and its cleanup ran; the error names the code (see the refusal table).',
        clickOutcome: 'the click that met the failure answers its error code',
      },
    ],
    resultFields: {
      claimable:
        'true only when the run completed and its observation was read (changed, unchanged or missing). Report a result as observed only when claimable is true.',
      changed:
        'chromeExtension.observed.changed compares the value before the first click with the value after the last one. When changed is false, never say the clicks caused a result.',
      observed:
        'before and after each read: a value (masked, cut), missing (the element or key is absent), or unavailable with its cause. A real null is a value and differs from missing and unavailable. observed is null after a stop before the last click.',
      stopsNotReached:
        '1-based indexes of declared stops that did not pause; the result then reads partial.',
    },
    codes: [...ownCodes, ...sharedCodes],
    events: CHROME_EXTENSION_HELP_EVENTS,
    stopRules: [
      'A page stop must be in a file the surface HTML loads with a static <script src>, or that such a file loads with a static import.',
      'A service-worker stop must be in the manifest background.service_worker file or a file it loads: string-literal importScripts for a classic worker, a static import for "type": "module".',
      `Static loads are followed to depth ${EXTENSION_STATIC_LOAD_DEPTH_LIMIT} through <script src>, import, export … from and literal importScripts, resolving relative and root-absolute specifiers, chrome-extension:// URLs of the run's own id and a <base href> inside the extension.`,
      'Not followed: import.meta.url paths, import maps, conditional or computed imports, dynamic imports and bare package specifiers. A stop reached only through them is refused with STOP_FILE_NOT_LOADED naming the form.',
      'A stop in an inline <script> is refused with STOP_FILE_NOT_LOADED; declare it in a script file.',
      'No worker startup code: a worker stop on a top-level line never pauses after ready and is reported in stopsNotReached. Codebook stops and starts the worker before the clicks, so startup code runs before the run is ready.',
      'No page startup code: a page stop on a top-level or DOMContentLoaded line runs before the debugger attaches and is reported in stopsNotReached.',
      'A worker stop works only while an extension page is open, so the worker is reachable: the popup or page surface of the run keeps it open.',
      `A bundled file is refused with BUNDLED_EXTENSION_UNSUPPORTED: a stop file with a sourceMappingURL comment, or whose stop line is over ${EXTENSION_BUNDLED_LINE_LIMIT_CHARS} characters. A long line elsewhere in the file does not refuse it.`,
      'No content script, no stop in a page of another origin, and no stop in code another extension runs.',
    ],
    seedRules: [
      `seed.bookmarks: up to ${EXTENSION_SEED_BOOKMARK_LIMIT} nodes in total and depth ${EXTENSION_SEED_DEPTH_LIMIT}; a node is { title, url? , children? }; a node with neither url nor children is an empty folder; a node with both is SEED_INVALID; a url must be http or https.`,
      `seed.storage: up to ${EXTENSION_SEED_STORAGE_KEY_LIMIT} keys and ${EXTENSION_SEED_STORAGE_LIMIT_BYTES} bytes as JSON, written to the extension's local storage before the surface opens and read back (SEED_NOT_APPLIED when the extension overwrote it).`,
    ],
    limits: [
      `At most ${EXTENSION_CLICK_LIMIT} clicks (each with a title of 1 to 80 characters, a selector, an optional kind click or dblclick, an optional dialog accept or dismiss and optional inputs) and ${EXTENSION_STOP_LIMIT} stops.`,
      `The run deadline is ${REPOSITORY_RUN_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s; a pause longer than ${PAUSE_HOLD_SECONDS} s ends the run (${EXTENSION_WORKER_PAUSE_HOLD_MS / MILLISECONDS_PER_SECOND} s for a service-worker stop); a continuation answer waits about ${(ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND).toFixed(0)} s and then reports the latest state without next.`,
      `The service worker is awaited ${EXTENSION_WAKE_BOUND_MS / MILLISECONDS_PER_SECOND} s before each click.`,
      `An observed read is at most ${EXTENSION_OBSERVE_READ_LIMIT_BYTES} bytes; a larger value reads unavailable.`,
      `At most ${EXTENSION_OUTPUT_EVENT_LIMIT} console lines are journaled per run.`,
      'One run is active at a time; a run that completed or failed is released at once.',
      `A chrome-extension run is live only: it is not saved, has no replay, and codebook_explain and codebook_explain_node_history refuse it with the sentence "${CHROME_EXTENSION_SAVE_REFUSAL}"`,
    ],
    disclosures: {
      testProfile:
        "The run's browser profile is a fresh one with seeded test data; the learner's own Chrome data (bookmarks, cookies, passwords, extensions) is never used.",
      extensionCode:
        "The extension's own code, including its network requests, runs as it would in any local run, with the permissions its manifest declares; codebook_start answers the manifest's name, permissions and host_permissions so the learner can be told.",
      acknowledgedPermissions: `A manifest that declares ${EXTENSION_ACKNOWLEDGED_API_PERMISSIONS.join(', ')}, host permissions that match all hosts, or a private-network host is refused with PERMISSIONS_NEED_ACKNOWLEDGEMENT until configuration.acknowledgedPermissions lists exactly those entries; tell the learner first. No dialog asks.`,
      workerRestart:
        "Codebook restarts the extension's service worker before the clicks (and again before a click when the worker idled out), and lists each such step in chromeExtension.interventions. Worker startup, idle shutdown and wake timing are therefore not observed by the run: explain them as source reasoning, labeled so.",
      debuggingPort:
        "The test browser's debugging port is random and bound to 127.0.0.1; web pages cannot reach it, but any local process of the same user can reach it while the run lives, the same trust boundary as the profile folder.",
      chromeExecutable: `Chrome 149 or later is needed. Set the VS Code setting codebook.chromeExecutable to Google Chrome or to Chrome for Testing ${CHROME_EXTENSION_MIN_VERSION} or later when the default Chrome is older or missing (CHROME_VERSION_UNSUPPORTED, CHROME_COMMAND_UNAVAILABLE).`,
      liveOnly:
        'The Application view shows the live extension surface; it is the only record of the run besides the run resource and its journal.',
    },
    failureExamples: FAILURE_EXAMPLES,
    workedExample: {
      description:
        'A generic extension: the popup button sends a message and the extension service worker answers it. One stop in the popup script (the page) and one in the worker (the service-worker context); the observed text is the popup status line the answer writes.',
      files: WORKED_EXAMPLE_FILES,
      start: WORKED_EXAMPLE_CONFIGURATION,
      expectation:
        'Click 1 answers outcome paused at the page stop (stop 1, before the message is sent); continue it, the worker stop (stop 2) pauses next; continue it, the popup shows pong, the run observes #status and completes with claimable true and observed.changed true (idle before, pong after).',
    },
    recovery:
      'A lost response is recovered by reading the run resource, never by clicking again: codebook_action with the same key returns its receipt, and chromeExtension.lastClick, chromeExtension.procedure and the error say what happened. A failed run never continues: read its error, then start at most one new run when the recovery of its code allows it.',
  }
}
