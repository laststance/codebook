import { execFile } from 'node:child_process'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { devNull } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  BOOK_MAX_SOURCES,
  BOOK_PREPARE_TIMEOUT_MS,
  BOOK_SOURCE_CONCURRENCY,
  REPOSITORY_GIT_LIMIT_BYTES,
  REPOSITORY_GIT_TIMEOUT_MS,
  REPOSITORY_MAX_TRACKED_FILES,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  REPOSITORY_SOURCE_PAGE_SIZE,
} from './constants'
import { StudyError } from './errors'
import {
  repositoryPathSchema,
  type BookAnchor,
  type RepositorySource,
} from './repositorySchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { sourceExclusion } from './utils/sourceExclusion'
import { unchangedSource } from './utils/unchangedSource'

const executeFile = promisify(execFile)
type AcquisitionControl = { deadlineAt: number; signal?: AbortSignal }
type SourceCatalog = {
  root: string
  rootIdentity: BigIntStats
  gitIdentity: BigIntStats
  indexPath: string
  indexIdentity?: BigIntStats
  paths: string[]
  excluded: Record<string, number>
  trackedCount: number
}

/** Exposes tracked local text to authoring without executing repository code; the extension supplies its trusted root. @example await new RepositorySourceService(root).read('src/main.ts') */
export class RepositorySourceService {
  constructor(
    readonly workspace: string,
    private readonly now = Date.now,
  ) {}

  /** Lists a stable bounded path snapshot for MCP discovery; changed pagination requires explicit rediscovery. @example await sources.list() */
  async list(cursor?: string) {
    const catalog = await this.catalog(),
      catalogHash = sha256(
        JSON.stringify({
          root: catalog.root,
          paths: catalog.paths,
          excluded: catalog.excluded,
          trackedCount: catalog.trackedCount,
        }),
      )
    const [expectedHash, offsetText] = cursor?.split(':') ?? []
    const offset = offsetText === undefined ? 0 : Number(offsetText)
    if (
      cursor !== undefined &&
      (!/^[a-f0-9]{64}:(0|[1-9]\d*)$/.test(cursor) ||
        expectedHash !== catalogHash ||
        !Number.isSafeInteger(offset) ||
        offset >= catalog.paths.length ||
        offset % REPOSITORY_SOURCE_PAGE_SIZE !== 0)
    )
      throw new StudyError(
        'STALE_SOURCE_CATALOG',
        'Source catalog cursor is invalid or names a changed tracked path set.',
      )
    const files = catalog.paths.slice(
      offset,
      offset + REPOSITORY_SOURCE_PAGE_SIZE,
    )
    return {
      catalogHash,
      files,
      excluded: catalog.excluded,
      trackedCount: catalog.trackedCount,
      eligibleCount: catalog.paths.length,
      nextCursor:
        offset + files.length < catalog.paths.length
          ? `${catalogHash}:${offset + files.length}`
          : undefined,
      qualification:
        'Tracked eligible names only. Each read separately verifies regular-file ownership, size, UTF-8 and current bytes.',
      limits: {
        pageSize: REPOSITORY_SOURCE_PAGE_SIZE,
        trackedFiles: REPOSITORY_MAX_TRACKED_FILES,
        sourceBytes: REPOSITORY_SOURCE_LIMIT_BYTES,
      },
    }
  }

  /** Acquires one exact current source for agent reading/publication, checking tracking and file identity before returning bytes. @example await sources.read('src/main.ts', previousHash) */
  async read(path: string, expectedHash?: string): Promise<RepositorySource> {
    const catalog = await this.catalog(),
      acquired = await this.acquire(catalog, path, expectedHash)
    await this.verifyCatalog(catalog)
    return acquired.source
  }

