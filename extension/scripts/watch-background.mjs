// Shows when each background task and subagent of one Claude Code session last wrote output (Issue #96).
//
//   node extension/scripts/watch-background.mjs [--project <path>] [--session <id>] [--minutes 20] [--json]
//                                               [--tasks-root <dir>] [--claude-home <dir>]
//
// A main agent that waits for a background shell or subagent runs it to see which one has gone quiet, instead of checking
// a transcript's size by hand. One row per task: its id, its kind (`agent` or `task`), the description from the subagent's
// meta, `finished` or `stopped` when the meta says so, the time and age of its last write, and its size. The oldest last
// write comes first. A row is marked SILENT when it last wrote more than --minutes ago (20 by default) and its meta does not
// say that the subagent finished or was stopped by the user. A shell task has no meta, so its row stays SILENT after the
// shell ended; the shell's task notification is the authority on whether it ended.
//
// It reads file metadata only (modification time and size) of
//   <tasks-root>/<projectKey>/<session>/tasks/<taskId>.output    a shell's output, or a link to an agent's transcript
//   <claude-home>/projects/<projectKey>/<session>/subagents/agent-<agentId>.jsonl
// and, from agent-<agentId>.meta.json, only `description`, `agentType`, `finished` and `stoppedByUser`. It never opens an
// output file or a transcript, so none of their text can reach its output. A task that has an output file and a transcript
// is one row.
//
// <projectKey> is the project's absolute path with every character outside A-Za-z0-9 replaced by `-`. --project defaults to
// $CLAUDE_PROJECT_DIR, else the working directory (so run it from the project's root, or pass --project); --tasks-root to
// /tmp/claude-<uid>; --claude-home to ~/.claude. The default session is the current one: inside Claude Code,
// $CLAUDE_CODE_SESSION_ID names it (checked like --session), and --session overrides it. Where that variable is unset or
// empty, the session whose newest file changed last is shown. A session id belongs to one project, so for another project
// give --project and --session together.
//
// Exit 0: the folders were read, also when rows are SILENT. Exit 1: the project or session folders do not exist (one
// stderr line names the paths looked in) or a folder could not be read. Exit 2: a bad option or a bad
// $CLAUDE_CODE_SESSION_ID, named on stderr.
import { realpathSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** The silence limit when `--minutes` is not given: Issue #96 stops a review subagent that has no new output for 20 minutes. */
const DEFAULT_SILENCE_LIMIT_MINUTES = 20
const MS_PER_MINUTE = 60_000
/** Decimal places of the age that a row keeps and shows. */
const AGE_DECIMAL_PLACES = 1
/** The longest description a row keeps; a longer one is cut so that a row stays one readable line. */
const MAX_DESCRIPTION_LENGTH = 200
const EXIT_CODE_OK = 0
const EXIT_CODE_MISSING_FOLDERS = 1
const EXIT_CODE_BAD_OPTION = 2
const SILENT_MARK = 'SILENT'
const FINISHED_MARK = 'finished'
const STOPPED_MARK = 'stopped'
/** The environment variable in which Claude Code gives a shell the id of its current session (measured on macOS). */
const SESSION_VARIABLE_NAME = 'CLAUDE_CODE_SESSION_ID'
const KIND_AGENT = 'agent'
const KIND_TASK = 'task'
/** The folder under a session folder of the tasks root that holds the output files. */
const TASKS_FOLDER_NAME = 'tasks'
/** The folder under a session folder of the projects root that holds the subagent transcripts and metas. */
const SUBAGENTS_FOLDER_NAME = 'subagents'
const MESSAGE_PREFIX = 'watch-background: '

/** A session id is one folder name: no separator, and not `.` or `..`. */
const SESSION_ID_PATTERN = /^(?!\.+$)[\w.-]+$/
/** A plain decimal number; `1e3`, `0x10` and signs are refused. */
const MINUTES_PATTERN = /^\d+(?:\.\d+)?$/
const TASK_OUTPUT_NAME_PATTERN = /^(.+)\.output$/
const TRANSCRIPT_NAME_PATTERN = /^agent-(.+)\.jsonl$/
/** Control, format (bidi) and line-separator characters: text from a meta must not break a row's line or steer the terminal. */
const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu

/** Added to the line that refuses an unknown option or a stray argument, because the script has no `--help`. */
const OPTIONS_HINT =
  'Options: --project <path>, --session <id>, --minutes <n>, --json, --tasks-root <dir>, --claude-home <dir>.'
/** The `parseArgs` error codes whose line gets {@link OPTIONS_HINT}. */
const HINTED_PARSE_ERROR_CODES = new Set([
  'ERR_PARSE_ARGS_UNKNOWN_OPTION',
  'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL',
])

const OPTION_DEFINITIONS = {
  project: { type: 'string' },
  session: { type: 'string' },
  minutes: { type: 'string' },
  json: { type: 'boolean' },
  'tasks-root': { type: 'string' },
  'claude-home': { type: 'string' },
}

/**
 * A mistake in the command line; {@link runCommand} turns it into exit code 2 and one stderr line that names the option.
 * Thrown by {@link parseWatchOptions} and the readers it calls.
 */
class BadOptionError extends Error {}

/**
 * A project or session folder that does not exist; {@link runCommand} turns it into exit code 1 and one stderr line that names the paths looked in.
 * Thrown by {@link readReport}.
 */
class MissingFoldersError extends Error {}

/**
 * Turns a project's absolute path into the folder name that Claude Code files the project's sessions under.
 *
 * Why: the task outputs and the subagent transcripts of a project sit in folders named by this key, so every lookup starts from it. Called by {@link readReport} once per run.
 *
 * @param projectPath - The project's absolute path, as Claude Code saw it as its working directory.
 * @returns The path with every character outside `A-Za-z0-9` replaced by `-` (a slash, a dot and a space each become one dash).
 * @example
 * projectKeyOf('/Users/a.b/My Project') // => '-Users-a-b-My-Project'
 */
export function projectKeyOf(projectPath) {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * Runs one file-system call and answers `undefined`, instead of throwing, when the path is not there.
 *
 * Why: a file or folder can vanish between a listing and the next call (a finished task is cleaned up), and a link can point at a file that is gone; such an entry is skipped, not a failure. Called by every reader below.
 *
 * @param operation - A function that makes one call of `node:fs/promises` and returns its promise.
 * @returns The call's result, or `undefined` when it failed because the path is missing, a parent is no folder, or a link loops.
 * @throws Any other error of the call (a permission error, for example).
 * @example
 * await unlessAbsent(() => stat('/tmp/claude-501/gone.output')) // => undefined
 */
async function unlessAbsent(operation) {
  try {
    return await operation()
  } catch (error) {
    // ENOENT also covers a link whose target was removed.
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return undefined
    throw error
  }
}

/**
 * Says whether a path is a folder, following links.
 *
 * Why: a named session must exist in at least one of the two roots, and a session folder counts only when it holds the task or subagent folder. Called by {@link readReport} and {@link listSessionFolders}.
 *
 * @param path - The path to test.
 * @returns `true` for a folder; `false` for a file, for anything else and for a path that is not there.
 * @example
 * await isDirectory('/tmp/claude-501/-Users-me-project') // => true
 */
async function isDirectory(path) {
  return (await unlessAbsent(() => stat(path)))?.isDirectory() === true
}

/**
 * Turns a text from a meta into one safe line, or `null` when nothing is left.
 *
 * Why: the description is written by an agent and printed to a terminal and to the reader agent; a newline or a control character in it would split a row or steer the terminal. Called by {@link readSubagentMeta}.
 *
 * @param value - The meta field; anything that is not a string gives `null`.
 * @returns The text with every run of control, format and line-separator characters replaced by one space, trimmed, and cut to {@link MAX_DESCRIPTION_LENGTH} characters with a final `…`; `null` for an empty result.
 * @example
 * cleanText('Review\nthe diff') // => 'Review the diff'
 * cleanText(42)                // => null
 */
function cleanText(value) {
  if (typeof value !== 'string') return null
  const oneLine = value.replace(UNSAFE_TEXT_PATTERN, ' ').trim()
  // Spread by code point, so that the cut never splits a surrogate pair.
  const characters = [...oneLine]
  if (characters.length === 0) return null
  return characters.length > MAX_DESCRIPTION_LENGTH
    ? `${characters.slice(0, MAX_DESCRIPTION_LENGTH).join('')}…`
    : oneLine
}

/**
 * Reads the four fields of a subagent's meta that the watchdog uses, and nothing else of it.
 *
 * Why: the meta tells what the subagent is for (`description`, `agentType`) and whether it has ended (`finished`, or `stoppedByUser` when the user stopped it), which a transcript's modification time cannot. Called by {@link readSessionSources} for every task id.
 *
 * @param subagentDirectory - The session's `subagents` folder under the projects root.
 * @param id - The task id, as in `agent-<id>.meta.json`.
 * @returns `undefined` when no meta exists for the id (the task is a shell); else `{ description, agentType, finished, stopped }` where the texts are `null` when absent, `finished` is `true` only for the JSON value `true` of `finished` and `stopped` only for the JSON value `true` of `stoppedByUser`. A meta that is not valid JSON still counts as existing, with no fields.
 * @example
 * await readSubagentMeta('/home/me/.claude/projects/-p/s1/subagents', 'a1b2')
 * // => { description: 'Read the docs', agentType: 'general-purpose', finished: true, stopped: false }
 */
async function readSubagentMeta(subagentDirectory, id) {
  const text = await unlessAbsent(() =>
    readFile(join(subagentDirectory, `agent-${id}.meta.json`), 'utf8'),
  )
  if (text === undefined) return undefined
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // A meta that is half written still shows that the agent exists.
    parsed = null
  }
  const record = typeof parsed === 'object' && parsed !== null ? parsed : {}
  return {
    description: cleanText(record.description),
    agentType: cleanText(record.agentType),
    finished: record.finished === true,
    stopped: record.stoppedByUser === true,
  }
}

/**
 * Lists the files of a folder whose names match a pattern, with their modification time and size.
 *
 * Why: the task outputs and the transcripts are told apart by name, and only their metadata is read. Called by {@link readSessionSources} for the tasks folder and for the subagents folder.
 *
 * @param directory - The folder to list; a folder that is not there lists nothing.
 * @param namePattern - A pattern with one capture group, the task id.
 * @returns One `{ id, mtimeMs, sizeBytes }` per matching regular file. `stat` follows links, so an agent's output file, which is a link to its transcript, answers with the transcript's time and size; a link whose target is gone is skipped.
 * @example
 * await listFiles('/tmp/claude-501/-p/s1/tasks', /^(.+)\.output$/)
 * // => [{ id: 'b89sndto6', mtimeMs: 1792632190000, sizeBytes: 3062 }]
 */
async function listFiles(directory, namePattern) {
  const names = (await unlessAbsent(() => readdir(directory))) ?? []
  const files = await Promise.all(
    names.map(async (name) => {
      const id = namePattern.exec(name)?.[1]
      if (id === undefined) return undefined
      const stats = await unlessAbsent(() => stat(join(directory, name)))
      return stats?.isFile() === true
        ? { id, mtimeMs: stats.mtimeMs, sizeBytes: stats.size }
        : undefined
    }),
  )
  return files.filter((file) => file !== undefined)
}

/**
 * Collects what the rows are built from for one session: the task output files, the subagent transcripts and the metas.
 *
 * Why: this is the only place that touches the session's files, so the rest of the script works on plain values. Called by {@link readReport}.
 *
 * @param taskDirectory - The session's `tasks` folder under the tasks root.
 * @param subagentDirectory - The session's `subagents` folder under the projects root.
 * @returns `{ outputs, transcripts, metas }`: the files as listed by {@link listFiles}, and a map from task id to the meta of {@link readSubagentMeta} for every id that has one.
 * @example
 * await readSessionSources('/tmp/claude-501/-p/s1/tasks', '/home/me/.claude/projects/-p/s1/subagents')
 * // => { outputs: [...], transcripts: [...], metas: Map(1) { 'a1b2' => { ... } } }
 */
async function readSessionSources(taskDirectory, subagentDirectory) {
  const outputs = await listFiles(taskDirectory, TASK_OUTPUT_NAME_PATTERN)
  const transcripts = await listFiles(
    subagentDirectory,
    TRANSCRIPT_NAME_PATTERN,
  )
  const ids = new Set([...outputs, ...transcripts].map(({ id }) => id))
  const metas = new Map()
  await Promise.all(
    [...ids].map(async (id) => {
      const meta = await readSubagentMeta(subagentDirectory, id)
      if (meta !== undefined) metas.set(id, meta)
    }),
  )
  return { outputs, transcripts, metas }
}

/**
 * Orders two texts by code unit, independent of the locale.
 *
 * Why: sorting by id must give the same order on every machine. Called by {@link buildRows} and {@link chooseNewestSession}.
 *
 * @param left - The first text.
 * @param right - The second text.
 * @returns A negative number when `left` comes first, a positive number when `right` does, 0 when they are equal.
 * @example
 * compareText('a2', 'a10') // => 1
 */
function compareText(left, right) {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
 * Builds the rows of a report from the files of one session.
 *
 * Why: the verdict of the watchdog (SILENT or not) must be decidable from plain values and a clock reading, so it can be checked without a file system. Called by {@link readReport}.
 *
 * A task that has an output file and a transcript is one row: Claude Code links an agent's output file to its transcript, so listing both would show every agent twice and count it twice. The row takes the newer of the two files.
 *
 * @param sources - `{ outputs, transcripts, metas }` as {@link readSessionSources} returns them.
 * @param nowMs - The current time in milliseconds since the epoch.
 * @param limitMinutes - The silence limit in minutes.
 * @returns The rows, oldest last write first (equal times by id). Each row is `{ id, kind, description, agentType, finished, stopped, lastWrite, ageMinutes, sizeBytes, silent }`: `kind` is `agent` when a meta or a transcript exists for the id, else `task`; `finished` and `stopped` come from the meta (a shell has none, so both are `false`); `lastWrite` is ISO 8601; `ageMinutes` is rounded to a tenth (never negative); `silent` is `true` when the unrounded age is more than `limitMinutes` and the row is neither finished nor stopped.
 * @example
 * buildRows({ outputs: [{ id: 'b1', mtimeMs: 0, sizeBytes: 5 }], transcripts: [], metas: new Map() }, 30 * 60_000, 20)
 * // => [{ id: 'b1', kind: 'task', description: null, agentType: null, finished: false, stopped: false, lastWrite: '1970-01-01T00:00:00.000Z', ageMinutes: 30, sizeBytes: 5, silent: true }]
 */
export function buildRows(
  { outputs, transcripts, metas },
  nowMs,
  limitMinutes,
) {
  const filesById = new Map()
  const addFile = (file, isTranscript) => {
    const files = filesById.get(file.id) ?? []
    files.push({ ...file, isTranscript })
    filesById.set(file.id, files)
  }
  for (const file of outputs) addFile(file, false)
  for (const file of transcripts) addFile(file, true)

  const rows = [...filesById].map(([id, files]) => {
    // The newer file wins; on equal times the first listed (the output file) does.
    const newest = files.reduce((best, file) =>
      file.mtimeMs > best.mtimeMs ? file : best,
    )
    const meta = metas.get(id)
    const finished = meta?.finished === true
    const stopped = meta?.stopped === true
    const unroundedAgeMinutes = Math.max(
      0,
      (nowMs - newest.mtimeMs) / MS_PER_MINUTE,
    )
    return {
      mtimeMs: newest.mtimeMs,
      row: {
        id,
        kind:
          meta !== undefined || files.some(({ isTranscript }) => isTranscript)
            ? KIND_AGENT
            : KIND_TASK,
        description: meta?.description ?? null,
        agentType: meta?.agentType ?? null,
        finished,
        stopped,
        lastWrite: new Date(newest.mtimeMs).toISOString(),
        ageMinutes: Number(unroundedAgeMinutes.toFixed(AGE_DECIMAL_PLACES)),
        sizeBytes: newest.sizeBytes,
        // Compared before rounding: a row is SILENT only when it is really past the limit. A subagent that ended, or that the user stopped, writes nothing more and is not a stall.
        silent: !finished && !stopped && unroundedAgeMinutes > limitMinutes,
      },
    }
  })
  // Oldest first, so that the quiet rows come first; the id keeps equal times in a fixed order.
  rows.sort(
    (left, right) =>
      left.mtimeMs - right.mtimeMs || compareText(left.row.id, right.row.id),
  )
  return rows.map(({ row }) => row)
}

/**
 * Finds the modification time of the newest file anywhere below a folder.
 *
 * Why: a session's activity is the time of its newest file, in any of its folders (tasks, subagents, tool results), which says which session is in use now. Called by {@link chooseNewestSession}.
 *
 * @param directory - The folder to search; a folder that is not there has no file.
 * @returns The newest modification time in milliseconds since the epoch, or 0 when no file is found. Links are followed; a link whose target is gone counts for nothing.
 * @example
 * await newestFileTime('/tmp/claude-501/-p/s1') // => 1792632190000
 */
async function newestFileTime(directory) {
  const entries =
    (await unlessAbsent(() =>
      readdir(directory, { recursive: true, withFileTypes: true }),
    )) ?? []
  const times = await Promise.all(
    entries
      .filter((entry) => !entry.isDirectory())
      .map(async (entry) => {
        const stats = await unlessAbsent(() =>
          stat(join(entry.parentPath, entry.name)),
        )
        return stats?.isFile() === true ? stats.mtimeMs : 0
      }),
  )
  return times.reduce((newest, time) => Math.max(newest, time), 0)
}

/**
 * Lists the session folders of one root of a project.
 *
 * Why: the projects root also holds folders that are no session (the project's `memory` folder), and taking one for the newest session would show nothing. A folder is a session when it holds the marker folder that this root keeps per session. Called by {@link chooseNewestSession}.
 *
 * @param projectDirectory - The project's folder in a root (`<tasks-root>/<key>` or `<claude-home>/projects/<key>`); one that is not there lists nothing.
 * @param markerName - `tasks` for the tasks root, `subagents` for the projects root.
 * @returns One `{ name, directory }` per session folder.
 * @example
 * await listSessionFolders('/tmp/claude-501/-p', 'tasks') // => [{ name: 's1', directory: '/tmp/claude-501/-p/s1' }]
 */
async function listSessionFolders(projectDirectory, markerName) {
  const entries =
    (await unlessAbsent(() =>
      readdir(projectDirectory, { withFileTypes: true }),
    )) ?? []
  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const directory = join(projectDirectory, name)
        return (await isDirectory(join(directory, markerName)))
          ? { name, directory }
          : undefined
      }),
  )
  return sessions.filter((session) => session !== undefined)
}

