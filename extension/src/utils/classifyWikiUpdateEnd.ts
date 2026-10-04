import { WIKI_UPDATE_RECOVERY_REQUEST } from '../constants'

import type { WikiFreshness } from './inspectDeepWikiFreshness'
import type {
  WikiPublishedIdentity,
  WikiUpdateEnd,
  WikiUpdateHost,
  WikiUpdateSite,
} from './wikiUpdateRun'

/** What a host observed when its Wiki update run stopped; {@link classifyWikiUpdateEnd} turns it into the result to record. */
export type WikiUpdateEndFacts = {
  /** Editor host that ran the update. */
  host: WikiUpdateHost
  /** The learner (or the closing window) stopped the run. */
  cancelled: boolean
  /** The run's bound passed. */
  timedOut: boolean
  /** Publish token ({@link readWikiPublishToken}) when the run started. */
  tokenAtStart: string | undefined
  /** Publish token when the run stopped; undefined when no readable manifest file is there. */
  tokenAtEnd: string | undefined
  /** Publication identity ({@link readWikiPublicationIdentity}) when the run started. */
  publicationAtStart: string | undefined
  /** Publication identity when the run stopped; a publish happened only when it differs from the start's. */
  publicationAtEnd: string | undefined
  /** The published manifest as read when the run stopped; undefined when it is missing or invalid. */
  published: (WikiPublishedIdentity & { freshness: WikiFreshness }) | undefined
  /** Added source files the Wiki neither indexed nor excluded when the run started; they did not change while the agent worked. */
  uncoveredAtStart: string[]
  /** Learner files the publisher refuses to overwrite ({@link detectWikiPublishConflicts}). */
  blockingPaths: string[]
  /** What stopped the agent or the watch, as a sentence from the CLI or a thrown error; undefined when nothing failed. */
  failure: string | undefined
}

/** The remedy for each cause that keeps a new publish from being checked against the source. A retry helps only where the cause can pass by itself. */
const UNVERIFIED_REMEDIES: Record<
  NonNullable<WikiFreshness['unknownCause']>,
  string
> = {
  'unchecked-source':
    'Updating again will not change this; ask the editor chat to republish with that file listed by a path inside the project and its full-file SHA-256, or without it.',
  'no-revision':
    'Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.',
  'git-missing':
    'Install Git, or put it on the PATH of the editor, then press Update LLM Wiki again.',
  'git-timeout': 'Press Update LLM Wiki again.',
  'git-output-limit':
    'Commit or ignore the untracked files of this project so that Git lists fewer, then press Update LLM Wiki again.',
  'git-failed':
    'Run "git status" in this project to see what Git reports, then press Update LLM Wiki again.',
}

/** Says why a site that changed on disk is not accepted as the run's success, with the next step that can help. */
function describeUnverifiedPublish(
  agent: string,
  facts: WikiUpdateEndFacts,
): string {
  // Only the publisher writes a receipt that names the new manifest; anything else that rewrote the manifest is no publish.
  if (
    facts.publicationAtEnd === undefined ||
    facts.publicationAtEnd === facts.publicationAtStart
  )
    return `The Wiki’s manifest changed during the update, but not through a publish of the Codebook publisher, so Codebook cannot call it a new site. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}", then press Update LLM Wiki again.`
  const { published } = facts
  if (!published)
    return `${agent} published a new Wiki, but Codebook cannot read its manifest. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}", then press Update LLM Wiki again.`
  const { freshness } = published
  if (freshness.status === 'changed') {
    const uncoveredBefore = new Set(facts.uncoveredAtStart)
    const changedDuringRun = [
      ...freshness.changedPaths,
      ...freshness.addedPaths.filter((path) => !uncoveredBefore.has(path)),
    ]
    // Files nobody indexed before the run were not changed by waiting; another press would only repeat the same run.
    if (changedDuringRun.length === 0) {
      const uncovered = freshness.addedPaths
      return `${agent} published a new Wiki, but ${uncovered.length} source ${uncovered.length === 1 ? 'file is' : 'files are'} neither indexed nor excluded (first: ${uncovered[0] ?? 'unknown'}). Ask the editor chat to index or exclude ${uncovered.length === 1 ? 'it' : 'them'}.`
    }
    return `${agent} published a new Wiki, but ${changedDuringRun.length} source ${changedDuringRun.length === 1 ? 'file' : 'files'} changed while it worked (first: ${changedDuringRun[0] ?? 'unknown'}). Press Update LLM Wiki again.`
  }
  const cause = (
    freshness.reason ?? 'The freshness check gave no reason.'
  ).trim()
  // An answer without a named cause is told by what it could not check.
  const unknownCause =
    freshness.unknownCause ??
    (freshness.uncheckedPath === undefined ? 'no-revision' : 'unchecked-source')
  return `${agent} published a new Wiki, but Codebook cannot check it against the source: ${/[.!?]$/.test(cause) ? cause : `${cause}.`} ${UNVERIFIED_REMEDIES[unknownCause]}`
}

