import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  findClosingReferences,
  findPullRequestCommands,
  listClosingKeywordRefusals,
  splitCommandSegments,
} from '../refuse-closing-keywords.mjs'

const HOOK_SCRIPT = fileURLToPath(
  new URL('../refuse-closing-keywords.mjs', import.meta.url),
)
/** A child process that does not end within this time is killed, so a hook that hangs fails its test instead of the run. */
const CHILD_TIMEOUT_MS = 10_000
/** The sentence that ends every refusal on standard error. */
const REFUSAL_FIX =
  'Write a non-closing reference such as `Refs #N` instead, or allow a deliberate closing reference by prefixing the command with `CODEBOOK_ALLOW_CLOSING_KEYWORD=1`.'

/**
 * Creates a temporary folder that holds the given files; the test context removes it afterwards.
 *
 * Why: the hook reads the files a command names, so a test needs real ones.
 * Called by the tests below that put a file path into a command.
 *
 * @param context - The test context; its `after` hook removes the folder.
 * @param files - The file contents by path relative to the folder; folders on the way are created.
 * @returns The absolute path of the folder.
 *
 * @example
 * ```js
 * const directory = await temporaryDirectory(context, { 'b.md': 'Refs #1\n' })
 * ```
 */
async function temporaryDirectory(context, files) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-refuse-closing-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, relativePath)), { recursive: true })
    await writeFile(join(directory, relativePath), content)
  }
  return directory
}

/**
 * Builds the `PreToolUse` event Claude Code sends for a Bash command.
 *
 * Called by the tests below.
 *
 * @param command - The command line the model asked to run.
 * @param cwd - The folder Claude Code reports as the current one.
 * @returns The event object.
 *
 * @example
 * ```js
 * bashEvent('git status', '/repo') // => { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: '/repo' }
 * ```
 */
function bashEvent(command, cwd) {
  return { tool_name: 'Bash', tool_input: { command }, cwd }
}

/**
 * Starts the hook command as Claude Code does: Node runs the script, and the event's JSON arrives on standard input.
 *
 * Called by the tests below for every exit-code case.
 *
 * @param input - The event object, or a raw string for input that is no JSON.
 * @param options - Options of the child process: `cwd` and `env`. The environment is empty unless given, so a variable of the developer's shell cannot change a result.
 * @returns The child's exit code and what it wrote to standard output and standard error. A child that does not end within {@link CHILD_TIMEOUT_MS} is killed and has the status `null`.
 *
 * @example
 * ```js
 * runHook(bashEvent('git status', '/repo')) // => { status: 0, stdout: '', stderr: '' }
 * ```
 */
function runHook(input, options = {}) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [HOOK_SCRIPT],
    {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: {},
      timeout: CHILD_TIMEOUT_MS,
      ...options,
    },
  )
  return { status, stdout, stderr }
}

/**
 * Reads the words of the commands of a command line, in the order they run; redirections, groups and substitutions are left out.
 *
 * Called by the lexer tests below.
 *
 * @param commandLine - The command line.
 * @returns One list of words per command.
 *
 * @example
 * ```js
 * wordsOf('ls -l 2>&1 | wc') // => [['ls', '-l'], ['wc']]
 * ```
 */
function wordsOf(commandLine) {
  return splitCommandSegments(commandLine)
    .events.filter((event) => event.type === 'segment')
    .map((segment) => segment.words)
}

// Value: protects=Issues staying open until their closing comment: a pull request description that puts Close right before an Issue number is refused, naming the file and the line (PR #91's "Close #90" closed Issue #90 at the merge); fails_when=a --body-file whose line 3 says "Close #90 after the merge." is let through, the exit code is not 2, the message leaves out the file or the line number, or it prints a line of the file that does not match; why_new=Issue #98; seam=the hook as Claude Code starts it (child process, JSON on standard input) over a real temporary file; no_claim=that Claude Code blocks the command on exit code 2, which is its own contract
test('refuses a pull request whose body file puts Close right before an Issue number on line 3, and names the file and the line', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md':
      '## Summary\nAdds the hook.\nClose #90 after the merge.\n\n## Test plan\n- ran the tests\n',
  })
  const bodyFile = join(directory, 'body.md')
  const event = bashEvent(
    `gh pr create --title "Add the hook" --body-file ${bodyFile}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${bodyFile}, line 3: Close #90 after the merge.\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the normal way to link a pull request to an Issue without closing it; fails_when=a body file that only says Refs #N is refused, so the hook blocks the very fix it asks for; why_new=Issue #98; seam=child process over a real temporary file; no_claim=none beyond protects
test('lets a pull request through whose body file only refers to Issues with Refs', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': '## Summary\nRefs #90\nRefs laststance/codebook#98\n',
  })
  const event = bashEvent(
    `gh pr create --title t --body-file ${join(directory, 'body.md')}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the description written inline, which has no file to name; fails_when=an inline --body "fixes #3" is let through, or the message does not name the option and the line; why_new=Issue #98; seam=child process; no_claim=none beyond protects
test('refuses an inline --body that says fixes #3, and names the option and the line', () => {
  // Arrange
  const event = bashEvent('gh pr create --title t --body "fixes #3"', '/tmp')

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 1: fixes #3\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the check of a body file that the command names by a relative path, as a model usually does; fails_when=a relative path is read from the hook's own folder (the test runs it from extension/, where b.md does not exist) instead of the cwd of the hook input, so the file is not found and the keyword passes; why_new=Issue #98; seam=child process over a real temporary file; no_claim=a directory change earlier in the command line (see the cd and pushd tests)
test('resolves the relative --body-file of gh pr edit against the cwd of the hook input', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'b.md': 'Resolves #4 once it lands.\n',
  })
  const event = bashEvent('gh pr edit 12 --body-file b.md', directory)

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'b.md')}, line 1: Resolves #4 once it lands.\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the check when the hook input carries no cwd; fails_when=a relative path is then not read from the hook process's own folder, so the keyword passes; why_new=Issue #98; seam=child process started in a real temporary folder; no_claim=none beyond protects
test("resolves a relative --body-file against the hook process's own folder when the input has no cwd", async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'b.md': 'Resolves #4 once it lands.\n',
  })
  const event = {
    tool_name: 'Bash',
    tool_input: { command: 'gh pr edit 12 --body-file b.md' },
  }
  // A process reports its folder by the real path (on macOS /var is a link to /private/var).
  const realFile = join(await realpath(directory), 'b.md')

  // Act
  const result = runHook(event, { cwd: directory })

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${realFile}, line 1: Resolves #4 once it lands.\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the path /ship takes for an existing pull request's description, gstack-post pr-body, which a model calls by its full path; fails_when=a program called as ~/.claude/skills/gstack/bin/gstack-post is not recognized, so its --body-file is never read; why_new=Issue #98; seam=child process over a real temporary file; no_claim=that gstack-post itself runs
test('refuses a closing keyword in the body file of gstack-post pr-body, called by its full path', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': '## Summary\nFixes #12 in this change.\n',
  })
  const bodyFile = join(directory, 'body.md')
  const event = bashEvent(
    `~/.claude/skills/gstack/bin/gstack-post pr-body 12 --body-file ${bodyFile}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${bodyFile}, line 2: Fixes #12 in this change.\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the title of a pull request, which GitHub also reads for a closing keyword; fails_when=gstack-post pr-create's --title-file is left unread, or the refusal names the clean body file instead of the title file; why_new=Issue #98; seam=child process over two real temporary files; no_claim=none beyond protects
test('names only the title file of gstack-post pr-create when the title carries the keyword and the body does not', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'title.txt': 'v0.2.33.0 fix #98: refuse closing keywords\n',
    'body.md': '## Summary\nRefs #98\n',
  })
  const titleFile = join(directory, 'title.txt')
  const bodyFile = join(directory, 'body.md')
  const event = bashEvent(
    `~/.claude/skills/gstack/bin/gstack-post pr-create --base main --draft --title-file ${titleFile} --body-file ${bodyFile}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${titleFile}, line 1: v0.2.33.0 fix #98: refuse closing keywords\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=a refusal that lists every match, so one retry fixes them all; fails_when=the hook stops at the first file, or prints the files in another order than the command lists them; why_new=Issue #98; seam=child process over two real temporary files; no_claim=none beyond protects
test('names the title file and the body file, in the order the command lists them, when both carry a keyword', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'title.txt': 'Closes #98\n',
    'body.md': 'Intro\nResolved #98\n',
  })
  const titleFile = join(directory, 'title.txt')
  const bodyFile = join(directory, 'body.md')
  const event = bashEvent(
    `gstack-post pr-create --base main --title-file ${titleFile} --body-file ${bodyFile}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${titleFile}, line 1: Closes #98\nClosing keyword before an Issue number in ${bodyFile}, line 2: Resolved #98\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the cross-repository form, which GitHub honors as it does #N; fails_when=a keyword with a colon before owner/repo#7 is let through; why_new=Issue #98; seam=child process; no_claim=none beyond protects
test('refuses Resolves: owner/repo#7, the form that closes an Issue of another repository', () => {
  // Arrange
  const event = bashEvent(
    "gh pr edit 12 --body 'Resolves: owner/repo#7'",
    '/tmp',
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 1: Resolves: owner/repo#7\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the URL form, which GitHub honors as it does #N; fails_when=a keyword before a github.com Issue URL is let through; why_new=Issue #98; seam=child process; no_claim=hosts other than github.com
test('refuses a closing keyword before the URL of a GitHub Issue', () => {
  // Arrange
  const event = bashEvent(
    "gh pr edit 12 --body 'Closes https://github.com/laststance/codebook/issues/98'",
    '/tmp',
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 1: Closes https://github.com/laststance/codebook/issues/98\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=ordinary words that contain or resemble a keyword; fails_when=the word boundary is lost, so "unclosed #5" or "prefix #4" is refused, a hyphenated "fixed-width #5" is refused, or a keyword with no number ("Closes the loop") is refused; why_new=Issue #98; seam=child process over a real temporary file; no_claim=every English word that is not a keyword
test('lets a body file through whose lines only resemble a closing reference', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md':
      'unclosed #5\nfixed-width #5\nprefix #4\nfixing #4\nCloses the loop\nA fix for 5 cases\n',
  })
  const event = bashEvent(
    `gh pr edit 12 --body-file ${join(directory, 'body.md')}`,
    directory,
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the hook staying out of commands that write no pull request text, which run on every Bash call of a session, and out of comments, which close no Issue; fails_when=git status, an Issue read, a pull request read, or a comment on a pull request (gh pr comment, gstack-post pr-comment) whose text says "Fixes #3" is blocked or prints anything; why_new=Issue #98; seam=child process over a real temporary file; no_claim=commit messages and Issue comments, which the hook does not read
test('lets commands through that write no pull request text, comments on a pull request included', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'comment.md': 'Fixes #3\n',
  })
  const commentFile = join(directory, 'comment.md')
  const commands = [
    'git status',
    'gh issue view 98',
    'gh pr view 98 --json body',
    "gh pr comment 98 --body 'Fixes #3'",
    `gstack-post pr-comment 98 --body-file ${commentFile}`,
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=a pull request command inside $( … ), backticks or ( … ), as when its URL is captured (PR_URL=$(gh pr create …)), also when the substitution is in double quotes; fails_when=a parenthesis stays part of a word, or a double-quoted substitution is taken for plain text, so the command is never recognized, or its last word keeps a ")" and the file is not found; why_new=Issue #98; seam=child process over a real temporary file; no_claim=none beyond protects
test('refuses a closing keyword in a pull request command inside $( … ), a double-quoted $( … ), backticks or a subshell', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': 'Closes #1\n',
  })
  const bodyFile = join(directory, 'body.md')
  const commands = [
    "PR_URL=$(gh pr create --title t --body 'Closes #1')",
    'PR_URL="$(gh pr create --title t --body \'Closes #1\')"',
    "PR_URL=`gh pr create --title t --body 'Closes #1'`",
    `(cd ${directory} && gh pr edit 12 --body-file ${bodyFile})`,
  ]

  // Act
  const statuses = commands.map(
    (command) => runHook(bashEvent(command, directory)).status,
  )

  // Assert
  assert.deepEqual(statuses, [2, 2, 2, 2])
})

// Value: protects=the cap on the files the hook reads (GitHub allows 65,536 characters in a pull request text; the cap is 262,144 bytes); fails_when=a file of 262,145 bytes whose last line says "Closes #1" is read and refused, or the largest file within the cap (262,144 bytes) is skipped; why_new=Issue #98; seam=child process over two real files at the cap; no_claim=that the cap bounds the time or memory of a scan (the bounded patterns and the regular-file check do that), or what a device or a pipe does
test('reads a body file of 262,144 bytes and skips one of 262,145, which no pull request can carry', async (context) => {
  // Arrange
  const last = '\nCloses #1\n'
  const directory = await temporaryDirectory(context, {
    'at-cap.md': `${'x'.repeat(262_144 - last.length)}${last}`,
    'over-cap.md': `${'x'.repeat(262_145 - last.length)}${last}`,
  })

  // Act
  const atCap = runHook(
    bashEvent('gh pr edit 12 --body-file at-cap.md', directory),
  )
  const overCap = runHook(
    bashEvent('gh pr edit 12 --body-file over-cap.md', directory),
  )

  // Assert
  assert.deepEqual(atCap, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'at-cap.md')}, line 2: Closes #1\n${REFUSAL_FIX}\n`,
  })
  assert.deepEqual(overCap, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the hook still running when the project folder is reached through a symbolic link (/tmp is one on macOS, and this repository's worktrees live there), where Node's argv[1] is the link and import.meta.url is the real file; fails_when=the entry check compares unresolved paths, so the script takes itself for an imported module, does nothing and lets every command through; why_new=Issue #98; seam=child process started through a real symbolic link; no_claim=Windows, where a link needs a privilege
test('refuses a closing keyword when Node starts the hook through a symbolic link to the script', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {})
  const link = join(directory, 'hook-link.mjs')
  await symlink(HOOK_SCRIPT, link)
  const event = bashEvent("gh pr edit 12 --body 'Closes #1'", directory)

  // Act
  const { status, stderr } = spawnSync(process.execPath, [link], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: {},
    timeout: CHILD_TIMEOUT_MS,
  })

  // Assert
  assert.equal(status, 2)
  assert.match(
    stderr,
    /^Closing keyword before an Issue number in --body, line 1: Closes #1\n/,
  )
})

