import type * as vscode from 'vscode'

import { CAPTURE_TIMEOUT_MS } from './runtimeSupport/constants'

/**
 * The version of the MCP API this build serves: `codebook_status`, the connection descriptor, the server's instructions and the repository-browser help report it, and the package's build metadata records it.
 * 1.7 removed a member: `codebook_source`, and `codebook_read_resource` for a book's cited source, answer the source's lines as `numberedText` and no longer as `text` (1.6 answered both); an MCP resource read of a cited source still answers its exact text. No request states a version, so a client written for 1.6 gets the 1.7 answers.
 * 1.11 is additive: the `vite-dev` adapter of the `repository-browser` profile (the adapter enum of the configuration, `codebook_status` adapter readiness under `profiles[].prerequisites.adapters`, the optional `viteVersion` of a Vite run manifest and resource, the `ADAPTER_MISROUTE` and `VITE_*` refusal codes, the Vite quick start and refusal anchors of `codebook://help/repository-browser`); a Vite study is saved in study format 5.
 * 1.10 is additive: the `chrome-extension` profile (the `extension-click` action, the `extension` participant of `codebook_continue`, the `chromeExtension` block and `claimable` of the run resource, `codebook://help/chrome-extension`); a chrome-extension run is not saved in this version.
 * 1.9 is additive: a node-server run is saved as a Server replay. `codebook_explain_node_history` accepts a server history's material (steps citing the request, a stop, output, the response or the request failure), the server run resource gains `nodeServer.history`, `historyUri`, `historyIssue`, `learningCoverage`, `learningMissing` and `captureMissing`, `nextActions` offers `save-node-learning`, and `codebook://help/node-server` has a save section.
 * 1.8 changed node-test outcomes: a passing test whose history sealed complete reads `demonstrated` in `finalOutcome`, `studyOutcome` and `recordedStudyOutcome` (1.7 stopped at `partial`), its sealed history is a test replay (`recordingAvailable` and `replayAvailable`), and `nodeTest` adds `testResult`, `learningCoverage` and `learningMissing`. A node-test start's deterministic refusals arrive as the run's `error` before its first stop, a failed history seal makes `codebook_stop` answer `HISTORY_SEAL_FAILED`, and `codebook_playback` refuses a test replay with `PLAYBACK_PROFILE_UNSUPPORTED`.
 */
export const API_VERSION = '1.11'
export const EXTENSION_VERSION = '0.2.62'
export const CONFIGURED_MINIMUM_EXTENSION_VERSION = '0.2.0'
export const NODE_TEST_MINIMUM_EXTENSION_VERSION = '0.2.12'
export const LOOPBACK_ADDRESS = '127.0.0.1'
export const DYNAMIC_PORT = 0
export const TOKEN_BYTES = 32
export const PRIVATE_DIRECTORY_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600
/** Where a Linux kernel publishes the random identity of its current boot; other systems have no such file. */
export const KERNEL_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id'
/** How far the boot time a storage owner recorded may lie before this boot's and still be the same boot. Each is the wall clock minus the uptime, so a clock correction moves it by seconds, while a restart moves it by at least the earlier session's length. */
export const STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS = 60_000
/** The largest id a process can have on any system this extension runs on: a process id is a signed 32-bit integer on Linux and macOS (whose own limits are 4194304 and 99998), a Windows id stays far below it, and the system's probe takes no larger number. A recorded id above it names no process ({@link isProcessGone}). */
export const LARGEST_PROCESS_ID = 2 ** 31 - 1
/** How long the query for one process's start (`ps` on macOS, PowerShell on Windows) may run before it is ended and the start counts as unreadable. */
export const PROCESS_START_QUERY_TIMEOUT_MS = 3_000
/** The most bytes the query for one process's start may print; a longer answer is no start. */
export const PROCESS_START_QUERY_MAX_BYTES = 1_024
/** How long one query of a port's listening sockets (`lsof` or `ss`) may run before it is ended and the port's owner counts as unknown. */
export const LISTENER_QUERY_TIMEOUT_MS = 3_000
/** The most bytes one query of a port's listening sockets may print; a longer answer leaves the port's owner unknown. */
export const LISTENER_QUERY_MAX_BYTES = 1_048_576
/** How far apart, in 100 ns ticks, a creation time the Windows process table names (Win32_Process CreationDate, to the microsecond) and a recorded start (to the 100 ns) may lie and still name one process: less than a microsecond ({@link readProcessStart}). */
export const WINDOWS_PROCESS_TABLE_PRECISION_TICKS = 10
/** How long a failed read of this process's own start is kept before the start is read again. */
export const PROCESS_START_RETRY_AFTER_FAILURE_MS = 60_000
/** The longest text `ps -o lstart=` may answer and still be taken for a process's start ("Mon Oct  5 09:12:33 2026" has 24 characters). */
export const PROCESS_START_PS_TEXT_MAX_LENGTH = 64
/** Where the start time (field 22 of `/proc/<pid>/stat`) is among the values that follow the command name's closing parenthesis; the first of them is field 3. */
export const LINUX_STAT_START_TIME_INDEX = 19
/** The form of a process start on each system where one can be read, which is the text before its first colon ({@link readProcessStart}): clock ticks on Linux, the text of `ps` on macOS, a UTC time on Windows. On Linux the form also names the pid namespace, as `linux@<number>` ({@link processStartFormHere}). Two starts of different forms were read in two spaces of process ids and are never compared, and for a record in a project folder neither are two Linux starts that name no pid namespace ({@link canJudgeOwnerHere}). */
export const PROCESS_START_FORMS = {
  linux: 'linux',
  darwin: 'ps',
  win32: 'win',
} as const satisfies Partial<Record<NodeJS.Platform, string>>
/** What stands between the system and the pid namespace in the form of a Linux process start: `linux@4026531836`. */
export const PROCESS_START_NAMESPACE_MARK = '@'
/** Where Linux names the pid namespace of the reading process, as a link to `pid:[<number>]`. A process id means a process only inside one pid namespace ({@link processStartFormHere}). */
export const LINUX_PID_NAMESPACE_PATH = '/proc/self/ns/pid'
/** How many hex characters of a SHA-256 name a machine in a storage owner record ({@link deriveMachineKeys}). */
export const MACHINE_KEY_HEX_LENGTH = 16
/** How long an empty lock file or an empty prepared takeover claim must have stayed empty before it counts as left by a killed window; a running window is in that state for an instant. */
export const STORAGE_LOCK_UNWRITTEN_GRACE_MS = 10_000
/** How often the release of this window's storage lock reads and removes the lock before it leaves the lock in place ({@link withStorageLock}); on Windows a scanner or an indexer can hold the file for a moment, so its read or its removal fails. A release that still fails is not thrown: the write's result stands, and the lock is taken back by this window's timer ({@link STORAGE_LOCK_TAKE_BACK_DELAY_MS}) or by its next hold of that folder. */
export const STORAGE_LOCK_RELEASE_ATTEMPTS = 20
/** How long the release of this window's storage lock waits between two attempts; with {@link STORAGE_LOCK_RELEASE_ATTEMPTS} about half a second. */
export const STORAGE_LOCK_RELEASE_RETRY_DELAY_MS = 25
/** How long a window waits after its release left the storage lock in place (the system refused to read or remove it) before it takes the lock back without a further write ({@link withStorageLock}); a scanner or an indexer on Windows usually lets go within seconds. */
export const STORAGE_LOCK_TAKE_BACK_DELAY_MS = 5_000
/** How many times a window takes back a lock its release left in place, {@link STORAGE_LOCK_TAKE_BACK_DELAY_MS} apart, before it leaves the lock to its next write of that folder; with the delay about a minute. */
export const STORAGE_LOCK_TAKE_BACK_ATTEMPTS = 12
/** What an editor that runs without its telemetry service answers as `vscode.env.machineId` on every computer; it identifies none. */
export const EDITOR_MACHINE_ID_PLACEHOLDER = 'someValue.machineId'
export const CURSOR_MCP_CATALOG_REFRESH_STEP_MS = 1
export const CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES = 16_384
/** How often a setup or a removal of the Cursor MCP catalog asks for the catalog's storage lock again while another window holds it, before it reports the lock; with pauses of {@link CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS} and up to {@link CURSOR_MCP_CATALOG_LOCK_RETRY_JITTER_MS} more, one to three seconds (two on average), in which dozens of Cursor windows that restart together take the lock one after the other. */
export const CURSOR_MCP_CATALOG_LOCK_RETRIES = 20
/** The shortest pause before the catalog's storage lock is asked for again. */
export const CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS = 50
/** The bound below which a random draw lengthens each pause before the catalog's lock is asked for again, so that windows that restart together do not ask in step and several of them take the lock between two of their tries. */
export const CURSOR_MCP_CATALOG_LOCK_RETRY_JITTER_MS = 100
/** How long a staged Cursor MCP config (`~/.cursor/.codebook-<uuid>.mcp.json`) that no record names must have stood unchanged before it counts as left by a killed window and is removed; a running window, also one whose catalog has a lock of its own, holds its staged file for an instant. */
export const CURSOR_MCP_STAGED_CONFIG_GRACE_MS = 60_000
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
/** The longest event type a run's journal keeps. */
export const EVENT_TYPE_LIMIT_CHARS = 128
/**
 * What ends a text {@link cutTextToFit} cut to fit a bound, so a reader sees that the text went on: the reason of the one run failure the evidence keeps past a refusal, cut to fit {@link EVENT_DETAIL_LIMIT_BYTES} (Cycle 0046 row 698).
 * @example cutTextToFit('x'.repeat(100), (candidate) => candidate.length <= 20) // => 'xxxxxxxxxxxxx… [cut]'
 */
export const CUT_TEXT_MARKER = '… [cut]'
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
/**
 * Every kind of error line the Study reader keeps, one line per kind, with what answers it.
 * `retryable`: Retry storage / refresh can answer the line, so the pane offers Retry only while one of these is shown.
 * `choiceRetired`: the line reports a refused pane choice, which the learner's next handled choice retires.
 * {@link ReaderErrorKind}, {@link UNRETRYABLE_READER_ERROR_KINDS} and {@link CHOICE_RETIRED_ERROR_KINDS} derive from this table, so a new kind is classified where it is declared.
 */
export const READER_ERROR_KINDS = [
  { kind: 'application', retryable: false, choiceRetired: false },
  { kind: 'archive', retryable: true, choiceRetired: false },
  { kind: 'citations', retryable: true, choiceRetired: false },
  { kind: 'control', retryable: false, choiceRetired: true },
  { kind: 'history-learning', retryable: true, choiceRetired: false },
  { kind: 'history-not-saved', retryable: true, choiceRetired: false },
  { kind: 'history-position', retryable: true, choiceRetired: false },
  { kind: 'history-source', retryable: true, choiceRetired: false },
  { kind: 'layout', retryable: false, choiceRetired: false },
  { kind: 'node-history-control', retryable: false, choiceRetired: true },
  { kind: 'outline', retryable: true, choiceRetired: false },
  { kind: 'playback-context', retryable: true, choiceRetired: false },
  { kind: 'playback-preference', retryable: true, choiceRetired: false },
  { kind: 'presentation', retryable: false, choiceRetired: false },
  { kind: 'progress', retryable: true, choiceRetired: false },
  { kind: 'reader', retryable: true, choiceRetired: false },
  { kind: 'reading', retryable: false, choiceRetired: false },
  { kind: 'replay-control', retryable: false, choiceRetired: false },
  { kind: 'replay-debugger', retryable: true, choiceRetired: false },
  { kind: 'replay-debugger-disposal', retryable: false, choiceRetired: false },
  { kind: 'source', retryable: true, choiceRetired: false },
] as const
/** The key of one reader error line; the reader's `report` and its error map accept only these. */
export type ReaderErrorKind = (typeof READER_ERROR_KINDS)[number]['kind']
/** What the reader says when the learner follows the current run after its Application pane was closed: the pane's closure released the run's viewport and ended the run, so nothing can be shown for it until a new run opens the pane again. */
export const APPLICATION_PANE_CLOSED_MESSAGE =
  'The Application pane of the current run was closed, which ended that run. Ask your agent for a new run to see the application again.'
/** What the reader says when {@link StudyWorkspace}'s arrangement leaves the learner's editor groups as they are: the grid holds more groups than the Study layout describes, so applying that layout would merge a group into its neighbour. */
export const EDITOR_GROUPS_PRESERVED_MESSAGE =
  'Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.'
// The reader's error lines that Retry storage / refresh cannot answer: the pane offers Retry only for the others.
export const UNRETRYABLE_READER_ERROR_KINDS: ReadonlySet<ReaderErrorKind> =
  new Set(
    READER_ERROR_KINDS.flatMap((entry) =>
      entry.retryable ? [] : [entry.kind],
    ),
  )
// The lines of a refused pane choice that the learner's next handled choice retires: the general one and the Node test history's own, which a Node history message accepted outside browser replay retires as well.
export const CHOICE_RETIRED_ERROR_KINDS: ReadonlySet<ReaderErrorKind> = new Set(
  READER_ERROR_KINDS.flatMap((entry) =>
    entry.choiceRetired ? [entry.kind] : [],
  ),
)
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
// The Study reader's progress line for an understanding choice made while an earlier one still waits to be written: the new choice is not taken, so the earlier one is neither replaced nor lost.
export const UNSAVED_UNDERSTANDING_WAITS_MESSAGE =
  'Not saved: an earlier understanding choice still waits to be written, and this one was not taken. Press Retry storage / refresh to write the earlier one, then choose again.'
// What the reader made after a change of the workspace's folders says after "History not saved: " for a study archive the reader before it handed over without a reason of its own: its write had not ended when the readers were replaced.
export const UNSAVED_STUDY_HANDED_OVER_REASON =
  "a study of an earlier run was still being written when the workspace's folders changed. Press Retry storage / refresh to write it."
// Why a saved study cannot be removed right now; the Study pane shows them beside its button and the host repeats them when it refuses.
export const STUDY_REMOVAL_REFUSALS = {
  nothingChosen: 'Choose a saved study to delete.',
  nodeHistory: 'Test replays cannot be deleted here yet.',
  runNotStopped: 'Stop the run before deleting its study.',
  recordingOpen:
    'Choose Overview or Live to leave Recording before deleting this study.',
  studyOpening: 'Wait for the chosen saved study to open.',
  unavailable: STUDY_ARCHIVE_UNAVAILABLE_MESSAGE,
  newerFormat:
    'This study was saved by a newer Codebook and is kept as it is. Update the extension, then delete it there.',
} as const
/** The same reasons as a window without a Trash words them: nothing is deleted there, so none speaks of deleting; each names the removal of the study's files by hand, which the "Remove by hand" disclosure of Saved studies lists. The Study pane shows them and the host repeats them when it refuses a request for a study's files. */
export const STUDY_REMOVAL_REFUSALS_WITHOUT_TRASH: Record<
  keyof typeof STUDY_REMOVAL_REFUSALS,
  string
> = {
  nothingChosen:
    'This window has no Trash, so Codebook cannot delete a saved study here. Choose a saved study, then open Remove by hand to list its files.',
  nodeHistory:
    'Codebook cannot list the files of a test replay for removal by hand yet.',
  runNotStopped: "Stop the run before removing its study's files by hand.",
  recordingOpen:
    "Choose Overview or Live to leave Recording before removing this study's files by hand.",
  studyOpening: STUDY_REMOVAL_REFUSALS.studyOpening,
  unavailable: STUDY_ARCHIVE_UNAVAILABLE_MESSAGE,
  newerFormat:
    'This study was saved by a newer Codebook and is kept as it is. Update the extension to list its files for removal by hand.',
}
/** Why a server replay cannot be removed from Saved studies, as a window with a Trash and one without word it; a test replay's sentences are {@link STUDY_REMOVAL_REFUSALS}'s `nodeHistory`. */
export const STUDY_REMOVAL_SERVER_HISTORY_REFUSAL = {
  withTrash: 'Server replays cannot be deleted here yet.',
  withoutTrash:
    'Codebook cannot list the files of a server replay for removal by hand yet.',
} as const
/** What Saved studies answers a request for a study's files with in a window without a Trash; the "Remove by hand" disclosure shows it above the files the answer lists, and the reader deletes nothing itself. */
export const STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE =
  'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.'
// Where the agent server keeps each instance's connection descriptor and each run's raw evidence, below the extension's global storage.
export const AGENT_STORAGE_DIRECTORY = 'agent'
export const CONNECTION_DESCRIPTOR_SUFFIX = '.connection.json'
/** The setting that bounds the saved studies and recordings, as the editor's configuration events name it. */
export const SAVED_STUDY_LIMIT_SETTING = 'codebook.savedStudyLimit'
export const INVALID_SAVED_STUDY_LIMIT_MESSAGE = `Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to ${MAX_SAVED_STUDIES}. Existing learning was kept.`
export const MAX_SOURCE_DOCUMENTS = 34
/** What the file name of every captured-source document starts with, so its tab reads apart from the editable workspace file of the same name. */
export const CAPTURED_SOURCE_NAME_PREFIX = 'Captured-'
/** Cursor's command "Focus Agent": it gives the input of the selected Agent chat the keyboard focus. The chat's group is no group of the main editor grid, so the editor's numbered focus commands cannot reach it: for the column after the grid's last group they open a new empty group. {@link StudyWorkspace} runs this command, where the host registers it, to give the chat the keyboard back after a measurement borrowed it. */
export const CURSOR_FOCUS_AGENT_COMMAND = 'composer.focusComposer'
export const STUDY_REFRESH_INTERVAL_MS = 250
/** The least time between two layout requests of a saved study that waits for the hidden editor area: the reader's timer ticks every {@link STUDY_REFRESH_INTERVAL_MS}, the wait has no end, and the editor is asked once a second at most. */
export const STUDY_EDITOR_AREA_LOOK_INTERVAL_MS = 1_000
export const STUDY_EDITOR_GROUP_COUNT = 3
export const LIVE_EDITOR_GROUP_COUNT = 2
export const LIVE_EDITOR_LAYOUT = {
  orientation: 1,
  groups: [{ size: 0.5 }, { size: 0.5 }],
} as const
export const REPOSITORY_MIN_EDITOR_GROUP_COUNT = 2
export const HORIZONTAL_EDITOR_ORIENTATION = 0
/** The orientation of an editor layout whose groups stand in rows, one above the other (`vscode.getEditorLayout`'s `orientation: 1`); {@link StudyWorkspace} stacks the groups so after the removal of an earlier window's leftover group (row 639). */
export const VERTICAL_EDITOR_ORIENTATION = 1
export const PRESENTATION_PREFERENCE_KEY = 'codebook.presentation.v1'
export const PRESENTATION_PREFERENCE_VERSION = 1
/** The workspace-state key of the record {@link StudyWorkspace} keeps of the Application group it claimed and locked; after Developer: Reload Window the editor keeps that group empty, and only this record proves it is Codebook's own. */
export const APPLICATION_GROUP_MARKER_KEY = 'codebook.applicationGroup.v1'
/** The version of the record under {@link APPLICATION_GROUP_MARKER_KEY} that names one group by its `column`, the shape 0.2.30 candidates write and read; {@link StudyWorkspace} still writes it whenever the record names one group. */
export const APPLICATION_GROUP_MARKER_VERSION = 1
/** The version of the record under {@link APPLICATION_GROUP_MARKER_KEY} that names two or more groups Codebook created by their `columns` (the Application's group and the Study Context's created group, finding 599); a reader of {@link APPLICATION_GROUP_MARKER_VERSION} alone ignores it, so it never retires one group of the pair on a proof made for the pair. */
export const STUDY_GROUPS_MARKER_VERSION = 2
export const PRESENTATION_READY_TIMEOUT_MS = 5_000
/**
 * How much wider the editor area must have become, in pixels, for {@link StudyWorkspace} to conclude that a side bar was open before it was hidden: the editor's side bars are at least 170 px wide, and a sash or a rounded size moves the width by a few pixels at most.
 * @example
 * widthWithoutPrimaryPx - widthPx > HIDDEN_SIDE_BAR_MIN_GAIN_PX // => true for 874 - 660
 */
export const HIDDEN_SIDE_BAR_MIN_GAIN_PX = 50
/**
 * How long a Restore waits, after its own commands ended a Read's maximization, for the editor to name the focused tab's group as the active one again before it counts another group as the learner's change: Cursor names another group for a moment while a maximization ends (Cycle 0045 NF-7b), as it did for 25 to 46 ms while a layout was applied (Cycle 0045 NF-7).
 * @example
 * await waitUntil(() => retainsFocus(), 'the focus after the maximization ended', UNMAXIMIZE_FOCUS_SETTLE_MS)
 */
export const UNMAXIMIZE_FOCUS_SETTLE_MS = 300
/**
 * How long before a pause of a live run the editor's own opening of the paused file may lie and still not count as the learner leaving the chat: the editor's debugger opens that file with the keyboard first and selects the stack item right after it, so {@link StudyWorkspace} sees a text editor become active a moment before it sees the pause.
 * @example performance.now() - leftAtMs <= PAUSE_FOCUS_LOOKBACK_MS // => true for the paused file the debugger opened 20 ms before the stack item
 */
export const PAUSE_FOCUS_LOOKBACK_MS = 1_000
/**
 * The reasons a debug adapter gives in its `stopped` event for a stop the learner started with one of the editor's own debugging commands, as against a stop that happens by itself (`breakpoint`, `exception`, `data breakpoint`, `function breakpoint`, `entry`) or one whose cause the reason does not tell (`pause`, which js-debug also gives for a `debugger` statement and a `debug()` call): `step` is the Debug Adapter Protocol's and js-debug's reason after Step Over, Step Into and Step Out; `goto` is the protocol's reason after a jump to a line; `frame_entry` is what js-debug 1.105 gives after Restart Frame. {@link StudyWorkspace} ends its record of the chat's keyboard at such a stop when a text editor has the keyboard: the learner works in that editor.
 * @example LEARNER_STARTED_STOP_REASONS.has('step') // => true
 */
