// Moves old native evidence out of the ignored artifacts/ folder into private GitHub Releases, verified before any local copy is deleted (Issue 301).
//
//   node extension/scripts/rotate-artifacts.mjs --current <N> [--keep 3] [--apply]
//   node extension/scripts/rotate-artifacts.mjs --restore <folder>
//   node extension/scripts/rotate-artifacts.mjs --init
//
// Run `--help` for the prerequisites, an example, the exit codes and the error codes.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createGzip } from 'node:zlib'

import {
  CommandRefusal,
  EXIT,
  redactSecrets,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** The repository the evidence moves to, owned by the repository's owner account. */
export const ARCHIVE_REPOSITORY = 'ryota-murakami/codebook-artifacts'

/** The GitHub account every `gh` call acts as (never switched globally; its token travels in `GH_TOKEN`). */
export const ARCHIVE_ACCOUNT = 'ryota-murakami'

/** One release asset must stay under 2 GiB; parts stay below this. */
export const PART_BYTES = 1900 * 1024 * 1024

/** The newest QA builds kept in artifacts/qa. */
export const QA_BUILDS_KEPT = 10

/** A folder with a file modified within this time is busy (a run may still write it). */
export const BUSY_MS = 10 * 60 * 1000

/** A loose entry whose newest file is older than this is archived. */
export const LOOSE_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** The release that holds archived QA builds. */
export const QA_RELEASE_TAG = 'qa-builds'

/** `--current` may exceed the highest cycle folder found by at most this much; more is a typo. */
export const CURRENT_SLACK = 3

const DEFAULT_KEEP = 3
const TEMP_FOLDER = '.rotate-tmp'
const LOCAL_INDEX = 'ARCHIVED.json'
const SCRIPT_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/** The `--help` text: prerequisites, one example, exit codes and error codes. */
export const HELP_TEXT = `Usage: node extension/scripts/rotate-artifacts.mjs --current <N> [--keep <k>] [--apply]
       node extension/scripts/rotate-artifacts.mjs --restore <folder>
       node extension/scripts/rotate-artifacts.mjs --init

Moves old evidence from artifacts/ to private GitHub Releases of ${ARCHIVE_REPOSITORY},
one release per folder, and deletes the local copy only after every asset was downloaded
again and every file matched its SHA-256.

Options:
  --current <N>   The merged cycle's number (digits). Required for the plan and --apply. More than
                  ${CURRENT_SLACK} above the highest cycle folder found is refused as a typo.
  --keep <k>      Cycles kept besides the older ones (whole number, at least 1; default ${DEFAULT_KEEP}): cycles above N - k stay,
                  cycles at or below N - k are archived, cycles above N are listed as unknown and
                  never touched.
  --apply         Execute the plan. Without it nothing changes (the plan is printed).
  --restore <f>   Bring the archived folder <f> back into artifacts/ (refuses an existing destination).
                  A restored folder that stays unchanged is removed again by the next --apply that
                  reaches it, without a new upload.
  --init          Create the private archive repository once.
  --help          Print this text.

Rules of the plan:
  cycle folders (c59, cycle-0052, c62-n62: first number after "c" or "cycle-")
                  kept above N - k, archived at or below
  gate/<sha8>     the current HEAD's folder is kept, the others are deleted without archiving
  qa/             a build is every file named codebook-<sha>.vsix, .json or -<note>; the newest ${QA_BUILDS_KEPT} builds
                  holding a vsix are kept, the others go to release "${QA_RELEASE_TAG}"; other files are listed and kept
  packages/       kept
  other entries   archived when their newest file is older than 30 days, else kept
  skipped         a folder with a file modified within 10 minutes, with a symbolic link, a hard link or a
                  special file, with a name that cannot be a git tag (leading "." or "-", "..", trailing
                  ".lock" or ".", a character outside [A-Za-z0-9._-]), or too big for the free disk space
                  (twice its size)

Prerequisites:
  - the pinned Node (.node-version), the system tar, git
  - gh able to act as ${ARCHIVE_ACCOUNT} (gh auth token --user ${ARCHIVE_ACCOUNT}); the account is never switched
  - the private archive repository (--init creates it)

Example:
  node extension/scripts/rotate-artifacts.mjs --current 117 --apply

Output: one line per entry (action, entry, bytes), then
  ROTATE: archived=<n> deleted=<n> kept=<n> skipped=<n> failed=<n> freed_bytes=<n>
(kept counts keep and unknown entries). Without --apply the last line is
  PLAN: archive=<n> delete=<n> keep=<n> skip=<n> unknown=<n> bytes_to_free=<n>

Exit codes:
  0   done
  1   refused before any side effect
  2   failed before any side effect
  3   some entries failed and were kept; the others are done (rerun resumes)
  4   outcome unknown or in need of an audit
  64  usage error

Error codes:
  E_USAGE              bad option, two modes together, or --keep that is not a whole number of at least 1
  E_CURRENT_REQUIRED   --current missing or not a whole number
  E_CURRENT_UNLIKELY   --current is more than ${CURRENT_SLACK} above the highest cycle folder found
  E_UNSAFE_CONTAINER   artifacts/gate or artifacts/qa is a symbolic link or not a folder
  E_RUN_ACTIVE         another --apply or --restore holds artifacts/.rotate-tmp/.lock
  E_NO_ACCOUNT         gh cannot give a token for ${ARCHIVE_ACCOUNT}
  E_REPO_MISSING       the archive repository cannot be read
  E_NOT_PRIVATE        the archive repository is not private
  E_INIT_EXISTS        --init found the repository and its index.json already there
  E_INIT_INCOMPLETE    the archive repository has no index.json (run --init to write it)
  E_GIT                git could not read HEAD
  E_ABOVE_RETENTION    a folder above N - k was asked to be archived (never done)
  E_ARCHIVED_DIFFERS   the folder is already archived but the local copy differs from its archive, or the release lacks the recorded assets (nothing is uploaded or changed)
  E_ASSET_CONFLICT     a release asset of the same name has another SHA-256 (never overwritten)
  E_HASH_MISMATCH      a downloaded or extracted file differs from what was packed
  E_FOLDER_CHANGED     the local folder changed after packing or in the last moment before deletion
  E_FOLDER_BUSY        a file of the entry was modified within 10 minutes when its turn came (skipped)
  E_DISK_SPACE         twice the entry's size exceeds the free disk space (skipped)
  E_PACK / E_UPLOAD / E_DOWNLOAD / E_GITHUB   a tar (or a stream write, e.g. a full disk) or gh call failed
  E_OUTPUT_LIMIT       a command printed more than the capture limit
  E_RESTORE_UNKNOWN    the folder is not in the archive index
  E_RESTORE_EXISTS     the destination already exists
  E_RESTORE_UNSAFE     an archive member is absolute, holds "..", leaves the folder or is a link
  E_RESTORE_UNSUPPORTED  QA builds are never restored automatically
  E_INTERNAL           unexpected exception (exit 2 before a side effect, 4 after one)
`

/**
 * The cycle number a top-level entry belongs to, from the first run of digits after a leading `c` or `cycle-`.
 *
 * Why: the plan keeps recent cycles and archives older ones, so every entry must be classed by the same rule.
 * Called by {@link classifyInventory}.
 *
 * @param {string} name - A top-level name in artifacts/.
 * @returns {number | null} The number (`c59` is 59, `cycle-0052` is 52, `c62-n62` is 62), or `null` for a name that does not start that way.
 * @example parseCycleNumber('cycle-0052') // => 52
 */
export function parseCycleNumber(name) {
  const match = /^(?:cycle-|c)(\d+)/.exec(name)
  return match === null ? null : Number.parseInt(match[1], 10)
}

/**
 * Whether a top-level entry name can be a git tag (a release tag) and a safe command argument.
 *
 * Why: the entry name becomes a release tag and a path in `gh`/`tar` arguments; a leading `-` or `.`, `..`, a `.lock` or `.` ending, or a stray character breaks one of them. Loose entries such as `.DS_Store` fall here.
 * Called by {@link classifyInventory} and {@link restoreFolder}.
 *
 * @param {string} name - A top-level name in artifacts/.
 * @returns {boolean} `true` when the name is usable.
 * @example isSafeEntryName('c59') // => true
 * @example isSafeEntryName('.DS_Store') // => false
 */
export function isSafeEntryName(name) {
  return (
    /^[A-Za-z0-9._-]+$/.test(name) &&
    !name.startsWith('.') &&
    !name.startsWith('-') &&
    !name.includes('..') &&
    !name.endsWith('.lock') &&
    !name.endsWith('.')
  )
}

/**
 * The name of one part of an archive.
 * @param {string} baseName - The `<folder>.tar.gz` name.
 * @param {number} index - Zero based part index.
 * @param {number} count - How many parts the archive has; one part has no suffix.
 * @returns {string} `<folder>.tar.gz` for a single part, else `<folder>.tar.gz.part-000`, `-001`…
 * @example partName('c59.tar.gz', 1, 3) // => 'c59.tar.gz.part-001'
 */
export function partName(baseName, index, count) {
  return count === 1
    ? baseName
    : `${baseName}.part-${String(index).padStart(3, '0')}`
}

/**
 * Builds the `files.json` manifest of one archived entry.
 * @param {string} folder - The top-level entry name.
 * @param {{ path: string, size: number, sha256: string }[]} files - Every file, `path` as `artifacts/<folder>/<relative>`.
 * @returns {object} The manifest: schema, folder, files sorted by path, count and bytes.
 * @example buildFilesJson('c1', [{ path: 'artifacts/c1/a', size: 3, sha256: 'ab' }]).count // => 1
 */
export function buildFilesJson(folder, files) {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  return {
    schemaVersion: 1,
    folder,
    files: sorted,
    count: sorted.length,
    bytes: sorted.reduce((sum, file) => sum + file.size, 0),
  }
}

/**
 * Turns a scanned artifacts/ folder into the plan: one item per entry with its action.
 *
 * Why: the plan and `--apply` must act on the same decisions, and a pure function lets tests pin every rule.
 * Called by {@link runRotation}.
 *
 * @param {{ entries: object[], gate: object[], qa: object[] }} inventory - Scan results ({@link readInventory}).
 * @param {{ current: number, keep: number, headShort: string, now: number }} options - The merged cycle, cycles kept, the current HEAD's first 8 characters, the clock.
 * @returns {{ action: 'keep'|'archive'|'delete'|'skip'|'unknown', name: string, bytes: number, kind: string, reason?: string, cycle?: number, files?: string[] }[]} The plan in a stable order.
 */
export function classifyInventory(
  inventory,
  { current, keep, headShort, now },
) {
  const plan = []
  const busy = (info) => info.newestMs > now - BUSY_MS
  /** Skips an archive/delete candidate that is busy, holds a link, or has an unusable name; otherwise gives the wanted action. */
  const guard = (info, wanted, extra = {}) => {
    const base = {
      name: info.name,
      bytes: info.bytes,
      kind: wanted.kind,
      ...extra,
    }
    if (info.special.length > 0)
      return {
        ...base,
        action: 'skip',
        // Hard links count too: an archive of them cannot be restored.
        reason: `symbolic link or special file: ${info.special[0]}`,
      }
    if (busy(info))
      return {
        ...base,
        action: 'skip',
        reason: 'a file changed within 10 minutes',
      }
    if (
      wanted.action === 'archive' &&
      !isSafeEntryName(info.name.replace('qa/', ''))
    )
      return {
        ...base,
        action: 'skip',
        reason: 'name cannot be a git tag or a safe argument',
      }
    return { ...base, action: wanted.action }
  }
  for (const info of inventory.entries) {
    if (info.name === 'packages') {
      plan.push({
        action: 'keep',
        name: info.name,
        bytes: info.bytes,
        kind: 'packages',
      })
      continue
    }
    const cycle = parseCycleNumber(info.name)
    if (cycle === null) {
      // A loose entry is archived only when old enough; a young one is only listed.
      if (now - info.newestMs > LOOSE_AGE_MS)
        plan.push(guard(info, { action: 'archive', kind: 'loose' }))
      else
        plan.push({
          action: 'keep',
          name: info.name,
          bytes: info.bytes,
          kind: 'loose',
          reason: 'newer than 30 days',
        })
      continue
    }
    if (cycle > current)
      plan.push({
        action: 'unknown',
        name: info.name,
        bytes: info.bytes,
        kind: 'cycle',
        cycle,
        reason: `cycle ${cycle} is above ${current}`,
      })
    else if (cycle > current - keep)
      plan.push({
        action: 'keep',
        name: info.name,
        bytes: info.bytes,
        kind: 'cycle',
        cycle,
      })
    else plan.push(guard(info, { action: 'archive', kind: 'cycle' }, { cycle }))
  }
  // The current HEAD's gate folder stays; the others are regenerable logs.
  for (const info of inventory.gate) {
    const name = `gate/${info.name}`
    if (info.name === headShort)
      plan.push({
        action: 'keep',
        name,
        bytes: info.bytes,
        kind: 'gate',
        reason: 'current HEAD',
      })
    else plan.push(guard({ ...info, name }, { action: 'delete', kind: 'gate' }))
  }
  // A QA build is every file sharing its `codebook-<sha>` stem: the vsix/json pair and any notes named after it.
  const builds = new Map()
  for (const info of inventory.qa) {
    const match =
      /^(codebook-[0-9a-f]+)(?:\.(?:vsix|json)|-[A-Za-z0-9._-]+)$/.exec(
        info.name,
      )
    // A file of no build is listed, so nothing in qa/ goes unmentioned, and never moved.
    if (match === null) {
      plan.push({
        action: 'keep',
        name: `qa/${info.name}`,
        bytes: info.bytes,
        kind: 'qa-other',
        reason: 'not a QA build',
      })
      continue
    }
    const build = builds.get(match[1]) ?? {
      stem: match[1],
      files: [],
      bytes: 0,
      newestMs: 0,
      special: [],
      hasVsix: false,
    }
    build.files.push(info.name)
    build.bytes += info.bytes
    build.newestMs = Math.max(build.newestMs, info.newestMs)
    build.special.push(...info.special)
    build.hasVsix ||= info.name.endsWith('.vsix')
    builds.set(match[1], build)
  }
  const ordered = [...builds.values()].sort(
    (a, b) => b.newestMs - a.newestMs || (a.stem < b.stem ? -1 : 1),
  )
  // Only builds holding a vsix count toward the newest ten; notes whose build already left follow it to the release.
  let keptBuilds = 0
  for (const build of ordered) {
    const name = `qa/${build.stem}`
    if (build.hasVsix && keptBuilds < QA_BUILDS_KEPT) {
      keptBuilds += 1
      plan.push({ action: 'keep', name, bytes: build.bytes, kind: 'qa-build' })
    } else
      plan.push(
        guard(
          { ...build, name },
          { action: 'archive', kind: 'qa-build' },
          { files: build.files.sort() },
        ),
      )
  }
  return plan
}

/**
 * Walks one path without following links and sums what it holds.
 * @param {string} path - A file or folder.
 * @param {string} [prefix] - Relative path of `path` inside the entry (internal).
 * @returns {Promise<{ files: { rel: string, size: number }[], bytes: number, newestMs: number, special: string[], isDirectory: boolean }>} Regular files, byte sum, newest file modification time, and every symbolic link, hard-linked file (link count above 1) or special file met.
 */
export async function scanTree(path) {
  const top = await lstat(path)
  const result = {
    files: [],
    bytes: 0,
    newestMs: 0,
    special: [],
    isDirectory: top.isDirectory(),
  }
  const visit = async (full, rel) => {
    const stats = await lstat(full)
    if (stats.isDirectory()) {
      for (const child of (await readdir(full)).sort())
        await visit(join(full, child), rel === '' ? child : `${rel}/${child}`)
    } else if (stats.isFile() && stats.nlink === 1) {
      result.files.push({ rel, size: stats.size })
      result.bytes += stats.size
      result.newestMs = Math.max(result.newestMs, stats.mtimeMs)
    } else {
      // Symbolic links, hard-linked files, sockets and devices are never archived or deleted (a restore refuses hard links).
      result.special.push(rel === '' ? '.' : rel)
    }
  }
  await visit(path, '')
  return result
}

/**
 * Scans artifacts/ into the inventory the plan classifies.
 * Called by {@link runRotation}.
 * @param {string} artifactsDir - The artifacts/ folder.
 * @returns {Promise<{ entries: object[], gate: object[], qa: object[] }>} Top-level entries (without gate, qa, the temporary area and the local index), gate children, qa files.
 * @throws {CommandRefusal} `E_UNSAFE_CONTAINER` when gate or qa is a symbolic link or not a folder.
 */
export async function readInventory(artifactsDir) {
  const describe = async (directory, name) => {
    const tree = await scanTree(join(directory, name))
    return {
      name,
      bytes: tree.bytes,
      newestMs: tree.newestMs,
      special: tree.special,
      fileCount: tree.files.length,
    }
  }
  const inventory = { entries: [], gate: [], qa: [] }
  for (const name of (await readdir(artifactsDir)).sort()) {
    if (name === TEMP_FOLDER || name === LOCAL_INDEX) continue
    if (name === 'gate' || name === 'qa') {
      // A link in place of the container would send the listing, and later deletions, elsewhere.
      const container = await lstat(join(artifactsDir, name))
      if (container.isSymbolicLink() || !container.isDirectory())
        throw new CommandRefusal(
          'E_UNSAFE_CONTAINER',
          `artifacts/${name} is a symbolic link or not a folder`,
          {
            fix: `inspect artifacts/${name}, replace it with a real folder or remove it by hand, then rerun`,
          },
        )
      const children = (await readdir(join(artifactsDir, name))).sort()
      for (const child of children)
        inventory[name].push(await describe(join(artifactsDir, name), child))
      continue
    }
    inventory.entries.push(await describe(artifactsDir, name))
  }
  return inventory
}

/**
 * Hashes a file's bytes.
 * @param {string} path - The file.
 * @returns {Promise<string>} Lower-case SHA-256 hex.
 */
export async function sha256OfFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** The real part write: one `write` call on the open part file. */
const defaultPartWrite = (_info, handle, buffer, offset, length) =>
  handle.write(buffer, offset, length)

/**
 * Writes everything it receives into numbered part files, none over `partBytes`, hashing each part.
 *
 * Why: one release asset must stay under 2 GiB, and the archive is streamed from tar through gzip, so it is cut as it arrives instead of being stored whole first.
 * Created by {@link packEntry}; tests give it small parts.
 *
 * @example
 * ```js
 * const splitter = new PartSplitter(dir, 'c1.tar.gz', 1000)
 * source.pipe(splitter); await finished(splitter)
 * splitter.parts // => [{ name: 'c1.tar.gz.part-000', size: 1000, sha256: '…' }, …]
 * ```
 */
export class PartSplitter extends Writable {
  /**
   * @param {string} directory - Where the parts are written.
   * @param {string} baseName - The `<folder>.tar.gz` name.
   * @param {number} partBytes - The largest part.
   * @param {(info: { baseName: string, partIndex: number }, handle: import('node:fs/promises').FileHandle, buffer: Buffer, offset: number, length: number) => Promise<{ bytesWritten: number }>} [write] - The part write; tests replace it to make a write fail (for example ENOSPC).
   */
  constructor(directory, baseName, partBytes, write = defaultPartWrite) {
    super()
    this.directory = directory
    this.baseName = baseName
    this.partBytes = partBytes
    this.partWrite = write
    this.parts = []
    this.handle = null
    this.hash = null
  }

  _write(chunk, _encoding, callback) {
    this.#append(chunk).then(() => callback(), callback)
  }

  // Closes the open part when the stream fails or is destroyed, so no file handle outlives a failed entry.
  _destroy(error, callback) {
    const handle = this.handle
    this.handle = null
    if (handle === null) return callback(error)
    handle.close().then(
      () => callback(error),
      () => callback(error),
    )
  }

  _final(callback) {
    this.#closePart()
      .then(async () => {
        // A single part carries no suffix.
        if (this.parts.length === 1) {
          const only = this.parts[0]
          await rename(
            join(this.directory, only.name),
            join(this.directory, this.baseName),
          )
          only.name = this.baseName
        }
      })
      .then(() => callback(), callback)
  }

  async #closePart() {
    if (this.handle === null) return
    await this.handle.close()
    this.parts.at(-1).sha256 = this.hash.digest('hex')
    this.handle = null
  }

  async #append(chunk) {
    let offset = 0
    while (offset < chunk.length) {
      // A new part opens only when a byte arrives, so an exact multiple leaves no empty part.
      if (this.handle !== null && this.parts.at(-1).size === this.partBytes)
        await this.#closePart()
      if (this.handle === null) {
        const name = `${this.baseName}.part-${String(this.parts.length).padStart(3, '0')}`
        this.handle = await open(join(this.directory, name), 'w')
        this.hash = createHash('sha256')
        this.parts.push({ name, size: 0, sha256: '' })
      }
      const part = this.parts.at(-1)
      const slice = chunk.subarray(offset, offset + this.partBytes - part.size)
      let written = 0
      while (written < slice.length) {
        const { bytesWritten } = await this.partWrite(
          { baseName: this.baseName, partIndex: this.parts.length - 1 },
          this.handle,
          slice,
          written,
          slice.length - written,
        )
        written += bytesWritten
      }
      this.hash.update(slice)
      part.size += slice.length
      offset += slice.length
    }
  }
}

