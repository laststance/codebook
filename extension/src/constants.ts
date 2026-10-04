import { CAPTURE_TIMEOUT_MS } from './runtimeSupport/constants'

export const API_VERSION = '1.6'
export const EXTENSION_VERSION = '0.2.28'
export const CONFIGURED_MINIMUM_EXTENSION_VERSION = '0.2.0'
export const NODE_TEST_MINIMUM_EXTENSION_VERSION = '0.2.12'
export const LOOPBACK_ADDRESS = '127.0.0.1'
export const DYNAMIC_PORT = 0
export const TOKEN_BYTES = 32
export const PRIVATE_DIRECTORY_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600
export const CURSOR_MCP_CATALOG_REFRESH_STEP_MS = 1
export const CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES = 16_384
export const CURSOR_MCP_CATALOG_LOCK_RETRIES = 3
export const CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS = 50
export const CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS = 120_000
export const CURSOR_SKILL_RECEIPT_LIMIT_BYTES = 16_384
/** How often a reconnect checks the shared Cursor skill while another window holds the skill's storage lock, before it reports the lock. */
export const CURSOR_SKILL_RECONNECT_ATTEMPTS = 20
/** How long a reconnect waits before it checks the shared Cursor skill again; with the attempts about two seconds, far above one deployment. */
export const CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS = 100
export const BOOK_INPUT_LIMIT_BYTES = 1_048_576
export const HTTP_ENVELOPE_LIMIT_BYTES = 65_536
export const HTTP_BODY_LIMIT_BYTES =
  BOOK_INPUT_LIMIT_BYTES + HTTP_ENVELOPE_LIMIT_BYTES
export const HTTP_HEADER_LIMIT_BYTES = 8_192
export const HTTP_READ_TIMEOUT_MS = 5_000
export const MAX_IN_FLIGHT_REQUESTS = 32
export const MAX_SESSIONS = 8
export const SESSION_IDLE_TIMEOUT_MS = 300_000
export const MAINTENANCE_INTERVAL_MS = 250
export const MAX_RUNS = 16
export const KEY_LENGTH_LIMIT = 128
export const REFERENCE_LENGTH_LIMIT = 1_024
export const MAX_EXPLANATION_CHARS = 8_192
export const LEARNING_SUMMARY_LIMITS = {
  identifierChars: 48,
  titleChars: 160,
  participantLabelChars: 80,
  participants: 8,
  stepLabelChars: 240,
  steps: 64,
  bytes: 128 * 1024,
}
export const MAX_EXPLANATIONS = 32
export const MAX_VALUE_PATHS = 10
export const EVENT_PAGE_SIZE = 50
export const EVENT_DETAIL_LIMIT_BYTES = 8_192
export const MAX_EVENTS = 10_000
export const MAX_RETAINED_EVENT_BYTES = 4_194_304
export const MAX_QUEUED_EVIDENCE_BYTES = 16_777_216
export const SOURCE_LIMIT_BYTES = 1_048_576
export const IMAGE_LIMIT_BYTES = 8_388_608
export const IMAGE_BASE64_LIMIT_CHARS = 11_184_812
export const PREREQUISITE_TIMEOUT_MS = 5_000
export const MIN_NODE_MAJOR_VERSION = 24
export const NATIVE_COMMAND_POLL_MS = 100
export const NATIVE_EDITOR_START_TIMEOUT_MS = 120_000
export const NATIVE_OBSERVATION_TIMEOUT_MS = 25_000
export const NATIVE_EXPIRY_MARGIN_MS = 2_000
export const NATIVE_AGENT_WINDOW_MS = 300_000
export const CAPTURE_PHASES = [
  'before',
  'paused-server',
  'paused-browser',
  'after',
] as const
export const LEARNING_SCHEMA_VERSION = 1
export const LEARNING_SCHEMA_VERSION_V2 = 2
export const LEARNING_SCHEMA_VERSION_V3 = 3
export const LEARNING_SCHEMA_VERSION_V4 = 4
export const PROGRESS_V2_FILE = 'progress.v2.json'
export const PROGRESS_V3_FILE = 'progress.v3.json'
export const PROGRESS_V4_FILE = 'progress.v4.json'
export const PROGRESS_REPOSITORY_FILE = 'progress.repository.v4.json'
export const STUDY_V2_SUFFIX = '.study.v2.json'
export const STUDY_METADATA_V2_SUFFIX = '.study.meta.v2.json'
export const MAX_STUDY_OBSERVATIONS_V2 = 4
export const MAX_STUDY_CAPTURES_V2 = 7
export const MAX_STUDY_LINKS_V2 = 11
export const STUDY_METADATA_LIMIT_BYTES = 8_192
export const MAX_LEARNER_DECISIONS = 1_000
export const MAX_STUDY_ARCHIVE_BYTES = 67_108_864
export const PROGRESS_LIMIT_BYTES = 1_048_576
export const MAX_STUDY_OBSERVATIONS = 2
export const MAX_STUDY_LINKS = 5
export const DEFAULT_SAVED_STUDY_LIMIT = 64
export const MAX_SAVED_STUDIES = 256
// The reader's error lines that Retry storage / refresh cannot answer: the pane offers Retry only for the others.
export const UNRETRYABLE_READER_ERROR_KINDS: ReadonlySet<string> = new Set([
  'layout',
  'control',
  'replay-control',
  'node-history-control',
  'reading',
  'presentation',
])
// The lines of a refused pane choice that the learner's next handled choice retires: the general one and the Node test history's own, which a Node history message accepted outside browser replay retires as well.
export const CHOICE_RETIRED_ERROR_KINDS: ReadonlySet<string> = new Set([
  'control',
  'node-history-control',
])
// The pane messages by which the learner chooses what the reader shows; one that is handled without an error retires the line of an earlier refused control.
export const CONTROL_RETIRING_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'history',
  'node-history',
  'tab',
  'select',
])
// How many replies to pane open requests the reader keeps while a Recording load is in flight; beyond it the oldest is posted at once.
export const MAX_DEFERRED_OPEN_REPLIES = 32
// The one sentence for a saved study whose archive is gone or on its way to the Trash: read by the library, the reader and the removal refusals.
export const STUDY_ARCHIVE_UNAVAILABLE_MESSAGE = 'Study archive is unavailable.'
// Why a saved study cannot be removed right now; the Study pane shows them beside its button and the host repeats them when it refuses.
export const STUDY_REMOVAL_REFUSALS = {
  nothingChosen: 'Choose a saved study to delete.',
  nodeHistory: 'Node test histories cannot be deleted here yet.',
  runNotStopped: 'Stop the run before deleting its study.',
  recordingOpen:
    'Choose Overview or Live to leave Recording before deleting this study.',
  studyOpening: 'Wait for the chosen saved study to open.',
  unavailable: STUDY_ARCHIVE_UNAVAILABLE_MESSAGE,
} as const
// Where the agent server keeps each instance's connection descriptor and each run's raw evidence, below the extension's global storage.
export const AGENT_STORAGE_DIRECTORY = 'agent'
export const CONNECTION_DESCRIPTOR_SUFFIX = '.connection.json'
export const INVALID_SAVED_STUDY_LIMIT_MESSAGE = `Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to ${MAX_SAVED_STUDIES}. Existing learning was kept.`
export const MAX_SOURCE_DOCUMENTS = 34
export const STUDY_REFRESH_INTERVAL_MS = 250
export const STUDY_EDITOR_GROUP_COUNT = 3
export const LIVE_EDITOR_GROUP_COUNT = 2
export const LIVE_EDITOR_LAYOUT = {
  orientation: 1,
  groups: [{ size: 0.5 }, { size: 0.5 }],
} as const
export const REPOSITORY_MIN_EDITOR_GROUP_COUNT = 2
export const HORIZONTAL_EDITOR_ORIENTATION = 0
export const PRESENTATION_PREFERENCE_KEY = 'codebook.presentation.v1'
export const PRESENTATION_PREFERENCE_VERSION = 1
export const PRESENTATION_READY_TIMEOUT_MS = 5_000
/** Workspace-state key recording that Cursor's learner was offered the Move View step for the Learning summary, so the offer appears once. */
export const SUMMARY_PLACEMENT_OFFER_KEY = 'codebook.summaryPlacementOffer.v1'
/** Why the Learning summary opens on the left in Cursor and how to keep it on the right; Cursor rejects an extension's own secondary side bar container, so only the learner's Move View can place it there. */
export const SUMMARY_PLACEMENT_OFFER =
  'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.'
