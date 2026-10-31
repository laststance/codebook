// Posts one native trial's run log to the open cycle Issue through `gstack-post`, after refusing private home paths (Cycle 0068, task 4).
//
//   node extension/scripts/post-trial-evidence.mjs <run-log.md> [--issue <n>] [--manifest <dir>]
//
// Run `--help` for the prerequisites, an example, the exit codes and the error codes.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import nodePath, { delimiter, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  CommandRefusal,
  EXIT,
  redactSecrets,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { openWithoutFollowing } from './utils/openWithoutFollowing.mjs'

/** GitHub's limit for one comment body, in characters. */
export const COMMENT_CHARACTER_LIMIT = 65_536

/** The most refused tokens one refusal lists, so a log full of paths cannot flood the terminal. */
const MAX_LISTED_PATHS = 50

/** The exit codes that `gstack-post`'s own results map to, so they never collide with this command's refusals (Implementation 0). */
export const POST_EXIT = Object.freeze({ HIGH: 10, MEDIUM: 11, GH_FAILED: 12 })

/**
 * Home-looking directories AGENTS.md publishes; a path is public only as exactly one of these or below one, matched case-sensitively as published.
 * `/Users/lume` is the macOS Space VM's account; the other two are the development-target checkouts.
 */
export const PUBLIC_DIRECTORIES = Object.freeze([
  '/Users/lume',
  '/Users/ryotamurakami/repository/nextjs-dashboard',
  '/home/murakami/laststance/nextjs-dashboard',
])

/** The file `--manifest` writes inside the evidence folder. */
const MANIFEST_FILE_NAME = 'manifest.sha256'

/** The `--help` text: prerequisites, one example, exit codes and error codes (Implementation 0). */
export const HELP_TEXT = `Usage: node extension/scripts/post-trial-evidence.mjs <run-log.md> [--issue <n>] [--manifest <dir>]

Posts one native trial's run log as a comment on the open cycle Issue through
gstack-post (which scans the exact bytes it sends). It refuses a log that holds a
file:// URL or a private absolute home path before any network call.

Options:
  --issue <n>        Issue number (digits). Default: the one open Issue labelled "cycle".
  --manifest <dir>   Evidence folder inside the repository's artifacts/. Writes
                     <dir>/manifest.sha256 (shasum -a 256 format, sorted, relative names)
                     and appends "Manifest: <dir>/manifest.sha256 sha256 <hash> (<n> files)"
                     to the posted comment.
  --help             Print this text.

Prerequisites:
  - the pinned Node (.node-version) and, for the default Issue lookup, gh signed in as the
    repository's account
  - gstack-post, found at $GSTACK_POST, on PATH, then ~/.claude/skills/gstack/bin/gstack-post,
    then ~/.codex/skills/gstack/bin/gstack-post (never a fallback to plain gh)

Example:
  node extension/scripts/post-trial-evidence.mjs artifacts/c68-n68/vscode-run1/run-log.md \\
    --manifest artifacts/c68-n68/vscode-run1

Public home paths (matched case-sensitively, whole directory or followed by "/", no ".."):
  /Users/lume, /Users/ryotamurakami/repository/nextjs-dashboard,
  /home/murakami/laststance/nextjs-dashboard. Repo-relative paths are allowed.

Exit codes:
  0   posted
  1   refused before any side effect
  2   failed before any side effect
  3   (not used)
  4   outcome unknown or in need of an audit (check the Issue before retrying)
  10  gstack-post refused a HIGH finding (gstack-post exit 1)
  11  gstack-post found MEDIUM findings and needs a confirmation (gstack-post exit 2); the
      RULE:/TOKEN: lines and the exact --confirm command are printed, the private copy is kept
  12  gh failed inside gstack-post (gstack-post exit 3)
  64  usage error

Error codes:
  E_USAGE            bad option, missing run log, or --issue that is not digits
  E_LOG_MISSING      the run log cannot be read
  E_LOG_EMPTY        the run log is empty
  E_LOG_ENCODING     the run log is not valid UTF-8
  E_PRIVATE_PATH     a line holds a file:// URL or a private home path (line numbers and tokens listed)
  E_BODY_TOO_LONG    the comment (run log plus manifest line) exceeds ${COMMENT_CHARACTER_LIMIT} characters
  E_MANIFEST_DIR     --manifest is not a directory inside the repository's artifacts/
  E_MANIFEST_SYMLINK a symbolic link inside the evidence folder
  E_MANIFEST_FILE    something other than a regular file or folder inside the evidence folder
  E_MANIFEST_NAME    a file name the manifest format cannot hold (newline or backslash)
  E_MANIFEST_EMPTY   the evidence folder holds no file
  E_MANIFEST_CHANGED a file changed while it was hashed (a recording still being written)
  E_ISSUE_COUNT      zero or several open "cycle" Issues and no --issue
  E_GH               gh failed while listing the open cycle Issues
  E_NO_GSTACK_POST   gstack-post is not installed
  E_POST_HIGH        gstack-post refused a HIGH finding (exit 10)
  E_POST_MEDIUM      gstack-post needs a confirmation (exit 11)
  E_POST_GH          gstack-post's gh call failed (exit 12)
  E_POST_UNKNOWN     gstack-post ended with an undocumented result (exit 4)
  E_INTERNAL         unexpected exception (exit 2 before a side effect, 4 after one)
`

