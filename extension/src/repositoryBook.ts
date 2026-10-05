import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  BOOK_FILE_LIMIT_BYTES,
  BOOK_INPUT_LIMIT_BYTES,
  BOOK_MAX_FILES,
  BOOK_MAX_REVISIONS,
  BOOK_PREPARE_TIMEOUT_MS,
  BOOK_REVISION_LIMIT_BYTES,
  BOOK_SCHEMA_VERSION_V2,
  BOOK_STORAGE_FORMATS,
  PRIVATE_DIRECTORY_MODE,
} from './constants'
import { StudyArchiveUnavailableError, StudyError } from './errors'
import type { LearningLibrary } from './learningLibrary'
import { RecordingStore } from './recordingStore'
import {
  bookIdSchema,
  bookPublishIntentSchema,
  type BookDocument,
  type BookObservationBinding,
  type BookPublishIntent,
  type BookRevision,
  type RepositoryBook,
} from './repositorySchemas'
import type { RepositorySourceService } from './repositorySource'
import { sha256 } from './runtimeSupport/utils/sha256'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { bookIdOfFileName } from './utils/bookIdOfFileName'
import { bookIntentDigest } from './utils/bookIntentDigest'
import { bookObservationHash } from './utils/bookObservationHash'
import { projectRecording } from './utils/projectRecording'
import { readBoundedFile } from './utils/readBoundedFile'
import { validateRepositoryBook } from './utils/validateRepositoryBook'
import { withStorageLock } from './utils/withStorageLock'

/** Owns bounded immutable book history beside {@link LearningLibrary}; agents publish text without navigation or understanding authority. @example await books.publish(intent) */
export class RepositoryBookStore {
  private readonly pending = new Set<Promise<unknown>>()
  private readonly retirement = new AbortController()
  lastTiming?: { preparationMs: number; queueMs: number; heldMs: number }
  constructor(
    readonly sources: RepositorySourceService,
    readonly library: LearningLibrary,
    private readonly now = Date.now,
  ) {}

  /** Lists bounded storage validity one book at a time; an unavailable book never hides another valid book. @example await books.list() */
  async list() {
    const result: {
      bookId: string
      revision?: number
      title?: string
      firstNodeId?: string
      revisions?: number[]
      status: 'available' | 'unavailable'
      reason?: string
    }[] = []
    for (const bookId of await this.entries()) {
      try {
        const book = await this.readStored(bookId)
        if (!book) throw new Error('Book disappeared.')
        const latest = book.revisions.at(-1)!
        result.push({
          bookId,
          revision: latest.revision,
          title: latest.document.title,
          firstNodeId: latest.document.nodes[0]!.id,
          revisions: book.revisions.map((revision) => revision.revision),
          status: 'available',
        })
      } catch (error) {
        result.push({ bookId, status: 'unavailable', reason: String(error) })
      }
    }
    return result
  }

  /** Reads an exact retained revision and verifies each linked checkpoint; current source drift remains separate from copied bytes. @example await books.read('architecture', 1) */
  async read(bookId: string, revision: number) {
    const { revision: selected, latestRevision } = await this.readDefinition(
      bookId,
      revision,
    )
    const links = [],
      checkpoints = new Map<
        string,
        ReturnType<LearningLibrary['readCheckpoint']>
      >()
    const recordings = new RecordingStore(
      this.library.directory,
      this.library.workspaceKey,
    )
    const recorded = new Map<
      string,
      Promise<{
        index: Awaited<ReturnType<RecordingStore['read']>>
        context: Awaited<ReturnType<RecordingStore['readContext']>>
      }>
    >()
    // Failed history is an unavailable destination, not an invented observation or a lost article.
    for (const binding of selected.observations) {
      try {
        await this.verifyBinding(binding, checkpoints)
        let recording: {
          status: 'available' | 'unavailable'
          reason?: string
          outcome?: string
        }
        try {
          let pending = recorded.get(binding.studyId)
          if (!pending) {
            pending = Promise.all([
              recordings.read(binding.studyId),
              recordings.readContext(binding.studyId),
            ]).then(([index, context]) => ({ index, context }))
            recorded.set(binding.studyId, pending)
          }
          const { index, context } = await pending,
            projection = projectRecording(
              index,
              context.context,
              binding.elapsedMs,
            )
          if (
            !projection.observation ||
            projection.observation.id !== binding.observationId ||
            bookObservationHash(projection.observation) !==
              binding.observationHash
          )
            throw new Error(
              'The recording does not contain this exact observation.',
            )
          recording = { status: 'available', outcome: index.status }
        } catch (error) {
          recording = {
            status: 'unavailable',
            reason: `Recording unavailable: ${String(error)}`,
          }
        }
        links.push({ ...binding, status: 'available' as const, recording })
      } catch (error) {
        links.push({
          ...binding,
          status: 'unavailable' as const,
          reason: String(error),
          recording: {
            status: 'unavailable' as const,
            reason: 'The linked observation checkpoint is unavailable.',
          },
        })
      }
    }
    return { bookId, revision: selected, latestRevision, links }
  }