/**
 * Picks the session whose newest file changed last, across the tasks root and the projects root.
 *
 * Why: a main agent usually watches its own, most recent session and should not have to look up its id. Called by {@link readReport} when `--session` is not given.
 *
 * @param taskProjectDirectory - `<tasks-root>/<key>`.
 * @param subagentProjectDirectory - `<claude-home>/projects/<key>`.
 * @returns The session id, or `undefined` when neither root has a session folder. A session that has a folder in both roots counts with the newer of the two; equal times fall back to the id.
 * @example
 * await chooseNewestSession('/tmp/claude-501/-p', '/home/me/.claude/projects/-p') // => '44e65030-9bdd-45e8-8660-c541059d40d8'
 */
async function chooseNewestSession(
  taskProjectDirectory,
  subagentProjectDirectory,
) {
  const sessions = [
    ...(await listSessionFolders(taskProjectDirectory, TASKS_FOLDER_NAME)),
    ...(await listSessionFolders(
      subagentProjectDirectory,
      SUBAGENTS_FOLDER_NAME,
    )),
  ]
  const activities = await Promise.all(
    sessions.map(async ({ name, directory }) => ({
      name,
      mtimeMs: await newestFileTime(directory),
    })),
  )
  const newestBySession = new Map()
  for (const { name, mtimeMs } of activities)
    newestBySession.set(name, Math.max(newestBySession.get(name) ?? 0, mtimeMs))
  const [newest] = [...newestBySession].sort(
    ([leftName, leftTime], [rightName, rightTime]) =>
      rightTime - leftTime || compareText(leftName, rightName),
  )
  return newest?.[0]
}

