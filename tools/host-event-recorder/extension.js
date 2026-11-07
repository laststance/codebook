'use strict'

/**
 * Development-only recorder of the editor host's tab-group events, for Codebook's host-order replay
 * fixtures. It uses public VS Code APIs only and is never part of the Codebook VSIX.
 *
 * A take is a JSONL file under `.codebook-host-traces/` in the first workspace folder; every line
 * is appended the moment it happens, and an open take survives Reload Window (it is marked in the
 * recorder's global state and resumed at activation).
 */

const fs = require('node:fs')
const path = require('node:path')

const vscode = require('vscode')

const {
  buildHeader,
  createEventWriter,
  decideResume,
  readHostVersion,
  serializeLine,
} = require('./traceFormat')

/** The global-state key holding the mark of the open take. */
const OPEN_TAKE_KEY = 'codebookHostRecorder.openTake'
/** The folder of take files, inside the workspace folder; private output, never committed raw. */
const TAKE_FOLDER = '.codebook-host-traces'
/** The shortest time between two `vscode.getEditorLayout` reads. */
const LAYOUT_READ_INTERVAL_MS = 50

/** The open take, or `undefined`. */
let take

/**
 * Turns a VS Code URI into the plain `{ scheme, path }` the format works on.
 *
 * @param {import('vscode').Uri | undefined} uri - A URI, if the input has one.
 * @returns {{ scheme: string, path: string } | null} The plain URI.
 */
function plainUri(uri) {
  return uri ? { scheme: uri.scheme, path: uri.path } : null
}

/**
 * Turns a tab's input into the plain `{ kind, ... }` object of the format.
 *
 * @param {unknown} input - A `TabInput*` instance or `undefined`.
 * @returns {object} The plain input with its kind, URIs and webview `viewType`.
 */
function plainInput(input) {
  if (input instanceof vscode.TabInputText)
    return { kind: 'text', uri: plainUri(input.uri) }
  if (input instanceof vscode.TabInputTextDiff)
    return {
      kind: 'textDiff',
      original: plainUri(input.original),
      modified: plainUri(input.modified),
    }
  if (input instanceof vscode.TabInputCustom)
    return {
      kind: 'custom',
      uri: plainUri(input.uri),
      viewType: input.viewType,
    }
  if (input instanceof vscode.TabInputWebview)
    return { kind: 'webview', viewType: input.viewType }
  if (input instanceof vscode.TabInputNotebook)
    return {
      kind: 'notebook',
      uri: plainUri(input.uri),
      notebookType: input.notebookType,
    }
  if (input instanceof vscode.TabInputNotebookDiff)
    return {
      kind: 'notebookDiff',
      original: plainUri(input.original),
      modified: plainUri(input.modified),
    }
  if (input instanceof vscode.TabInputTerminal) return { kind: 'terminal' }
  return { kind: 'unknown' }
}

/**
 * Turns one VS Code tab into the plain tab of the format.
 *
 * @param {import('vscode').Tab} tab - A tab of a tab group.
 * @returns {object} The plain tab.
 */
function plainTab(tab) {
  return {
    label: tab.label,
    isActive: tab.isActive,
    isPreview: tab.isPreview,
    input: plainInput(tab.input),
  }
}

/**
 * Turns one VS Code tab group into the plain group of the format.
 *
 * @param {import('vscode').TabGroup} group - A tab group.
 * @returns {object} The plain group with its tabs.
 */
function plainGroup(group) {
  return {
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    tabs: group.tabs.map(plainTab),
  }
}

/** @returns {{ workspaceFolders: { scheme: string, path: string }[] }} The sanitizing context: every workspace folder. */
function sanitizeContext() {
  return {
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => ({ scheme: folder.uri.scheme, path: folder.uri.path }),
    ),
  }
}

/**
 * Reads the host's own version from its `product.json` (see {@link readHostVersion}).
 *
 * @returns {string} The product version, or `unknown` when `product.json` cannot be read.
 */
function readProductVersion() {
  try {
    return readHostVersion(
      fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
    )
  } catch {
    return 'unknown'
  }
}

/** @returns {{ groups: object[] }} The current tab groups as plain groups. */
function currentGroups() {
  return { groups: vscode.window.tabGroups.all.map(plainGroup) }
}

/**
 * Appends lines to the take file at once (no buffering) and keeps the global-state mark current.
 *
 * @param {string[]} lines - Serialized lines.
 */