/** The button of {@link SUMMARY_PLACEMENT_OFFER}; it opens the editor's own Move View list for the focused Learning summary. */
export const SUMMARY_PLACEMENT_ACTION = 'Move Learning Summary…'
/** How long closing the reader waits for each pending storage write (saved replay position, archive writes, library queue); a write still pending then keeps running. */
export const READER_CLOSE_STORAGE_TIMEOUT_MS = 5_000
export const STUDY_LAYOUT_STABLE_MISMATCH_MS = 750
/** The height VS Code and Cursor give an editor group at least (their `DEFAULT_EDITOR_MIN_DIMENSIONS`, 220 × 70 px: the tab row and as much again). A hidden editor area reports every stacked group at this height. */
export const EDITOR_GROUP_MINIMUM_HEIGHT_PX = 70
export const PRESENTATION_READING_LIMIT_PX = 10_000_000
export const PRESENTATION_FOCUS_INDEX_LIMIT = 32
export const PRESENTATION_READING_ANCHORS = [
  'title',
  'learning-material',
  'observation',
  'overview',
  'live-content',
  'source-version',
  'flow',
  'moments',
] as const
export const PRESENTATION_READING_DETAILS = [
  'reader-options',
  'presentation-options',
  'playback-options',
  'playback-diagnostics',
  'later-annotations',
  'study-controls',
  'evidence-details',
] as const
export const PRESENTATION_READING_VISITED = ['source', 'current-file'] as const
export const PRESENTATION_FOCUS_IDS = [
  'previous-moment',
  'next-moment',
  'interpretations',
  'presentation-mode',
  'playback-toggle',
  'playhead',
  'overview-tab',
  'live-tab',
  'recording-tab',
  'understood',
  'profiles',
  'studies',
  'delete-study',
] as const
export const PRESENTATION_FOCUS_ACTIONS = [
  'return-wiki',
  'open-article',
  'return-current',
  'continue',
  'stop',
  'retry',
  'reload-recording',
  'source',
  'current-file',
  'run',
  'click',
  'connect',
  'focus-app',
  'focus-context',
  'read-app',
  'read-source',
  'read-context',
  'outline',
  'arrange',
  'enlarge-app',
  'enlarge-context',
  'show-variables',
] as const
/** Native commands the reader's Show Variables control runs in order: open Run and Debug with Variables expanded and focused, then expand its first scope, which holds the recorded values. The two list commands act on the rows of whichever list holds the focus, so they run only once Variables can hold the presented stop's rows and has not listed its values by itself (see {@link SHOW_NATIVE_VARIABLES_SCOPES_TIMEOUT_MS} and {@link SHOW_NATIVE_VARIABLES_VALUES_WAIT_MS}). A host runs only the ones it registers; a host without the first one opens {@link NATIVE_RUN_AND_DEBUG_VIEW_COMMAND} instead. */
export const SHOW_NATIVE_VARIABLES_COMMANDS = [
  'workbench.debug.action.focusVariablesView',
  'list.focusFirst',
  'list.expand',
] as const
/** Longest Show Variables waits, after it focused Variables, for that view to ask for the presented stop's scopes. VS Code 1.140 refreshes a Variables view that missed a stop while hidden 400 ms after it is shown again; its tree holds no row of the stop until then, so list commands that run earlier focus and expand nothing. A view that shows another session never asks, and the wait ends here. */
export const SHOW_NATIVE_VARIABLES_SCOPES_TIMEOUT_MS = 2_000
/** How long Show Variables gives the host's Variables view, once it could ask for the presented stop's scopes, to list the first scope's values by itself before the list commands of {@link SHOW_NATIVE_VARIABLES_COMMANDS} expand that scope. VS Code 1.140 expands it 2 ms after a deferred refresh, and a Variables view opened for the first time in the editor session (which does not expand it) took 60 ms to give its tree the rows the list commands act on. */
export const SHOW_NATIVE_VARIABLES_VALUES_WAIT_MS = 200
/** How many times Show Variables runs the list commands of {@link SHOW_NATIVE_VARIABLES_COMMANDS}, each after {@link SHOW_NATIVE_VARIABLES_VALUES_WAIT_MS} without the values: the second covers a host whose tree had no rows yet at the first. */
export const SHOW_NATIVE_VARIABLES_EXPAND_ATTEMPTS = 2
/** The host's own Run and Debug view command, which Show Variables runs when the host registers no command that focuses Variables. VS Code 1.140 and Cursor 3.23 register `workbench.debug.action.focusVariablesView` (the view's own focus command; a `workbench.debug.variablesView.focus` does not exist in either). */
export const NATIVE_RUN_AND_DEBUG_VIEW_COMMAND = 'workbench.view.debug'
/** What Show Variables tells the learner when the host registers neither a Variables focus command nor {@link NATIVE_RUN_AND_DEBUG_VIEW_COMMAND}. */
export const SHOW_NATIVE_VARIABLES_MANUAL_STEP =
  'Open Run and Debug and expand Variables to see the recorded values.'