/**
 * Reads one session's background tasks and subagents into a report.
 *
 * Why: this is the whole job of the script apart from the command line and the printing. Called by {@link runCommand}, and by tests.
 *
 * @param options - `{ projectPath, sessionId, limitMinutes, tasksRoot, claudeHome }` as {@link parseWatchOptions} returns them; `sessionId` is `undefined` to take the newest session.
 * @param nowMs - The current time in milliseconds since the epoch.
 * @returns `{ projectKey, session, limitMinutes, rows }`, the rows as {@link buildRows} returns them.
 * @throws {MissingFoldersError} When no session folder exists for the project, or the named session has no folder in either root. A root that is missing while the other one exists is fine: the tasks root lives in `/tmp` and may be cleared by a reboot.
 * @example
 * await readReport({ projectPath: '/Users/me/p', sessionId: undefined, limitMinutes: 20, tasksRoot: '/tmp/claude-501', claudeHome: '/Users/me/.claude' }, Date.now())
 * // => { projectKey: '-Users-me-p', session: '44e65030-…', limitMinutes: 20, rows: [...] }
 */
export async function readReport(
  { projectPath, sessionId, limitMinutes, tasksRoot, claudeHome },
  nowMs,
) {
  const projectKey = projectKeyOf(projectPath)
  const taskProjectDirectory = join(tasksRoot, projectKey)
  const subagentProjectDirectory = join(claudeHome, 'projects', projectKey)
  const session =
    sessionId ??
    (await chooseNewestSession(taskProjectDirectory, subagentProjectDirectory))
  if (session === undefined)
    throw new MissingFoldersError(
      `no session with background tasks or subagents for project key ${projectKey}; looked in ${taskProjectDirectory} and ${subagentProjectDirectory}`,
    )
  const taskSessionDirectory = join(taskProjectDirectory, session)
  const subagentSessionDirectory = join(subagentProjectDirectory, session)
  // A session that was chosen exists; a named one must have a folder in at least one root.
  if (
    sessionId !== undefined &&
    !(await isDirectory(taskSessionDirectory)) &&
    !(await isDirectory(subagentSessionDirectory))
  )
    throw new MissingFoldersError(
      `no folder for session ${session}; looked in ${taskSessionDirectory} and ${subagentSessionDirectory}`,
    )
  const sources = await readSessionSources(
    join(taskSessionDirectory, TASKS_FOLDER_NAME),
    join(subagentSessionDirectory, SUBAGENTS_FOLDER_NAME),
  )
  return {
    projectKey,
    session,
    limitMinutes,
    rows: buildRows(sources, nowMs, limitMinutes),
  }
}