function append(lines) {
  fs.appendFileSync(take.file, lines.join(''))
  take.state.update(OPEN_TAKE_KEY, {
    takeId: take.id,
    file: take.file,
    sequence: take.sequence,
    lastSeq: take.writer.nextSeq() - 1,
    startMs: take.startMs,
  })
}

/**
 * Records one event and a full snapshot of the tab groups with it.
 *
 * @param {string} kind - An event kind of the format.
 * @param {object} data - The raw payload (sanitized by the writer).
 */
function record(kind, data) {
  if (!take) return
  append(
    take.writer.lines(kind, data, Date.now() - take.startMs, currentGroups()),
  )
}

/**
 * Reads the editor layout and records it; called after a batch of events and by stop.
 *
 * @returns {Promise<void>} Resolves when the layout line is written.
 */
async function readLayout() {
  take.lastLayoutAt = Date.now()
  const layout = await vscode.commands.executeCommand('vscode.getEditorLayout')
  record('editorLayout', layout)
}

/**
 * Schedules a layout read after the current event batch, at most every 50 ms.
 */
function scheduleLayout() {
  if (!take || take.layoutTimer) return
  const wait = Math.max(
    0,
    LAYOUT_READ_INTERVAL_MS - (Date.now() - take.lastLayoutAt),
  )
  // A zero wait still defers to a timer so one batch of events yields one read.
  take.layoutTimer = setTimeout(() => {
    const current = take
    if (!current) return
    current.layoutTimer = undefined
    const pending = readLayout().finally(() => current.pending.delete(pending))
    current.pending.add(pending)
  }, wait)
}

/**
 * Records an event, then schedules the layout read that follows every batch.
 *
 * @param {string} kind - An event kind of the format.
 * @param {object} data - The raw payload.
 */
function recordBatch(kind, data) {
  record(kind, data)
  scheduleLayout()
}

/**
 * Subscribes to the five public events the recorder observes.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context that owns the subscriptions.
 */
function subscribe(context) {
  // A group's position in `tabGroups.all` at the event; -1 for a group that is already closed.
  const groupIndexOf = (group) => vscode.window.tabGroups.all.indexOf(group)
  const tabEntries = (tabs) =>
    tabs.map((tab) => ({
      groupIndex: groupIndexOf(tab.group),
      tab: plainTab(tab),
    }))
  const groupEntries = (groups) =>
    groups.map((group) => ({ groupIndex: groupIndexOf(group) }))
  const editorFields = (editor) => ({
    uri: plainUri(editor.document.uri),
    viewColumn: editor.viewColumn ?? null,
  })
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) =>
      recordBatch('tabsChanged', {
        opened: tabEntries(event.opened),
        closed: tabEntries(event.closed),
        changed: tabEntries(event.changed),
      }),
    ),
    vscode.window.tabGroups.onDidChangeTabGroups((event) =>
      recordBatch('groupsChanged', {
        opened: groupEntries(event.opened),
        closed: groupEntries(event.closed),
        changed: groupEntries(event.changed),
      }),
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      recordBatch('activeTextEditor', editor ? editorFields(editor) : {}),
    ),
    vscode.window.onDidChangeVisibleTextEditors((editors) =>
      recordBatch('visibleTextEditors', editors.map(editorFields)),
    ),
    vscode.window.onDidChangeTextEditorSelection((event) =>
      recordBatch('selection', {
        ...editorFields(event.textEditor),
        selectionKind: event.kind ?? null,
        selections: event.selections.map((selection) => ({
          anchor: {
            line: selection.anchor.line,
            character: selection.anchor.character,
          },
          active: {
            line: selection.active.line,
            character: selection.active.character,
          },
        })),
      }),
    ),
  )
}

/**
 * Builds the take-file name from the sequence, host, host version and a timestamp.
 *
 * @param {string} sequence - The sequence name the user typed.
 * @param {Date} now - The start time.
 * @returns {string} A file name safe on every system.
 */
function takeFileName(sequence, now) {
  const safe = (text) => text.replace(/[^A-Za-z0-9._-]+/g, '-')
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `${safe(sequence)}-${safe(vscode.env.appName)}-${safe(readProductVersion())}-${stamp}.jsonl`
}

/**
 * Starts a take: writes its header, an initial snapshot and layout, and marks it open.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 * @param {string} sequence - The sequence name.
 */
