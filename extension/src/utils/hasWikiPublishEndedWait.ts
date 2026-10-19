import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { readWikiPublishedAt } from './readWikiPublishedAt'

/** The stopped watch of a VS Code Wiki update whose chat Codebook still waits for: when the watch ended, and the candidates (stage folders beside the Wiki) the watch saw of its run. Another window knows the first from the reservation and none of the second. */
export type AwaitedWikiChat = {
  /** When the watch ended (epoch milliseconds). */
  watchEndedAtMs: number
  /** Folder names of the candidates the watch saw; empty when it saw none, and for another window's reservation, which names none. */
  candidateNames: readonly string[]
}

/**
 * Says whether the site on disk was published after a watch ended; called by {@link hasWikiPublishEndedWait} first.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param watchEndedAtMs - When the watch ended (epoch milliseconds).
 * @returns `true` only for a readable manifest whose publish time ({@link readWikiPublishedAt}) is later than the watch's end; `false` without a manifest and for a site from the watch's end or before, which is the one the watch already saw.
 * @example
 * await wasPublishedAfter('/repo/.codebook/wiki', 1_790_000_000_000) // => false while the chat has not published
 */
async function wasPublishedAfter(
  outputDirectory: string,
  watchEndedAtMs: number,
): Promise<boolean> {
  const publishedAt = await readWikiPublishedAt(outputDirectory)
  return publishedAt !== undefined && Date.parse(publishedAt) > watchEndedAtMs
}

/**
 * Says whether a candidate the watch saw is still beside the Wiki; called by {@link hasWikiPublishEndedWait} for a site that was published after the watch's end.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param candidateNames - Folder names of the candidates the watch saw, each a sibling of the output folder.
 * @returns `true` while anything has one of those names beside the Wiki; `false` once the publisher moved each folder into place or it was removed, for a folder that cannot be looked at, and for a watch that saw none.
 * @example
 * await isCandidateStillThere('/repo/.codebook/wiki', ['wiki.stage-3f6c']) // => false after the publish that moved it into place
 */
async function isCandidateStillThere(
  outputDirectory: string,
  candidateNames: readonly string[],
): Promise<boolean> {
  const looks = await Promise.all(
    candidateNames.map((candidateName) =>
      lstat(join(dirname(outputDirectory), candidateName)).catch(
        () => undefined,
      ),
    ),
  )
  return looks.some((candidateStat) => candidateStat !== undefined)
}

/**
 * Says whether a publish ended the wait for a VS Code chat whose watch had stopped; called by the start check of an update before it counts this window's stopped watch or another window's reservation as in the way.
 *
 * Why: a stopped watch does not stop its chat, so Codebook waits for that chat until the watch bound and refuses a start meanwhile. Once the chat has published, that wait has nothing left to wait for, and a refusal would say that a chat may still be updating a Wiki whose publish the page has already shown. The publish is taken for the watched chat's own from what a window can observe: the site was published after the watch ended ({@link readWikiPublishedAt}, the time the page compares too), and every candidate the watch saw is gone, as it is once the publisher moved it into place. A candidate that is still there was not the one published, so the publish was somebody else's and the wait goes on.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param awaited - The stopped watch: its end and the candidates it saw.
 * @returns
 * - No readable manifest, or a site published at or before the watch's end: `false`
 * - A site published after the watch's end while a candidate the watch saw is still beside the Wiki: `false`
 * - A site published after the watch's end and no such candidate left (also when the watch saw none): `true`
 *
 * @example
 * ```ts
 * await hasWikiPublishEndedWait('/repo/.codebook/wiki', { watchEndedAtMs: 1_790_000_000_000, candidateNames: ['wiki.stage-3f6c'] })
 * // => true once the chat published that candidate after the watch's end
 * ```
 */
export async function hasWikiPublishEndedWait(
  outputDirectory: string,
  awaited: AwaitedWikiChat,
): Promise<boolean> {
  // A site from before the watch's end is the one the watch already saw; a candidate the watch saw that is still there was not the folder moved into place.
  return (
    (await wasPublishedAfter(outputDirectory, awaited.watchEndedAtMs)) &&
    !(await isCandidateStillThere(outputDirectory, awaited.candidateNames))
  )
}