/**
 * Measures the widest cell of a column of the text report.
 *
 * Why: the text report lines up its ids, ages and sizes so that a quiet row stands out. Called by {@link formatReportAsText} for each column.
 *
 * @param texts - The cells of one column.
 * @returns The length of the longest cell, 0 for no cell.
 * @example
 * widthOf(['a', 'abc']) // => 3
 */
function widthOf(texts) {
  return texts.reduce((width, text) => Math.max(width, text.length), 0)
}

/**
 * Names the state that a row shows in the text report.
 *
 * Why: a main agent must see at a glance that a quiet row has ended (and need not be stopped by it). Called by {@link formatReportAsText} for each row.
 *
 * @param row - A row as {@link buildRows} returns it.
 * @returns `finished` for a finished row, also when the user stopped it as well (it ended by itself first); else `stopped` for a row the user stopped; else an empty text.
 * @example
 * stateOf({ finished: false, stopped: true })  // => 'stopped'
 * stateOf({ finished: true, stopped: true })   // => 'finished'
 * stateOf({ finished: false, stopped: false }) // => ''
 */
function stateOf({ finished, stopped }) {
  if (finished) return FINISHED_MARK
  return stopped ? STOPPED_MARK : ''
}

/**
 * Formats a report as text: a header, one line per row, and a line that counts the SILENT rows.
 *
 * Why: the main agent reads this output in a terminal, so each row is one self-explaining line. Called by {@link runCommand} when `--json` is not given, and by tests.
 *
 * @param report - `{ projectKey, session, limitMinutes, rows }` as {@link readReport} returns it.
 * @returns The lines joined by newlines, with a final newline. A row line holds the SILENT mark (or blanks), the id, the kind, `last write <ISO 8601>`, `age <n> min`, `size <n> B`, the state ({@link stateOf}: `finished`, `stopped` or blanks), then the description and the agent type in parentheses.
 * @example
 * formatReportAsText({ projectKey: '-p', session: 's1', limitMinutes: 20, rows: [] })
 * // => 'project -p  session s1  silence limit 20 min\nSILENT rows: 0 of 0 (no write for more than 20 min, not finished or stopped)\n'
 */
