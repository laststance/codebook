'use strict'

/**
 * The pure part of the development-only host event recorder: the trace line format, the tab-group
 * snapshot, the sanitizer and the resume decision. It has no `vscode` import, so script tests load
 * it directly and the replay parser's cross-check test reads the file it writes.
 *
 * Called by `extension.js` while a take is recorded and by
 * `extension/scripts/sanitizeHostTrace.mjs` before a trace may enter the public repository.
 */

/** The version of the line format; the replay parser refuses a header that names another. */
const TRACE_FORMAT_VERSION = 1

/** Every event kind a trace line may carry; the replay parser keeps its own list, pinned by a cross-check test. */
const EVENT_KINDS = [
  'tabGroups',
  'tabsChanged',
  'groupsChanged',
  'activeTextEditor',
  'visibleTextEditors',
  'selection',
  'editorLayout',
  'reload',
]

/**
 * Normalizes a file-system path of a URI for prefix comparison (Windows drive letters are case-insensitive).
 *
 * @param {string} path - The `path` part of a URI, with forward slashes.
 * @returns {string} The path without a trailing slash and with a lower-case drive letter.
 */
function normalizePath(path) {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  return trimmed.replace(
    /^\/([A-Za-z]):/,
    (_, drive) => `/${drive.toLowerCase()}:`,
  )
}

/**
 * Says whether a path is absolute in POSIX, Windows-drive or home-relative form.
 *
 * @param {string} path - A path or URI path.
 * @returns {boolean} `true` for a path that starts at a root.
 */
function isAbsolutePath(path) {
  return /^(?:\/|[A-Za-z]:[\\/]|~[\\/])/.test(path)
}

/**
 * Sanitizes one URI for a public trace.
 *
 * A `file` URI inside a workspace folder keeps only its repository-relative path; every other URI
 * keeps only its scheme. The function is idempotent, so a trace that was already sanitized passes
 * through unchanged.
 *
 * @param {{ scheme: string, path?: string } | null | undefined} uri - A URI as `{ scheme, path }`.
 * @param {{ workspaceFolders: { scheme: string, path: string }[] }} context - The workspace folders of the repository.
 * @returns {{ scheme: string, path?: string } | null} `{ scheme, path }` for a file inside the repository, `{ scheme }` otherwise, `null` for no URI.
 * @example
 * sanitizeUri({ scheme: 'file', path: '/repo/src/a.ts' }, { workspaceFolders: [{ scheme: 'file', path: '/repo' }] })
 * // => { scheme: 'file', path: 'src/a.ts' }
 */
function sanitizeUri(uri, context) {
  if (!uri) return null
  const path = typeof uri.path === 'string' ? uri.path : ''
  // Already relative or scheme-only: nothing to remove.
  if (!path || !isAbsolutePath(path))
    return path ? { scheme: uri.scheme, path } : { scheme: uri.scheme }
  if (uri.scheme === 'file') {
    const normalized = normalizePath(path)
    for (const folder of context.workspaceFolders) {
      if (folder.scheme !== 'file') continue
      const root = normalizePath(folder.path)
      if (normalized === root) return { scheme: 'file', path: '.' }
      // Prefix match on a whole folder name, so /repo2 is not inside /repo.
      const prefix = root === '/' ? '/' : `${root}/`
      if (normalized.startsWith(prefix))
        return { scheme: 'file', path: normalized.slice(prefix.length) }
    }
  }
  return { scheme: uri.scheme }
}

/**
 * Sanitizes one tab input (`kind` plus its URIs), keeping a webview's `viewType`.
 *
 * @param {object} input - A plain tab input: `{ kind, uri?, original?, modified?, viewType? }`.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The input with every URI sanitized.
 */
function sanitizeInput(input, context) {
  const result = { ...input }
  for (const key of ['uri', 'original', 'modified'])
    if (key in result) result[key] = sanitizeUri(result[key], context)
  return result
}