// Value: protects=the guard actually running in a session: the command that .claude/settings.json registers for the Bash tool is what Claude Code starts, with CLAUDE_PROJECT_DIR set to the project folder; fails_when=the matcher is not Bash, the timeout is lost, or the registered command names a wrong or renamed script or quotes the variable wrongly, so the hook never runs and every closing keyword passes without a sign; why_new=Issue #98; seam=the registered command string run by /bin/sh with CLAUDE_PROJECT_DIR set to the repository root; no_claim=that Claude Code loads the file or that the project's hooks are trusted in a given session (a collaborator reviews them in /hooks)
test('the project settings register the hook for Bash, and the registered command refuses a closing keyword', () => {
  // Arrange
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const settings = JSON.parse(
    readFileSync(join(repositoryRoot, '.claude', 'settings.json'), 'utf8'),
  )
  const [registration] = settings.hooks.PreToolUse
  const [hook] = registration.hooks
  const event = bashEvent("gh pr edit 12 --body 'Closes #1'", '/tmp')

  // Act
  const result = spawnSync('/bin/sh', ['-c', hook.command], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: repositoryRoot },
    timeout: CHILD_TIMEOUT_MS,
  })

  // Assert
  assert.deepEqual(
    {
      registrations: settings.hooks.PreToolUse.length,
      matcher: registration.matcher,
      type: hook.type,
      command: hook.command,
      timeout: hook.timeout,
      status: result.status,
      stderrStart: result.stderr.split('\n')[0],
    },
    {
      registrations: 1,
      matcher: 'Bash',
      type: 'command',
      command:
        'node "$CLAUDE_PROJECT_DIR/extension/scripts/refuse-closing-keywords.mjs"',
      timeout: 5,
      status: 2,
      stderrStart:
        'Closing keyword before an Issue number in --body, line 1: Closes #1',
    },
  )
})

// Value: protects=the file of another command that follows a pull request command in the same line (a git commit message that says Fixes #3 is no pull request text); fails_when=the words of one command run into the next, so the -F of git commit is read as the body file of gh pr edit; why_new=Issue #98; seam=child process over real temporary files; no_claim=none beyond protects
test('reads only the options of the pull request command, not those of a command after ;, &&, ||, | or a line break', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': 'Refs #3\n',
    'message.txt': 'Fixes #3\n',
  })
  const bodyFile = join(directory, 'body.md')
  const messageFile = join(directory, 'message.txt')
  const separators = [';', '&&', '||', '|', '\n']

  // Act
  const statuses = Object.fromEntries(
    separators.map((separator) => [
      JSON.stringify(separator),
      runHook(
        bashEvent(
          `gh pr edit 12 --body-file ${bodyFile} ${separator} git commit -F ${messageFile}`,
          directory,
        ),
      ).status,
    ]),
  )

  // Assert
  assert.deepEqual(statuses, {
    '";"': 0,
    '"&&"': 0,
    '"||"': 0,
    '"|"': 0,
    '"\\n"': 0,
  })
})