export function formatReportAsText({
  projectKey,
  session,
  limitMinutes,
  rows,
}) {
  const ages = rows.map(({ ageMinutes }) =>
    ageMinutes.toFixed(AGE_DECIMAL_PLACES),
  )
  const sizes = rows.map(({ sizeBytes }) => String(sizeBytes))
  const idWidth = widthOf(rows.map(({ id }) => id))
  const kindWidth = widthOf([KIND_AGENT, KIND_TASK])
  const ageWidth = widthOf(ages)
  const sizeWidth = widthOf(sizes)
  const stateWidth = widthOf([FINISHED_MARK, STOPPED_MARK])
  const lines = rows.map((row, index) => {
    const label = [
      row.description,
      row.agentType === null ? null : `(${row.agentType})`,
    ]
      .filter((part) => part !== null)
      .join(' ')
    return [
      row.silent ? SILENT_MARK : ' '.repeat(SILENT_MARK.length),
      row.id.padEnd(idWidth),
      row.kind.padEnd(kindWidth),
      `last write ${row.lastWrite}`,
      `age ${ages[index].padStart(ageWidth)} min`,
      `size ${sizes[index].padStart(sizeWidth)} B`,
      stateOf(row).padEnd(stateWidth),
      label,
    ]
      .join('  ')
      .trimEnd()
  })
  const silentCount = rows.filter(({ silent }) => silent).length
  return [
    `project ${projectKey}  session ${session}  silence limit ${limitMinutes} min`,
    ...lines,
    `${SILENT_MARK} rows: ${silentCount} of ${rows.length} (no write for more than ${limitMinutes} min, not finished or stopped)`,
    '',
  ].join('\n')
}

