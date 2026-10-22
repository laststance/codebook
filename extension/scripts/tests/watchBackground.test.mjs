import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  lutimes,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { plainOutputEnvironment } from '../utils/plainOutputEnvironment.mjs'
import {
  buildRows,
  formatReportAsText,
  parseWatchOptions,
  projectKeyOf,
  readReport,
} from '../watch-background.mjs'

const SCRIPT_URL = new URL('../watch-background.mjs', import.meta.url)
const SCRIPT_PATH = fileURLToPath(SCRIPT_URL)
const PROJECT_PATH = '/Users/a.b/My Project'
const PROJECT_KEY = '-Users-a-b-My-Project'
const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222'
/** The clock of the tests that call the library: whole seconds, so that `utimes` stores a time exactly. */
const NOW_MS = Date.parse('2026-10-22T10:00:00.000Z')
/** The text of a fake shell output (18 bytes) and of a fake transcript (17 bytes): it must never reach a report, and its length is the size a row shows. */
const SHELL_OUTPUT_TEXT = 'TASK-OUTPUT-SECRET'
const TRANSCRIPT_TEXT = 'TRANSCRIPT-SECRET'
/** The review's example of a name that another user could create in the shared tasks folder: it clears the screen (`ESC [ 2 J`), sets the window title (`ESC ] 0 ; … BEL`) and ends in plain letters. */
const HOSTILE_NAME = '\u001b[2J\u001b]0;pwned\u0007evil'
/** Names that Claude Code never gives a task, a transcript or a session, each with one thing wrong: the review's example, a lone escape, a lone bell, a newline (it would start a fake row), DEL, the C1 control that starts an escape sequence on some terminals, a space, a bracket, a semicolon and non-ASCII letters. A rule that is widened by one character class lets exactly one of them through. */
const ODD_NAMES = [
  HOSTILE_NAME,
  'odd\u001bescape',
  'odd\u0007bell',
  'odd\nnewline',
  'odd\u007fdelete',
  'odd\u009bcsi',
  'odd space',
  'odd[bracket',
  'odd;semicolon',
  'odd-ünïcode',
]
/** What would show in a report if any of the odd names reached it. */
const ODD_NAME_MARKERS = /odd|evil|pwned/

/** Creates the two fake roots (`tasksRoot`, `claudeHome`) in a temporary folder that the test context removes. @example const roots = await createRoots(context) // => { tasksRoot: '/tmp/…/tasks-root', claudeHome: '/tmp/…/claude-home' } */
async function createRoots(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-watch-background-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return {
    tasksRoot: join(directory, 'tasks-root'),
    claudeHome: join(directory, 'claude-home'),
  }
}

/** The moment `minutes` before now on the real clock, in whole seconds, for the tests that run the script as a process. @example minutesAgo(30) // => a Date 30 minutes before now */
function minutesAgo(minutes) {
  return new Date(Math.floor(Date.now() / 1000) * 1000 - minutes * 60_000)
}

/** The moment `minutes` before {@link NOW_MS}, for the tests that call the library with that clock. @example minutesBeforeNow(30) // => 2026-10-22T09:30:00.000Z */
function minutesBeforeNow(minutes) {
  return new Date(NOW_MS - minutes * 60_000)
}