async function startTake(context, sequence) {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('Open a workspace folder first.')
  const now = new Date()
  const directory = path.join(folder.uri.fsPath, TAKE_FOLDER)
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, takeFileName(sequence, now))
  const codebook = vscode.extensions.getExtension('laststance.codebook')
  fs.writeFileSync(
    file,
    serializeLine(
      buildHeader({
        host: vscode.env.appName,
        hostVersion: readProductVersion(),
        hostApiVersion: vscode.version,
        os: process.platform,
        sequence,
        codebookVersion: codebook?.packageJSON.version ?? 'unknown',
        recorderVersion: context.extension.packageJSON.version,
        startedAt: now.toISOString(),
      }),
    ),
  )
  take = openTake(context, {
    id: `${now.getTime()}`,
    file,
    sequence,
    startMs: now.getTime(),
    firstSeq: 1,
  })
  record('tabGroups', currentGroups())
  await readLayout()
}

/**
 * Creates the in-memory state of an open take (new or resumed).
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 * @param {{ id: string, file: string, sequence: string, startMs: number, firstSeq: number }} fields - The take's identity.
 * @returns {object} The take state.
 */
function openTake(context, fields) {
  return {
    ...fields,
    state: context.globalState,
    writer: createEventWriter({
      context: sanitizeContext(),
      firstSeq: fields.firstSeq,
    }),
    lastLayoutAt: 0,
    layoutTimer: undefined,
    pending: new Set(),
  }
}

/**
 * Reads the last parsable event line of a take file.
 *
 * @param {string} file - A take file.
 * @returns {{ seq: number, tMs: number } | null} The last event line's `seq` and `tMs`, or `null`.
 */
function readLastLine(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index])
      if (typeof parsed.seq === 'number') return parsed
    } catch {
      // A line cut by the reload: use the one before.
    }
  }
  return null
}

/**
 * Resumes (or restarts) the open take after activation, e.g. after Reload Window.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 */
async function resumeIfMarked(context) {
  const mark = context.globalState.get(OPEN_TAKE_KEY)
  const exists = mark ? fs.existsSync(mark.file) : false
  const decision = decideResume({
    mark,
    fileExists: exists,
    lastLine: exists ? readLastLine(mark.file) : null,
    nowMs: Date.now(),
  })
  if (decision.action === 'none') return
  if (decision.action === 'fresh') {
    await context.globalState.update(OPEN_TAKE_KEY, undefined)
    void vscode.window.showWarningMessage(decision.notice)
    await startTake(context, decision.sequence)
    return
  }
  take = openTake(context, {
    id: mark.takeId,
    file: mark.file,
    sequence: mark.sequence,
    startMs: decision.startMs,
    firstSeq: decision.nextSeq,
  })
  // Name the interval no event could be recorded in, then take a fresh snapshot.
  record('reload', decision.reload)
  record('tabGroups', currentGroups())
  scheduleLayout()
}

/**
 * Stops the open take: waits for pending layout reads, writes the final snapshot and clears the mark.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 * @returns {Promise<string | undefined>} The take file, or `undefined` when none was open.
 */
async function stopTake(context) {
  const current = take
  if (!current) return undefined
  if (current.layoutTimer) clearTimeout(current.layoutTimer)
  current.layoutTimer = undefined
  await Promise.all([...current.pending])
  record('tabGroups', currentGroups())
  await readLayout()
  take = undefined
  await context.globalState.update(OPEN_TAKE_KEY, undefined)
  return current.file
}

/**
 * Activates the recorder: registers both commands, subscribes to the events and resumes an open take.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 */
async function activate(context) {
  subscribe(context)
  context.subscriptions.push(
    vscode.commands.registerCommand('codebookHostRecorder.start', async () => {
      if (take) {
        void vscode.window.showWarningMessage(
          'A host event take is already recording; stop it first.',
        )
        return
      }
      const sequence = await vscode.window.showInputBox({
        prompt: 'Sequence name of this take (for example arrange-restore)',
        ignoreFocusOut: true,
      })
      if (!sequence) return
      await startTake(context, sequence)
      void vscode.window.showInformationMessage(
        `Recording host events to ${take.file}`,
      )
    }),
    vscode.commands.registerCommand('codebookHostRecorder.stop', async () => {
      const file = await stopTake(context)
      void vscode.window.showInformationMessage(
        file ? `Host event take saved: ${file}` : 'No host event take is open.',
      )
    }),
  )
  await resumeIfMarked(context)
}

module.exports = { activate, deactivate() {} }