// Value: protects=the hook never blocking a session on input it does not understand; fails_when=input that is no JSON (truncated or empty) exits with anything but 0 or prints something; why_new=Issue #98; seam=child process; no_claim=none beyond protects
test('lets input through that is not JSON, with no output', () => {
  // Arrange
  const inputs = ['{"tool_name": "Bash", ', '']

  // Act
  const results = inputs.map((input) => runHook(input))

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=the hook acting on the Bash tool alone; fails_when=an event of another tool whose input happens to carry a command with a closing keyword is refused; why_new=Issue #98; seam=child process; no_claim=none beyond protects
test('lets an event of another tool through even when its input holds a closing keyword', () => {
  // Arrange
  const event = {
    tool_name: 'Write',
    tool_input: { command: "gh pr create --body 'Closes #1'" },
    cwd: '/tmp',
  }

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the explicit way to close an Issue on purpose, which the refusal's last sentence promises; fails_when=the assignment before the command does not let it through, or lets it through because the command was never recognized (the same command without the assignment is the control and must be refused); why_new=Issue #98; seam=child process; no_claim=none beyond protects
test('lets a closing keyword through when the command line assigns CODEBOOK_ALLOW_CLOSING_KEYWORD=1 before the command', () => {
  // Arrange
  const command = "gh pr create --title t --body 'Closes #1'"

  // Act
  const withoutAssignment = runHook(bashEvent(command, '/tmp'))
  const withAssignment = runHook(
    bashEvent(`CODEBOOK_ALLOW_CLOSING_KEYWORD=1 ${command}`, '/tmp'),
  )

  // Assert
  assert.equal(withoutAssignment.status, 2)
  assert.deepEqual(withAssignment, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the allow staying a deliberate act, given before the command it covers and with exactly the value 1; fails_when=an assignment after the command, or with another value, or one that only prefixes another command (as in a shell, where it reaches that command alone) allows the pull request command, or env, export and a plain assignment line before the command do not; why_new=Issue #98; seam=none; no_claim=a shell variable set in an earlier Bash call, which the tool does not keep
test('allows a command only when the assignment of 1 stands before it: as its prefix, after env, or in an earlier export or assignment', () => {
  // Arrange
  const commandLines = [
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit 3 --body x',
    'env CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit 3 --body x',
    'export CODEBOOK_ALLOW_CLOSING_KEYWORD=1 && gh pr edit 3 --body x',
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1\ngh pr edit 3 --body x',
    'gh pr edit 3 --body x; CODEBOOK_ALLOW_CLOSING_KEYWORD=1',
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=0 gh pr edit 3 --body x',
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1 echo hi; gh pr edit 3 --body x',
  ]

  // Act
  const allowed = commandLines.map(
    (commandLine) =>
      findPullRequestCommands(commandLine, '/work', {})[0]
        .isClosingKeywordAllowed,
  )

  // Assert
  assert.deepEqual(allowed, [true, true, true, true, false, false, false])
})

// Value: protects=the allow not being given by text that only mentions it; fails_when=an argument of another program (echo CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit …, printf …) counts as an assignment before the pull request command; why_new=Issue #98 (review finding: any word before the program allowed); seam=none; no_claim=none beyond protects
test('does not allow a command by an assignment that is only an argument of another program', () => {
  // Arrange
  const commandLines = [
    'echo CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit 3 --body x',
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1 echo gh pr edit 3 --body x',
    'printf %s CODEBOOK_ALLOW_CLOSING_KEYWORD=1; gh pr edit 3 --body x',
    'git commit -m CODEBOOK_ALLOW_CLOSING_KEYWORD=1 && gh pr edit 3 --body x',
  ]

  // Act
  const results = commandLines.map((commandLine) => {
    const [command] = findPullRequestCommands(commandLine, '/work', {})
    return {
      isClosingKeywordAllowed: command.isClosingKeywordAllowed,
      texts: command.texts.length,
    }
  })

  // Assert
  assert.deepEqual(results, [
    { isClosingKeywordAllowed: false, texts: 1 },
    { isClosingKeywordAllowed: false, texts: 1 },
    { isClosingKeywordAllowed: false, texts: 1 },
    { isClosingKeywordAllowed: false, texts: 1 },
  ])
})

// Value: protects=the allow not being given by the body of a heredoc: a line "CODEBOOK_ALLOW_CLOSING_KEYWORD=1" in the text a command receives is data, not an assignment; fails_when=a heredoc body line comes back as a command of its own (an assignment-only command), so the pull request command after it is allowed; why_new=Issue #98 (review finding: heredoc bodies re-entered as command words); seam=child process; no_claim=none beyond protects
test('does not allow a command by a heredoc line that reads CODEBOOK_ALLOW_CLOSING_KEYWORD=1', () => {
  // Arrange
  const command = [
    "cat > notes.txt <<'EOF'",
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1',
    'EOF',
    "gh pr edit 12 --body 'Closes #1'",
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, '/tmp'))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 1: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the allow ending where the shell ends it; fails_when=an unset later in the line before the command does not cancel an earlier export, an assignment made inside a subshell ( … ) or $( … ) reaches the commands after it, or a command inside a subshell does not see the allow its shell gave; why_new=Issue #98 (review finding); seam=none; no_claim=none beyond protects
test('ends the allow with unset, and keeps an assignment of a subshell to the subshell', () => {
  // Arrange
  const commandLines = [
    'export CODEBOOK_ALLOW_CLOSING_KEYWORD=1; unset CODEBOOK_ALLOW_CLOSING_KEYWORD; gh pr edit 3 --body x',
    'export CODEBOOK_ALLOW_CLOSING_KEYWORD=1; unset OTHER; gh pr edit 3 --body x',
    '(export CODEBOOK_ALLOW_CLOSING_KEYWORD=1); gh pr edit 3 --body x',
    '(CODEBOOK_ALLOW_CLOSING_KEYWORD=1; true); gh pr edit 3 --body x',
    'X=$(export CODEBOOK_ALLOW_CLOSING_KEYWORD=1); gh pr edit 3 --body x',
    'export CODEBOOK_ALLOW_CLOSING_KEYWORD=1; (gh pr edit 3 --body x)',
    'export CODEBOOK_ALLOW_CLOSING_KEYWORD=1 | cat; gh pr edit 3 --body x',
    'echo hi | export CODEBOOK_ALLOW_CLOSING_KEYWORD=1; gh pr edit 3 --body x',
  ]

  // Act
  const allowed = commandLines.map(
    (commandLine) =>
      findPullRequestCommands(commandLine, '/work', {})[0]
        .isClosingKeywordAllowed,
  )

  // Assert
  assert.deepEqual(allowed, [
    false,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
  ])
})

// Value: protects=the paths /ship and a model write with variables: $NAME and ${NAME} from an assignment earlier in the line or from the environment, ${NAME:-default}, $PWD as the line's own directory, $OLDPWD as unknown, and a variable nobody knows leaving its file unread, not guessed; fails_when=an assignment is not chained into the next, the environment is not consulted, the line's own assignment does not win over the environment, a default is not used, $PWD is the hook's directory, $OLDPWD is the hook's copy, an unknown name is replaced or read as a literal path, or a name of Object.prototype ($constructor) expands to something; why_new=Issue #98 (the /ship template passes its files through variables); seam=none; no_claim=${NAME#…}, ${NAME%…} and arithmetic, which stay unresolved
test('expands variables from earlier assignments and the environment, and reads no file whose variable nobody knows', () => {
  // Arrange
  const environment = {
    NOTES: '/env',
    ONLY_ENV: '/only',
    PWD: '/elsewhere',
    OLDPWD: '/before',
  }
  const commandLines = [
    'A=/a\nB=$A/b\ngh pr edit 3 --body-file $B/c.md',
    'gh pr edit 3 --body-file ${ONLY_ENV}/c.md',
    'NOTES=/line\ngh pr edit 3 --body-file $NOTES/c.md',
    'gh pr edit 3 --body-file ${MISSING:-/default}/c.md',
    'gh pr edit 3 --body-file $PWD/c.md',
    'gh pr edit 3 --body-file $OLDPWD/c.md',
    'gh pr edit 3 --body-file $MISSING/c.md',
    'gh pr edit 3 --body-file $constructor/c.md',
  ]

  // Act
  const paths = commandLines.map(
    (commandLine) =>
      findPullRequestCommands(commandLine, '/work', environment)[0].texts[0]
        ?.source,
  )

  // Assert
  assert.deepEqual(paths, [
    '/a/b/c.md',
    '/only/c.md',
    '/line/c.md',
    '/default/c.md',
    '/work/c.md',
    undefined,
    undefined,
    undefined,
  ])
})

// Value: protects=the check of the very flow Issue #98 guards: /ship hands the body over as --body-file "${PR_BODY_FILE:?...}" after restoring the variable; fails_when=a variable assigned earlier in the command line is not followed to its file, so the body that says "Close #90 manually" is never read; why_new=Issue #98 (the /ship template, ~/.claude/skills/gstack/ship/sections/pr-body.md, passes its files through variables); seam=child process over a real temporary file; no_claim=a variable set in an earlier Bash call, or by $(mktemp)
test('follows a body file named by ${PR_BODY_FILE:?…} to the file an earlier line of the command assigned', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'gstack-pr-body.AbC123':
      '## Linked Spec\nClose #90 manually after follow-up lands.\n',
  })
  const bodyFile = join(directory, 'gstack-pr-body.AbC123')
  const command = `PR_BODY_FILE=${bodyFile}
~/.claude/skills/gstack/bin/gstack-post pr-body 12 --body-file "\${PR_BODY_FILE:?restore the composed body path}"`

  // Act
  const result = runHook(bashEvent(command, directory))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${bodyFile}, line 2: Close #90 manually after follow-up lands.\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the title file of /ship, which it builds from the repository's top folder and passes as --title-file "$TITLE_FILE"; fails_when=$(git rev-parse --show-toplevel 2>/dev/null || pwd) is not read as the nearest folder with a .git, so a title file under .gstack/tmp is looked for under the current subfolder and its keyword passes; why_new=Issue #98 (the /ship template builds TITLE_FILE this way); seam=child process over a real temporary folder with a .git marker and a subfolder as cwd; no_claim=a repository whose top folder git would find another way (GIT_DIR, a bare repository)
test('follows a title file built from $(git rev-parse --show-toplevel) to the repository top folder, from a subfolder', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    '.git/HEAD': 'ref: refs/heads/main\n',
    'extension/.keep': '',
    '.gstack/tmp/pr-title.AbC123':
      'v0.2.33.0 fix #98: refuse closing keywords\n',
    'body.md': 'Refs #98\n',
  })
  const titleFile = join(directory, '.gstack', 'tmp', 'pr-title.AbC123')
  const command = `TITLE_FILE="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.gstack/tmp/pr-title.AbC123"
~/.claude/skills/gstack/bin/gstack-post pr-create --base main --title-file "$TITLE_FILE" --body-file ${join(directory, 'body.md')}`

  // Act
  const result = runHook(bashEvent(command, join(directory, 'extension')))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${titleFile}, line 1: v0.2.33.0 fix #98: refuse closing keywords\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the form Claude Code writes for a pull request body, --body "$(cat <<'EOF' … EOF)", whose text has apostrophes and double quotes; fails_when=the quotes inside the heredoc end the --body value early, so a keyword after "the old behavior" passes, or the line number counts the $(cat <<'EOF' line, so it is off by one from the body; why_new=Issue #98; seam=child process; no_claim=a heredoc fed to --body-file -, which the hook cannot read
test('refuses a closing keyword in a --body "$(cat <<\'EOF\' … EOF)" heredoc whose text has quotes and an apostrophe, and counts the line in the body', () => {
  // Arrange
  const command = [
    'gh pr create --title "Add the hook" --body "$(cat <<\'EOF\'',
    '## Summary',
    'Replaces the "old behavior"; it\'s gone.',
    'Closes #7',
    'EOF',
    ')"',
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, '/tmp'))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 3: Closes #7\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the pull request command that follows a heredoc in the same command line (a body written by cat <<'EOF' and then posted); fails_when=an apostrophe or an open quote in the heredoc body starts a quoted word that swallows the next line, so the gh pr edit after it is never seen; why_new=Issue #98; seam=child process over a real temporary file; no_claim=reading the heredoc as the content of the file it writes
test('still finds the pull request command after a heredoc whose text has an apostrophe and an open parenthesis', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': 'Fixes #12\n',
  })
  const bodyFile = join(directory, 'body.md')
  const command = [
    "cat > notes.txt <<'EOF'",
    'It\'s a "note" with an open (',
    'EOF',
    `gh pr edit 12 --body-file ${bodyFile}`,
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, directory))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${bodyFile}, line 1: Fixes #12\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the hook never blocking on a text it cannot see; fails_when=a body file that does not exist, a directory, or standard input (-) makes the hook refuse or fail, or "-" is read as a file of that name (the folder holds one with a closing keyword; the command reads standard input instead); why_new=Issue #98; seam=child process over a real temporary folder; no_claim=that the command itself then succeeds
test('lets a command through whose body file is missing, is a folder, or is standard input', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'folder/.keep': '',
    '-': 'Closes #1\n',
  })
  const commands = [
    'gh pr edit 12 --body-file missing.md',
    'gh pr edit 12 --body-file folder',
    'gh pr edit 12 --body-file -',
    'gh pr edit 12 -F -',
    'gh pr edit 12 --body-file /dev/stdin',
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=a body file named from the home folder; fails_when=~/ is read as a folder called ~ under the current one, so the file is not found and its keyword passes; why_new=Issue #98; seam=child process with HOME set to a real temporary folder; no_claim=~user forms
test('reads a body file named with ~/ from the home folder', async (context) => {
  // Arrange
  const home = await temporaryDirectory(context, {
    'notes/body.md': 'Fixes #12\n',
  })
  const event = bashEvent('gh pr edit 12 --body-file ~/notes/body.md', '/tmp')

  // Act
  const result = runHook(event, { env: { HOME: home } })

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(home, 'notes', 'body.md')}, line 1: Fixes #12\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the pattern itself: every form GitHub honors is reported with its 1-based line and trimmed text, in any letter case, with any line ending; fails_when=a form is missed (#N, owner/repo#N, an Issue or pull request URL, a colon, any of close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved), or a line number or the trimmed text is wrong; why_new=Issue #98; seam=none; no_claim=forms GitHub may honor that the issue does not list
test('reports each line that puts a closing keyword before an Issue reference, with its 1-based line number and trimmed text', () => {
  // Arrange
  const text = [
    '## Summary',
    'Refs #12',
    'Close #90 after the merge.',
    '  Fixes: laststance/codebook#7',
    'RESOLVED https://github.com/laststance/codebook/issues/98',
    'resolves   #3',
    'Fix https://github.com/o/r/pull/3',
    'closed:#8',
    'Fixed #9',
    'Resolved: #10',
    'Closed #11',
  ].join('\r\n')

  // Act
  const references = findClosingReferences(text)

  // Assert
  assert.deepEqual(references, [
    { lineNumber: 3, lineText: 'Close #90 after the merge.' },
    { lineNumber: 4, lineText: 'Fixes: laststance/codebook#7' },
    {
      lineNumber: 5,
      lineText: 'RESOLVED https://github.com/laststance/codebook/issues/98',
    },
    { lineNumber: 6, lineText: 'resolves   #3' },
    { lineNumber: 7, lineText: 'Fix https://github.com/o/r/pull/3' },
    { lineNumber: 8, lineText: 'closed:#8' },
    { lineNumber: 9, lineText: 'Fixed #9' },
    { lineNumber: 10, lineText: 'Resolved: #10' },
    { lineNumber: 11, lineText: 'Closed #11' },
  ])
})

// Value: protects=the line number the refusal names, for a text from any editor; fails_when=a lone carriage return (the old Mac line ending) does not end a line, so the line numbers after it are too low; why_new=Issue #98; seam=none; no_claim=none beyond protects
test('counts a lone carriage return, a line feed and both together as line breaks', () => {
  // Arrange
  const text = 'Intro\rCloses #5\nMiddle\r\nResolved #6'

  // Act
  const references = findClosingReferences(text)

  // Assert
  assert.deepEqual(references, [
    { lineNumber: 2, lineText: 'Closes #5' },
    { lineNumber: 4, lineText: 'Resolved #6' },
  ])
})

// Value: protects=the lines the project writes on purpose: Refs, and words that only look like a keyword; fails_when=Refs #12, unclosed #5, fixed-width #5, a keyword with no number or a keyword split from its number by a word is reported; why_new=Issue #98; seam=none; no_claim=none beyond protects
test('reports no line that only refers to an Issue or only resembles a closing keyword', () => {
  // Arrange
  const text = [
    'Refs #12',
    'unclosed #5',
    'fixed-width #5',
    'Closes the loop',
    'fix the number 5',
    'Resolve conflicts, then #5',
    'No close, fix or resolve word comes right before `#N`.',
  ].join('\n')

  // Act
  const references = findClosingReferences(text)

  // Assert
  assert.deepEqual(references, [])
})

// Value: protects=the commands of a line staying apart, so the options of one are never read as the options of the next; fails_when=a separator outside quotes (&&, ||, ;, |, a line break, a lone & for the background) does not end a command, one inside quotes does, or a redirection (2>&1, &>, >&2) is taken for a word or for a separator; why_new=Issue #98; seam=none; no_claim=shell features beyond the separators and redirections named
test('splits a command line at &&, ||, ;, |, a lone & and line breaks, but not inside quotes or at 2>&1, &> and >&2', () => {
  // Arrange
  const commandLine =
    'gh pr edit 12 --body "a b" && git status | cat; echo "x && y; z"\nls 2>&1 || true\nsleep 1 & wait\nmake &> build.log >&2'

  // Act
  const words = wordsOf(commandLine)

  // Assert
  assert.deepEqual(words, [
    ['gh', 'pr', 'edit', '12', '--body', 'a b'],
    ['git', 'status'],
    ['cat'],
    ['echo', 'x && y; z'],
    ['ls'],
    ['true'],
    ['sleep', '1'],
    ['wait'],
    ['make'],
  ])
})

// Value: protects=the text a pull request command receives from quoted words; fails_when=a single or double quote, an escaped space or quote, an empty quoted word, or a backslash before a line break (outside or inside double quotes) gives a word other than the one a shell passes; why_new=Issue #98; seam=none; no_claim=$'…' strings and substitutions, which have tests of their own
test('resolves quotes, escapes and line continuations into the words a shell passes', () => {
  // Arrange
  const commandLine =
    'echo \'c d\' "say \\"hi\\"" e\\ f "" "a \\\nb" g\\\nh \'it\'"\'"\'s\''

  // Act
  const words = wordsOf(commandLine)

  // Assert
  assert.deepEqual(words, [
    ['echo', 'c d', 'say "hi"', 'e f', '', 'a b', 'gh', "it's"],
  ])
})

// Value: protects=a comment that mentions a pull request command from being run as one; fails_when=text after a # that starts a word is read as a command (a false refusal), or a # inside a word (a#b) starts a comment and cuts the line; why_new=Issue #98; seam=none; no_claim=none beyond protects
test('ignores a comment to the end of its line, but not a # inside a word', () => {
  // Arrange
  const commandLine =
    "git status # gh pr create --body 'Closes #1'\nls a#b # again"

  // Act
  const words = wordsOf(commandLine)

  // Assert
  assert.deepEqual(words, [
    ['git', 'status'],
    ['ls', 'a#b'],
  ])
})

// Value: protects=the text of a heredoc staying with the command whose line opened it, and out of the commands; fails_when=a body line comes back as a command of its own (an assignment, a program, a pull request command), the body is cut at an apostrophe, quote or parenthesis in it, <<- keeps the tabs, a quoted delimiter is not marked as quoted, or the command after the delimiter line is lost; why_new=Issue #98 (review finding: heredoc marks became words of the commands); seam=none; no_claim=a heredoc with no delimiter line, which takes the rest of the line as a shell does
test('gives a heredoc body to the command whose line opened it, and no body line becomes a command', () => {
  // Arrange
  const commandLine = [
    "cat > p.md <<'EOF' && tee -a q.md <<-END",
    'It\'s a "note" with an open (',
    'CODEBOOK_ALLOW_CLOSING_KEYWORD=1',
    'EOF',
    '\tindented',
    '\tEND',
    'ls',
  ].join('\n')

  // Act
  const { events } = splitCommandSegments(commandLine)

  // Assert
  assert.deepEqual(events, [
    {
      type: 'segment',
      words: ['cat'],
      redirections: [
        {
          operator: '>',
          fd: undefined,
          target: 'p.md',
          isQuoted: false,
          body: undefined,
        },
        {
          operator: '<<',
          fd: undefined,
          target: 'EOF',
          isQuoted: true,
          body: 'It\'s a "note" with an open (\nCODEBOOK_ALLOW_CLOSING_KEYWORD=1\n',
        },
      ],
      followedBy: '&&',
    },
    {
      type: 'segment',
      words: ['tee', '-a', 'q.md'],
      redirections: [
        {
          operator: '<<-',
          fd: undefined,
          target: 'END',
          isQuoted: false,
          body: 'indented\n',
        },
      ],
      followedBy: '\n',
    },
    { type: 'segment', words: ['ls'], redirections: [], followedBy: '' },
  ])
})

// Value: protects=ANSI-C quoting, $'…', which gives a model the way to put a line break into an inline --body; fails_when=\n, \t, \\, \' or \" inside $'…' is not decoded, an escape this script does not know is changed, or the quote ends at an escaped \'; why_new=Issue #98 (review finding); seam=none; no_claim=\xHH, \uHHHH and octal escapes, which stay as written
test("decodes $'…' strings: \\n, \\t, \\\\, \\' and \\\" become the characters they name", () => {
  // Arrange
  const commandLine = "echo $'a\\nb\\tc\\\\d\\'e\\\"f\\qg' next"

  // Act
  const words = wordsOf(commandLine)

  // Assert
  assert.deepEqual(words, [['echo', 'a\nb\tc\\d\'e"f\\qg', 'next']])
})

// Value: protects=the text of a pull request staying as written where the shell does not expand it; fails_when=a $ that single quotes, a backslash or $'…' made plain is expanded (so a body that mentions $HOME is read as another text), or a $ in double quotes is not (the control: the home folder replaces it); why_new=Issue #98 (review finding: expansion ignored the quotes); seam=none; no_claim=none beyond protects
test("does not expand a $ that single quotes, a backslash or $'…' made plain, but expands one in double quotes", () => {
  // Arrange
  const environment = { HOME: '/home/me' }
  const commandLines = [
    "gh pr edit 3 --body '$HOME'",
    'gh pr edit 3 --body \\$HOME',
    'gh pr edit 3 --body "\\$HOME"',
    "gh pr edit 3 --body $'$HOME'",
    'gh pr edit 3 --body "$HOME"',
  ]

  // Act
  const texts = commandLines.map(
    (commandLine) =>
      findPullRequestCommands(commandLine, '/work', environment)[0].texts[0]
        .fragments[0].text,
  )

  // Assert
  assert.deepEqual(texts, ['$HOME', '$HOME', '$HOME', '$HOME', '/home/me'])
})

// Value: protects=every spelling of a text option that gh and gstack-post accept; fails_when=--name=value, -b, -F, -t, --subject or --title-file is read wrongly, a value that begins with a dash is taken for an option, an option of another kind is read as text, a relative file does not start at the working directory, or gh pr merge is left out; why_new=Issue #98; seam=none; no_claim=clusters of short options (-dF)
test('reads the text options of gh pr create, gh pr merge and gstack-post in each spelling', () => {
  // Arrange
  const commandLines = [
    'gh pr create --title "Add hook" --body-file=/tmp/b.md -F /tmp/c.md -b inline --draft --base main',
    'gh pr merge 12 --squash --subject S --body "- B"',
    'gh pr edit 12 -t T --add-label bug',
    'gstack-post pr-create --base main --draft --title-file T --body-file B',
  ]

  // Act
  const texts = commandLines.map((commandLine) =>
    findPullRequestCommands(commandLine, '/work', {}).map(
      (command) => command.texts,
    ),
  )

  // Assert
  assert.deepEqual(texts, [
    [
      [
        {
          option: '--title',
          source: '--title',
          fragments: [{ kind: 'text', text: 'Add hook' }],
        },
        {
          option: '--body-file',
          source: '/tmp/b.md',
          fragments: [{ kind: 'file', path: '/tmp/b.md', isOptional: false }],
        },
        {
          option: '-F',
          source: '/tmp/c.md',
          fragments: [{ kind: 'file', path: '/tmp/c.md', isOptional: false }],
        },
        {
          option: '-b',
          source: '-b',
          fragments: [{ kind: 'text', text: 'inline' }],
        },
      ],
    ],
    [
      [
        {
          option: '--subject',
          source: '--subject',
          fragments: [{ kind: 'text', text: 'S' }],
        },
        {
          option: '--body',
          source: '--body',
          fragments: [{ kind: 'text', text: '- B' }],
        },
      ],
    ],
    [
      [
        {
          option: '-t',
          source: '-t',
          fragments: [{ kind: 'text', text: 'T' }],
        },
      ],
    ],
    [
      [
        {
          option: '--title-file',
          source: '/work/T',
          fragments: [{ kind: 'file', path: '/work/T', isOptional: false }],
        },
        {
          option: '--body-file',
          source: '/work/B',
          fragments: [{ kind: 'file', path: '/work/B', isOptional: false }],
        },
      ],
    ],
  ])
})

// Value: protects=the short options with their value attached, which gh accepts; fails_when=-b=TEXT, -bTEXT, -t=TEXT, -tTEXT, -F=FILE or -FFILE is not read as the option and its value, so a closing keyword written that way is never seen; why_new=Issue #98 (review finding); seam=none; no_claim=clusters of short options (-dF)
test('reads the short options with the value attached: -b=TEXT, -bTEXT, -t=TEXT, -F=FILE and -FFILE', () => {
  // Arrange
  const commandLine =
    'gh pr edit 3 -b=Refs\\ #1 -bFixes\\ #2 -t=Title -tOther -F=/tmp/f.md -F/tmp/g.md'

  // Act
  const [command] = findPullRequestCommands(commandLine, '/work', {})

  // Assert
  assert.deepEqual(command.texts, [
    {
      option: '-b',
      source: '-b',
      fragments: [{ kind: 'text', text: 'Refs #1' }],
    },
    {
      option: '-b',
      source: '-b',
      fragments: [{ kind: 'text', text: 'Fixes #2' }],
    },
    {
      option: '-t',
      source: '-t',
      fragments: [{ kind: 'text', text: 'Title' }],
    },
    {
      option: '-t',
      source: '-t',
      fragments: [{ kind: 'text', text: 'Other' }],
    },
    {
      option: '-F',
      source: '/tmp/f.md',
      fragments: [{ kind: 'file', path: '/tmp/f.md', isOptional: false }],
    },
    {
      option: '-F',
      source: '/tmp/g.md',
      fragments: [{ kind: 'file', path: '/tmp/g.md', isOptional: false }],
    },
  ])
})

// Value: protects=a pull request body that the command line itself feeds to the command, gh pr create --body-file - <<'EOF' … EOF, which the reviews found unseen; fails_when=a heredoc of the pull request command is not read as its body, other redirections on the line (2>&1) hide it, or the refusal does not name the option and the line of the body; why_new=Issue #98 (review finding 1a); seam=child process; no_claim=a heredoc of another command (see the next tests)
test('refuses a closing keyword in a heredoc fed to the command with --body-file -, and names the option and the line', () => {
  // Arrange
  const commands = [
    [
      "gh pr create --title t --body-file - <<'EOF'",
      '## Summary',
      'Closes #1',
      'EOF',
    ].join('\n'),
    [
      "gh pr create --title t --body-file - 2>&1 <<'EOF'",
      '## Summary',
      'Closes #1',
      'EOF',
    ].join('\n'),
    [
      "gh pr create --title t --body-file=/dev/stdin <<'EOF'",
      '## Summary',
      'Closes #1',
      'EOF',
    ].join('\n'),
  ]

  // Act
  const results = commands.map((command) => runHook(bashEvent(command, '/tmp')))

  // Assert
  const refusalNaming = (source) => ({
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${source}, line 2: Closes #1\n${REFUSAL_FIX}\n`,
  })
  assert.deepEqual(results, [
    refusalNaming('--body-file -'),
    refusalNaming('--body-file -'),
    refusalNaming('--body-file /dev/stdin'),
  ])
})

// Value: protects=a pull request body read from a file or a string that the command line redirects into the command, --body-file - < body.md and -F - <<< "…"; fails_when=a < redirection is not read like a body file (relative to the working directory, named by its path), or a here-string is not read as the body; why_new=Issue #98 (review finding 1a); seam=child process over a real temporary file; no_claim=none beyond protects
test('reads the file redirected into --body-file - and the here-string fed to -F -', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': 'Intro\nFixes #4\n',
  })
  const bodyFile = join(directory, 'body.md')
  const commands = [
    'gh pr edit 12 --body-file - < body.md',
    'gh pr edit 12 -F - <body.md',
    'gh pr edit 12 -F - <<< "Fixes #2"',
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${bodyFile}, line 2: Fixes #4\n${REFUSAL_FIX}\n`,
    },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${bodyFile}, line 2: Fixes #4\n${REFUSAL_FIX}\n`,
    },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in -F -, line 1: Fixes #2\n${REFUSAL_FIX}\n`,
    },
  ])
})