/**
 * Every place a home directory can be named, matched case-insensitively at one position (sticky): the macOS and Windows file systems ignore case.
 * Group order matters only for readability; the alternatives do not overlap at one start.
 */
const CANDIDATE_START =
  /file:\/\/|\/Users\/|\/home\/|\/mnt\/[a-z]\/Users\/|[a-z]:[\\/]+Users[\\/]+|[\\/]{2,}wsl\$[\\/]+|[\\/]{2,}wsl\.localhost[\\/]+|~\/|\$\{HOME\}|\$HOME|%USERPROFILE%/iy

/**
 * A character before a start that makes it part of a longer word or URL path (`https://example.com/home/a`, `artifacts/Users/a`), so it is no candidate; anything else (`.`, `-`, `_`, `:`, `,`, `=`, …) fails closed.
 * The exemption holds only inside a relative path or a URL: a token that starts with `/` and holds no `://` before the start is an absolute path (`/Volumes/disk/Users/bob`, `//Users/bob`), where the start is a real home.
 */
const WORD_OR_PATH_CHARACTER = /[A-Za-z0-9/]/

/** Separators that can chain several paths inside one token (`PATH=a:b`, `a,b`, `a;b`, `a|b`). */
const LIST_SEPARATOR = /[:,;|=]/

/** The characters that end a candidate token. */
const CANDIDATE_END = /[\s`"'()[\]<>]/

/**
 * Says whether a token that is a home path names a public directory (case-sensitively) and holds no `..` segment.
 *
 * Why: the only home-looking paths allowed in a public Issue are the ones AGENTS.md already publishes.
 * Called by {@link findPrivatePaths}.
 *
 * @param {string} token - The matched token, from its start to its end.
 * @returns {boolean} `true` when the token is public.
 * @example isPublicToken('/Users/lume/qa/c68/x') // => true
 */
function isPublicToken(token) {
  const isUnderPublicDirectory = PUBLIC_DIRECTORIES.some(
    (directory) => token === directory || token.startsWith(`${directory}/`),
  )
  if (!isUnderPublicDirectory) return false
  // A `..` segment can climb out of the public directory.
  return !token.split(/[\\/]/).includes('..')
}

/**
 * Decides whether one candidate token names a private place.
 *
 * Why: `file://` URLs and the forms that name a home without saying whose are always refused; a `<root>/<name>` home path is refused unless it is public.
 * Called by {@link findPrivatePaths}.
 *
 * @param {string} prefix - The matched start (`/Users/`, `file://`, `$HOME`, …), as written.
 * @param {string} token - The whole token, from its start to its end.
 * @returns {boolean} `true` when the token must be refused.
 * @example isPrivateToken('/Users/', '/Users/murakami/x') // => true
 */
function isPrivateToken(prefix, token) {
  const lowerPrefix = prefix.toLowerCase()
  const alwaysRefused =
    lowerPrefix === 'file://' ||
    /^[\\/]+wsl/.test(lowerPrefix) ||
    lowerPrefix === '~/' ||
    lowerPrefix.startsWith('$') ||
    lowerPrefix.startsWith('%')
  if (alwaysRefused) return true
  // A home path needs a name segment right after the root: `/Users/` alone (prose about the folder) names no home.
  const remainder = token.slice(prefix.length)
  if (remainder === '') return false
  const name = remainder.split(/[\\/]/)[0]
  if (name === '') return true
  return !isPublicToken(token)
}

/**
 * Splits text into lines at CRLF, LF or a lone CR, so a line number is the number an editor shows whichever line ending the log uses.
 * @param {string} text - Decoded text (BOM already removed).
 * @returns {string[]} The lines.
 * @example splitLines('a\r\nb') // => ['a', 'b']
 */
function splitLines(text) {
  return text.split(/\r\n|\n|\r/)
}

/**
 * Finds every file:// URL and private absolute home path in a text.
 *
 * Why: the Issue is world-readable, so a run log must not name the owner's home directories, QA profiles or other projects (D4).
 * Called by {@link postTrialEvidence} on the run log (and the manifest text), before any network call.
 * The rule works on the text as written: a candidate starts at a home form (case-insensitive) unless a letter, digit or `/` precedes it inside a relative path or a URL (a token that starts with `/` and holds no `://` before the candidate is an absolute path, so a home form inside it is refused), and ends at whitespace, a backtick, a quote, a parenthesis, a bracket, an angle bracket or the line end.
 *
 * @param {string} text - Decoded text.
 * @returns {{ line: number, token: string }[]} One entry per refused token, in order; `line` starts at 1. The line itself is never returned.
 * @example
 * findPrivatePaths('see /home/murakami/x and artifacts/a.png') // => [{ line: 1, token: '/home/murakami/x' }]
 */
export function findPrivatePaths(text) {
  const refused = []
  splitLines(text).forEach((line, lineIndex) => {
    let position = 0
    // The end of the token being scanned, cached so rescanning inside a public token stays linear.
    let tokenEnd = -1
    let tokenStart = -1
    // Where the surrounding token began (after the last terminator) and whether it started with `/` or held `://` so far, tracked as the position advances.
    let surroundingTokenStart = 0
    let surroundingIsAbsolute = false
    let surroundingHasScheme = false
    let advancedTo = 0
    while (position < line.length) {
      while (advancedTo < position) {
        const character = line[advancedTo]
        if (CANDIDATE_END.test(character)) {
          surroundingTokenStart = advancedTo + 1
          surroundingIsAbsolute = false
          surroundingHasScheme = false
        } else {
          if (advancedTo === surroundingTokenStart) {
            surroundingIsAbsolute = character === '/'
          }
          if (
            character === '/' &&
            advancedTo > surroundingTokenStart &&
            line[advancedTo - 1] === '/' &&
            line[advancedTo - 2] === ':'
          ) {
            surroundingHasScheme = true
          }
        }
        advancedTo += 1
      }
      // A word or path character before the start makes it part of something longer, unless that token is an absolute path.
      const followsWordOrPath =
        position > 0 && WORD_OR_PATH_CHARACTER.test(line[position - 1])
      // Inside an earlier public token (`/Users/lume/qa/home/x`) a later start is part of that public path.
      const isInsidePublicToken = position > tokenStart && position < tokenEnd
      const isInsideAbsolutePath =
        followsWordOrPath &&
        surroundingIsAbsolute &&
        !surroundingHasScheme &&
        !isInsidePublicToken
      CANDIDATE_START.lastIndex = position
      const match =
        followsWordOrPath && !isInsideAbsolutePath
          ? null
          : CANDIDATE_START.exec(line)
      // Only a slash start hides a home inside an absolute path; `a:/Users` after a slash stays a path segment.
      if (match === null || (isInsideAbsolutePath && match[0][0] !== '/')) {
        position += 1
        continue
      }
      // Reuse the cached end while inside the same token; otherwise scan to the next terminator.
      if (tokenEnd < position + match[0].length) {
        tokenStart = position
        tokenEnd = position + match[0].length
        while (tokenEnd < line.length && !CANDIDATE_END.test(line[tokenEnd]))
          tokenEnd += 1
      }
      // A candidate inside an earlier public token is judged up to the next list separator, so each character is judged once.
      let candidateEnd = tokenEnd
      if (position > tokenStart) {
        candidateEnd = position + match[0].length
        while (
          candidateEnd < tokenEnd &&
          !LIST_SEPARATOR.test(line[candidateEnd])
        )
          candidateEnd += 1
      }
      const token = line.slice(position, candidateEnd)
      if (isPrivateToken(match[0], token)) {
        refused.push({ line: lineIndex + 1, token })
        // Continue after a refused token so a path inside it is not matched twice.
        position = candidateEnd
      } else {
        // A public path may be followed by a private one in the same token (`a:/Users/bob`): rescan its interior.
        position += match[0].length
      }
    }
  })
  return refused
}

/**
 * Decodes the run log's bytes as UTF-8, refusing bytes that do not decode.
 * @param {Uint8Array} bytes - The one read of the run log.
 * @param {string} logPath - The path as the caller gave it, for the message.
 * @returns {string} The text without a leading byte order mark.
 * @throws {CommandRefusal} `E_LOG_ENCODING` for invalid UTF-8.
 * @example decodeRunLog(new TextEncoder().encode('ok'), 'log.md') // => 'ok'
 */
export function decodeRunLog(bytes, logPath) {
  try {
    // The BOM is dropped so the first line's characters are the author's.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CommandRefusal(
      'E_LOG_ENCODING',
      `the run log is not valid UTF-8: ${logPath}`,
      { fix: 'save the run log as UTF-8, then rerun' },
    )
  }
}