export const LEARNER_STARTED_STOP_REASONS: ReadonlySet<string> = new Set([
  'step',
  'goto',
  'frame_entry',
])
/**
 * The ways a text editor's selection changes by the learner's own hand, by their numbers in the editor's `TextEditorSelectionChangeKind`: 1 is the keyboard (typing, the cursor keys) and 2 is the mouse (a click, a drag). Every other change is number 3, a command's: the editor's own jump to a line, as for a stack frame's file, and a selection an extension sets (VS Code 1.140 and Cursor 3.23 give 3 for the sources `api`, `code.jump` and `code.navigation`). {@link StudyWorkspace} takes a change of these kinds in the active text editor as a sign that the learner works in that editor. {@link RepositoryReader} takes one as the learner's own selection, which never proves that a requested range was reached. The numbers stand here, and not the editor's names, because this file is also loaded where the editor's API does not exist. A change the editor reports without a kind is asked with `undefined` and is none of them.
 * @example LEARNER_SELECTION_KINDS.has(3) // => false
 */
export const LEARNER_SELECTION_KINDS: ReadonlySet<number | undefined> = new Set<
  number | undefined
>([1, 2])
/**
 * How long a selection the learner made in the active text editor (a click, a key press) counts as a sign that the keyboard is in that editor, while no stack frame is shown: a session runs, or none exists. {@link StudyWorkspace} then lets a pane or the captured source that covers that editor take the keyboard, which a hidden editor cannot keep.
 * Nothing the editor reports ends such a sign: a learner who goes on to a side-view chat, the terminal or a view is not reported. A learner who types produces a selection change with every key; one who left for the chat needs longer than this to click there, write a request and have a run reach its next reveal. The price on the other side: a learner who clicked into a file and has read it for longer than this without a key press is not known to be there.
 * @example performance.now() - learnerWorkedInEditorAtMs <= LEARNER_SIGN_FRESH_MS // => true one second after the last key press
 */
export const LEARNER_SIGN_FRESH_MS = 3_000
/**
 * How long after a debug adapter reported a stop the frame of that stop can arrive and still count as brought to the front by the editor's own handling of the stop, for a stop that handling brings only at its first try: the adapter asked to keep the focus, or the session went on before a frame of it was reported; {@link StudyWorkspace} takes a later frame as one the learner selected.
 * The first try of the editor's handling comes right after the adapter answered a `threads` and a `stackTrace` request (34 to 65 ms after the stop; measured natively on 2026-10-07 in VS Code 1.140.0 for Linux). A stop read behind another session's frame is not judged by this bound but by {@link EDITOR_FOCUS_PASS_DELAY_MS}.
 * @example performance.now() - note.readAtMs <= STOP_OWN_FOCUS_BOUND_MS // => false for a frame the learner selects two seconds after a stop the editor never showed
 */
export const STOP_OWN_FOCUS_BOUND_MS = 500
/**
 * How long after a debug session went on both editors wait before they pass the focus to a session that is still stopped, without the keyboard (`passFocusScheduler` of VS Code 1.140 and Cursor 3.23: a timer of 800 ms, started anew when the session is told to go on and when its adapter reports that it does). {@link StudyWorkspace} takes the frame of a stop that was read behind that session's frame as brought by the stop's own handling, with the keyboard, when it arrives before this delay has passed, and as passed the focus from then on.
 * The stop's own handling tries at once and, where a frame of the other session still had the focus then, a second time when the rest of the call stack is loaded, which both editors start 420 ms after the top frame. Measured natively on 2026-10-07 in VS Code 1.140.0 for Linux, nine runs of nine: a browser stop read 17 to 23 ms after the server session went on had its frame 450 to 468 ms after its `stopped` event (467 to 491 ms after the server session went on), with the keyboard in the paused file; in the other order a frame came 34 to 65 ms after its `stopped` event, and once 454 ms after one read 197 ms after the other session went on (651 ms after it). No frame at 800 ms was seen in any run.
 * @example performance.now() - wentOnAtMs < EDITOR_FOCUS_PASS_DELAY_MS // => true for a frame 491 ms after the other session went on
 */
export const EDITOR_FOCUS_PASS_DELAY_MS = 800
/**
 * How long "Codebook: Close Study Workspace" waits, once its panes' tabs are gone, for the editor to remove the groups those tabs left empty before it gives the active editor group the keyboard: the removal rebuilds the editor grid and takes the keyboard from the editor that had it (Cursor removed the captured source's group 57 ms after its tab, and the Study pane's 12 ms after its tab).
 * @example await waitUntil(() => hasNoEmptiedGroup(), 'the emptied editor groups to close', CLOSE_GROUP_SETTLE_MS)
 */
export const CLOSE_GROUP_SETTLE_MS = 250
/**
 * What "Codebook: Close Study Workspace" tells the learner, once in an editor session, when it gave the active editor group the keyboard after it closed a pane or the captured source while a pane, the captured source or the learner's own file was the active editor. Closing the panes can leave the keyboard on no element at all (the editor rebuilds its grid when their groups close), so the group gets it. The extension API cannot tell whether the keyboard was in that editor or in the terminal, a view or a side-view chat before (`window.activeTerminal` is also the terminal that had the focus last, a webview panel stays `active` while another part has the keyboard, the active text editor stays the active one, and every webview reports a blur when the Command Palette opens): for a learner who was typing there this Close moves the keyboard into the editor, and the sentence says so.
 * @example void showPlainNotice(vscode.window, 'information', STUDY_CLOSE_KEYBOARD_MESSAGE)
 */
export const STUDY_CLOSE_KEYBOARD_MESSAGE =
  'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.'
/**
 * What the reader tells the learner, once in an editor session, when a live run ended while the Study workspace was closed, the run's Application pane was the editor's active editor in the focused window, and the reader therefore gave the active editor group the keyboard after it closed that pane: a pane that is closed while it has the keyboard leaves the keyboard on no element. As at a Close ({@link STUDY_CLOSE_KEYBOARD_MESSAGE}), the editor does not say whether the keyboard was in the pane or in the terminal, a view or a side-view chat beside it, so the sentence says where it is now.
 * @example void showPlainNotice(vscode.window, 'information', RUN_CLOSED_PANE_KEYBOARD_MESSAGE)
 */
export const RUN_CLOSED_PANE_KEYBOARD_MESSAGE =
  'The run ended and Codebook closed its Application pane. The keyboard is in the active editor group now: closing the pane can leave it nowhere, and the editor does not tell Codebook whether it was in the pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.'
/**
 * What the reader tells the learner, once in an editor session, when one of its panes (the Application pane or the captured source) took the keyboard from the file the editor's debugger had opened at a pause of a live run (`debug.focusEditorOnBreak`) and the reader knew of no chat to give it back to. That is VS Code, where the chat is a side view, and Cursor while its Agent chat is a pane of the secondary side bar: there the extension API reads the same whether the keyboard was in a file or in the chat input (Cycle 0045 X7-A.4, Cycle 0046 row 5), so Codebook cannot give it back and says where it is instead. Where Cursor's chat is a tab of another editor part and had the keyboard before the pause, the reader gives it back and tells nothing.
 * @example void showPlainNotice(vscode.window, 'information', SOURCE_TOOK_PAUSED_FOCUS_MESSAGE)
 */
export const SOURCE_TOOK_PAUSED_FOCUS_MESSAGE =
  'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.'
/**
 * What the reader tells the learner, once in an editor session, when one of its panes (the Application pane or the captured source) came to the front over a file the learner was working in and took the keyboard, without the debugger having given that file the keyboard: after a frame the learner selected in the Call Stack view, at a stop with `debug.focusEditorOnBreak` off, and while a session runs. A hidden editor cannot keep the keyboard, so the pane takes it and Codebook says where it is.
 * @example void showPlainNotice(vscode.window, 'information', PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE)
 */
export const PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE =
  'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.'
/**
 * What the reader tells the learner, once in an editor session, when it placed the Application pane in a new editor group of the only editor part (VS Code, and Cursor while its Agent chat is a pane of the secondary side bar) after focusing an editor group: another group than the first was the active one (`workbench.action.newGroupAbove` adds above the active group only: VS Code 1.140.0 `workbench.desktop.main.js` 990:31741, Cursor 17388:33629), or an earlier window's leftover group had to take the keyboard for its proof. The new group has the keyboard then. The extension API reads the same whether the keyboard was in a file or in the chat view before (the active text editor stays the active one while a view has it), so Codebook gives it to no file, except one the learner clicked or typed in a moment ago ({@link LEARNER_SIGN_FRESH_MS}), and says where it is (Cycle 0046 row 612).
 * Without such a focus the new group takes the keyboard only from the editor area, and a chat view keeps it; {@link APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE} is told then.
 * @example void showPlainNotice(vscode.window, 'information', APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE)
 */
export const APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE =
  'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.'
/**
 * What the reader tells the learner, once in an editor session, when a Study selection an agent asked for through codebook_presentation placed its panes in the only editor part (VS Code, and Cursor while its Agent chat is a pane of the secondary side bar): the placement gives the captured source the keyboard to hold its own panes against a learner's newer input, and the place the selection found the keyboard in reads the same whether it was a file or the chat view, so Codebook gives the keyboard to no file it cannot prove and says where it is (Cycle 0046 row 613). The learner's own selection (the Study pane's control, a command) returns the keyboard to the active editor as before.
 * @example void showPlainNotice(vscode.window, 'information', AGENT_SELECTION_TOOK_KEYBOARD_MESSAGE)
 */
export const AGENT_SELECTION_TOOK_KEYBOARD_MESSAGE =
  'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.'
/**
 * What the reader tells the learner, once in an editor session for each place, when a Study selection an agent asked for through codebook_presentation failed after its placement focused the captured source: the sentence names the place the editor names as the active one by then, one of the reader's two panes (Cycle 0046 row 634) or the captured source. As after a placement that holds ({@link AGENT_SELECTION_TOOK_KEYBOARD_MESSAGE}, row 613), no file the learner is not known to work in gets the keyboard back. Each sentence says that the arrangement could not be finished: the sentence of a placement that holds says that Codebook arranged it, which a refused selection did not (row 637). `file`: a selection refused after its layout measurement beside another editor part (Cursor's chat part) borrowed the main editor's focus and before any placement moved the keyboard, whose learner was not known to work in the file the editor reported: the inserted Application group's element took the borrow's keyboard and its cleanup left it on the page body, so the file gets it back and the sentence says so, without claiming that the learner typed there (Cycle 0046 row 718).
 * @example void showPlainNotice(vscode.window, 'information', AGENT_SELECTION_FAILED_PANE_KEYBOARD_MESSAGES.application)
 */
export const AGENT_SELECTION_FAILED_PANE_KEYBOARD_MESSAGES = {
  application:
    'Codebook could not finish the Study arrangement an agent asked for, and the Application pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  study:
    'Codebook could not finish the Study arrangement an agent asked for, and the Study pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  source:
    'Codebook could not finish the Study arrangement an agent asked for, and the captured source has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  file: 'Codebook could not finish the Study arrangement an agent asked for, and the file you had open has the keyboard again. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
} as const
/**
 * What the Repository Wiki reader tells the learner, once in an editor session, when a Wiki an agent opened through codebook_open_book in a window without a Wiki had to measure the main editor beside another editor part (Cursor's chat editor part) by focusing its first group, and the keyboard could not be given back: the chat tab moved or closed, or the host has no command for its chat. The keyboard then goes to the Wiki, no file the learner might type into unknowingly, and the sentence says so (Cycle 0046 row 620). Where the chat tab can be found again it gets its keyboard back and nothing is told.
 * @example void showPlainNotice(vscode.window, 'information', REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE)
 */
export const REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE =
  'Codebook opened the Repository Wiki an agent asked for, and the Wiki has the keyboard now: arranging the Wiki beside its cited source needed the focus of the first editor group, and Codebook could not give the keyboard back to where you were typing. Click where you want to type.'
/**
 * What the Repository Wiki reader tells the learner, once in an editor session, when a Wiki an agent opened through codebook_open_book in a window without a Wiki was created in front of the file the learner was known to type in: the Wiki goes to the second editor group without the keyboard, a webview created in front of the text editor that has the keyboard hides that editor, and the keyboard falls to the page body, where nothing types (C60 in both hosts, Cycle 0046 row 694). Codebook then gives the Wiki the keyboard, and the sentence says so and how to type in the file again: its tab is in the same group, behind the Wiki. "Known" is a fresh sign of the learner's own hand in that file (a click or a key within {@link LEARNER_SIGN_FRESH_MS}); without one, {@link REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE} is told instead.
 * @example void showPlainNotice(vscode.window, 'information', REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE)
 */
export const REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE =
  'Codebook opened the Repository Wiki an agent asked for in front of the file you were typing in, and the Wiki has the keyboard now. To type in that file again, click its tab in the same editor group.'
/**
 * What the Repository Wiki reader tells the learner, once in an editor session, when a Wiki an agent opened through codebook_open_book in a window without a Wiki was created in front of the file the editor reported as the active text editor while no sign of the learner's own hand in it was fresh: both editors report the learner's last file so also while a view, the terminal or VS Code's chat view has the keyboard (Cycle 0046 rows 612 and 656), where the Wiki leaves it, so Codebook focuses nothing; but if the learner was typing in that file, the Wiki hid it and the keyboard fell to the page body (row 694), and the sentence says where to click.
 * @example void showPlainNotice(vscode.window, 'information', REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE)
 */
export const REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE =
  'Codebook opened the Repository Wiki an agent asked for in front of the file you had open in its editor group. If you were typing in that file, click its tab in that group to type in it again.'
/**
 * What the Repository Wiki reader tells the learner, once in an editor session, when a Wiki an agent opened through codebook_open_book in a window without a Wiki was created in front of the Study pane while that pane's document reported that it had the keyboard: the Wiki goes to the second editor group without the keyboard, a webview created in front of the pane hides it, and the keyboard falls to the page body, as for a covered file ({@link REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE}, Cycle 0046 row 705). The pane's own report is the sign that the learner works there, so Codebook gives the Wiki the keyboard, and the sentence says so and how to use the Study pane again: its tab is in the same group, behind the Wiki.
 * @example void showPlainNotice(vscode.window, 'information', REPOSITORY_WIKI_COVERED_STUDY_PANE_MESSAGE)
 */
export const REPOSITORY_WIKI_COVERED_STUDY_PANE_MESSAGE =
  'Codebook opened the Repository Wiki an agent asked for in front of the Study pane you were using, and the Wiki has the keyboard now. To use the Study pane again, click its tab, codebook · Study, in the same editor group.'
/**
 * What the reader tells the learner, once in an editor session, when a Study arrangement an agent asked for (codebook_presentation, a live request) ended the learner's Read and showed the side bars the Read had hidden again. Both editors show a side bar only with a command that gives it the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 1113:32927 `workbench.action.focusSideBar`, 859:17722 `workbench.action.focusAuxiliaryBar`, whose chat view puts it into its input at 3507:67487; Cursor 3.23.12 18340:22765, 17376:10844), and the active editor group, the pane being read, gets it after them. A Read hides the side bars but not the bottom panel (990:15233), so the learner may have been typing to the agent in the terminal, in another view or in a chat; the editor does not tell Codebook, and nothing can give it back there, so the sentence says where it is now (Cycle 0046 row 622). Not told when the Study pane reported having the keyboard, nor for the learner's own Restore.
 * @example void showPlainNotice(vscode.window, 'information', READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE)
 */
export const READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE =
  'Codebook ended your Read for the Study arrangement an agent asked for and showed the side bars the Read had hidden. Showing a side bar takes the keyboard in this editor, so the pane you were reading has it now: if you were typing in the terminal, a view or the chat, click there to type again.'
/**
 * What the reader tells the learner, once in an editor session, when an entry an agent asked for (a recording's open through codebook_playback, a Study selection through codebook_presentation while a replay is loaded) leaves the Learning summary behind the view in front of VS Code's secondary side bar. VS Code puts its chat there by default, and opening the summary's container in that bar removes the chat's element with the keyboard inside, even when the focus is kept (1.140.0 `workbench.desktop.main.js` 1639:157175, 1106:186495, 1106:190002), so the agent's answer would be hidden and the keyboard lost; Codebook keeps the chat in front and says where the summary waits. The same entry leaves the bottom panel as it is unless Observed moments is shown there already (row 621): its container would replace the learner's terminal, or a chat moved into the panel, the same way. The summary and the panel's codebook tab both carry the replay's transport, so the sentence names both places. The learner's own replay open still brings both to the front.
 * @example void showPlainNotice(vscode.window, 'information', LEARNING_SUMMARY_KEPT_BEHIND_CHAT_MESSAGE)
 */
export const LEARNING_SUMMARY_KEPT_BEHIND_CHAT_MESSAGE =
  'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).'
/**
 * What the reader tells the learner, once in an editor session, when it placed the Application pane in a new editor group of the only editor part without focusing any editor group, and nothing proved where the keyboard was: `workbench.action.newGroupAbove` gives the new group the keyboard only when the editor area or the page body had it (VS Code 1.140.0 `workbench.desktop.main.js` 990:31741, Cursor 17388:33629), and a chat view, the terminal or another view keeps it. The extension API reads the same for a file of the first group that had the keyboard without a fresh sign of the learner's hand ({@link LEARNER_SIGN_FRESH_MS}) and for a chat view beside it, and no command focuses a group or a pane only when the editor area has the keyboard short of adding or removing a group, so the sentence names both cases (Cycle 0046 row 614).
 * @example void showPlainNotice(vscode.window, 'information', APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE)
 */
export const APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE =
  'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.'
/**
 * What the reader tells the learner, once in an editor session, when a Study selection an agent asked for through codebook_presentation entered a replay or a live run and its Application preparation left the keyboard in the Application's new group while the preparation's own sentence ({@link APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE} or {@link APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE}), told once in the session already, stayed untold (Cycle 0046 row 640). The new group takes the keyboard from the editor area (VS Code 1.140.0 `workbench.desktop.main.js` 990:31740), and the arrangement's layout command gives it to the Application pane in front of that group (1106:112155 with 1106:112962, 1106:74902, 705:66733; Cursor 3.23.12 17501:57509); row 613 gives a file the learner is not known to work in nothing back. `took` is told when the preparation focused an editor group itself, `mayHave` when the editor area alone could have lost the keyboard.
 * @example void showPlainNotice(vscode.window, 'information', AGENT_SELECTION_APPLICATION_KEYBOARD_MESSAGES.mayHave)
 */
export const AGENT_SELECTION_APPLICATION_KEYBOARD_MESSAGES = {
  took: 'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group, and the Application pane has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
  mayHave:
    'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group. If you were typing in a file or another editor tab, the Application pane has the keyboard now: click where you want to type. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
} as const
/**
 * What the reader tells the learner, once in an editor session, after the learner's own Return to current pause (the Study pane's control, its shortcut or the command while that pane had the keyboard) closed the Study pane for the live arrangement: a pane that is closed while it has the keyboard leaves it on no element, so a key the learner presses then goes nowhere (Cycle 0046 row 624). The invoking control is gone, so the active editor group gets the keyboard by the rule of a Close ({@link STUDY_CLOSE_KEYBOARD_MESSAGE}): the new Application group once the Return placed it, and whatever group the editor names when the Return was refused after the pane closed. The sentence says where the keyboard is in both cases.
 * @example void showPlainNotice(vscode.window, 'information', LEARNER_RETURN_CLOSED_STUDY_PANE_MESSAGE)
 */
export const LEARNER_RETURN_CLOSED_STUDY_PANE_MESSAGE =
  'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.'
/**
 * What the reader tells the learner, once in an editor session, after it gave VS Code's chat opened as an editor tab (Chat: Open Chat in Editor, a tab of a main editor group) the keyboard back with its group's focus command where the editor itself had moved the keyboard to another group: at a pause of a live run, where the debugger opened the paused file with the keyboard. Cursor's chat tab gets its keyboard back there with Focus Agent; VS Code's gets it the same way now (Cycle 0046 row 632), also when the learner moved that tab into a floating window, whose group VS Code's numbered focus commands count after the main window's (row 636). While that tab is the active editor the extension API reads the same whether its chat input or a view (the terminal, the Call Stack) had the keyboard, since neither is a text editor (VS Code 1.140.0 `workbench.desktop.main.js` 705:2504), so the sentence says where the keyboard went and what to do if it was elsewhere. Cursor reads the same for its Agent chat tab (Cursor 3.23.12 17269:31242 and 17501:84373: the active tab group changes only when an editor part takes the focus; 17264:2840 and 17264:3411: no text editor is active; 17281:14030: the window keeps its focus), so its return at a pause is told once with this sentence too (row 635). A Close that showed a side bar a Read hid tells {@link STUDY_CLOSE_KEYBOARD_MESSAGE} instead: the chat's group is still the active one there, and the group focus after the bars gave the chat input the keyboard.
 * @example void showPlainNotice(vscode.window, 'information', CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE)
 */
export const CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE =
  'Codebook gave the keyboard back to the chat editor tab after the editor moved it to another group (at a pause, to the paused file the debugger opened). The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.'