/**
 * Refuses an option whose value is empty.
 *
 * Why: an empty path would silently mean "the working directory" and hide a mistake in a script that builds the command line. Called by {@link parseWatchOptions}.
 *
 * @param optionName - The option as the command line spells it.
 * @param text - The option's value.
 * @returns The value.
 * @throws {BadOptionError} For an empty or blank value.
 * @example
 * requireText('--project', '/Users/me/p') // => '/Users/me/p'
 * requireText('--project', '')            // throws '--project must not be empty.'
 */
function requireText(optionName, text) {
  if (text.trim() === '')
    throw new BadOptionError(`${optionName} must not be empty.`)
  return text
}

/**
 * Reads the text of `--minutes` into the silence limit.
 *
 * Why: a limit of 0, a negative number, text or `Infinity` would flag every row or none, so it is refused before any folder is read. Called by {@link parseWatchOptions}.
 *
 * @param text - The option's value.
 * @returns The limit in minutes; a decimal such as `0.5` is allowed.
 * @throws {BadOptionError} When the text is not a plain decimal number above 0.
 * @example
 * parseMinutes('5')   // => 5
 * parseMinutes('abc') // throws '--minutes must be a number above 0, got "abc".'
 */
function parseMinutes(text) {
  const minutes = Number(text)
  if (!MINUTES_PATTERN.test(text) || !Number.isFinite(minutes) || minutes <= 0)
    throw new BadOptionError(
      `--minutes must be a number above 0, got ${JSON.stringify(text)}.`,
    )
  return minutes
}

/**
 * Reads the text of `--session`, or of the session variable, into a session id.
 *
 * Why: the id becomes a folder name under two roots, so a path such as `../other` must not get through, whichever way it came in. Called by {@link parseWatchOptions} for `--session` and by {@link currentSessionId} for the variable.
 *
 * @param sourceName - What the text came from, for the refusal's first words: `--session` or the variable's name.
 * @param text - The value.
 * @returns The id, unchanged.
 * @throws {BadOptionError} When the text is not one folder name of letters, digits, `_`, `.` and `-` (and not `.` or `..`).
 * @example
 * parseSessionId('--session', '44e65030-9bdd-45e8-8660-c541059d40d8') // => '44e65030-9bdd-45e8-8660-c541059d40d8'
 * parseSessionId('--session', '../other')                              // throws '--session must be one folder name …'
 */