/**
 * Says whether a tab input points at a resource outside the repository.
 *
 * @param {object} input - A sanitized tab input.
 * @returns {boolean} `true` when some URI of the input kept only its scheme.
 */
function hasResourceOutsideRepository(input) {
  return ['uri', 'original', 'modified'].some(
    (key) => input[key] && input[key].path === undefined,
  )
}

/**
 * Sanitizes one tab: its input and, for a tab whose resource is outside the repository, its label.
 *
 * @param {{ label: string, isActive?: boolean, isPreview?: boolean, input: object }} tab - A plain tab.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The tab with sanitized input; the label becomes the input kind when the resource is outside the repository.
 * @example
 * sanitizeTab({ label: 'secret.ts', input: { kind: 'text', uri: { scheme: 'file', path: '/other/secret.ts' } } }, ctx).label // => 'text'
 */
function sanitizeTab(tab, context) {
  const input = sanitizeInput(tab.input, context)
  // A label can carry a file name or a user's folder; the kind says what is open without naming it.
  const label = hasResourceOutsideRepository(input) ? input.kind : tab.label
  return { ...tab, label, input }
}

/**
 * Builds the full `tabGroups` snapshot payload: every group in order with its tabs.
 *
 * @param {{ viewColumn: number, isActive: boolean, tabs: object[] }[]} groups - Plain tab groups.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {{ groups: object[] }} The sanitized snapshot.
 */
function snapshotTabGroups(groups, context) {
  return {
    groups: groups.map((group) => ({
      viewColumn: group.viewColumn,
      isActive: group.isActive,
      tabs: group.tabs.map((tab) =>
        sanitizeTab(
          {
            label: tab.label,
            input: tab.input,
            isActive: tab.isActive,
            isPreview: tab.isPreview,
          },
          context,
        ),
      ),
    })),
  }
}

/**
 * Sanitizes the payload of one event according to its kind.
 *
 * @param {string} kind - One of {@link EVENT_KINDS}.
 * @param {object} data - The raw payload.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The payload with URIs and tab labels sanitized.
 */
function sanitizeEventData(kind, data, context) {
  const sanitizeTabs = (entries) =>
    entries.map((entry) => ({ ...entry, tab: sanitizeTab(entry.tab, context) }))
  switch (kind) {
    case 'tabGroups':
      return snapshotTabGroups(data.groups, context)
    case 'tabsChanged':
      return {
        opened: sanitizeTabs(data.opened),
        closed: sanitizeTabs(data.closed),
        changed: sanitizeTabs(data.changed),
      }
    case 'groupsChanged':
      return {
        opened: data.opened.map((group) => ({ ...group })),
        closed: data.closed.map((group) => ({ ...group })),
        changed: data.changed.map((group) => ({ ...group })),
      }
    case 'activeTextEditor':
    case 'selection':
      return { ...data, uri: sanitizeUri(data.uri, context) }
    case 'visibleTextEditors':
      return {
        editors: data.editors.map((editor) => ({
          ...editor,
          uri: sanitizeUri(editor.uri, context),
        })),
      }
    default:
      // editorLayout and reload carry numbers only.
      return data
  }
}

/**
 * Builds the first line of a take.
 *
 * @param {{ host: string, hostVersion: string, os: string, sequence: string, codebookVersion: string, recorderVersion: string, startTime: string }} fields - Where and when the take was recorded.
 * @returns {object} The header object (serialize it with {@link serializeLine}).
 */
function buildHeader(fields) {
  return {
    type: 'header',
    formatVersion: TRACE_FORMAT_VERSION,
    host: fields.host,
    hostVersion: fields.hostVersion,
    os: fields.os,
    sequence: fields.sequence,
    codebookVersion: fields.codebookVersion,
    recorderVersion: fields.recorderVersion,
    startTime: fields.startTime,
  }
}

/**
 * Serializes one line object as JSON followed by a newline.
 *
 * @param {object} line - A header or event object.
 * @returns {string} One JSON line ending with a newline.
 */
