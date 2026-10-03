import type { WikiFreshness } from './inspectDeepWikiFreshness'
import type {
  WikiUpdateHost,
  WikiUpdateSite,
  WikiUpdateStatus,
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
  /** Publish token when the run stopped. */
  tokenAtEnd: string | undefined
  /** The published manifest as read when the run stopped; undefined when it is missing or invalid. */
  published: { identity: string; freshness: WikiFreshness } | undefined
  /** Learner files the publisher refuses to overwrite ({@link detectWikiPublishConflicts}). */
  blockingPaths: string[]
  /** What stopped the agent or the watch, as a sentence; undefined when nothing failed. */
  failure: string | undefined
}

/** The result of a run as {@link WikiUpdateRun} records it. */
export type WikiUpdateEnd =
  | Pick<
      Extract<WikiUpdateStatus, { state: 'succeeded' }>,
      'state' | 'identity'
    >
  | Pick<
      Extract<WikiUpdateStatus, { state: 'failed' }>,
      'state' | 'reason' | 'site'
    >
  | Pick<Extract<WikiUpdateStatus, { state: 'cancelled' }>, 'state' | 'site'>
  | Pick<Extract<WikiUpdateStatus, { state: 'timed-out' }>, 'state' | 'site'>
  | Pick<
      Extract<WikiUpdateStatus, { state: 'conflict' }>,
      'state' | 'paths' | 'cause' | 'site'
    >

/** Says why a newly published site is not accepted as the run's success, with the next step that can help. */
function describeUnverifiedPublish(
  agent: string,
  published: WikiUpdateEndFacts['published'],
): string {
  if (!published)
    return `${agent} published a new Wiki, but Codebook cannot read its manifest. Press Update LLM Wiki again.`
  const { freshness } = published
  if (freshness.status === 'changed') {
    const paths = [...freshness.changedPaths, ...freshness.addedPaths]
    return `${agent} published a new Wiki, but ${paths.length} source ${paths.length === 1 ? 'file' : 'files'} changed while it worked (first: ${paths[0] ?? 'unknown'}). Press Update LLM Wiki again.`
  }
  const cause = (
    freshness.reason ?? 'The freshness check gave no reason.'
  ).trim()
  // A retry cannot turn "unknown" into "current"; the manifest itself has to change.
  return `${agent} published a new Wiki, but Codebook cannot check it against the source: ${/[.!?]$/.test(cause) ? cause : `${cause}.`} Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.`
}

/**
 * Decides how a Wiki update run ended, in one place for VS Code and Cursor.
 *
 * Why: both hosts must report the same states for the same events, and "kept or replaced" must come from the disk (the publish token before and after), never from an assumption.
 * Trigger: the extension calls it when the VS Code watch returns and when the Cursor agent run settles, then records the answer in {@link WikiUpdateRun}.
 *
 * @param facts - What the host observed when the run stopped.
 * @returns
 * - Cancelled or past the bound: `cancelled` / `timed-out`, with whether the site was replaced meanwhile
 * - A new site that matches the source, with no failure: `succeeded` with its identity
 * - Learner files in the way: `conflict` with cause `learner-file`
 * - A failure sentence: `failed` with that reason
 * - A new site that is not verified current: `failed` with `site: 'replaced'` and a reason built from the freshness answer
 * - Nothing published and nothing failed: `failed` with `site: 'kept'`
 *
 * @example
 * ```ts
 * classifyWikiUpdateEnd({ host: 'cursor', cancelled: false, timedOut: true, tokenAtStart: 'a@1', tokenAtEnd: 'a@1', published: undefined, blockingPaths: [], failure: 'Cursor Agent timed out updating the Wiki.' })
 * // => { state: 'timed-out', site: 'kept' }
 * ```
 */
export function classifyWikiUpdateEnd(
  facts: WikiUpdateEndFacts,
): WikiUpdateEnd {
  const site: WikiUpdateSite =
    facts.tokenAtEnd === facts.tokenAtStart ? 'kept' : 'replaced'
  if (facts.cancelled) return { state: 'cancelled', site }
  if (facts.timedOut) return { state: 'timed-out', site }
  if (
    site === 'replaced' &&
    facts.failure === undefined &&
    facts.published?.freshness.status === 'current'
  )
    return { state: 'succeeded', identity: facts.published.identity }
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
      reason: describeUnverifiedPublish(agent, facts.published),
      site,
    }
  // An agent can end its turn without publishing and without an error.
  return {
    state: 'failed',
    reason: `${agent} finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in ${facts.host === 'cursor' ? 'Cursor chat' : 'the editor chat'} to see its own message.`,
    site,
  }
}