/**
 * Checks tar member names before anything is extracted.
 *
 * Why: a restore extracts an archive from the network side of the system; a name that is absolute or climbs out must stop it.
 * Called by {@link restoreFolder}.
 *
 * @param {string[]} names - Member names as tar lists them.
 * @param {string} entryName - The folder (or file) the archive must stay inside.
 * @returns {string | null} The first offending name, or `null`.
 * @example checkMemberPaths(['c1/a', 'c1/../x'], 'c1') // => 'c1/../x'
 */
export function checkMemberPaths(names, entryName) {
  for (const raw of names) {
    const name = raw.replace(/^(\.\/)+/, '')
    const unsafe =
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split(/[\\/]/).includes('..') ||
      !(name === entryName || name.startsWith(`${entryName}/`))
    if (unsafe) return raw
  }
  return null
}

/**
 * A command runner: the one seam every `gh`, `git` and `tar` call goes through, so tests replace it.
 *
 * Why: nothing here may reach GitHub in tests; the real tool uses this spawn-based runner.
 * Called by {@link main} when no runner is injected.
 *
 * @param {string} cwd - Directory the commands run in.
 * @param {NodeJS.ProcessEnv} environment - The caller's environment.
 * @param {{ limit?: number }} [settings] - `limit`: captured bytes per stream (tests make it small).
 * @returns {(command: string, args: string[], options?: { env?: object, stdin?: Readable, stdout?: Writable, signal?: AbortSignal }) => Promise<{ status: number, stdout: string, stderr: string }>} A runner; `options.env` adds variables, `options.stdin` feeds the child, `options.stdout` receives its output instead of a string, `options.signal` ends the child when aborted. A missing program is status 127. A captured stdout that reaches the limit rejects with `E_OUTPUT_LIMIT`.
 */