export const PRESENTATION_MODE_IDS = [
  'study-workspace',
  'living-book',
  'guided-walkthrough',
] as const
/** The only layout a command or agent may still select; Living book and Guided walkthrough are retired and stay only in a reader whose saved preference still names one. */
export const SELECTABLE_PRESENTATION_MODE = 'study-workspace'
/** What an agent reads when it asks for a retired layout through `codebook_presentation`. */
export const RETIRED_PRESENTATION_REFUSAL =
  'The Living book and Guided walkthrough layouts are retired. Select study-workspace; focus, restore and save-preference still accept the mode the reader reports.'
export const STUDY_PRESENTATIONS = {
  'study-workspace': {
    title: 'Study workspace',
    description: 'Application above source, with explanation alongside.',
    appColumn: 1,
    sourceColumn: 2,
    contextColumn: 3,
    layout: {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    },
  },
  'living-book': {
    title: 'Living book',
    description: 'Read the explanation with application and source beside it.',
    appColumn: 2,
    sourceColumn: 3,
    contextColumn: 1,
    layout: {
      orientation: 0,
      groups: [
        { size: 0.6 },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
      ],
    },
  },
  'guided-walkthrough': {
    title: 'Guided walkthrough',
    description:
      'Follow application and source side by side, with explanation below.',
    appColumn: 1,
    sourceColumn: 2,
    contextColumn: 3,
    layout: {
      orientation: 1,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    },
  },
} as const
// Allow native pixel rounding, not learner-selected split ratios.
export const EDITOR_LAYOUT_ROUNDING_FRACTION = 0.005
export const MAX_UI_TEXT_CHARS = 8_192
export const STUDY_SOURCE_SCHEME = 'codebook-source'
/** Registered view types of the editor panes Codebook creates: Application, Study and Repository Wiki. */
export const CODEBOOK_PANE_VIEW_TYPES: readonly string[] = [
  'codebook.scopedBrowser',
  'codebook.studyContext',
  'codebook.repositoryWiki',
]
/** Prefix the editor's main thread puts before a webview's registered view type when the tab model reports it. */
export const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-'
export const REPOSITORY_SOURCE_SCHEME = 'codebook-repository-source'
export const REPOSITORY_READER_DEBOUNCE_MS = 150
export const REPOSITORY_VISITED_CITATIONS_LIMIT = 512
export const REPOSITORY_NARROW_WIDTH_PX = 800
// Intro, citations, observations and learner progress complement authored article sections.
export const REPOSITORY_FIXED_READING_SECTIONS = 4
export const RECORDING_VERSION = 1
export const RECORDING_DIRECTORY = 'recordings.v1'
export const CONFIGURED_RECORDING_VERSION = 2
export const CROSS_RUNTIME_RECORDING_VERSION = 3
export const CONFIGURED_RECORDING_DIRECTORY = 'recordings.v2'
export const RECORDING_STORAGE_FORMATS = [
  { version: CROSS_RUNTIME_RECORDING_VERSION, directory: 'recordings.v3' },
  {
    version: CONFIGURED_RECORDING_VERSION,
    directory: CONFIGURED_RECORDING_DIRECTORY,
  },
  { version: RECORDING_VERSION, directory: RECORDING_DIRECTORY },
] as const
export const RECORDING_HEADER_FILE = 'header.json'
export const RECORDING_JOURNAL_FILE = 'frames.jsonl'
export const RECORDING_SEAL_FILE = 'sealed.json'
export const RECORDING_CONTEXT_FILE = 'context.json'
// Ten minutes at 20 fps, plus explicit phase captures; pending-write memory remains independently bounded.
export const MAX_RECORDING_FRAMES = 12_100
export const MAX_RECORDING_PNG_BYTES = 536_870_912
export const MAX_RECORDING_PENDING_BYTES = 8_388_608
export const MAX_RECORDING_JOURNAL_BYTES = 8_388_608
export const RECORDING_TERMINAL_RESERVE_BYTES = 16_384
export const RECORDING_REASON_LIMIT_CHARS = 1_024
export const MAX_RECORDING_CONTEXT_BYTES = 8_388_608
export const MAX_RECORDING_HEADER_BYTES = 65_536
export const MAX_RECORDING_TOTAL_BYTES = 570_425_344
export const MAX_RECORDING_METADATA_FILES = 8
export const RECORDING_SAMPLE_INTERVAL_MS = 50
export const RECORDING_FRAME_PAGE_SIZE = 100
export const MAX_RECORDING_DIMENSION_PX = 4_096
export const PNG_HEADER_BYTES = 24
export const PNG_WIDTH_OFFSET = 16
export const PNG_HEIGHT_OFFSET = 20
export const PNG_SIGNATURE_HEX = '89504e470d0a1a0a0000000d49484452'
export const PLAYBACK_TICK_INTERVAL_MS = 50
export const PLAYBACK_PREFERENCE_FILE = 'playback.v1.json'
export const PLAYBACK_PREFERENCE_LIMIT_BYTES = 65_536
/** Converts milliseconds to the seconds that playback labels, seek steps and run failure texts name. */
export const MILLISECONDS_PER_SECOND = 1_000
export const PLAYBACK_PAGE_STEP_MS = 10_000
export const REPLAY_VIEWPORT_RECEIPT_LIMIT = 12
export const REPOSITORY_GIT_TIMEOUT_MS = 5_000
export const REPOSITORY_GIT_LIMIT_BYTES = 2_097_152
export const REPOSITORY_MAX_TRACKED_FILES = 5_000
export const REPOSITORY_SOURCE_PAGE_SIZE = 100
export const REPOSITORY_PATH_LIMIT_CHARS = 512
export const REPOSITORY_SOURCE_LIMIT_BYTES = 262_144
export const REPOSITORY_SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.mdx',
  '.css',
  '.html',
  '.json',
  '.jsonc',
] as const
export const WIKI_QUESTION_LIMIT_CHARS = 2_000
export const WIKI_SOURCE_LIMIT_BYTES = 131_072
export const WIKI_SOURCE_MATCH_LIMIT = 6
export const WIKI_ROUTE_CANDIDATE_LIMIT_BYTES = 98_304
export const WIKI_CONTEXT_LINE_LIMIT = 80
export const WIKI_ANSWER_LIMIT_CHARS = 12_000
export const WIKI_CURSOR_REQUEST_TIMEOUT_MS = 120_000
export const WIKI_CURSOR_UPDATE_TIMEOUT_MS = 900_000
export const WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES = 1_048_576
export const WIKI_CURSOR_TERMINATION_GRACE_MS = 5_000
/** How long a Cursor Wiki update's agent gets to stop by itself when the editor window closes, before its process group is killed; well below the few seconds the extension host itself has left. */
export const WIKI_CURSOR_SHUTDOWN_GRACE_MS = 2_000
/** The abort reason a closing editor window gives a Wiki update run, so the Cursor agent gets {@link WIKI_CURSOR_SHUTDOWN_GRACE_MS} instead of the learner's cancel grace. */
export const WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON = 'WikiUpdateWindowClosing'
/** File name of the manifest the Wiki publisher writes into an output or candidate folder. */
export const WIKI_MANIFEST_FILE = 'codebook-wiki.json'
/** File name of a generated Wiki's overview page: the page the browser entry opens, the one every Wiki owns and the one a request without a page falls back to. */
export const WIKI_ENTRY_FILE = 'index.html'
/** Route of the Wiki reader that answers the update run's state; the reader hands it to its page script, so both sides take the name from here. */
export const WIKI_UPDATE_STATUS_ROUTE = 'api/update-status'
/** Route of the Wiki reader that answers how the Wiki stands against the source; handed to the page script like {@link WIKI_UPDATE_STATUS_ROUTE}. */
export const WIKI_FRESHNESS_ROUTE = 'api/freshness'
/** Route of the Wiki reader that takes a repository question from its own page. */
export const WIKI_QUESTION_ROUTE = 'api/ask'
/** The host names of an address on this machine; an address the editor forwards the Wiki reader to is accepted as the reader's own page only under one of them. */
export const WIKI_LOOPBACK_HOSTS: readonly string[] = [
  '127.0.0.1',
  'localhost',
  '[::1]',
]
/** File name of the Wiki publisher's receipt in an output or candidate folder. */
export const WIKI_PUBLICATION_RECEIPT_FILE = 'codebook-publication.json'
/** What the Wiki publisher appends to the output folder's path for the journal of a publish in progress or left unfinished. */
export const WIKI_PUBLISH_JOURNAL_SUFFIX = '.publish-journal.json'
/** What the Wiki publisher puts between the output folder's name and a random id for the backup of the generation it replaced (`wiki.previous-<uuid>`); such a sibling is never a candidate and never added source. */
export const WIKI_PUBLISH_BACKUP_INFIX = '.previous-'
/** What the Wiki publisher puts between the output folder's name and a random id for a candidate it prepares by default (`wiki.stage-<uuid>`). */
export const WIKI_PUBLISH_STAGE_INFIX = '.stage-'
/** Largest manifest or publication receipt of a Wiki folder the update flow reads; a manifest carries every page's text, so the bound is generous, and it only keeps a link to an endless device from filling memory. */
export const WIKI_METADATA_FILE_LIMIT_BYTES = 67_108_864
/** How many indexed sources a freshness check hashes at the same time. */
export const WIKI_FRESHNESS_HASH_CONCURRENCY = 16
/** How long a watched Wiki update lets a newly published manifest stay unreadable before it ends as a publish Codebook cannot read; a manifest that is still being written becomes readable well within it. */
export const WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS = 10_000
/** The chat request that makes the editor agent run the publisher's recovery; the sentences of an unfinished publish, a manifest changed after its publish and a manifest Codebook cannot read all name it, so the learner can paste it. */
export const WIKI_UPDATE_RECOVERY_REQUEST =
  '/codebook Recover the unfinished LLM Wiki publish for this project'