/**
 * What the reader tells the learner, once in an editor session for each cause, after it gave a chat its keyboard back: VS Code's chat editor tab (in a main group or a floating window) or Cursor's Agent chat tab, where the extension API reads the same whether that chat's input or a view (the terminal, the Call Stack, a side-bar view) had the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 705:2504; Cursor 3.23.12 17501:84373 and 17501:88693: Cursor's active editor part changes only when an editor part takes the focus, 17264:2840 and 17264:3411: no text editor is active either way). Each sentence names its own cause (Cycle 0046 row 648), so none speaks of a pause that did not happen:
 * - `pause`: the editor's debugger opened the paused file with the keyboard ({@link CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE}, rows 632 and 635).
 * - `leftoverProof`: Codebook's proof of the editor groups an earlier window left focused one of them before it closed them, at an agent's cold Study selection or first run after a reload (rows 608 and 646).
 * - `close`: "Codebook: Close Study Workspace" ended a Read and showed the side bars the Read had hidden, whose commands take the keyboard (row 649; VS Code's chat editor tab of the active main group is told {@link STUDY_CLOSE_KEYBOARD_MESSAGE} instead, which names the active editor group the chat is in).
 * - `arrangement`: an arrangement or an Application preparation whose layout measurement beside the chat borrowed the main editor's focus (rows 647 and 655): both editors answer a layout read, and apply a layout, for the active editor part only (Cursor 3.23.12 17501:90249 `getLayout(){return this.activePart.getLayout()}` and `applyLayout`; VS Code 1.140.0 1106:182079), Cursor's active part changes only when an editor part takes the focus (17501:84373, 17501:88693), and a group's focus focuses its active editor, so the file or pane in front of the main editor's first group has the keyboard until the chat gets it back; the learner's own Arrange Study Workspace run from the terminal or a view loses its keyboard to the chat the same way (row 647).
 * - `refusedArrangement`: the same borrow of an arrangement or an Application preparation that was refused afterwards: nothing was placed, so the sentence of `arrangement`, which says that Codebook placed its panes, would be untrue (Cycle 0046 row 718).
 * - `unprovenLeftoverProof`: the same proof as `leftoverProof` when the first group did not match the record (the learner resized or rearranged the grid since, or the empty group is the learner's own): the proof focused it and closed nothing, so the sentence of `leftoverProof`, which says that Codebook closed the groups, would be untrue (Cycle 0046 FX-D1-1).
 * - `refusedLeftoverProof`: the same proof as `leftoverProof` when it ended in a refusal after its focus command took the keyboard (the editor refused a group's close, or the grid did not lose that group): the groups were not all closed, so the sentence of `leftoverProof`, which says that Codebook closed them, would be untrue (Cycle 0046 OCR1-2).
 * @example void showPlainNotice(vscode.window, 'information', CHAT_KEYBOARD_RETURNED_MESSAGES.leftoverProof)
 */
export const CHAT_KEYBOARD_RETURNED_MESSAGES = {
  pause: CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE,
  leftoverProof:
    'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  close:
    'Study workspace closed, and Codebook gave the keyboard back to the chat: showing the side bars your Read had hidden took it. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  arrangement:
    'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  refusedArrangement:
    'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  unprovenLeftoverProof:
    'Codebook gave the keyboard back to the chat after it checked the empty editor groups an earlier window may have left and closed none of them: checking them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  refusedLeftoverProof:
    'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
} as const
/** Workspace-state key recording that Cursor's learner took the Move View step for the Learning summary (the offer's button or the summary's title action), so the offer after a shown summary is not made again. An offer that was only shown stores nothing: Cursor removes an unanswered notification by itself, and the offer returns in the next editor session. */
export const SUMMARY_PLACEMENT_ANSWERED_KEY =
  'codebook.summaryPlacementAnswered.v1'
/** The two buttons of the modal warning that answers a foreign preview tab blocking Open replay; each one retries the open (F158, D33). */
export const FOREIGN_PREVIEW_ACTION = {
  keepOpen: 'Keep Tab Open',
  close: 'Close Tab',
} as const
/** Profile-wide (global state) key recording that Codebook moved the Learning summary beside VS Code's chat once, at the learner's first replay open; it keeps that move to once, so a place the learner chose afterwards is never overridden (F209, D31). */
export const SUMMARY_BESIDE_CHAT_MOVED_KEY =
  'codebook.summaryBesideChatMoved.v1'
/** VS Code's internal command that moves views into a container; its argument is {@link SUMMARY_BESIDE_CHAT_MOVE_ARGUMENT}. Internal to VS Code, so a missing or refusing command is expected and only reported (F209). */
export const MOVE_VIEWS_COMMAND = 'vscode.moveViews'
/** The argument that moves the Learning summary into VS Code's Chat container, the secondary side bar the PNG's region 2 shows (F209, D31). */
export const SUMMARY_BESIDE_CHAT_MOVE_ARGUMENT = {
  viewIds: ['codebook.learningSummary'],
  destinationId: 'workbench.panel.chat',
} as const
/** The Application pane's own title: at its creation, and again when another writer takes its document after a browser replay retitled it (Cycle 0052 task 4). */
export const APPLICATION_PANE_TITLE = 'codebook · Application'
/** The Application pane's title while it shows a browser replay's recorded frames. */
export const RECORDED_APPLICATION_PANE_TITLE = 'codebook · Recorded application'
/** Why the Learning summary opens on the left in Cursor and how to keep it on the right; Cursor rejects an extension's own secondary side bar container, so only the learner's Move View can place it there. */
export const SUMMARY_PLACEMENT_OFFER =
  'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.'
/** What Cursor's learner is told when Show Variables opened Run and Debug in the side bar the Learning summary shares with it, with the same button as {@link SUMMARY_PLACEMENT_OFFER}. */
export const SUMMARY_DISPLACED_OFFER =
  "Run and Debug took the Learning summary's place in Cursor's side bar. Move the summary to the right once to keep both in view."
/** The button of {@link SUMMARY_PLACEMENT_OFFER} and {@link SUMMARY_DISPLACED_OFFER}; it opens the editor's own Move View list for the Learning summary. */
export const SUMMARY_PLACEMENT_ACTION = 'Move Learning Summary…'
/** The context key the reader turns on in Cursor; while it is on, the manifest shows "Codebook: Move Learning Summary…" in the Learning summary's title and in the Command Palette. */
export const SUMMARY_PLACEMENT_CONTEXT_KEY = 'codebook.learningSummaryMovable'
/** How long closing the reader waits for each pending storage write (saved replay position, archive writes, library queue); a write still pending then keeps running. */
export const READER_CLOSE_STORAGE_TIMEOUT_MS = 5_000
export const STUDY_LAYOUT_STABLE_MISMATCH_MS = 750
/** The height VS Code and Cursor give an editor group at least (their `DEFAULT_EDITOR_MIN_DIMENSIONS`, 220 × 70 px: the tab row and as much again). A hidden editor area reports every stacked group at this height. */
export const EDITOR_GROUP_MINIMUM_HEIGHT_PX = 70
/**
 * The tab input classes of editors besides `TabInputText` and `TabInputWebview`, by the names under which both editors' extension hosts export them on `vscode` (a diff, a custom editor, a notebook and its diff, a terminal in the editor area); a host that exports one of them not is asked for it in vain and skips it. A group that holds such a tab belongs to a part with editors, not to a chat part (Cycle 0046 row 689).
 * Each name must be an export of the editor's API types (`@types/vscode`), so a misspelled name fails the type check instead of being skipped as a missing export (Cycle 0046 T7). The import of those types is erased from the emitted module, which is also loaded where the editor's API does not exist.
 * The editors' runtime-only classes the API types do not name are {@link UNTYPED_EDITOR_TAB_INPUT_KINDS}.
 * @example EDITOR_TAB_INPUT_KINDS.map((kind) => Reflect.get(vscode, kind)) // => [TabInputTextDiff, TabInputCustom, …]
 */
export const EDITOR_TAB_INPUT_KINDS = [
  'TabInputTextDiff',
  'TabInputCustom',
  'TabInputNotebook',
  'TabInputNotebookDiff',
  'TabInputTerminal',
] as const satisfies readonly (keyof typeof vscode)[]
/**
 * The tab input classes of editors that both editors' extension hosts export on `vscode` and build for their tabs although the editor's API types (`@types/vscode`) do not name them: the merge editor, the multi-file diff editor and the interactive window (VS Code 1.142.0 and Cursor 3.23.23 `extensionHostProcess.js`: `TabInputTextMerge`, `TabInputTextMultiDiff` and `TabInputInteractiveWindow` among the API's exports, built by the tab model's `_initInput` from the kinds the workbench's `_editorInputToDto` sends: 3, 11 and 9). A group that holds such a tab belongs to a part with editors, not to a chat part (Cycle 0046 Q7).
 * Read with `Reflect.get` like {@link EDITOR_TAB_INPUT_KINDS}; a host that does not export one skips it. No type check guards these names: they are the hosts' own, as their bundles export them.
 * @example UNTYPED_EDITOR_TAB_INPUT_KINDS.map((kind) => Reflect.get(vscode, kind)) // => [TabInputTextMerge, TabInputTextMultiDiff, TabInputInteractiveWindow]
 */
export const UNTYPED_EDITOR_TAB_INPUT_KINDS = [
  'TabInputTextMerge',
  'TabInputTextMultiDiff',
  'TabInputInteractiveWindow',
] as const
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
/** Selects the current native debugger model without moving editor keyboard focus; {@link ReplayDebugger} uses it only while its historical session remains the active owner. */
export const NATIVE_DEBUG_FOCUS_SESSION_COMMAND =
  'workbench.action.debug.focusProcess'
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
/** The most characters of a failure's cause a tooltip, a notification or an MCP message of the test replay shows; the Output › Codebook entry keeps the whole sanitized cause ({@link sanitizeCause}). */
export const UI_CAUSE_MAX_CHARS = 300
export const STUDY_SOURCE_SCHEME = 'codebook-source'
/** The first path segment of a test replay's recorded-source slot ({@link nodeSourceSlotPath}): one Codebook-owned source document per opened test replay, whose text follows the selected moment (DS5). */
export const NODE_SOURCE_SLOT_PATH_ROOT = 'node-history-slot'
/** How many hex characters of the source file's folder hash {@link nodeSourceSlotPath} puts between the study id and the tab title, so two files of the same name in different folders get different slots (F200). */
export const NODE_SOURCE_SLOT_DIRECTORY_HASH_CHARS = 12
/** How long a test replay's recorded-source slot may take to show a selected moment's bytes before it is asked to read them again; the slot keeps its loading text meanwhile, never the earlier moment, and the selection is not failed by this bound alone ({@link NODE_HISTORY_SLOT_DEADLINE_MS} fails it) (EN8). */
export const NODE_HISTORY_TRANSITION_BOUND_MS = 1_000
/**
 * How long a test replay's recorded-source slot keeps the earlier stop's bytes after the selection left that stop, so no native view still drawing the earlier stop sits beside the next moment's bytes (F385, F387).
 * The native view that redraws after the leave is the Call Stack: VS Code's applies the debugger's `continued` in a 50 ms scheduler (`CallStackView.onCallStackChangeScheduler`) followed by the thread and stack requests, and Cursor's is slower. The value was set for the slot's CodeLens as well, which the editor refreshed at least 250 ms after a provider change (`LanguageFeatureDebounceService.for(codeLensProvider, 'CodeLensProvide', { min: 250 })`, 1.143.0); that lens is gone (Cycle 0052 task 1), and the 300 ms that N50 and N51 verified natively are kept. The bytes change once, after it.
 */
export const NODE_HISTORY_LEAVE_SETTLE_MS = 300
/** One deadline over a test replay's whole recorded-source show: the document's open, its show, the wait for its bytes and the close of the earlier slot tab. When it passes first, the moment reports its `history-source` row and releases Play's pending selection (closure rule 7 of #118). */
export const NODE_HISTORY_SLOT_DEADLINE_MS = 5_000
/** How long closing the reader waits for the reader position writes of a test replay that are still running (F197): a write that has not returned by then is left to finish in the background, so a stuck disk cannot hold the close. */
export const NODE_HISTORY_POSITION_DRAIN_MS = 2_000
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
/** Bounds the current-document acknowledgement before {@link RepositoryReader.open} hands native input to the Wiki. */
export const REPOSITORY_READER_READY_TIMEOUT_MS = PRESENTATION_READY_TIMEOUT_MS
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
/** The folder of the learning directory that keeps, for each recording a run still writes, the full identity of the editor process that writes it (`<study id>.json`, the record of the storage lock: machine, boot and process start); outside every recording folder, because 0.2.29.0 refuses a recording whose header or folder holds anything it does not know, and it reads no other folder of the learning directory ({@link recordingOwnerRecordPath}). */
export const RECORDING_OWNERS_DIRECTORY = 'recording-owners'
/** How many clock ticks a second has in the start time Linux writes for a process (`USER_HZ`, field 22 of `/proc/<pid>/stat`): 100 on every architecture this extension runs on. */
export const LINUX_CLOCK_TICKS_PER_SECOND = 100
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
// How many characters of an interrupted or partial test replay's reason the Study section shows on its one line.
export const NODE_CAPTURE_REASON_LIMIT_CHARS = 240

/** The UTF-16 code units of a surrogate pair's first (high) half; a high unit followed by a low one is one code point ({@link isSurrogatePairAt}). */
export const HIGH_SURROGATE_FIRST_UNIT = 0xd800
export const HIGH_SURROGATE_LAST_UNIT = 0xdbff
/** The UTF-16 code units of a surrogate pair's second (low) half. */
export const LOW_SURROGATE_FIRST_UNIT = 0xdc00
export const LOW_SURROGATE_LAST_UNIT = 0xdfff
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
/** How long an explicit move within a loaded recording waits for the next frame's bytes with the shown pixels untouched before the Application pane blanks to its loading line; a frame read that passes it hides the page, a read that ends sooner swaps the pixels without a dark frame (F3, D29). */
export const PLAYBACK_FRAME_READ_BOUND_MS = 1_000
/** The longest Play waits between two events of a test replay, however far apart the journal recorded them (the test ran unrecorded between stops). */
export const NODE_HISTORY_PLAY_MAX_DWELL_MS = 1_500
export const PLAYBACK_PREFERENCE_FILE = 'playback.v1.json'
export const PLAYBACK_PREFERENCE_LIMIT_BYTES = 65_536
/** Converts milliseconds to the seconds that playback labels, seek steps and run failure texts name. */
export const MILLISECONDS_PER_SECOND = 1_000
export const PLAYBACK_PAGE_STEP_MS = 10_000
export const REPLAY_VIEWPORT_RECEIPT_LIMIT = 12
export const REPOSITORY_GIT_TIMEOUT_MS = 5_000

/** The bound of the repository revision read a server history's header carries: a slow Git costs the header its revision (read as unknown), never the history. */
export const REPOSITORY_REVISION_BOUND_MS = 500
export const REPOSITORY_GIT_LIMIT_BYTES = 2_097_152
export const REPOSITORY_MAX_TRACKED_FILES = 5_000
export const REPOSITORY_SOURCE_PAGE_SIZE = 100
export const REPOSITORY_PATH_LIMIT_CHARS = 512
export const REPOSITORY_SOURCE_LIMIT_BYTES = 262_144
/** Said where an agent reads source text before it cites lines or declares a stop (the description of `codebook_source`, the source-only help and the repository-browser help), so it takes each line from Codebook's numbered copy, the answer's one copy of the lines, instead of counting lines. */
export const NUMBERED_SOURCE_LINES_HELP =
  "numberedText gives the source's lines once, each after its one-based number and a tab: take the line of every citation and every stop from it instead of counting lines."
/** Said where an agent reads the inspection rule before it declares a stop (the description of every `inspections` field of `codebook_start` and the repository-browser help's `inspections`), so it knows that Codebook requests a stop whose own line declares a binding it requires after that declaration's statement, when the stop stays on its line instead, when a partly scanned server stop whose module is not loaded is refused at its arming ({@link ConfiguredBrowserRun.armsInsideDeclarationUnasked}), and what to require for the state before that line. */
export const SELF_DECLARED_BINDING_HELP =
  "A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; Codebook then requests the stop on the first line within the stop's citation that can pause after the statement that line begins, and names that line in the inspection's armed and place, so require a value that already exists before the stop's line when you want the state before that line runs; when no later line of the citation can pause, the statement does not end within the citation, Codebook does not recognize the declaration (it reads only the first const or let with an initializer on the stop's line, not a pattern over several lines or a second declarator), or the sealed map is too large to scan completely and the debugger lists no place after the statement where it can pause, the stop stays on its line and its failure names the line to follow; a server stop in such a map whose module the server has not loaded when the stop is armed cannot be asked for that place, so it is refused when it is armed, before its breakpoint is set, and its failure names the first line after the statement; when you know the statement spans several lines, declare the stop on a statement after it."
/** Said where an agent reads what refuses a run (the `recovery` of the repository-browser help and of the node-test help), so it knows that a start saves no document, that a cited source open in the editor with other text refuses the start before anything runs and ends a run that is already going ({@link assertConfiguredSourceDocuments}), and what the learner and it do then. */
export const OPEN_CITED_SOURCE_HELP =
  'Codebook starts its debuggers without saving a document of the learner, and a start is refused with SOURCE_CHANGED, before the application, the test, the browser or a debugger is started, while a cited source is open in the editor with text that differs from the text the article cites, and a run that is already going ends with it at its next stop at the latest (a document that is only marked as modified and holds the cited text refuses and ends nothing): the message names the file, so ask the learner to save it, then read the source again and publish the article again, or to revert it, and start a new run.'
/** The most node ids a refused start names of the revision it selected, before the rest is counted ({@link describeMissingBookNode}). */
export const MISSING_BOOK_NODE_IDS_NAMED_LIMIT = 5
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
/** The SHA-256 hashes (base64), as a Content-Security-Policy names them, of the inline script the publisher's page shell carries: the Wiki reader lets exactly these inline scripts of a page run, so a script written straight into a page file runs nowhere on the reader's origin. A shell whose script changes adds its hash here, and older ones stay, so the Wikis earlier builds published keep their theme button and their offline note. */
export const WIKI_SHELL_SCRIPT_HASHES: readonly string[] = [
  // Every shell from the first reader (0.2.12.0) until Cycle 0046 D2.
  'yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=',
  // The shell since Cycle 0046 D2: its offline note goes to the question status line.
  'IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE=',
  // The shell since Cycle 0055 3b: its offline note names Codebook: Open LLM Wiki in Browser.
  'GoGWOnobpjAQPs0FqLJ0VBDun38ornPsvhcQ6D2WJxI=',
]
/** The last code point of Unicode. A browser reads a numeric character reference past it as the replacement character; the Wiki reader reads it as this one. Neither is a letter or a colon of a scheme. */
export const UNICODE_LAST_CODE_POINT = 0x10ffff
/** Route of the Wiki reader that answers the update run's state; the reader hands it to its page script, so both sides take the name from here. */
export const WIKI_UPDATE_STATUS_ROUTE = 'api/update-status'
/** Route of the Wiki reader that answers how the Wiki stands against the source; handed to the page script like {@link WIKI_UPDATE_STATUS_ROUTE}. */
export const WIKI_FRESHNESS_ROUTE = 'api/freshness'
/** Route of the Wiki reader that takes a repository question from its own page. */
export const WIKI_QUESTION_ROUTE = 'api/ask'

/** The reader's status line while a question waits for the editor model; the editor may be asking for consent meanwhile. */
export const WIKI_QUESTION_WAITING_STATUS =
  'Asking the editor model… The editor may first ask you to allow Codebook to use it; answer there.'
/** The rules of the question status line of a Wiki page (`.qa-status`, the empty `role=status` line the progress of a question is told in): the bundled `reader-shell.html` carries the same rules, and the reader's page script adds them to a page published before the shell had the line, when it adds the line there. Empty, the line takes no room. */
export const WIKI_QUESTION_STATUS_STYLE =
  '.qa-status{font-size:.85rem;margin:.4rem 0 0;overflow-wrap:anywhere}.qa-status:empty{margin:0}'
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
/** What the Wiki publisher appends to the output folder's path for the publish lock a publish or a preview (`--render-only`) holds while it writes, and that a stopped one leaves for `--recover`. */
export const WIKI_PUBLISH_LOCK_SUFFIX = '.publish-lock.json'
/** What the Wiki publisher puts between the output folder's name and a random id for the backup of the generation it replaced (`wiki.previous-<uuid>`); such a sibling is never a candidate and never added source. */
export const WIKI_PUBLISH_BACKUP_INFIX = '.previous-'
/** What the Wiki publisher puts between the output folder's name and a random id for a candidate it prepares by default (`wiki.stage-<uuid>`). */
export const WIKI_PUBLISH_STAGE_INFIX = '.stage-'
/** Largest manifest or publication receipt of a Wiki folder the update flow reads; a manifest carries every page's text, so the bound is generous, and it only keeps a link to an endless device from filling memory. */
export const WIKI_METADATA_FILE_LIMIT_BYTES = 67_108_864
/** How many bytes one further read of a bounded Wiki file read ({@link readUpToLimit}) asks for when the file grew after its size was checked; the first read takes the size it had then. Every such read uses it: a Wiki manifest, receipt or update marker, a recording's header and writer record, and every page file the Wiki reader serves. */
export const WIKI_FILE_READ_CHUNK_BYTES = 65_536
/** How many indexed sources a freshness check hashes at the same time. */
export const WIKI_FRESHNESS_HASH_CONCURRENCY = 16
/** How long a watched Wiki update lets a newly published manifest stay unreadable before it ends as a publish Codebook cannot read; a manifest that is still being written becomes readable well within it. */
export const WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS = 10_000
/** The chat request that makes the editor agent run the publisher's recovery; the sentences of an unfinished publish, a publish lock that blocks a start, a manifest changed after its publish and a manifest Codebook cannot read all name it, so the learner can paste it. */
export const WIKI_UPDATE_RECOVERY_REQUEST =
  '/codebook Recover the unfinished LLM Wiki publish for this project'