/**
 * Turns the refused tokens into one `E_PRIVATE_PATH` refusal naming line numbers and tokens, never the lines.
 * @param {{ line: number, token: string }[]} refused - From {@link findPrivatePaths}.
 * @param {string} source - What was scanned (`the run log` or `the manifest`).
 * @returns {CommandRefusal} The refusal, not thrown yet.
 * @example privatePathRefusal([{ line: 3, token: '$HOME/x' }], 'the run log')
 */
function privatePathRefusal(refused, source) {
  const listed = refused
    .slice(0, MAX_LISTED_PATHS)
    .map(({ line, token }) => `line ${line}: ${token}`)
  if (refused.length > MAX_LISTED_PATHS) {
    listed.push(`and ${refused.length - MAX_LISTED_PATHS} more`)
  }
  return new CommandRefusal(
    'E_PRIVATE_PATH',
    `${source} names ${refused.length} private path(s)`,
    {
      details: listed,
      fix: 'replace it with a repo-relative path or remove it',
    },
  )
}

/**
 * Throws `E_BODY_TOO_LONG` when a body is over GitHub's comment limit.
 * @param {string} text - The body that would be posted.
 * @throws {CommandRefusal} `E_BODY_TOO_LONG`.
 * @example assertBodyWithinLimit('short')
 */
function assertBodyWithinLimit(text) {
  // Code points, not UTF-16 units: GitHub counts characters.
  const length = Array.from(text).length
  if (length > COMMENT_CHARACTER_LIMIT) {
    throw new CommandRefusal(
      'E_BODY_TOO_LONG',
      `the comment is ${length} characters; GitHub's limit is ${COMMENT_CHARACTER_LIMIT}`,
      { fix: 'shorten the run log or split it into two posts' },
    )
  }
}