/** Writes a shell's output file with the given last write and returns its path. @example await writeShellOutput(roots, SESSION, 'b89sndto6', minutesAgo(30)) */
async function writeShellOutput(roots, session, taskId, lastWrite) {
  const directory = join(roots.tasksRoot, PROJECT_KEY, session, 'tasks')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${taskId}.output`)
  await writeFile(path, SHELL_OUTPUT_TEXT)
  await utimes(path, lastWrite, lastWrite)
  return path
}

/** Writes a subagent's transcript with the given last write, and its meta when `meta` is given; returns the transcript's path. @example await writeSubagent(roots, SESSION, 'a1558bb674c78a91a', { lastWrite: minutesAgo(5), meta: { description: 'Review', finished: true } }) */
async function writeSubagent(roots, session, agentId, { lastWrite, meta }) {
  const directory = join(
    roots.claudeHome,
    'projects',
    PROJECT_KEY,
    session,
    'subagents',
  )
  await mkdir(directory, { recursive: true })
  const transcript = join(directory, `agent-${agentId}.jsonl`)
  await writeFile(transcript, TRANSCRIPT_TEXT)
  await utimes(transcript, lastWrite, lastWrite)
  if (meta !== undefined)
    await writeFile(
      join(directory, `agent-${agentId}.meta.json`),
      JSON.stringify(meta),
    )
  return transcript
}

/** The options of {@link readReport} for the fake roots, with the 20-minute limit and the first session. @example watchOptions(roots, { limitMinutes: 5 }) */
function watchOptions(roots, overrides = {}) {
  return {
    projectPath: PROJECT_PATH,
    sessionId: SESSION,
    limitMinutes: 20,
    tasksRoot: roots.tasksRoot,
    claudeHome: roots.claudeHome,
    ...overrides,
  }
}

/** The variables of the real environment that decide which session and project the script watches. A test gives them itself: Claude Code sets one of them in the shell that runs the tests, and it must not leak in. */
const WATCH_ENVIRONMENT_NAMES = new Set([
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PROJECT_DIR',
])

/** Copies the real environment for a child process, without the session and project variables and without `FORCE_COLOR`. @example inheritedEnvironment() // => { PATH: '/usr/bin', … } */
function inheritedEnvironment() {
  return Object.fromEntries(
    Object.entries(plainOutputEnvironment(process.env)).filter(
      ([name]) => !WATCH_ENVIRONMENT_NAMES.has(name),
    ),
  )
}

/** Runs the script (or a link to it, `scriptPath`) as a process for the fake roots and answers its exit code and both streams. The process gets the real environment without the session and project variables, plus `environment`. @example runWatch(roots, ['--json'], { environment: { CLAUDE_CODE_SESSION_ID: SESSION } }) // => { code: 0, stdout: '{…}', stderr: '' } */
function runWatch(
  roots,
  extraArguments,
  { scriptPath = SCRIPT_PATH, environment = {} } = {},
) {
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--project',
      PROJECT_PATH,
      '--tasks-root',
      roots.tasksRoot,
      '--claude-home',
      roots.claudeHome,
      ...extraArguments,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...inheritedEnvironment(), ...environment },
    },
  )
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Lists the control characters of a text other than the newline, as hexadecimal code points, so that a failure shows what leaked. @example controlCharactersIn('a\u001bb\n') // => ['1b'] */
function controlCharactersIn(text) {
  return [...text]
    .filter((character) => character !== '\n' && /\p{Cc}/u.test(character))
    .map((character) => character.codePointAt(0).toString(16))
}

/** Says whether a stream holds exactly one line, ended by a newline. @example isOneLine('watch-background: no folder\n') // => true; isOneLine('a\nb\n') // => false; isOneLine('a') // => false */
function isOneLine(text) {
  return text.endsWith('\n') && text.split('\n').length === 2
}

// Value: protects=the lookup of every folder the watchdog reads, which Claude Code names by a key derived from the project path; fails_when=a dot, a space or an underscore is kept, or a character is dropped instead of replaced, so the folders of a project named like that are never found; why_new=Issue #96 (no watchdog existed); seam=none; no_claim=a path so long that Claude Code shortens its key (not measured)
test('a project path with a dot, a space and an underscore maps to the key of its Claude Code folders', () => {
  // Arrange
  const projectPaths = [
    '/Users/a.b/My Project',
    '/Users/ryotamurakami/laststance/codebook',
    '/tmp/my_repo-1.2',
  ]

  // Act
  const keys = projectPaths.map(projectKeyOf)

  // Assert
  assert.deepEqual(keys, [
    '-Users-a-b-My-Project',
    '-Users-ryotamurakami-laststance-codebook',
    '-tmp-my-repo-1-2',
  ])
})

// Value: protects=the project key, which is built from an absolute path: a relative --project (or --tasks-root, --claude-home) must resolve against the working directory, or the key would be built from `..` and no folder found; fails_when=a relative path is used as written; why_new=Issue #96 (no watchdog existed); seam=parseWatchOptions with an explicit working directory; no_claim=symbolic links in the working directory (the path is used as given, as Claude Code saw it)
test('a relative --project, --tasks-root and --claude-home resolve against the working directory', () => {
  // Arrange
  const context = {
    environment: {},
    workingDirectory: '/work/dir',
    userId: 501,
    homeDirectory: '/home/me',
  }

  // Act
  const options = parseWatchOptions(
    [
      '--project',
      '../codebook',
      '--tasks-root',
      'tasks',
      '--claude-home',
      './claude',
    ],
    context,
  )

  // Assert
  assert.deepEqual(
    {
      projectPath: options.projectPath,
      tasksRoot: options.tasksRoot,
      claudeHome: options.claudeHome,
    },
    {
      projectPath: '/work/codebook',
      tasksRoot: '/work/dir/tasks',
      claudeHome: '/work/dir/claude',
    },
  )
})

// Value: protects=the run of a main agent that gives no option: its own project, the 20-minute rule of Issue #96 and the places where Claude Code keeps its files; fails_when=CLAUDE_PROJECT_DIR is ignored, an empty one is taken for a path, the limit is not 20 minutes, or the roots are not /tmp/claude-<uid> and ~/.claude; why_new=Issue #96 (no watchdog existed); seam=parseWatchOptions with an explicit environment, user id and home; no_claim=the real environment of this process
test('without options the watchdog reads CLAUDE_PROJECT_DIR, else the working directory, with a 20-minute limit in /tmp/claude-<uid> and ~/.claude', () => {
  // Arrange
  const context = {
    workingDirectory: '/work/dir',
    userId: 501,
    homeDirectory: '/home/me',
  }

  // Act
  const withVariable = parseWatchOptions([], {
    ...context,
    environment: { CLAUDE_PROJECT_DIR: '/projects/codebook' },
  })
  const withEmptyVariable = parseWatchOptions([], {
    ...context,
    environment: { CLAUDE_PROJECT_DIR: '' },
  })

  // Assert
  assert.deepEqual(withVariable, {
    projectPath: '/projects/codebook',
    sessionId: undefined,
    limitMinutes: 20,
    json: false,
    tasksRoot: '/tmp/claude-501',
    claudeHome: '/home/me/.claude',
  })
  assert.equal(withEmptyVariable.projectPath, '/work/dir')
})

// Value: protects=the watchdog's one job: a shell that went quiet is marked SILENT, a recent one is not, and the quiet one is listed first; fails_when=the default limit changes, the age is taken from the wrong time, or the rows are not ordered by their last write; why_new=Issue #96 (a review subagent ran 2 h 23 min unnoticed); seam=the script started as a process on fake roots whose files get their times from utimes, 30 and 2 minutes before the real clock; no_claim=the age itself, which follows the clock of the run (the tests with a fixed clock pin it); only the margins of 10 and 18 minutes to the limit decide here
test('a shell that last wrote 30 minutes ago is SILENT under the default limit, one that wrote 2 minutes ago is not, and the older is listed first', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bfresh0002', minutesAgo(2))
  await writeShellOutput(roots, SESSION, 'bstale0030', minutesAgo(30))

  // Act
  const result = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  assert.equal(result.code, 0)
  assert.deepEqual(
    JSON.parse(result.stdout).rows.map(({ id, kind, silent }) => ({
      id,
      kind,
      silent,
    })),
    [
      { id: 'bstale0030', kind: 'task', silent: true },
      { id: 'bfresh0002', kind: 'task', silent: false },
    ],
  )
})

// Value: protects=the --minutes option, which lets a main agent tighten the 20-minute rule for a short wait, and the text report that it reads; fails_when=the option is ignored, read as seconds, or the header and the SILENT count keep the default limit; why_new=Issue #96 (no watchdog existed); seam=the script started as a process on fake roots, once with the default limit and once with --minutes 5; no_claim=the text of the columns, which the finished-subagent test below pins
test('--minutes 5 makes a shell that wrote 7 minutes ago SILENT, where the default limit of 20 minutes does not', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bquiet0007', minutesAgo(7))

  // Act
  const withDefault = runWatch(roots, ['--session', SESSION])
  const withFive = runWatch(roots, ['--session', SESSION, '--minutes', '5'])

  // Assert
  const linesOfDefault = withDefault.stdout.split('\n')
  const linesOfFive = withFive.stdout.split('\n')
  assert.deepEqual(
    {
      codes: [withDefault.code, withFive.code],
      defaultHeader: linesOfDefault[0],
      defaultRowIsSilent: linesOfDefault[1].startsWith('SILENT '),
      defaultCount: linesOfDefault[2],
      fiveHeader: linesOfFive[0],
      fiveRowIsSilent: linesOfFive[1].startsWith('SILENT  bquiet0007  task   '),
      fiveCount: linesOfFive[2],
    },
    {
      codes: [0, 0],
      defaultHeader: `project ${PROJECT_KEY}  session ${SESSION}  silence limit 20 min`,
      defaultRowIsSilent: false,
      defaultCount:
        'SILENT rows: 0 of 1 (no write for more than 20 min, not finished or stopped)',
      fiveHeader: `project ${PROJECT_KEY}  session ${SESSION}  silence limit 5 min`,
      fiveRowIsSilent: true,
      fiveCount:
        'SILENT rows: 1 of 1 (no write for more than 5 min, not finished or stopped)',
    },
  )
})

// Value: protects=a main agent from stopping a subagent that has ended: a finished subagent is not SILENT however old, shows `finished` and its description, while an unfinished one of the same age is SILENT; fails_when=`finished` is not read from the meta, the mark ignores it, or the description or agent type is not shown; why_new=Issue #96 (the stop rule must not hit an agent that is done); seam=readReport and formatReportAsText on fake roots with a fixed clock; no_claim=a shell, which has no meta and so is never known to be finished
test('a finished subagent whose transcript is two hours old is not SILENT and shows finished with its description, while an unfinished one of that age is SILENT', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'afinished01', {
    lastWrite: minutesBeforeNow(125),
    meta: {
      description: 'Review the diff',
      agentType: 'general-purpose',
      finished: true,
    },
  })
  await writeSubagent(roots, SESSION, 'astalled002', {
    lastWrite: minutesBeforeNow(120),
    meta: {
      description: 'Review the diff again',
      agentType: 'general-purpose',
    },
  })

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)

  // Assert
  assert.deepEqual(formatReportAsText(report).split('\n'), [
    `project ${PROJECT_KEY}  session ${SESSION}  silence limit 20 min`,
    '        afinished01  agent  last write 2026-10-22T07:55:00.000Z  age 125.0 min  size 17 B  finished  Review the diff (general-purpose)',
    'SILENT  astalled002  agent  last write 2026-10-22T08:00:00.000Z  age 120.0 min  size 17 B            Review the diff again (general-purpose)',
    'SILENT rows: 1 of 2 (no write for more than 20 min, not finished or stopped)',
    '',
  ])
})

// Value: protects=a main agent from reading a subagent that the user stopped as a stalled one: its meta says stoppedByUser, so it shows `stopped`, is never SILENT however old, and its JSON keeps `finished` false next to `stopped` true, while a running subagent of the same age is SILENT; fails_when=stoppedByUser is not read from the meta, the mark ignores it, `finished` is set for it, or the state column does not show it (the real session holds such an agent: ac2b3720c952ee652); why_new=Issue #96 follow-up (the first version showed the stopped agent as SILENT); seam=readReport and formatReportAsText on fake roots with a fixed clock; no_claim=what Claude Code does when it resumes a stopped agent (not measured)
test('a subagent stopped by the user is shown as stopped and never SILENT, while a running one of the same age is SILENT', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'astopped001', {
    lastWrite: minutesBeforeNow(125),
    meta: {
      description: 'Prepare the PR',
      agentType: 'general-purpose',
      stoppedByUser: true,
    },
  })
  await writeSubagent(roots, SESSION, 'astalled002', {
    lastWrite: minutesBeforeNow(120),
    meta: {
      description: 'Review the diff again',
      agentType: 'general-purpose',
    },
  })

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)

  // Assert
  assert.deepEqual(formatReportAsText(report).split('\n'), [
    `project ${PROJECT_KEY}  session ${SESSION}  silence limit 20 min`,
    '        astopped001  agent  last write 2026-10-22T07:55:00.000Z  age 125.0 min  size 17 B  stopped   Prepare the PR (general-purpose)',
    'SILENT  astalled002  agent  last write 2026-10-22T08:00:00.000Z  age 120.0 min  size 17 B            Review the diff again (general-purpose)',
    'SILENT rows: 1 of 2 (no write for more than 20 min, not finished or stopped)',
    '',
  ])
  assert.deepEqual(
    report.rows.map(({ id, finished, stopped, silent }) => ({
      id,
      finished,
      stopped,
      silent,
    })),
    [
      { id: 'astopped001', finished: false, stopped: true, silent: false },
      { id: 'astalled002', finished: false, stopped: false, silent: true },
    ],
  )
})

// Value: protects=the state column when a meta carries both flags (a subagent that finished and was stopped afterwards): it shows `finished`, the state that says the work was done, and both JSON flags stay true; fails_when=the order flips and `stopped` hides `finished`, or one flag overwrites the other; why_new=Issue #96 follow-up (a state column that shows one word needs an order); seam=buildRows and formatReportAsText with plain values; no_claim=whether Claude Code ever writes both flags
test('a subagent whose meta says both finished and stoppedByUser shows finished and is not SILENT', () => {
  // Arrange
  const sources = {
    outputs: [],
    transcripts: [
      { id: 'abothflags01', mtimeMs: NOW_MS - 90 * 60_000, sizeBytes: 17 },
    ],
    metas: new Map([
      [
        'abothflags01',
        {
          description: 'Done, then stopped',
          agentType: null,
          finished: true,
          stopped: true,
        },
      ],
    ]),
  }

  // Act
  const rows = buildRows(sources, NOW_MS, 20)
  const text = formatReportAsText({
    projectKey: PROJECT_KEY,
    session: SESSION,
    limitMinutes: 20,
    rows,
  })

  // Assert
  assert.deepEqual(
    {
      flags: rows.map(({ finished, stopped, silent }) => ({
        finished,
        stopped,
        silent,
      })),
      rowLine: text.split('\n')[1],
    },
    {
      flags: [{ finished: true, stopped: true, silent: false }],
      rowLine:
        '        abothflags01  agent  last write 2026-10-22T08:30:00.000Z  age 90.0 min  size 17 B  finished  Done, then stopped',
    },
  )
})

// Value: protects=the meaning of the limit: a row is SILENT only when it is more than the limit old; fails_when=the comparison becomes "at least", so a task exactly at the limit is flagged, or the limit is compared with the rounded age; why_new=Issue #96 (no watchdog existed); seam=buildRows with plain values and a fixed clock; no_claim=files on disk
test('a row exactly at the limit is not SILENT and one a millisecond past it is', () => {
  // Arrange
  const outputs = [
    { id: 'bexactly20', mtimeMs: NOW_MS - 20 * 60_000, sizeBytes: 1 },
    { id: 'bpast20ms', mtimeMs: NOW_MS - 20 * 60_000 - 1, sizeBytes: 1 },
  ]

  // Act
  const rows = buildRows(
    { outputs, transcripts: [], metas: new Map() },
    NOW_MS,
    20,
  )

  // Assert
  assert.deepEqual(
    rows.map(({ id, ageMinutes, silent }) => ({ id, ageMinutes, silent })),
    [
      { id: 'bpast20ms', ageMinutes: 20, silent: true },
      { id: 'bexactly20', ageMinutes: 20, silent: false },
    ],
  )
})

// Value: protects=the real layout of Claude Code, where an agent has two files: its transcript in the projects root and an output file in the tasks folder that is a link to that transcript (measured on the real session: five agents, five links); an agent must be one row with the transcript's last write; fails_when=both files are listed, so every agent appears twice and is counted twice in the SILENT line; why_new=Issue #96 (the brief listed every output file and every transcript, one row each); seam=readReport on fake roots with a link made by symlink; no_claim=a regular output file beside a transcript, which the row builder handles the same way (the newer file wins)
test('an agent whose output file links to its transcript is one row, with the transcript’s last write and size', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  const transcript = await writeSubagent(roots, SESSION, 'alinked0001', {
    lastWrite: minutesBeforeNow(3),
    meta: { description: 'Linked agent', agentType: 'general-purpose' },
  })
  const tasksDirectory = join(roots.tasksRoot, PROJECT_KEY, SESSION, 'tasks')
  await mkdir(tasksDirectory, { recursive: true })
  await symlink(transcript, join(tasksDirectory, 'alinked0001.output'))

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)

  // Assert
  assert.deepEqual(report.rows, [
    {
      id: 'alinked0001',
      kind: 'agent',
      description: 'Linked agent',
      agentType: 'general-purpose',
      finished: false,
      stopped: false,
      lastWrite: '2026-10-22T09:57:00.000Z',
      ageMinutes: 3,
      sizeBytes: 17,
      silent: false,
    },
  ])
})

// Value: protects=a task whose output file is a link to a file outside the folders the watchdog scans (a transcript kept elsewhere): the row shows the last write and size of the file it links to; fails_when=the link is read as a link (lstat), so the task is missing or looks as old as the link itself (90 minutes here); why_new=Issue #96 (the output files of agents are links on the real layout); seam=readReport on fake roots with a link whose own time is set by lutimes; no_claim=where Claude Code keeps the transcript of a nested agent (not measured), only that a link is followed
test('a task output that links to a file elsewhere shows the time and size of that file, not of the link', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  const tasksDirectory = join(roots.tasksRoot, PROJECT_KEY, SESSION, 'tasks')
  await mkdir(tasksDirectory, { recursive: true })
  const target = join(roots.claudeHome, 'elsewhere.jsonl')
  await mkdir(roots.claudeHome, { recursive: true })
  await writeFile(target, 'LINKED-FILE-TEXT')
  await utimes(target, minutesBeforeNow(3), minutesBeforeNow(3))
  const link = join(tasksDirectory, 'blinked00001.output')
  await symlink(target, link)
  // The link itself is old; only following it gives the real last write.
  await lutimes(link, minutesBeforeNow(90), minutesBeforeNow(90))

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)

  // Assert
  assert.deepEqual(
    report.rows.map(
      ({ id, kind, lastWrite, ageMinutes, sizeBytes, silent }) => ({
        id,
        kind,
        lastWrite,
        ageMinutes,
        sizeBytes,
        silent,
      }),
    ),
    [
      {
        id: 'blinked00001',
        kind: 'task',
        lastWrite: '2026-10-22T09:57:00.000Z',
        ageMinutes: 3,
        sizeBytes: 16,
        silent: false,
      },
    ],
  )
})

// Value: protects=the last write of a task that has an output file and a transcript written at different times (a layout without the link): the row shows the newer write and its size, whichever file is newer; fails_when=the first listed file wins, or the transcript always wins, so an active agent looks as old as its stale file; why_new=Issue #96 (the watchdog merges the two files of an agent into one row); seam=buildRows with plain values; no_claim=files on disk
test('when an id has an output file and a transcript written at different times, its row shows the newer write and size', () => {
  // Arrange
  const sources = {
    outputs: [
      { id: 'anewtranscript', mtimeMs: NOW_MS - 90 * 60_000, sizeBytes: 5 },
      { id: 'anewoutput', mtimeMs: NOW_MS - 4 * 60_000, sizeBytes: 7 },
    ],
    transcripts: [
      { id: 'anewtranscript', mtimeMs: NOW_MS - 3 * 60_000, sizeBytes: 9 },
      { id: 'anewoutput', mtimeMs: NOW_MS - 90 * 60_000, sizeBytes: 11 },
    ],
    metas: new Map(),
  }

  // Act
  const rows = buildRows(sources, NOW_MS, 20)

  // Assert
  assert.deepEqual(
    rows.map(({ id, lastWrite, ageMinutes, sizeBytes, silent }) => ({
      id,
      lastWrite,
      ageMinutes,
      sizeBytes,
      silent,
    })),
    [
      {
        id: 'anewoutput',
        lastWrite: '2026-10-22T09:56:00.000Z',
        ageMinutes: 4,
        sizeBytes: 7,
        silent: false,
      },
      {
        id: 'anewtranscript',
        lastWrite: '2026-10-22T09:57:00.000Z',
        ageMinutes: 3,
        sizeBytes: 9,
        silent: false,
      },
    ],
  )
})

// Value: protects=the kind column, which tells a main agent whether a row is a subagent or a shell: a subagent meta or a transcript makes an agent, an output file alone a task; fails_when=an output file with a meta but no transcript is called a task, or a transcript without a meta is; why_new=Issue #96 (the brief's rule: agent when a meta with the same id exists or the file is a transcript); seam=buildRows with plain values; no_claim=files on disk
test('a row is an agent when a subagent meta or a transcript exists for its id, and a task when only an output file does', () => {
  // Arrange
  const file = { mtimeMs: NOW_MS - 60_000, sizeBytes: 1 }
  const sources = {
    outputs: [
      { id: 'bshell00001', ...file },
      { id: 'ametaonly001', ...file },
    ],
    transcripts: [{ id: 'atranscript01', ...file }],
    metas: new Map([
      ['ametaonly001', { description: null, agentType: null, finished: false }],
    ]),
  }

  // Act
  const rows = buildRows(sources, NOW_MS, 20)

  // Assert
  assert.deepEqual(
    rows.map(({ id, kind }) => ({ id, kind })),
    [
      { id: 'ametaonly001', kind: 'agent' },
      { id: 'atranscript01', kind: 'agent' },
      { id: 'bshell00001', kind: 'task' },
    ],
  )
})

// Value: protects=the report against one half-written meta, which Claude Code can leave while it writes: the agent is still listed, without a description, and the other rows are shown; fails_when=an unreadable meta ends the run, so one bad file hides every row; why_new=Issue #96 (the metas are small files written while the watchdog reads); seam=readReport on fake roots with a meta that is cut off; no_claim=what Claude Code writes into a meta (only four fields are read)
test('a meta that is not valid JSON does not stop the report: its agent is listed without a description', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'abroken0001', {
    lastWrite: minutesBeforeNow(1),
  })
  await writeFile(
    join(
      roots.claudeHome,
      'projects',
      PROJECT_KEY,
      SESSION,
      'subagents',
      'agent-abroken0001.meta.json',
    ),
    '{"description":"Cut of',
  )

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)

  // Assert
  assert.deepEqual(
    report.rows.map(({ id, kind, description, agentType, finished }) => ({
      id,
      kind,
      description,
      agentType,
      finished,
    })),
    [
      {
        id: 'abroken0001',
        kind: 'agent',
        description: null,
        agentType: null,
        finished: false,
      },
    ],
  )
})

// Value: protects=a main agent that gives no --session from reading another session's tasks or an empty one: the session whose newest file changed last is shown, and the project's memory folder, which sits beside the sessions in the projects root, is not a session; fails_when=the newest folder is taken whatever it holds (the memory folder, written last, then wins and the report is empty), or the order of the sessions is by name; why_new=Issue #96 (the real projects root holds a memory folder beside two sessions); seam=the script started as a process on fake roots with fixed past times, so only their order matters; no_claim=which session is the caller's own (several active sessions need --session)
test('without --session the session with the most recent write is shown, and a memory folder beside the sessions is never taken for one', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bolder00001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeShellOutput(
    roots,
    OTHER_SESSION,
    'bnewer00002',
    new Date('2020-01-01T01:00:00.000Z'),
  )
  const memoryDirectory = join(
    roots.claudeHome,
    'projects',
    PROJECT_KEY,
    'memory',
  )
  await mkdir(memoryDirectory, { recursive: true })
  const note = join(memoryDirectory, 'MEMORY.md')
  await writeFile(note, 'a note')
  await utimes(
    note,
    new Date('2020-01-01T02:00:00.000Z'),
    new Date('2020-01-01T02:00:00.000Z'),
  )

  // Act
  const result = runWatch(roots, ['--json'])

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    {
      code: result.code,
      session: report.session,
      ids: report.rows.map(({ id }) => id),
    },
    { code: 0, session: OTHER_SESSION, ids: ['bnewer00002'] },
  )
})

// Value: protects=a main agent that runs the watchdog after a reboot, which clears the tasks root in /tmp but leaves the subagent transcripts in ~/.claude: the session is still found and its agents are listed; fails_when=only the tasks root is searched for the newest session, so the run exits 1 although the transcripts exist; why_new=Issue #96 (the tasks root lives in /tmp); seam=the script started as a process on fake roots with no tasks root at all; no_claim=a shell, whose output file does not outlive the reboot
test('without --session a session that only the projects root knows is found when the tasks root is gone', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'afinished01', {
    lastWrite: new Date('2020-01-01T00:00:00.000Z'),
    meta: { description: 'Review the diff', finished: true },
  })

  // Act
  const result = runWatch(roots, ['--json'])

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    {
      code: result.code,
      session: report.session,
      ids: report.rows.map(({ id }) => id),
    },
    { code: 0, session: SESSION, ids: ['afinished01'] },
  )
})

// Value: protects=--session, which pins a caller to its own session when several are active; fails_when=the option is ignored and the newest session is shown instead; why_new=Issue #96 (the real project folder holds two sessions at once); seam=the script started as a process on fake roots with fixed past times; no_claim=where the caller finds its own session id
test('--session shows the named session even when another session wrote more recently', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bolder00001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeShellOutput(
    roots,
    OTHER_SESSION,
    'bnewer00002',
    new Date('2020-01-01T01:00:00.000Z'),
  )

  // Act
  const result = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    { session: report.session, ids: report.rows.map(({ id }) => id) },
    { session: SESSION, ids: ['bolder00001'] },
  )
})

// Value: protects=a main agent that gives no option inside Claude Code: it must see its own session, which CLAUDE_CODE_SESSION_ID names, and not another session that wrote more recently (the real project folder holds two sessions at once); fails_when=the variable is ignored and the most recently active session is shown, or the newer session wins over it; why_new=Issue #96 follow-up (the default session is the current one); seam=the script started as a process on fake roots, with the variable set in its environment and fixed past times; no_claim=that Claude Code sets the variable in every shell it starts (measured in the Bash tool of one Mac)
test('without --session the session named by CLAUDE_CODE_SESSION_ID is shown even when another session wrote more recently', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bcurrent001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeShellOutput(
    roots,
    OTHER_SESSION,
    'bnewer00002',
    new Date('2020-01-01T01:00:00.000Z'),
  )

  // Act
  const result = runWatch(roots, ['--json'], {
    environment: { CLAUDE_CODE_SESSION_ID: SESSION },
  })

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    {
      code: result.code,
      session: report.session,
      ids: report.rows.map(({ id }) => id),
    },
    { code: 0, session: SESSION, ids: ['bcurrent001'] },
  )
})

// Value: protects=a caller outside Claude Code, or in a shell without the variable: with CLAUDE_CODE_SESSION_ID unset or empty the most recently active session is shown, as before the variable was read; fails_when=an empty variable is taken for a session name (the run ends with exit 1 for a session called ""), or an unset one stops the run; why_new=Issue #96 follow-up (the fallback of the new default); seam=the script started as a process on fake roots, once with the variable removed from its environment and once set to an empty text; no_claim=a variable of blank spaces, which is refused like any other bad name
test('an unset or empty CLAUDE_CODE_SESSION_ID falls back to the session with the most recent write', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bolder00001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeShellOutput(
    roots,
    OTHER_SESSION,
    'bnewer00002',
    new Date('2020-01-01T01:00:00.000Z'),
  )

  // Act
  const unset = runWatch(roots, ['--json'])
  const empty = runWatch(roots, ['--json'], {
    environment: { CLAUDE_CODE_SESSION_ID: '' },
  })

  // Assert
  assert.deepEqual(
    [unset, empty].map(({ code, stdout }) => ({
      code,
      session: JSON.parse(stdout).session,
    })),
    [
      { code: 0, session: OTHER_SESSION },
      { code: 0, session: OTHER_SESSION },
    ],
  )
})

// Value: protects=--session as the caller's explicit choice, which must win over the session that the environment names; fails_when=the variable overrides the option, so a caller who looks at another session is shown the current one; why_new=Issue #96 follow-up (precedence of the new default); seam=the script started as a process on fake roots, with the variable naming the other session; no_claim=the order of the two when the option is invalid (the option is refused first)
test('--session wins over CLAUDE_CODE_SESSION_ID', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bchosen0001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeShellOutput(
    roots,
    OTHER_SESSION,
    'bcurrent002',
    new Date('2020-01-01T01:00:00.000Z'),
  )

  // Act
  const result = runWatch(roots, ['--session', SESSION, '--json'], {
    environment: { CLAUDE_CODE_SESSION_ID: OTHER_SESSION },
  })

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    { session: report.session, ids: report.rows.map(({ id }) => id) },
    { session: SESSION, ids: ['bchosen0001'] },
  )
})

// Value: protects=a wrong environment, a CLAUDE_CODE_SESSION_ID that is no folder name (a path, for example), which must stop the run with exit 2 and the variable's name, as a bad --session does; fails_when=the value is used unchecked (`../elsewhere` is joined into the folder paths) or skipped for the most recently active session; why_new=Issue #96 follow-up (the variable is validated like --session); seam=the script started as a process on fake roots with the variable set to a path; no_claim=the wording of the line beyond what this test pins
test('a CLAUDE_CODE_SESSION_ID that is no folder name exits 2 and names the variable', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))

  // Act
  const result = runWatch(roots, ['--json'], {
    environment: { CLAUDE_CODE_SESSION_ID: '../elsewhere' },
  })

  // Assert
  assert.deepEqual(result, {
    code: 2,
    stdout: '',
    stderr:
      'watch-background: CLAUDE_CODE_SESSION_ID must be one folder name of letters, digits, "_", "." and "-", got "../elsewhere".\n',
  })
})

// Value: protects=the rule that a CLAUDE_CODE_SESSION_ID that is set is never skipped: when its session has no folder in either root (it has started no background task or subagent yet), the run ends with exit 1 and the paths, and does not show another session's tasks as if they were the caller's; fails_when=the run falls back to the most recently active session when the named one is missing; why_new=Issue #96 follow-up (the coordinator's rule: fall back only when the variable is unset or empty); seam=the script started as a process on fake roots that hold only another session; no_claim=whether Claude Code creates the session folders before the first task (not measured)
test('a CLAUDE_CODE_SESSION_ID with no folder in either root exits 1 and does not fall back to another session', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, OTHER_SESSION, 'bshell00001', minutesAgo(1))

  // Act
  const result = runWatch(roots, ['--json'], {
    environment: { CLAUDE_CODE_SESSION_ID: SESSION },
  })

  // Assert
  assert.deepEqual(result, {
    code: 1,
    stdout: '',
    stderr: `watch-background: no folder for session ${SESSION}; looked in ${join(roots.tasksRoot, PROJECT_KEY, SESSION)} and ${join(roots.claudeHome, 'projects', PROJECT_KEY, SESSION)}\n`,
  })
})

// Value: protects=the machine-readable report that a script or a main agent parses; fails_when=a field is renamed, dropped or added (`stopped` beside `finished` included), the top level changes from { projectKey, session, limitMinutes, rows }, the last write stops being ISO 8601, or a shell stops being kind task with null description and agent type; why_new=Issue #96 (no watchdog existed); seam=the script started as a process on fake roots with fixed past times, so the last writes and the SILENT marks do not depend on the clock; no_claim=the exact age, which follows the clock of the run
test('--json prints projectKey, session, limitMinutes and rows with the documented fields', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bshell00001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await writeSubagent(roots, SESSION, 'afinished01', {
    lastWrite: new Date('2020-01-01T00:10:00.000Z'),
    meta: {
      description: 'Review the diff',
      agentType: 'general-purpose',
      finished: true,
    },
  })
  await writeSubagent(roots, SESSION, 'astopped001', {
    lastWrite: new Date('2020-01-01T00:20:00.000Z'),
    meta: {
      description: 'Prepare the PR',
      agentType: 'general-purpose',
      stoppedByUser: true,
    },
  })

  // Act
  const result = runWatch(roots, [
    '--session',
    SESSION,
    '--minutes',
    '15',
    '--json',
  ])

  // Assert
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    { code: result.code, stderr: result.stderr, keys: Object.keys(report) },
    {
      code: 0,
      stderr: '',
      keys: ['projectKey', 'session', 'limitMinutes', 'rows'],
    },
  )
  assert.deepEqual(
    {
      projectKey: report.projectKey,
      session: report.session,
      limitMinutes: report.limitMinutes,
      rows: report.rows.map((row) => ({
        ...row,
        ageMinutes: typeof row.ageMinutes,
      })),
    },
    {
      projectKey: PROJECT_KEY,
      session: SESSION,
      limitMinutes: 15,
      rows: [
        {
          id: 'bshell00001',
          kind: 'task',
          description: null,
          agentType: null,
          finished: false,
          stopped: false,
          lastWrite: '2020-01-01T00:00:00.000Z',
          ageMinutes: 'number',
          sizeBytes: 18,
          silent: true,
        },
        {
          id: 'afinished01',
          kind: 'agent',
          description: 'Review the diff',
          agentType: 'general-purpose',
          finished: true,
          stopped: false,
          lastWrite: '2020-01-01T00:10:00.000Z',
          ageMinutes: 'number',
          sizeBytes: 17,
          silent: false,
        },
        {
          id: 'astopped001',
          kind: 'agent',
          description: 'Prepare the PR',
          agentType: 'general-purpose',
          finished: false,
          stopped: true,
          lastWrite: '2020-01-01T00:20:00.000Z',
          ageMinutes: 'number',
          sizeBytes: 17,
          silent: false,
        },
      ],
    },
  )
})

// Value: protects=a caller that names a session which does not exist, which must learn that from the exit code and from the paths it can check, not from an empty report; fails_when=the run exits 0 with no rows, prints on stdout, or names fewer than both roots' folders; why_new=Issue #96 (exit 1 is the watchdog's "nothing to read" answer); seam=the script started as a process on fake roots that hold another session; no_claim=a session folder that exists in one root only, which is read
test('a named session with no folder in either root exits 1 and names both paths on one stderr line', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))

  // Act
  const result = runWatch(roots, ['--session', 'missing-session'])

  // Assert
  assert.deepEqual(result, {
    code: 1,
    stdout: '',
    stderr: `watch-background: no folder for session missing-session; looked in ${join(roots.tasksRoot, PROJECT_KEY, 'missing-session')} and ${join(roots.claudeHome, 'projects', PROJECT_KEY, 'missing-session')}\n`,
  })
})

// Value: protects=a caller in the wrong project folder (or one whose Claude Code files live elsewhere), which must get exit 1 and the project paths that were searched; fails_when=a project with no folder gives exit 0 and an empty report; why_new=Issue #96 (exit 1 covers the project folders too); seam=the script started as a process on empty fake roots; no_claim=a project folder that exists and holds no session, which ends the same way
test('a project with no folder in either root exits 1 and names both project paths when no session is named', async (context) => {
  // Arrange
  const roots = await createRoots(context)

  // Act
  const result = runWatch(roots, [])

  // Assert
  assert.deepEqual(result, {
    code: 1,
    stdout: '',
    stderr: `watch-background: no session with background tasks or subagents for project key ${PROJECT_KEY}; looked in ${join(roots.tasksRoot, PROJECT_KEY)} and ${join(roots.claudeHome, 'projects', PROJECT_KEY)}\n`,
  })
})

// Value: protects=a caller's typo in an option, which must stop the run with exit 2, the option's name and the list of valid options (the script has no --help) instead of showing a report for the wrong question; fails_when=an unknown option is ignored, ends with another code, prints a report or a stack trace, or the line no longer names it or lists the options; why_new=Issue #96 (exit 2 is the watchdog's "bad option" answer); seam=the script started as a process on fake roots; no_claim=the wording of Node's parser before the list, only that the line names the option
test('an unknown option exits 2, names it and lists the valid options on one stderr line, and prints no report', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))

  // Act
  const result = runWatch(roots, ['--bogus'])

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stdout: result.stdout,
      namesTheOption:
        result.stderr.startsWith('watch-background: ') &&
        result.stderr.includes('--bogus'),
      listsTheOptions: result.stderr.endsWith(
        '. Options: --project <path>, --session <id>, --minutes <n>, --json, --tasks-root <dir>, --claude-home <dir>.\n',
      ),
      isOneLine: isOneLine(result.stderr),
    },
    {
      code: 2,
      stdout: '',
      namesTheOption: true,
      listsTheOptions: true,
      isOneLine: true,
    },
  )
})

// Value: protects=the values that decide what the watchdog reports: a limit that is 0, negative or no number, an id that is a path, an empty project; fails_when=such a value is accepted (a limit of 0 flags every row, `../x` reads another folder) or the refusal names another option or runs over several lines; why_new=Issue #96 (no watchdog existed); seam=the script started as a process on fake roots; no_claim=the wording of the messages, only that each is one line whose first option is the bad one
test('a --minutes, --session or --project value that cannot be used exits 2 and names its option', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  const badCalls = [
    ['--minutes', '0'],
    ['--minutes', 'abc'],
    ['--minutes', '-5'],
    ['--session', '../elsewhere'],
    ['--project', ''],
  ]

  // Act
  const outcomes = badCalls.map((extraArguments) => {
    const { code, stdout, stderr } = runWatch(roots, extraArguments)
    return {
      code,
      stdout,
      firstOptionNamed: stderr.match(/--[a-z-]+/)?.[0],
      isOneLine: isOneLine(stderr),
    }
  })

  // Assert
  assert.deepEqual(outcomes, [
    { code: 2, stdout: '', firstOptionNamed: '--minutes', isOneLine: true },
    { code: 2, stdout: '', firstOptionNamed: '--minutes', isOneLine: true },
    { code: 2, stdout: '', firstOptionNamed: '--minutes', isOneLine: true },
    { code: 2, stdout: '', firstOptionNamed: '--session', isOneLine: true },
    { code: 2, stdout: '', firstOptionNamed: '--project', isOneLine: true },
  ])
})

// Value: protects=the rule that the watchdog reads metadata only: no text of an output file or a transcript, and no meta field beyond description, agentType, finished and stoppedByUser, may reach the report that a main agent (and the owner's terminal) reads; fails_when=the script prints or parses more of a file than the four meta fields, for example a tail of a transcript or a tool use id; why_new=Issue #96 (the files hold full transcripts); seam=the script started as a process on fake roots whose files and meta carry marker text; no_claim=files the script never lists
test('neither report shows output text, transcript text or a meta field beyond description, agentType, finished and stoppedByUser', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))
  await writeSubagent(roots, SESSION, 'aagent000001', {
    lastWrite: minutesAgo(1),
    meta: {
      description: 'Visible description',
      agentType: 'general-purpose',
      toolUseId: 'toolu_META_SECRET',
      requestShape: 'background',
    },
  })

  // Act
  const text = runWatch(roots, ['--session', SESSION])
  const json = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  assert.deepEqual(
    [text, json].map(({ code, stdout, stderr }) => ({
      code,
      stderr,
      showsTheDescription: stdout.includes('Visible description'),
      leaksFileText: /SECRET|background/.test(stdout),
    })),
    [
      { code: 0, stderr: '', showsTheDescription: true, leaksFileText: false },
      { code: 0, stderr: '', showsTheDescription: true, leaksFileText: false },
    ],
  )
})

// Value: protects=the one-line-per-row report against a description that an agent wrote with a newline or a terminal escape, and against a very long one; fails_when=the control characters reach the text report (the row splits, or the terminal obeys the escape) or a description of any length is printed whole; why_new=Issue #96 (descriptions are free text from agents, read by an agent and printed to a terminal); seam=readReport and formatReportAsText on fake roots; no_claim=an id or a session name with such characters, which are skipped (the tests on names with control characters below)
test('a description with a newline or a terminal escape is shown on one line without those characters, and a very long one is cut', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'amessy000001', {
    lastWrite: minutesBeforeNow(1),
    meta: { description: 'Review\nthe diff\u001b[31m red' },
  })
  await writeSubagent(roots, SESSION, 'along000001', {
    lastWrite: minutesBeforeNow(2),
    meta: { description: 'x'.repeat(300) },
  })

  // Act
  const report = await readReport(watchOptions(roots), NOW_MS)
  const text = formatReportAsText(report)

  // Assert
  assert.deepEqual(
    {
      descriptions: report.rows.map(({ description }) => description),
      lineCount: text.split('\n').length,
      hasEscape: text.includes('\u001b'),
    },
    {
      descriptions: ['x'.repeat(200) + '…', 'Review the diff [31m red'],
      // header, two rows, the count line and the empty text after the final newline
      lineCount: 5,
      hasEscape: false,
    },
  )
})

// Value: protects=the terminal, and the agent that reads the report, from a name that someone else put into the shared tasks folder (/tmp is shared space): a task output whose name has a control character, or any character beyond letters, digits, `_`, `.` and `-`, is skipped, and no character of that name reaches stdout; fails_when=such a name is listed (the text report prints an id as it is, so the escape sequence clears the screen and sets the window title, and a newline starts a fake row), or the rule is widened by one character class; why_new=Issue #96 review (ids from file names were printed raw); seam=the script started as a process on fake roots, with one task file for each name of the table, each with exactly one thing wrong (the review's example first); no_claim=that the script checks who owns the folders (it does not)
test('a task output whose name has a control character or any character beyond letters, digits, "_", "." and "-" is skipped and nothing of its name reaches stdout', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bgood000001', minutesAgo(1))
  const tasksDirectory = join(roots.tasksRoot, PROJECT_KEY, SESSION, 'tasks')
  await Promise.all(
    ODD_NAMES.map((name) =>
      writeFile(join(tasksDirectory, `${name}.output`), SHELL_OUTPUT_TEXT),
    ),
  )

  // Act
  const text = runWatch(roots, ['--session', SESSION])
  const json = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  assert.deepEqual(
    {
      codes: [text.code, json.code],
      stderrs: [text.stderr, json.stderr],
      controlCharacters: controlCharactersIn(text.stdout),
      mentionsAnOddName: ODD_NAME_MARKERS.test(text.stdout + json.stdout),
      ids: JSON.parse(json.stdout).rows.map(({ id }) => id),
    },
    {
      codes: [0, 0],
      stderrs: ['', ''],
      controlCharacters: [],
      mentionsAnOddName: false,
      ids: ['bgood000001'],
    },
  )
})

// Value: protects=the terminal, and the agent that reads the report, from a transcript name that someone else put into the projects folder: a transcript whose name has a control character, or any character beyond letters, digits, `_`, `.` and `-`, is skipped, and no character of that name reaches stdout; fails_when=such a name is listed as the id of an agent, so the text report prints it, or the rule is widened by one character class; why_new=Issue #96 review (ids from file names were printed raw); seam=the script started as a process on fake roots, with one transcript for each name of the table beside a good one; no_claim=a meta file with such a name, which is never listed (metas are opened by the id of a listed file)
test('a subagent transcript whose name has a control character or any character beyond letters, digits, "_", "." and "-" is skipped and nothing of its name reaches stdout', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeSubagent(roots, SESSION, 'agood0000001', {
    lastWrite: minutesAgo(1),
    meta: { description: 'Good agent', agentType: 'general-purpose' },
  })
  const subagentsDirectory = join(
    roots.claudeHome,
    'projects',
    PROJECT_KEY,
    SESSION,
    'subagents',
  )
  await Promise.all(
    ODD_NAMES.map((name) =>
      writeFile(
        join(subagentsDirectory, `agent-${name}.jsonl`),
        TRANSCRIPT_TEXT,
      ),
    ),
  )

  // Act
  const text = runWatch(roots, ['--session', SESSION])
  const json = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  assert.deepEqual(
    {
      codes: [text.code, json.code],
      stderrs: [text.stderr, json.stderr],
      controlCharacters: controlCharactersIn(text.stdout),
      mentionsAnOddName: ODD_NAME_MARKERS.test(text.stdout + json.stdout),
      ids: JSON.parse(json.stdout).rows.map(({ id }) => id),
    },
    {
      codes: [0, 0],
      stderrs: ['', ''],
      controlCharacters: [],
      mentionsAnOddName: false,
      ids: ['agood0000001'],
    },
  )
})

// Value: protects=a main agent that gives no session from being shown, in the header, a folder name that someone else created in the shared tasks root or in the projects root: a folder whose name has a control character, or any character beyond letters, digits, `_`, `.` and `-`, is never taken for a session, even when it holds the newest file; fails_when=such a folder is chosen as the newest session and its name is printed, the rule covers only one of the two roots, or it is widened by one character class; why_new=Issue #96 review (the automatically chosen session name was printed raw); seam=the script started as a process on fake roots, with one such folder for each name of the table in both roots, holding the newest files; no_claim=a folder with a plain name that someone else created (it is a session like any other)
test('a session folder whose name has a control character or any character beyond letters, digits, "_", "." and "-" is never taken for the newest session and nothing of its name reaches stdout', async (context) => {
  // Arrange: the odd folders hold the newest files of both roots, so only the name rule keeps them from being chosen.
  const roots = await createRoots(context)
  await writeShellOutput(
    roots,
    SESSION,
    'bgood000001',
    new Date('2020-01-01T00:00:00.000Z'),
  )
  await Promise.all(
    ODD_NAMES.flatMap((name) => [
      writeShellOutput(
        roots,
        name,
        'bodd00000001',
        new Date('2020-01-01T05:00:00.000Z'),
      ),
      writeSubagent(roots, name, 'aodd000000001', {
        lastWrite: new Date('2020-01-01T06:00:00.000Z'),
      }),
    ]),
  )

  // Act
  const text = runWatch(roots, [])
  const json = runWatch(roots, ['--json'])

  // Assert
  assert.deepEqual(
    {
      codes: [text.code, json.code],
      stderrs: [text.stderr, json.stderr],
      header: text.stdout.split('\n')[0],
      controlCharacters: controlCharactersIn(text.stdout),
      mentionsAnOddName: ODD_NAME_MARKERS.test(text.stdout + json.stdout),
      session: JSON.parse(json.stdout).session,
      ids: JSON.parse(json.stdout).rows.map(({ id }) => id),
    },
    {
      codes: [0, 0],
      stderrs: ['', ''],
      header: `project ${PROJECT_KEY}  session ${SESSION}  silence limit 20 min`,
      controlCharacters: [],
      mentionsAnOddName: false,
      session: SESSION,
      ids: ['bgood000001'],
    },
  )
})

// Value: protects=the start of the script when it is reached through a symbolic link, as every path under /tmp is on macOS (/tmp is a link to /private/tmp, where a worktree like this one lives); fails_when=the check that tells the script from an import compares the link's path with the real path, so the script prints nothing and exits 0; why_new=Issue #96 (the file both exports functions for tests and runs as a script); seam=the script started as a process through a link to it; no_claim=a Node older than the repository's 24
test('the script runs and prints its report when it is started through a symbolic link to it', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))
  const linkDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-watch-background-link-'),
  )
  context.after(() => rm(linkDirectory, { recursive: true, force: true }))
  const link = join(linkDirectory, 'watch.mjs')
  await symlink(SCRIPT_PATH, link)

  // Act
  const result = runWatch(roots, ['--session', SESSION, '--json'], {
    scriptPath: link,
  })

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stderr: result.stderr,
      ids: JSON.parse(result.stdout).rows.map(({ id }) => id),
    },
    { code: 0, stderr: '', ids: ['bshell00001'] },
  )
})

// Value: protects=every test and tool that imports the script for its functions: the import must print nothing, read no folder and end with code 0; fails_when=the entry point runs on import (the guard is dropped, or asks about the wrong module), so the importing process prints a report or a refusal and ends with a failure code; why_new=Issue #96 review (the start-up check moved into a shared helper, which this test keeps wired to the right module); seam=an importer module in an empty folder, started as a process, that imports the script, with the session and project variables removed from its environment; no_claim=the helper's own cases, which isRunAsScript.test.mjs covers
test('importing the script from another module prints nothing and ends with code 0', async (context) => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-watch-background-import-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const importerPath = join(directory, 'importer.mjs')
  await writeFile(importerPath, `import ${JSON.stringify(SCRIPT_URL.href)}\n`)

  // Act
  const result = spawnSync(process.execPath, [importerPath], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 30_000,
    env: inheritedEnvironment(),
  })

  // Assert
  assert.deepEqual(
    { code: result.status, stdout: result.stdout, stderr: result.stderr },
    { code: 0, stdout: '', stderr: '' },
  )
})

// Value: protects=the watchdog against the files of a task that is cleaned up while it lists them: a link whose target is gone must be skipped, not end the run; fails_when=the missing target makes stat throw out of the run (a stack trace and a wrong exit code), or the row is shown with an invented time; why_new=Issue #96 (a shell's output file vanished between two runs on the real session); seam=the script started as a process on fake roots with a link to a file that does not exist; no_claim=the race itself, which a link to nothing reproduces at the stat call
test('an output file whose link target is gone is skipped and the other rows are still shown', async (context) => {
  // Arrange
  const roots = await createRoots(context)
  await writeShellOutput(roots, SESSION, 'bshell00001', minutesAgo(1))
  await symlink(
    join(roots.claudeHome, 'gone.jsonl'),
    join(roots.tasksRoot, PROJECT_KEY, SESSION, 'tasks', 'agone0000001.output'),
  )

  // Act
  const result = runWatch(roots, ['--session', SESSION, '--json'])

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stderr: result.stderr,
      ids: JSON.parse(result.stdout).rows.map(({ id }) => id),
    },
    { code: 0, stderr: '', ids: ['bshell00001'] },
  )
})