// Value: protects=the binding of a heredoc to the command whose line opened it: a heredoc that feeds another command, a pipe and a terminal are not the body of --body-file -; fails_when=any heredoc of the line is taken as the body, so a command that reads nothing from it is refused for a text it never receives; why_new=Issue #98 (review finding 1a: bind a heredoc to the command on its line); seam=child process over a real temporary file; no_claim=standard input from a pipe, a blind spot named in the header
test('reads standard input only from the command that has the option: not a heredoc of another command, a pipe or a terminal', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'body.md': 'Closes #1\n',
  })
  const commands = [
    "cat <<'EOF'\nCloses #1\nEOF\ngh pr edit 12 --body-file -",
    'cat body.md | gh pr edit 12 --body-file -',
    'gh pr edit 12 --body-file -',
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=a body written and posted in one command line, cat > p.md <<'EOF' … EOF, then gh pr create --body-file p.md, where the file is not on the disk when the hook runs; fails_when=the heredoc is not taken as the content of p.md, so the file is missing and the keyword passes; why_new=Issue #98 (review finding 1b); seam=child process in an empty temporary folder; no_claim=none beyond protects
test('reads the heredoc that cat > p.md writes earlier in the line, though the file is not on the disk', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {})
  const command = [
    "cat > p.md <<'EOF'",
    'Intro',
    'Closes #1',
    'EOF',
    'gh pr create --title t --body-file p.md',
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, directory))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'p.md')}, line 2: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the text that will be posted: when the line overwrites a file from a heredoc, the heredoc is the text, whatever an earlier run left on the disk; fails_when=the stale file is read instead, so a stale keyword refuses a clean body or a stale clean file lets a closing body through; why_new=Issue #98 (review finding 1b: check that heredoc body instead of the disk file); seam=child process over two real stale files; no_claim=none beyond protects
test('reads the heredoc, not the stale file on the disk, when the line overwrites the file first', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'stale-closing.md': 'Closes #99\n',
    'stale-clean.md': 'Refs #99\n',
  })
  const commands = [
    "cat > stale-closing.md <<'EOF'\nRefs #1\nEOF\ngh pr edit 12 --body-file stale-closing.md",
    "cat > stale-clean.md <<'EOF'\nCloses #1\nEOF\ngh pr edit 12 --body-file stale-clean.md",
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${join(directory, 'stale-clean.md')}, line 1: Closes #1\n${REFUSAL_FIX}\n`,
    },
  ])
})