/**
 * Returns the path of `child` below `parent`, or `undefined` when `child` is not strictly inside it.
 *
 * Why: `relative` returns an absolute path for another Windows drive or a UNC share, which `resolve` then treats as the answer; the check must refuse it.
 * Called by {@link resolveManifestDirectory}.
 *
 * @param {string} parent - The containing folder (real path).
 * @param {string} child - The candidate (real path).
 * @param {Pick<typeof nodePath, 'relative' | 'isAbsolute' | 'sep'>} [pathApi] - Path flavor; tests pass `path.win32`.
 * @returns {string | undefined} The relative path, or `undefined` for the folder itself, `..`, or another drive.
 * @example relativeInside('C:\\r\\artifacts', 'D:\\x', path.win32) // undefined
 */
export function relativeInside(parent, child, pathApi = nodePath) {
  const fromParent = pathApi.relative(parent, child)
  const isInside =
    fromParent !== '' &&
    fromParent !== '..' &&
    !fromParent.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(fromParent)
  return isInside ? fromParent : undefined
}

/**
 * Resolves and validates the `--manifest` folder against the repository's `artifacts/` by real path.
 *
 * Why: a symlink in `artifacts/` or a `..` must not lead the manifest (and its hashing of every file) outside the evidence area.
 * Called by {@link buildManifest}.
 *
 * @param {string} directory - The `--manifest` value; a relative one resolves against the repository root.
 * @param {string} repositoryRoot - The repository root.
 * @param {FileSystemSeams} fileSystem - File system seams.
 * @returns {Promise<{ realDirectory: string, displayDirectory: string }>} The real path and the repo-relative, `/`-separated name (`artifacts/x`) used in the posted line.
 * @throws {CommandRefusal} `E_MANIFEST_DIR`.
 * @example await resolveManifestDirectory('artifacts/c68-n68/x', '/repo', fileSystem)
 */
async function resolveManifestDirectory(directory, repositoryRoot, fileSystem) {
  const refuse = (reason) =>
    new CommandRefusal('E_MANIFEST_DIR', `${reason}: ${directory}`, {
      fix: 'pass a folder inside the repository artifacts/, for example artifacts/c68-n68/vscode-run1',
    })
  let realDirectory
  let realArtifacts
  try {
    realArtifacts = await fileSystem.realpath(join(repositoryRoot, 'artifacts'))
    realDirectory = await fileSystem.realpath(
      resolve(repositoryRoot, directory),
    )
  } catch {
    throw refuse('the evidence folder does not exist or is not readable')
  }
  const fromArtifacts = relativeInside(realArtifacts, realDirectory)
  const isInside = fromArtifacts !== undefined
  if (!isInside) {
    throw refuse(
      "the evidence folder is not inside the repository's artifacts/",
    )
  }
  let status
  try {
    status = await fileSystem.stat(realDirectory)
  } catch {
    throw refuse('the evidence folder is not readable')
  }
  if (!status.isDirectory()) throw refuse('the evidence path is not a folder')
  return {
    realDirectory,
    displayDirectory: `artifacts/${fromArtifacts.split(sep).join('/')}`,
  }
}

/**
 * Lists every regular file below a folder (names relative, `/`-separated), refusing links and anything that is not a file or folder.
 *
 * Why: a symbolic link could hash a file outside the evidence folder; a pipe or device would block.
 * Called by {@link buildManifest}.
 *
 * @param {string} root - The real path of the evidence folder.
 * @param {FileSystemSeams} fileSystem - File system seams.
 * @returns {Promise<string[]>} Relative names including a top-level `manifest.sha256` if present.
 * @throws {CommandRefusal} `E_MANIFEST_SYMLINK`, `E_MANIFEST_FILE`, `E_MANIFEST_NAME`.
 * @example await listEvidenceFiles('/repo/artifacts/x', fileSystem) // => ['a.png', 'sub/b.png']
 */
async function listEvidenceFiles(root, fileSystem) {
  const names = []
  const pending = ['']
  while (pending.length > 0) {
    const folder = pending.pop()
    for (const entry of await fileSystem.readdir(join(root, folder))) {
      const name = folder === '' ? entry : `${folder}/${entry}`
      // Newline and backslash make `shasum` escape the name; refuse rather than write an ambiguous line.
      if (/[\n\r\\]/.test(name)) {
        throw new CommandRefusal(
          'E_MANIFEST_NAME',
          'a file name holds a newline or a backslash',
          { fix: 'rename the file inside the evidence folder' },
        )
      }
      const status = await fileSystem.lstat(join(root, name))
      if (status.isSymbolicLink()) {
        throw new CommandRefusal(
          'E_MANIFEST_SYMLINK',
          `a symbolic link inside the evidence folder: ${name}`,
          { fix: 'replace the link with a copy of the file, then rerun' },
        )
      }
      if (status.isDirectory()) pending.push(name)
      else if (status.isFile()) names.push(name)
      else {
        throw new CommandRefusal(
          'E_MANIFEST_FILE',
          `not a regular file: ${name}`,
          { fix: 'remove it from the evidence folder, then rerun' },
        )
      }
    }
  }
  return names
}

/**
 * Hashes one file as a stream and refuses it when it changed while being read.
 *
 * Why: a recording still being written would otherwise be hashed in a half state and posted as evidence (D31).
 * Called by {@link buildManifest}.
 *
 * @param {string} path - Absolute path of a regular file.
 * @param {string} name - Its relative name, for the refusal.
 * @param {FileSystemSeams} fileSystem - File system seams (`openFile` opens without following a link).
 * @returns {Promise<string>} The lowercase hex SHA-256.
 * @throws {CommandRefusal} `E_MANIFEST_CHANGED`, `E_MANIFEST_SYMLINK` (a link took the path), `E_MANIFEST_FILE`.
 * @example await hashStableFile('/repo/artifacts/x/a.png', 'a.png', fileSystem)
 */