/** What a running Wiki update appends to the output folder's path for its marker file, which tells other editor windows that this Wiki is being updated. */
export const WIKI_UPDATE_RUN_MARKER_SUFFIX = '.update-run.json'
/** How recently the publisher's journal must have been written for the start check to take it for a publish in progress and look once more before it reports an unfinished publish. */
export const WIKI_PUBLISH_JOURNAL_FRESH_MS = 10_000
/** How long a VS Code Wiki update waits for the editor's chat command to return before the run ends as failed. */
export const WIKI_CHAT_OPEN_TIMEOUT_MS = 30_000
/** Milliseconds in one second, for naming a bound in seconds. */
export const MS_PER_SECOND = 1_000
/** Key of the workspace state that keeps how this window's last Wiki update ended, so a reloaded window still knows its own leftover candidate. */
export const WIKI_UPDATE_LAST_RUN_STATE_KEY = 'codebook.wikiUpdateLastRun'
/** What a VS Code Wiki update says when its output folder lies outside the opened project: in the confirmation, the progress title and (as the same words in {@link describeWikiUpdate}) the running line. */
export const WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE =
  'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.'
/** `name` of the error a Cursor Wiki update rejects with at its bound, so the caller records `timed-out` instead of `failed`. */
export const WIKI_UPDATE_TIMED_OUT_ERROR_NAME = 'WikiUpdateTimedOut'
/** Milliseconds in one minute, for naming a bound in minutes in the update request. */
export const MS_PER_MINUTE = 60_000
/** Longest a VS Code Wiki update is watched for a published manifest before it ends as timed out. */
export const WIKI_UPDATE_WATCH_TIMEOUT_MS = 900_000
/** How often the extension looks for a newly published manifest while a Wiki update is watched. */
export const WIKI_UPDATE_WATCH_POLL_MS = 2_000
/** How often the reader page asks for the update state while a run is active. */
export const WIKI_UPDATE_STATUS_POLL_MS = 2_000
/** How many conflict paths an update sentence names before "and N more". */
export const WIKI_UPDATE_SHOWN_PATH_LIMIT = 3
/** How many characters of a reason an agent, the CLI or a thrown error supplied an update sentence shows before the full text moves to its disclosure, and how many of a freshness reason the label shows; the Wiki's rail is 170 to 210 px wide and "On this page" sits below. A sentence Codebook writes itself ends with its next step and stays whole. */
export const WIKI_UPDATE_REASON_LIMIT_CHARS = 160
/** How long after a press of Update LLM Wiki the reader page keeps asking quickly for the run the learner still has to confirm in the editor. */
export const WIKI_UPDATE_START_WAIT_MS = 120_000
/** How often the reader page asks for the update state while no run is active and its tab is visible. */
export const WIKI_UPDATE_IDLE_POLL_MS = 15_000
/** How long the Wiki reader gathers reported file changes before its source-change stamp rises once: a checkout or an agent writes many files in one burst. */
export const WIKI_SOURCE_CHANGE_DEBOUNCE_MS = 1_000
/** How long after a freshness check the reader page does not ask for another one when the learner only comes back to it; a finished run, a publish or a changed source still asks at once. A check hashes every indexed source and runs Git. */
export const WIKI_FRESHNESS_MIN_INTERVAL_MS = 5_000
/** How many failed status reads in a row the reader page lets a running update survive before it says it lost contact with the editor. */
export const WIKI_UPDATE_STATUS_RETRY_LIMIT = 3
export const WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES = 65_536
export const WIKI_CURSOR_PROMPT_LIMIT_BYTES = 131_072
export const WIKI_HTTP_BODY_LIMIT_BYTES = 8_192
export const WIKI_GIT_OUTPUT_LIMIT_BYTES = 1_048_576
export const WIKI_GIT_TIMEOUT_MS = 3_000
export const REPOSITORY_EXCLUDED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  'artifacts',
  'vendor',
] as const
export const BOOK_SCHEMA_VERSION = 1
export const BOOK_SCHEMA_VERSION_V2 = 2
export const BOOK_STORAGE_FORMATS = [
  { version: BOOK_SCHEMA_VERSION_V2, suffix: '.book.v2.json' },
  { version: BOOK_SCHEMA_VERSION, suffix: '.book.v1.json' },
] as const
export const BOOK_ID_LIMIT_CHARS = 64
export const BOOK_MAX_NODES = 64
export const BOOK_MAX_EDGES = 128
export const BOOK_MAX_SECTIONS = 12
export const BOOK_MAX_ANCHORS = 8
export const BOOK_MAX_LINKS = 8
export const BOOK_MAX_SOURCES = 32
export const BOOK_SECTION_LIMIT_CHARS = 12_000
export const BOOK_TITLE_LIMIT_CHARS = 160
export const BOOK_MAX_REVISIONS = 20
export const BOOK_MAX_FILES = 64
export const BOOK_REVISION_LIMIT_BYTES = 4_194_304
export const BOOK_FILE_LIMIT_BYTES = 8_388_608
export const BOOK_PREPARE_TIMEOUT_MS = 20_000
export const BOOK_SOURCE_CONCURRENCY = 4
export const REPOSITORY_BROWSER_PROFILE = 'repository-browser'
export const NODE_TEST_PROFILE = 'node-test'
export const NODE_TEST_HISTORY_VERSION = 1
export const NODE_TEST_READER_POSITION_VERSION = 1
export const NODE_TEST_READER_POSITION_LIMIT_BYTES = 4_096
export const NODE_TEST_LEARNING_DECISION_VERSION = 1
export const NODE_TEST_LEARNING_DECISION_LIMIT_BYTES = 4_096
export const NODE_TEST_LEARNING_MATERIAL_VERSION = 1
export const NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES =
  LEARNING_SUMMARY_LIMITS.bytes