// Value: protects=a file that the line appends to, cat >> p.md <<'EOF', whose text is the disk content plus the heredoc; fails_when=the heredoc alone is read (a keyword already in the file passes), the disk content alone is read (a keyword in the appended text passes), the lines of the appended text are not numbered after those of the file, or a file that does not exist yet is skipped; why_new=Issue #98 (review finding 1b: for >>, the disk content plus the body); seam=child process over real files; no_claim=none beyond protects
test('reads the file as it is on the disk plus the heredoc that cat >> appends to it, numbering the lines through both', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'keyword-first.md': 'Intro\nCloses #5\n',
    'clean-first.md': 'Intro\nRefs #5\n',
  })
  const commands = [
    "cat >> keyword-first.md <<'EOF'\nRefs #6\nEOF\ngh pr edit 12 --body-file keyword-first.md",
    "cat >> clean-first.md <<'EOF'\nCloses #6\nEOF\ngh pr edit 12 --body-file clean-first.md",
    "cat >> new.md <<'EOF'\nCloses #7\nEOF\ngh pr edit 12 --body-file new.md",
  ]

  // Act
  const results = commands.map((command) =>
    runHook(bashEvent(command, directory)),
  )

  // Assert
  assert.deepEqual(results, [
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${join(directory, 'keyword-first.md')}, line 2: Closes #5\n${REFUSAL_FIX}\n`,
    },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${join(directory, 'clean-first.md')}, line 3: Closes #6\n${REFUSAL_FIX}\n`,
    },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in ${join(directory, 'new.md')}, line 1: Closes #7\n${REFUSAL_FIX}\n`,
    },
  ])
})