function serializeLine(line) {
  return `${JSON.stringify(line)}\n`
}

/**
 * Creates the event writer of one take: it numbers events and writes a full snapshot with every one.
 *
 * Called by `extension.js` when a take starts or resumes, and by the format tests.
 *
 * @param {{ context: { workspaceFolders: object[] }, firstSeq?: number }} options - The sanitizing context and the first `seq` (greater than 1 when a take resumes).
 * @returns {{ lines: (kind: string, data: object, tMs: number, snapshot: { groups: object[] }) => string[], nextSeq: () => number }} The writer.
 * @example
 * const writer = createEventWriter({ context })
 * writer.lines('activeTextEditor', { uri, viewColumn: 1 }, 120, snapshot) // => [eventLine, snapshotLine]
 */
function createEventWriter({ context, firstSeq = 1 }) {
  let seq = firstSeq
  return {
    lines(kind, data, tMs, snapshot) {
      const event = (eventKind, payload) =>
        serializeLine({ seq: seq++, tMs, kind: eventKind, data: payload })
      if (kind === 'tabGroups')
        return [event(kind, sanitizeEventData(kind, data, context))]
      // The snapshot follows its event with the same tMs, so equal tMs keep seq order.
      return [
        event(kind, sanitizeEventData(kind, data, context)),
        event('tabGroups', snapshotTabGroups(snapshot.groups, context)),
      ]
    },
    nextSeq: () => seq,
  }
}

/**
 * Decides what the recorder does on activation, from the open-take mark in its global state.
 *
 * Called by `extension.js` at activation (after a Reload Window the mark is still there).
 *
 * @param {{ mark: { takeId: string, file: string, sequence: string, lastSeq: number, startMs: number } | null | undefined, fileExists: boolean, lastLine: { seq: number, tMs: number } | null, nowMs: number }} input - The stored mark, whether its file exists, the last parsed line of that file and the current wall clock.
 * @returns {{ action: 'none' } | { action: 'fresh', sequence: string, notice: string } | { action: 'resume', file: string, nextSeq: number, startMs: number, reload: { unrecordedFromMs: number, unrecordedToMs: number, unrecordedMs: number } }} What to do.
 * @example
 * decideResume({ mark: undefined, fileExists: false, lastLine: null, nowMs: 5 }) // => { action: 'none' }
 */
function decideResume({ mark, fileExists, lastLine, nowMs }) {
  if (!mark) return { action: 'none' }
  if (!fileExists)
    return {
      action: 'fresh',
      sequence: mark.sequence,
      notice: `The open take file ${mark.file} is missing; a new take of "${mark.sequence}" starts.`,
    }
  // The file is authoritative: the mark may lag by the last few lines.
  const lastSeq = Math.max(mark.lastSeq, lastLine ? lastLine.seq : 0)
  const fromMs = lastLine ? lastLine.tMs : 0
  const toMs = Math.max(fromMs, nowMs - mark.startMs)
  return {
    action: 'resume',
    file: mark.file,
    nextSeq: lastSeq + 1,
    startMs: mark.startMs,
    reload: {
      unrecordedFromMs: fromMs,
      unrecordedToMs: toMs,
      unrecordedMs: toMs - fromMs,
    },
  }
}

/**
 * Re-applies the sanitizer to one parsed trace line of any kind, for a take about to enter the repository.
 *
 * @param {object} line - A parsed header or event line.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The line with URIs and tab labels sanitized; a header passes unchanged.
 */
function sanitizeTraceLine(line, context) {
  if (line.type === 'header' || !EVENT_KINDS.includes(line.kind)) return line
  return { ...line, data: sanitizeEventData(line.kind, line.data, context) }
}

module.exports = {
  EVENT_KINDS,
  TRACE_FORMAT_VERSION,
  buildHeader,
  createEventWriter,
  decideResume,
  isAbsolutePath,
  sanitizeTab,
  sanitizeTraceLine,
  sanitizeUri,
  serializeLine,
  snapshotTabGroups,
}