async function hashStableFile(path, name, fileSystem) {
  let file
  try {
    file = await fileSystem.openFile(path)
  } catch (error) {
    // `ELOOP` and `EREPLACED` mean a link (or another file) took the path after the listing.
    if (error?.code === 'ELOOP' || error?.code === 'EREPLACED') {
      throw new CommandRefusal(
        'E_MANIFEST_SYMLINK',
        `a symbolic link inside the evidence folder: ${name}`,
        { fix: 'replace the link with a copy of the file, then rerun' },
      )
    }
    throw error
  }
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile()) {
      throw new CommandRefusal(
        'E_MANIFEST_FILE',
        `not a regular file: ${name}`,
        {
          fix: 'remove it from the evidence folder, then rerun',
        },
      )
    }
    const hash = createHash('sha256')
    let bytesRead = 0n
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk)
      bytesRead += BigInt(chunk.length)
    }
    const after = await file.stat({ bigint: true })
    // The path itself may now name another file (renamed over); the open handle cannot tell.
    let current
    try {
      current = await fileSystem.lstat(path, { bigint: true })
    } catch {
      current = undefined
    }
    const isStable =
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      bytesRead === before.size &&
      current?.isFile() === true &&
      current.dev === before.dev &&
      current.ino === before.ino
    if (!isStable) {
      throw new CommandRefusal(
        'E_MANIFEST_CHANGED',
        `the file changed while it was hashed: ${name}`,
        { fix: 'wait until the recording is finished, then rerun' },
      )
    }
    return hash.digest('hex')
  } finally {
    await file.close()
  }
}

/**
 * Builds the evidence folder's manifest text and the line that names its hash, writing nothing.
 *
 * Why: AGENTS.md asks evidence to be linked by stable location and hash; every native trial hashed its folder by hand (D12).
 * Called by {@link postTrialEvidence} for `--manifest`.
 *
 * @param {string} directory - The `--manifest` value.
 * @param {string} repositoryRoot - The repository root.
 * @param {FileSystemSeams} fileSystem - File system seams.
 * @returns {Promise<{ manifestPath: string, displayPath: string, manifestText: string, line: string, fileCount: number }>} `manifestText` is in `shasum -a 256` format (`<hash>  <name>`), sorted by name, without the manifest itself; `line` is the line to append to the post.
 * @throws {CommandRefusal} See {@link resolveManifestDirectory}, {@link listEvidenceFiles}, {@link hashStableFile}; `E_MANIFEST_EMPTY`.
 * @example await buildManifest('artifacts/c68-n68/x', '/repo', fileSystem)
 */
export async function buildManifest(directory, repositoryRoot, fileSystem) {
  const { realDirectory, displayDirectory } = await resolveManifestDirectory(
    directory,
    repositoryRoot,
    fileSystem,
  )
  const names = (await listEvidenceFiles(realDirectory, fileSystem))
    // The manifest never lists itself; a symlink under that name was refused by the listing.
    .filter((name) => name !== MANIFEST_FILE_NAME)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  if (names.length === 0) {
    throw new CommandRefusal(
      'E_MANIFEST_EMPTY',
      `the evidence folder holds no file: ${displayDirectory}`,
      { fix: 'put the evidence files in the folder, then rerun' },
    )
  }
  let manifestText = ''
  for (const name of names) {
    const digest = await hashStableFile(
      join(realDirectory, name),
      name,
      fileSystem,
    )
    manifestText += `${digest}  ${name}\n`
  }
  const manifestHash = createHash('sha256').update(manifestText).digest('hex')
  return {
    manifestPath: join(realDirectory, MANIFEST_FILE_NAME),
    displayPath: `${displayDirectory}/${MANIFEST_FILE_NAME}`,
    manifestText,
    line: `Manifest: ${displayDirectory}/${MANIFEST_FILE_NAME} sha256 ${manifestHash} (${names.length} files)`,
    fileCount: names.length,
  }
}

/**
 * Finds `gstack-post`: `$GSTACK_POST`, then `PATH`, then the Claude and Codex gstack installs.
 *
 * Why: the post must go through `gstack-post`'s byte scan; there is no fallback to plain `gh issue comment`.
 * Called by {@link postTrialEvidence} before anything is written.
 *
 * @param {{ environment: NodeJS.ProcessEnv, homeDirectory: string, isExecutable: (path: string) => Promise<boolean> }} options - Seams.
 * @returns {Promise<string>} The path to run.
 * @throws {CommandRefusal} `E_NO_GSTACK_POST` with the install hint.
 * @example await locateGstackPost({ environment: process.env, homeDirectory: homedir(), isExecutable })
 */
export async function locateGstackPost({
  environment,
  homeDirectory,
  isExecutable,
}) {
  const candidates = []
  // The caller's own environment is trusted.
  if (environment.GSTACK_POST) candidates.push(environment.GSTACK_POST)
  for (const folder of (environment.PATH ?? '').split(delimiter)) {
    if (folder !== '') candidates.push(join(folder, 'gstack-post'))
  }
  for (const install of ['.claude', '.codex']) {
    candidates.push(
      join(homeDirectory, install, 'skills', 'gstack', 'bin', 'gstack-post'),
    )
  }
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate
  }
  throw new CommandRefusal(
    'E_NO_GSTACK_POST',
    'gstack-post is not installed (looked at $GSTACK_POST, PATH, ~/.claude and ~/.codex)',
    {
      fix: 'install gstack (see https://github.com/garrytan/gstack), then rerun; this command never posts with plain gh',
    },
  )
}

