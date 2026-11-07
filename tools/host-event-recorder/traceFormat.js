'use strict'

/**
 * The pure part of the development-only host event recorder: the trace line format, the tab-group
 * snapshot, the sanitizer and the resume decision. It has no `vscode` import, so script tests load
 * it directly and the replay parser's cross-check test reads the file it writes.
 *
 * Called by `extension.js` while a take is recorded and by
 * `extension/scripts/sanitizeHostTrace.mjs` before a trace may enter the public repository.
 */

/**
 * The version of the line format; the replay parser (`extension/src/tests/utils/hostTraceReplay.ts`, the contract) refuses a header that names another.
 *
 * One format, written here and read there: a repository-relative `uri` is a plain string (`app/lib/data.ts`; a virtual document of the repository is `<scheme>:<file name>`), a tab input kind is one of `text`, `webview`, `diff`, `notebook`, `custom`, `terminal`, `unknown`, `tabsChanged` entries are `{ groupIndex, label, inputKind }`, `groupsChanged` entries are `{ groupIndex }` and every snapshot names its `activeGroupIndex`.
 */
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

/** URI schemes Codebook itself registers for documents of the repository: their path is never a local folder, so the file name is kept. */
const REPOSITORY_VIRTUAL_SCHEMES = ['codebook-source']

/** The tab input kinds the replay parser names, by the kind the recorder's plain input uses. */
const FROZEN_INPUT_KIND = { textDiff: 'diff', notebookDiff: 'diff' }

/**
 * Splits a URI given as `{ scheme, path }` or as a trace string into scheme and path.
 *
 * @param {{ scheme: string, path?: string } | string} uri - A raw URI object or an already written `uri` string.
 * @returns {{ scheme: string, path: string }} A string without a scheme of two or more letters is a `file` path (so `C:\` is a drive, not a scheme).
 */
function splitUri(uri) {
  if (typeof uri !== 'string')
    return {
      scheme: uri.scheme,
      path: typeof uri.path === 'string' ? uri.path : '',
    }
  const match = /^([A-Za-z][A-Za-z0-9+.-]+):(.*)$/s.exec(uri)
  return match
    ? { scheme: match[1], path: match[2] }
    : { scheme: 'file', path: uri }
}

/**
 * Sanitizes one URI for a public trace and writes it as the format's `uri` string.
 *
 * A `file` URI inside a workspace folder keeps only its repository-relative path; a virtual document of the repository keeps `<scheme>:<file name>`; a relative path of another scheme (`untitled:Untitled-1`) stays; every other URI is dropped. The function is idempotent, so a trace that was already sanitized passes through unchanged.
 *
 * @param {{ scheme: string, path?: string } | string | null | undefined} uri - A raw URI as `{ scheme, path }` or an already written `uri` string.
 * @param {{ workspaceFolders: { scheme: string, path: string }[] }} context - The workspace folders of the repository.
 * @returns {string | undefined} The `uri` string, or `undefined` for no URI or one that reveals more than the repository.
 * @example
 * sanitizeUri({ scheme: 'file', path: '/repo/src/a.ts' }, { workspaceFolders: [{ scheme: 'file', path: '/repo' }] })
 * // => 'src/a.ts'
 */
function sanitizeUri(uri, context) {
  if (!uri) return undefined
  const { scheme, path } = splitUri(uri)
  if (!path) return undefined
  // Already relative: nothing to remove.
  if (!isAbsolutePath(path))
    return scheme === 'file' ? path : `${scheme}:${path}`
  if (scheme === 'file') {
    const normalized = normalizePath(path)
    for (const folder of context.workspaceFolders) {
      if (folder.scheme !== 'file') continue
      const root = normalizePath(folder.path)
      if (normalized === root) return '.'
      // Prefix match on a whole folder name, so /repo2 is not inside /repo.
      const prefix = root === '/' ? '/' : `${root}/`
      if (normalized.startsWith(prefix)) return normalized.slice(prefix.length)
    }
    return undefined
  }
  if (REPOSITORY_VIRTUAL_SCHEMES.includes(scheme))
    return `${scheme}:${path.split('/').at(-1)}`
  return undefined
}

/**
 * Drops the keys whose value is `null` or `undefined`, so a payload never writes an empty field.
 *
 * @param {object} fields - A plain object.
 * @returns {object} A copy without nullish values.
 */
function withoutNullish(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value != null),
  )
}

/**
 * Sanitizes one tab input (`kind` plus its URIs as strings), keeping a webview's `viewType`.
 *
 * @param {object} input - A plain tab input: `{ kind, uri?, original?, modified?, viewType? }` with raw or written URIs.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The input with the replay parser's kind and every URI sanitized to a string (a URI that reveals more than the repository is left out).
 */
