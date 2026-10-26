import {
  WIKI_GENERATE_CHAT_REQUEST,
  WIKI_UPDATE_RECOVERY_REQUEST,
} from '../constants'

import type { WikiFreshness } from './inspectDeepWikiFreshness'
import type {
  WikiPublishedIdentity,
  WikiRunKind,
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
  /** Set when Codebook wrote `failure` itself and ended it with the learner's next step (the chat that did not open); the result then marks its reason, so a reader shows it whole. */
  isFailureCodebookSentence?: boolean
  /** Set with `failure` when whoever worked on the update was not stopped and can still publish (a VS Code chat that may still hold its request, or one whose watch broke); the failed result then carries `mayBeReplacedLater`, so a reader does not say the site is kept for good. */
  mayBeReplacedLater?: boolean
  /** What the run did; absent for an update. A generation is judged by {@link endOfFinishedGeneration}: its success needs a new publication of this project with its entry page, not a current freshness (Cycle 0055, Eng decision 75). */
  runKind?: WikiRunKind
  /** For a generation: the sentence of the check a new publication failed, the manifest of another checkout or an entry page that cannot be read as a file of the Wiki folder; absent when both checks passed or no new publication is there. */
  generatedSiteProblem?: string
  /** For a generation: the Wiki folder as the learner reads it, which its sentences name. */
  outputLabel?: string
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

/**
 * Says that a new Wiki leaves added source files out that nobody indexed before the run either; called by {@link describeChangedSource} when waiting changed no file.
 * @param agent - The agent's name as the sentence's subject.
 * @param uncovered - The added files the new Wiki neither indexes nor excludes.
 * @returns The sentence with the count, the first file and the request for the editor chat; another press would only repeat the same run.
 * @example
 * describeUncoveredSources('Cursor Agent', ['src/new.ts']) // => 'Cursor Agent published a new Wiki, but 1 source file is neither indexed nor excluded (first: src/new.ts). Ask the editor chat to index or exclude it.'
 */
function describeUncoveredSources(agent: string, uncovered: string[]): string {
  return `${agent} published a new Wiki, but ${uncovered.length} source ${uncovered.length === 1 ? 'file is' : 'files are'} neither indexed nor excluded (first: ${uncovered[0] ?? 'unknown'}). Ask the editor chat to index or exclude ${uncovered.length === 1 ? 'it' : 'them'}.`
}

/**
 * Says that source files changed while the agent worked; called by {@link describeChangedSource} when the new Wiki is already behind the source.
 * @param agent - The agent's name as the sentence's subject.
 * @param changedDuringRun - The indexed files that differ and the files added during the run.
 * @returns The sentence with the count, the first file and the advice to update again.
 * @example
 * describeSourcesChangedDuringRun('The editor agent', ['src/a.ts', 'src/b.ts']) // => 'The editor agent published a new Wiki, but 2 source files changed while it worked (first: src/a.ts). Press Update LLM Wiki again.'
 */
function describeSourcesChangedDuringRun(
  agent: string,
  changedDuringRun: string[],
): string {
  return `${agent} published a new Wiki, but ${changedDuringRun.length} source ${changedDuringRun.length === 1 ? 'file' : 'files'} changed while it worked (first: ${changedDuringRun[0] ?? 'unknown'}). Press Update LLM Wiki again.`
}

/**
 * Says why a new Wiki that differs from the source is not the run's success; called by {@link describeUnverifiedFreshness} for the freshness answer `changed`.
 * @param agent - The agent's name as the sentence's subject.
 * @param freshness - The freshness answer of the published manifest, with status `changed`.
 * @param uncoveredAtStart - Added files that were already neither indexed nor excluded when the run started.
 * @returns
 * - Only files that were uncovered before the run are left: the sentence of {@link describeUncoveredSources}
 * - Otherwise: the sentence of {@link describeSourcesChangedDuringRun}
 * @example
 * describeChangedSource('Cursor Agent', { status: 'changed', changedPaths: ['src/a.ts'], addedPaths: [] }, [])
 * // => 'Cursor Agent published a new Wiki, but 1 source file changed while it worked (first: src/a.ts). Press Update LLM Wiki again.'
 */
function describeChangedSource(
  agent: string,
  freshness: WikiFreshness,
  uncoveredAtStart: string[],
): string {
  const uncoveredBefore = new Set(uncoveredAtStart)
  const changedDuringRun = [
    ...freshness.changedPaths,
    ...freshness.addedPaths.filter((path) => !uncoveredBefore.has(path)),
  ]
  // Files nobody indexed before the run were not changed by waiting; another press would only repeat the same run.
  if (changedDuringRun.length === 0)
    return describeUncoveredSources(agent, freshness.addedPaths)
  return describeSourcesChangedDuringRun(agent, changedDuringRun)
}

/**
 * Picks the remedy for a publish that could not be checked against the source; called by {@link describeUnverifiedFreshness} for the end of its sentence.
 * @param freshness - The freshness answer of the published manifest, with status `unknown`.
 * @returns The sentence of {@link UNVERIFIED_REMEDIES} for the named cause; an answer without a named cause is told by what it could not check (an unchecked path: `unchecked-source`, none: `no-revision`).
 * @example
 * unverifiedRemedy({ status: 'unknown', changedPaths: [], addedPaths: [], unknownCause: 'git-timeout' }) // => 'Press Update LLM Wiki again.'
 */
function unverifiedRemedy(freshness: WikiFreshness): string {
  // An answer without a named cause is told by what it could not check.
  const unknownCause =
    freshness.unknownCause ??
    (freshness.uncheckedPath === undefined ? 'no-revision' : 'unchecked-source')
  return UNVERIFIED_REMEDIES[unknownCause]
}

/**
 * Says why a readable new publication is not verified current; called by {@link describeUnverifiedPublish} with the freshness answer of the published manifest.
 * @param agent - The agent's name as the sentence's subject.
 * @param freshness - The freshness answer, `changed` or `unknown`.
 * @param uncoveredAtStart - Added files that were already neither indexed nor excluded when the run started.
 * @returns
 * - `changed`: the sentence of {@link describeChangedSource}
 * - Otherwise: that Codebook cannot check the Wiki against the source, with the check's reason (ended with a full stop) and the remedy of {@link unverifiedRemedy}
 * @example
 * describeUnverifiedFreshness('Cursor Agent', { status: 'unknown', changedPaths: [], addedPaths: [], reason: 'Git timed out', unknownCause: 'git-timeout' }, [])
 * // => 'Cursor Agent published a new Wiki, but Codebook cannot check it against the source: Git timed out. Press Update LLM Wiki again.'
 */
function describeUnverifiedFreshness(
  agent: string,
  freshness: WikiFreshness,
  uncoveredAtStart: string[],
): string {
  if (freshness.status === 'changed')
    return describeChangedSource(agent, freshness, uncoveredAtStart)
  const cause = (
    freshness.reason ?? 'The freshness check gave no reason.'
  ).trim()
  return `${agent} published a new Wiki, but Codebook cannot check it against the source: ${/[.!?]$/.test(cause) ? cause : `${cause}.`} ${unverifiedRemedy(freshness)}`
}

/**
 * Says why a site that changed on disk is not accepted as the run's success, with the next step that can help; called by {@link classifyWikiUpdateEnd} for a replaced site that is not verified current.
 * @param agent - The agent's name as the sentence's subject.
 * @param facts - What the host observed when the run stopped.
 * @returns
 * - No new publication identity: that the manifest changed without a publish of the Codebook publisher
 * - A new publication whose manifest cannot be read: that, with the recovery request
 * - A readable new publication: the sentence of {@link describeUnverifiedFreshness}
 * @example
 * describeUnverifiedPublish('Cursor Agent', { ...facts, publicationAtStart: 'a@7', publicationAtEnd: 'b@8', published: undefined })
 * // => 'Cursor Agent published a new Wiki, but Codebook cannot read its manifest. Ask the editor chat "…", then press Update LLM Wiki again.'
 */
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
  return describeUnverifiedFreshness(
    agent,
    published.freshness,
    facts.uncoveredAtStart,
  )
}