  /** Reports current citation availability without replacing retained bytes; reader refreshes acquire one bounded catalog. @example await sources.inspect(revision.sources) */
  async inspect(sources: readonly Pick<RepositorySource, 'path' | 'hash'>[]) {
    if (sources.length > BOOK_MAX_SOURCES)
      throw new StudyError(
        'LIMIT_EXCEEDED',
        'Too many source statuses requested.',
      )
    const control = { deadlineAt: this.now() + BOOK_PREPARE_TIMEOUT_MS }
    let catalog: SourceCatalog
    try {
      catalog = await this.catalog(control)
    } catch (error) {
      return sources.map((source) => ({
        path: source.path,
        hash: source.hash,
        status: 'unavailable' as const,
        currentHash: undefined,
        reason: String(error),
      }))
    }
    const states: {
      path: string
      hash: string
      status: 'current' | 'changed' | 'unavailable'
      currentHash?: string
      reason?: string
    }[] = []
    // A failed citation stays unverified without hiding the other retained sources.
    for (
      let offset = 0;
      offset < sources.length;
      offset += BOOK_SOURCE_CONCURRENCY
    ) {
      const batch = await Promise.all(
        sources
          .slice(offset, offset + BOOK_SOURCE_CONCURRENCY)
          .map(async (source) => {
            try {
              const current = await this.acquire(
                catalog,
                source.path,
                undefined,
                control,
              )
              return {
                path: source.path,
                hash: source.hash,
                status:
                  current.source.hash === source.hash
                    ? ('current' as const)
                    : ('changed' as const),
                currentHash: current.source.hash,
              }
            } catch (error) {
              return {
                path: source.path,
                hash: source.hash,
                status: 'unavailable' as const,
                reason: String(error),
              }
            }
          }),
      )
      states.push(...batch)
    }
    try {
      await this.verifyCatalog(catalog)
    } catch (error) {
      return sources.map((source) => ({
        path: source.path,
        hash: source.hash,
        status: 'unavailable' as const,
        currentHash: undefined,
        reason: String(error),
      }))
    }
    return states
  }

  /** Prepares deduplicated citations outside the writer queue for {@link RepositoryBookStore}; final revalidation never invokes Git. @example const prepared = await sources.prepare(node.anchors) */
  async prepare(
    anchors: readonly Pick<BookAnchor, 'path' | 'hash'>[],
    options: Partial<AcquisitionControl> = {},
  ) {
    const control = {
      deadlineAt: options.deadlineAt ?? this.now() + BOOK_PREPARE_TIMEOUT_MS,
      signal: options.signal,
    }
    this.assertActive(control)
    const unique = new Map<string, string>()
    // One path cannot describe different current bytes in the same publication.
    for (const anchor of anchors) {
      const previous = unique.get(anchor.path)
      if (previous !== undefined && previous !== anchor.hash)
        throw new StudyError(
          'SOURCE_CHANGED',
          `Conflicting citation hashes for ${anchor.path}.`,
        )
      unique.set(anchor.path, anchor.hash)
    }
    if (unique.size > BOOK_MAX_SOURCES)
      throw new StudyError(
        'LIMIT_EXCEEDED',
        `A book revision may cite at most ${BOOK_MAX_SOURCES} distinct sources.`,
      )
    const catalog = await this.catalog(control),
      requests = [...unique].map(([path, hash]) => ({ path, hash }))
    const acquired = await this.acquireBatch(catalog, requests, control)
    await this.verifyCatalog(catalog)
    this.assertActive(control)
    return {
      sources: acquired.map((value) => value.source),
      checks: acquired.map((value) => ({
        path: value.source.path,
        hash: value.source.hash,
        acquiredAt: value.checkedAt,
        checkedAt: value.checkedAt,
      })),
      verifyIdentities: async (): Promise<void> => {
        this.assertActive(control)
        await this.verifyCatalog(catalog)
        // Catch edits during checkpoint validation without repeating Git enumeration or source allocation.
        for (const value of acquired)
          if (
            !unchangedSource(
              value.identity,
              await this.verifyPath(catalog.root, value.source.path),
            )
          )
            throw new StudyError(
              'SOURCE_CHANGED',
              `Prepared source changed before commit: ${value.source.path}`,
            )
        this.assertActive(control)
      },
      revalidate: async () => {
        this.assertActive(control)
        await this.verifyCatalog(catalog)
        const checked = await this.acquireBatch(catalog, requests, control)
        // Even an identical-byte replacement changes the prepared file ownership.
        for (const [index, value] of checked.entries())
          if (!unchangedSource(acquired[index]!.identity, value.identity))
            throw new StudyError(
              'SOURCE_CHANGED',
              `Prepared source identity changed: ${value.source.path}`,
            )
        await this.verifyCatalog(catalog)
        this.assertActive(control)
        return checked.map((value, index) => ({
          path: value.source.path,
          hash: value.source.hash,
          acquiredAt: acquired[index]!.checkedAt,
          checkedAt: value.checkedAt,
        }))
      },
    }
  }