// Value: protects=every way a line writes a file from a heredoc, so none of them lets the body pass unread; fails_when=cat <<'EOF' > p, cat <<'EOF' >> p, tee p <<'EOF', tee -a p <<'EOF' or cat >| p <<'EOF' is not taken as the content of p.md; why_new=Issue #98 (review finding 1b: also cat >> p, tee p, cat <<'EOF' > p); seam=child process in an empty temporary folder; no_claim=cp, mv, sed -i and the like, which the header names
test('reads the heredoc of cat <<EOF > p, cat <<EOF >> p, tee p, tee -a p and cat >| p like that of cat > p', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {})
  const writers = [
    "cat <<'EOF' > p.md\nCloses #1\nEOF",
    "cat <<'EOF' >> p.md\nCloses #1\nEOF",
    "tee p.md <<'EOF'\nCloses #1\nEOF",
    "tee -a p.md <<'EOF'\nCloses #1\nEOF",
    "cat >| p.md <<'EOF'\nCloses #1\nEOF",
  ]

  // Act
  const results = writers.map((writer) =>
    runHook(bashEvent(`${writer}\ngh pr edit 12 --body-file p.md`, directory)),
  )

  // Assert
  const refusal = {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'p.md')}, line 1: Closes #1\n${REFUSAL_FIX}\n`,
  }
  assert.deepEqual(results, [refusal, refusal, refusal, refusal, refusal])
})