/** What a running Wiki update appends to the output folder's path for its marker file, which tells other editor windows that this Wiki is being updated. */
export const WIKI_UPDATE_RUN_MARKER_SUFFIX = '.update-run.json'
/** How long past its host's longest run a running Wiki update's marker still counts for other editor windows, before {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS} is added; it covers the stop of the agent and the end's own file work, and after both a marker whose owner cannot be judged by its process start (one of another machine, or of 0.2.29.0 whose process id still answers) is nobody's run. */
export const WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS = 60_000
/** How far the clocks of two windows on one Wiki, or one clock before and after a correction, may differ without changing what a marker means: a run's marker expires this much later than its bound, a marker whose run starts further ahead of the reader's clock is nobody's, and a marker file without content that was written further ahead is not taken for one being written. */
export const WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS = 300_000
/** How long a marker file without readable content counts as one another window is writing at this moment; an older one was left by a killed window and is nobody's. A window of this build links a complete marker into place, so only a window of 0.2.29.0, or one on a file system without hard links, shows such a file, for the time of one write. */
export const WIKI_UPDATE_MARKER_WRITE_GRACE_MS = 2_000
/** The mode a Wiki update's marker file is created with: that of any file a project holds, which the process's file mode mask narrows, so a window of another user on a shared project folder can read whose update runs. */
export const WIKI_UPDATE_MARKER_FILE_MODE = 0o666
/** The mode the claim folder beside a Wiki update's marker is created with: that of any folder a project holds, which the process's file mode mask narrows. With {@link WIKI_UPDATE_MARKER_FILE_MODE} for the claim file inside it, a window of another user on a shared project folder can judge the claim a killed window left, and remove it where the folder's modes let it write. */
export const WIKI_UPDATE_MARKER_CLAIM_DIRECTORY_MODE = 0o777
/** How often the end of a Wiki update asks for the exclusive claim on its marker file before it leaves the marker as it is; another window holds that claim for the time of one read and one removal. */
export const WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS = 20
/** How long the end of a Wiki update waits between two attempts to claim its marker file; with the attempts about half a second. */
export const WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS = 25
/** How long a window waits before it asks once more to remove its own Wiki update marker, or to turn it into a stopped watch's reservation, after the change could not be made: the claim on the marker could not be had at any of {@link WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS} attempts (another window held it, or the system refused it), or the file system refused the change. Until then other windows read the marker as it stands. */
export const WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS = 10_000
/** How often a window asks once more for such a change of its marker before it leaves the marker to its own expiry; with {@link WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS} two minutes, longer than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}, after which the claim a killed window of another machine left no longer counts. */
export const WIKI_UPDATE_MARKER_CHANGE_RETRIES = 12
/** How old a claim on a Wiki update's marker file must be to count as left by a killed window, where its owner cannot be judged by this process ({@link canJudgeOwnerHere}: a claim of another machine, of 0.2.29.0, or of a window whose process start could not be read); a running window holds the claim for milliseconds. The age counts by this window's clock and by the clock that stamped the claim (a file server's, the Windows host's under WSL2), so a local clock that runs ahead does not age a claim placed a moment ago. */
export const WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS = 60_000
/** The coarsest step in which a file system that may hold a project folder stamps a file's modification time (FAT stores 2 s); a new file whose stamp lies less than this behind the wall clock is rounded, and only one further behind shows a clock of the file system that lags ({@link claimWikiUpdateMarker}). */
export const WIKI_UPDATE_MARKER_STAMP_STEP_MS = 2_000
/** How recently the publisher's journal or publish lock must have been written for the start check to take it for a publish or a preview that may be ending right now and look once more before it reports the record. */
export const WIKI_PUBLISH_JOURNAL_FRESH_MS = 10_000
/** How long a VS Code Wiki update waits, from handing its request to the editor's chat, for the first sign that the chat works on it (its reply or its wait for a confirmation, a step of the update the editor reports, a folder the publisher prepares) before the run ends as failed and the request is left in the chat. */
export const WIKI_CHAT_OPEN_TIMEOUT_MS = 30_000
/** How long a VS Code Wiki update gives each of the two editor commands that start a chat session of its own (the reveal of the chat and New Chat) to return before it sends the request into the session the learner has open. */
export const WIKI_CHAT_SESSION_START_TIMEOUT_MS = 5_000
/** How many characters of the error VS Code's chat command threw the failure sentence of a Wiki update quotes; the sentence is shown whole with its next step, so the editor's text inside it is bounded. */
export const WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS = 120
/** What a Wiki update says when it was blocked by a conflict that names no file, so that the learner cannot be told what to move: the reason of the `failed` state {@link WikiUpdateRun} records for a finished update and for a refused start alike. */
export const WIKI_UPDATE_UNNAMED_BLOCK_REASON =
  'The update was blocked, but no blocking file was named.'
/** Key of the workspace state that keeps how this window's last Wiki update ended, so a reloaded window still knows its own leftover candidate. */
export const WIKI_UPDATE_LAST_RUN_STATE_KEY = 'codebook.wikiUpdateLastRun'
/** What a VS Code Wiki update says when its output folder lies outside the opened project: in the confirmation and, handed to {@link describeWikiUpdate} as `outsideOutputApprovalsNote`, the running line of the page. The watch's status bar entry does not carry it ({@link WIKI_CHAT_WATCH_TOOLTIP}). */
export const WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE =
  'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.'
/** What a learner does after they refused a step VS Code's chat asked them to approve, as a clause without its full stop: once the chat has asked, Codebook does not see it stop, so the watch goes on until Stop watching. Handed to {@link describeWikiUpdate} as `refusedStepAdvice`, the running line of the page goes on from it with where Stop watching is, the watch's status bar entry ({@link WIKI_CHAT_WATCH_STATUS_TEXT}), which names only its Stop watching. */
export const WIKI_REFUSED_STEP_ADVICE =
  'If you refuse a step of the chat, press Stop watching'
/** The text of the status bar entry that is shown for as long as Codebook watches a VS Code Wiki generation or update, for every entry of the run: a spinning icon, what is watched and its Stop watching (Cycle 0055 D4: it stops the watch, not the chat, so it is not called Cancel), which a press on the entry runs ({@link WIKI_CHAT_WATCH_CANCEL_COMMAND}). The watch shows no notification: the editor stacks notifications at the window's lower right, over the Chat view in its default place, so any other notification pushes one that lasts the whole watch over the Allow and Skip buttons of an approval the chat asks for (measured in VS Code 1.140.0 with a notification of two lines and the editor's own recommendation below it). The status bar lies below every notification. */
export const WIKI_CHAT_WATCH_STATUS_TEXT =
  '$(sync~spin) Watching for the LLM Wiki · Stop watching'
/** The tooltip and accessible name of the watch's status bar entry ({@link WIKI_CHAT_WATCH_STATUS_TEXT}). It says what is watched and what its Stop watching stops, in words that are true wherever the request went: a new chat, the chat the Chat view restored, or the chat that was open. Where the request went, when the watch ends and what to do after a refused step are said by the confirmation, the page's running line and the README. */
export const WIKI_CHAT_WATCH_TOOLTIP =
  'Watching the editor chat for the LLM Wiki. Stop watching stops Codebook’s watch, not the chat.'
/** The command a press on the watch's status bar entry runs: it stops the VS Code watch this window shows, not the chat. Registered at activation and not contributed to the Command Palette: the entry is its one way in. */
export const WIKI_CHAT_WATCH_CANCEL_COMMAND = 'codebook.cancelWikiChatWatch'
/** The identifier of the watch's status bar entry, under which the editor keeps whether the learner hid it. */
export const WIKI_CHAT_WATCH_STATUS_ID = 'codebook.wikiChatWatch'
/** The name of the watch's status bar entry in the status bar's context menu. */
export const WIKI_CHAT_WATCH_STATUS_NAME = 'Codebook LLM Wiki run'
/** Milliseconds in one minute, for naming a bound in minutes in the update request and, through {@link formatWaitEnd}, the end of a start's wait or of an unreadable marker's refusal as a whole minute. */
export const MS_PER_MINUTE = 60_000
/** The first character code that is no C0 control character; the LLM Wiki run's Output record escapes the codes below it ({@link wikiRunRecord}). */
export const CONTROL_CHARACTER_CODE_LIMIT = 0x20
/** The DEL control character's code, which the LLM Wiki run's Output record escapes too. */
export const DELETE_CHARACTER_CODE = 0x7f
/** What Codebook says when Stop LLM Wiki Run or a no-Wiki notice meets a run of this window that is still starting (its checks, the confirmation, the claim): nothing can be stopped yet, and its progress shows once it runs (/ship review, Cycle 0055 pt1). */
export const WIKI_RUN_STARTING_SENTENCE =
  'Codebook is starting an LLM Wiki run in this window. Once it runs, its progress shows and Stop LLM Wiki Run stops it.'
/** Longest a VS Code Wiki update is watched for a published manifest before it ends as timed out. */
export const WIKI_UPDATE_WATCH_TIMEOUT_MS = 900_000
/** Longest a Wiki generation runs in either host, the VS Code watch and the Cursor agent alike, before it ends as timed out: 55 minutes, set by Cycle 0055's E1 (the longest measured generation, 34 min 33 s in VS Code, × 1.5, rounded up to whole 5 minutes; Owner decision O9). A stopped VS Code generation's reservation lasts as long after its watch's end. */
export const WIKI_GENERATE_TIMEOUT_MS = 3_300_000
/** Longest the managed Cursor skill's verify and deploy may take while a start holds its marker: 30 seconds, after which the start ends without an agent and leaves the marker (removed, or a taken-over reservation written back) (Cycle 0056 task 13). */
export const WIKI_SKILL_STEP_TIMEOUT_MS = 30_000
/** The abort reason of a Cursor skill step the learner ended (Stop LLM Wiki Run) or the closing window ended; {@link describeWikiSkillStepEnd} words it. */
export const WIKI_SKILL_STEP_STOPPED_REASON = 'stopped'
/** The abort reason of a Cursor skill step that passed {@link WIKI_SKILL_STEP_TIMEOUT_MS}. */
export const WIKI_SKILL_STEP_BOUND_REASON = 'bound'
/** How a start's own bound ended it while it still waited for an earlier skill step of this window that never settled; not an abort reason (the abort says `bound`), {@link describeWikiSkillStepEnd} words it. */
export const WIKI_SKILL_STEP_EARLIER_RUNNING_END = 'earlier-step-running'
/** What {@link WIKI_SKILL_STEP_EARLIER_RUNNING_END} says happened and what ends it, without the next press; {@link describeWikiSkillStepEnd} adds `, then press <Generate|Update> LLM Wiki again.` (Cycle 0056 RT-B). */
export const WIKI_SKILL_STEP_EARLIER_RUNNING_SENTENCE =
  'Codebook could not ready the Cursor skill: an earlier Cursor skill step in this window is still running. Reload the window (Developer: Reload Window) to end it'
/** How a start ended when its Cursor skill step began while Remove Managed Cursor Skill was under way in this window, so it neither verifies nor deploys the skill the removal takes away; not an abort reason, {@link describeWikiSkillStepEnd} words it (Cycle 0056 pass 3). */
export const WIKI_SKILL_STEP_REMOVAL_END = 'skill-removal'
/** What Codebook says when Remove Managed Cursor Skill meets a Cursor skill step of this window that is still running after the grace, so a late deploy could write the skill again; nothing is removed (Cycle 0056 RT3-C). */
export const WIKI_SKILL_REMOVAL_STEP_RUNNING_SENTENCE =
  'Codebook did not remove the managed Cursor skill: a Cursor skill step of this window is still running and could write the skill again. Reload the window (Developer: Reload Window) to end it, then run Codebook: Remove Managed Cursor Skill again.'
/** The longest any run of any kind and host can last ({@link longestWikiRunMs}): a VS Code generation's chat opening plus its bound. A marker file whose kind cannot be read counts this long, never the update's shorter bound. Written from the raw bounds here because the helpers that name each bound read this module; `wikiRunBoundMs.test.ts` pins it against {@link longestWikiRunMs} over every kind and host, so a changed bound that this list misses fails there. */
export const LONGEST_WIKI_RUN_MS = Math.max(
  WIKI_GENERATE_TIMEOUT_MS,
  WIKI_CHAT_OPEN_TIMEOUT_MS + WIKI_GENERATE_TIMEOUT_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_CHAT_OPEN_TIMEOUT_MS + WIKI_UPDATE_WATCH_TIMEOUT_MS,
)
/** The chat request a learner can paste to generate the LLM Wiki without Codebook's entry; every generate sentence that sends the learner to the chat names it. */
export const WIKI_GENERATE_CHAT_REQUEST =
  '/codebook Generate the LLM Wiki for this project'
/** The chat request a learner can paste to see what the Cursor agent of an update said; the update sentences of a Cursor run name it. */
export const WIKI_UPDATE_CHAT_REQUEST = '/codebook Update LLM Wiki'
/** The command that generates the LLM Wiki of the opened project through the editor agent (Codebook: Generate LLM Wiki). */
export const GENERATE_DEEP_WIKI_COMMAND = 'codebook.generateDeepWiki'
/** The command that stops this window's LLM Wiki run (Codebook: Stop LLM Wiki Run): the VS Code watch, which is not the chat, or the Cursor agent. */
export const CANCEL_WIKI_RUN_COMMAND = 'codebook.cancelWikiRun'
/** The command that opens Output › Codebook, where each LLM Wiki generation or update writes the record of its end. */
export const SHOW_WIKI_OUTPUT_COMMAND = 'codebook.showWikiOutput'
/** The button of the no-Wiki notices and of a failed generation's notice that starts {@link GENERATE_DEEP_WIKI_COMMAND}. */
export const GENERATE_WIKI_ACTION = 'Generate LLM Wiki'
/** The button of the generation's confirmation that starts it. */
export const GENERATE_CONFIRM_ACTION = 'Generate'
/** The button of the generation's confirmation that opens the output setting and starts nothing. */
export const CHANGE_WIKI_LOCATION_ACTION = 'Change location'
/** The button of a refusal that names an earlier chat's leftover before a generation: it starts the generation with that leftover ignored. */
export const GENERATE_ANYWAY_ACTION = 'Generate anyway'
/** The button of the offer a Generate gives where an LLM Wiki already exists: it starts {@link WIKI_UPDATE_CHAT_REQUEST}'s update instead. */
export const UPDATE_WIKI_ACTION = 'Update LLM Wiki'
/** The button of a generation's notices that opens the new Wiki in the browser. */
export const OPEN_WIKI_IN_BROWSER_ACTION = 'Open in Browser'
/** How many characters of a commit hash the generation line of the LLM Wiki view's Wiki row shows. */
export const WIKI_SHORT_REVISION_CHARS = 7
/** VS Code's command that reveals the chat a request would go to (the chat focused last when it can be shown, the Chat view otherwise) and makes it the chat focused last; with a query it sends the query as a request into that chat and, with `blockOnResponse`, returns when the response completes or waits for a confirmation. Without one it only reveals the chat: the LLM Wiki view's Open Chat action runs it, so a chat that waits for an approval, or never started the skill, is one click away. */
export const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'
/** The editor's own command that opens settings, with a setting's id as its argument. */
export const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings'
/** The id of the setting that names the Wiki output folder. */
export const WIKI_OUTPUT_DIRECTORY_SETTING = 'codebook.wikiOutputDirectory'
/** The settings search that shows the setting naming the Wiki output folder, the argument of {@link OPEN_SETTINGS_COMMAND}. */
export const WIKI_OUTPUT_SETTINGS_QUERY = `@id:${WIKI_OUTPUT_DIRECTORY_SETTING}`
/** The id of the LLM Wiki tree view in the Activity Bar (Cycle 0055 pt2). */
export const LLM_WIKI_VIEW_ID = 'codebook.llmWiki'
/** The context key that says what the LLM Wiki view shows, so its welcome content shows in the empty state only: `loading` until the first read ends, `none` when the folder holds no Wiki and no run, `other` for every row. */
export const LLM_WIKI_STATE_CONTEXT_KEY = 'codebook.llmWiki.state'
/** The context key that names the editor host (`vscode` or `cursor`), so the welcome content words the runner of the host it runs in. */
export const CODEBOOK_HOST_CONTEXT_KEY = 'codebook.host'
/** How long the LLM Wiki view waits after the last event that asks for a read before it reads: events inside this time coalesce into one read, and the last event always reads. */
export const LLM_WIKI_REFRESH_DEBOUNCE_MS = 1_000
/** How often the LLM Wiki view reads its state again while a row of a run (this window's, another window's or a stopped watch's reservation) is shown: a marker whose window died leaves no file event. */
export const LLM_WIKI_POLL_MS = 30_000
/** The editor's command that sets a context key (`setContext`, key, value). */
export const SET_CONTEXT_COMMAND = 'setContext'
/** The editor's command that shows a file or folder in the system's file manager. */
export const REVEAL_FILE_IN_OS_COMMAND = 'revealFileInOS'
/** The editor's command that opens its folder dialog. */
export const OPEN_FOLDER_COMMAND = 'vscode.openFolder'
/** The command that updates the published LLM Wiki; the Wiki row's Update action and the notices' Update button run it. */
export const UPDATE_DEEP_WIKI_COMMAND = 'codebook.updateDeepWiki'
/** The command that opens the published Wiki in the browser; the Wiki row of the LLM Wiki view runs it on click. */
export const OPEN_DEEP_WIKI_COMMAND = 'codebook.openDeepWiki'
/** The window id the LLM Wiki view passes when it reads a run marker: one no window has, so this window's own reservation is seen as a stopped watch's too. */
export const LLM_WIKI_VIEW_WINDOW_ID = '\u0000llm-wiki-view'
/** The message above the LLM Wiki tree while a VS Code watch is shown: Stop watching ends Codebook's watch only. */
export const LLM_WIKI_WATCHING_MESSAGE =
  'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.'
/** The LLM Wiki view's wrapping message (VS Code) while only a stopped watch's reservation stands: Codebook no longer watches, the chat may still publish. */
export const LLM_WIKI_RESERVATION_MESSAGE =
  'Codebook stopped watching the chat, which may still publish this Wiki. To stop it, stop the request in the chat.'
/** The command of the LLM Wiki view's title bar Refresh action. */
export const REFRESH_LLM_WIKI_COMMAND = 'codebook.refreshLlmWiki'
/** The command that a click on the view's attention or last-attempt row runs: it shows the row's full sentence, with Copy details. */
export const SHOW_LLM_WIKI_ATTENTION_COMMAND = 'codebook.showLlmWikiAttention'
/** The command that copies the chat request of the publisher's recovery ({@link WIKI_UPDATE_RECOVERY_REQUEST}). */
export const COPY_WIKI_RECOVERY_REQUEST_COMMAND =
  'codebook.copyWikiRecoveryRequest'
/** The command that reveals the Wiki folder in the system's file manager. */
export const REVEAL_WIKI_FOLDER_COMMAND = 'codebook.revealWikiFolder'
/** The button of the attention notice that copies its sentence. */
export const COPY_DETAILS_ACTION = 'Copy details'
/** The editor's command that manages workspace trust. Native trial N56 (2026-10-27): VS Code 1.142.0 and Cursor 3.27.12 both open their Workspace Trust editor with it; Cursor's Keyboard Shortcuts editor lists `workbench.trust.manage` and registers no `workbench.action.manageTrust`. */
export const MANAGE_WORKSPACE_TRUST_COMMAND = 'workbench.trust.manage'
/** What one inline action of an LLM Wiki view row is: the command it runs and the words of its title. The row function names an action by its key, the manifest contributes each command with a menu entry that tests `viewItem` for the key. */
export const LLM_WIKI_ROW_ACTIONS = {
  update: { command: UPDATE_DEEP_WIKI_COMMAND, title: 'Update LLM Wiki' },
  'stop-watching': {
    command: 'codebook.llmWiki.stopWatching',
    title: 'Stop Watching',
  },
  'cancel-run': { command: 'codebook.llmWiki.cancelRun', title: 'Cancel' },
  'open-chat': { command: 'codebook.llmWiki.openChat', title: 'Open Chat' },
  'show-output': { command: SHOW_WIKI_OUTPUT_COMMAND, title: 'Show Output' },
  'try-again': { command: GENERATE_DEEP_WIKI_COMMAND, title: 'Try Again' },
  'change-location': {
    command: 'codebook.llmWiki.changeLocation',
    title: 'Change Location',
  },
  'copy-recovery': {
    command: COPY_WIKI_RECOVERY_REQUEST_COMMAND,
    title: 'Copy Recovery Request',
  },
  'reveal-folder': {
    command: REVEAL_WIKI_FOLDER_COMMAND,
    title: 'Reveal Wiki Folder',
  },
  refresh: { command: REFRESH_LLM_WIKI_COMMAND, title: 'Refresh' },
  'open-folder': {
    command: 'codebook.llmWiki.openFolder',
    title: 'Open Folder',
  },
  'manage-trust': {
    command: 'codebook.llmWiki.manageTrust',
    title: 'Manage Workspace Trust',
  },
} as const

/** What the LLM Wiki view says when the editor's command list lacks (or cannot list) its Manage Workspace Trust command ({@link MANAGE_WORKSPACE_TRUST_COMMAND}, run by {@link registerLlmWikiCommands}). */
export const LLM_WIKI_MANAGE_TRUST_FALLBACK_NOTICE =
  'Run "Workspaces: Manage Workspace Trust" from the Command Palette to trust this folder.'

