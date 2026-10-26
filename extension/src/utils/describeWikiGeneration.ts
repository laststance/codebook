import { WIKI_SHORT_REVISION_CHARS } from '../constants'

import { fullCommitHash } from './fullCommitHash'

/** What the manifest and the manifest file say of one generation: the revision it records and when the manifest was written (epoch milliseconds). */
export type WikiGeneration = {
  /** The manifest's `generated.revision` as written; kept only when it is a full commit hash. */
  revision?: string
  /** The manifest file's modification time; the publisher writes a new manifest at each publish. */
  publishedAtMs?: number
}

/**
 * Words which generation a published Wiki is, for the tooltip of the LLM Wiki view's Wiki row (accepted X1).
 *
 * Why: a learner who sees `Source changed` asks which source the Wiki was written from and when; the revision and the date answer without opening the browser.
 * Trigger: {@link readLlmWikiViewState} calls it for each Wiki row.
 *
 * @param generation - The revision the manifest records and the manifest file's modification time.
 * @param formatDate - Turns the time into the date in the editor's locale; tests pass a fixed one.
 * @returns
 * - Both known: "Generated from <first 7 characters of the revision> on <date>"
 * - A date and no usable revision (a folder without Git, or a revision that is no full commit hash): "Generated on <date> (no Git revision)"
 * - A revision and no date: "Generated from <first 7 characters of the revision>"
 * - Neither: `undefined`, so the tooltip has no generation line
 *
 * @example
 * describeWikiGeneration({ revision: '1936e41913729663cc99081e3224db89bb2d8e56', publishedAtMs: 1_790_000_000_000 }, () => 'Sep 21, 2026')
 * // => 'Generated from 1936e41 on Sep 21, 2026'
 */
export function describeWikiGeneration(
  generation: WikiGeneration,
  formatDate: (epochMs: number) => string = (epochMs) =>
    new Date(epochMs).toLocaleDateString(),
): string | undefined {
  // A revision is kept only as a full commit hash, as the freshness check keeps it.
  const shortRevision = fullCommitHash(generation.revision)?.slice(
    0,
    WIKI_SHORT_REVISION_CHARS,
  )
  const date =
    // A time that is not a finite number would print as "Invalid Date".
    generation.publishedAtMs === undefined ||
    !Number.isFinite(generation.publishedAtMs)
      ? undefined
      : formatDate(generation.publishedAtMs)
  if (shortRevision && date) return `Generated from ${shortRevision} on ${date}`
  if (date) return `Generated on ${date} (no Git revision)`
  if (shortRevision) return `Generated from ${shortRevision}`
  return undefined
}