function parseSessionId(sourceName, text) {
  if (!SESSION_ID_PATTERN.test(text))
    throw new BadOptionError(
      `${sourceName} must be one folder name of letters, digits, "_", "." and "-", got ${JSON.stringify(text)}.`,
    )
  return text
}

/**
 * Reads the id of the current Claude Code session from the environment.
 *
 * Why: a main agent runs the watchdog with no options and expects its own session, not whichever session wrote last; Claude Code gives its shells the id in {@link SESSION_VARIABLE_NAME}. Called by {@link parseWatchOptions} when `--session` is not given.
 *
 * @param environment - The process environment.
 * @returns The id; `undefined` when the variable is unset or empty (the caller then takes the most recently active session). A value that is set is never skipped: when it is no folder name the variable is wrong, and the tasks of some other session would be shown for it.
 * @throws {BadOptionError} When the variable is set to something that is not one folder name.
 * @example
 * currentSessionId({ CLAUDE_CODE_SESSION_ID: '44e65030-9bdd-45e8-8660-c541059d40d8' }) // => '44e65030-9bdd-45e8-8660-c541059d40d8'
 * currentSessionId({ CLAUDE_CODE_SESSION_ID: '' })                                       // => undefined
 */
function currentSessionId(environment) {
  const text = environment[SESSION_VARIABLE_NAME]
  // Unset and empty both mean "not inside Claude Code".
  if (text === undefined || text === '') return undefined
  return parseSessionId(SESSION_VARIABLE_NAME, text)
}

/**
 * Gives the default tasks root, `/tmp/claude-<uid>`.
 *
 * Why: Claude Code keeps the task outputs of a user under that folder (on macOS `/tmp` is `/private/tmp`). Called by {@link parseWatchOptions} when `--tasks-root` is not given.
 *
 * @param userId - The user id, `undefined` on a system that has none.
 * @returns The folder.
 * @throws {BadOptionError} When there is no user id: the default cannot be built, and the option must be given.
 * @example
 * defaultTasksRoot(501) // => '/tmp/claude-501'
 */
function defaultTasksRoot(userId) {
  if (userId === undefined)
    throw new BadOptionError(
      '--tasks-root is required here: this system has no user id to build /tmp/claude-<uid> from.',
    )
  return `/tmp/claude-${userId}`
}

/**
 * Parses the arguments with `parseArgs` and names the offending option when it refuses them.
 *
 * Why: an unknown option, a missing value, a value for a flag or a stray argument must end the run with exit code 2, not with a stack trace. Called by {@link parseWatchOptions}.
 *
 * @param argv - The arguments after the script's name.
 * @returns The values of the options that were given.
 * @throws {BadOptionError} With the first line of the parser's message, which names the option or the argument; for an unknown option or a stray argument also with the list of valid options.
 * @example
 * readOptionValues(['--minutes', '5'])  // => { minutes: '5' }
 * readOptionValues(['--bogus'])         // throws "Unknown option '--bogus'. Options: --project <path>, …"
 * readOptionValues(['--minutes'])       // throws "Option '--minutes <value>' argument missing"
 */
function readOptionValues(argv) {
  try {
    return parseArgs({ args: argv, options: OPTION_DEFINITIONS }).values
  } catch (error) {
    // The parser's own errors carry the offending token in their first line; the lines after it are advice about quoting.
    if (String(error.code).startsWith('ERR_PARSE_ARGS_')) {
      const firstLine = error.message.split('\n')[0]
      // Only a mistyped name or a stray word gets the list of options; a bad value for a known option does not need it.
      throw new BadOptionError(
        HINTED_PARSE_ERROR_CODES.has(error.code)
          ? `${firstLine.replace(/\.$/, '')}. ${OPTIONS_HINT}`
          : firstLine,
      )
    }
    throw error
  }
}

/**
 * Reads the command line and the environment into the options of one run.
 *
 * Why: a mistake in an option must stop the run before any folder is read, and the defaults (project, roots, limit) belong in one place. Called by {@link runCommand}, and by tests.
 *
 * @param argv - The arguments after the script's name.
 * @param context - Where the defaults come from: `environment` (for `CLAUDE_PROJECT_DIR` and `CLAUDE_CODE_SESSION_ID`), `workingDirectory`, `userId` (`undefined` on a system without user ids) and `homeDirectory`.
 * @returns `{ projectPath, sessionId, limitMinutes, json, tasksRoot, claudeHome }`: the three paths absolute (relative ones resolve against `workingDirectory`); `sessionId` is the `--session` value, else the current session of `CLAUDE_CODE_SESSION_ID`, else `undefined` (take the most recently active session).
 * @throws {BadOptionError} For an unknown option, a missing, empty or malformed value, a stray argument, or a `CLAUDE_CODE_SESSION_ID` that is set but is not one folder name.
 * @example
 * parseWatchOptions(['--minutes', '5'], { environment: {}, workingDirectory: '/work', userId: 501, homeDirectory: '/home/me' })
 * // => { projectPath: '/work', sessionId: undefined, limitMinutes: 5, json: false, tasksRoot: '/tmp/claude-501', claudeHome: '/home/me/.claude' }
 */