  /** Bounds descriptor work per publication and drains every accepted read before rejection. @example await this.acquireBatch(catalog, requests, control) */
  private async acquireBatch(
    catalog: SourceCatalog,
    requests: { path: string; hash: string }[],
    control: AcquisitionControl,
  ) {
    const acquired: Awaited<ReturnType<RepositorySourceService['acquire']>>[] =
      []
    // Sequential batches keep at most four reads active without leaving failed siblings unowned.
    for (
      let offset = 0;
      offset < requests.length;
      offset += BOOK_SOURCE_CONCURRENCY
    ) {
      this.assertActive(control)
      const results = await Promise.allSettled(
        requests
          .slice(offset, offset + BOOK_SOURCE_CONCURRENCY)
          .map((request) =>
            this.acquire(catalog, request.path, request.hash, control),
          ),
      )
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
        acquired.push(result.value)
      }
    }
    return acquired
  }

  /** Reads unchanged exact bytes against an already acquired catalog; used by single reads and bounded publication batches. @example await this.acquire(catalog, 'src/main.ts', hash) */
  private async acquire(
    catalog: SourceCatalog,
    path: string,
    expectedHash?: string,
    control?: AcquisitionControl,
  ) {
    this.assertActive(control)
    const parsed = repositoryPathSchema.safeParse(path),
      exclusion = sourceExclusion(path)
    if (!parsed.success || exclusion)
      throw new StudyError(
        'SOURCE_UNAVAILABLE',
        `Source path is unavailable: ${exclusion ?? 'invalid-path'}.`,
      )
    if (!catalog.paths.includes(path))
      throw new StudyError(
        'SOURCE_UNAVAILABLE',
        `Source is not in this workspace's eligible tracked set: ${path}`,
      )
    const fullPath = join(catalog.root, path)
    try {
      const before = await this.verifyPath(catalog.root, path)
      // No-follow/nonblocking avoids symlink or FIFO replacement between inspection and open.
      const handle = await open(
        fullPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        const opened = await handle.stat({ bigint: true })
        if (!opened.isFile() || !unchangedSource(before, opened))
          throw new StudyError(
            'SOURCE_CHANGED',
            `Source identity changed before reading: ${path}`,
          )
        if (opened.size > BigInt(REPOSITORY_SOURCE_LIMIT_BYTES))
          throw new StudyError(
            'SOURCE_UNAVAILABLE',
            `Source exceeds ${REPOSITORY_SOURCE_LIMIT_BYTES} bytes: ${path}`,
          )
        const bytes = Buffer.alloc(Number(opened.size) + 1)
        let offset = 0
        // Partial descriptor reads are legal; one extra byte detects growth without unbounded allocation.
        while (offset < bytes.length) {
          this.assertActive(control)
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          )
          if (bytesRead === 0) break
          offset += bytesRead
        }
        const after = await handle.stat({ bigint: true }),
          final = await this.verifyPath(catalog.root, path)
        if (
          offset !== Number(opened.size) ||
          !unchangedSource(opened, after) ||
          !unchangedSource(after, final)
        )
          throw new StudyError(
            'SOURCE_CHANGED',
            `Source changed while reading: ${path}`,
          )
        const content = bytes.subarray(0, offset)
        let text: string
        try {
          text = new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
          }).decode(content)
        } catch {
          throw new StudyError(
            'SOURCE_UNAVAILABLE',
            `Source is not valid UTF-8: ${path}`,
          )
        }
        if (text.includes('\0') || !Buffer.from(text).equals(content))
          throw new StudyError(
            'SOURCE_UNAVAILABLE',
            `Source is not lossless UTF-8 text: ${path}`,
          )
        const hash = sha256(content)
        if (expectedHash !== undefined && expectedHash !== hash)
          throw new StudyError(
            'SOURCE_CHANGED',
            `Source hash changed for ${path}; expected ${expectedHash}, current ${hash}.`,
            'Read codebook_source again before publishing a revised citation. Retained cited source remains available.',
          )
        this.assertActive(control)
        return {
          source: {
            path,
            hash,
            text,
            lineCount: text.split(/\r\n|\r|\n/).length,
          },
          identity: after,
          checkedAt: new Date(this.now()).toISOString(),
        }
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw new StudyError(
        'SOURCE_UNAVAILABLE',
        `Cannot acquire regular tracked source: ${path}`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** Reads only Git index names with fixed arguments and isolated Git overrides; invoked once per explicit list/acquisition. @example await this.catalog() */
  private async catalog(control?: AcquisitionControl): Promise<SourceCatalog> {
    this.assertActive(control)
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    )
    try {
      const root = await realpath(this.workspace),
        rootIdentity = await lstat(root, { bigint: true })
      const options = {
        cwd: root,
        maxBuffer: REPOSITORY_GIT_LIMIT_BYTES,
        env: {
          ...environment,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: devNull,
        },
        encoding: 'utf8' as const,
        signal: control?.signal,
      }
      const git = (arguments_: string[]) => {
        this.assertActive(control)
        return executeFile(
          'git',
          ['-c', 'core.fsmonitor=false', ...arguments_],
          {
            ...options,
            timeout: Math.min(
              REPOSITORY_GIT_TIMEOUT_MS,
              control
                ? Math.max(1, control.deadlineAt - this.now())
                : REPOSITORY_GIT_TIMEOUT_MS,
            ),
          },
        )
      }
      const top = await git(['rev-parse', '--show-toplevel'])
      if ((await realpath(top.stdout.replace(/\n$/, ''))) !== root)
        throw new StudyError(
          'PREREQUISITE_MISSING',
          'Open the repository root itself for source authoring; a nested workspace folder is not supported.',
        )
      this.assertActive(control)
      const index = await git([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'index',
      ])
      const indexPath = index.stdout.replace(/\n$/, ''),
        gitIdentity = await lstat(join(root, '.git'), { bigint: true }),
        indexIdentity = await this.indexIdentity(indexPath)
      if (!gitIdentity.isDirectory() && !gitIdentity.isFile())
        throw new StudyError(
          'PREREQUISITE_MISSING',
          'Git metadata must be a regular directory or worktree pointer.',
        )
      this.assertActive(control)
      const result = await git(['ls-files', '--cached', '-z', '--'])
      const paths = result.stdout.split('\0').filter(Boolean)
      if (paths.length > REPOSITORY_MAX_TRACKED_FILES)
        throw new StudyError(
          'LIMIT_EXCEEDED',
          `Repository contains more than ${REPOSITORY_MAX_TRACKED_FILES} tracked entries; no partial source catalog was returned.`,
        )
      const excluded: Record<string, number> = {},
        eligible = new Set<string>()
      // Reject excluded names before filesystem access; duplicate merge-stage entries name one source.
      for (const path of paths) {
        const reason = sourceExclusion(path)
        if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1
        else eligible.add(path)
      }
      const catalog = {
        root,
        rootIdentity,
        gitIdentity,
        indexPath,
        indexIdentity,
        paths: [...eligible].sort(),
        excluded,
        trackedCount: paths.length,
      }
      await this.verifyCatalog(catalog)
      this.assertActive(control)
      return catalog
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'Repository source discovery requires Git, a working-tree root and a bounded readable index.',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** Verifies prepared root/index ownership without a Git subprocess while the publication lock is held. @example await this.verifyCatalog(catalog) */
  private async verifyCatalog(catalog: SourceCatalog): Promise<void> {
    try {
      const root = await realpath(this.workspace),
        identity = await lstat(root, { bigint: true }),
        gitIdentity = await lstat(join(root, '.git'), { bigint: true }),
        indexIdentity = await this.indexIdentity(catalog.indexPath)
      const sameRoot =
        root === catalog.root &&
        identity.dev === catalog.rootIdentity.dev &&
        identity.ino === catalog.rootIdentity.ino
      const sameGit =
        gitIdentity.dev === catalog.gitIdentity.dev &&
        gitIdentity.ino === catalog.gitIdentity.ino &&
        (gitIdentity.isDirectory() ||
          unchangedSource(gitIdentity, catalog.gitIdentity))
      const sameIndex =
        indexIdentity && catalog.indexIdentity
          ? unchangedSource(indexIdentity, catalog.indexIdentity)
          : indexIdentity === catalog.indexIdentity
      if (!sameRoot || !sameGit || !sameIndex)
        throw new Error('Workspace root or tracked index changed.')
    } catch (error) {
      throw new StudyError(
        'SOURCE_CHANGED',
        'Repository identity or tracked set changed during source acquisition.',
        String(error),
      )
    }
  }

  /**
   * Distinguishes an empty new Git index from replaced metadata for acquisition guards; called by {@link catalog} for the path Git names as its index, and by {@link verifyCatalog} for the same path later.
   * @param path - The index's path as `git rev-parse --git-path index` answers it. Git resolves a link at the index's own path before it answers, so a link to a regular file arrives here as that file.
   * @returns The status of the regular file at the path, or undefined when nothing is there (a new repository has no index yet).
   * @throws `PREREQUISITE_MISSING` for a path that holds no regular file (a folder, a link that leads to one, a pipe): no source tool can answer until a regular index stands there, so the refusal carries the code whose recovery says to fix the named prerequisite, as the check of `.git` in {@link catalog} does. `SOURCE_UNAVAILABLE` would send the agent to `codebook_sources`, which answers the same refusal.
   * @example await this.indexIdentity(indexPath)
   */
  private async indexIdentity(path: string): Promise<BigIntStats | undefined> {
    const identity = await lstat(path, { bigint: true }).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (identity && !identity.isFile())
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'Git index must be a regular file.',
      )
    return identity
  }

  /** Rejects expired/cancelled preparation before more reads or a later publication can start. @example this.assertActive(control) */
  private assertActive(control?: AcquisitionControl): void {
    if (
      control &&
      (control.signal?.aborted || this.now() >= control.deadlineAt)
    )
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        'Source preparation expired or was cancelled; no publication was started.',
      )
  }

  /** Rejects linked ancestors and escaped/replaced paths before/after descriptor reads. @example await this.verifyPath(root, 'src/main.ts') */
  private async verifyPath(root: string, path: string): Promise<BigIntStats> {
    let current = root
    for (const component of path.split('/')) {
      current = join(current, component)
      if ((await lstat(current)).isSymbolicLink())
        throw new StudyError(
          'SOURCE_UNAVAILABLE',
          `Symbolic source paths are excluded: ${path}`,
        )
    }
    const canonical = await realpath(current),
      contained = relative(root, canonical)
    if (
      contained === '..' ||
      contained.startsWith(`..${sep}`) ||
      dirname(canonical) === canonical ||
      canonical !== current
    )
      throw new StudyError(
        'SOURCE_UNAVAILABLE',
        `Source escaped its canonical workspace path: ${path}`,
      )
    const stat = await lstat(current, { bigint: true })
    if (!stat.isFile())
      throw new StudyError(
        'SOURCE_UNAVAILABLE',
        `Source is not a regular file: ${path}`,
      )
    return stat
  }
}