  /** Acquires exact immutable article content for reading or runtime binding without loading unrelated recording destinations. @example await books.readDefinition('architecture', 1) */
  async readDefinition(bookId: string, revision: number) {
    const book = await this.readStored(bookId),
      selected = book?.revisions.find((value) => value.revision === revision)
    if (!book || !selected)
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        `Book ${bookId} revision ${revision} is unavailable; no other revision was selected.`,
      )
    return {
      bookId,
      revision: selected,
      latestRevision: book.revisions.at(-1)!.revision,
    }
  }

  /** Owns preparation and final write through settlement, so transport loss cannot release a running writer. @example await books.publish(intent, signal) */
  publish(input: BookPublishIntent, signal?: AbortSignal) {
    if (this.retirement.signal.aborted)
      return Promise.reject(
        new StudyError(
          'SERVER_STOPPING',
          'Repository book storage is retired.',
        ),
      )
    const pending = this.publishOwned(
      input,
      AbortSignal.any([this.retirement.signal, ...(signal ? [signal] : [])]),
    )
    this.pending.add(pending)
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    )
    return pending
  }

  /** Stops new preparation and drains accepted I/O without treating cancellation as rollback. @example await books.dispose() */
  async dispose(): Promise<void> {
    this.retirement.abort()
    await Promise.allSettled([...this.pending])
  }

  /** Drains accepted publications when an MCP instance retires while the local historical reader remains usable. @example await books.flush() */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending])
  }

  /** Resolves retries before mutable preparation, then prepares → locks → revalidates → atomically publishes. @example await this.publishOwned(intent, signal) */
  private async publishOwned(input: BookPublishIntent, signal: AbortSignal) {
    const intent = bookPublishIntentSchema.parse(input),
      digest = bookIntentDigest(intent),
      startedAt = this.now(),
      deadlineAt = startedAt + BOOK_PREPARE_TIMEOUT_MS
    if (
      Buffer.byteLength(JSON.stringify(intent.document)) >
      BOOK_INPUT_LIMIT_BYTES
    )
      throw new StudyError(
        'LIMIT_EXCEEDED',
        `Book document exceeds ${BOOK_INPUT_LIMIT_BYTES} bytes.`,
      )
    // A committed response remains recoverable after the cited files or checkpoints disappear.
    const previous = await this.readStored(intent.bookId),
      recovered = this.recover(previous, intent.key, digest)
    if (recovered) return recovered
    this.assertActive(deadlineAt, signal)
    this.assertRevision(previous, intent.expectedRevision)
    this.assertLearningIdentities(previous, intent)
    const prepared = await this.sources.prepare(
      intent.document.nodes.flatMap((node) => node.anchors),
      { deadlineAt, signal },
    )
    const observations = await this.bindObservations(
      intent.document,
      deadlineAt,
      signal,
    )
    const queuedAt = this.now()
    this.assertActive(deadlineAt, signal)
    return withStorageLock(this.library.directory, async () => {
      const acquiredAt = this.now(),
        current = await this.readStored(intent.bookId),
        receipt = this.recover(current, intent.key, digest)
      if (receipt) return receipt
      this.assertActive(deadlineAt, signal)
      this.assertRevision(current, intent.expectedRevision)
      if (!current && (await this.entries()).length >= BOOK_MAX_FILES)
        throw new StudyError(
          'LIMIT_EXCEEDED',
          `Repository library already retains ${BOOK_MAX_FILES} books; no book was removed.`,
        )
      if ((current?.revisions.length ?? 0) >= BOOK_MAX_REVISIONS)
        throw new StudyError(
          'LIMIT_EXCEEDED',
          'Book already retains 20 revisions; no revision was removed.',
        )
      const sourceChecks = await prepared.revalidate()
      // Final checkpoint checks share the same writer ownership as archive/learner/recorder saves.
      const checkpoints = new Map<
        string,
        ReturnType<LearningLibrary['readCheckpoint']>
      >()
      for (const binding of observations) {
        this.assertActive(deadlineAt, signal)
        await this.verifyBinding(binding, checkpoints)
      }
      const content = {
        revision: intent.expectedRevision + 1,
        key: intent.key,
        inputDigest: digest,
        expectedRevision: intent.expectedRevision,
        publishedAt: new Date(this.now()).toISOString(),
        document: intent.document,
        sources: prepared.sources,
        sourceChecks,
        observations,
      }
      const revision = { ...content, hash: sha256(JSON.stringify(content)) }
      if (
        Buffer.byteLength(JSON.stringify(revision)) > BOOK_REVISION_LIMIT_BYTES
      )
        throw new StudyError(
          'LIMIT_EXCEEDED',
          `Book revision exceeds ${BOOK_REVISION_LIMIT_BYTES} bytes; previous revisions remain intact.`,
        )
      const book = validateRepositoryBook(
        {
          version: BOOK_SCHEMA_VERSION_V2,
          workspaceKey: this.library.workspaceKey,
          bookId: intent.bookId,
          revisions: [...(current?.revisions ?? []), revision],
        },
        this.library.workspaceKey,
        intent.bookId,
      )
      await prepared.verifyIdentities()
      this.assertActive(deadlineAt, signal)
      // Once the atomic writer begins, await its actual outcome even if its requester disconnects.
      await atomicPrivateWrite(
        this.path(intent.bookId),
        book,
        BOOK_FILE_LIMIT_BYTES,
      )
      this.lastTiming = {
        preparationMs: queuedAt - startedAt,
        queueMs: acquiredAt - queuedAt,
        heldMs: this.now() - acquiredAt,
      }
      return this.receipt(intent.bookId, revision)
    })
  }

  /** Pins each exact saved observation and its partial outcome before publication; aliases require matching primary source. @example await this.bindObservations(document, deadlineAt, signal) */
  private async bindObservations(
    document: BookDocument,
    deadlineAt: number,
    signal: AbortSignal,
  ): Promise<BookObservationBinding[]> {
    const bindings: BookObservationBinding[] = []
    const checkpoints = new Map<
      string,
      Awaited<ReturnType<LearningLibrary['readCheckpoint']>>
    >()
    for (const node of document.nodes) {
      for (const [linkIndex, link] of node.observations.entries()) {
        this.assertActive(deadlineAt, signal)
        let checkpoint = checkpoints.get(link.studyId)
        if (!checkpoint) {
          checkpoint = await this.readLinkedCheckpoint(link.studyId)
          checkpoints.set(link.studyId, checkpoint)
        }
        const observation = checkpoint.study.observations.find(
          (value) => value.id === link.observationId,
        )
        if (
          checkpoint.status !== 'saved' ||
          !observation ||
          observation.source.hash !== link.sourceHash
        )
          throw new StudyError(
            'BOOK_UNAVAILABLE',
            `Invalid observation ${link.studyId}/${link.observationId} for ${node.id}.`,
            checkpoint.reason ??
              'Discover a saved checkpoint with this exact observation and source hash.',
          )
        bindings.push({
          ...link,
          nodeId: node.id,
          linkIndex,
          itemId: observation.itemId,
          observationHash: bookObservationHash(observation),
          elapsedMs: observation.elapsedMs,
          outcome: checkpoint.study.finalOutcome,
        })
      }
      if (
        node.learningItemId &&
        !bindings.some(
          (binding) =>
            binding.nodeId === node.id &&
            binding.itemId === node.learningItemId &&
            binding.sourceHash === node.anchors[0]!.hash,
        )
      )
        throw new StudyError(
          'BOOK_UNAVAILABLE',
          `Runtime learning identity for ${node.id} lacks a linked observation with the same primary source.`,
        )
    }
    return bindings
  }

  /**
   * Reads the saved checkpoint a book link names; called when a revision's links are bound and by {@link verifyBinding}.
   * @param studyId - The saved study the link names.
   * @returns The study's checkpoint.
   * @throws A `BOOK_UNAVAILABLE` {@link StudyError} naming the study when the library no longer holds it (the learner deleted it), instead of the library's bare sentence; any other read failure as it is.
   * @example await this.readLinkedCheckpoint(link.studyId)
   */
  private readLinkedCheckpoint(
    studyId: string,
  ): ReturnType<LearningLibrary['readCheckpoint']> {
    return this.library.readCheckpoint(studyId).catch((error: unknown) => {
      // Only the library's own class says that the archive is gone; another failure with the same words is passed on.
      if (!(error instanceof StudyArchiveUnavailableError)) throw error
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        `Linked saved study ${studyId} is no longer in the study library; it was deleted or never saved.`,
        'Remove or replace the links to this study; no replacement observation was selected.',
      )
    })
  }

  /** Revalidates captured facts against the independent saved checkpoint on commit and every public read. @example await this.verifyBinding(binding) */
  private async verifyBinding(
    binding: BookObservationBinding,
    checkpoints = new Map<
      string,
      ReturnType<LearningLibrary['readCheckpoint']>
    >(),
  ): Promise<void> {
    let pending = checkpoints.get(binding.studyId)
    if (!pending) {
      pending = this.readLinkedCheckpoint(binding.studyId)
      checkpoints.set(binding.studyId, pending)
    }
    const checkpoint = await pending,
      observation = checkpoint.study.observations.find(
        (value) => value.id === binding.observationId,
      )
    if (
      checkpoint.status !== 'saved' ||
      !observation ||
      observation.itemId !== binding.itemId ||
      observation.source.hash !== binding.sourceHash ||
      observation.elapsedMs !== binding.elapsedMs ||
      bookObservationHash(observation) !== binding.observationHash
    )
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        `Linked observation ${binding.studyId}/${binding.observationId} is missing or changed.`,
        checkpoint.reason ??
          'Rediscover the saved study; no replacement observation was selected.',
      )
  }

  /** Reads one bounded regular file and validates all immutable history before returning any revision. @example await this.readStored('architecture') */
  private async readStored(
    bookId: string,
  ): Promise<RepositoryBook | undefined> {
    const identity = bookIdSchema.parse(bookId)
    try {
      // A preferred file's presence is authoritative; validation failures never try older data.
      for (const storage of BOOK_STORAGE_FORMATS) {
        const path = join(
          this.library.directory,
          `${identity}${storage.suffix}`,
        )
        const stat = await lstat(path).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (!stat) continue
        if (!stat.isFile() || stat.size > BOOK_FILE_LIMIT_BYTES)
          throw new Error('Book is not a bounded regular file.')
        const value: unknown = JSON.parse(
          (await readBoundedFile(path, BOOK_FILE_LIMIT_BYTES)).toString(),
        )
        if (
          !value ||
          typeof value !== 'object' ||
          !('version' in value) ||
          value.version !== storage.version
        )
          throw new Error(
            `Version ${storage.version} book has an incompatible schema.`,
          )
        return validateRepositoryBook(value, this.library.workspaceKey, bookId)
      }
      return undefined
    } catch (error) {
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        `Stored book ${bookId} is unavailable; no older revision was substituted.`,
        String(error),
      )
    }
  }

  /**
   * Enumerates only bounded book identities beside the shared ledger, without loading all revision payloads; called by {@link list} for the catalog and by {@link publishOwned} for the book count that admits a new book.
   * @returns The ids of the stored books ({@link bookIdOfFileName}), sorted, each once although a book may have a file of both formats. A file with a book suffix whose prefix is no book id (a stray `X.book.v1.json`) is nobody's book: it is skipped and not counted.
   * @throws A {@link StudyError} `LIMIT_EXCEEDED` when the directory holds more books than {@link BOOK_MAX_FILES}.
   * @example await this.entries() // => ['another', 'architecture'] beside a stray 'X.book.v1.json'
   */
  private async entries(): Promise<string[]> {
    await mkdir(this.library.directory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    })
    const entries = new Set<string>()
    for (const name of await readdir(this.library.directory)) {
      const bookId = bookIdOfFileName(name)
      // A file that is no book's, also one named like a book whose prefix is no book id (a stray `X.book.v1.json`), is skipped.
      if (bookId) entries.add(bookId)
    }
    if (entries.size > BOOK_MAX_FILES)
      throw new StudyError(
        'LIMIT_EXCEEDED',
        'Repository book count exceeds its limit; no history was removed.',
      )
    return [...entries].sort()
  }

  /** Keeps file selection inside the shared private directory using validated stable IDs. @example this.path('architecture') */
  private path(bookId: string): string {
    return join(
      this.library.directory,
      `${bookIdSchema.parse(bookId)}${BOOK_STORAGE_FORMATS[0].suffix}`,
    )
  }
  /** Returns the original immutable publication identity, independent of current source or connection lifetime. @example this.receipt(bookId, revision) */
  private receipt(bookId: string, revision: BookRevision) {
    return {
      bookId,
      revision: revision.revision,
      hash: revision.hash,
      publishedAt: revision.publishedAt,
    }
  }
  /** Recovers exact intent without duplicating revisions; a reused key with changed content fails explicitly. @example this.recover(book, key, digest) */
  private recover(
    book: RepositoryBook | undefined,
    key: string,
    digest: string,
  ) {
    const prior = book?.revisions.find((revision) => revision.key === key)
    if (!prior || !book) return undefined
    if (prior.inputDigest !== digest)
      throw new StudyError(
        'BOOK_CONFLICT',
        `Publication key ${key} already names different input.`,
      )
    return this.receipt(book.bookId, prior)
  }
  /**
   * Reads the revision a publication must expect in order to replace a book; called by {@link assertRevision} before it compares the two.
   * @param book - The stored book, or `undefined` when none exists under the id.
   * @returns The number of the last stored revision, or 0 when there is no book or no revision.
   * @example
   * this.currentRevision(undefined) // => 0
   * this.currentRevision(book)      // => 1 for a book published once
   */
  private currentRevision(book: RepositoryBook | undefined): number {
    return book?.revisions.at(-1)?.revision ?? 0
  }
  /**
   * Rejects a publication whose expected revision is not the book's current one, before preparation and again after the queue wait; called by {@link publishOwned}.
   * For a book that exists the refusal says what exists and the two ways on (replace it with the current revision as the expected one, or keep it and publish under another book id), because an agent that only read "read the current book" ran on the article it found.
   * @param book - The stored book, or `undefined` when none exists under the id.
   * @param expected - The revision the publication expects to replace; 0 creates the book.
   * @throws A `BOOK_CONFLICT` {@link StudyError} when `expected` differs from the current revision.
   * @example
   * this.assertRevision(book, 0)
   * // throws "Book interface exists at revision 1. To replace it, publish the complete document again with expectedRevision 1; to keep it, publish under another book id. A run stops only on lines its article's node cites, so publish your own citations before you start."
   */
  private assertRevision(
    book: RepositoryBook | undefined,
    expected: number,
  ): void {
    const current = this.currentRevision(book)
    if (expected === current) return
    // A book that does not exist yet has no revision to replace or to keep.
    if (!book || current === 0)
      throw new StudyError(
        'BOOK_CONFLICT',
        `Expected book revision ${expected}, current ${current}; read the current book before retrying.`,
      )
    throw new StudyError(
      'BOOK_CONFLICT',
      `Book ${book.bookId} exists at revision ${current}. To replace it, publish the complete document again with expectedRevision ${current}; to keep it, publish under another book id. A run stops only on lines its article's node cites, so publish your own citations before you start.`,
    )
  }
  /** Rejects rebinding before source/checkpoint I/O so agents receive actionable conflict recovery. @example this.assertLearningIdentities(book, intent) */
  private assertLearningIdentities(
    book: RepositoryBook | undefined,
    intent: BookPublishIntent,
  ): void {
    const identities = new Map(
      book?.revisions.flatMap((revision) =>
        revision.document.nodes.map((node) => [
          node.id,
          node.learningItemId ?? `repository/${intent.bookId}/${node.id}`,
        ]),
      ),
    )
    for (const node of intent.document.nodes) {
      const previous = identities.get(node.id),
        next = node.learningItemId ?? `repository/${intent.bookId}/${node.id}`
      if (previous !== undefined && previous !== next)
        throw new StudyError(
          'BOOK_CONFLICT',
          `Learning identity changed for ${node.id}. Keep its original learningItemId or omit it as in the retained revision.`,
          'Add observation links without changing existing article identities, or deliberately create a new article identity.',
        )
    }
  }
  /** Checks cancellation/deadline before starting writes without abandoning already accepted atomic I/O. @example this.assertActive(deadlineAt, signal) */
  private assertActive(deadlineAt: number, signal: AbortSignal): void {
    if (signal.aborted || this.now() >= deadlineAt)
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        'Book preparation expired or was cancelled; previous content was retained.',
      )
  }
}