export function createCommandRunner(
  cwd,
  environment,
  { limit = 64 * 1024 * 1024 } = {},
) {
  return (command, args, options = {}) =>
    new Promise((resolveResult, rejectResult) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...environment, ...options.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        signal: options.signal,
      })
      // Chunks stay Buffers and are decoded once, so a multi-byte character split between two chunks survives.
      const stdoutChunks = []
      const stderrChunks = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let overflow = false
      const text = (chunks) => Buffer.concat(chunks).toString('utf8')
      const finish = (status, stderr) => {
        if (overflow) {
          // A cut answer is never handed on as if it were whole.
          rejectResult(
            new CommandRefusal(
              'E_OUTPUT_LIMIT',
              `${command} ${args[0] ?? ''} printed ${limit} bytes or more, more than this tool captures`,
              {
                fix: 'run that command by hand and check its output size',
                exitCode: EXIT.FAILED,
              },
            ),
          )
          return
        }
        resolveResult({ status, stdout: text(stdoutChunks), stderr })
      }
      child.stderr.on('data', (chunk) => {
        if (stderrBytes < limit) {
          stderrChunks.push(chunk)
          stderrBytes += chunk.length
        }
      })
      if (options.stdout) child.stdout.pipe(options.stdout)
      else
        child.stdout.on('data', (chunk) => {
          if (overflow) return
          stdoutBytes += chunk.length
          if (stdoutBytes >= limit) {
            overflow = true
            child.kill()
          } else stdoutChunks.push(chunk)
        })
      if (options.stdin) {
        // A child that exits early closes the pipe; that is its exit status to report, not our crash.
        child.stdin.on('error', () => {})
        options.stdin.on('error', () => child.kill())
        options.stdin.pipe(child.stdin)
      }
      child.on('error', (error) => {
        options.stdout?.end()
        finish(127, error.message)
      })
      child.on('close', (code) => finish(code ?? 127, text(stderrChunks)))
    })
}

/**
 * Runs a command and refuses the entry when it fails.
 * @param {Function} call - A runner call already bound to its arguments.
 * @param {string} code - The `E_…` code to raise.
 * @param {string} what - What the call did, for the message.
 * @param {NodeJS.ProcessEnv} environment - Secrets to hide.
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} The result of a call with status 0.
 * @throws {CommandRefusal} With the first line of stderr.
 */
async function expectSuccess(call, code, what, environment) {
  const result = await call()
  if (result.status === 0) return result
  const line = redactSecrets(
    result.stderr.trim().split('\n')[0] || `exit ${result.status}`,
    environment,
  )
  throw new CommandRefusal(code, `${what} failed: ${line}`, {
    fix: 'check the message above, then rerun (a rerun resumes)',
    exitCode: EXIT.FOLLOW_UP,
  })
}

/**
 * Cuts the artifacts of one entry into tar+gzip parts under the temporary area.
 *
 * Why: step 1 of the rotation order (pack and hash). gzip runs inside Node so its header is the same on every run, which lets a resumed run find its already uploaded assets with the same SHA-256.
 * Called by {@link rotateArchive}.
 *
 * @param {object} context - Rotation context ({@link runRotation}).
 * @param {string} name - Top-level entry.
 * @param {string} workDir - Empty folder for the parts.
 * @returns {Promise<{ name: string, size: number, sha256: string }[]>} The parts.
 * @throws {CommandRefusal} `E_PACK` when tar fails or a stream write fails (for example ENOSPC); every part handle is closed first.
 */
async function packEntry(context, name, workDir) {
  const baseName = `${name}.tar.gz`
  const splitter = new PartSplitter(
    workDir,
    baseName,
    context.partBytes,
    context.partWrite,
  )
  const gzip = createGzip()
  const abort = new AbortController()
  let streamError = null
  let signalStreamError = () => {}
  const streamFailed = new Promise((resolveFailure) => {
    signalStreamError = resolveFailure
  })
  // Attached before tar starts: a failing part write (a full disk) must end tar, not hang it on a stalled pipe or crash on an unhandled error event.
  const onStreamError = (error) => {
    streamError ??= error
    abort.abort()
    signalStreamError()
  }
  gzip.on('error', onStreamError)
  splitter.on('error', onStreamError)
  gzip.pipe(splitter)
  /** Closes every part handle and fails the entry. */
  const fail = async (reason) => {
    gzip.destroy()
    splitter.destroy()
    if (!splitter.closed)
      await new Promise((resolveClosed) =>
        splitter.once('close', resolveClosed),
      )
    throw new CommandRefusal('E_PACK', `packing ${name} failed: ${reason}`, {
      fix: 'fix the cause above (for example free disk space), then rerun',
      exitCode: EXIT.FOLLOW_UP,
    })
  }
  const tarRun = context.run(
    'tar',
    ['-cf', '-', '-C', context.artifactsDir, name],
    { stdout: gzip, signal: abort.signal },
  )
  // Whichever comes first: tar's exit or a stream error.
  const first = await Promise.race([tarRun, streamFailed])
  if (streamError !== null) {
    await tarRun.catch(() => {})
    return fail(streamError.message)
  }
  if (first.status !== 0)
    return fail(`tar: ${first.stderr.trim().split('\n')[0]}`)
  try {
    await finished(splitter)
  } catch (error) {
    return fail(error.message)
  }
  return splitter.parts
}

/**
 * Hashes every regular file of a tree and names the links it met.
 * @param {string} root - Folder holding the entry.
 * @param {string} name - Entry name (a folder or one file).
 * @returns {Promise<{ files: { path: string, size: number, sha256: string }[], special: string[] }>} `path` as `artifacts/<name>/<relative>`; `special`: symbolic links, hard-linked files and special files, as `<name>/<relative>`.
 */
async function hashTree(root, name) {
  const tree = await scanTree(join(root, name))
  const files = []
  for (const file of tree.files) {
    const relative = file.rel === '' ? name : `${name}/${file.rel}`
    files.push({
      path: `artifacts/${relative}`,
      size: file.size,
      sha256: await sha256OfFile(join(root, relative)),
    })
  }
  return {
    files,
    special: tree.special.map((rel) => (rel === '.' ? name : `${name}/${rel}`)),
  }
}

/**
 * Hashes every file of an entry for `files.json`, refusing the entry when a link appeared after the plan.
 * Called by {@link rotateArchive} when packing.
 * @param {string} root - Folder holding the entry.
 * @param {string} name - Entry name (a folder or one file).
 * @returns {Promise<{ path: string, size: number, sha256: string }[]>} `path` as `artifacts/<name>/<relative>`.
 * @throws {CommandRefusal} `E_FOLDER_CHANGED` for a symbolic link, hard link or special file.
 */
async function hashEntryFiles(root, name) {
  const { files, special } = await hashTree(root, name)
  if (special.length > 0)
    throw new CommandRefusal(
      'E_FOLDER_CHANGED',
      `${name} holds a symbolic link, hard link or special file the plan did not see: ${special[0]}`,
      {
        fix: 'remove or move the link, then rerun',
        exitCode: EXIT.FOLLOW_UP,
      },
    )
  return files
}

/**
 * Compares a folder on disk with a manifest.
 *
 * Why: it is the check behind steps 3 and 4 and the last check before deletion; a file that is missing, differs, is extra, or is a link must stop the entry.
 * Called by {@link rotateArchive}, {@link removeAfterFinalCheck} and {@link restoreFolder}.
 *
 * @param {string} root - Folder holding the entry.
 * @param {string} name - Entry name.
 * @param {{ path: string, size: number, sha256: string }[]} manifestFiles - The expected files.
 * @returns {Promise<string[]>} Problems found (missing, extra, wrong size or hash, link); empty when identical.
 */
export async function compareWithManifest(root, name, manifestFiles) {
  const tree = await hashTree(root, name)
  const actual = new Map(tree.files.map((file) => [file.path, file]))
  const problems = tree.special.map((path) => `link ${path}`)
  for (const expected of manifestFiles) {
    const found = actual.get(expected.path)
    if (found === undefined) problems.push(`missing ${expected.path}`)
    else if (found.size !== expected.size || found.sha256 !== expected.sha256)
      problems.push(`differs ${expected.path}`)
    actual.delete(expected.path)
  }
  for (const path of actual.keys()) problems.push(`extra ${path}`)
  return problems
}

/**
 * Orders archive part files by their `.part-NNN` number (a single `<folder>.tar.gz` has none).
 *
 * Why: tar needs the parts in order; the stored asset order of an index is no promise.
 * Called by {@link restoreFolder} and {@link rotateArchive}.
 *
 * @param {string[]} names - Asset names of one archive.
 * @returns {string[]} The names sorted by part number.
 * @example sortParts(['c1.tar.gz.part-001', 'c1.tar.gz.part-000']) // => ['c1.tar.gz.part-000', 'c1.tar.gz.part-001']
 */
export function sortParts(names) {
  const number = (name) => {
    const match = /\.part-(\d+)$/.exec(name)
    return match === null ? -1 : Number.parseInt(match[1], 10)
  }
  return [...names].sort((a, b) => number(a) - number(b))
}

/**
 * Streams the parts, in order, as one readable.
 * @param {string[]} paths - Part files.
 * @returns {Readable} Their bytes joined.
 */
function joinParts(paths) {
  return Readable.from(
    (async function* () {
      for (const path of paths)
        for await (const chunk of createReadStream(path)) yield chunk
    })(),
  )
}

