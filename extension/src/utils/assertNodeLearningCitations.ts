import { StudyError } from '../errors'

import type { CitableEvent } from './recordingJournalScan'

/** A learning step's reference to one journal event, in any profile's material: the event's type and sequence, with the source hash a stop claims and the channel an output claims. */
export type CitationReference = {
  type: CitableEvent['type']
  sequence: number
  sourceHash?: string
  /** The declared stop a server stop citation names; when given, the cited stop must be a hit of it. */
  declaredStopIndex?: number
  channel?: 'stdout' | 'stderr'
  /** The context an extension stop or pause citation names (`page`, `service-worker`); when given, the cited event must have been recorded in it. */
  context?: string
  /** The target URL an extension stop or pause citation names; when given, the cited event must carry it. */
  targetUrl?: string
  /** The service worker generation an extension citation names; when given, the cited event must carry it. */
  workerGeneration?: number
}

/** What a material's content offers the citation check: its steps and their references. */
type CitingContent = {
  steps: readonly { id: string; reference?: CitationReference }[]
}

/**
 * Words what a sequence is in the sealed history, for the step refusal of {@link assertNodeLearningCitations}.
 * @param event - The cited event, or `undefined` for a sequence the history does not have.
 * @returns The event's words.
 * @example describeCitedEvent({ type: 'output', channel: 'stderr' }) // => 'an output on stderr'
 */
function describeCitedEvent(event: CitableEvent | undefined): string {
  if (!event) return 'no event'
  if (event.type === 'stop')
    return `a stop at ${event.path}:${event.line}${event.context === undefined ? '' : ` in the ${event.context} context`}`
  if (event.type === 'pause') return `a pause in the ${event.context} context`
  return describeEventKind(event.type, 'channel' in event ? event.channel : '')
}

/** Words an event kind without its position; `channel` names the stream of an output. */
function describeEventKind(
  type: CitableEvent['type'],
  channel: string | undefined,
): string {
  if (type === 'output') return `an output on ${channel}`
  if (type === 'result') return 'the result'
  if (type === 'stop') return 'a stop'
  if (type === 'pause') return 'a pause'
  if (type === 'request') return 'the request'
  if (type === 'response') return 'the response'
  return 'the request failure'
}

/**
 * Words the start of a step refusal on a read path (the history resource, a summary), where nobody called a tool.
 * @param stepId - The step's id.
 * @returns The start of the sentence.
 * @example neutralStepLead('s1') // => 'Saved learning step s1'
 */
function neutralStepLead(stepId: string): string {
  return `Saved learning step ${stepId}`
}

/**
 * Words the start of a step refusal on the save path, where the agent called `codebook_explain_node_history` and reads which tool refused.
 * @param stepId - The step's id.
 * @returns The start of the sentence.
 * @example saveStepLead('s1') // => 'codebook_explain_node_history refused step s1'
 */
export function saveStepLead(stepId: string): string {
  return `codebook_explain_node_history refused step ${stepId}`
}

/**
 * Says whether a learning step's reference matches the event the sealed journal holds at its sequence: a stop with the same source hash, an output on the same channel, or an event of the same type.
 * @param reference - The step's reference.
 * @param event - The journal's event at that sequence, or `undefined` when there is none.
 * @returns `true` when the reference cites the event as the journal holds it.
 * @example citesEvent({ type: 'result', sequence: 4 }, { type: 'result' }) // => true
 */
function citesEvent(
  reference: CitationReference,
  event: CitableEvent | undefined,
): boolean {
  if (reference.type === 'stop')
    return (
      event?.type === 'stop' &&
      event.sourceHash === reference.sourceHash &&
      (reference.declaredStopIndex === undefined ||
        event.declaredStopIndex === reference.declaredStopIndex) &&
      citesExtensionTarget(reference, event)
    )
  if (reference.type === 'pause')
    return event?.type === 'pause' && citesExtensionTarget(reference, event)
  if (reference.type === 'output')
    return event?.type === 'output' && event.channel === reference.channel
  return event?.type === reference.type
}

/**
 * Says whether an extension citation's context, target URL and worker generation match the event's, for every one the citation names: a citation with the right sequence and source hash but another context cites another stop (the stop registry allows a page and a worker stop at one source location).
 * @param reference - The step's reference.
 * @param event - A stop or pause event.
 * @returns `true` when every named part matches; a part the citation omits is not compared.
 * @example citesExtensionTarget({ type: 'stop', sequence: 3, context: 'page' }, { type: 'stop', context: 'service-worker' }) // => false
 */
function citesExtensionTarget(
  reference: CitationReference,
  event: Extract<CitableEvent, { type: 'stop' | 'pause' }>,
): boolean {
  return (
    (reference.context === undefined || event.context === reference.context) &&
    (reference.targetUrl === undefined ||
      event.targetUrl === reference.targetUrl) &&
    (reference.workerGeneration === undefined ||
      event.workerGeneration === reference.workerGeneration)
  )
}