/**
 * Picks the Issue to post to: `--issue`, or the single open `cycle` Issue.
 * @param {string | undefined} requested - The `--issue` digits, if given.
 * @param {(file: string, args: string[]) => Promise<CommandResult>} runCommand - Command runner seam.
 * @param {NodeJS.ProcessEnv} environment - For redacting relayed stderr.
 * @returns {Promise<string>} The Issue number.
 * @throws {CommandRefusal} `E_ISSUE_COUNT`, `E_GH`.
 * @example await resolveIssue(undefined, runCommand, process.env)
 */
async function resolveIssue(requested, runCommand, environment) {
  if (requested !== undefined) return requested
  const result = await runCommand('gh', [
    'issue',
    'list',
    '--label',
    'cycle',
    '--state',
    'open',
    '--json',
    'number,title',
  ])
  const failure = (reason) =>
    new CommandRefusal('E_GH', reason, { fix: 'gh auth status' })
  if (result.status !== 0) {
    const firstLine = redactSecrets(
      (result.stderr ?? '').trim().split('\n')[0] ?? '',
      environment,
    )
    throw failure(`gh issue list failed: ${firstLine}`)
  }
  let issues
  try {
    issues = JSON.parse(result.stdout)
  } catch {
    throw failure('gh issue list printed output that is not JSON')
  }
  const isIssueList =
    Array.isArray(issues) &&
    issues.every((issue) => Number.isInteger(issue?.number))
  if (!isIssueList) throw failure('gh issue list printed an unexpected shape')
  if (issues.length === 1) return String(issues[0].number)
  throw new CommandRefusal(
    'E_ISSUE_COUNT',
    `${issues.length} open Issues are labelled "cycle"; exactly one is needed`,
    {
      details: issues.map(
        (issue) =>
          `#${issue.number} ${String(issue.title ?? '').replace(/\s+/g, ' ')}`,
      ),
      fix: 'rerun with --issue <n>',
    },
  )
}

/**
 * Quotes a value for a POSIX shell only when it holds characters the shell would split or expand.
 *
 * Why: the printed confirm command names the exact executable that was found, which may contain spaces.
 * Called by {@link mapPostResult}.
 *
 * @param {string} value - A path or argument.
 * @returns {string} The value, single-quoted if needed.
 * @example shellQuote("/opt/my tools/gstack-post") // '/opt/my tools/gstack-post' (quoted)
 */
function shellQuote(value) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Turns `gstack-post`'s documented results into this command's exit codes.
 *
 * Why: `gstack-post` exits 1 (HIGH refused), 2 (MEDIUM needs confirmation) and 3 (`gh` failed); they would collide with this command's own 1 and 2 and 3, so they map to 10, 11 and 12.
 * Called by {@link postTrialEvidence}.
 *
 * @param {CommandResult} result - What `gstack-post` returned.
 * @param {{ issue: string, copyPath: string, gstackPost: string, environment: NodeJS.ProcessEnv }} context - For messages and the confirm command.
 * @returns {{ url: string } | never} The comment URL on success.
 * @throws {CommandRefusal} `E_POST_HIGH`, `E_POST_MEDIUM`, `E_POST_GH` or `E_POST_UNKNOWN`.
 * @example mapPostResult({ status: 0, stdout: 'https://github.com/o/r/issues/1#issuecomment-2\n', stderr: '' }, context)
 */
function mapPostResult(result, { issue, copyPath, gstackPost, environment }) {
  const stderrLines = redactSecrets(result.stderr ?? '', environment)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `gstack-post: ${line}`)
  if (result.status === 0) {
    const url = /https?:\/\/\S+/.exec(result.stdout ?? '')?.[0]
    return { url: url ?? (result.stdout ?? '').trim() }
  }
  if (result.status === 1) {
    throw new CommandRefusal(
      'E_POST_HIGH',
      'gstack-post: refused a HIGH finding; nothing was posted',
      {
        exitCode: POST_EXIT.HIGH,
        details: stderrLines,
        fix: 'remove the finding from the run log, then rerun',
      },
    )
  }
  if (result.status === 2) {
    const findingLines = (result.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(RULE|TOKEN):/.test(line))
    const token = /^TOKEN:\s*(\S+)/m.exec(result.stdout ?? '')?.[1]
    throw new CommandRefusal(
      'E_POST_MEDIUM',
      `gstack-post: MEDIUM findings need confirmation; nothing was posted; the private copy is kept at ${copyPath}`,
      {
        exitCode: POST_EXIT.MEDIUM,
        details: [
          ...findingLines.map((line) => `gstack-post: ${line}`),
          ...stderrLines,
          'To accept the findings, run:',
        ],
        // Never passed by this command: the caller decides to accept a finding.
        fix: `${shellQuote(gstackPost)} issue-comment ${issue} --body-file ${shellQuote(copyPath)} --confirm ${token ?? '<token>'}`,
      },
    )
  }
  if (result.status === 3) {
    throw new CommandRefusal(
      'E_POST_GH',
      'gstack-post: gh failed; the comment may not have been posted',
      {
        exitCode: POST_EXIT.GH_FAILED,
        details: stderrLines,
        fix: 'gh auth status, then rerun',
      },
    )
  }
  throw new CommandRefusal(
    'E_POST_UNKNOWN',
    `gstack-post ended with ${result.status ?? result.signal ?? 'no exit code'}; check the Issue before retrying`,
    {
      exitCode: EXIT.UNKNOWN,
      details: stderrLines,
      fix: `gh issue view ${issue} --comments`,
    },
  )
}