/** A bound set of `gh` calls acting as the archive account. */
function createGithub(context) {
  const { run, token, repository, environment } = context
  const env = { ...environment, GH_TOKEN: token }
  const call = (args, options = {}) =>
    run('gh', args, { ...options, env: { GH_TOKEN: token } })
  const ok = (args, code, what, options) =>
    expectSuccess(() => call(args, options), code, what, env)
  const notFound = (result) => /404|not found/i.test(result.stderr)
  const firstLine = (result) =>
    redactSecrets(result.stderr.trim().split('\n')[0], env)
  const indexPath = `repos/${repository}/contents/index.json`
  return {
    call,
    ok,
    /** Reads the release by tag; `null` when it does not exist. */
    async release(tag) {
      const result = await call([
        'api',
        `repos/${repository}/releases/tags/${tag}`,
      ])
      if (result.status === 0) return JSON.parse(result.stdout)
      if (notFound(result)) return null
      throw new CommandRefusal(
        'E_GITHUB',
        `reading release ${tag} failed: ${firstLine(result)}`,
        { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
      )
    },
    /** Whether index.json exists in the archive repository (`--init` decides on it). */
    async indexExists() {
      const result = await call(['api', indexPath])
      if (result.status === 0) return true
      if (notFound(result)) return false
      throw new CommandRefusal(
        'E_GITHUB',
        `reading index.json failed: ${firstLine(result)}`,
        { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
      )
    },
    /** Reads index.json; a missing one means the repository was never fully initialised. */
    async readIndex() {
      const result = await call(['api', indexPath])
      if (result.status === 0) {
        const body = JSON.parse(result.stdout)
        let text
        if (body.encoding === 'base64' && body.content !== '')
          text = Buffer.from(body.content, 'base64').toString('utf8')
        else {
          // Files over 1 MB come back with an empty `content` and `encoding: "none"`; the raw media type returns the body itself (up to 100 MB).
          const raw = await call([
            'api',
            '-H',
            'Accept: application/vnd.github.raw+json',
            indexPath,
          ])
          if (raw.status !== 0)
            throw new CommandRefusal(
              'E_GITHUB',
              `reading index.json (raw) failed: ${firstLine(raw)}`,
              { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
            )
          text = raw.stdout
        }
        return { sha: body.sha, index: JSON.parse(text) }
      }
      if (notFound(result))
        throw new CommandRefusal(
          'E_INIT_INCOMPLETE',
          `${repository} has no index.json`,
          { fix: 'node extension/scripts/rotate-artifacts.mjs --init' },
        )
      throw new CommandRefusal(
        'E_GITHUB',
        `reading index.json failed: ${firstLine(result)}`,
        { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
      )
    },
    /**
     * Writes index.json through a request body file, never the command line (Linux limits one argument to 128 KiB).
     * The file lives in the run's temporary folder; `--init` has no run folder and uses a throwaway one.
     */
    async writeIndex(index, sha, message) {
      const ownsDirectory = context.locked !== true
      let directory = context.workRoot
      if (ownsDirectory)
        directory = await mkdtemp(join(tmpdir(), 'rotate-index-'))
      else await mkdir(directory, { recursive: true })
      try {
        const body = {
          message,
          content: Buffer.from(`${JSON.stringify(index, null, 2)}\n`).toString(
            'base64',
          ),
        }
        if (sha !== null) body.sha = sha
        const file = join(directory, 'index-put.json')
        await writeFile(file, JSON.stringify(body))
        await ok(
          ['api', '-X', 'PUT', indexPath, '--input', file],
          'E_GITHUB',
          'writing index.json',
        )
      } finally {
        if (ownsDirectory) await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

/**
 * Uploads assets to a release, reusing those already there with the same SHA-256.
 *
 * Why: a stopped upload must resume, but an asset of the same name with other bytes must never be overwritten.
 * Called by {@link rotateArchive} and {@link rotateQaBuild}.
 *
 * @param {ReturnType<typeof createGithub>} github - Bound `gh` calls.
 * @param {object} context - Rotation context.
 * @param {string} tag - Release tag.
 * @param {string} notes - Notes for a release created now.
 * @param {{ name: string, path: string, sha256: string }[]} assets - What to upload.
 * @throws {CommandRefusal} `E_ASSET_CONFLICT` for a same-name asset with another hash.
 */
async function uploadAssets(github, context, tag, notes, assets) {
  let release = await github.release(tag)
  if (release === null) {
    await github.ok(
      [
        'release',
        'create',
        tag,
        '--repo',
        context.repository,
        '--title',
        tag,
        '--notes',
        notes,
      ],
      'E_UPLOAD',
      `creating release ${tag}`,
    )
    release = await github.release(tag)
  }
  for (const asset of assets) {
    const existing = (release?.assets ?? []).find(
      (item) => item.name === asset.name,
    )
    if (existing !== undefined && existing.state === 'uploaded') {
      // GitHub's REST release asset has a `digest` ("sha256:…"); an old asset may lack it, then it is downloaded and hashed.
      let remote =
        typeof existing.digest === 'string'
          ? existing.digest.replace(/^sha256:/, '')
          : null
      if (remote === null) {
        const directory = join(context.workRoot, 'resume-check')
        await rm(directory, { recursive: true, force: true })
        await mkdir(directory, { recursive: true })
        await github.ok(
          [
            'release',
            'download',
            tag,
            '--repo',
            context.repository,
            '--pattern',
            asset.name,
            '--dir',
            directory,
            '--clobber',
          ],
          'E_DOWNLOAD',
          `downloading ${asset.name}`,
        )
        remote = await sha256OfFile(join(directory, asset.name))
      }
      if (remote === asset.sha256) continue
      throw new CommandRefusal(
        'E_ASSET_CONFLICT',
        `release ${tag} already holds ${asset.name} with another SHA-256`,
        {
          fix: `if the old asset is wrong, delete it in ${context.repository} by hand, then rerun`,
          exitCode: EXIT.FOLLOW_UP,
        },
      )
    }
    // A stopped upload leaves a partial asset; it is no complete copy, so it makes way.
    if (existing !== undefined)
      await github.ok(
        [
          'api',
          '-X',
          'DELETE',
          `repos/${context.repository}/releases/assets/${existing.id}`,
        ],
        'E_UPLOAD',
        `removing partial ${asset.name}`,
      )
    await github.ok(
      ['release', 'upload', tag, asset.path, '--repo', context.repository],
      'E_UPLOAD',
      `uploading ${asset.name}`,
    )
  }
}

/**
 * Downloads every asset of a release again and checks its SHA-256.
 * Called by {@link rotateArchive}, {@link rotateQaBuild} and {@link restoreFolder}.
 * @param {ReturnType<typeof createGithub>} github - Bound `gh` calls.
 * @param {object} context - Rotation context.
 * @param {string} tag - Release tag.
 * @param {{ name: string, sha256: string }[]} assets - Names and expected hashes.
 * @param {string} directory - Empty folder for the downloads.
 * @throws {CommandRefusal} `E_HASH_MISMATCH` for a differing asset.
 */
async function downloadAndVerify(github, context, tag, assets, directory) {
  await mkdir(directory, { recursive: true })
  for (const asset of assets) {
    await github.ok(
      [
        'release',
        'download',
        tag,
        '--repo',
        context.repository,
        '--pattern',
        asset.name,
        '--dir',
        directory,
        '--clobber',
      ],
      'E_DOWNLOAD',
      `downloading ${asset.name}`,
    )
    const actual = await sha256OfFile(join(directory, asset.name))
    if (actual !== asset.sha256)
      throw new CommandRefusal(
        'E_HASH_MISMATCH',
        `${asset.name} downloaded with SHA-256 ${actual}, expected ${asset.sha256}`,
        {
          fix: 'the local copy is kept; rerun, and delete the asset in the archive if it stays wrong',
          exitCode: EXIT.FOLLOW_UP,
        },
      )
  }
}

/** Merges one folder's record into index.json and the local ARCHIVED.json. */
async function recordArchived(github, context, key, record) {
  const { sha, index } = await github.readIndex()
  index.folders[key] = record
  await github.writeIndex(index, sha, `Archive ${key}`)
  await recordLocal(context, key, record)
}

/**
 * Writes one folder's tag into the local ARCHIVED.json (atomically).
 * Called by {@link recordArchived} and by {@link rotateAlreadyArchived}, which leaves index.json alone but keeps the local pointer.
 * @param {object} context - Rotation context.
 * @param {string} key - Archived entry.
 * @param {{ tag: string, archivedAt: string }} record - The index record.
 */
async function recordLocal(context, key, record) {
  const localPath = join(context.artifactsDir, LOCAL_INDEX)
  let local = { schemaVersion: 1, folders: {} }
  try {
    local = JSON.parse(await readFile(localPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  local.folders[key] = {
    tag: record.tag,
    repository: context.repository,
    archivedAt: record.archivedAt,
  }
  await writeFile(`${localPath}.tmp`, `${JSON.stringify(local, null, 2)}\n`)
  await rename(`${localPath}.tmp`, localPath)
}

/** The error {@link moveWithoutReplacing} throws when something already sits at the destination. */
class DestinationExists extends Error {
  code = 'EEXIST'
}

/**
 * Moves a file or folder to a destination that must not exist, failing atomically when it does.
 *
 * Why: a plain `rename` replaces a file or an empty folder silently; a restore or a put-back must never overwrite what another process created meanwhile.
 * Called by {@link restoreFolder} (the final move) and by {@link removeAfterFinalCheck} / {@link removeQaBuildAfterFinalCheck} (putting a changed entry back).
 *
 * @param {string} source - Existing file or folder (same volume as the destination).
 * @param {string} destination - Path that must not exist.
 * @returns {Promise<void>} Resolves once `source` lives at `destination`.
 * @throws {DestinationExists} `code` `EEXIST`; whatever sits at the destination is left unchanged.
 */
async function moveWithoutReplacing(source, destination) {
  if ((await lstat(source)).isDirectory()) {
    // mkdir without `recursive` fails on EEXIST; the rename then replaces only the empty folder just made.
    try {
      await mkdir(destination)
    } catch (error) {
      if (error.code === 'EEXIST') throw new DestinationExists(destination)
      throw error
    }
    try {
      await rename(source, destination)
    } catch (error) {
      // Filled by someone else meanwhile: theirs stays untouched.
      if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST')
        throw new DestinationExists(destination)
      await rmdir(destination).catch(() => {})
      throw error
    }
    return
  }
  // link fails on EEXIST, then the second name goes.
  try {
    await link(source, destination)
  } catch (error) {
    if (error.code === 'EEXIST') throw new DestinationExists(destination)
    throw error
  }
  await unlink(source)
}

/**
 * Records size, modification time, change time and inode of every non-directory under a path, without following links.
 *
 * Why: the final hash pass reads files one after another, so a writer that kept a file open from before the rename can append to a file already hashed; a size, mtime, ctime or inode change between two stat passes exposes it.
 * Called by {@link removeAfterFinalCheck} and {@link removeQaBuildAfterFinalCheck}.
 *
 * @param {string} path - A file or folder (the renamed copy).
 * @param {string} [rel] - Relative path of `path` inside the entry (internal).
 * @param {Map<string, string>} [found] - Accumulator (internal).
 * @returns {Promise<Map<string, string>>} Relative path to a `size:mtimeMs:ctimeMs:ino` fingerprint (`.` for a lone file).
 */
async function statFingerprints(path, rel = '.', found = new Map()) {
  const stats = await lstat(path)
  if (stats.isDirectory()) {
    for (const child of (await readdir(path)).sort())
      await statFingerprints(
        join(path, child),
        rel === '.' ? child : `${rel}/${child}`,
        found,
      )
  } else {
    found.set(
      rel,
      `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`,
    )
  }
  return found
}

/**
 * Names the first file whose fingerprint differs between two {@link statFingerprints} passes, or that appeared or vanished.
 * @param {Map<string, string>} before - The first pass.
 * @param {Map<string, string>} after - The second pass.
 * @returns {string | null} A sentence naming the file, or `null` when both passes agree.
 */
function firstFingerprintDifference(before, after) {
  for (const [rel, fingerprint] of before)
    if (after.get(rel) !== fingerprint)
      return `${rel} changed while it was being checked (size, mtime, ctime or inode differs)`
  for (const rel of after.keys())
    if (!before.has(rel)) return `${rel} appeared while it was being checked`
  return null
}

/**
 * The last check before a local entry is deleted: rename it aside, stat and rescan the renamed copy against `files.json`, stat it again, and only then remove it.
 *
 * Why: a run may write into the folder between step 4 and the deletion; renaming first makes the final scan see exactly what `rm` would delete (same volume, atomic). A writer holding a file open from before the rename can still append to a file already hashed, so a second stat pass right before `rm` must match the first. Any thrown error (EACCES, ENOENT, EIO) takes the put-back path like a mismatch.
 * Called by {@link rotateArchive} after the record was written.
 *
 * @param {object} context - Rotation context.
 * @param {string} name - Top-level entry.
 * @param {{ path: string, size: number, sha256: string }[]} manifestFiles - The verified `files.json` files.
 * @returns {Promise<void>} Resolves once the renamed copy is removed.
 * @throws {CommandRefusal} `E_FOLDER_CHANGED` on any difference (content, extras, links, stat change) or a failed check; the entry is put back, or, when its path was recreated meanwhile, stays in the run's temporary folder and the error names it.
 */
async function removeAfterFinalCheck(context, name, manifestFiles) {
  const original = join(context.artifactsDir, name)
  const holder = join(context.asideRoot, name)
  const aside = join(holder, name)
  await mkdir(holder, { recursive: true })
  await rename(original, aside)
  let problem = null
  try {
    await context.afterAside?.(name)
    const before = await statFingerprints(aside)
    const problems = await compareWithManifest(holder, name, manifestFiles)
    if (problems.length > 0) problem = problems[0]
    else {
      await context.afterFinalHash?.(name)
      // Nothing but this stat pass and the rm below may run between the comparison and the deletion.
      problem = firstFingerprintDifference(
        before,
        await statFingerprints(aside),
      )
    }
  } catch (error) {
    // A failed check proves nothing about the copy: it goes back like a changed one.
    problem = `the final check failed: ${error.message}`
  }
  if (problem === null) {
    await rm(holder, { recursive: true, force: true })
    return
  }
  try {
    await moveWithoutReplacing(aside, original)
  } catch (error) {
    const stuck = new CommandRefusal(
      'E_FOLDER_CHANGED',
      `${name} changed just before deletion (${problem}) and could not be put back (${error.message}); the renamed copy stays at ${aside}; to recover, move it back to artifacts/${name} by hand`,
      {
        fix: `compare ${aside} with ${original} by hand, then move ${aside} back to artifacts/${name}; nothing was deleted`,
        exitCode: EXIT.FOLLOW_UP,
      },
    )
    // The FAILED line must not claim the entry is where it was.
    stuck.kept = false
    throw stuck
  }
  await rmdir(holder).catch(() => {})
  throw new CommandRefusal(
    'E_FOLDER_CHANGED',
    `${name} changed just before deletion: ${problem}; it was put back`,
    {
      fix: 'wait until the folder is stable, then rerun',
      exitCode: EXIT.FOLLOW_UP,
    },
  )
}

/**
 * Removes a local entry whose archive already exists, after proving the local copy equals it.
 *
 * Why: tar and gzip output differs between packings of identical files, so a restored folder packed again meets its own release with another hash (`E_ASSET_CONFLICT` on every run). The existing record stays valid, so nothing is packed or uploaded.
 * Called by {@link rotateArchive} when index.json already holds a record for the entry.
 *
 * @param {object} context - Rotation context.
 * @param {ReturnType<typeof createGithub>} github - Bound `gh` calls.
 * @param {string} name - Top-level entry.
 * @param {{ tag: string, archivedAt: string, assets: { name: string, size: number, sha256: string }[] }} record - The index record.
 * @param {string} workDir - The entry's temporary folder.
 * @returns {Promise<void>} Resolves once the local copy is removed.
 * @throws {CommandRefusal} `E_ARCHIVED_DIFFERS` when the release lacks the recorded assets or the local copy differs from the archive; `E_HASH_MISMATCH` for a corrupt download or extraction; `E_FOLDER_CHANGED` from the last check. Nothing is uploaded or recorded and the local copy stays.
 */
async function rotateAlreadyArchived(context, github, name, record, workDir) {
  const filesJsonName = `${name}.files.json`
  const differs = (reason) =>
    new CommandRefusal(
      'E_ARCHIVED_DIFFERS',
      `${name} is already archived in release ${record.tag}, but ${reason}`,
      {
        fix: `the local ${name} differs from its archive or the archive is incomplete: rename the local folder, or remove release ${record.tag} and its index.json record in ${context.repository} by hand, then rerun`,
        exitCode: EXIT.FOLLOW_UP,
      },
    )
  const release = await github.release(record.tag)
  if (release === null) throw differs('the release does not exist')
  if (!record.assets.some((asset) => asset.name === filesJsonName))
    throw differs(`its record lists no ${filesJsonName}`)
  for (const asset of record.assets) {
    const held = release.assets.find((item) => item.name === asset.name)
    if (held === undefined || held.state !== 'uploaded')
      throw differs(`the release lacks ${asset.name}`)
  }
  // Every recorded asset is downloaded again and checked against the record.
  const downloadDir = join(workDir, 'download')
  const extractDir = join(workDir, 'extract')
  await downloadAndVerify(
    github,
    context,
    record.tag,
    record.assets,
    downloadDir,
  )
  const manifest = JSON.parse(
    await readFile(join(downloadDir, filesJsonName), 'utf8'),
  )
  // The local copy must equal the archive: a changed, extra or missing file means it is not the archived one.
  const localProblems = await compareWithManifest(
    context.artifactsDir,
    name,
    manifest.files,
  )
  if (localProblems.length > 0)
    throw differs(`the local copy differs: ${localProblems[0]}`)
  // The archived parts themselves must extract to files.json.
  await mkdir(extractDir, { recursive: true })
  const partNames = record.assets
    .map((asset) => asset.name)
    .filter((assetName) => assetName.startsWith(`${name}.tar.gz`))
  await expectSuccess(
    () =>
      context.run('tar', ['-xzf', '-', '--no-same-owner', '-C', extractDir], {
        stdin: joinParts(
          sortParts(partNames).map((partName) => join(downloadDir, partName)),
        ),
      }),
    'E_HASH_MISMATCH',
    `extracting the downloaded ${name}`,
    context.environment,
  )
  const extractProblems = await compareWithManifest(
    extractDir,
    name,
    manifest.files,
  )
  if (manifest.count !== manifest.files.length || extractProblems.length > 0)
    throw new CommandRefusal(
      'E_HASH_MISMATCH',
      `the extracted ${name} differs from files.json: ${extractProblems[0] ?? 'file count'}`,
      { fix: 'the local copy is kept; rerun', exitCode: EXIT.FOLLOW_UP },
    )
  // No new record: the existing one stays valid; the local pointer is kept.
  await recordLocal(context, name, record)
  await context.afterRecord?.(name)
  await removeAfterFinalCheck(context, name, manifest.files)
  context.print(
    `archived ${name} (already in the archive; local copy verified and removed)`,
  )
}

/**
 * Archives one cycle folder or loose entry: pack, upload, verify, record, delete.
 *
 * Why: this is the six-step order of Issue 301; the local copy goes only after steps 3 to 5 passed and a last check of the renamed copy.
 * Called by {@link runRotation} for an `archive` plan item.
 *
 * @param {object} context - Rotation context.
 * @param {{ name: string, cycle?: number, bytes: number }} item - The plan item.
 * @returns {Promise<void>} Resolves once the local copy is deleted.
 * @throws {CommandRefusal} The first failing step's code; the local copy then stays.
 */
async function rotateArchive(context, item) {
  const { name } = item
  // Defence in depth: the plan never selects these, but the rule is the safety of the tool.
  if (item.cycle !== undefined && item.cycle > context.current - context.keep)
    throw new CommandRefusal(
      'E_ABOVE_RETENTION',
      `${name} (cycle ${item.cycle}) is above ${context.current - context.keep}`,
      { fix: 'raise nothing; this folder stays', exitCode: EXIT.REFUSED },
    )
  const workDir = join(context.workRoot, name)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const github = createGithub(context)
  // A restored folder that is unchanged is already archived: packing it again would give another tar.gz hash.
  const { index: archiveIndex } = await github.readIndex()
  const archivedRecord = archiveIndex.folders[name]
  if (archivedRecord !== undefined)
    return rotateAlreadyArchived(context, github, name, archivedRecord, workDir)
  // 1. pack and hash
  const files = await hashEntryFiles(context.artifactsDir, name)
  const filesJson = buildFilesJson(name, files)
  const parts = await packEntry(context, name, workDir)
  const filesJsonName = `${name}.files.json`
  const filesJsonPath = join(workDir, filesJsonName)
  await writeFile(filesJsonPath, `${JSON.stringify(filesJson, null, 2)}\n`)
  const assets = [
    ...parts.map((part) => ({ ...part, path: join(workDir, part.name) })),
    {
      name: filesJsonName,
      path: filesJsonPath,
      size: (await lstat(filesJsonPath)).size,
      sha256: await sha256OfFile(filesJsonPath),
    },
  ]
  const notes = [
    `Folder: ${name}`,
    `Files: ${filesJson.count}`,
    `Bytes: ${filesJson.bytes}`,
    `Source commit: ${context.sourceCommit}`,
    '',
    'SHA-256:',
    ...assets.map((asset) => `- ${asset.name} ${asset.sha256}`),
  ].join('\n')
  // 2. upload (resumes: same-hash assets are reused)
  await uploadAssets(github, context, name, notes, assets)
  // The packed copies are no longer needed; the downloads below are what gets checked.
  for (const asset of assets) await rm(asset.path, { force: true })
  // 3. download again, compare asset hashes, join, extract, compare every file
  const downloadDir = join(workDir, 'download')
  const extractDir = join(workDir, 'extract')
  await downloadAndVerify(github, context, name, assets, downloadDir)
  await mkdir(extractDir, { recursive: true })
  await expectSuccess(
    () =>
      context.run('tar', ['-xzf', '-', '--no-same-owner', '-C', extractDir], {
        stdin: joinParts(
          sortParts(parts.map((part) => part.name)).map((partName) =>
            join(downloadDir, partName),
          ),
        ),
      }),
    'E_HASH_MISMATCH',
    `extracting the downloaded ${name}`,
    context.environment,
  )
  const remoteManifest = JSON.parse(
    await readFile(join(downloadDir, filesJsonName), 'utf8'),
  )
  const extractProblems = await compareWithManifest(
    extractDir,
    name,
    remoteManifest.files,
  )
  if (remoteManifest.count !== filesJson.count || extractProblems.length > 0)
    throw new CommandRefusal(
      'E_HASH_MISMATCH',
      `the extracted ${name} differs from files.json: ${extractProblems[0] ?? 'file count'}`,
      { fix: 'the local copy is kept; rerun', exitCode: EXIT.FOLLOW_UP },
    )
  // 4. a file changed after packing (or a link, or an extra file) stops the deletion
  const localProblems = await compareWithManifest(
    context.artifactsDir,
    name,
    remoteManifest.files,
  )
  if (localProblems.length > 0)
    throw new CommandRefusal(
      'E_FOLDER_CHANGED',
      `${name} changed after packing: ${localProblems[0]}`,
      {
        fix: 'wait until the folder is stable, then rerun',
        exitCode: EXIT.FOLLOW_UP,
      },
    )
  // 5. index.json (and the local ARCHIVED.json): the record comes before the deletion
  await recordArchived(github, context, name, {
    tag: name,
    archivedAt: new Date(context.now()).toISOString(),
    sourceCommit: context.sourceCommit,
    files: filesJson.count,
    bytes: filesJson.bytes,
    assets: assets.map(({ name: assetName, size, sha256 }) => ({
      name: assetName,
      size,
      sha256,
    })),
  })
  await context.afterRecord?.(name)
  // 6. last check on the renamed copy, then delete it permanently
  await removeAfterFinalCheck(context, name, remoteManifest.files)
}

/**
 * Reads one QA build file without following links.
 * @param {string} path - The file.
 * @returns {Promise<{ size: number, sha256: string }>} Size and SHA-256.
 * @throws {CommandRefusal} `E_FOLDER_CHANGED` for a link, hard link or non-file.
 */
async function qaFileFacts(path) {
  const stats = await lstat(path)
  if (!stats.isFile() || stats.nlink > 1)
    throw new CommandRefusal(
      'E_FOLDER_CHANGED',
      `${path} is a symbolic link, hard link or special file`,
      { fix: 'remove the link, then rerun', exitCode: EXIT.FOLLOW_UP },
    )
  return { size: stats.size, sha256: await sha256OfFile(path) }
}

/**
 * The last check before QA build files are deleted: rename them aside, rehash, then remove; on a difference move them back.
 * Called by {@link rotateQaBuild} after the record was written.
 * @param {object} context - Rotation context.
 * @param {string} stem - The build's `codebook-<sha>` stem.
 * @param {{ name: string, path: string, size: number, sha256: string }[]} assets - The uploaded files with their hashes.
 * @throws {CommandRefusal} `E_FOLDER_CHANGED` on a difference; the files are back, or, when a path was recreated meanwhile, stay in the run's temporary folder and the error names it.
 */
async function removeQaBuildAfterFinalCheck(context, stem, assets) {
  const holder = join(context.asideRoot, `qa-${stem}`)
  await mkdir(holder, { recursive: true })
  const moved = []
  let problem = null
  const fingerprints = async () => {
    const found = new Map()
    for (const asset of assets)
      await statFingerprints(join(holder, asset.name), asset.name, found)
    return found
  }
  try {
    for (const asset of assets) {
      await rename(asset.path, join(holder, asset.name))
      moved.push(asset)
    }
    await context.afterAside?.(stem)
    const before = await fingerprints()
    for (const asset of assets) {
      const facts = await qaFileFacts(join(holder, asset.name))
      if (facts.size !== asset.size || facts.sha256 !== asset.sha256) {
        problem = `${asset.name} differs from what was uploaded`
        break
      }
    }
    if (problem === null) {
      await context.afterFinalHash?.(stem)
      // Nothing but this stat pass and the rm below may run between the comparison and the deletion.
      problem = firstFingerprintDifference(before, await fingerprints())
    }
  } catch (error) {
    problem = error.reason ?? error.message
  }
  if (problem === null) {
    await rm(holder, { recursive: true, force: true })
    return
  }
  const stuck = []
  for (const asset of moved)
    await moveWithoutReplacing(join(holder, asset.name), asset.path).catch(() =>
      stuck.push(asset.name),
    )
  if (stuck.length > 0) {
    const refusal = new CommandRefusal(
      'E_FOLDER_CHANGED',
      `${stem} changed just before deletion (${problem}) and ${stuck.join(', ')} could not be put back; the renamed files stay in ${holder}; to recover, move them back into artifacts/qa by hand`,
      {
        fix: `compare ${holder} with artifacts/qa by hand, then move the files back into artifacts/qa; nothing was deleted`,
        exitCode: EXIT.FOLLOW_UP,
      },
    )
    // The FAILED line must not claim the files are where they were.
    refusal.kept = false
    throw refusal
  }
  await rmdir(holder).catch(() => {})
  throw new CommandRefusal(
    'E_FOLDER_CHANGED',
    `${stem} changed just before deletion: ${problem}; the files were put back`,
    { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
  )
}

/**
 * Archives one QA build (its vsix and json) as assets of the `qa-builds` release.
 * Called by {@link runRotation} for a `qa-build` plan item.
 * @param {object} context - Rotation context.
 * @param {{ name: string, files: string[] }} item - The plan item (`qa/<stem>`).
 * @returns {Promise<void>} Resolves once the local files are deleted.
 */
async function rotateQaBuild(context, item) {
  const github = createGithub(context)
  const directory = join(context.artifactsDir, 'qa')
  const assets = []
  for (const file of item.files)
    assets.push({
      name: file,
      path: join(directory, file),
      ...(await qaFileFacts(join(directory, file))),
    })
  await uploadAssets(
    github,
    context,
    QA_RELEASE_TAG,
    'QA builds archived from artifacts/qa. Never restored automatically.',
    assets,
  )
  const downloadDir = join(
    context.workRoot,
    item.name.replace('/', '-'),
    'download',
  )
  await rm(downloadDir, { recursive: true, force: true })
  await downloadAndVerify(github, context, QA_RELEASE_TAG, assets, downloadDir)
  // Step 4: the build files must still be what was uploaded.
  for (const asset of assets) {
    const facts = await qaFileFacts(asset.path)
    if (facts.size !== asset.size || facts.sha256 !== asset.sha256)
      throw new CommandRefusal(
        'E_FOLDER_CHANGED',
        `${asset.name} changed after hashing`,
        { fix: 'rerun', exitCode: EXIT.FOLLOW_UP },
      )
  }
  const { sha, index } = await github.readIndex()
  const known = index.folders[QA_RELEASE_TAG]?.assets ?? []
  const merged = [
    ...known.filter((old) => !assets.some((asset) => asset.name === old.name)),
    ...assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
  ]
  index.folders[QA_RELEASE_TAG] = {
    tag: QA_RELEASE_TAG,
    archivedAt: new Date(context.now()).toISOString(),
    sourceCommit: context.sourceCommit,
    files: merged.length,
    bytes: merged.reduce((sum, asset) => sum + asset.size, 0),
    assets: merged,
  }
  await github.writeIndex(index, sha, `Archive ${item.name}`)
  // The local pointer comes before the deletion too: a failed write keeps the build files.
  await recordLocal(context, QA_RELEASE_TAG, index.folders[QA_RELEASE_TAG])
  await context.afterRecord?.(item.name)
  await removeQaBuildAfterFinalCheck(
    context,
    item.name.replace('qa/', ''),
    assets,
  )
}

/**
 * Reads the repository's current HEAD.
 * @param {Function} run - Command runner.
 * @param {NodeJS.ProcessEnv} environment - Secrets to hide.
 * @returns {Promise<string>} The full commit SHA.
 * @throws {CommandRefusal} `E_GIT`.
 */
async function readHead(run, environment) {
  const result = await run('git', ['rev-parse', 'HEAD'])
  const sha = result.stdout.trim()
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(sha))
    throw new CommandRefusal(
      'E_GIT',
      `git rev-parse HEAD failed: ${redactSecrets(result.stderr.trim().split('\n')[0] || sha, environment)}`,
      { fix: 'run from the repository checkout', exitCode: EXIT.FAILED },
    )
  return sha
}

/**
 * Obtains the archive account's token and checks the archive repository is private.
 *
 * Why: evidence is private; nothing may be uploaded to a public repository or under another account.
 * Called by {@link runRotation}, {@link restoreFolder} and {@link initRepository}.
 *
 * @param {object} context - Rotation context.
 * @param {{ needRepository?: boolean }} [options] - `needRepository: false` for `--init`.
 * @returns {Promise<string>} The token (never printed).
 * @throws {CommandRefusal} `E_NO_ACCOUNT`, `E_REPO_MISSING`, `E_NOT_PRIVATE` or `E_INIT_INCOMPLETE`.
 */
async function requireAccount(context, { needRepository = true } = {}) {
  const result = await context.run('gh', [
    'auth',
    'token',
    '--user',
    ARCHIVE_ACCOUNT,
  ])
  const token = result.stdout.trim()
  if (result.status !== 0 || token === '')
    throw new CommandRefusal(
      'E_NO_ACCOUNT',
      `gh cannot give a token for ${ARCHIVE_ACCOUNT}`,
      { fix: `gh auth login as ${ARCHIVE_ACCOUNT} (never gh auth switch)` },
    )
  context.token = token
  if (!needRepository) return token
  const view = await context.run(
    'gh',
    ['repo', 'view', context.repository, '--json', 'visibility'],
    { env: { GH_TOKEN: token } },
  )
  if (view.status !== 0)
    throw new CommandRefusal(
      'E_REPO_MISSING',
      `cannot read ${context.repository}`,
      { fix: 'node extension/scripts/rotate-artifacts.mjs --init' },
    )
  if (JSON.parse(view.stdout).visibility !== 'PRIVATE')
    throw new CommandRefusal(
      'E_NOT_PRIVATE',
      `${context.repository} is not private`,
      { fix: 'make the archive repository private in GitHub, then rerun' },
    )
  // A repository without index.json was never fully initialised (`--init` writes it).
  await createGithub(context).readIndex()
  return token
}

/**
 * Prints one plan line per entry and returns the counts.
 * @param {object[]} plan - From {@link classifyInventory}.
 * @param {(line: string) => void} print - Output.
 * @returns {Record<string, number>} Entries and bytes per action.
 */
function printPlan(plan, print) {
  const counts = {
    keep: 0,
    archive: 0,
    delete: 0,
    skip: 0,
    unknown: 0,
    toFree: 0,
  }
  for (const item of plan) {
    counts[item.action] += 1
    if (item.action === 'archive' || item.action === 'delete')
      counts.toFree += item.bytes
    print(
      `${item.action.padEnd(7)} ${item.name} ${item.bytes}${item.reason ? ` (${item.reason})` : ''}`,
    )
  }
  return counts
}

/**
 * Whether a process is alive (signal 0 probes without sending anything).
 * Called by {@link acquireLock} to tell a live lock from a stale one.
 * @param {number} pid - Process id read from the lock file.
 * @returns {boolean} `true` when the process exists (a process owned by someone else counts as alive).
 */
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Takes the exclusive run lock `artifacts/.rotate-tmp/.lock` (created with `wx`, holding the pid and start time).
 *
 * Why: two runs would empty each other's temporary folder or archive the same entry twice; only one `--apply` or `--restore` may work at a time.
 * Called by {@link withRunLock}.
 *
 * @param {object} context - Rotation context.
 * @throws {CommandRefusal} `E_RUN_ACTIVE` for a lock whose process lives, or one that cannot be read.
 */
async function acquireLock(context) {
  const lockPath = join(context.tmpDir, '.lock')
  await mkdir(context.tmpDir, { recursive: true })
  const body = JSON.stringify({
    pid: process.pid,
    startedAt: new Date(context.now()).toISOString(),
    runId: context.runId,
  })
  const active = (detail) =>
    new CommandRefusal(
      'E_RUN_ACTIVE',
      `another run holds ${lockPath}: ${detail}`,
      {
        fix: `wait for it to finish; if no such run exists, remove ${lockPath} by hand`,
      },
    )
  // The run id of a dead owner whose lock this run replaced; its work folder goes only once this run holds the new lock.
  let deadRunId = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false
    try {
      await writeFile(lockPath, body, { flag: 'wx' })
      created = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (created) {
      // Only the dead owner's own work folder (never another run's, never its renamed copies) is removed.
      if (typeof deadRunId === 'string' && isSafeEntryName(deadRunId))
        await rm(join(context.tmpDir, deadRunId, 'work'), {
          recursive: true,
          force: true,
        })
      return
    }
    let holder = null
    try {
      holder = JSON.parse(await readFile(lockPath, 'utf8'))
    } catch (error) {
      // The lock vanished between the wx and this read: try again. Unreadable or half written is treated as a live lock, never guessed away.
      if (error.code === 'ENOENT') continue
    }
    if (!Number.isInteger(holder?.pid))
      throw active('its content cannot be read')
    if (attempt === 1 || context.isProcessAlive(holder.pid))
      throw active(`pid ${holder.pid}, started ${holder.startedAt}`)
    await context.afterLockRead?.(holder)
    // Reclaim atomically: of several reclaimers only one rename of the stale lock succeeds.
    const aside = `${lockPath}.stale-${context.runId}`
    try {
      await rename(lockPath, aside)
    } catch (error) {
      // Another reclaimer won: the next round re-reads the lock (a live owner gives E_RUN_ACTIVE).
      if (error.code === 'ENOENT') continue
      throw error
    }
    const moved = JSON.parse(await readFile(aside, 'utf8').catch(() => 'null'))
    if (moved?.runId !== holder.runId) {
      // The rename took a fresh lock another run created after the read: put it back and refuse.
      await link(aside, lockPath).catch(() => {})
      await rm(aside, { force: true })
      throw active('it was replaced by another run just now')
    }
    await rm(aside, { force: true })
    context.print(
      `LOCK: replaced the stale lock of pid ${holder.pid} (started ${holder.startedAt})`,
    )
    deadRunId = holder.runId ?? null
  }
  throw active('it could not be taken after a retry')
}

/**
 * Runs `body` holding the run lock, then removes this run's temporary work and the lock.
 *
 * Why: `--apply` and `--restore` use their own folder `artifacts/.rotate-tmp/<run id>/` and nothing may remove another run's folder.
 * Called by {@link runRotation} and {@link restoreFolder}.
 *
 * @template T
 * @param {object} context - Rotation context (`runId`, `runDir`, `workRoot`, `asideRoot` are set by {@link main}).
 * @param {() => Promise<T>} body - The work.
 * @returns {Promise<T>} What `body` returns.
 */
async function withRunLock(context, body) {
  await acquireLock(context)
  context.locked = true
  try {
    return await body()
  } finally {
    // A restored copy that could not be published stays (keepWork), and so does any renamed copy that could not be put back.
    if (context.keepWork !== true)
      await rm(context.workRoot, { recursive: true, force: true })
    await rmdir(context.asideRoot).catch(() => {})
    await rmdir(context.runDir).catch(() => {})
    const lockPath = join(context.tmpDir, '.lock')
    const holder = JSON.parse(
      await readFile(lockPath, 'utf8').catch(() => 'null'),
    )
    if (holder?.runId === context.runId) await rm(lockPath, { force: true })
    await rmdir(context.tmpDir).catch(() => {})
    context.locked = false
  }
}

/**
 * The highest cycle number among the top-level cycle folders.
 * @param {{ name: string }[]} entries - Top-level entries of {@link readInventory}.
 * @returns {number | null} The highest number, or `null` when no cycle folder exists.
 */
function highestCycle(entries) {
  let highest = null
  for (const entry of entries) {
    const cycle = parseCycleNumber(entry.name)
    if (cycle !== null && (highest === null || cycle > highest)) highest = cycle
  }
  return highest
}

/**
 * Executes the apply part of a plan entry by entry, inside the run lock.
 *
 * Why: a failure of one entry keeps that entry and never stops the others; the busy check runs again when an entry's turn comes.
 * Called by {@link runRotation}.
 *
 * @param {object[]} plan - From {@link classifyInventory}.
 * @param {Record<string, number>} counts - From {@link printPlan}.
 * @param {object} context - Rotation context.
 * @returns {Promise<number>} The exit code ({@link EXIT}).
 */
async function applyPlan(plan, counts, context) {
  const { print } = context
  const result = {
    archived: 0,
    deleted: 0,
    skipped: counts.skip,
    failed: 0,
    freed: 0,
  }
  for (const item of plan) {
    if (item.action !== 'archive' && item.action !== 'delete') continue
    try {
      // The plan may be minutes old: a run may have started writing since.
      const paths =
        item.kind === 'qa-build'
          ? item.files.map((file) => join('qa', file))
          : [item.name]
      let busy = false
      for (const path of paths) {
        const tree = await scanTree(join(context.artifactsDir, path))
        if (tree.newestMs > context.now() - BUSY_MS) busy = true
      }
      if (busy) {
        result.skipped += 1
        print(
          `skipped ${item.name} E_FOLDER_BUSY: a file changed within 10 minutes`,
        )
        continue
      }
      if (item.action === 'delete') {
        await rm(join(context.artifactsDir, item.name), {
          recursive: true,
          force: true,
        })
        result.deleted += 1
      } else {
        // The temporary copy and the extraction may need about twice the entry's size.
        const free = await context.freeBytes(context.artifactsDir)
        if (item.bytes * 2 > free) {
          result.skipped += 1
          print(
            `skipped ${item.name} E_DISK_SPACE: needs ${item.bytes * 2} bytes, ${free} free`,
          )
          continue
        }
        if (item.kind === 'qa-build') await rotateQaBuild(context, item)
        else await rotateArchive(context, item)
        result.archived += 1
      }
      result.freed += item.bytes
    } catch (error) {
      result.failed += 1
      const code = error instanceof CommandRefusal ? error.code : 'E_INTERNAL'
      const message =
        error instanceof CommandRefusal
          ? error.reason
          : String(error?.message ?? error)
      print(
        `FAILED ${item.name} ${code}: ${redactSecrets(message, { ...context.environment, GH_TOKEN: context.token })}${error?.kept === false ? '' : ' (kept)'}`,
      )
    } finally {
      // This entry's temporary work is removed (renamed copies live apart and stay when they could not be put back).
      await rm(context.workRoot, { recursive: true, force: true })
    }
  }
  print(
    `ROTATE: archived=${result.archived} deleted=${result.deleted} kept=${counts.keep + counts.unknown} skipped=${result.skipped} failed=${result.failed} freed_bytes=${result.freed}`,
  )
  return result.failed > 0 ? EXIT.FOLLOW_UP : EXIT.DONE
}

/**
 * Prints the plan, and with `--apply` executes it entry by entry.
 *
 * Why: the one command of the merge chain; plan mode changes nothing and never creates the temporary area.
 * Called by {@link main}.
 *
 * @param {object} options - `current`, `keep`, `apply`.
 * @param {object} context - Rotation context.
 * @returns {Promise<number>} The exit code ({@link EXIT}).
 * @throws {CommandRefusal} `E_CURRENT_UNLIKELY` when `--current` is far above every cycle folder.
 */
async function runRotation({ current, keep, apply }, context) {
  const { print, progress } = context
  progress.enter('read HEAD')
  const sourceCommit = await readHead(context.run, context.environment)
  progress.enter('scan artifacts')
  const inventory = await readInventory(context.artifactsDir)
  const highest = highestCycle(inventory.entries)
  // A typo such as 1170 for 117 would put every cycle below N - keep and archive them all.
  if (highest !== null && current > highest + CURRENT_SLACK)
    throw new CommandRefusal(
      'E_CURRENT_UNLIKELY',
      `--current ${current} is more than ${CURRENT_SLACK} above the highest cycle folder found (${highest})`,
      {
        fix: `node extension/scripts/rotate-artifacts.mjs --current ${highest} (the highest cycle found in artifacts/ is ${highest}), or the merged cycle's real number`,
      },
    )
  const plan = classifyInventory(inventory, {
    current,
    keep,
    headShort: sourceCommit.slice(0, 8),
    now: context.now(),
  })
  const counts = printPlan(plan, print)
  if (!apply) {
    print(
      `PLAN: archive=${counts.archive} delete=${counts.delete} keep=${counts.keep} skip=${counts.skip} unknown=${counts.unknown} bytes_to_free=${counts.toFree}`,
    )
    return EXIT.DONE
  }
  progress.enter('check the archive account')
  await requireAccount(context)
  Object.assign(context, { current, keep, sourceCommit })
  progress.enter('rotate', { sideEffect: true })
  return withRunLock(context, () => applyPlan(plan, counts, context))
}

/**
 * Brings an archived folder back, byte-identical to its `files.json`.
 *
 * Why: archiving is only safe when it can be undone; the cited `artifacts/...` hashes must be checkable again.
 * Called by {@link main} for `--restore`.
 *
 * @param {string} folder - The archived entry's name.
 * @param {object} context - Rotation context.
 * @returns {Promise<number>} The exit code.
 * @throws {CommandRefusal} `E_RESTORE_UNKNOWN`, `E_RESTORE_EXISTS`, `E_RESTORE_UNSAFE`, `E_HASH_MISMATCH`.
 */
async function restoreFolder(folder, context) {
  const { print, progress } = context
  if (folder === QA_RELEASE_TAG)
    throw new CommandRefusal(
      'E_RESTORE_UNSUPPORTED',
      'QA builds are never restored automatically',
      { fix: `download the asset from the ${QA_RELEASE_TAG} release by hand` },
    )
  if (!isSafeEntryName(folder))
    throw new CommandRefusal(
      'E_USAGE',
      `${folder} is not an archived entry name`,
      {
        fix: 'node extension/scripts/rotate-artifacts.mjs --help',
        exitCode: EXIT.USAGE,
      },
    )
  const destination = join(context.artifactsDir, folder)
  progress.enter('restore', { sideEffect: true })
  return withRunLock(context, async () => {
    const exists = await lstat(destination).then(
      () => true,
      () => false,
    )
    if (exists)
      throw new CommandRefusal(
        'E_RESTORE_EXISTS',
        `${destination} already exists`,
        { fix: 'move or remove it, then rerun' },
      )
    progress.enter('check the archive account')
    await requireAccount(context)
    const github = createGithub(context)
    const { index } = await github.readIndex()
    const record = index.folders[folder]
    if (record === undefined)
      throw new CommandRefusal(
        'E_RESTORE_UNKNOWN',
        `${folder} is not in index.json of ${context.repository}`,
        { fix: 'check the folder name against index.json' },
      )
    const workDir = join(context.workRoot, `restore-${folder}`)
    await rm(workDir, { recursive: true, force: true })
    const downloadDir = join(workDir, 'download')
    await downloadAndVerify(
      github,
      context,
      record.tag,
      record.assets,
      downloadDir,
    )
    // The parts are joined by their part number, whatever order the index lists them in.
    const archiveParts = sortParts(
      record.assets
        .map((asset) => asset.name)
        .filter((assetName) => assetName.startsWith(`${folder}.tar.gz`)),
    ).map((assetName) => join(downloadDir, assetName))
    // The members are checked before anything is extracted.
    const names = (
      await expectSuccess(
        () =>
          context.run('tar', ['-tzf', '-'], { stdin: joinParts(archiveParts) }),
        'E_RESTORE_UNSAFE',
        'listing the archive',
        context.environment,
      )
    ).stdout
      .split('\n')
      .filter((line) => line !== '')
    const bad = checkMemberPaths(names, folder)
    if (bad !== null)
      throw new CommandRefusal(
        'E_RESTORE_UNSAFE',
        `the archive holds the unsafe member path ${JSON.stringify(bad)}`,
        { fix: 'nothing was extracted; do not restore this archive' },
      )
    const detailed = (
      await expectSuccess(
        () =>
          context.run('tar', ['-tvzf', '-'], {
            stdin: joinParts(archiveParts),
          }),
        'E_RESTORE_UNSAFE',
        'listing the archive',
        context.environment,
      )
    ).stdout
      .split('\n')
      .filter((line) => /^[lh]/.test(line))
    if (detailed.length > 0)
      throw new CommandRefusal(
        'E_RESTORE_UNSAFE',
        'the archive holds a link, which could leave the folder',
        { fix: 'nothing was extracted; do not restore this archive' },
      )
    const extractDir = join(workDir, 'extract')
    await mkdir(extractDir, { recursive: true })
    await expectSuccess(
      () =>
        context.run('tar', ['-xzf', '-', '--no-same-owner', '-C', extractDir], {
          stdin: joinParts(archiveParts),
        }),
      'E_RESTORE_UNSAFE',
      'extracting the archive',
      context.environment,
    )
    const manifest = JSON.parse(
      await readFile(join(downloadDir, `${folder}.files.json`), 'utf8'),
    )
    const problems = await compareWithManifest(
      extractDir,
      folder,
      manifest.files,
    )
    if (problems.length > 0)
      throw new CommandRefusal(
        'E_HASH_MISMATCH',
        `the restored ${folder} differs from files.json: ${problems[0]}`,
        { fix: 'nothing was moved into artifacts/' },
      )
    await context.beforeRestorePublish?.(destination)
    // The destination may have appeared since the first check: the move fails atomically and leaves it as it is.
    const restored = join(extractDir, folder)
    try {
      await moveWithoutReplacing(restored, destination)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      context.keepWork = true
      throw new CommandRefusal(
        'E_RESTORE_EXISTS',
        `${destination} appeared during the restore and was left unchanged`,
        {
          fix: `the restored copy stays at ${restored}; move or remove ${destination}, then move the copy there by hand`,
        },
      )
    }
    print(
      `RESTORE: ${folder} restored with ${record.files} files, ${record.bytes} bytes`,
    )
    return EXIT.DONE
  })
}

/**
 * Creates the private archive repository and its empty index, or writes the missing index of an existing private one.
 * Called by {@link main} for `--init`.
 * @param {object} context - Rotation context.
 * @returns {Promise<number>} The exit code.
 * @throws {CommandRefusal} `E_INIT_EXISTS` when the repository and its index.json are already there; `E_NOT_PRIVATE` for an existing public repository.
 */
async function initRepository(context) {
  await requireAccount(context, { needRepository: false })
  const github = createGithub(context)
  const view = await github.call([
    'repo',
    'view',
    context.repository,
    '--json',
    'visibility',
  ])
  const emptyIndex = { schemaVersion: 1, folders: {} }
  if (view.status === 0) {
    if (JSON.parse(view.stdout).visibility !== 'PRIVATE')
      throw new CommandRefusal(
        'E_NOT_PRIVATE',
        `${context.repository} is not private`,
        { fix: 'make the archive repository private in GitHub, then rerun' },
      )
    // A first --init that stopped between the two steps leaves a repository without index.json: finish it.
    if (await github.indexExists())
      throw new CommandRefusal(
        'E_INIT_EXISTS',
        `${context.repository} and its index.json already exist`,
        { fix: 'nothing to do; use --current <N> --apply' },
      )
    context.progress.enter('write the index', { sideEffect: true })
    await github.writeIndex(emptyIndex, null, 'Create index')
    context.print(
      `INIT: wrote index.json in the existing ${context.repository} (private)`,
    )
    return EXIT.DONE
  }
  context.progress.enter('create the repository', { sideEffect: true })
  await github.ok(
    [
      'repo',
      'create',
      context.repository,
      '--private',
      '--description',
      'Archived native evidence of laststance/codebook',
    ],
    'E_GITHUB',
    'creating the repository',
  )
  await github.writeIndex(emptyIndex, null, 'Create index')
  context.print(`INIT: created ${context.repository} (private)`)
  return EXIT.DONE
}

/**
 * The command's entry: parses arguments, prints `--help`, and runs the chosen mode.
 *
 * Why: it is what `node extension/scripts/rotate-artifacts.mjs` calls through {@link runCommandLine}; tests call it with their own argv and seams.
 *
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @param {string[]} [argv] - Arguments after the script name.
 * @param {Partial<{ run: Function, repositoryRoot: string, print: (line: string) => void, environment: NodeJS.ProcessEnv, now: () => number, freeBytes: (path: string) => Promise<number>, partBytes: number, repository: string, runId: string, isProcessAlive: (pid: number) => boolean, partWrite: Function, afterRecord: (name: string) => Promise<void>, afterAside: (name: string) => Promise<void>, afterFinalHash: (name: string) => Promise<void>, afterLockRead: (holder: object) => Promise<void>, beforeRestorePublish: (destination: string) => Promise<void> }>} [overrides] - Seams for tests, none of them a CLI flag: `partBytes` (small parts), `partWrite` (a failing part write), `afterRecord` (runs right after the record was written), `afterAside` (runs right after the entry was renamed aside), `afterFinalHash` (runs after the final hash comparison, before the second stat pass), `afterLockRead` (runs after a stale lock was read, before it is reclaimed), `beforeRestorePublish` (runs before the restore's final move), `isProcessAlive` and `runId` (the run lock).
 * @returns {Promise<number>} The exit code.
 * @throws {CommandRefusal} Refusals listed in `--help`.
 */
export async function main(
  progress,
  argv = process.argv.slice(2),
  overrides = {},
) {
  const environment = overrides.environment ?? process.env
  const print = overrides.print ?? ((line) => console.log(line))
  const usageFix = 'node extension/scripts/rotate-artifacts.mjs --help'
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        current: { type: 'string' },
        keep: { type: 'string' },
        apply: { type: 'boolean' },
        restore: { type: 'string' },
        init: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    throw new CommandRefusal('E_USAGE', error.message, {
      fix: usageFix,
      exitCode: EXIT.USAGE,
    })
  }
  const values = parsed.values
  if (values.help === true) {
    print(HELP_TEXT)
    return EXIT.DONE
  }
  const modes = [
    values.apply === true,
    values.restore !== undefined,
    values.init === true,
  ].filter(Boolean).length
  if (modes > 1)
    throw new CommandRefusal(
      'E_USAGE',
      '--apply, --restore and --init exclude each other',
      { fix: usageFix, exitCode: EXIT.USAGE },
    )
  const repositoryRoot = overrides.repositoryRoot ?? SCRIPT_REPOSITORY_ROOT
  const artifactsDir = join(repositoryRoot, 'artifacts')
  const tmpDir = join(artifactsDir, TEMP_FOLDER)
  const runId = overrides.runId ?? randomUUID()
  const runDir = join(tmpDir, runId)
  const context = {
    run: overrides.run ?? createCommandRunner(repositoryRoot, environment),
    artifactsDir,
    // Each run works in its own folder under the temporary area.
    tmpDir,
    runId,
    runDir,
    workRoot: join(runDir, 'work'),
    asideRoot: join(runDir, 'aside'),
    locked: false,
    repository: overrides.repository ?? ARCHIVE_REPOSITORY,
    partBytes: overrides.partBytes ?? PART_BYTES,
    partWrite: overrides.partWrite,
    afterRecord: overrides.afterRecord,
    afterAside: overrides.afterAside,
    afterFinalHash: overrides.afterFinalHash,
    afterLockRead: overrides.afterLockRead,
    beforeRestorePublish: overrides.beforeRestorePublish,
    isProcessAlive: overrides.isProcessAlive ?? defaultIsProcessAlive,
    now: overrides.now ?? Date.now,
    freeBytes:
      overrides.freeBytes ??
      (async (path) => {
        const stats = await statfs(path)
        return stats.bavail * stats.bsize
      }),
    print,
    progress,
    environment,
    token: '',
  }
  if (values.init === true) return initRepository(context)
  if (values.restore !== undefined)
    return restoreFolder(values.restore, context)
  // The plan and --apply both need the merged cycle.
  if (
    values.current === undefined ||
    !/^\d+$/.test(values.current) ||
    !Number.isSafeInteger(Number.parseInt(values.current, 10))
  )
    throw new CommandRefusal(
      'E_CURRENT_REQUIRED',
      '--current <N> (the merged cycle number, digits) is required',
      {
        fix: 'node extension/scripts/rotate-artifacts.mjs --current <N> [--apply]',
      },
    )
  const keep = values.keep === undefined ? DEFAULT_KEEP : Number(values.keep)
  // A zero or odd --keep would archive the current cycle or read as a typo; only whole numbers from 1 count.
  if (
    values.keep !== undefined &&
    (!/^\d+$/.test(values.keep) || !Number.isSafeInteger(keep) || keep < 1)
  )
    throw new CommandRefusal(
      'E_USAGE',
      '--keep must be a whole number of at least 1',
      { fix: usageFix, exitCode: EXIT.USAGE },
    )
  return runRotation(
    {
      current: Number.parseInt(values.current, 10),
      keep,
      apply: values.apply === true,
    },
    context,
  )
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
