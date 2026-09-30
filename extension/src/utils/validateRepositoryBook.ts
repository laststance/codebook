import {
  BOOK_INPUT_LIMIT_BYTES,
  BOOK_REVISION_LIMIT_BYTES,
  BOOK_SCHEMA_VERSION_V2,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from '../constants'
import {
  repositoryBookSchema,
  repositoryBookV2Schema,
  type RepositoryBook,
} from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { bookIntentDigest } from './bookIntentDigest'

/** Verifies every retained revision before reads or replacement, preventing fallback and rebinding through edited JSON. @example validateRepositoryBook(value, workspaceKey, bookId) */
export function validateRepositoryBook(
  value: unknown,
  workspaceKey: string,
  bookId: string,
): RepositoryBook {
  const schema =
    value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === BOOK_SCHEMA_VERSION_V2
      ? repositoryBookV2Schema
      : repositoryBookSchema
  const book = schema.parse(value),
    keys = new Set<string>(),
    identities = new Map<string, string>()
  if (book.workspaceKey !== workspaceKey || book.bookId !== bookId)
    throw new Error('Book belongs to another workspace or filename.')
  for (const [index, revision] of book.revisions.entries()) {
    const { hash, ...content } = revision
    if (
      revision.revision !== index + 1 ||
      revision.expectedRevision !== index ||
      keys.has(revision.key)
    )
      throw new Error('Book revision order or publication key changed.')
    keys.add(revision.key)
    if (
      sha256(JSON.stringify(content)) !== hash ||
      bookIntentDigest({
        bookId,
        key: revision.key,
        expectedRevision: revision.expectedRevision,
        document: revision.document,
      }) !== revision.inputDigest
    )
      throw new Error('Book revision or original intent hash changed.')
    if (
      Buffer.byteLength(JSON.stringify(revision.document)) >
        BOOK_INPUT_LIMIT_BYTES ||
      Buffer.byteLength(JSON.stringify(revision)) > BOOK_REVISION_LIMIT_BYTES
    )
      throw new Error(
        'Retained book exceeds its document or revision byte limit.',
      )
    const sources = new Map(
        revision.sources.map((source) => [source.path, source]),
      ),
      cited = new Set<string>()
    if (
      sources.size !== revision.sources.length ||
      revision.sourceChecks.length !== sources.size
    )
      throw new Error(
        'Book has duplicate sources or missing acquisition checks.',
      )
    // Copied source is authoritative even when the current workspace has drifted.
    for (const source of revision.sources) {
      if (
        Buffer.byteLength(source.text) > REPOSITORY_SOURCE_LIMIT_BYTES ||
        sha256(source.text) !== source.hash ||
        source.text.split(/\r\n|\r|\n/).length !== source.lineCount
      )
        throw new Error(`Retained source bytes changed: ${source.path}`)
      const checks = revision.sourceChecks.filter(
        (check) => check.path === source.path && check.hash === source.hash,
      )
      if (checks.length !== 1 || checks[0]!.acquiredAt > checks[0]!.checkedAt)
        throw new Error(`Invalid source acquisition receipt: ${source.path}`)
    }
    let observationCount = 0
    for (const node of revision.document.nodes) {
      const identity = node.learningItemId ?? `repository/${bookId}/${node.id}`,
        previous = identities.get(node.id)
      if (previous !== undefined && previous !== identity)
        throw new Error(`Learning identity changed for ${node.id}.`)
      identities.set(node.id, identity)
      for (const anchor of node.anchors) {
        const source = sources.get(anchor.path)
        if (
          !source ||
          source.hash !== anchor.hash ||
          anchor.endLine > source.lineCount
        )
          throw new Error(
            `Invalid source citation for ${node.id}: ${anchor.path}`,
          )
        cited.add(source.path)
      }
      for (const [linkIndex, link] of node.observations.entries()) {
        const matches = revision.observations.filter(
          (binding) =>
            binding.nodeId === node.id &&
            binding.linkIndex === linkIndex &&
            binding.studyId === link.studyId &&
            binding.observationId === link.observationId &&
            binding.sourceHash === link.sourceHash,
        )
        if (matches.length !== 1)
          throw new Error(`Missing exact observation binding for ${node.id}.`)
        if (
          matches[0]!.itemId.startsWith('repository/') &&
          matches[0]!.itemId !== identity
        )
          throw new Error(
            `Configured observation belongs to another learning item for ${node.id}.`,
          )
        observationCount++
      }
      if (
        node.learningItemId &&
        !revision.observations.some(
          (binding) =>
            binding.nodeId === node.id &&
            binding.itemId === node.learningItemId &&
            binding.sourceHash === node.anchors[0]!.hash,
        )
      )
        throw new Error(
          `Runtime alias lacks a matching primary observation for ${node.id}.`,
        )
    }
    if (
      cited.size !== sources.size ||
      observationCount !== revision.observations.length
    )
      throw new Error('Book contains uncited source or unlinked observations.')
  }
  // Normalization is in memory only; publication later writes v2 without changing old revision content.
  return repositoryBookV2Schema.parse({
    ...book,
    version: BOOK_SCHEMA_VERSION_V2,
  })
}