/**
 * Runs a program with an argument array (no shell) and collects its output.
 *
 * Why: the production command runner behind the `runCommand` seam, used for `gh` and `gstack-post`.
 * Called through {@link createDefaultSeams}.
 *
 * @param {string} file - Program to run.
 * @param {string[]} args - Its arguments.
 * @param {string} cwd - Working directory.
 * @returns {Promise<CommandResult>} Exit status and output; a program that cannot start gives `status: null` and the reason in `stderr`.
 * @example await runProgram('gh', ['--version'], '/repo')
 */
function runProgram(file, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) =>
      resolvePromise({
        status: null,
        signal: null,
        stdout,
        stderr: error.message,
      }),
    )
    child.on('close', (status, signal) =>
      resolvePromise({ status, signal, stdout, stderr }),
    )
  })
}

/**
 * Builds the production seams; tests pass their own.
 * @returns {Seams} The real file system, process runner, environment and printers.
 * @example const seams = createDefaultSeams()
 */
export function createDefaultSeams() {
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  )
  return {
    repositoryRoot,
    environment: process.env,
    homeDirectory: homedir(),
    print: (line) => console.log(line),
    readFile,
    runCommand: (file, args) => runProgram(file, args, repositoryRoot),
    isExecutable: (path) =>
      access(path, constants.X_OK).then(
        () => true,
        () => false,
      ),
    fileSystem: {
      realpath,
      stat,
      lstat,
      readdir,
      openFile: (path) => openWithoutFollowing(path),
    },
    writeFile,
    rename,
    mkdir,
    mkdtemp,
    rm,
  }
}

/**
 * Parses the command line.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ help: boolean, logPath?: string, issue?: string, manifest?: string }} The options.
 * @throws {CommandRefusal} `E_USAGE` (exit 64).
 * @example parseOptions(['log.md', '--issue', '172'])
 */
function parseOptions(argv) {
  const usage = (reason) =>
    new CommandRefusal('E_USAGE', reason, {
      exitCode: EXIT.USAGE,
      fix: 'node extension/scripts/post-trial-evidence.mjs --help',
    })
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        issue: { type: 'string' },
        manifest: { type: 'string' },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    throw usage(error.message)
  }
  if (parsed.values.help) return { help: true }
  if (parsed.positionals.length !== 1) {
    throw usage('exactly one run log path is needed')
  }
  const { issue, manifest } = parsed.values
  // Digits only: the number goes into an argument array, never a shell, but a stray flag must not pass for a number.
  if (issue !== undefined && !/^[1-9]\d{0,8}$/.test(issue)) {
    throw usage('--issue must be digits (an Issue number)')
  }
  return { help: false, logPath: parsed.positionals[0], issue, manifest }
}

/**
 * Reads the run log once and returns its bytes and decoded text.
 * @param {string} logPath - Path as given.
 * @param {Seams} seams - Seams.
 * @returns {Promise<{ bytes: Uint8Array, text: string }>} The bytes read and their text.
 * @throws {CommandRefusal} `E_LOG_MISSING`, `E_LOG_EMPTY`, `E_LOG_ENCODING`.
 * @example await readRunLog('log.md', seams)
 */
async function readRunLog(logPath, seams) {
  let bytes
  try {
    bytes = await seams.readFile(resolve(logPath))
  } catch {
    throw new CommandRefusal(
      'E_LOG_MISSING',
      `the run log cannot be read: ${logPath}`,
      {
        fix: 'pass the path of an existing run log file',
      },
    )
  }
  const text = decodeRunLog(bytes, logPath)
  if (text.trim() === '') {
    throw new CommandRefusal(
      'E_LOG_EMPTY',
      `the run log is empty: ${logPath}`,
      {
        fix: 'write the trial run into the log, then rerun',
      },
    )
  }
  return { bytes, text }
}

/**
 * The command: checks the run log (and the optional manifest), then posts the checked bytes through `gstack-post`.
 *
 * Why: native trial evidence was posted by hand, hours after the run; this checks private paths, hashes the evidence and posts the exact checked bytes.
 * Called by the script's entry point through {@link runCommandLine}; tests call it with injected seams.
 *
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker for `E_INTERNAL`.
 * @param {string[]} argv - Arguments after the script name.
 * @param {Seams} [seams] - File system, command runners, environment and printer; production ones by default.
 * @returns {Promise<number>} The exit code (0 posted).
 * @throws {CommandRefusal} Any refusal in the `--help` error code list.
 * @example
 * ```js
 * process.exitCode = await runCommandLine((progress) =>
 *   postTrialEvidence(progress, ['artifacts/c68-n68/vscode-run1/run-log.md']),
 * )
 * ```
 */