/** What the LLM Wiki view says when the editor has the Manage Workspace Trust command ({@link MANAGE_WORKSPACE_TRUST_COMMAND}) but it failed to open; the cause is in Output › Codebook. */
export const LLM_WIKI_MANAGE_TRUST_FAILED_NOTICE =
  'Manage Workspace Trust could not open. Try "Workspaces: Manage Workspace Trust" from the Command Palette; the cause is in Output › Codebook.'

/** What the LLM Wiki view says once the recovery request is copied. */
export const LLM_WIKI_RECOVERY_REQUEST_COPIED_NOTICE =
  'Copied the recovery request. Paste it into the editor chat.'

/**
 * Sentence for a Wiki folder that does not exist, so Reveal Wiki Folder opens nothing.
 * @param outputLabel - The folder as the learner reads it.
 * @returns `The LLM Wiki folder <label> does not exist (yet). Generate LLM Wiki creates it.` (the first sentence is Issue #135 task 21's; the second names the next step)
 * @example llmWikiFolderMissingNotice('.codebook/wiki') // => 'The LLM Wiki folder .codebook/wiki does not exist (yet). Generate LLM Wiki creates it.'
 */
export const llmWikiFolderMissingNotice = (outputLabel: string): string =>
  `The LLM Wiki folder ${outputLabel} does not exist (yet). Generate LLM Wiki creates it.`

/**
 * Sentence for a Wiki output path where a file stands, so Reveal Wiki Folder opens nothing.
 * @param outputLabel - The path as the learner reads it.
 * @returns `The LLM Wiki folder <label> is a file, not a folder. Remove or rename that file, or change the location.`
 * @example llmWikiFolderIsFileNotice('.codebook/wiki') // => 'The LLM Wiki folder .codebook/wiki is a file, not a folder. Remove or rename that file, or change the location.'
 */
export const llmWikiFolderIsFileNotice = (outputLabel: string): string =>
  `The LLM Wiki folder ${outputLabel} is a file, not a folder. Remove or rename that file, or change the location.`

/**
 * Sentence for a Wiki output path whose entry is a link to nothing, so Reveal Wiki Folder opens nothing and does not promise that Generate LLM Wiki creates it (generation refuses a link).
 * @param outputLabel - The path as the learner reads it.
 * @returns `The LLM Wiki folder <label> is a link whose target is missing. Remove or fix the link, or change the location.`
 * @example llmWikiFolderDanglingLinkNotice('.codebook/wiki') // => 'The LLM Wiki folder .codebook/wiki is a link whose target is missing. Remove or fix the link, or change the location.'
 */
export const llmWikiFolderDanglingLinkNotice = (outputLabel: string): string =>
  `The LLM Wiki folder ${outputLabel} is a link whose target is missing. Remove or fix the link, or change the location.`

/**
 * Sentence for a Wiki output path that cannot be looked at, so Reveal Wiki Folder opens nothing and does not claim the folder is missing.
 * @param outputLabel - The path as the learner reads it.
 * @param code - The system error name of the failed look (`EACCES`, `ENOTDIR`, `ETIMEDOUT`, …).
 * @returns `The LLM Wiki folder <label> cannot be read (<code>). Check the path and its permissions, or change the location.`
 * @example llmWikiFolderUnreadableNotice('.codebook/wiki', 'EACCES') // => 'The LLM Wiki folder .codebook/wiki cannot be read (EACCES). Check the path and its permissions, or change the location.'
 */
export const llmWikiFolderUnreadableNotice = (
  outputLabel: string,
  code: string,
): string =>
  `The LLM Wiki folder ${outputLabel} cannot be read (${code}). Check the path and its permissions, or change the location.`

/**
 * Sentence for a Wiki location that cannot be worked out (the setting is empty or points outside the project), so Reveal Wiki Folder does not fail without a word.
 * @param reason - The message of the failure, as the setting check words it; one closing full stop is dropped.
 * @returns `Reveal Wiki Folder could not find the Wiki folder (<reason>). Change the location.`
 * @example llmWikiFolderLocationFailedNotice('Choose a nonempty local DeepWiki output directory.') // => 'Reveal Wiki Folder could not find the Wiki folder (Choose a nonempty local DeepWiki output directory). Change the location.'
 */
export const llmWikiFolderLocationFailedNotice = (reason: string): string =>
  `Reveal Wiki Folder could not find the Wiki folder (${reason.replace(/\.$/, '')}). Change the location.`

/** How long Reveal Wiki Folder waits for the file system to look at the Wiki output path (ms): a dead network mount never answers, and the learner is told it cannot be read instead of getting no feedback. */
export const WIKI_FOLDER_STAT_TIMEOUT_MS = 3_000

/** The cap on the text two failed reads are compared by, so a message that embeds a long dump keeps the memory of the last failure small. */
export const FAILURE_KEY_MAX_LENGTH = 500

/**
 * Sentence for a Wiki folder in a remote window, where Reveal Wiki Folder opens folders of this computer only.
 * @param remoteName - The editor's `env.remoteName`.
 * @returns `Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on <remote name>. Open it from a terminal in this window, which runs in that remote environment, not on this computer.` (the first sentence is Issue #135 task 21's; the second names the next step)
 * @example llmWikiFolderRemoteNotice('ssh-remote') // => 'Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on ssh-remote. Open it from a terminal in this window, which runs in that remote environment, not on this computer.'
 */
export const llmWikiFolderRemoteNotice = (remoteName: string): string =>
  `Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on ${remoteName}. Open it from a terminal in this window, which runs in that remote environment, not on this computer.`

/** How often the extension looks for a newly published manifest while a Wiki update is watched. */
export const WIKI_UPDATE_WATCH_POLL_MS = 2_000
/** How often the reader page asks for the update state while a run is active. */
export const WIKI_UPDATE_STATUS_POLL_MS = 2_000
/** How many conflict paths an update sentence names before "and N more". */
export const WIKI_UPDATE_SHOWN_PATH_LIMIT = 3
/** How many characters of one repository file name the Wiki update request quotes; a cloned repository chooses its names, so a long one is cut instead of filling the request. */
export const WIKI_UPDATE_PROMPT_PATH_LIMIT_CHARS = 200
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
/** The id of the visually hidden element that names, as written, the file and line the rail's entry of a Wiki page opens. The entry's link refers to it as its description; the target shown beside the link carries no id and is hidden from assistive technology, because Chrome reads its wrap points as spaces. The publisher prints the same id (a page has one entry), and the reader gives it to the description it adds to a site published without one. */
export const WIKI_OPEN_TARGET_ELEMENT_ID = 'codebook-open-target'
/** What the reader's 403 says to a request whose Host is not its own loopback host or a loopback forward of it, which a learner sees in the browser when the editor forwards the reader to another host (a tunnel, a browser-based editor). */
export const WIKI_READER_FOREIGN_HOST_REFUSAL =
  'The Wiki reader answers only on this computer, at its own loopback address or at the loopback address the editor forwards it to. This address is neither, so the reader shows no page.'
/** How many UTF-8 bytes the reader may add to one page beside its rail entries' links (the shown target and its description, each printing the path escaped), counted by `Buffer.byteLength` and not in UTF-16 code units; the bound counts only these targets and not the bytes the filter ({@link withServedAddresses}) adds afterwards when it renames a refused attribute (for example `referrerpolicy` to `data-codebook-unlinked`) or puts in the caller's tag. An entry past it keeps its link alone, as an entry whose address names no target does. A path of quotes written raw in a single-quoted address prints as six characters in each of the two copies, so a page of 2 MB made of such entries was served at 24.7 MB, about 12 times its file, where the reader's limits count about twice ({@link WIKI_PAGE_FILE_LIMIT_BYTES}); with this bound the targets make a page at most one page file limit larger than its file. An ordinary page has one entry that adds a few hundred bytes. */
export const WIKI_OPEN_TARGET_ADDED_BYTES_LIMIT = 2_097_152
/** How long after the window's `load` event the reader page writes the sentence into the line that says the overview stands in for a missing page. The line is in the page, empty, before that, so its text is a change of a status region that already exists; a screen reader speaks the page itself while it loads. */
export const WIKI_MISSING_PAGE_TEXT_DELAY_MS = 150
/** How many characters of the page path named in the address the missing-page line shows at most; anyone can write the address, so a longer value gets the sentence without the path instead of filling the reading column. */
export const WIKI_MISSING_PAGE_PATH_LIMIT_CHARS = 200
export const WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES = 65_536
export const WIKI_CURSOR_PROMPT_LIMIT_BYTES = 131_072
export const WIKI_HTTP_BODY_LIMIT_BYTES = 8_192
/** How long the Wiki reader lets a worker thread prepare one page (bind its addresses and read its tags) before it stops the worker and answers the learner that the page is not shown. An ordinary page of more than 1 MB took 0.17 to 0.22 s through a new worker on the development host (16 CPUs, Node 24), the worker's start included, and 0.48 to 0.54 s under coverage; a two-core runner takes several times as long. A page built to make the HTML parser slow takes from 13 s to minutes. Ten seconds leave an ordinary page a margin of about eighteen times under coverage, and a crafted page stops its worker by then while the editor's own thread runs on. */
export const WIKI_PAGE_SERVE_DEADLINE_MS = 10_000
/** How much old-generation heap a Wiki page worker may use, in megabytes; a worker that needs more ends with `ERR_WORKER_OUT_OF_MEMORY`, and the reader answers its page with the refusal page of a page that needs more memory (`memory-limit`), whose sentence advises no reload, which would only run another worker to the same end, and asks the editor chat to split the page, which an update alone renders the same again. The worker runs in the editor's extension host process, where a page of 20 MB took 1.6 GB and one of 60 MB 4.1 GB before the deadline without a limit, and {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} workers may run at once; Electron's V8 may also keep every isolate of the process in one pointer-compression area. Why not less than 512 MB: on a Node build without pointer compression (the system Node, or a remote's Node, where the extension runs in a WSL or SSH window), a worker that reached a limit of 256 MB with a page of 2 MiB of nested formatting elements (`<b>`, `<i>`, `<u>`, `<s>`) aborted the whole process (`FATAL ERROR: Reached heap limit`) in about half the runs, which ends every extension of the window, instead of ending its thread; at 512 MB the nested `<b>` page ended as `memory-limit` in every run, and 29 crafted shapes of 2 MiB ended cleanly (refused, served or stopped at the deadline). A build with pointer compression (Electron's) did not abort under either limit. Under 512 MB (Node 24.21.0 without pointer compression, the development host; peak of the process's resident memory) the ordinary page of 1.14 MB was served at 0.22 GB, pages of 2 MiB of sections or dense links at 0.38 GB and an attribute-heavy page or a page of table cells of 2 MiB at 0.61 to 0.63 GB, and the nested `<b>` page was refused at 0.69 GB; the page file limit ({@link WIKI_PAGE_FILE_LIMIT_BYTES}) keeps a page within that size, so two workers at once stay under about 1.4 GB. The editor hosts themselves (VS Code, Cursor) are not measured here. */
export const WIKI_PAGE_WORKER_HEAP_LIMIT_MB = 512
/** The largest page file the Wiki reader reads and prepares, in bytes (2 MiB); a larger one is answered with the refusal page before any byte of it is read, as its size is looked at first, and its read stops one byte past the limit. A generated page has a few hundred kilobytes at most; the ordinary page of the timing tests has 1.14 MB. Under {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB} a page of 2 MiB of sections or dense links is served (at 0.38 GB peak of the process, Node 24), and a page of this size built to take more is refused by the heap limit or stopped at the deadline, at 0.69 GB at most in the shapes measured; under the same heap limit the former file limit of 8 MB let a page take 0.5 to 0.75 GB of the editor's process. Without this limit a file of any size was read whole into the editor's process and copied twice (a string and the worker's copy) before the worker refused it. The bundled skill's renderer (`render-wiki.mjs`) refuses a rendered page larger than this before it writes any page, with a sentence that tells the agent to split the page, and counts the page as it can stand on disk, one byte more for each line end that a checkout with CRLF line ends (Git's `core.autocrlf` on Windows) writes as two, so a page this build publishes is never refused for its size, also in such a checkout of a committed Wiki; the publisher of 0.2.30.0 and earlier wrote a page of any size (the reader of 0.2.30.0 read up to 8 MB of it, and earlier readers read a page whole, whatever its size), so the refusal's sentence names an earlier Codebook beside a hand edit; a test holds its number equal to this one, since a skill script imports nothing of the extension. */
export const WIKI_PAGE_FILE_LIMIT_BYTES = 2_097_152
/** How many Wiki page workers prepare pages at once; a page asked for while all of them are busy waits for the first one free. A page built to make the parser slow keeps its worker's core busy until the deadline, so pages opened at once (tabs restored, or a page that names others) take two cores at most, whatever the machine. */
export const WIKI_PAGE_WORKER_CONCURRENCY_LIMIT = 2
/** How many Wiki pages may wait for a page worker at once, besides the {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} prepared; a page asked for while that many wait is refused at once with the refusal page that says to reload it in a moment, and the Wiki reader refuses it before it reads its file ({@link takeWikiPagePlace}). Each waiting page keeps its page (up to {@link WIKI_PAGE_FILE_LIMIT_BYTES}, and a string of up to twice that) in the editor's extension host, and without a bound a probe kept 100 pages waiting beside two workers. The bound also bounds the wait: each worker answers its page by {@link WIKI_PAGE_SERVE_DEADLINE_MS}, so the last of four pages waiting for two workers gets one within two deadlines (20 s), and a page that has waited {@link WIKI_PAGE_WAIT_LIMIT_MS} without a worker is answered as busy. A worker stopped after its page keeps its place until its thread has ended or is counted as lost ({@link WIKI_PAGE_WORKER_STOP_LIMIT_MS}), and meanwhile the line takes one more page for it, so the pages prepared and waiting stay within the pages the reader holds at once, and a page the reader admitted is not refused while a worker ends. Four is twice the workers: tabs restored at once, or a page and the pages it names, still get their pages. */
export const WIKI_PAGE_WAITING_LIMIT = 4
/** How long a Wiki page may wait for a page worker, in milliseconds; a page that has waited this long without a worker leaves the line of waiting pages and is answered with the refusal page that says to reload it in a moment, so the reader gives its place back ({@link takeWikiPagePlace}). Its deadline ({@link WIKI_PAGE_SERVE_DEADLINE_MS}) still counts from when a worker takes it. A page waits so long only where stopped threads do not end (a Node defect): while as many threads are lost as {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT}, a further stopped worker keeps its place until a thread has ended ({@link WIKI_PAGE_WORKER_STOP_LIMIT_MS}), and the pages behind it waited for good. Otherwise the last of {@link WIKI_PAGE_WAITING_LIMIT} pages waiting for two workers gets one within two deadlines (20 s) when the stopped threads end at once, as they did in about 2 ms on the development host; 30 seconds leave that wait a third more and the learner an answer instead of a page that never loads (the owner's choice, Cycle 0047 D7). */
export const WIKI_PAGE_WAIT_LIMIT_MS = 30_000
/** How long a stopped Wiki page worker keeps its place among the busy ones while its thread ends, in milliseconds. A stop of a busy thread took about 2 ms on the development host, and `terminate` settles once the thread has ended; a thread that has not ended by then is counted as lost and gives its place back, so the pages waiting behind it get a worker instead of waiting for good, as they did behind a thread that never emitted its exit (only a Node defect does so). A lost thread may still hold its heap (up to {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}); so while as many threads are lost as {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT}, a further stop past this time keeps its place until its thread has ended or a lost thread has ended, and the threads alive at once are never more than twice that limit. A lost thread that ends later is counted as lost no more, and the oldest stop that kept its place past this time is counted as lost in its stead and gives its place back. */
export const WIKI_PAGE_WORKER_STOP_LIMIT_MS = 5_000
/** How long a Wiki page worker that answered its page waits for the next one before it is stopped, in milliseconds; every page it serves starts the wait again. A waiting worker prepares the next page without loading the reader's code again (on the development host an 18 KB page took 34 to 46 ms through a new worker and 4 to 6 ms through a waiting one, a page of 1.14 MB 150 to 210 ms and 133 to 148 ms). It keeps its thread and the heap its pages grew it to, not only its last page's, which is why only a worker within {@link WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES} waits; a worker nobody uses gives both back when the wait ends. */
export const WIKI_PAGE_WORKER_IDLE_MS = 60_000
/** The largest heap (V8's `total_heap_size`, the heap the thread holds) with which a Wiki page worker that answered its page waits for the next one, in bytes; a worker that holds more after its page is stopped, and the next page gets a new worker. A waiting worker keeps the heap its pages grew it to: on the development host (Node 24) one page of 18 KB left 18 to 20 MB, of 256 KB about 51 MB, of 1.14 MB 150 to 190 MB, of 2 MB 150 to 240 MB, and six pages of 256 KB in a row 142 MB, so without this bound a worker that keeps getting pages held the heap of its largest page for good (about 0.64 GB after an 8 MB page). 64 MiB keeps the reuse for the small pages it pays off for (an 18 KB page took 6 ms through a waiting worker against about 50 ms through a new one), and a few such pages in a row. */
export const WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES = 67_108_864
/** How long an answer of the Wiki reader may make no progress, in milliseconds: a page, a refusal page, a file of the Wiki, its own script or a JSON answer whose connection takes none of it for this long is ended, and its connection closed. The time counts from when the reader starts to send the answer, and again from each part of it ({@link WIKI_RESPONSE_PART_BYTES}) the connection takes, so a browser that keeps reading, however slowly, receives the whole answer. A page keeps its place among the pages in hand ({@link takeWikiPagePlace}) until its answer is received or ended. Why: a client that stopped reading kept a prepared page's bytes in the extension host, past the pages the reader holds at once, for as long as its connection lived (Codex measured twelve such answers keeping about 24 MiB); a limit on the whole send instead cut every answer larger than a slow link carries within it, such as an image over a remote window's forwarded port. A file of the Wiki is open only while one part of it is read, not while its answer waits for the browser, so neither a slow nor a stalled browser keeps a file open, which on Windows refuses the publisher's swap of the folder (the swap gives up after about 2.25 s). Over loopback a client on the development host received 64 MiB in 94 to 151 ms (Node 24 `fetch`), so a browser that reads takes far less than 30 seconds for any part. */
export const WIKI_RESPONSE_SEND_LIMIT_MS = 30_000
/** How many bytes of an answer the Wiki reader hands its connection at a time, in bytes: a body larger than this (a page, a file of the Wiki) is sent in parts of this size, each once the connection has taken the one before, and each part taken counts as progress for the send limit ({@link WIKI_RESPONSE_SEND_LIMIT_MS}). A file of the Wiki is opened for each part and closed before the part is sent, so its answer holds one part in the extension host and no open file while it waits. 64 KiB is the part a file's read stream reads at a time: over a link of 70 KB/s, as a remote window's forwarded port may be, a part is taken in about a second, far within the send limit, and a file of 16 MiB costs 256 opens. */
export const WIKI_RESPONSE_PART_BYTES = 65_536
/** The values of a request's `Sec-Fetch-Dest` header for which the Wiki reader prepares and serves a page: the browser opens it as a document, or in a frame (an editor's browser preview). Its pages make no other request for a page: their policy refuses frames and objects, no script of theirs runs, and the reader's own script fetches only its routes. A page asked for as anything else (an image, media, a style sheet, a font, a track, a script, a fetch) would start a page worker for nothing, many at a time from one page; a request without the header (a client that is no browser) is served. */
export const WIKI_PAGE_NAVIGATION_DESTINATIONS: readonly string[] = [
  'document',
  'iframe',
]
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
/** The profile of a run of the repository's own Node HTTP server: one declared request, stopped in its handler source. */
export const NODE_SERVER_PROFILE = 'node-server'
/** The one action a node-server run offers: send its declared request. */
export const NODE_SERVER_ACTION = 'http-request'
/** The prefix of the debug session name of a node-server run (`codebook node server <runId>`): the run recognizes only sessions whose root carries its own name. */
export const NODE_SERVER_SESSION_NAME_PREFIX = 'codebook node server '
/** How long a started server has, in running time, to accept connections on its declared port; time it spends held by a learner's pause does not count. */
export const NODE_SERVER_READY_TIMEOUT_MS = 30_000
/** How long the declared request may wait for its answer, in running time; time the server spends paused does not count. */
export const NODE_SERVER_REQUEST_TIMEOUT_MS = 30_000
/** The wall-time backstop of the declared request: it ends as timed out after this long whatever the pauses were. */
export const NODE_SERVER_REQUEST_WALL_LIMIT_MS = 900_000
/** The one monotonic deadline of a node-server stop, from its admission: debugger release, group exit, listener checks and output settling share it. */
export const NODE_SERVER_STOP_DEADLINE_MS = 10_000
/** How many hits of the declared stops one request captures; the next hit retires the owned breakpoints and continues uncaptured. */
export const NODE_SERVER_REQUEST_CAPTURE_LIMIT = 16
/** How long a reset connection waits for the server's exit before it is read as a request failure instead of the server having exited. */
export const NODE_SERVER_EXIT_SETTLE_MS = 500
/** What Node prints when its program is finished but an attached debugger keeps it from exiting; the run lets go of its debugger on it, so the exit follows. */
export const NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE =
  'Waiting for the debugger to disconnect'