export const NODE_TEST_HISTORY_DIRECTORY = 'node-tests.v1'
export const NODE_TEST_HISTORY_LIMIT_BYTES = 8_388_608
export const NODE_TEST_HISTORY_MAX_ENTRIES = 10_000
/** Longest debugger type name a saved Node fact keeps; the type is supplementary, so a longer one is omitted rather than failing the run. */
export const NODE_TEST_FACT_TYPE_LIMIT_CHARS = 256
/** Oldest Vitest major whose file listing, exclusion, name matching and JSON report were verified for exact node-test selection (4.1.11 and 5.0.2). */
export const NODE_TEST_MINIMUM_VITEST_MAJOR = 4
/** Deepest cited title path: enclosing `describe` titles plus the test title. */
export const NODE_TEST_TITLE_PATH_LIMIT = 16
/** Other test files Vitest's substring file filter may add before Codebook refuses instead of excluding each one. */
export const NODE_TEST_EXCLUDED_FILE_LIMIT = 64
/** Bound for one `vitest list --filesOnly` preflight; the whole attach phase is bounded separately. */
export const VITEST_FILE_LIST_TIMEOUT_MS = 30_000
/** Grace period for releasing the owned Vitest listing group before escalating to SIGKILL. */
export const VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS = 1_000
/** Error text kept from a failed Vitest preflight. */
export const VITEST_LIST_ERROR_LIMIT_CHARS = 2_048
/** Largest Vitest JSON report read to confirm which test ran. */
export const VITEST_REPORT_LIMIT_BYTES = 8_388_608
/** Wait for the owned test process to report its exit after its debugger session ended early. */
export const NODE_TEST_EXIT_GRACE_MS = 2_000
/** Budget for each owned Node test phase: attach through the entry pause, reaching a declared stop while the test runs, and capturing it. */
export const NODE_TEST_ATTACH_TIMEOUT_MS = 45_000
export const REPOSITORY_BROWSER_ACTION = 'repository-click'
export const REPOSITORY_CONFIG_VERSION = 1
export const CROSS_RUNTIME_CONFIG_VERSION = 2
export const CONFIGURED_STUDY_VERSION = 3
export const CROSS_RUNTIME_STUDY_VERSION = 4
export const CONFIGURED_STUDY_SUFFIX = '.study.v3.json'
export const CONFIGURED_STUDY_METADATA_SUFFIX = '.study.meta.v3.json'
// Highest existing version owns a logical study, including when its bytes are corrupt.
export const STUDY_STORAGE_FORMATS = [
  {
    version: CROSS_RUNTIME_STUDY_VERSION,
    format: 'v4',
    archiveSuffix: '.study.v4.json',
    metadataSuffix: '.study.meta.v4.json',
  },
  {
    version: CONFIGURED_STUDY_VERSION,
    format: 'v3',
    archiveSuffix: CONFIGURED_STUDY_SUFFIX,
    metadataSuffix: CONFIGURED_STUDY_METADATA_SUFFIX,
  },
  {
    version: LEARNING_SCHEMA_VERSION_V2,
    format: 'v2',
    archiveSuffix: STUDY_V2_SUFFIX,
    metadataSuffix: STUDY_METADATA_V2_SUFFIX,
  },
  {
    version: LEARNING_SCHEMA_VERSION,
    format: 'legacy-v1',
    archiveSuffix: '.study.json',
    metadataSuffix: undefined,
  },
] as const
export const CONFIGURED_OBSERVATION_LIMIT = 8
export const CONFIGURED_CAPTURE_PHASES = [
  'before',
  'paused-browser',
  'after',
] as const
export const CROSS_RUNTIME_CAPTURE_PHASES = [
  'before',
  'paused-browser',
  'paused-server',
  'after',
] as const
export const REPOSITORY_CONFIG_LIMIT_BYTES = 65_536
export const REPOSITORY_SELECTOR_LIMIT_CHARS = 512
export const REPOSITORY_CONDITION_LIMIT = 8
export const REPOSITORY_ATTRIBUTE_LIMIT_CHARS = 64
export const REPOSITORY_LITERAL_LIMIT_CHARS = 1_024
export const REPOSITORY_INSPECTION_LIMIT = 10
export const REPOSITORY_INSPECTION_TIMEOUT_MS = 1_000
export const REPOSITORY_INSPECTION_PATH_LIMIT_CHARS = 128
export const REPOSITORY_INSPECTION_SEGMENT_LIMIT = 4
export const REPOSITORY_STORAGE_ENTRY_LIMIT = 16
export const REPOSITORY_STORAGE_KEY_LIMIT_CHARS = 128
export const REPOSITORY_STORAGE_VALUE_LIMIT_CHARS = 2_048
export const REPOSITORY_STORAGE_LIMIT_BYTES = 16_384
export const REPOSITORY_SETUP_TIMEOUT_MS = 90_000
export const REPOSITORY_PAUSE_HOLD_TIMEOUT_MS = 300_000
/** Added to {@link ACTIVE_TIMEOUT_MS} for the wait of a `codebook_continue` sent with `answer: "next"`, counted from the acknowledged continuation: a run that ends at its own active deadline is then answered with that end, not with the bound. */
export const CONTINUE_ANSWER_GRACE_MS = 2_000
/** The longest a `codebook_continue` sent with `answer: "next"` may take in total, counted from the call's start. The time the runtime needs before it acknowledges the continuation (arming the next stop, the acknowledgement) is bounded by the runtime's own deadlines and counts against this budget, so the wait after it only gets shorter. Well below the smallest MCP client timeout found for a tool call (120 s idle in Cursor 3.23 and in Codebook's Cursor bridge, {@link CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS}; none in VS Code 1.140). */
export const CONTINUE_ANSWER_CALL_BUDGET_MS = 45_000
export const REPOSITORY_RUN_TIMEOUT_MS = 600_000
export const REPOSITORY_RESERVED_INSPECTION_ROOTS = [
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'NaN',
  'Infinity',
] as const
export const REPOSITORY_FORBIDDEN_INSPECTION_SEGMENTS = [
  '__proto__',
  'prototype',
  'constructor',
] as const
export const REPOSITORY_CAPTURED_TYPES = [
  'undefined',
  'object',
  'boolean',
  'number',
  'bigint',
  'string',
  'symbol',
  'function',
] as const
export {
  ACTIVE_TIMEOUT_MS,
  RUN_TIMEOUT_MS,
  HOLD_DURATION_MS,
  CONTROL_RESPONSE_LIMIT_MS,
} from './runtimeSupport/constants'
export const REPOSITORY_JAVASCRIPT_LIMIT_BYTES = 8_388_608
export const REPOSITORY_CHUNK_LIMIT_BYTES = 33_554_432
export const REPOSITORY_MAP_LIMIT_BYTES = 16_777_216
export const REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT = 200_000
export const REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES = 100_000
export const REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS = 4_194_304
export const REPOSITORY_BINDING_HINT_EDGE_LINES = 20
export const REPOSITORY_BINDING_HINT_NEAR_LINES = 40
/** Begins the hint of a click target that matched no element; the page's control counts follow when it reported them. */
export const CLICK_TARGET_MISSING_HINT =
  ' The action selector matched no element on the page.'