/**
 * Decides how a Wiki update run ended, in one place for VS Code and Cursor.
 *
 * Why: both hosts must report the same states for the same events, and "kept or replaced" must come from the disk (the publish token and the publication identity before and after), never from an assumption.
 * Trigger: the extension calls it when the VS Code watch returns and when the Cursor agent run settles, then records the answer with {@link WikiUpdateRun.end}.
 *
 * @param facts - What the host observed when the run stopped.
 * @returns
 * - No readable manifest file any more where one was at the start: `failed` with `site: 'missing'` and the chat request that recovers an unfinished publish
 * - Cancelled or past the bound: `cancelled` / `timed-out`, with whether the site was replaced meanwhile
 * - A new publication whose manifest matches the source: `succeeded` with its identity, whatever the agent's CLI also reported
 * - Learner files in the way: `conflict` with cause `learner-file`
 * - A failure sentence from the agent or a thrown error: `failed` with that reason
 * - A changed site that is not verified current: `failed` with `site: 'replaced'` and a reason Codebook wrote, built from the freshness answer
 * - Nothing published and nothing failed: `failed` with `site: 'kept'`
 *
 * @example
 * ```ts
 * classifyWikiUpdateEnd({ host: 'cursor', cancelled: false, timedOut: true, tokenAtStart: 'a@1', tokenAtEnd: 'a@1', publicationAtStart: 'a@7', publicationAtEnd: 'a@7', published: undefined, uncoveredAtStart: [], blockingPaths: [], failure: 'Cursor Agent timed out updating the Wiki.' })
 * // => { state: 'timed-out', site: 'kept' }
 * ```
 */
export function classifyWikiUpdateEnd(
  facts: WikiUpdateEndFacts,
): WikiUpdateEnd {
  // A stop inside the publisher's swap leaves no folder: that is neither the kept site nor a new one.
  if (facts.tokenAtEnd === undefined && facts.tokenAtStart !== undefined)
    return {
      state: 'failed',
      reason: `The Wiki is missing after a publish that did not finish. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}", then press Update LLM Wiki again.`,
      isCodebookSentence: true,
      site: 'missing',
    }
  const site: WikiUpdateSite =
    facts.tokenAtEnd === facts.tokenAtStart ? 'kept' : 'replaced'
  if (facts.cancelled) return { state: 'cancelled', site }
  if (facts.timedOut) return { state: 'timed-out', site }
  // A publish that matches the source is the update's success, also when the agent's CLI reported a failure after it.
  if (
    facts.publicationAtEnd !== undefined &&
    facts.publicationAtEnd !== facts.publicationAtStart &&
    facts.published?.freshness.status === 'current'
  ) {
    const { freshness, identity, revision, index } = facts.published
    return {
      state: 'succeeded',
      identity,
      // Without a Git repository no revision was checked, so none is claimed.
      ...(revision === undefined || freshness.addedFilesUnchecked
        ? {}
        : { revision }),
      index,
    }
  }
  if (facts.blockingPaths.length)
    return {
      state: 'conflict',
      paths: [...facts.blockingPaths],
      cause: 'learner-file',
      site,
    }
  if (facts.failure !== undefined)
    return { state: 'failed', reason: facts.failure, site }
  const agent = facts.host === 'cursor' ? 'Cursor Agent' : 'The editor agent'
  if (site === 'replaced')
    return {
      state: 'failed',
      reason: describeUnverifiedPublish(agent, facts),
      isCodebookSentence: true,
      site,
    }
  // An agent can end its turn without publishing and without an error.
  return {
    state: 'failed',
    reason: `${agent} finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in ${facts.host === 'cursor' ? 'Cursor chat' : 'the editor chat'} to see its own message.`,
    isCodebookSentence: true,
    site,
  }
}
