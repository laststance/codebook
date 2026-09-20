export const API_VERSION = '1.5';
export const EXTENSION_VERSION = '0.2.0';
export const DEMO_ASSET_PATHS = ['fixture/server.mts', 'fixture/client.mts', 'fixture/constants.mts', 'fixture/index.html',
  'build/server.mjs', 'build/server.mjs.map', 'build/client.mjs', 'build/client.mjs.map', 'build/constants.mjs', 'build/constants.mjs.map'] as const;
export const CONFIGURED_MINIMUM_EXTENSION_VERSION = '0.2.0';
export const PROFILE_ID = 'paired-cart-demo';
export const LOOPBACK_ADDRESS = '127.0.0.1';
export const DYNAMIC_PORT = 0;
export const TOKEN_BYTES = 32;
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
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
export const VALUE_PATHS = ['operationId', 'cartId', 'productId', 'price', 'cartCount', 'admittedCount'] as const;
// Keep version-1 archive paths fixed while the live API also accepts actual order facts.
export const CAPTURED_VALUE_PATHS = [...VALUE_PATHS, 'cartOperationId', 'orderId', 'total', 'orderCount'] as const;
export const CAPTURE_PHASES = ['before', 'paused-server', 'paused-browser', 'after'] as const;
export const LEARNING_SCHEMA_VERSION = 1;
export const LEARNING_SCHEMA_VERSION_V2 = 2;
export const LEARNING_SCHEMA_VERSION_V3 = 3;
export const LEARNING_SCHEMA_VERSION_V4 = 4;
export const PROGRESS_V2_FILE = 'progress.v2.json';
export const PROGRESS_V3_FILE = 'progress.v3.json';
export const PROGRESS_V4_FILE = 'progress.v4.json';
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
export const MAX_LIBRARY_FILES = 16;
export const MAX_SOURCE_DOCUMENTS = 34;
export const STUDY_REFRESH_INTERVAL_MS = 250;
export const STUDY_EDITOR_GROUP_COUNT = 3;
export const HORIZONTAL_EDITOR_ORIENTATION = 0;
export const PRESENTATION_PREFERENCE_KEY = 'codebook.presentation.v1';
export const PRESENTATION_PREFERENCE_VERSION = 1;
export const PRESENTATION_READY_TIMEOUT_MS = 5_000;
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
export const CONFIGURED_RECORDING_DIRECTORY = 'recordings.v2';
export const RECORDING_STORAGE_FORMATS = [
  { version: CONFIGURED_RECORDING_VERSION, directory: CONFIGURED_RECORDING_DIRECTORY },
  { version: RECORDING_VERSION, directory: RECORDING_DIRECTORY },
] as const;
export const RECORDING_HEADER_FILE = 'header.json';
export const RECORDING_JOURNAL_FILE = 'frames.jsonl';
export const RECORDING_SEAL_FILE = 'sealed.json';
export const RECORDING_CONTEXT_FILE = 'context.json';
export const MAX_RECORDINGS = 16;
export const MAX_RECORDING_FRAMES = 6_000;
export const MAX_RECORDING_PNG_BYTES = 67_108_864;
export const MAX_RECORDING_PENDING_BYTES = 8_388_608;
export const MAX_RECORDING_JOURNAL_BYTES = 2_097_152;
export const RECORDING_TERMINAL_RESERVE_BYTES = 16_384;
export const RECORDING_REASON_LIMIT_CHARS = 1_024;
export const MAX_RECORDING_CONTEXT_BYTES = 8_388_608;
export const MAX_RECORDING_HEADER_BYTES = 65_536;
export const MAX_RECORDING_TOTAL_BYTES = 100_663_296;
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
export const REPOSITORY_GIT_TIMEOUT_MS = 5_000;
export const REPOSITORY_GIT_LIMIT_BYTES = 2_097_152;
export const REPOSITORY_MAX_TRACKED_FILES = 5_000;
export const REPOSITORY_SOURCE_PAGE_SIZE = 100;
export const REPOSITORY_PATH_LIMIT_CHARS = 512;
export const REPOSITORY_SOURCE_LIMIT_BYTES = 262_144;
export const REPOSITORY_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.md', '.mdx', '.css', '.html', '.json', '.jsonc'] as const;
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
export const BOOK_MAX_FILES = 16;
export const BOOK_REVISION_LIMIT_BYTES = 4_194_304;
export const BOOK_FILE_LIMIT_BYTES = 8_388_608;
export const BOOK_PREPARE_TIMEOUT_MS = 20_000;
export const BOOK_SOURCE_CONCURRENCY = 4;
export const REPOSITORY_BROWSER_PROFILE = 'repository-browser';
export const REPOSITORY_BROWSER_ACTION = 'repository-click';
export const REPOSITORY_CONFIG_VERSION = 1;
export const CONFIGURED_STUDY_VERSION = 3;
export const CONFIGURED_STUDY_SUFFIX = '.study.v3.json';
export const CONFIGURED_STUDY_METADATA_SUFFIX = '.study.meta.v3.json';
// Highest existing version owns a logical study, including when its bytes are corrupt.
export const STUDY_STORAGE_FORMATS = [
  { version: CONFIGURED_STUDY_VERSION, format: 'v3', archiveSuffix: CONFIGURED_STUDY_SUFFIX, metadataSuffix: CONFIGURED_STUDY_METADATA_SUFFIX },
  { version: LEARNING_SCHEMA_VERSION_V2, format: 'v2', archiveSuffix: STUDY_V2_SUFFIX, metadataSuffix: STUDY_METADATA_V2_SUFFIX },
  { version: LEARNING_SCHEMA_VERSION, format: 'legacy-v1', archiveSuffix: '.study.json', metadataSuffix: undefined },
] as const;
export const CONFIGURED_OBSERVATION_LIMIT = 1;
export const CONFIGURED_CAPTURE_PHASES = ['before', 'paused-browser', 'after'] as const;
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
export { ACTIVE_TIMEOUT_MS, RUN_TIMEOUT_MS, HOLD_DURATION_MS, CONTROL_RESPONSE_LIMIT_MS } from 'codebook-cycle-0001/dist/constants';
export const REPOSITORY_JAVASCRIPT_LIMIT_BYTES = 8_388_608;
export const REPOSITORY_MAP_LIMIT_BYTES = 16_777_216;
export const REPOSITORY_DISCOVERY_LIMIT_BYTES = 134_217_728;
export const REPOSITORY_DISCOVERY_CANDIDATE_LIMIT = 2_048;
export const REPOSITORY_DISCOVERY_TIMEOUT_MS = 30_000;
export const REPOSITORY_APPLICATION_LOG_LIMIT_BYTES = 262_144;
export const REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS = 10_000;
export const REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT = 200;
export const REPOSITORY_STACK_FRAME_LIMIT = 10;