/**
 * Says that the Wiki folder is gone after a publish that did not finish; called first by {@link classifyWikiUpdateEnd}, before the site is called kept or replaced.
 * @param facts - What the host observed when the run stopped.
 * @returns
 * - No readable manifest file any more where one was at the start: `failed` with `site: 'missing'` and the recovery request
 * - Otherwise: `undefined`
 * @example
 * missingSiteEnd({ ...facts, tokenAtStart: 'a@1', tokenAtEnd: undefined }) // => { state: 'failed', reason: 'The Wiki is missing after a publish that did not finish. …', isCodebookSentence: true, site: 'missing' }
 * missingSiteEnd({ ...facts, tokenAtStart: 'a@1', tokenAtEnd: 'a@1' })     // => undefined
 */
function missingSiteEnd(facts: WikiUpdateEndFacts): WikiUpdateEnd | undefined {
  // A stop inside the publisher's swap leaves no folder: that is neither the kept site nor a new one.
  if (facts.tokenAtEnd === undefined && facts.tokenAtStart !== undefined)
    return {
      state: 'failed',
      reason: `The Wiki is missing after a publish that did not finish. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}", then press Update LLM Wiki again.`,
      isCodebookSentence: true,
      site: 'missing',
    }
  return undefined
}

/**
 * Ends a run the learner stopped or whose bound passed; called by {@link classifyWikiUpdateEnd} before anything the agent did is looked at.
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether the published site was replaced meanwhile.
 * @returns
 * - Cancelled: `cancelled` with the site, also when the bound passed too
 * - Past the bound: `timed-out` with the site
 * - Otherwise: `undefined`
 * @example
 * stoppedEnd({ ...facts, cancelled: false, timedOut: true }, 'kept') // => { state: 'timed-out', site: 'kept' }
 */