/**
 * Words what a learning step's reference claims, for the step refusal.
 * @param reference - The step's reference.
 * @returns The claim's words.
 * @example describeCitationClaim({ type: 'output', sequence: 1, channel: 'stderr' }) // => 'an output on stderr'
 */
function describeCitationClaim(reference: CitationReference): string {
  const context =
    reference.context === undefined
      ? ''
      : ` in the ${reference.context} context`
  if (reference.type === 'stop')
    return reference.declaredStopIndex === undefined
      ? `a stop with sourceHash ${reference.sourceHash}${context}`
      : `a stop with sourceHash ${reference.sourceHash} of declaredStopIndex ${reference.declaredStopIndex}${context}`
  if (reference.type === 'pause') return `a pause${context}`
  return describeEventKind(reference.type, reference.channel)
}

/**
 * Lists the sequences closest to the cited one whose event the reference could cite: the same type, with the same source hash for a stop and the same channel for an output.
 * @param reference - The refused reference.
 * @param citable - The history's citable events.
 * @returns At most three sequences, nearest first, ties by the lower sequence.
 * @example nearestValidSequences({ type: 'stop', sequence: 9, sourceHash: 'ab' }, citable) // => [8, 5]
 */
function nearestValidSequences(
  reference: CitationReference,
  citable: ReadonlyMap<number, CitableEvent>,
): number[] {
  return [...citable.entries()]
    .filter(([, event]) => citesEvent(reference, event))
    .map(([sequence]) => sequence)
    .sort(
      (left, right) =>
        Math.abs(left - reference.sequence) -
          Math.abs(right - reference.sequence) || left - right,
    )
    .slice(0, 3)
}

/**
 * Words the refusal of one step whose reference does not match the event the journal holds at its sequence.
 * @param lead - The start of the sentence for the step.
 * @param reference - The step's reference.
 * @param citable - The history's citable events.
 * @param withNearest - Whether to name the nearest valid sequences.
 * @returns The refusal's sentence.
 * @example refuseCitation('Saved learning step s1', reference, citable, true)
 */
function refuseCitation(
  lead: string,
  reference: CitationReference,
  citable: ReadonlyMap<number, CitableEvent>,
  withNearest: boolean,
): string {
  const event = citable.get(reference.sequence)
  // A stop cited with another hash is told the hash the journal holds.
  const expectedHash =
    reference.type === 'stop' && event?.type === 'stop'
      ? `; expected sourceHash ${event.sourceHash}${event.declaredStopIndex === undefined ? '' : ` of declaredStopIndex ${event.declaredStopIndex}`}`
      : ''
  return `${lead}: sequence ${reference.sequence} is ${describeCitedEvent(event)} in the sealed history, but the step claims ${describeCitationClaim(reference)}${expectedHash}.${withNearest ? nearestWords(reference, citable) : ''} Read the history's events again and cite each event by its sequence, type and source hash.`
}

/** Words the nearest valid sequences of a refused reference, or that the history holds none. */
function nearestWords(
  reference: CitationReference,
  citable: ReadonlyMap<number, CitableEvent>,
): string {
  const nearest = nearestValidSequences(reference, citable)
  return nearest.length > 0
    ? ` Nearest valid sequences for ${describeCitationClaim(reference)}: ${nearest.join(', ')}.`
    : ` No sequence of this history holds ${describeCitationClaim(reference)}.`
}

/**
 * Refuses a learning material whose step cites an event the sealed history does not hold as cited, naming the step, the sequence, what that sequence is and what the step claims (X19), so the agent can correct the one step; called by the history store for every material it saves or reads.
 * @param content - The material's content.
 * @param citable - The history's citable events.
 * @param options - `lead` words the start of the refusal for a step id ({@link saveStepLead} on the save path, {@link neutralStepLead} on read paths); `withNearest` adds the nearest valid sequences (the server profile's recovery).
 * @throws An `INVALID_REFERENCE` {@link StudyError} for the first step whose reference does not match.
 * @example assertNodeLearningCitations(content, citable, { lead: neutralStepLead }) // returns for a material whose every reference matches
 */
export function assertNodeLearningCitations(
  content: CitingContent,
  citable: ReadonlyMap<number, CitableEvent>,
  options: {
    lead?: (stepId: string) => string
    withNearest?: boolean
  } = {},
): void {
  const lead = options.lead ?? neutralStepLead
  for (const step of content.steps) {
    const reference = step.reference
    if (!reference || citesEvent(reference, citable.get(reference.sequence)))
      continue
    throw new StudyError(
      'INVALID_REFERENCE',
      refuseCitation(
        lead(step.id),
        reference,
        citable,
        options.withNearest ?? false,
      ),
    )
  }
}