export function parseWatchOptions(
  argv,
  { environment, workingDirectory, userId, homeDirectory },
) {
  const values = readOptionValues(argv)
  // An empty CLAUDE_PROJECT_DIR counts as not set.
  const projectText =
    values.project === undefined
      ? environment.CLAUDE_PROJECT_DIR || workingDirectory
      : requireText('--project', values.project)
  const tasksRootText =
    values['tasks-root'] === undefined
      ? defaultTasksRoot(userId)
      : requireText('--tasks-root', values['tasks-root'])
  const claudeHomeText =
    values['claude-home'] === undefined
      ? join(homeDirectory, '.claude')
      : requireText('--claude-home', values['claude-home'])
  return {
    projectPath: resolve(workingDirectory, projectText),
    // --session wins over the current session that the environment names.
    sessionId:
      values.session === undefined
        ? currentSessionId(environment)
        : parseSessionId('--session', values.session),
    limitMinutes:
      values.minutes === undefined
        ? DEFAULT_SILENCE_LIMIT_MINUTES
        : parseMinutes(values.minutes),
    json: values.json === true,
    tasksRoot: resolve(workingDirectory, tasksRootText),
    claudeHome: resolve(workingDirectory, claudeHomeText),
  }
}

/**
 * Runs the watchdog for one command line and answers what to print and which exit code to end with.
 *
 * Why: the script's entry point below only prints this answer, so the whole run, errors included, can be called without a process. Called by the entry point at the end of this file, and by tests.
 *
 * @param argv - The arguments after the script's name.
 * @param context - `{ environment, workingDirectory, userId, homeDirectory, nowMs }`: the process facts that {@link parseWatchOptions} and {@link readReport} need.
 * @returns `{ exitCode, stdout, stderr }`:
 * - exit 0: the report, as JSON with `--json`, else as text (also when rows are SILENT);
 * - exit 1: one stderr line, when the project or session folders do not exist or a folder cannot be read;
 * - exit 2: one stderr line that names the bad option.
 * @example
 * await runCommand(['--json'], { environment: process.env, workingDirectory: process.cwd(), userId: 501, homeDirectory: '/Users/me', nowMs: Date.now() })
 * // => { exitCode: 0, stdout: '{\n  "projectKey": …', stderr: '' }
 */
export async function runCommand(argv, { nowMs, ...parseContext }) {
  try {
    const options = parseWatchOptions(argv, parseContext)
    const report = await readReport(options, nowMs)
    return {
      exitCode: EXIT_CODE_OK,
      stdout: options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatReportAsText(report),
      stderr: '',
    }
  } catch (error) {
    if (error instanceof BadOptionError)
      return {
        exitCode: EXIT_CODE_BAD_OPTION,
        stdout: '',
        stderr: `${MESSAGE_PREFIX}${error.message}\n`,
      }
    // A missing folder and a folder that cannot be read both end the run with one line and exit 1.
    return {
      exitCode: EXIT_CODE_MISSING_FOLDERS,
      stdout: '',
      stderr: `${MESSAGE_PREFIX}${error.message}\n`,
    }
  }
}

/**
 * Says whether Node started this file as the program, as opposed to a test importing its functions.
 *
 * Why: the file both exports its functions for tests and runs as a script, and an import must print nothing. Called once, by the entry point below.
 *
 * It compares real paths, so a script reached through a symbolic link (`/tmp` is one on macOS) still runs; `import.meta.main` would need Node 24.2 or later, and the repository only requires Node 24.
 *
 * @returns `true` when the file named on Node's command line is this file.
 * @example
 * isRunAsScript() // => true under `node watch-background.mjs`, false when a test imports the file
 */
function isRunAsScript() {
  const entryPath = process.argv[1]
  if (entryPath === undefined) return false
  try {
    return realpathSync(entryPath) === fileURLToPath(import.meta.url)
  } catch {
    // An entry that is not a file (`node -`) is not this file.
    return false
  }
}

if (isRunAsScript()) {
  const outcome = await runCommand(process.argv.slice(2), {
    environment: process.env,
    workingDirectory: process.cwd(),
    userId: process.getuid?.(),
    homeDirectory: homedir(),
    nowMs: Date.now(),
  })
  process.stdout.write(outcome.stdout)
  process.stderr.write(outcome.stderr)
  // The exit code is set, not passed to process.exit(): Node ends the process once its output is flushed, so a pipe that reads slowly still gets the whole report.
  process.exitCode = outcome.exitCode
}