function stoppedEnd(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd | undefined {
  if (facts.cancelled) return { state: 'cancelled', site }
  if (facts.timedOut) return { state: 'timed-out', site }
  return undefined
}

/**
 * Picks the published manifest that is the run's success; called by {@link endOfFinishedRun} before any failure the agent reported is looked at.
 * @param facts - What the host observed when the run stopped.
 * @returns
 * - A new publication identity whose manifest matches the source: that manifest
 * - No publish of the Codebook publisher, an unreadable manifest, or one that is not verified current: `undefined`
 * @example
 * verifiedPublication({ ...facts, publicationAtStart: 'a@7', publicationAtEnd: 'b@8', published }) // => published, when published.freshness.status is 'current'
 * verifiedPublication({ ...facts, publicationAtStart: 'a@7', publicationAtEnd: 'a@7', published }) // => undefined
 */
function verifiedPublication(
  facts: WikiUpdateEndFacts,
): WikiUpdateEndFacts['published'] {
  if (
    facts.publicationAtEnd === undefined ||
    facts.publicationAtEnd === facts.publicationAtStart
  )
    return undefined
  return facts.published?.freshness.status === 'current'
    ? facts.published
    : undefined
}

/**
 * Builds the success a verified publication is recorded as; called by {@link endOfFinishedRun}.
 * @param published - The published manifest that matches the source.
 * @returns `succeeded` with the identity and the index, and with the revision only when one was checked.
 * @example
 * succeededEnd({ identity: 'a1b2c3d4e5f6+0f9e8d7c', revision: 'a1b2c3d4e5f6', index: '0f9e8d7c', freshness: { status: 'current', changedPaths: [], addedPaths: [] } })
 * // => { state: 'succeeded', identity: 'a1b2c3d4e5f6+0f9e8d7c', revision: 'a1b2c3d4e5f6', index: '0f9e8d7c' }
 */
function succeededEnd(
  published: NonNullable<WikiUpdateEndFacts['published']>,
): WikiUpdateEnd {
  const { freshness, identity, revision, index } = published
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

/**
 * Builds the failed end of a run whose agent or watch reported a failure; called by {@link blockedEnd}.
 * @param facts - What the host observed when the run stopped; only the two marks of the failure are read.
 * @param failure - The failure sentence.
 * @param site - Whether the published site was replaced meanwhile.
 * @returns `failed` with the reason and the site, marked as a Codebook sentence when the facts say Codebook wrote it, and as an end the site may be replaced after when the facts say somebody can still publish.
 * @example
 * failedEnd({ ...facts, isFailureCodebookSentence: true, mayBeReplacedLater: true }, 'The request may still be in the chat.', 'kept')
 * // => { state: 'failed', reason: 'The request may still be in the chat.', isCodebookSentence: true, mayBeReplacedLater: true, site: 'kept' }
 */
function failedEnd(
  facts: Pick<
    WikiUpdateEndFacts,
    'isFailureCodebookSentence' | 'mayBeReplacedLater'
  >,
  failure: string,
  site: WikiUpdateSite,
): WikiUpdateEnd {
  return {
    state: 'failed',
    reason: failure,
    ...(facts.isFailureCodebookSentence ? { isCodebookSentence: true } : {}),
    ...(facts.mayBeReplacedLater ? { mayBeReplacedLater: true } : {}),
    site,
  }
}

/**
 * Ends a run that something stopped from publishing; called by {@link endOfFinishedRun} once no verified publication is there.
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether the published site was replaced meanwhile.
 * @returns
 * - Learner files in the way: `conflict` with cause `learner-file` and a copy of the paths, also when a failure sentence is there
 * - A failure sentence from the agent or a thrown error: the failed end of {@link failedEnd}, with the marks the facts carry
 * - Otherwise: `undefined`
 * @example
 * blockedEnd({ ...facts, blockingPaths: ['pages/notes.html'] }, 'kept') // => { state: 'conflict', paths: ['pages/notes.html'], cause: 'learner-file', site: 'kept' }
 */
function blockedEnd(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd | undefined {
  if (facts.blockingPaths.length)
    return {
      state: 'conflict',
      paths: [...facts.blockingPaths],
      cause: 'learner-file',
      site,
    }
  return facts.failure === undefined
    ? undefined
    : failedEnd(facts, facts.failure, site)
}

/**
 * Words the failure of a run in which nothing stopped the agent and no verified publication appeared; called by {@link endOfFinishedRun} as its last case.
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether the published site was replaced meanwhile.
 * @returns
 * - A changed site that is not verified current: `failed` with the reason of {@link describeUnverifiedPublish}
 * - Nothing published: `failed` with `site: 'kept'`; for Cursor with the chat command that shows the agent's own message, for VS Code with where the chat's reply is
 * @example
 * unexplainedEnd({ ...facts, host: 'cursor' }, 'kept')
 * // => { state: 'failed', reason: 'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.', isCodebookSentence: true, site: 'kept' }
 */
function unexplainedEnd(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd {
  const agent = facts.host === 'cursor' ? 'Cursor Agent' : 'The editor agent'
  if (site === 'replaced')
    return {
      state: 'failed',
      reason: describeUnverifiedPublish(agent, facts),
      isCodebookSentence: true,
      site,
    }
  // An agent can end its turn without publishing and without an error. VS Code's chat shows its reply in the Chat view; the Cursor CLI's reply is shown nowhere.
  return {
    state: 'failed',
    reason:
      facts.host === 'cursor'
        ? `${agent} finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.`
        : 'The editor chat finished its reply without publishing a new Wiki. Read its reply in the Chat view, then press Update LLM Wiki again.',
    isCodebookSentence: true,
    site,
  }
}

/**
 * Decides how a run ended that nobody stopped and that left a Wiki folder; called by {@link classifyWikiUpdateEnd} after the missing site, the cancel and the bound.
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether the published site was replaced meanwhile.
 * @returns In this order: the success of {@link succeededEnd} for a verified publication, the end of {@link blockedEnd}, the failure of {@link unexplainedEnd}.
 * @example
 * endOfFinishedRun({ ...facts, blockingPaths: [], failure: 'Cursor Agent stopped with exit code 1 before finishing.' }, 'kept')
 * // => { state: 'failed', reason: 'Cursor Agent stopped with exit code 1 before finishing.', site: 'kept' }
 */
function endOfFinishedRun(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd {
  // A publish that matches the source is the update's success, also when the agent's CLI reported a failure after it.
  const published = verifiedPublication(facts)
  if (published) return succeededEnd(published)
  return blockedEnd(facts, site) ?? unexplainedEnd(facts, site)
}

/**
 * Counts the source files a generation's new Wiki is behind; called by {@link endOfFinishedGeneration} for its success.
 * @param freshness - The freshness answer of the published manifest.
 * @returns The changed and added files for `changed`; `undefined` for `current` and `unknown`, which the reader's own label tells.
 * @example
 * changedSourceCountOf({ status: 'changed', changedPaths: ['src/a.ts'], addedPaths: ['src/b.ts'] }) // => 2
 * changedSourceCountOf({ status: 'current', changedPaths: [], addedPaths: [] })                   // => undefined
 */
function changedSourceCountOf(freshness: WikiFreshness): number | undefined {
  return freshness.status === 'changed'
    ? freshness.changedPaths.length + freshness.addedPaths.length
    : undefined
}

/**
 * Judges the new publication a generation left; called by {@link endOfFinishedGeneration} once the publisher's receipt names a manifest that was not there at the start.
 * @param facts - What the host observed when the run stopped.
 * @param published - The published manifest, or `undefined` when it cannot be read.
 * @returns
 * - A failed owner or entry-page check ({@link WikiUpdateEndFacts.generatedSiteProblem}): `failed` with that check's sentence; a manifest of another checkout is no readable manifest of this project either, so this comes first
 * - A manifest that cannot be read: `failed` with the recovery request
 * - Otherwise: `succeeded`, with the count of source files that changed while it worked when its freshness says so; freshness never decides it
 * @example
 * generatedEnd({ ...facts, runKind: 'generate' }, published) // => { state: 'succeeded', identity: '1936e4191372+0f9e8d7c', revision: '1936e4191372', index: '0f9e8d7c' }
 */
function generatedEnd(
  facts: WikiUpdateEndFacts,
  published: WikiUpdateEndFacts['published'],
): WikiUpdateEnd {
  // A publication of another checkout, or one without its entry page, is no Wiki of this project to open.
  if (facts.generatedSiteProblem !== undefined)
    return {
      state: 'failed',
      reason: facts.generatedSiteProblem,
      isCodebookSentence: true,
      site: 'replaced',
    }
  if (!published)
    return {
      state: 'failed',
      reason: `An LLM Wiki was published in ${facts.outputLabel ?? 'the Wiki folder'}, but Codebook cannot read its manifest. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}".`,
      isCodebookSentence: true,
      site: 'replaced',
    }
  const changedSourceCount = changedSourceCountOf(published.freshness)
  return {
    ...succeededEnd(published),
    ...(changedSourceCount === undefined ? {} : { changedSourceCount }),
  }
}

/**
 * Words the failure of a generation that published nothing and that nothing stopped; called by {@link endOfFinishedGeneration} as its last case.
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether a manifest appeared during the run.
 * @returns `failed` with a sentence Codebook wrote that names the folder and the next step: a manifest that appeared without a publish of the Codebook publisher, the Cursor agent that exited without publishing, or the chat whose reply ended without publishing.
 * @example
 * unpublishedGenerationEnd({ ...facts, host: 'cursor', outputLabel: '.codebook/wiki' }, 'kept')
 * // => { state: 'failed', reason: 'Cursor Agent finished without publishing an LLM Wiki in .codebook/wiki. Press Generate LLM Wiki to try again, or ask the editor chat "/codebook Generate the LLM Wiki for this project" to see what it says.', isCodebookSentence: true, site: 'kept' }
 */
function unpublishedGenerationEnd(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd {
  const folder = facts.outputLabel ?? 'the Wiki folder'
  // Only the publisher writes a receipt that names the new manifest; a manifest anything else wrote is no generated Wiki.
  if (site === 'replaced')
    return {
      state: 'failed',
      reason: `A manifest appeared in ${folder} during the generation, but not through a publish of the Codebook publisher, so Codebook cannot call it a generated Wiki. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}".`,
      isCodebookSentence: true,
      site,
    }
  return {
    state: 'failed',
    reason:
      facts.host === 'cursor'
        ? `Cursor Agent finished without publishing an LLM Wiki in ${folder}. Press Generate LLM Wiki to try again, or ask the editor chat "${WIKI_GENERATE_CHAT_REQUEST}" to see what it says.`
        : `The editor chat finished its reply without publishing an LLM Wiki in ${folder}. Read its reply in the Chat view, then press Generate LLM Wiki again.`,
    isCodebookSentence: true,
    site,
  }
}

/**
 * Decides how a generation ended that nobody stopped; called by {@link classifyWikiUpdateEnd} after the cancel and the bound, for a run of kind `generate`.
 * Why: a first Wiki has nothing to keep, and a learner's edit during its up to 55 minutes does not make a usable Wiki a failure, so success is a new publication of this project with its entry page, with the freshness reported beside it (Cycle 0055, Eng decision 75).
 * @param facts - What the host observed when the run stopped.
 * @param site - Whether a manifest appeared during the run.
 * @returns In this order: the end of {@link generatedEnd} for a new publication, the end of {@link blockedEnd}, the failure of {@link unpublishedGenerationEnd}.
 * @example
 * endOfFinishedGeneration({ ...facts, runKind: 'generate', publicationAtStart: undefined, publicationAtEnd: 'b@8', published }, 'replaced') // => { state: 'succeeded', … }
 */
function endOfFinishedGeneration(
  facts: WikiUpdateEndFacts,
  site: WikiUpdateSite,
): WikiUpdateEnd {
  const isNewPublication =
    facts.publicationAtEnd !== undefined &&
    facts.publicationAtEnd !== facts.publicationAtStart
  if (isNewPublication) return generatedEnd(facts, facts.published)
  return blockedEnd(facts, site) ?? unpublishedGenerationEnd(facts, site)
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
 * - A generation (`runKind: 'generate'`) that nobody stopped: {@link endOfFinishedGeneration}, whose success needs no current freshness
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
  const missing = missingSiteEnd(facts)
  if (missing) return missing
  const site: WikiUpdateSite =
    facts.tokenAtEnd === facts.tokenAtStart ? 'kept' : 'replaced'
  const stopped = stoppedEnd(facts, site)
  if (stopped) return stopped
  return facts.runKind === 'generate'
    ? endOfFinishedGeneration(facts, site)
    : endOfFinishedRun(facts, site)
}