// Value: protects=the rule of not guessing: a file that an earlier command of the line writes in a way this script cannot read has no content it can know, and the stale file on the disk is not it; fails_when=echo, printf, a pipe into tee, a redirected output of another command or cat of another file is followed by a read of the stale disk file, so a stale keyword refuses a body that the line has rewritten; why_new=Issue #98 (review finding 1b: do not guess, skip); seam=child process over a real stale file; no_claim=writers the script does not notice (cp, mv, sed -i), which the header names
test('skips a file that something unreadable wrote earlier in the line, and does not guess from the stale file on the disk', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'stale.md': 'Closes #99\n',
  })
  const writers = [
    "echo 'Refs #1' > stale.md",
    "printf '%s\\n' 'Refs #1' > stale.md",
    "echo 'Refs #1' | tee stale.md >/dev/null",
    'gh pr view 12 --json body -q .body > stale.md',
    'cat other.md > stale.md',
  ]
  const post = 'gh pr edit 12 --body-file stale.md'

  // Act
  const control = runHook(bashEvent(post, directory))
  const results = writers.map((writer) =>
    runHook(bashEvent(`${writer}\n${post}`, directory)),
  )

  // Assert
  assert.equal(control.status, 2)
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=a file becoming known again once a heredoc overwrites it, whatever wrote it before; fails_when=an unreadable writer earlier in the line keeps the file skipped after cat > p.md <<'EOF' has replaced its content, or the stale disk text is read; why_new=Issue #98 (review finding 1b); seam=child process over a real stale file; no_claim=none beyond protects
test('knows a file again when a heredoc overwrites it after something unreadable wrote it', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'stale.md': 'Closes #99\n',
  })
  const command = [
    'echo x > stale.md',
    "cat > stale.md <<'EOF'",
    'Closes #1',
    'EOF',
    'gh pr edit 12 --body-file stale.md',
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, directory))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'stale.md')}, line 1: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=a body kept in a variable that is assigned from a heredoc, BODY=$(cat <<'EOF' … EOF), then used as --body "$BODY"; fails_when=$( splits the word and --body becomes a literal "$", so the keyword in the body is never seen; why_new=Issue #98 (review finding 1c); seam=child process; no_claim=none beyond protects
test('reads a variable assigned from $(cat <<EOF … EOF) as that heredoc when it is used as --body', () => {
  // Arrange
  const command = [
    "BODY=$(cat <<'EOF'",
    '## Summary',
    'Closes #1',
    'EOF',
    ')',
    'gh pr edit 12 --body "$BODY"',
  ].join('\n')

  // Act
  const result = runHook(bashEvent(command, '/tmp'))

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 2: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the rule of not guessing about a command substitution: its output is unknown, and the command that makes it is not the text; fails_when=a value made of $( … ) or backticks is read as the text of the command inside (grep -c "fixes #3" is no body that says fixes #3), a $( … ) in a default is read as literal, or an unknown --body-file is read at all; why_new=Issue #98 (review finding 1c: any other $( … ) makes the value unknown); seam=child process; no_claim=none beyond protects
test('reads nothing from a value made of another command substitution, and does not read the command as text', () => {
  // Arrange
  const commands = [
    'BODY=$(grep -c "fixes #3" notes.txt)\ngh pr edit 12 --body "$BODY"',
    'gh pr edit 12 --body "$(echo \'fixes #3\')"',
    'gh pr edit 12 --body "`echo \'fixes #3\'`"',
    'TITLE=$(date)\ngh pr edit 12 --title "$TITLE"',
    'gh pr edit 12 --body-file "$(mktemp)"',
    `gh pr edit 12 --body \${BODY:-$(echo "fixes #3")}`,
  ]

  // Act
  const results = commands.map((command) => runHook(bashEvent(command, '/tmp')))

  // Assert
  assert.deepEqual(results, [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])
})

// Value: protects=a closing keyword that stands next to a substitution nobody can read (a backtick in a double-quoted body is one): the words around it are still the text; fails_when=the whole text is dropped because a part of it is unknown, or the unknown part is shown as if it were text; why_new=Issue #98 (review finding 1c, refined: only the unknown part is skipped); seam=child process; no_claim=a keyword that the unknown output would complete
test('still reads the parts of a text around a command substitution it cannot read', () => {
  // Arrange
  const commands = [
    'gh pr edit 12 --body "Closes #1 $(date)"',
    'gh pr edit 12 --body "$(date) Fixes #2"',
  ]

  // Act
  const results = commands.map((command) => runHook(bashEvent(command, '/tmp')))

  // Assert
  assert.deepEqual(results, [
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in --body, line 1: Closes #1 …\n${REFUSAL_FIX}\n`,
    },
    {
      status: 2,
      stdout: '',
      stderr: `Closing keyword before an Issue number in --body, line 1: … Fixes #2\n${REFUSAL_FIX}\n`,
    },
  ])
})

// Value: protects=the file a relative path means after the line has changed directory, cd sub && gh pr edit --body-file b.md; fails_when=cd or pushd is not followed (the file of the hook's folder is read), a ~ or absolute target, a known variable or $(git rev-parse --show-toplevel) as target is not resolved, or cd .. does not undo cd sub; why_new=Issue #98 (review finding 2); seam=child process over a real folder tree; no_claim=cd inside if, loops and functions, which are read as plain commands
test('resolves a relative file against the directory that cd and pushd reached earlier in the line', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    '.git/HEAD': 'ref: refs/heads/main\n',
    'b.md': 'Fixes #3\n',
    'sub/b.md': 'Closes #7\n',
  })
  const rootFile = join(directory, 'b.md')
  const subFile = join(directory, 'sub', 'b.md')
  const cases = [
    { cwd: directory, command: 'cd sub && gh pr edit 12 --body-file b.md' },
    {
      cwd: directory,
      command: 'pushd sub >/dev/null; gh pr edit 12 -F b.md',
    },
    {
      cwd: directory,
      command: 'cd sub; cd ..; gh pr edit 12 --body-file b.md',
    },
    {
      cwd: '/tmp',
      command: `cd ${directory}/sub && gh pr edit 12 --body-file b.md`,
    },
    {
      cwd: '/tmp',
      command: 'cd ~/sub && gh pr edit 12 --body-file b.md',
      env: { HOME: directory },
    },
    {
      cwd: directory,
      command: 'D=sub; cd "$D" && gh pr edit 12 --body-file b.md',
    },
    {
      cwd: join(directory, 'sub'),
      command:
        'cd "$(git rev-parse --show-toplevel)" && gh pr edit 12 --body-file b.md',
    },
    {
      cwd: directory,
      command: 'builtin cd sub && gh pr edit 12 --body-file b.md',
    },
    {
      cwd: directory,
      command: 'command cd -P sub && gh pr edit 12 --body-file b.md',
    },
  ]

  // Act
  const stderrs = cases.map(
    ({ cwd, command, env }) =>
      runHook(bashEvent(command, cwd), env === undefined ? {} : { env }).stderr,
  )

  // Assert
  const inSub = `Closing keyword before an Issue number in ${subFile}, line 1: Closes #7\n${REFUSAL_FIX}\n`
  const inRoot = `Closing keyword before an Issue number in ${rootFile}, line 1: Fixes #3\n${REFUSAL_FIX}\n`
  assert.deepEqual(stderrs, [
    inSub,
    inSub,
    inRoot,
    inSub,
    inSub,
    inSub,
    inRoot,
    inSub,
    inSub,
  ])
})

// Value: protects=the rule of not guessing about the working directory: after a change the script cannot resolve, a relative file is skipped, not read from the hook's folder, where a different file of that name may be; fails_when=a cd to an unassigned variable, to -, to a substitution, a popd, a bare pushd, ~name or two targets leaves the hook's folder in force, so b.md of that folder is read and refused (the control line reads it); why_new=Issue #98 (review finding 2: an unresolvable target makes the directory unknown); seam=child process over a real file in the hook's folder; no_claim=none beyond protects
test('reads no relative file after a directory change it cannot resolve, rather than from the hook folder', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'b.md': 'Fixes #3\n',
  })
  const post = 'gh pr edit 12 --body-file b.md'
  const changes = [
    'cd "$SOMEWHERE"',
    'cd -',
    'cd "$(mktemp -d)"',
    'pushd >/dev/null',
    'popd >/dev/null',
    'cd ~nobody',
    'cd a b',
  ]

  // Act
  const control = runHook(bashEvent(post, directory))
  const results = changes.map((change) =>
    runHook(bashEvent(`${change} && ${post}`, directory)),
  )

  // Assert
  assert.equal(control.status, 2)
  assert.deepEqual(
    results.map((result) => result.status),
    [0, 0, 0, 0, 0, 0, 0],
  )
})

// Value: protects=what stays readable when the directory is unknown: an absolute file, and a relative one after a cd that names an absolute folder again; fails_when=an unresolvable cd makes every later path unreadable for good; why_new=Issue #98 (review finding 2); seam=child process over a real file; no_claim=none beyond protects
test('still reads an absolute file after an unresolvable cd, and a relative file after a later absolute cd', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'b.md': 'Fixes #3\n',
  })
  const bodyFile = join(directory, 'b.md')
  const commands = [
    `cd "$SOMEWHERE" && gh pr edit 12 --body-file ${bodyFile}`,
    `cd "$SOMEWHERE"; cd ${directory}; gh pr edit 12 --body-file b.md`,
  ]

  // Act
  const results = commands.map((command) => runHook(bashEvent(command, '/tmp')))

  // Assert
  const refusal = {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${bodyFile}, line 1: Fixes #3\n${REFUSAL_FIX}\n`,
  }
  assert.deepEqual(results, [refusal, refusal])
})

// Value: protects=a directory change staying with the shell it happens in; fails_when=a cd in a subshell ( … ), $( … ), the background (&) or a pipeline element reaches the commands after it, or a cd inside a subshell does not reach the command in it; why_new=Issue #98 (review finding 2, with finding 4: a subshell does not count); seam=child process over real files; no_claim=none beyond protects
test('keeps the directory that a subshell, a background command or a pipeline element changed to itself', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'b.md': 'Fixes #3\n',
    'sub/b.md': 'Closes #7\n',
  })
  const commands = [
    '(cd sub); gh pr edit 12 --body-file b.md',
    '(cd sub && gh pr edit 12 --body-file b.md)',
    'cd sub & gh pr edit 12 --body-file b.md',
    'cd sub | cat; gh pr edit 12 --body-file b.md',
    'X=$(cd sub && pwd); gh pr edit 12 --body-file b.md',
  ]

  // Act
  const stderrs = commands.map(
    (command) => runHook(bashEvent(command, directory)).stderr,
  )

  // Assert
  const inRoot = `Closing keyword before an Issue number in ${join(directory, 'b.md')}, line 1: Fixes #3\n${REFUSAL_FIX}\n`
  const inSub = `Closing keyword before an Issue number in ${join(directory, 'sub', 'b.md')}, line 1: Closes #7\n${REFUSAL_FIX}\n`
  assert.deepEqual(stderrs, [inRoot, inSub, inRoot, inRoot, inRoot])
})

