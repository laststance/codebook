'use strict'

/**
 * Development-only recorder of the editor host's tab-group events, for Codebook's host-order replay
 * fixtures. It uses public VS Code APIs only and is never part of the Codebook VSIX.
 *
 * A take is a JSONL file under `.codebook-host-traces/` in the first workspace folder; every line
 * is appended the moment it happens, and an open take survives Reload Window (it is marked in the
 * recorder's workspace state, so only the workspace that recorded it resumes it, and resumed at
 * activation).
 */

const fs = require('node:fs')
const path = require('node:path')

const vscode = require('vscode')

const {
  buildHeader,
  createEventWriter,
  decideResume,
  nameProblem,
  planTakeRepair,
  readHostVersion,
  serializeLine,
} = require('./traceFormat')

/** The workspace-state key holding the mark of the open take (workspace state, not global state: every window of the extension reads global state). */
const OPEN_TAKE_KEY = 'codebookHostRecorder.openTake'
/** The folder of take files, inside the workspace folder; private output, never committed raw. */
const TAKE_FOLDER = '.codebook-host-traces'
/** The shortest time between two `vscode.getEditorLayout` reads. */
const LAYOUT_READ_INTERVAL_MS = 50

/** The `.gitignore` written into a new take folder, so no repository can commit a raw take by accident. */
const TAKE_FOLDER_GITIGNORE = '*\n'

/** The open take, or `undefined`. */
let take

/** `true` while a start command waits for its sequence name or writes the take header. */
let isStarting = false

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
 * Shows a failed take write to the author, once per take; the take stays open.
 *
 * @param {unknown} error - What the write or the layout read threw.
 * @param {object | undefined} [target] - The take the failing write belongs to (the open take by default).
 */
function reportFailure(error, target = take) {
  if (!target || target.failureShown) return
  target.failureShown = true
  void vscode.window.showErrorMessage(
    `Host event recorder could not write ${target.file}: ${error instanceof Error ? error.message : String(error)}`,
  )
}

/**
 * Appends lines to the take file at once (no buffering) and keeps the workspace-state mark current.
 *
 * A failing write is shown ({@link reportFailure}) instead of thrown, so an editor listener never throws and no rejection goes unhandled.
 *
 * @param {string[]} lines - Serialized lines.
 * @param {object} target - The take the lines belong to (never looked up again, so a late write cannot reach a later take).
 */
function append(lines, target) {
  try {
    fs.appendFileSync(target.file, lines.join(''))
    Promise.resolve(
      target.state.update(OPEN_TAKE_KEY, {
        takeId: target.id,
        file: target.file,
        sequence: target.sequence,
        lastSeq: target.writer.nextSeq() - 1,
        startMs: target.startMs,
      }),
    ).catch((error) => reportFailure(error, target))
  } catch (error) {
    reportFailure(error, target)
  }
}

/**
 * Writes one event and a full snapshot of the tab groups with it into a given take.
 *
 * @param {object} target - The take to write into.
 * @param {string} kind - An event kind of the format.
 * @param {object} data - The raw payload (sanitized by the writer).
 */
function writeEvent(target, kind, data) {
  append(
    target.writer.lines(
      kind,
      data,
      Date.now() - target.startMs,
      currentGroups(),
    ),
    target,
  )
}

/**
 * Records one event into the open take; ignored when no take is open or the take is being stopped.
 *
 * @param {string} kind - An event kind of the format.
 * @param {object} data - The raw payload (sanitized by the writer).
 */
function record(kind, data) {
  // A stopping take accepts no editor event: the stop has a fixed set of reads to drain.
  if (!take || take.isStopping) return
  writeEvent(take, kind, data)
}

/**
 * Reads the editor layout and records it into the take that asked for it; called after a batch of events and by stop.
 *
 * @param {object} target - The take that asked for the read; a result that arrives after that take stopped is dropped, and never reaches a later take.
 * @param {boolean} [isFinal] - `true` for the read that stop itself awaits (written although the take is stopping).
 * @returns {Promise<void>} Resolves when the layout line is written.
 */
async function readLayout(target, isFinal = false) {
  target.lastLayoutAt = Date.now()
  try {
    const layout = await vscode.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    // Written only into the originating take, and only while it accepts events (or for stop's own final read).
    if (isFinal || (take === target && !target.isStopping))
      writeEvent(target, 'editorLayout', layout)
  } catch (error) {
    reportFailure(error, target)
  }
}

/**
 * Schedules a layout read after the current event batch, at most every 50 ms.
 */