/** From which failed stop the message names the server's pid for the learner to end. */
export const NODE_SERVER_FAILED_STOPS_NAMING_PID = 2
/** How many characters of the run id a state-changing request's confirmation modal shows, enough to tell two modals left on screen apart. */
export const NODE_SERVER_MODAL_RUN_ID_CHARS = 8
/** The lowest port a node-server declaration may name: a lower one needs privileges a development server does not run with, and Codebook never raises them. */
export const NODE_SERVER_PORT_MIN = 1_024
/** The highest TCP port. */
export const TCP_PORT_MAX = 65_535
/** The highest TCP port a node-server declaration may name. */
export const NODE_SERVER_PORT_MAX = TCP_PORT_MAX
/** The longest request path, its query string included, a node-server declaration may send. */
export const NODE_SERVER_REQUEST_PATH_LIMIT_CHARS = 2_048
/** The largest request body, in UTF-8 bytes, a node-server declaration may send. */
export const NODE_SERVER_REQUEST_BODY_LIMIT_BYTES = 16_384
/** The most server output delivered but not yet settled; a server printing faster than its events settle fails its capture instead of buffering without bound. */
export const NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES = 1_048_576
/** How long a stopping server's debugger may take to detach before SIGTERM is sent anyway: a server handling SIGTERM waits for an attached debugger before it exits (Part A, Issue #139). */
export const NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS = 1_000
/** How long an orphaned server group an earlier window left running has after SIGTERM before SIGKILL (the activation sweep). */
export const NODE_SERVER_SHUTDOWN_GRACE_MS = 5_000
/** How long one readiness probe waits for a loopback connection to be accepted before it counts as refused. */
export const NODE_SERVER_READY_CONNECT_TIMEOUT_MS = 250
/** The pause between two readiness rounds, so a server still starting is not hammered. */
export const NODE_SERVER_READY_POLL_INTERVAL_MS = 50
/** How often the orphan reaper checks whether a signalled server group has exited. */
export const NODE_SERVER_GROUP_EXIT_POLL_MS = 50
/** By when, counted from a stop's admission, a node-server stop has sent SIGKILL: its debugger detach and its SIGTERM grace share this time, so the kill never lands later whatever the detach took. */
export const NODE_SERVER_KILL_BY_MS = 5_000
/** How long before the kill bound ({@link NODE_SERVER_KILL_BY_MS}) a retried stop starts its second identity check of the group, so the SIGKILL that may follow goes only to a group confirmed then and still lands by the bound; the check (a `ps` read) takes tens of milliseconds, and one that has not answered by the bound sends nothing. */
export const NODE_SERVER_KILL_CHECK_LEAD_MS = 1_000
/** The most of a response a node-server run reads; the socket is destroyed there and the response reads `(cut at 1 MiB)`. */
export const NODE_SERVER_RESPONSE_READ_LIMIT_BYTES = 1_048_576
/** How many leading bytes of a text response are shown to the chat and in Output. */
export const NODE_SERVER_RESPONSE_SHOWN_BYTES = 8_192
/** The workspace-storage key under which the node-server runs' process groups are recorded until they are closed, so a later activation can close an orphan. */
export const NODE_SERVER_ORPHANS_STORAGE_KEY = 'codebook.nodeServerOrphans'
/** How long one `ps` or `lsof` query about a process (group, command, folder) may run before it is ended. */
export const NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS = 3_000
/** The most a `ps` or `lsof` query about one process may print. */
export const NODE_SERVER_PROCESS_QUERY_MAX_BYTES = 65_536
/** How much of an owned process's output is kept: its first bytes for the inspector announcement, its last ones as the redacted tail. */
export const PROCESS_OUTPUT_LIMIT_BYTES = 32_768
/** The longest text of one stamped output event of an owned process. */
export const PROCESS_OUTPUT_EVENT_LIMIT_CHARS = 4_096
/** The command id of the status item's Save learning replay and its Retry; registered by the extension, run by a click. */
export const SAVE_LEARNING_REPLAY_COMMAND = 'codebook.saveLearningReplay'
/** The command id of the status item's Open replay and Open retained history. */
export const OPEN_LEARNING_REPLAY_COMMAND = 'codebook.openLearningReplay'
export const NODE_TEST_HISTORY_VERSION = 1
export const NODE_TEST_READER_POSITION_VERSION = 1
export const NODE_TEST_READER_POSITION_LIMIT_BYTES = 4_096
export const NODE_TEST_LEARNING_DECISION_VERSION = 1
export const NODE_TEST_LEARNING_DECISION_LIMIT_BYTES = 4_096
export const NODE_TEST_LEARNING_MATERIAL_VERSION = 1
export const NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES =
  LEARNING_SUMMARY_LIMITS.bytes
/** The folder name package managers install dependencies in; node-test's readiness search never enters one ({@link searchRepositoryVitest}). */
export const NODE_MODULES_DIRECTORY_NAME = 'node_modules'
/** A Vitest installation's package folder, relative to the directory whose `node_modules` holds it ({@link requireOwnedVitest}, {@link searchRepositoryVitest}). */
export const VITEST_PACKAGE_DIRECTORY = 'node_modules/vitest'
/** A Vitest installation's package file, read for its version, relative to the directory whose `node_modules` holds it ({@link readVitestPrerequisite}). */
export const VITEST_PACKAGE_PATH = 'node_modules/vitest/package.json'
/** A Vitest installation's program a node-test run starts, relative to the directory whose `node_modules` holds it ({@link readVitestPrerequisite}). */
export const VITEST_PROGRAM_PATH = 'node_modules/vitest/vitest.mjs'
/** The file names Vitest looks up as its config, in Vitest's own order (`vitest.config.*` before `vite.config.*`); the nearest directory above a cited test that holds one is the test's Vitest root ({@link resolveNodeTestVitestRoot}). */
export const VITEST_CONFIG_FILE_NAMES: readonly string[] = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
]
/** How many folders `codebook_status` looks at for a usable Vitest (the repository root first, then breadth first) before it stops and says it did not look further ({@link searchRepositoryVitest}). */
export const NODE_TEST_READINESS_DIRECTORY_LIMIT = 256
/** How many folder entries `codebook_status` reads at most while it lists the folders of the next level for a Vitest; a search that reaches it says it did not look further, so a folder holding many entries cannot make a status call slow ({@link searchRepositoryVitest}). */
export const NODE_TEST_READINESS_ENTRY_LIMIT = 20_000
/** How long one `codebook_status` readiness search may look before it stops and says it did not look further; checked between folders and entries, so a slow file system cannot hold the status call ({@link searchRepositoryVitest}). */
export const NODE_TEST_READINESS_TIMEOUT_MS = 2_000
/** The largest root config whose bytes a root claim's basis hashes; a larger one is identified by its size, modification time and file id instead, so a huge or sparse file named like a config cannot hold a start ({@link readRootClaimBasis}). */
export const NODE_TEST_ROOT_CONFIG_HASH_LIMIT_BYTES = 1_048_576
/** How many listed test files node-test resolves to their real paths at once, so a listing of thousands of files is compared with the cited test quickly ({@link partitionListedTestFiles}). */
export const NODE_TEST_LISTED_FILE_REALPATH_CONCURRENCY = 64
/** How many levels below the repository root `codebook_status` looks for a Vitest: a package such as `packages/query-core` lies two levels below it ({@link searchRepositoryVitest}). */
export const NODE_TEST_READINESS_DEPTH = 2
export const NODE_TEST_HISTORY_DIRECTORY = 'node-tests.v1'
export const NODE_TEST_HISTORY_LIMIT_BYTES = 8_388_608
/** The file of a test history's folder that names the editor process writing it, removed when the writer seals or is abandoned ({@link writeNodeTestWriterRecord}, {@link judgeNodeTestWriter}). */
export const NODE_TEST_HISTORY_WRITER_FILE = 'writer.json'
/** How long a window keeps the verdict "its writer is live" for a test history another window records, in milliseconds: judging the writer reads its process start, which starts a process (`ps`, PowerShell), and the Study workspace refreshes every 250 ms. A crashed writer is therefore told within this time, without a process query at every refresh; a "gone" verdict is final for that record ({@link NodeTestHistoryStore}). */
export const NODE_TEST_WRITER_RECHECK_MS = 5_000
/** The largest writer record of a test history Codebook writes or reads. */
export const NODE_TEST_HISTORY_WRITER_LIMIT_BYTES = 4_096
/** The largest seal file of a test history Codebook writes or reads ({@link NodeTestHistoryWriter.finish}, {@link isSealedEmptyHistory}). */
export const NODE_TEST_HISTORY_SEAL_LIMIT_BYTES = 16_384
export const NODE_TEST_HISTORY_MAX_ENTRIES = 10_000
/** The folder of node-server histories beside `node-tests.v1`, so test histories need no migration and a revert leaves them untouched. */
export const NODE_SERVER_HISTORY_DIRECTORY = 'node-servers.v1'
/** The `formatVersion` of a node-server history header; a later cycle relates several histories of one explanation without a format break. */
export const NODE_SERVER_HISTORY_FORMAT_VERSION = 1
/** The most entries one node-server history holds, `source` and `end` included. */
export const NODE_SERVER_HISTORY_MAX_ENTRIES = 10_000
/** The largest journal of a node-server history. */
export const NODE_SERVER_HISTORY_LIMIT_BYTES = 8_388_608
/** The largest seal of a node-server history; it holds every partial reason uncut. */
export const NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES = 262_144
/** The most `stop` entries one node-server history holds: the run's capture limit. */
export const NODE_SERVER_HISTORY_MAX_STOPS = NODE_SERVER_REQUEST_CAPTURE_LIMIT
/** Output entries one node-server history keeps before one `output-truncated` entry replaces the rest. */
export const NODE_SERVER_OUTPUT_BUDGET_ENTRIES = 2_000
/** Output bytes one node-server history keeps before one `output-truncated` entry replaces the rest. */
export const NODE_SERVER_OUTPUT_BUDGET_BYTES = 2_097_152
/** Journal bytes kept free of output for the request, sources, stops, terminal entry and `end`. */
export const NODE_SERVER_STRUCTURAL_HEADROOM_BYTES = 1_048_576
/** Journal entries kept free of output for the request, sources, stops, terminal entry and `end`. */
export const NODE_SERVER_STRUCTURAL_HEADROOM_ENTRIES = 100
/** Entries a node-server writer holds pending before it drops output; structural entries wait instead. */
export const NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES = 1_000
/** Bytes a node-server writer holds pending before it drops output; structural entries wait instead. */
export const NODE_SERVER_WRITER_QUEUE_LIMIT_BYTES = 4_194_304
/** The largest source text a `source` entry stores; a larger file is stored as its hash with `sourceUnavailable: 'too large'`. */
export const NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES = 524_288
/** The longest text of one `output` entry of a node-server history. */
export const NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS = 4_096
/** The longest code (a withdrawal's, a failure's) a node-server history entry stores. */
export const NODE_SERVER_HISTORY_CODE_LIMIT_CHARS = 128
/** The longest frame name a `stop` entry stores. */
export const NODE_SERVER_HISTORY_FRAME_NAME_LIMIT_CHARS = 2_048
/** The longest inspection path an `unavailable` item of a `stop` entry stores. */
export const NODE_SERVER_HISTORY_UNAVAILABLE_PATH_LIMIT_CHARS = 512
/** The longest content type a `response` entry stores. */
export const NODE_SERVER_HISTORY_CONTENT_TYPE_LIMIT_CHARS = 256
/** The longest request path or response location a node-server history entry stores. */
export const NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS = 2_048
/** The longest message a `request-failed` entry stores. */
export const NODE_SERVER_HISTORY_MESSAGE_LIMIT_CHARS = 2_048
/** The longest response body one `response` entry stores (the shown body: `shapeResponseBody` cuts at 8,192 bytes). */
export const NODE_SERVER_RESPONSE_BODY_LIMIT_CHARS = 16_384
/** The most JSON bytes (quotes included) of an inspection path a seal reason keeps: a 512-character ASCII path fits whole (its text and its params each hold the path): 160 reasons at most, so the worst-case seal stays inside {@link NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES}. */
export const NODE_SERVER_SEAL_PATH_LIMIT_BYTES = 520
/** How many entries a missing-evidence list names in an answer; the rest is a count. */
export const NODE_SERVER_MISSING_LIST_LIMIT = 20
/** How long a node-server run waits for its history to start before it launches without one: slow storage never delays the server (D8). */
export const NODE_SERVER_HISTORY_START_BOUND_MS = 2_000
/** Output chunks of one channel that arrive within this many milliseconds of each other become one `output` entry (up to {@link NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS}). */
export const NODE_SERVER_OUTPUT_COALESCE_MS = 50
/** How long a node-server output channel may stay silent while its last characters wait as a possible private root before they are released (hidden when they already show part of a private name), so the last line of a quiet server reaches the journal; chunks closer together than this are still joined. */
export const NODE_SERVER_OUTPUT_ROOT_HOLD_MS = 1_000
/** How long a seal of a node-server history may take before it is abandoned and the folder lists as interrupted: the server's own stop deadline. */
export const NODE_SERVER_HISTORY_SEAL_BOUND_MS = NODE_SERVER_STOP_DEADLINE_MS
/** File system error codes that a retry can clear (a descriptor or lock shortage, a busy or antivirus-held file, a disk error): a read that fails with one is not remembered as the history's state ({@link isTransientFileError}). */
export const TRANSIENT_FILE_ERROR_CODES: readonly string[] = [
  'EMFILE',
  'ENFILE',
  'EBUSY',
  'EAGAIN',
  'EPERM',
  'EIO',
]
/** How many test histories {@link NodeTestHistoryStore.list} reads at a time when a refresh finds new, still recording or changed ones; a sealed journal it already summarized is not read again. */
export const NODE_HISTORY_SUMMARY_READ_CONCURRENCY = 4
/** How much of a test replay's recorded output, counted in code points of the shown text (the `[stderr] ` marks and line feeds included), the Application pane keeps up to the selected event: its end, where the selected moment is. */
export const NODE_TEST_OUTPUT_TAIL_CHARS = 65_536
/** How many code points after its introducer a terminal control string (CSI, OSC, DCS, SOS, PM, APC) may run to its terminator in recorded test output; an introducer with no terminator within them is a stray, and only its own code points are removed (F109, F148). */
export const TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS = 4_096
/** How close to its end, in CSS pixels, a test replay's output region counts as at its end, so the Application pane follows the latest output (DS20); subpixel scroll positions never land exactly on it. */
export const TEST_OUTPUT_END_TOLERANCE_PX = 2
/** At most how often a test replay's Application document reports the learner's scroll anchor to the host: scrolling produces events faster than the host needs them, so the reports in between are joined into one (the joined anchor is also reported when the document is left). */
export const TEST_OUTPUT_STATE_REPORT_INTERVAL_MS = 500
/** Longest debugger type name a saved Node fact keeps; the type is supplementary, so a longer one is omitted rather than failing the run. */
export const NODE_TEST_FACT_TYPE_LIMIT_CHARS = 256
/**
 * Names of the variables in which Vitest's module runner holds a whole imported module: a test file that calls `vi.mock` binds `__vi_import_<n>__`, any other module `__vite_ssr_import_<n>__` (Vite 8, Vitest 5). An imported name such as `revalidatePath` has no variable of its own; its value is an export of one of these (Cycle 0052 task 5).
 */
export const NODE_TEST_MODULE_BINDING_NAME = /^__vi(?:te_ssr)?_import_\d+__$/
/** The debugger's name for the object a JavaScript Proxy wraps; a module that `vi.mock` replaces is a Proxy whose exports sit under it. */
export const DEBUGGER_PROXY_TARGET_NAME = '[[Target]]'
/** Oldest Vitest major whose file listing, exclusion, name matching and JSON report were verified for exact node-test selection (4.1.11 and 5.0.2). */
export const NODE_TEST_MINIMUM_VITEST_MAJOR = 4
/** Deepest cited title path: enclosing `describe` titles plus the test title. */
export const NODE_TEST_TITLE_PATH_LIMIT = 16
/** Other test files Vitest's substring file filter may add before Codebook refuses instead of excluding each one. */
export const NODE_TEST_EXCLUDED_FILE_LIMIT = 64
/** Bound for one `vitest list --filesOnly` preflight; all the listings of one launch share {@link NODE_TEST_LISTING_PHASE_TIMEOUT_MS}, and the attach budget ({@link NODE_TEST_ATTACH_TIMEOUT_MS}) starts after them. */
export const VITEST_FILE_LIST_TIMEOUT_MS = 30_000
/** Grace period for releasing the owned Vitest listing group before escalating to SIGKILL. */
export const VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS = 1_000
/** Bound for all the Vitest listings of one owned Node test launch together (the root claim asked again, the package listing and its confirmation): room for those three at their own deadline ({@link VITEST_FILE_LIST_TIMEOUT_MS}) and their releases, each a close and a group wait after SIGTERM and again after SIGKILL ({@link VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS} each). The attach budget starts after them. */
export const NODE_TEST_LISTING_PHASE_TIMEOUT_MS =
  3 * (VITEST_FILE_LIST_TIMEOUT_MS + 4 * VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS) +
  5_000
/** Error text kept from a failed Vitest preflight. */
export const VITEST_LIST_ERROR_LIMIT_CHARS = 2_048
/** Largest Vitest JSON report read to confirm which test ran. */
export const VITEST_REPORT_LIMIT_BYTES = 8_388_608
/** Largest `node_modules/vitest/package.json` read for its version; Vitest's own file is a few kilobytes, and a larger one is reported as an unreadable version. */
export const VITEST_PACKAGE_JSON_LIMIT_BYTES = 65_536
/** The version a Vitest package must name before it is printed to the agent: a short semantic version (each number at most nine digits, a suffix at most 64 characters), so a package's `version` field cannot carry other text or kilobytes of digits into `codebook_status` ({@link readVitestPrerequisite}). */
export const PRINTABLE_VITEST_VERSION =
  /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:[-+][0-9A-Za-z.-]{1,64})?$/
