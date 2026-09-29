export const API_VERSION = '1.5';
export const EXTENSION_VERSION = '0.2.14';
export const CONFIGURED_MINIMUM_EXTENSION_VERSION = '0.2.0';
export const NODE_TEST_MINIMUM_EXTENSION_VERSION = '0.2.12';
export const LOOPBACK_ADDRESS = '127.0.0.1';
export const DYNAMIC_PORT = 0;
export const TOKEN_BYTES = 32;
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export const CURSOR_MCP_CATALOG_REFRESH_STEP_MS = 1;
export const CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES = 16_384;
export const CURSOR_MCP_CATALOG_LOCK_RETRIES = 3;
export const CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS = 50;
export const CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS = 120_000;
export const CURSOR_SKILL_RECEIPT_LIMIT_BYTES = 16_384;
export const BOOK_INPUT_LIMIT_BYTES = 1_048_576;
export const HTTP_ENVELOPE_LIMIT_BYTES = 65_536;
export const HTTP_BODY_LIMIT_BYTES = BOOK_INPUT_LIMIT_BYTES + HTTP_ENVELOPE_LIMIT_BYTES;
export const HTTP_HEADER_LIMIT_BYTES = 8_192;
export const HTTP_READ_TIMEOUT_MS = 5_000;
export const MAX_IN_FLIGHT_REQUESTS = 32;
export const MAX_SESSIONS = 8;
export const SESSION_IDLE_TIMEOUT_MS = 300_000;
export const MAINTENANCE_INTERVAL_MS = 250;
export const MAX_RUNS = 16;
export const KEY_LENGTH_LIMIT = 128;
export const REFERENCE_LENGTH_LIMIT = 1_024;
export const MAX_EXPLANATION_CHARS = 8_192;
export const LEARNING_SUMMARY_LIMITS = { identifierChars: 48, titleChars: 160, participantLabelChars: 80, participants: 8, stepLabelChars: 240, steps: 64, bytes: 128 * 1024 };
export const MAX_EXPLANATIONS = 32;
export const MAX_VALUE_PATHS = 10;
export const EVENT_PAGE_SIZE = 50;
export const EVENT_DETAIL_LIMIT_BYTES = 8_192;
export const MAX_EVENTS = 10_000;
export const MAX_RETAINED_EVENT_BYTES = 4_194_304;
export const MAX_QUEUED_EVIDENCE_BYTES = 16_777_216;
export const SOURCE_LIMIT_BYTES = 1_048_576;
export const IMAGE_LIMIT_BYTES = 8_388_608;
export const IMAGE_BASE64_LIMIT_CHARS = 11_184_812;
export const PREREQUISITE_TIMEOUT_MS = 5_000;
export const MIN_NODE_MAJOR_VERSION = 24;
export const NATIVE_COMMAND_POLL_MS = 100;
export const NATIVE_EDITOR_START_TIMEOUT_MS = 120_000;
export const NATIVE_OBSERVATION_TIMEOUT_MS = 25_000;
export const NATIVE_EXPIRY_MARGIN_MS = 2_000;
export const NATIVE_AGENT_WINDOW_MS = 300_000;
export const CAPTURE_PHASES = ['before', 'paused-server', 'paused-browser', 'after'] as const;
export const LEARNING_SCHEMA_VERSION = 1;
export const LEARNING_SCHEMA_VERSION_V2 = 2;
export const LEARNING_SCHEMA_VERSION_V3 = 3;
export const LEARNING_SCHEMA_VERSION_V4 = 4;
export const PROGRESS_V2_FILE = 'progress.v2.json';
export const PROGRESS_V3_FILE = 'progress.v3.json';
export const PROGRESS_V4_FILE = 'progress.v4.json';
export const PROGRESS_REPOSITORY_FILE = 'progress.repository.v4.json';
export const STUDY_V2_SUFFIX = '.study.v2.json';
export const STUDY_METADATA_V2_SUFFIX = '.study.meta.v2.json';
export const MAX_STUDY_OBSERVATIONS_V2 = 4;
export const MAX_STUDY_CAPTURES_V2 = 7;
export const MAX_STUDY_LINKS_V2 = 11;
export const STUDY_METADATA_LIMIT_BYTES = 8_192;
export const MAX_LEARNER_DECISIONS = 1_000;
export const MAX_STUDY_ARCHIVE_BYTES = 67_108_864;
export const PROGRESS_LIMIT_BYTES = 1_048_576;
export const MAX_STUDY_OBSERVATIONS = 2;
export const MAX_STUDY_LINKS = 5;
export const DEFAULT_SAVED_STUDY_LIMIT = 64;
export const MAX_SAVED_STUDIES = 256;
export const MAX_SOURCE_DOCUMENTS = 34;
export const STUDY_REFRESH_INTERVAL_MS = 250;
export const STUDY_EDITOR_GROUP_COUNT = 3;
export const LIVE_EDITOR_GROUP_COUNT = 2;
export const LIVE_EDITOR_LAYOUT = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] } as const;
export const REPOSITORY_MIN_EDITOR_GROUP_COUNT = 2;
export const HORIZONTAL_EDITOR_ORIENTATION = 0;
export const PRESENTATION_PREFERENCE_KEY = 'codebook.presentation.v1';
export const PRESENTATION_PREFERENCE_VERSION = 1;
export const PRESENTATION_READY_TIMEOUT_MS = 5_000;
export const STUDY_LAYOUT_STABLE_MISMATCH_MS = 750;
export const PRESENTATION_READING_LIMIT_PX = 10_000_000;
export const PRESENTATION_FOCUS_INDEX_LIMIT = 32;
export const PRESENTATION_READING_ANCHORS = ['title', 'learning-material', 'observation', 'overview', 'live-content', 'source-version', 'flow', 'moments'] as const;
export const PRESENTATION_READING_DETAILS = ['reader-options', 'presentation-options', 'playback-options', 'playback-diagnostics', 'later-annotations', 'study-controls', 'evidence-details'] as const;
export const PRESENTATION_READING_VISITED = ['source', 'current-file'] as const;
export const PRESENTATION_FOCUS_IDS = ['previous-moment', 'next-moment', 'interpretations', 'presentation-mode', 'playback-toggle', 'playhead', 'overview-tab', 'live-tab', 'recording-tab', 'understood', 'profiles', 'studies'] as const;
export const PRESENTATION_FOCUS_ACTIONS = ['return-wiki', 'open-article', 'return-current', 'continue', 'stop', 'retry', 'reload-recording', 'source', 'current-file', 'run', 'click', 'connect', 'focus-app', 'focus-context', 'read-app', 'read-source', 'read-context', 'outline', 'arrange', 'enlarge-app', 'enlarge-context'] as const;
export const PRESENTATION_MODE_IDS = ['study-workspace', 'living-book', 'guided-walkthrough'] as const;
export const STUDY_PRESENTATIONS = {
  'study-workspace': { title: 'Study workspace', description: 'Application above source, with explanation alongside.', appColumn: 1, sourceColumn: 2, contextColumn: 3,
    layout: { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] } },
  'living-book': { title: 'Living book', description: 'Read the explanation with application and source beside it.', appColumn: 2, sourceColumn: 3, contextColumn: 1,
    layout: { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] } },
  'guided-walkthrough': { title: 'Guided walkthrough', description: 'Follow application and source side by side, with explanation below.', appColumn: 1, sourceColumn: 2, contextColumn: 3,
    layout: { orientation: 1, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] } },
} as const;
// Allow native pixel rounding, not learner-selected split ratios.
export const EDITOR_LAYOUT_ROUNDING_FRACTION = 0.005;
export const MAX_UI_TEXT_CHARS = 8_192;
export const STUDY_SOURCE_SCHEME = 'codebook-source';
export const REPOSITORY_SOURCE_SCHEME = 'codebook-repository-source';
export const REPOSITORY_READER_DEBOUNCE_MS = 150;
export const REPOSITORY_VISITED_CITATIONS_LIMIT = 512;
export const REPOSITORY_NARROW_WIDTH_PX = 800;
// Intro, citations, observations and learner progress complement authored article sections.
export const REPOSITORY_FIXED_READING_SECTIONS = 4;
export const RECORDING_VERSION = 1;
export const RECORDING_DIRECTORY = 'recordings.v1';
export const CONFIGURED_RECORDING_VERSION = 2;
export const CROSS_RUNTIME_RECORDING_VERSION = 3;
export const CONFIGURED_RECORDING_DIRECTORY = 'recordings.v2';
export const RECORDING_STORAGE_FORMATS = [
  { version: CROSS_RUNTIME_RECORDING_VERSION, directory: 'recordings.v3' },
  { version: CONFIGURED_RECORDING_VERSION, directory: CONFIGURED_RECORDING_DIRECTORY },
  { version: RECORDING_VERSION, directory: RECORDING_DIRECTORY },
] as const;
export const RECORDING_HEADER_FILE = 'header.json';
export const RECORDING_JOURNAL_FILE = 'frames.jsonl';
export const RECORDING_SEAL_FILE = 'sealed.json';
export const RECORDING_CONTEXT_FILE = 'context.json';
// Ten minutes at 20 fps, plus explicit phase captures; pending-write memory remains independently bounded.
export const MAX_RECORDING_FRAMES = 12_100;
export const MAX_RECORDING_PNG_BYTES = 536_870_912;
export const MAX_RECORDING_PENDING_BYTES = 8_388_608;
export const MAX_RECORDING_JOURNAL_BYTES = 8_388_608;
export const RECORDING_TERMINAL_RESERVE_BYTES = 16_384;
export const RECORDING_REASON_LIMIT_CHARS = 1_024;
export const MAX_RECORDING_CONTEXT_BYTES = 8_388_608;
export const MAX_RECORDING_HEADER_BYTES = 65_536;
export const MAX_RECORDING_TOTAL_BYTES = 570_425_344;
export const MAX_RECORDING_METADATA_FILES = 8;
export const RECORDING_SAMPLE_INTERVAL_MS = 50;
export const RECORDING_FRAME_PAGE_SIZE = 100;
export const MAX_RECORDING_DIMENSION_PX = 4_096;
export const PNG_HEADER_BYTES = 24;
export const PNG_WIDTH_OFFSET = 16;
export const PNG_HEIGHT_OFFSET = 20;
export const PNG_SIGNATURE_HEX = '89504e470d0a1a0a0000000d49484452';
export const PLAYBACK_TICK_INTERVAL_MS = 50;
export const PLAYBACK_PREFERENCE_FILE = 'playback.v1.json';
export const PLAYBACK_PREFERENCE_LIMIT_BYTES = 65_536;
export const PLAYBACK_SECOND_MS = 1_000;
export const PLAYBACK_PAGE_STEP_MS = 10_000;
export const REPLAY_VIEWPORT_RECEIPT_LIMIT = 12;
export const REPOSITORY_GIT_TIMEOUT_MS = 5_000;
export const REPOSITORY_GIT_LIMIT_BYTES = 2_097_152;
export const REPOSITORY_MAX_TRACKED_FILES = 5_000;
export const REPOSITORY_SOURCE_PAGE_SIZE = 100;
export const REPOSITORY_PATH_LIMIT_CHARS = 512;
export const REPOSITORY_SOURCE_LIMIT_BYTES = 262_144;
export const REPOSITORY_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.md', '.mdx', '.css', '.html', '.json', '.jsonc'] as const;
export const WIKI_QUESTION_LIMIT_CHARS = 2_000;
export const WIKI_SOURCE_LIMIT_BYTES = 131_072;
export const WIKI_SOURCE_MATCH_LIMIT = 6;
export const WIKI_ROUTE_CANDIDATE_LIMIT_BYTES = 98_304;
export const WIKI_CONTEXT_LINE_LIMIT = 80;
export const WIKI_ANSWER_LIMIT_CHARS = 12_000;
export const WIKI_CURSOR_REQUEST_TIMEOUT_MS = 120_000;
export const WIKI_CURSOR_UPDATE_TIMEOUT_MS = 900_000;
export const WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES = 1_048_576;
export const WIKI_CURSOR_TERMINATION_GRACE_MS = 5_000;
export const WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES = 65_536;
export const WIKI_CURSOR_PROMPT_LIMIT_BYTES = 131_072;
export const WIKI_HTTP_BODY_LIMIT_BYTES = 8_192;
export const WIKI_GIT_OUTPUT_LIMIT_BYTES = 1_048_576;
export const WIKI_GIT_TIMEOUT_MS = 3_000;
export const REPOSITORY_EXCLUDED_DIRECTORIES = ['node_modules', 'dist', 'build', 'coverage', 'artifacts', 'vendor'] as const;
export const BOOK_SCHEMA_VERSION = 1;
export const BOOK_SCHEMA_VERSION_V2 = 2;
export const BOOK_STORAGE_FORMATS = [
  { version: BOOK_SCHEMA_VERSION_V2, suffix: '.book.v2.json' },
  { version: BOOK_SCHEMA_VERSION, suffix: '.book.v1.json' },
] as const;
export const BOOK_ID_LIMIT_CHARS = 64;
export const BOOK_MAX_NODES = 64;
export const BOOK_MAX_EDGES = 128;
export const BOOK_MAX_SECTIONS = 12;
export const BOOK_MAX_ANCHORS = 8;
export const BOOK_MAX_LINKS = 8;
export const BOOK_MAX_SOURCES = 32;
export const BOOK_SECTION_LIMIT_CHARS = 12_000;
export const BOOK_TITLE_LIMIT_CHARS = 160;
export const BOOK_MAX_REVISIONS = 20;
export const BOOK_MAX_FILES = 64;
export const BOOK_REVISION_LIMIT_BYTES = 4_194_304;
export const BOOK_FILE_LIMIT_BYTES = 8_388_608;
export const BOOK_PREPARE_TIMEOUT_MS = 20_000;
export const BOOK_SOURCE_CONCURRENCY = 4;
export const REPOSITORY_BROWSER_PROFILE = 'repository-browser';
export const NODE_TEST_PROFILE = 'node-test';
export const NODE_TEST_HISTORY_VERSION = 1;
export const NODE_TEST_READER_POSITION_VERSION = 1;
export const NODE_TEST_READER_POSITION_LIMIT_BYTES = 4_096;
export const NODE_TEST_LEARNING_DECISION_VERSION = 1;
export const NODE_TEST_LEARNING_DECISION_LIMIT_BYTES = 4_096;
export const NODE_TEST_LEARNING_MATERIAL_VERSION = 1;
export const NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES = LEARNING_SUMMARY_LIMITS.bytes;
export const NODE_TEST_HISTORY_DIRECTORY = 'node-tests.v1';
export const NODE_TEST_HISTORY_LIMIT_BYTES = 8_388_608;
export const NODE_TEST_HISTORY_MAX_ENTRIES = 10_000;
/** Longest debugger type name a saved Node fact keeps; the type is supplementary, so a longer one is omitted rather than failing the run. */
export const NODE_TEST_FACT_TYPE_LIMIT_CHARS = 256;
/** Oldest Vitest major whose file listing, exclusion, name matching and JSON report were verified for exact node-test selection (4.1.11 and 5.0.2). */
export const NODE_TEST_MINIMUM_VITEST_MAJOR = 4;
/** Deepest cited title path: enclosing `describe` titles plus the test title. */
export const NODE_TEST_TITLE_PATH_LIMIT = 16;
/** Other test files Vitest's substring file filter may add before Codebook refuses instead of excluding each one. */
export const NODE_TEST_EXCLUDED_FILE_LIMIT = 64;
/** Bound for one `vitest list --filesOnly` preflight; the whole attach phase is bounded separately. */
export const VITEST_FILE_LIST_TIMEOUT_MS = 30_000;
/** Grace period for releasing the owned Vitest listing group before escalating to SIGKILL. */
export const VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS = 1_000;
/** Error text kept from a failed Vitest preflight. */
export const VITEST_LIST_ERROR_LIMIT_CHARS = 2_048;
/** Largest Vitest JSON report read to confirm which test ran. */
export const VITEST_REPORT_LIMIT_BYTES = 8_388_608;
/** Wait for the owned test process to report its exit after its debugger session ended early. */
export const NODE_TEST_EXIT_GRACE_MS = 2_000;
/** Budget for each owned Node test phase: attach through the entry pause, reaching a declared stop while the test runs, and capturing it. */
export const NODE_TEST_ATTACH_TIMEOUT_MS = 45_000;
export const REPOSITORY_BROWSER_ACTION = 'repository-click';
export const REPOSITORY_CONFIG_VERSION = 1;
export const CROSS_RUNTIME_CONFIG_VERSION = 2;
export const CONFIGURED_STUDY_VERSION = 3;
export const CROSS_RUNTIME_STUDY_VERSION = 4;
export const CONFIGURED_STUDY_SUFFIX = '.study.v3.json';
export const CONFIGURED_STUDY_METADATA_SUFFIX = '.study.meta.v3.json';
// Highest existing version owns a logical study, including when its bytes are corrupt.
export const STUDY_STORAGE_FORMATS = [
  { version: CROSS_RUNTIME_STUDY_VERSION, format: 'v4', archiveSuffix: '.study.v4.json', metadataSuffix: '.study.meta.v4.json' },
  { version: CONFIGURED_STUDY_VERSION, format: 'v3', archiveSuffix: CONFIGURED_STUDY_SUFFIX, metadataSuffix: CONFIGURED_STUDY_METADATA_SUFFIX },
  { version: LEARNING_SCHEMA_VERSION_V2, format: 'v2', archiveSuffix: STUDY_V2_SUFFIX, metadataSuffix: STUDY_METADATA_V2_SUFFIX },
  { version: LEARNING_SCHEMA_VERSION, format: 'legacy-v1', archiveSuffix: '.study.json', metadataSuffix: undefined },
] as const;
export const CONFIGURED_OBSERVATION_LIMIT = 8;
export const CONFIGURED_CAPTURE_PHASES = ['before', 'paused-browser', 'after'] as const;
export const CROSS_RUNTIME_CAPTURE_PHASES = ['before', 'paused-browser', 'paused-server', 'after'] as const;
export const REPOSITORY_CONFIG_LIMIT_BYTES = 65_536;
export const REPOSITORY_SELECTOR_LIMIT_CHARS = 512;
export const REPOSITORY_CONDITION_LIMIT = 8;
export const REPOSITORY_ATTRIBUTE_LIMIT_CHARS = 64;
export const REPOSITORY_LITERAL_LIMIT_CHARS = 1_024;
export const REPOSITORY_INSPECTION_LIMIT = 10;
export const REPOSITORY_INSPECTION_TIMEOUT_MS = 1_000;
export const REPOSITORY_INSPECTION_PATH_LIMIT_CHARS = 128;
export const REPOSITORY_INSPECTION_SEGMENT_LIMIT = 4;
export const REPOSITORY_STORAGE_ENTRY_LIMIT = 16;
export const REPOSITORY_STORAGE_KEY_LIMIT_CHARS = 128;
export const REPOSITORY_STORAGE_VALUE_LIMIT_CHARS = 2_048;
export const REPOSITORY_STORAGE_LIMIT_BYTES = 16_384;
export const REPOSITORY_SETUP_TIMEOUT_MS = 90_000;
export const REPOSITORY_PAUSE_HOLD_TIMEOUT_MS = 300_000;
export const REPOSITORY_RUN_TIMEOUT_MS = 600_000;
export const REPOSITORY_RESERVED_INSPECTION_ROOTS = [
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield', 'NaN', 'Infinity',
] as const;
export const REPOSITORY_FORBIDDEN_INSPECTION_SEGMENTS = ['__proto__', 'prototype', 'constructor'] as const;
export const REPOSITORY_CAPTURED_TYPES = ['undefined', 'object', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function'] as const;
export { ACTIVE_TIMEOUT_MS, RUN_TIMEOUT_MS, HOLD_DURATION_MS, CONTROL_RESPONSE_LIMIT_MS } from './runtimeSupport/constants';
export const REPOSITORY_JAVASCRIPT_LIMIT_BYTES = 8_388_608;
export const REPOSITORY_CHUNK_LIMIT_BYTES = 33_554_432;
export const REPOSITORY_MAP_LIMIT_BYTES = 16_777_216;
export const REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT = 200_000;
export const REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES = 100_000;
export const REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS = 4_194_304;
export const REPOSITORY_BINDING_HINT_EDGE_LINES = 20;
export const REPOSITORY_BINDING_HINT_NEAR_LINES = 40;
export const SOURCE_MAP_VLQ_VALUE_MASK = 31;
export const SOURCE_MAP_VLQ_CONTINUATION_MASK = 32;
export const SOURCE_MAP_VLQ_SHIFT_BITS = 5;
export const SOURCE_MAP_VLQ_SIGN_DIVISOR = 2;
export const SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS = 1;
export const SOURCE_MAP_SOURCE_SEGMENT_FIELDS = 4;
export const SOURCE_MAP_NAMED_SEGMENT_FIELDS = 5;
export const REPOSITORY_DISCOVERY_LIMIT_BYTES = 134_217_728;
export const REPOSITORY_DISCOVERY_CANDIDATE_LIMIT = 2_048;
export const REPOSITORY_DISCOVERY_TIMEOUT_MS = 30_000;
export const REPOSITORY_APPLICATION_LOG_LIMIT_BYTES = 262_144;
export const REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS = 10_000;
export const REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT = 200;
export const REPOSITORY_STACK_FRAME_LIMIT = 10;

export const REPLAY_DEBUG_TYPE = 'codebook-replay';
export const REPLAY_DEBUG_THREAD_ID = 1;
export const REPLAY_DEBUG_MAX_FRAMES = 32;
export const REPLAY_DEBUG_MAX_SCOPES = 16;
export const REPLAY_DEBUG_MAX_VARIABLES = 2_000;
export const REPLAY_DEBUG_MAX_DEPTH = 5;
export const REPLAY_DEBUG_TEXT_LIMIT_CHARS = 4_096;
export const REPLAY_DEBUG_CAPTURE_TIMEOUT_MS = 5_000;
export const NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS = 1_500;
export const NODE_REPLAY_DEBUG_MAX_FRAMES = 8;
export const NODE_REPLAY_DEBUG_MAX_VARIABLES = 64;
export const NODE_REPLAY_DEBUG_MAX_DEPTH = 2;
export const REPOSITORY_ENTRY_PATH_LIMIT_CHARS = 2_048;
export const REPOSITORY_INPUT_LIMIT = 16;

/** Maximum UTF-8 payload per explicitly paged evidence read. */
export const RESOURCE_JSON_PAGE_BYTES = 4096;