function scheduleLayout() {
  if (!take || take.isStopping || take.layoutTimer) return
  const wait = Math.max(
    0,
    LAYOUT_READ_INTERVAL_MS - (Date.now() - take.lastLayoutAt),
  )
  // A zero wait still defers to a timer so one batch of events yields one read.
  take.layoutTimer = setTimeout(() => {
    const current = take
    if (!current) return
    current.layoutTimer = undefined
    const pending = readLayout(current)
      .catch((error) => reportFailure(error, current))
      .finally(() => current.pending.delete(pending))
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
  // The folder is git-ignored only in Codebook itself; `wx` never overwrites a .gitignore that is already there.
  try {
    fs.writeFileSync(
      path.join(directory, '.gitignore'),
      TAKE_FOLDER_GITIGNORE,
      {
        flag: 'wx',
      },
    )
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
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
  await readLayout(take)
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
    state: context.workspaceState,
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
 * Ends a take file cut in the middle of its last line, so the next appended line starts on its own line.
 *
 * A complete last line that lacks only its newline is terminated; a line that does not parse is truncated away (its event was never complete). See {@link planTakeRepair}.
 *
 * @param {string} file - A take file.
 * @returns {'none' | 'terminate' | 'truncate'} What was done.
 */
function repairTakeFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const plan = planTakeRepair(text)
  if (plan.action === 'terminate') fs.appendFileSync(file, '\n')
  if (plan.action === 'truncate')
    fs.truncateSync(file, Buffer.byteLength(text.slice(0, plan.keepLength)))
  return plan.action
}

/**
 * Says whether a take file named by a stored mark lies inside the first workspace folder's take folder.
 *
 * Called by {@link resumeIfMarked} before the file is read, repaired or appended to.
 *
 * @param {unknown} file - The `file` of a stored mark.
 * @returns {boolean} `true` only for a path that resolves below `<workspace folder>/.codebook-host-traces/`.
 */
function isInsideTakeFolder(file) {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder || typeof file !== 'string') return false
  const relative = path.relative(
    path.join(folder.uri.fsPath, TAKE_FOLDER),
    path.resolve(file),
  )
  // Empty means the folder itself; `..` or an absolute result means outside.
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

/**
 * Resumes (or restarts) the open take after activation, e.g. after Reload Window.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 */
async function resumeIfMarked(context) {
  const mark = context.workspaceState.get(OPEN_TAKE_KEY)
  // A mark is trusted only when its file lies in this workspace's take folder; any other path is cleared untouched.
  if (mark && !isInsideTakeFolder(mark.file)) {
    await context.workspaceState.update(OPEN_TAKE_KEY, undefined)
    return
  }
  const exists = mark ? fs.existsSync(mark.file) : false
  // Before anything is appended: a crash mid-write can leave a last line without its newline.
  const repair = exists ? repairTakeFile(mark.file) : 'none'
  const decision = decideResume({
    mark,
    fileExists: exists,
    lastLine: exists ? readLastLine(mark.file) : null,
    nowMs: Date.now(),
  })
  if (decision.action === 'none') return
  if (decision.action === 'fresh') {
    await context.workspaceState.update(OPEN_TAKE_KEY, undefined)
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
  if (repair !== 'none')
    void vscode.window.showWarningMessage(
      `The resumed take ended in a cut line; it was ${repair === 'terminate' ? 'complete and is kept' : 'incomplete and was removed'}.`,
    )
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
  if (!current || current.isStopping) return undefined
  // From here no editor event is recorded or schedules a read: every read to drain is already in `pending`.
  current.isStopping = true
  if (current.layoutTimer) clearTimeout(current.layoutTimer)
  current.layoutTimer = undefined
  await Promise.all([...current.pending])
  writeEvent(current, 'tabGroups', currentGroups())
  await readLayout(current, true)
  take = undefined
  await context.workspaceState.update(OPEN_TAKE_KEY, undefined)
  return current.file
}

/**
 * Records a mark: a labelled boundary between two steps of a take, followed by a snapshot like any event.
 *
 * Called by the `codebookHostRecorder.mark` command, which the author runs just before each step of a take so the replay can cut the take into windows.
 *
 * @param {string} label - The step's name (for example `arrange`).
 */
function recordMark(label) {
  record('mark', { label })
}

/**
 * Activates the recorder: registers all three commands, subscribes to the events and resumes an open take.
 *
 * @param {import('vscode').ExtensionContext} context - The extension context.
 */
async function activate(context) {
  subscribe(context)
  context.subscriptions.push(
    vscode.commands.registerCommand('codebookHostRecorder.start', async () => {
      // A start still waiting for its name box counts as open, so two quick starts cannot replace each other's take.
      if (take || isStarting) {
        void vscode.window.showWarningMessage(
          'A host event take is already recording; stop it first.',
        )
        return
      }
      isStarting = true
      try {
        const sequence = await vscode.window.showInputBox({
          prompt: 'Sequence name of this take (for example arrange-restore)',
          ignoreFocusOut: true,
          validateInput: nameProblem,
        })
        if (!sequence) return
        await startTake(context, sequence)
      } finally {
        isStarting = false
      }
      void vscode.window.showInformationMessage(
        `Recording host events to ${take.file}`,
      )
    }),
    vscode.commands.registerCommand('codebookHostRecorder.mark', async () => {
      if (!take) {
        void vscode.window.showWarningMessage(
          'No host event take is open; start one before marking.',
        )
        return
      }
      const label = await vscode.window.showInputBox({
        prompt: 'Label of the step that starts now (for example arrange)',
        ignoreFocusOut: true,
        validateInput: nameProblem,
      })
      if (label) recordMark(label)
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