export async function postTrialEvidence(
  progress,
  argv,
  seams = createDefaultSeams(),
) {
  const options = parseOptions(argv)
  if (options.help) {
    seams.print(HELP_TEXT.trimEnd())
    return EXIT.DONE
  }

  progress.enter('read the run log')
  const { bytes, text } = await readRunLog(options.logPath, seams)

  progress.enter('check private paths in the run log')
  const refusedInLog = findPrivatePaths(text)
  if (refusedInLog.length > 0) {
    throw privatePathRefusal(refusedInLog, 'the run log')
  }
  assertBodyWithinLimit(text)

  // The manifest part of the body is computed in memory first: nothing is written until every check passed.
  let manifest
  let postedText = text
  let appendedBytes = Buffer.alloc(0)
  if (options.manifest !== undefined) {
    progress.enter('hash the evidence folder')
    manifest = await buildManifest(
      options.manifest,
      seams.repositoryRoot,
      seams.fileSystem,
    )
    const lineEnding = text.includes('\r\n') ? '\r\n' : '\n'
    const separator = /[\r\n]$/.test(text) ? '' : lineEnding
    const appended = `${separator}${manifest.line}${lineEnding}`
    postedText = text + appended
    appendedBytes = Buffer.from(appended, 'utf8')
    // The listed names pass the same path check as the log.
    const refusedInManifest = [
      ...findPrivatePaths(manifest.manifestText),
      ...findPrivatePaths(manifest.line),
    ]
    if (refusedInManifest.length > 0) {
      throw privatePathRefusal(refusedInManifest, 'the manifest')
    }
    assertBodyWithinLimit(postedText)
  }

  progress.enter('find gstack-post')
  const gstackPost = await locateGstackPost({
    environment: seams.environment,
    homeDirectory: seams.homeDirectory,
    isExecutable: seams.isExecutable,
  })

  progress.enter('resolve the Issue')
  const issue = await resolveIssue(
    options.issue,
    seams.runCommand,
    seams.environment,
  )

  if (manifest !== undefined) {
    progress.enter('write the manifest', { sideEffect: true })
    // A new exclusive file renamed over the name: a hard link or symlink at `manifest.sha256` is replaced, never written through.
    const temporaryManifestPath = `${manifest.manifestPath}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await seams.writeFile(temporaryManifestPath, manifest.manifestText, {
        flag: 'wx',
        mode: 0o644,
      })
      await seams.rename(temporaryManifestPath, manifest.manifestPath)
    } catch (error) {
      // A leftover temporary file would be hashed into the next manifest.
      await seams.rm(temporaryManifestPath, { force: true })
      throw error
    }
    seams.print(`wrote ${manifest.displayPath} (${manifest.fileCount} files)`)
  }

  progress.enter('write the private copy', { sideEffect: true })
  const temporaryRoot = join(seams.repositoryRoot, '.gstack', 'tmp')
  await seams.mkdir(temporaryRoot, { recursive: true })
  const copyDirectory = await seams.mkdtemp(
    join(temporaryRoot, 'trial-evidence.'),
  )
  const copyPath = join(copyDirectory, 'comment.md')
  // The checked bytes themselves (BOM and line endings included), so an edit after the check is never posted.
  await seams.writeFile(
    copyPath,
    Buffer.concat([Buffer.from(bytes), appendedBytes]),
    {
      mode: 0o600,
    },
  )

  let keepCopy = false
  try {
    progress.enter('post the comment', { sideEffect: true })
    const result = await seams.runCommand(gstackPost, [
      'issue-comment',
      issue,
      '--body-file',
      copyPath,
    ])
    try {
      const { url } = mapPostResult(result, {
        issue,
        copyPath,
        gstackPost,
        environment: seams.environment,
      })
      seams.print(url)
      return EXIT.DONE
    } catch (error) {
      // A MEDIUM finding keeps the copy so the caller can confirm exactly these bytes.
      keepCopy =
        error instanceof CommandRefusal && error.code === 'E_POST_MEDIUM'
      throw error
    }
  } finally {
    if (!keepCopy)
      await seams.rm(copyDirectory, { recursive: true, force: true })
  }
}

/**
 * @typedef {{ status: number | null, signal?: string | null, stdout: string, stderr: string }} CommandResult
 * @typedef {{
 *   realpath: (path: string) => Promise<string>,
 *   stat: (path: string) => Promise<import('node:fs').Stats>,
 *   lstat: (path: string, options?: { bigint: true }) => Promise<import('node:fs').Stats | import('node:fs').BigIntStats>,
 *   readdir: (path: string) => Promise<string[]>,
 *   openFile: (path: string) => Promise<import('node:fs/promises').FileHandle>,
 * }} FileSystemSeams
 * @typedef {{
 *   repositoryRoot: string,
 *   environment: NodeJS.ProcessEnv,
 *   homeDirectory: string,
 *   print: (line: string) => void,
 *   readFile: (path: string) => Promise<Uint8Array>,
 *   runCommand: (file: string, args: string[]) => Promise<CommandResult>,
 *   isExecutable: (path: string) => Promise<boolean>,
 *   fileSystem: FileSystemSeams,
 *   writeFile: (path: string, data: string | Uint8Array, options?: object) => Promise<void>,
 *   rename: (from: string, to: string) => Promise<void>,
 *   mkdir: (path: string, options?: object) => Promise<unknown>,
 *   mkdtemp: (prefix: string) => Promise<string>,
 *   rm: (path: string, options?: object) => Promise<void>,
 * }} Seams
 */

if (isRunAsScript(import.meta.url)) {
  process.exitCode = await runCommandLine((progress) =>
    postTrialEvidence(progress, process.argv.slice(2)),
  )
}
