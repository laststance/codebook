import { listCheckoutChanges } from './listCheckoutChanges.mjs'
import {
  CHECKOUT_CHANGE_PATH_LIMIT_CHARS,
  CHECKOUT_CHANGE_SHOWN_PATH_LIMIT,
} from './packageConstants.mjs'
import { readBuildIdentity } from './readBuildIdentity.mjs'

/**
 * Names some paths in a sentence without letting them fill it: the first {@link CHECKOUT_CHANGE_SHOWN_PATH_LIMIT}, each in quotes with its control characters escaped and cut after {@link CHECKOUT_CHANGE_PATH_LIMIT_CHARS} characters, and the count of the rest; called by {@link assertStableCheckout}. A repository chooses its file names, so a long or a multi-line one must not shape the failure.
 * @param paths - The paths to name, at least one.
 * @returns The quoted paths joined by commas, followed by "and N more" when some are left out.
 * @example
 * namedPaths(['PROJECT_STATE.md', 'notes.txt'])       // => '"PROJECT_STATE.md", "notes.txt"'
 * namedPaths(['a', 'b', 'c', 'd', 'e', 'f', 'g'])     // => '"a", "b", "c", "d", "e" and 2 more'
 */
function namedPaths(paths) {
  const shown = paths
    .slice(0, CHECKOUT_CHANGE_SHOWN_PATH_LIMIT)
    .map((path) =>
      JSON.stringify(
        path.length > CHECKOUT_CHANGE_PATH_LIMIT_CHARS
          ? `${path.slice(0, CHECKOUT_CHANGE_PATH_LIMIT_CHARS - 1)}…`
          : path,
      ),
    )
    .join(', ')
  const left = paths.length - CHECKOUT_CHANGE_SHOWN_PATH_LIMIT
  return left > 0 ? `${shown} and ${left} more` : shown
}

/**
 * Says how the dirty state of a checkout changed between two readings, with the paths Git names now; called by {@link assertStableCheckout}.
 * @param wasDirty - Whether the checkout counted as changed at the first reading.
 * @param isDirty - Whether it does now.
 * @param changes - What Git reports now ({@link listCheckoutChanges}).
 * @returns `undefined` when the state is the same; otherwise one clause: that Git reports changes now, with their paths; that the checkout counts as changed although Git names no path (an ignored or index-hidden package input that differs from its revision); or that Git reports no change any more.
 * @example
 * dirtyStateChange(false, true, [' M PROJECT_STATE.md']) // => 'Git reported no change before and reports changes now ("PROJECT_STATE.md")'
 * dirtyStateChange(true, true, [' M PROJECT_STATE.md'])  // => undefined
 */
function dirtyStateChange(wasDirty, isDirty, changes) {
  if (wasDirty === isDirty) return undefined
  if (!isDirty) return 'Git reported changes before and reports none now'
  // An entry is two status letters, a space and the path; the earlier path of a rename stands alone.
  const paths = changes.map((entry) =>
    /^.. /.test(entry) ? entry.slice('XY '.length) : entry,
  )
  return paths.length > 0
    ? `Git reported no change before and reports changes now (${namedPaths(paths)})`
    : 'Git reported no change before and a package input differs from its revision now, although Git names no changed path'
}

/**
 * Says which sources of the package differ between two readings of the build's identity; called by {@link assertStableCheckout}.
 * @param before - The identity read before the build ({@link readBuildIdentity}).
 * @param now - The identity read now.
 * @returns `undefined` when the source hash is the same; otherwise one clause that names the sources whose bytes changed, were added or were removed.
 * @example
 * sourceChange({ sourceHash: 'a1', sourceHashes: ['extension/src/main.ts:0f'] }, { sourceHash: 'b2', sourceHashes: ['extension/src/main.ts:9c'] })
 * // => 'the package\'s sources changed ("extension/src/main.ts")'
 */
function sourceChange(before, now) {
  if (before.sourceHash === now.sourceHash) return undefined
  const earlier = new Set(before.sourceHashes),
    later = new Set(now.sourceHashes)
  // An entry is the source's path, a colon and its hash; a path with a new hash is in both lists once.
  const changedPaths = [
    ...before.sourceHashes.filter((entry) => !later.has(entry)),
    ...now.sourceHashes.filter((entry) => !earlier.has(entry)),
  ].map((entry) => entry.slice(0, entry.lastIndexOf(':')))
  return `the package's sources changed (${namedPaths([...new Set(changedPaths)].toSorted())})`
}

/**
 * Refuses a package build whose checkout is no longer the one its identity was read from, in one sentence that names what changed; called by {@link buildPackage} after its compilation and again after its packaging, so that a VSIX is never labelled with a revision, a dirty state or source bytes it was not built from.
 * It compares the revision, the dirty state and the source hash, which is the hash of every source's own hash: exactly what the earlier comparison of the two whole identities decided by. The failure carries no identity, which holds one hash per source and filled the output of every test that shares one build.
 * @param repository - The repository's root.
 * @param before - The identity read before the build began ({@link readBuildIdentity}).
 * @param ownedScratchDirectory - The build's own scratch folder inside the repository, which is no change of the checkout.
 * @param phase - What ran since the last reading, for the sentence: `compilation` or `packaging`.
 * @returns Nothing, when the revision, the dirty state and the source hash are those of `before`.
 * @throws An `Error` whose message is `The checkout changed during <phase>: <what changed>. Retry from a stable checkout.`, where what changed is one clause for each of the three that differs, joined by semicolons: the two revisions; the paths Git reports now for a checkout that was clean; the sources whose bytes differ. At most {@link CHECKOUT_CHANGE_SHOWN_PATH_LIMIT} paths are named per clause.
 * @example
 * await assertStableCheckout('/work/codebook', before, scratch, 'compilation')
 * // throws 'The checkout changed during compilation: Git reported no change before and reports changes now ("PROJECT_STATE.md"). Retry from a stable checkout.'
 */
export async function assertStableCheckout(
  repository,
  before,
  ownedScratchDirectory,
  phase,
) {
  const now = await readBuildIdentity(repository, ownedScratchDirectory)
  const changes = [
    before.revision === now.revision
      ? undefined
      : `the revision went from ${before.revision} to ${now.revision}`,
    // Git is asked for the paths only when the state differs.
    before.dirty === now.dirty
      ? undefined
      : dirtyStateChange(
          before.dirty,
          now.dirty,
          await listCheckoutChanges(repository, ownedScratchDirectory),
        ),
    sourceChange(before, now),
  ].filter((change) => change !== undefined)
  if (changes.length > 0)
    throw new Error(
      `The checkout changed during ${phase}: ${changes.join('; ')}. Retry from a stable checkout.`,
    )
}