/** Ends that hint with what the agent can do without seeing the page. */
export const CLICK_TARGET_MISSING_REMEDY_HINT =
  " Read the component's source for the control's tag, id, name or attributes and declare a browser-native CSS selector that matches exactly one element; check entryPath when the page holds no such control."
/** Appended to every timed-out `text` condition: the comparison rule, which the agent cannot read from the failure reason. Each hint begins with one space because it follows the reason's period. */
export const TEXT_CONDITION_RULE_HINT =
  " A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied."
/** Added for a before `text` condition whose element holds the expected text beside other text; a visible condition is enough when only presence matters. */
export const TEXT_BESIDE_OTHER_TEXT_BEFORE_HINT =
  ' Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text.'
/** Added for an after `text` condition in the same case; the text check is the result proof, so it stays. */
export const TEXT_BESIDE_OTHER_TEXT_AFTER_HINT =
  ' Here the element holds the expected text beside other text; keep the text check and choose a selector whose element holds only that text.'
/** A before `value` attribute condition is checked before `initialInputs` exist. */
export const ATTRIBUTE_VALUE_BEFORE_INPUT_HINT =
  ' Before conditions are checked before initialInputs are inserted; choose a condition observable on the fresh page.'
/** Every other attribute mismatch: the whole value is compared, which fails for one class among several. */
export const ATTRIBUTE_ENTIRE_VALUE_HINT =
  ' An attribute condition compares the entire value; use a CSS class selector to test class membership.'