// Value: protects=a line break put into an inline --body with $'…', the way a model writes a multi-line description on one line; fails_when=\n in $'…' stays two characters, so the keyword is reported on line 1 with the backslash in its text instead of on line 2; why_new=Issue #98 (review finding 3: decode $'…'); seam=child process; no_claim=none beyond protects
test("reads a line break written as \\n inside $'…' as a line break, and numbers the line", () => {
  // Arrange
  const event = bashEvent("gh pr edit 12 --body $'Intro\\nCloses #1'", '/tmp')

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 2: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the options that follow a double-quoted command substitution whose inside has quotes and a ; of its own; fails_when=the quote inside $( … ) ends the double-quoted word early and the ; cuts the command, so the --body after it is never seen; why_new=Issue #98 (review finding 3: consume a balanced $( … ) inside double quotes); seam=child process; no_claim=none beyond protects
test('keeps the options after a double-quoted $( … ) that has quotes and a ; of its own', () => {
  // Arrange
  const event = bashEvent(
    'gh pr create --title "$(echo "a b; c")" --body \'Closes #1\'',
    '/tmp',
  )

  // Act
  const result = runHook(event)

  // Assert
  assert.deepEqual(result, {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in --body, line 1: Closes #1\n${REFUSAL_FIX}\n`,
  })
})

// Value: protects=the hook staying inside its 5 s timeout on a body that the old pattern took quadratic time on; fails_when=a body file of 262,144 bytes made of "fix-" repeated takes a second or more to scan, because a bounded name pattern is unbounded again; why_new=Issue #98 (review finding 5: polynomial backtracking); seam=child process over a real file of the largest size the hook reads; no_claim=a time limit on every input (see the hostile command lines test)
test('scans a 262,144-byte body made of "fix-" repeated in under a second', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'fix.md': 'fix-'.repeat(65_536),
  })
  const event = bashEvent(
    `gh pr edit 12 --body-file ${join(directory, 'fix.md')}`,
    directory,
  )

  // Act
  const startedAt = performance.now()
  const result = runHook(event)
  const elapsedMs = performance.now() - startedAt

  // Assert
  assert.deepEqual(result, { status: 0, stdout: '', stderr: '' })
  assert.ok(elapsedMs < 1000, `the scan took ${Math.round(elapsedMs)} ms`)
})

// Value: protects=the hook staying inside its 5 s timeout, and the stack, on command lines made to be slow; fails_when=an unclosed ${a:- repeated, $( or ( nested tens of thousands deep, thousands of heredocs, a long run of line breaks or of quotes takes a second or more, overflows the stack, or does not end; why_new=Issue #98 (review finding 5: a long ${a:- command must not hang); seam=child process; no_claim=a time limit on a body file (see the fix- test)
test('reads hostile command lines (an unclosed ${a:-, deep $( and (, many heredocs, many line breaks) in under a second each', () => {
  // Arrange
  const commands = [
    'gh pr edit 1 --body "' + `\${a:-`.repeat(40_000) + '"',
    'gh pr edit 1 --body "' + '$('.repeat(40_000) + '"',
    '('.repeat(100_000) + ' gh pr edit 1 --body x',
    'cat <<A\n'.repeat(20_000),
    '\n'.repeat(250_000) + 'gh pr edit 1 --body x',
    "'".repeat(100_000),
  ]

  // Act
  const outcomes = commands.map((command) => {
    const startedAt = performance.now()
    const { status } = runHook(bashEvent(command, '/tmp'))
    return { status, isFast: performance.now() - startedAt < 1000 }
  })

  // Assert
  assert.deepEqual(
    outcomes,
    commands.map(() => ({ status: 0, isFast: true })),
  )
})

// Value: protects=the hook letting a command line through unread when it is longer than a pull request command can be; fails_when=a command line of 262,145 characters is parsed and refused, or one of exactly 262,144 characters is not; why_new=Issue #98 (review finding 5: skip, with exit 0, a longer command line); seam=child process; no_claim=what a shell does with such a line
test('lets a command line over 262,144 characters through unread, and reads one of exactly 262,144', () => {
  // Arrange
  const refusing = "gh pr edit 1 --body 'Closes #1'\n"
  const atCap = refusing + '#'.repeat(262_144 - refusing.length)
  const overCap = `${atCap}#`

  // Act
  const readLine = runHook(bashEvent(atCap, '/tmp'))
  const skippedLine = runHook(bashEvent(overCap, '/tmp'))

  // Assert
  assert.equal(atCap.length, 262_144)
  assert.equal(readLine.status, 2)
  assert.deepEqual(skippedLine, { status: 0, stdout: '', stderr: '' })
})

// Value: protects=the commands of a line staying apart at a lone & (the background), so the -F of the command after it is not an option of the pull request command; and the redirections 2>&1, >/dev/null 2>&1, &> and >&2 not cutting the command short; fails_when=gh pr edit 1 -F ok.md & git commit -F m.txt reads m.txt (a false refusal), or a redirection ends the command so the file before it is never read; why_new=Issue #98 (review finding 6); seam=child process over real files; no_claim=none beyond protects
test('ends a command at a lone &, but not at 2>&1, &> or >&2', async (context) => {
  // Arrange
  const directory = await temporaryDirectory(context, {
    'ok.md': 'Refs #1\n',
    'm.txt': 'Fixes #3\n',
    'body.md': 'Closes #4\n',
  })
  const background = runHook(
    bashEvent('gh pr edit 1 -F ok.md & git commit -F m.txt', directory),
  )
  const redirected = [
    'gh pr edit 1 -F body.md 2>&1',
    'gh pr edit 1 -F body.md >/dev/null 2>&1 && true',
    'gh pr edit 1 -F body.md &> out.log',
    'gh pr edit 1 -F body.md >&2',
  ].map((command) => runHook(bashEvent(command, directory)))

  // Assert
  assert.deepEqual(background, { status: 0, stdout: '', stderr: '' })
  const refusal = {
    status: 2,
    stdout: '',
    stderr: `Closing keyword before an Issue number in ${join(directory, 'body.md')}, line 1: Closes #4\n${REFUSAL_FIX}\n`,
  }
  assert.deepEqual(redirected, [refusal, refusal, refusal, refusal])
})

// Value: protects=a refusal that stays readable and keeps the match in view: a long matching line is cut to 200 characters around the words that matched, with … where it is cut; fails_when=a line of 600 characters is printed whole, the cut hides the match (it starts at the left end of a line whose match is far right), or the result is not 200 characters long; why_new=Issue #98 (review finding 7); seam=none; no_claim=none beyond protects
test('cuts a long matching line to 200 characters around its match, with … where it is cut', () => {
  // Arrange
  const matchInTheMiddle = `${'a'.repeat(300)} Closes #1 ${'b'.repeat(300)}`
  const matchAtTheStart = `Closes #1 ${'z'.repeat(400)}`

  // Act
  const [inTheMiddle] = findClosingReferences(matchInTheMiddle)
  const [atTheStart] = findClosingReferences(matchAtTheStart)

  // Assert
  assert.deepEqual(inTheMiddle, {
    lineNumber: 1,
    lineText: `…${'a'.repeat(38)} Closes #1 ${'b'.repeat(149)}…`,
  })
  assert.deepEqual(atTheStart, {
    lineNumber: 1,
    lineText: `Closes #1 ${'z'.repeat(189)}…`,
  })
  assert.equal(inTheMiddle.lineText.length, 200)
  assert.equal(atTheStart.lineText.length, 200)
})

// Value: protects=a refusal that stays short when a body has many closing lines: at most 20 are named, then one line counts the rest; fails_when=25 matching lines print 25 lines, the count is wrong or in the plural for one line, or the sentence of the fix is lost; why_new=Issue #98 (review finding 7); seam=the refusal function called with a real event; no_claim=none beyond protects
test('names at most 20 matching lines, then counts the rest in one line', () => {
  // Arrange
  const body = (count) =>
    Array.from({ length: count }, (_, index) => `Closes #${index + 1}`).join(
      '\\n',
    )
  const eventWith = (count) =>
    bashEvent(`gh pr edit 1 --body $'${body(count)}'`, '/tmp')

  // Act
  const twentyFive = listClosingKeywordRefusals(eventWith(25), {})
  const twentyOne = listClosingKeywordRefusals(eventWith(21), {})
  const twenty = listClosingKeywordRefusals(eventWith(20), {})

  // Assert
  assert.equal(twentyFive.length, 22)
  assert.equal(
    twentyFive[0],
    'Closing keyword before an Issue number in --body, line 1: Closes #1',
  )
  assert.equal(
    twentyFive[19],
    'Closing keyword before an Issue number in --body, line 20: Closes #20',
  )
  assert.equal(
    twentyFive[20],
    '5 more lines have a closing keyword before an Issue number.',
  )
  assert.equal(twentyFive[21], REFUSAL_FIX)
  assert.equal(
    twentyOne[20],
    '1 more line has a closing keyword before an Issue number.',
  )
  assert.equal(twenty.length, 21)
  assert.equal(twenty[20], REFUSAL_FIX)
})