/** Wait for the owned test process to report its exit after its debugger session ended early. */
export const NODE_TEST_EXIT_GRACE_MS = 2_000
/** Budget for each owned Node test phase: attach through the entry pause, reaching a declared stop while the test runs, and capturing it. */
export const NODE_TEST_ATTACH_TIMEOUT_MS = 45_000
export const REPOSITORY_BROWSER_ACTION = 'repository-click'
/** The first extension version that offers the node-server profile, for the profile entry of `codebook_status`. */
export const NODE_SERVER_MINIMUM_EXTENSION_VERSION = '0.2.51'
/** The longest sanitized failure cause a node-server event and its Output entry keep; the run resource keeps the error whole (up to {@link MAX_UI_TEXT_CHARS}). */
export const NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS = 1_024
/** The most UTF-8 bytes of a response's shown body a `node-server.response` event keeps, so one event stays far under {@link EVENT_DETAIL_LIMIT_BYTES}; the run resource keeps the whole shown body. */
export const NODE_SERVER_EVENT_BODY_LIMIT_BYTES = 4_096
/** The longest short text (address, content type, stopped reason, signal, command) a node-server event keeps. */
export const NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS = 256
/** The longest repository path or redirect location a node-server event keeps. */
export const NODE_SERVER_EVENT_PATH_LIMIT_CHARS = 512
/** The methods of a declared request that change the repository's data; each needs the learner's confirmation before it is sent (D6). */
export const NODE_SERVER_STATE_CHANGING_METHODS = [
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]
export const REPOSITORY_CONFIG_VERSION = 1
export const CROSS_RUNTIME_CONFIG_VERSION = 2
export const CONFIGURED_STUDY_VERSION = 3
export const CROSS_RUNTIME_STUDY_VERSION = 4
/** The format of a repository-browser study made with the `vite-dev` adapter; an older Codebook lists it as saved by a newer one. */
export const VITE_STUDY_VERSION = 5
/** The highest study format this Codebook reads; a saved study above it is listed as saved by a newer Codebook. */
export const READABLE_STUDY_VERSION = VITE_STUDY_VERSION
export const CONFIGURED_STUDY_SUFFIX = '.study.v3.json'
export const CONFIGURED_STUDY_METADATA_SUFFIX = '.study.meta.v3.json'
// Highest existing version owns a logical study, including when its bytes are corrupt.
// A change of the saved study format that an older Codebook cannot read takes the next format number and its own `.study.v<n>.json` suffix in this table; an older Codebook then lists such a study as saved by a newer one and keeps it, instead of failing on its schema.
export const STUDY_STORAGE_FORMATS = [
  {
    version: VITE_STUDY_VERSION,
    format: 'v5',
    archiveSuffix: '.study.v5.json',
    metadataSuffix: '.study.meta.v5.json',
  },
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
/** The most unreadable values one node-server `stop` entry lists: one per inspection its declaration allows, so the seal's reasons (each kept uncut) stay inside {@link NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES}. */
export const NODE_SERVER_STOP_UNAVAILABLE_LIMIT = REPOSITORY_INSPECTION_LIMIT
export const REPOSITORY_INSPECTION_TIMEOUT_MS = 1_000
export const REPOSITORY_INSPECTION_PATH_LIMIT_CHARS = 128
export const REPOSITORY_INSPECTION_SEGMENT_LIMIT = 4
export const REPOSITORY_STORAGE_ENTRY_LIMIT = 16
export const REPOSITORY_STORAGE_KEY_LIMIT_CHARS = 128
export const REPOSITORY_STORAGE_VALUE_LIMIT_CHARS = 2_048
export const REPOSITORY_STORAGE_LIMIT_BYTES = 16_384
export const REPOSITORY_SETUP_TIMEOUT_MS = 90_000
export const REPOSITORY_PAUSE_HOLD_TIMEOUT_MS = 300_000
/** The longest private observation hold a native Node test trial accepts (`CODEBOOK_NODE_TEST_HOLD_MS`, `CODEBOOK_NODE_TEST_HOLD_AFTER_MS`), so a recording can show the state the trial reached. */
export const NATIVE_TRIAL_HOLD_LIMIT_MS = 60_000
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
/** Next's own development port, used when the dev script declares no port. */
export const DEVELOPMENT_SERVER_DEFAULT_PORT = 3000
export const DEVELOPMENT_SERVER_MAX_PORT = TCP_PORT_MAX
/** Bounds one loopback connect that asks whether something already listens on the project's port; a connect that times out proves nothing (Windows reports a refused loopback connect only after its SYN retries, 1 to 2 s), so the bind probe decides. */
export const DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS = 500
/** Bounds the wait for a port that Codebook's own earlier run is still releasing (its owned process group is exiting) before the start is refused as that run's. */
export const DEVELOPMENT_PORT_RELEASE_WAIT_MS = 5_000
/** The pause between two checks while {@link DEVELOPMENT_PORT_RELEASE_WAIT_MS} runs. */
export const DEVELOPMENT_PORT_RELEASE_POLL_MS = 100
/** The lockfiles that make a repository a Bun project: Bun loads the project's `.env` files into the environment of the scripts it runs, so a `next dev` without a port flag may start on a `PORT` from them (F499). Only their existence is checked. */
export const DEVELOPMENT_BUN_LOCKFILES: readonly string[] = [
  'bun.lock',
  'bun.lockb',
]
/** Bounds how many folders the Bun lockfile search climbs from the opened folder while it looks for the Git root (a count): the search stops at the first folder that holds `.git`, and without one inside this bound only the opened folder counts (F514). */
export const DEVELOPMENT_BUN_LOCKFILE_SEARCH_MAX_FOLDERS = 16
/** The file whose presence in the opened folder or the Git root makes a project a Yarn Berry project (Yarn 2 and later), searched like the Bun lockfiles (F515). */
export const DEVELOPMENT_YARN_BERRY_CONFIG = '.yarnrc.yml'
/** The first major version of Yarn that runs scripts in the portable shell (Yarn 2, "Berry"); Yarn 1 runs them with `sh` (F523). */
export const DEVELOPMENT_YARN_BERRY_MIN_MAJOR = 2
/** The reason the `applicationPortSource` gives when the `dev` script of a Yarn Berry project has a form that Yarn 2+'s portable shell reads differently from `sh` (`export`, which it lacks; a `;;` or a `;` followed by blanks at the end of the line, which it rejects; D75, F515, F519); the quoted statement follows it. */
export const DEVELOPMENT_YARN_SHELL_UNREAD_REASON =
  "Next's default port, taken because Yarn 2 and later runs scripts in its own portable shell, which reads this form differently from sh, so it can mean different things"
/** The `packageManager` prefix of a `package.json` that makes the project a Bun project without a lockfile (F514). */
export const DEVELOPMENT_BUN_PACKAGE_MANAGER_PREFIX = 'bun@'
/** The reason the `applicationPortSource` gives when the `dev` script is unread on Windows because Bun runs it with Bun Shell by default and with `cmd` when `run.shell` is `system` in `bunfig.toml`, so the same text means different things (D75, F509, F514); the quoted statement follows it. */
export const DEVELOPMENT_BUN_SHELL_UNREAD_REASON =
  "Next's default port, taken because on Windows Bun runs scripts with its own shell, or with cmd when run.shell is set to system in bunfig.toml, so the form can mean different things"
/** The `applicationPortSource` when the `dev` script is empty or only blanks (F511). */
export const DEVELOPMENT_EMPTY_SCRIPT_SOURCE =
  "Next's default port, taken because the dev script in package.json is empty"
/** The reason the `applicationPortSource` gives when the `dev` script is unread because Bun loads `.env` files (F499); the quoted statement follows it. */
export const DEVELOPMENT_BUN_ENV_UNREAD_REASON =
  "Next's default port, taken because Bun loads .env files into the dev script's environment and a PORT there can decide the port when no -p/--port flag is given"
/** The reason the `applicationPortSource` gives when the `dev` script has a form whose meaning differs under `cmd`, the shell npm, pnpm and yarn use on Windows (F502, D74); the quoted statement follows it. */
export const DEVELOPMENT_CMD_UNREAD_REASON =
  "Next's default port, taken because npm runs the dev script with cmd on Windows, where this form (single quotes, a PORT= or NAME= prefix, export, env, ;, a PORT variable written in another case, or a program written as a path with /) does not mean what it means in sh"
/** Bounds how deep the `dev` script reader descends (a count, not a duration): every step into another command line grows the same depth, whether it is a quoted `concurrently` command or another script (`npm run x`, `pnpm x`). The `dev` script is depth 0; no step is taken from depth {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT}, so a delegation cycle stops there and the script is reported as unread. */
export const DEVELOPMENT_SCRIPT_NESTING_LIMIT = 2

/** Bounds how many statements one `readDeclaredDevelopmentPort` call reads across every line and delegation of the `dev` script (a count, not a duration). {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT} bounds depth only, so thousands of delegations that each hold thousands of delegations would otherwise run millions of reads on the extension host (F550); a real script holds a handful of statements. */
export const DEVELOPMENT_SCRIPT_STATEMENT_LIMIT = 256

/** The reason the `applicationPortSource` gives when the `dev` script runs more statements than {@link DEVELOPMENT_SCRIPT_STATEMENT_LIMIT} (F550). */
export const DEVELOPMENT_SCRIPT_TOO_LONG_REASON =
  "Next's default port, taken because the dev script runs more statements than Codebook reads"
/** Bounds the part of an unread `dev` script that `applicationPortSource` quotes (code points, not bytes). */
export const DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS = 120
/** Bounds a `package.json` script name that `applicationPortSource` quotes (code points). */
export const DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS = 40
/** The only characters a `dev` script may hold for the reader to assert a port from it (D72): letters, digits, blanks, `_ . , : / @ % + = -`, quotes, `&` and `;`. Any other character is shell syntax the reader does not model (`|`, `(`, `{`, `$`, a backtick, `<`, `>`, `!`, `#`, a backslash, a line break, a glob), so the script is unread. */
export const DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS = /^[\w \t.,:/@%+='"&;-]*$/
/** The words of the `dev` script grammar that the quoted unread segment may show (D72 rule 2): launchers, delegations, wrappers and their subcommands. */
export const DEVELOPMENT_SCRIPT_SHOWN_WORDS: ReadonlySet<string> = new Set([
  'next',
  'dev',
  'npx',
  'bunx',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'run',
  'run-script',
  'exec',
  'cross-env',
  'env',
  'concurrently',
  'export',
])
/** The flags the quoted unread segment may show by name (D72 rule 2): Next's `dev` options and the options of the delegation commands. */
export const DEVELOPMENT_SCRIPT_SHOWN_FLAGS: ReadonlySet<string> = new Set([
  '-p',
  '--port',
  '-H',
  '--hostname',
  '--turbo',
  '--turbopack',
  '--webpack',
  '--experimental-https',
  '--experimental-https-key',
  '--experimental-https-cert',
  '--experimental-https-ca',
  '--silent',
  '-s',
  '--if-present',
  '--',
])
/** The flags of `next dev` that take no value (D72). */
export const DEVELOPMENT_SCRIPT_VALUELESS_NEXT_FLAGS: ReadonlySet<string> =
  new Set(['--turbo', '--turbopack', '--webpack', '--experimental-https'])
/** The names for which `pnpm <name>` and `yarn <name>` (without `run`) are read as a delegation to the script of that name (D76, F510). Each was run with pnpm 12.14.0 and yarn 1.22.22 in a project with a script of that name and ran the script; a name containing `:` is also read (no builtin has one). Every other name is unread: pnpm and yarn have about 60 builtins and aliases that change between versions, and some run a same-named script only in some versions, so a list of builtins to exclude can never be complete. `<manager> run <name>` names the script of any name. */
export const DEVELOPMENT_SCRIPT_PLAIN_DELEGATION_NAMES: ReadonlySet<string> =
  new Set(['dev', 'start', 'serve', 'web', 'app', 'client', 'frontend'])
/** Variables whose assignment before or beside a `next dev` command can change which program runs, what it loads or which port it takes, so the reader does not read past one (D72): the loader and path variables, `NODE_OPTIONS` (preloads), and the `npm_config_*` settings. */
export const DEVELOPMENT_SCRIPT_UNSAFE_ASSIGNMENT_NAME =
  /^(?:NODE_OPTIONS|NODE_PATH|PATH|ENV|SHELLOPTS|IFS|npm_config_.*|LD_.*|DYLD_.*|BASH_.*)$/i
/** The only variables the owned `next dev` inherits from the extension host. */
export const DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'SHELL',
  'LANG',
  'LC_ALL',
  'PNPM_HOME',
  'USER',
  'LOGNAME',
] as const
/** The loopback names that count as the owned application's origin at its port (D65); the recorded browser opens the first. */
export const OWNED_APPLICATION_LOOPBACK_HOSTS = [
  'localhost',
  '127.0.0.1',
  '[::1]',
] as const
/** Bounds how much of a project's package.json is read to find its declared port. */
export const DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES = 1_048_576

/** The `applicationPortSource` when `package.json` is not a regular file (a FIFO, a device, a socket or a folder), which Codebook never opens (F556). */
export const DEVELOPMENT_PACKAGE_NOT_REGULAR_SOURCE =
  "Next's default port, taken because package.json is not a regular file Codebook reads"

/** The `applicationPortSource` when `package.json` is larger than {@link DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES}, so reading it would cut it (F556). */
export const DEVELOPMENT_PACKAGE_TOO_LARGE_SOURCE =
  "Next's default port, taken because package.json is larger than Codebook reads"
export const REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT = 200
export const REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT = 8
export const REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT_CHARS = 512
/** Bounds a pause's script URL in the journal and in a deadline's place sentence; a URL can be of any length, and the saved study's reason holds at most {@link MAX_UI_TEXT_CHARS}. */
export const REPOSITORY_PAUSE_URL_LIMIT_CHARS = 512
/** Bounds a paused frame's function name in the journal. */
export const REPOSITORY_PAUSE_FUNCTION_NAME_LIMIT_CHARS = 256
/** How many pauses away from the expected stop (and how many idle `continued` events) one run journals; past it only their count is kept, so a hook that pauses in a loop cannot use up the journal. */
export const REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT = 100
/** How many `stop.module-parsed`, `stop.instance-sealed` and `stop.instance-refused` entries one run journals, each type up to it; past it only their count is kept, except the first entry of each type for every stop and script address, which is always journaled (the instance's hashes are the evidence). Next's HMR announces every layer's script again after each save, so a long session must not use up the evidence budget. */
export const REPOSITORY_STOP_MODULE_JOURNAL_LIMIT = 100
/** How many entries past {@link REPOSITORY_STOP_MODULE_JOURNAL_LIMIT} one run journals because they are the first of their type, stop and script address (an absolute second cap, a count): addresses that change per rebuild (a chunk id, a layer, a query) would otherwise add one entry per save without a ceiling (F473). Stops and layers of a run are few, so it is not reached in practice; the rest are only counted. */
export const REPOSITORY_STOP_MODULE_FIRST_JOURNAL_BEYOND_LIMIT = 50
/** The longest the run waits for the text of a script that may be another webpack layer's instance of a declared server stop's module (`Debugger.getScriptSource`); past it the instance is refused with that reason, and a pause held in it fails with a sentence naming it. It is shorter than the wait for a stop's own pause, so the sentence is ready when that wait ends. */
export const REPOSITORY_STOP_INSTANCE_READ_MS = 2_000
/** The longest a pause no debugger stop announced may last for its resume to count as the debug adapter's own; the adapter resumes its pauses within milliseconds, and a pause that outlasts the wait for a stop's own pause is taken as announced, so this bound is that wait's bound ({@link CAPTURE_TIMEOUT_MS}) and follows it. */
export const REPOSITORY_ADAPTER_PAUSE_LIMIT_MS = CAPTURE_TIMEOUT_MS
/** The longest a page pause may last in a run that declares no browser stop before the run ends as "Unowned browser stop remained paused": the debug adapter resumes a pause of its own within milliseconds, and nobody else may pause the page of such a run. A pause in the page's stub of a declared server stop's module has {@link REPOSITORY_ADAPTER_PAUSE_LIMIT_MS} instead, because the adapter first reports that pause as a stop, which the run then resumes itself. */
export const REPOSITORY_UNOWNED_PAGE_PAUSE_LIMIT_MS = 250
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
/** The reason a snapshot gives for a scope it deliberately did not copy: replay keeps only the stopped frame's local values. The capture writes it and the server stop's presentability check reads it, so a capture that follows the policy is never judged unread. */
export const REPLAY_SCOPE_NOT_CAPTURED_TEXT =
  "This scope was not captured; replay keeps only the stopped frame's local values."
export const REPLAY_DEBUG_MAX_VARIABLES = 2_000
export const REPLAY_DEBUG_MAX_DEPTH = 5
export const REPLAY_DEBUG_TEXT_LIMIT_CHARS = 4_096
/** What the debugger capture appends to a text it cut at {@link REPLAY_DEBUG_TEXT_LIMIT_CHARS}. */
export const REPLAY_DEBUG_TRUNCATION_MARKER = '… [truncated]'
export const REPLAY_DEBUG_CAPTURE_TIMEOUT_MS = 5_000
/** Native Call Stack name of the owned historical session; the Study hint names it for learners. */
export const REPLAY_DEBUG_SESSION_NAME = 'Codebook · Recorded learning'
/** What the recorded session's thread and stop description read in Run and Debug while another tab is in front of the recorded application: the moment is recorded and only hidden, so "Not recorded at this moment" would be wrong. The Study pane says the same with the remedy. */
export const REPLAY_COVERED_LABEL =
  'Recorded application is covered by another tab'
/** How long a replay moment waits for native Run and Debug to load its recorded values (VS Code defers Variables ~400 ms) before committing without them. */
export const REPLAY_DEBUG_INSPECTION_GRACE_MS = 1_000
/** How long after the historical adapter served a stop's values the reader is told that Run and Debug loaded them. The adapter knows when it answered, not when native Variables drew the rows; a reader that drops its hint in the same instant repaints within a few milliseconds of that view, and the Linux editors under WSLg do not put a frame on the screen that follows another that closely until the window is repainted again (measured 2026-10-04: a change 4 ms after another stayed off the screen, one 30 ms after it was shown), which left the first scope open and empty and the hint in place. 100 ms is not enough: the Variables pane hides its scrollbar 500 ms after it is shown and loads a missed stop 400 ms after, so in Cursor 3.23 a reader told 100 ms later repainted on top of that scrollbar repaint and kept its hint on the screen. */
export const REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS = 150
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
/** How long "no Chrome found on PATH" is given again without a new search; a browser installed in that time is found by the first prerequisite check after it. */
export const CHROME_NOT_FOUND_REUSE_MS = 10_000
/** The directory that holds the profile folder of every managed browser run on macOS and Linux; short and fixed, because Chrome and the debugger resolve the path before they start. Windows uses a folder of the user's own instead ({@link MANAGED_PROFILE_ROOT_UNDER_LOCAL_APP_DATA}, {@link managedProfileRoot}). */
export const MANAGED_PROFILE_ROOT = '/tmp'
/** Where the managed browser profiles lie on Windows, below the user's local application data folder (`%LOCALAPPDATA%`), which is the user's alone by Windows' default rights. */
export const MANAGED_PROFILE_ROOT_UNDER_LOCAL_APP_DATA = [
  'Codebook',
  'browser-profiles',
]
/** The configuration every Git command Codebook runs in the opened folder starts with ({@link RepositorySourceService}, {@link inspectDeepWikiFreshness}): a repository's own config can name an fsmonitor hook (`core.fsmonitor`), a program Git starts for `diff` and `ls-files`, which a folder that a clone did not make (an archive, a copy, a share) may carry; it is switched off. */
export const GIT_CONFIGURATION_IN_OPENED_FOLDER = [
  '-c',
  'core.fsmonitor=false',
] as const
/** What the name of every managed browser profile folder begins with; the rest is random. */
export const MANAGED_PROFILE_PREFIX = 'codebook-browser-'
/** The file in a managed browser profile folder that names the editor process, the machine and the boot that made it, and, since CX7, the operating-system user it ran as. Only a folder that carries it is ever removed by a later run, and a sweep leaves a folder whose marker names another user, on every system. */
export const MANAGED_PROFILE_OWNER_FILE = 'codebook-owner.json'
/** How many profile folders with an owner marker the start of a managed run judges for ones a killed editor left; more than that wait for a later run. A folder without a readable marker is passed over and is not counted. */
export const MANAGED_PROFILE_SWEEP_LIMIT = 64
/** How long a managed run's close waits for the sweep of abandoned profile folders its launch started; the sweep goes on after it, and the folders it has not judged by then stay for the next sweep. On Windows each judgement can cost a start query of up to {@link PROCESS_START_QUERY_TIMEOUT_MS}, so a root with many leftovers would otherwise hold a close for minutes; the bound lies well inside the 20 s the close gives its other waits. */
export const ABANDONED_PROFILE_SWEEP_CLOSE_WAIT_MS = 2_000
/** How often the removal walk lists a directory again for entries another program made meanwhile, before it removes the entry that goes last (the owner marker of a profile folder); a directory that still gains entries then keeps that entry, and a later removal tries again. */
export const REMOVAL_RELISTS_BEFORE_LAST_ENTRY = 3
/** How often the removal of a run's own profile folder is tried again while something in it is still busy. */
export const MANAGED_PROFILE_REMOVAL_RETRIES = 3
/** The pause before the first retry of that removal; each further retry waits this much longer. */
export const MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS = 100
/** How long the one listing of this machine's processes ({@link listProcesses}: `ps`, PowerShell on Windows) may run before it is ended and counts as failed. It lies above a cold start of PowerShell and below the 20 s a managed run waits for its browser's processes, so a listing that hangs ends inside that wait and inside the run's close. */
export const PROCESS_LISTING_TIMEOUT_MS = 10_000
/** The most bytes that listing may print before it is ended and counts as failed. Node.js gives a child 1 MiB unless told otherwise, which some hundred long command lines pass; 64 MiB hold thirty thousand processes with command lines of two thousand bytes each. */
export const PROCESS_LISTING_MAX_BYTES = 64 * 1024 * 1024
/** The pause between two looks for a managed profile's processes on Windows, where each look starts a PowerShell scan of every process (`Get-CimInstance Win32_Process`, hundreds of milliseconds or more): one scan runs at a time and they never follow each other back to back. Other systems keep the runtime's {@link POLL_INTERVAL_MS}, since `ps` answers in milliseconds. */
export const PROCESS_LISTING_POLL_INTERVAL_MS_ON_WINDOWS = 500
/** `vscode.env.remoteName` of a WSL window: the only remote whose extension host owns the workspace files and processes like a local one. */
export const WSL_REMOTE_NAME = 'wsl'
/** How long a replay opened while another window has the desktop focus waits for the Codebook work window to gain focus before answering with the remedy. */
export const RECORDING_WINDOW_FOCUS_WAIT_MS = 10_000
/** How long the status bar's Open replay command waits for its load to end, so that it can show a failed load's reason as a notification: the wait for the window's focus and one owned replay settle. A load still running then is left to finish without a notice. */
export const OPEN_REPLAY_RESULT_WAIT_MS =
  RECORDING_WINDOW_FOCUS_WAIT_MS + PRESENTATION_SETTLE_CEILING_MS
/** How long the reader waits, after the Learning summary's view was hidden while its document held the keyboard focus, for that document's report that it lost the focus. The report travels from the webview and can arrive after the editor's visibility event: when it comes (the learner opened another view or part), nothing is done; when it does not, the focus is still in the hidden webview and goes to the active editor group. */
export const SUMMARY_FOCUS_RELEASE_WAIT_MS = 300
/** How long after the window's focus event a pointer press in a pane Codebook serves into the editor (a Study pane, the Repository Wiki pane) still counts as the press the learner returned to the pane with. The editor reports the focus and the press of one click a few milliseconds apart, in an order the pane cannot rely on; a press on the pane's background that comes later is the learner's own choice to take the focus off a control. */
export const PANE_RETURN_PRESS_WINDOW_MS = 300
/** A seek less than this far before a recorded stop presents that stop: recorded stops sit at fractional receipt milliseconds (122,822.02), and a driver that rounds down must not land in the gap before it. */
export const PLAYBACK_SEEK_STOP_SNAP_MS = 1

/** Insertion mode identifiers of pinned parse5 8.0.1; used by {@link readHtmlStartTags} for current select rules and proven absent-end handling. */
export const HTML_PARSER_IN_BODY_MODE = 6
export const HTML_PARSER_IN_TABLE_MODE = 8
export const HTML_PARSER_IN_CAPTION_MODE = 10
export const HTML_PARSER_IN_TABLE_BODY_MODE = 12
export const HTML_PARSER_IN_ROW_MODE = 13
export const HTML_PARSER_IN_CELL_MODE = 14
export const HTML_PARSER_IN_SELECT_MODE = 15
export const HTML_PARSER_IN_SELECT_IN_TABLE_MODE = 16
/** Insertion modes in which a hidden input takes the table rule, which leaves an open select open, instead of the body rule, which closes it; used by {@link readHtmlStartTags}. */
export const HTML_PARSER_HIDDEN_INPUT_TABLE_MODES = new Set([
  HTML_PARSER_IN_TABLE_MODE,
  HTML_PARSER_IN_TABLE_BODY_MODE,
  HTML_PARSER_IN_ROW_MODE,
])
/** Table-section ends for which {@link readHtmlStartTags} checks both the section and the row scope before the pinned parser can close either. */
export const HTML_PARSER_TABLE_SECTION_NAMES = new Set([
  'tbody',
  'tfoot',
  'thead',
])
/** The insertion modes in which {@link readHtmlStartTags} skips an end tag whose name no open element has, each with the table names that mode still acts on then: `</table>` closes an open caption, table section or row even where no table is open, as in a template's content. Each other name either takes the body rules there (through a table mode's "anything else") or is a table name the mode ignores or checks in table scope, which an absent name is not in; the remaining modes keep the parser's rules. */
export const HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES = new Map<
  number,
  ReadonlySet<string>
>([
  [HTML_PARSER_IN_BODY_MODE, new Set()],
  [HTML_PARSER_IN_TABLE_MODE, new Set()],
  [HTML_PARSER_IN_CAPTION_MODE, new Set(['table'])],
  [HTML_PARSER_IN_TABLE_BODY_MODE, new Set(['table'])],
  [HTML_PARSER_IN_ROW_MODE, new Set(['table'])],
  [HTML_PARSER_IN_CELL_MODE, new Set()],
])
/** Ends the body rules act on although no element of their name is open, so {@link readHtmlStartTags} never skips them: `</p>` inserts an empty p and `</br>` a br, and in foreign content each first leaves it. */
export const HTML_PARSER_ABSENT_END_BODY_NAMES = new Set(['br', 'p'])
/** The names of the HTML standard's svg case table (37 names, as Chrome 151 adjusts them) that pinned parse5 8.0.1's table (36) lacks, each with its svg case; {@link readHtmlStartTags} writes a start or end tag of one in svg case in svg content, as parse5 does for the others. */
export const HTML_PARSER_SVG_CASE_NAMES_PARSE5_LACKS = new Map([
  ['fedropshadow', 'feDropShadow'],
])
/** Heading names: the body rules close an open heading of any level at the end of any of them, so {@link readHtmlStartTags} skips an absent one only while no heading is open. */
export const HTML_PARSER_HEADING_NAMES = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

/** How long a test history's seal waits before its one retry after a transient file-system failure ({@link TRANSIENT_SEAL_ERROR_CODES}). */
export const SEAL_RETRY_DELAY_MS = 200

/**
 * The file-system error codes that may pass by themselves, so the seal of a test history is tried once more ({@link StudyService.sealNodeHistory}); any other code fails the seal at once.
 * It is {@link TRANSIENT_FILE_ERROR_CODES} without `EIO`: a disk error at the seal can leave a torn write, which waiting 200 ms does not repair, while a descriptor shortage or a busy file passes by itself.
 */
export const TRANSIENT_SEAL_ERROR_CODES: readonly string[] =
  TRANSIENT_FILE_ERROR_CODES.filter((code) => code !== 'EIO')

/** How many listed test histories keep the map of their citable events for the fast path of a changed learning material; the others read their journal again when it changes ({@link NodeTestHistoryStore.summarize}). */
export const NODE_HISTORY_CITABLE_MEMO_LIMIT = 8

/** The most tabs of one editor group a placement refusal report lists ({@link describePlacementRefusal}), in tabs. */
export const REFUSAL_REPORT_GROUP_TABS = 8

/** The longest tab label a placement refusal report shows, in characters. */
export const REFUSAL_REPORT_LABEL_CHARS = 48

/** What a placement refusal report prints as its failed checks when the guard refused with none of the compared parts differing. */
export const REFUSAL_REPORT_UNATTRIBUTED_CHECKS =
  'unattributed (none of the compared parts differ)'

/** The most editor events a {@link PlacementEventLog} keeps and a placement refusal report lists, in events. */
export const REFUSAL_REPORT_EVENTS = 24

/** The most native effects Codebook itself issued (reveals, disposals, editor commands, shown documents) that a {@link PlacementEventLog} keeps for a placement refusal report, in effects. */
export const REFUSAL_REPORT_EFFECTS = 48

/** How long a new Application group's preparation waits for the editor's own report that it activated the group, in ms; Cursor sends it after the command that made the group answered (N55-F4, row 650). It ends at the report, or here when the editor sends none. The bound is empirical, not derived: N56 on candidates `5b39b767` and `02acefaa` opened the Study workspace 13 times in Cursor 3.27.12 and the report always arrived within it, with no refusal; a report that arrives later is read by the guards as a change the learner made and refuses the open with a report naming the late activation. */
export const LATE_GROUP_ACTIVATION_WAIT_MS = 150

/** Why the reader did not carry out a choice the Learning summary sent while the Study workspace was closed; completes "The … choice from the Learning summary was not carried out: " in Output › Codebook and "Codebook did not carry out your choice: " in the notice the learner sees. */
export const SUMMARY_CHOICE_DROPPED_REASON_CLOSED =
  'the Study workspace is closed. To continue, run “Codebook: Open Study Workspace”, then make your choice again.'

/** The reason when the choice arrived while the Study workspace was closing. See {@link SUMMARY_CHOICE_DROPPED_REASON_CLOSED}. */
export const SUMMARY_CHOICE_DROPPED_REASON_CLOSING =
  'the Study workspace is closing. When it has closed, run “Codebook: Open Study Workspace”, then make your choice again.'

/** The reason when the reader had left the summary composition (the Study pane stands again). See {@link SUMMARY_CHOICE_DROPPED_REASON_CLOSED}. */
export const SUMMARY_CHOICE_DROPPED_REASON_COMPOSITION_LEFT =
  'the Learning summary is not showing a replay. Open a replay from Saved studies, then make your choice again.'

/** What the learner's notice for a dropped Learning summary choice starts with, before the reason. */
export const SUMMARY_CHOICE_DROPPED_NOTICE_PREFIX =
  'Codebook did not carry out your choice: '

/** The text that replaces a secret value or a secret-named value in every captured fact, variable, snapshot, output and cause ({@link redactSecretText}). */
export const REDACTION_MASK = '[masked]'

/** The most characters of an incomplete trailing token or private-key block an output redactor holds back; past it the held part is released masked ({@link createOutputRedactor}). 8 KiB. */
export const OUTPUT_REDACTION_HOLD_LIMIT_CHARS = 8_192

/** The characters kept back when an over-long run shows no secret shape is released, so a secret marker cut by the release is still seen whole ({@link createOutputRedactor}). */
export const OUTPUT_REDACTION_CARRY_CHARS = 16

/** The characters of a dropped private-key body kept to find an END marker split across chunks ({@link createOutputRedactor}); longer than the longest END marker its bounded label allows (about 106 characters). */
export const OUTPUT_REDACTION_END_MARKER_TAIL_CHARS = 128

/** How far into a debugger preview value its type name or length prefix is looked for ({@link redactValuePreview}); a longer type name is read as a bare value. */
export const PREVIEW_VALUE_PREFIX_LIMIT_CHARS = 128

/** How much of an oversized private-key block an output redactor drops before it ends the block at the next line break, so a header without an END marker cannot silence the channel ({@link createOutputRedactor}); four times a 4096-bit RSA key's PEM. */
export const OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS = 16_384
/** The stable codes of the reasons a node-server history is partial; each is keyed in the README's troubleshooting table and listed in `captureMissing`. */
export const NODE_SERVER_HISTORY_REASON_CODES = {
  noResponseRequestFailed: 'SERVER_HISTORY_NO_RESPONSE_REQUEST_FAILED',
  noResponseStopped: 'SERVER_HISTORY_NO_RESPONSE_STOPPED',
  noResponseExited: 'SERVER_HISTORY_NO_RESPONSE_EXITED',
  noResponseRunFailed: 'SERVER_HISTORY_NO_RESPONSE_RUN_FAILED',
  stopNotReached: 'SERVER_HISTORY_STOP_NOT_REACHED',
  snapshotMissing: 'SERVER_HISTORY_SNAPSHOT_MISSING',
  sourceUnavailable: 'SERVER_HISTORY_SOURCE_UNAVAILABLE',
  valueUnavailable: 'SERVER_HISTORY_VALUE_UNAVAILABLE',
  appendFailed: 'SERVER_HISTORY_APPEND_FAILED',
  sizeLimit: 'SERVER_HISTORY_SIZE_LIMIT',
  captureBudgetExhausted: 'SERVER_HISTORY_CAPTURE_BUDGET_EXHAUSTED',
  outputTruncated: 'SERVER_HISTORY_OUTPUT_TRUNCATED',
} as const
/** The profile of a run of the opened repository's unpacked Manifest V3 extension in a browser Codebook owns. */
export const CHROME_EXTENSION_PROFILE = 'chrome-extension'
/** The one action a chrome-extension run offers: perform its next declared click. */
export const EXTENSION_CLICK_ACTION = 'extension-click'
/** The oldest Chrome major version whose CDP `Extensions.loadUnpacked` installs an unpacked extension without a switch. */
export const CHROME_EXTENSION_MIN_VERSION = 149
/** At most this many declared clicks per chrome-extension run. */
export const EXTENSION_CLICK_LIMIT = 3
/** At most this many declared stops per chrome-extension run. */
export const EXTENSION_STOP_LIMIT = 4
/** A seeded bookmark tree holds at most this many nodes in total. */
export const EXTENSION_SEED_BOOKMARK_LIMIT = 200
/** A seeded bookmark tree is at most this deep. */
export const EXTENSION_SEED_DEPTH_LIMIT = 6
/** A seeded bookmark title is at most this long. */
export const EXTENSION_SEED_TITLE_LIMIT_CHARS = 256
/** A seeded bookmark url is at most this long. */
export const EXTENSION_SEED_URL_LIMIT_CHARS = 2_048
/** Seeded storage holds at most this many keys. */
export const EXTENSION_SEED_STORAGE_KEY_LIMIT = 50
/** Seeded storage is at most this large as JSON. */
export const EXTENSION_SEED_STORAGE_LIMIT_BYTES = 65_536
/** Static-load discovery follows script and import references at most this deep. */
export const EXTENSION_STATIC_LOAD_DEPTH_LIMIT = 8
/** The most entries (files, folders, links) the pre-launch link walk lists before it refuses the extension folder. */
export const EXTENSION_LINK_WALK_ENTRY_LIMIT = 50_000
/** A stop line longer than this marks its file as bundled (DXR9). */
export const EXTENSION_BUNDLED_LINE_LIMIT_CHARS = 1_000
/** How long a surface, popup or worker child may take to appear. */
export const EXTENSION_WAKE_BOUND_MS = 5_000
/** How long `Extensions.triggerAction` may take to open the popup target. */
export const EXTENSION_OPEN_BOUND_MS = 5_000
/**
 * How long Codebook waits for every service worker of the extension to stop before the debugger attaches.
 * A freshly installed extension's worker can stay listed for more than 3 s while Chrome finishes starting it under load (seen in a full test-suite run on Chrome 156), so the bound leaves room; the wait still ends 500 ms after the worker is gone.
 */
export const EXTENSION_STOP_WORKERS_BOUND_MS = 10_000
/** How long a dispatched click waits for a pause or settled work before it answers `running`. */
export const EXTENSION_CLICK_RETURN_BOUND_MS = 10_000
/** No stop reached for this long after the last click settles the work before the observation. */
export const EXTENSION_OBSERVE_SETTLE_MS = 1_000
/** The observation polls at most this long, counting unpaused time only. */
export const EXTENSION_OBSERVE_BOUND_MS = 5_000
/** Interval between observation reads. */
export const EXTENSION_OBSERVE_POLL_MS = 250
/** Each observation read has its own deadline (ER9). */
export const EXTENSION_OBSERVE_READ_TIMEOUT_MS = 2_000
/** An observation reads at most this many bytes (ER23). */
export const EXTENSION_OBSERVE_READ_LIMIT_BYTES = 65_536
/** An observed JSON value is read at most this deep (ER23). */
export const EXTENSION_OBSERVE_DEPTH_LIMIT = 8
/** At most this many worker or page console events are journaled per run (ER10). */
export const EXTENSION_OUTPUT_EVENT_LIMIT = 200
/** A paused service-worker stop is held at most this long, the bound task 0 measured (ER8). */
export const EXTENSION_WORKER_PAUSE_HOLD_MS = 280_000
/** After SIGTERM, an owned browser gets this long before SIGKILL. */
export const EXTENSION_BROWSER_KILL_GRACE_MS = 5_000
/** A declared chrome-extension click title is 1 to this many characters (DR2). */
export const EXTENSION_CLICK_TITLE_LIMIT_CHARS = 80
/** API permissions that reach outside the run's test profile; a manifest declaring one needs `acknowledgedPermissions` (ER5). */
export const EXTENSION_ACKNOWLEDGED_API_PERMISSIONS = [
  'nativeMessaging',
  'debugger',
  'management',
  'downloads',
  'proxy',
  'privacy',
] as const
/** One `acknowledgedPermissions` entry of a chrome-extension declaration is 1 to this many characters (ER5). */
export const EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT_CHARS = 256
/** A chrome-extension declaration lists at most this many `acknowledgedPermissions` entries (ER5). */
export const EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT = 100
/** The root js-debug attach session of a chrome-extension run is named with this prefix and the run id; child sessions are told apart by target type, never by name (SR14). */
export const CHROME_EXTENSION_SESSION_NAME_PREFIX = 'codebook chrome extension '
/** Every declared extension stop is requested at this column: a stop declares a line only, and the adapter binds the first position of the line. */
export const EXTENSION_STOP_COLUMN = 1
/** Each CDP request of a click step may run this long in unpaused time before its answer counts as lost (ER14). */
export const EXTENSION_STEP_REQUEST_TIMEOUT_MS = 20_000
/**
 * How long a freshly spawned owned browser may take to publish its `DevToolsActivePort` file.
 * Why 30 s: Chrome's first start after a boot reads its whole install from a cold disk; on fresh Ubuntu CI runners the first launch took 10–13 s and once passed 15 s, while later launches took about 2 s. Puppeteer's default launch timeout is also 30 s.
 */
export const EXTENSION_BROWSER_START_BOUND_MS = 30_000
/** Interval at which the owned launch polls the browser's files and targets. */
export const EXTENSION_BROWSER_POLL_MS = 100
/** Each command on the owned browser's CDP connection has this deadline unless the caller names another. */
export const EXTENSION_CDP_COMMAND_TIMEOUT_MS = 10_000
/** After `ServiceWorker.startWorker`, the popup opens only once the worker has had this long to apply the extension's own state (task 0). */
export const EXTENSION_POPUP_WORKER_SETTLE_MS = 1_500
/** Marks a profile folder whose browser Codebook spawned itself; only such a folder's live browser is stopped by the orphan sweep (ER18). */
export const OWNED_BROWSER_MARKER_FILE = 'codebook-owned-browser'
/** The owned launch treats the extension's workers as stopped after none has been listed for this long; Chrome starts a new extension's worker shortly after `loadUnpacked` answers. */
export const EXTENSION_WORKER_QUIET_MS = 500
/** A command inside an owned-launch poll loop is never sent with less time than this: the last look comes after the last pause, when the loop's bound is spent, and still needs time for a local Chrome to answer it (B6). */
export const EXTENSION_POLL_COMMAND_MIN_TIMEOUT_MS = 1_000
/** One `ServiceWorker.stopAllWorkers` that is not answered in this time is sent again by the stop loop of the owned launch. */
export const EXTENSION_STOP_COMMAND_TIMEOUT_MS = 1_000
/** `<chrome> --version` that prints nothing in this time counts as an unreadable version; no browser session is started to read it. */
export const EXTENSION_CHROME_VERSION_READ_BOUND_MS = 5_000

// Lane D (Application view of a chrome-extension run, Cycle 0061 pt2)
/** Header line 2 of an extension run's Application view in every phase, after the run too (DR1, C1, C2). */
export const EXTENSION_VIEW_PROVENANCE =
  'Operated by chat · Test profile · seeded data · Live only · replay unavailable'
/** `Page.stopScreencast` on the surface's session, sent when the view ends, is waited for this long; the view is already final without its answer. */
export const EXTENSION_SCREENCAST_STOP_TIMEOUT_MS = 1_000

// Lane E: chrome-extension run lifecycle and observation (Cycle 0061 pt2)
/** The most characters of an observed value the run resource reports before it cuts it and marks it `truncated` (ER23). */
export const EXTENSION_OBSERVED_VALUE_LIMIT_CHARS = 4_096
/** How long the run waits for the surface screenshot it pins at a pause; a paused page may never answer it. */
export const EXTENSION_PIN_CAPTURE_TIMEOUT_MS = 2_000
/** How long a chrome-extension run's stop waits for a preparation step still in flight, from the stop's admission; a step that ignores its abort cannot hold the stop past it. Shares the node-server stop bound ({@link NODE_SERVER_STOP_DEADLINE_MS}). */
export const CHROME_EXTENSION_STOP_DEADLINE_MS = NODE_SERVER_STOP_DEADLINE_MS
/** How many moves in a row of a paused file out of an extension run's Application group may fail before the lease stops trying; a show the editor keeps refusing then leaves the file where it is instead of looping (Cycle 0062 task 2). */
export const PAUSED_SOURCE_MOVE_ATTEMPTS = 2

// Lane F (Cycle 0061 pt2, MCP surface and help)
/**
 * `codebook_start` of a chrome-extension run answers within this time: a preparation still under way answers its `phase`, and the chat reads the run resource until `ready` (CR4).
 * Why 40 s: a preparation may take up to the 90 s setup bound, near the smallest MCP client timeout found for a tool call (120 s idle in Cursor, {@link CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS}; Cursor's agent CLI keeps the MCP SDK's fixed 60 s, which progress notifications do not extend), so the start keeps inside the 45 s every waiting tool call keeps ({@link CONTINUE_ANSWER_CALL_BUDGET_MS}), with room for the book read before it.
 */
export const CHROME_EXTENSION_START_ANSWER_MS = 40_000
/** The oldest Codebook extension version that serves the chrome-extension profile, reported by `codebook_status`. */
export const CHROME_EXTENSION_MINIMUM_EXTENSION_VERSION = '0.2.59'
/** What `codebook_explain`, `codebook_explain_node_history` and the Save command answer for a chrome-extension run: nothing of it is saved in this version (SR13, SR37). */
export const CHROME_EXTENSION_SAVE_REFUSAL =
  'Saving an extension run is not available in this version; the live explanation stays in the chat.'
/** The error codes after which a chrome-extension run is `failed` or ended and cleaned up; a tool call whose wait ends in one answers with the run's state beside the error (DXR6). */
export const CHROME_EXTENSION_FAILED_STATE_CODES: readonly string[] = [
  'INPUT_PARTIAL',
  'CLICK_OUTCOME_UNKNOWN',
  'DIALOG_UNDECLARED',
  'SOURCE_CHANGED',
  'SERVICE_WORKER_RESTARTED',
  'SERVICE_WORKER_LOST',
  'STOP_NOT_BOUND',
  'SURFACE_LOST',
  'BROWSER_LOST',
  'OBSERVATION_UNAVAILABLE',
  // A debug session that ended, a run or setup time limit and a wrapped error also leave the run failed (DXR6).
  'RUNTIME_FAILED',
]

/** The one Vite major the `vite-dev` adapter supports, the major verified natively (Cycle 0063); widening needs a native run on that major. */
export const VITE_SUPPORTED_MAJOR = 8

/** Vite's own default dev-server port, used when neither the project's config nor its `dev` script names one. */
export const VITE_DEFAULT_PORT = 5173

/** The one host Codebook owns for a Vite dev server; the launcher passes it inline and the parent refuses a resolved `server.host` that differs (a plugin can widen it to every interface). */
export const VITE_LOOPBACK_HOST = '127.0.0.1'

/** How long the owned Vite launcher may take from its spawn to the facts of the resolved config, before the setup budget for readiness starts. */
export const VITE_LAUNCHER_FACTS_TIMEOUT_MS = 30_000

/** How long one request for a module the Vite dev server serves may take while a stop is sealed. */
export const VITE_MODULE_FETCH_TIMEOUT_MS = 15_000

/** The longest `node --version` may take when a run's Node executable is checked. */
export const NODE_VERSION_TIMEOUT_MS = 10_000

/** The shortest environment value (characters) the launcher diagnostics mask by value, so a short common word is not blanked everywhere. */
export const VITE_MASKED_VALUE_MIN_CHARS = 6

/** The most messages an owned development server's IPC channel keeps unread; project code that floods the channel loses the newest messages instead of growing memory. */
export const DEVELOPMENT_SERVER_MESSAGE_QUEUE_LIMIT = 32

/** The longest a `vite/package.json` version may be (the study schema's `viteVersion` limit). */
export const VITE_VERSION_MAX_CHARS = 64

/** The longest a Vite config's thrown error line is carried in a refusal. */
export const VITE_ERROR_LINE_LIMIT_CHARS = 200

/** The extensions of a source file the Vite dev server serves as JavaScript with an inline map; `.vue` and `.svelte` need a framework plugin's own map and are refused. */
export const VITE_STOP_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
]

/** How long the Vite page must stay loaded, with no further reload, before the initial inputs are written. */
export const VITE_PAGE_QUIET_MS = 500

/** The shortest wait for the optimizer-idle report: a nearly spent setup budget never becomes a zero-length wait. */
export const VITE_OPTIMIZER_WAIT_MIN_MS = 1_000

/** The most reloads before the inputs the run tolerates (a dependency optimizer reloads once or twice). */
export const VITE_PAGE_GENERATION_LIMIT = 4

/** The message types of the IPC channel between the extension and the owned Vite launcher. */
export const VITE_LAUNCHER_MESSAGES = {
  env: 'vite-env',
  facts: 'vite-facts',
  failed: 'vite-failed',
  listen: 'vite-listen',
  refuse: 'vite-refuse',
  listening: 'vite-listening',
  /** Command after listening: asks the launcher to report once Vite's dependency optimizer is idle. */
  awaitOptimizer: 'vite-await-optimizer',
  /** Report answering {@link VITE_LAUNCHER_MESSAGES.awaitOptimizer}: the optimizer has nothing left to process. */
  optimizerIdle: 'vite-optimizer-idle',
} as const