export const SOURCE_MAP_VLQ_VALUE_MASK = 31
export const SOURCE_MAP_VLQ_CONTINUATION_MASK = 32
export const SOURCE_MAP_VLQ_SHIFT_BITS = 5
export const SOURCE_MAP_VLQ_SIGN_DIVISOR = 2
export const SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS = 1
export const SOURCE_MAP_SOURCE_SEGMENT_FIELDS = 4
export const SOURCE_MAP_NAMED_SEGMENT_FIELDS = 5
export const REPOSITORY_DISCOVERY_LIMIT_BYTES = 134_217_728
export const REPOSITORY_DISCOVERY_CANDIDATE_LIMIT = 2_048
export const REPOSITORY_DISCOVERY_TIMEOUT_MS = 30_000
export const REPOSITORY_APPLICATION_LOG_LIMIT_BYTES = 262_144
export const REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS = 10_000
export const REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT = 200
export const REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT = 8
export const REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT_CHARS = 512
/** Bounds a pause's script URL in the journal and in a deadline's place sentence; a URL can be of any length, and the saved study's reason holds at most {@link MAX_UI_TEXT_CHARS}. */
export const REPOSITORY_PAUSE_URL_LIMIT_CHARS = 512
/** Bounds a paused frame's function name in the journal. */
export const REPOSITORY_PAUSE_FUNCTION_NAME_LIMIT_CHARS = 256
/** How many pauses away from the expected stop (and how many idle `continued` events) one run journals; past it only their count is kept, so a hook that pauses in a loop cannot use up the journal. */
export const REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT = 100
/** The longest a pause no debugger stop announced may last for its resume to count as the debug adapter's own; the adapter resumes its pauses within milliseconds, and a pause that outlasts the wait for a stop's own pause is taken as announced, so this bound is that wait's bound ({@link CAPTURE_TIMEOUT_MS}) and follows it. */
export const REPOSITORY_ADAPTER_PAUSE_LIMIT_MS = CAPTURE_TIMEOUT_MS
/** The same bound while the participant's stop is accepted and its own pause is still awaited: the held pause may then be the announced one, which the adapter never resumes by itself. */
export const REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS = 1_000
/** Where a participant is paused when its pause has an empty stack, in the sentence a deadline adds for a pause no debugger stop announced. */
export const UNANNOUNCED_PAUSE_UNKNOWN_PLACE = 'an unknown place'
/** Stands in that sentence for the URL of a script the runtime never announced; the generated position follows it. */
export const UNANNOUNCED_PAUSE_UNKNOWN_SCRIPT = 'an unknown script'
export const REPOSITORY_STACK_FRAME_LIMIT = 10
/** Names the bounded wait for an accepted stop's own runtime pause; its timeout text and the test harnesses' substitution of that wait both key on it. */
export const SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION = 'source-bound CDP stop'
/** Names the waits before and after the after capture for every pause the debugger made for itself to be resumed. */
export const ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION =
  'adapter pause retirement'