function sanitizeInput(input, context) {
  const result = { ...input, kind: FROZEN_INPUT_KIND[input.kind] ?? input.kind }
  for (const key of ['uri', 'original', 'modified'])
    if (key in result) result[key] = sanitizeUri(result[key], context)
  return withoutNullish(result)
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
  // A resource the sanitizer dropped was outside the repository; its label can carry a file name or a user's folder, so the kind says what is open without naming it.
  const isOutsideRepository = ['uri', 'original', 'modified'].some(
    (key) => tab.input[key] && input[key] === undefined,
  )
  return { ...tab, label: isOutsideRepository ? input.kind : tab.label, input }
}

/**
 * Builds the full `tabGroups` snapshot payload: every group in order with its tabs and the active group's index.
 *
 * @param {{ viewColumn: number, isActive: boolean, tabs: object[] }[]} groups - Plain tab groups.
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {{ groups: object[], activeGroupIndex: number }} The sanitized snapshot; `activeGroupIndex` is -1 when no group is active.
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
    activeGroupIndex: groups.findIndex((group) => group.isActive),
  }
}

/**
 * Sanitizes the payload of one event according to its kind and writes it in the format's shape.
 *
 * A group event keeps only `groupIndex`: a full group object would carry its tabs' inputs and their absolute paths (the take of Cycle 0094 leaked `/Users/...` that way).
 *
 * @param {string} kind - One of {@link EVENT_KINDS}.
 * @param {object} data - The raw payload (or an already written one).
 * @param {{ workspaceFolders: object[] }} context - The workspace folders of the repository.
 * @returns {object} The payload with URIs and tab labels sanitized.
 */
function sanitizeEventData(kind, data, context) {
  const sanitizeEditor = (editor) =>
    withoutNullish({
      ...editor,
      uri: sanitizeUri(editor.uri, context),
    })
  // A raw tab entry carries its plain tab; an already written one carries label and inputKind.
  const tabEntries = (entries) =>
    entries.map((entry) => {
      if (!entry.tab)
        return {
          groupIndex: entry.groupIndex,
          label: entry.label,
          inputKind: entry.inputKind,
        }
      const tab = sanitizeTab(entry.tab, context)
      return {
        groupIndex: entry.groupIndex,
        label: tab.label,
        inputKind: tab.input.kind,
      }
    })
  const groupEntries = (entries) =>
    entries.map((entry) => ({ groupIndex: entry.groupIndex }))
  switch (kind) {
    case 'tabGroups':
      return snapshotTabGroups(data.groups, context)
    case 'tabsChanged':
      return {
        opened: tabEntries(data.opened),
        closed: tabEntries(data.closed),
        changed: tabEntries(data.changed),
      }
    case 'groupsChanged':
      return {
        opened: groupEntries(data.opened),
        closed: groupEntries(data.closed),
        changed: groupEntries(data.changed),
      }
    case 'activeTextEditor':
    case 'selection':
      return sanitizeEditor(data)
    case 'visibleTextEditors':
      return data.map(sanitizeEditor)
    default:
      // editorLayout (the layout itself) and reload carry numbers only.
      return data
  }
}

/**
 * Reads the host's own version from the text of its `product.json`.
 *
 * `vscode.version` is the VS Code API version (Cursor 3.29.9 reports 1.128.0), so the header takes the product version instead. Called by `extension.js` when a take starts.
 *
 * @param {string | undefined} productJsonText - The text of `<vscode.env.appRoot>/product.json`, or `undefined` when it could not be read.
 * @returns {string} The `version` field, or `unknown` for missing, malformed or version-less text.
 * @example
 * readHostVersion('{"version":"3.29.12"}') // => '3.29.12'
 */
function readHostVersion(productJsonText) {
  if (!productJsonText) return 'unknown'
  try {
    const { version } = JSON.parse(productJsonText)
    return typeof version === 'string' && version ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Builds the first line of a take.
 *
 * @param {{ host: string, hostVersion: string, hostApiVersion: string, os: string, sequence: string, codebookVersion: string, recorderVersion: string, startedAt: string }} fields - Where and when the take was recorded; `hostApiVersion` is `vscode.version`, `hostVersion` the product version ({@link readHostVersion}).
 * @returns {object} The header object (serialize it with {@link serializeLine}).
 */
function buildHeader(fields) {
  return {
    type: 'header',
    formatVersion: TRACE_FORMAT_VERSION,
    host: fields.host,
    hostVersion: fields.hostVersion,
    hostApiVersion: fields.hostApiVersion,
    os: fields.os,
    sequence: fields.sequence,
    codebookVersion: fields.codebookVersion,
    recorderVersion: fields.recorderVersion,
    startedAt: fields.startedAt,
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
 * @returns {{ lines: (kind: string, data: object | unknown[], tMs: number, snapshot: { groups: object[] }) => string[], nextSeq: () => number }} The writer.
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
  readHostVersion,
  sanitizeTab,
  sanitizeTraceLine,
  sanitizeUri,
  serializeLine,
  snapshotTabGroups,
}