export const REPLAY_DEBUG_TYPE = 'codebook-replay'
export const REPLAY_DEBUG_THREAD_ID = 1
export const REPLAY_DEBUG_MAX_FRAMES = 32
export const REPLAY_DEBUG_MAX_SCOPES = 16
export const REPLAY_DEBUG_MAX_VARIABLES = 2_000
export const REPLAY_DEBUG_MAX_DEPTH = 5
export const REPLAY_DEBUG_TEXT_LIMIT_CHARS = 4_096
export const REPLAY_DEBUG_CAPTURE_TIMEOUT_MS = 5_000
/** Native Call Stack name of the owned historical session; the Study hint names it for learners. */
export const REPLAY_DEBUG_SESSION_NAME = 'Codebook · Recorded learning'
/** How long a replay moment waits for native Run and Debug to load its recorded values (VS Code defers Variables ~400 ms) before committing without them. */
export const REPLAY_DEBUG_INSPECTION_GRACE_MS = 1_000
/** Frames native Call Stack loads for a stop before the learner asks for more (VS Code: the top frame, then 19 more); it focuses the top frame when none of them has source. */
export const REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES = 20
/** What one owned replay settle allows for work that has no bound of its own before painting: reading the recording and the recording renderer's handshake. */
export const PRESENTATION_SETTLE_LOCAL_ALLOWANCE_MS = 2_000
/** Ceiling on one owned replay settle, covering the slowest healthy sequence: a pending historical-session startup the retirement waits for, the retirement and the next startup (one capture timeout each), the inspection grace ({@link REPLAY_DEBUG_INSPECTION_GRACE_MS}), the recording load and renderer handshake ({@link PRESENTATION_SETTLE_LOCAL_ALLOWANCE_MS}) and the paint bound ({@link PRESENTATION_READY_TIMEOUT_MS}). A stall before painting still ends here. Only a recording renderer's (re-)handshake that needs more than that allowance can outlast the ceiling: it waits up to {@link ACTIVE_TIMEOUT_MS} (20 s) when the renderer is new or must be revealed again. The settle then retires the pending frame it still owns and reports `PRESENTATION_UNAVAILABLE`, and the confirmed moment stays for the next reveal. */
export const PRESENTATION_SETTLE_CEILING_MS =
  PRESENTATION_READY_TIMEOUT_MS +
  3 * REPLAY_DEBUG_CAPTURE_TIMEOUT_MS +
  REPLAY_DEBUG_INSPECTION_GRACE_MS +
  PRESENTATION_SETTLE_LOCAL_ALLOWANCE_MS
export const NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS = 1_500
export const NODE_REPLAY_DEBUG_MAX_FRAMES = 8
export const NODE_REPLAY_DEBUG_MAX_VARIABLES = 64
export const NODE_REPLAY_DEBUG_MAX_DEPTH = 2
export const REPOSITORY_ENTRY_PATH_LIMIT_CHARS = 2_048
export const REPOSITORY_INPUT_LIMIT = 16

/** Maximum UTF-8 payload per explicitly paged evidence read. */
export const RESOURCE_JSON_PAGE_BYTES = 4096

/** Google Chrome's executable inside its macOS application bundle; checked when `codebook.chromeExecutable` is unset on macOS. */
export const CHROME_MACOS_EXECUTABLE_PATH =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
/** Chrome and Chromium command names searched on PATH, in this order, when `codebook.chromeExecutable` is unset on Linux (including WSL). */
export const CHROME_LINUX_EXECUTABLE_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
] as const
/** `vscode.env.remoteName` of a WSL window: the only remote whose extension host owns the workspace files and processes like a local one. */
export const WSL_REMOTE_NAME = 'wsl'
/** How long a replay opened while another window has the desktop focus waits for the Codebook work window to gain focus before answering with the remedy. */
export const RECORDING_WINDOW_FOCUS_WAIT_MS = 10_000
/** A seek less than this far before a recorded stop presents that stop: recorded stops sit at fractional receipt milliseconds (122,822.02), and a driver that rounds down must not land in the gap before it. */
export const PLAYBACK_SEEK_STOP_SNAP_MS = 1
