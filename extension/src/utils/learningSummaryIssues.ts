/** The parts of a learning summary its consistency rules read; both the configured summary and the Node test learning material have this shape. */
interface LearningSummaryGraph {
  participants: readonly { id: string }[]
  steps: readonly {
    id: string
    from: string
    to: string
    evidence: 'observed' | 'source-derived' | 'unknown'
    reference?: unknown
  }[]
}

/** One broken rule: the offending element's path inside the summary, and the sentence an agent reads. */
interface LearningSummaryIssue {
  path: (string | number)[]
  message: string
}

/**
 * Finds the participants whose id an earlier participant already has; called by {@link learningSummaryIssues} for the first rule.
 * @param participants - The summary's participants.
 * @param fieldPath - The name of the tool argument that holds the summary.
 * @returns One issue for the second and every later use of an id, in the order of the participants.
 * @example
 * repeatedParticipantIdIssues([{ id: 'ui' }, { id: 'ui' }], 'learningSummary')
 * // => [{ path: ['participants', 1, 'id'], message: 'learningSummary.participants[1].id "ui" is used twice; participant ids are unique.' }]
 */
function repeatedParticipantIdIssues(
  participants: LearningSummaryGraph['participants'],
  fieldPath: string,
): LearningSummaryIssue[] {
  const issues: LearningSummaryIssue[] = [],
    participantIds = new Set<string>()
  for (const [index, participant] of participants.entries()) {
    // The second and every later use of an id is the offending element.
    if (participantIds.has(participant.id))
      issues.push({
        path: ['participants', index, 'id'],
        message: `${fieldPath}.participants[${index}].id "${participant.id}" is used twice; participant ids are unique.`,
      })
    participantIds.add(participant.id)
  }
  return issues
}

/**
 * Finds the ends of one step that name no declared participant; called by {@link stepIssues} for each step.
 * @param step - The step.
 * @param index - The step's place among the steps.
 * @param fieldPath - The name of the tool argument that holds the summary.
 * @param participantIds - The ids of the declared participants.
 * @returns One issue for `from` and one for `to`, in that order; a step from a participant to itself names it once, so it gives one issue at most.
 * @example
 * undeclaredEndIssues({ id: 's1', from: 'ui', to: 'api', evidence: 'unknown' }, 0, 'learningSummary', new Set(['ui']))
 * // => [{ path: ['steps', 0, 'to'], message: 'learningSummary.steps[0] (s1) names participant "api", which learningSummary.participants does not declare.' }]
 */
function undeclaredEndIssues(
  step: LearningSummaryGraph['steps'][number],
  index: number,
  fieldPath: string,
  participantIds: ReadonlySet<string>,
): LearningSummaryIssue[] {
  const issues: LearningSummaryIssue[] = []
  // A step from a participant to itself names it once.
  const ends =
    step.from === step.to
      ? ([['from', step.from]] as const)
      : ([
          ['from', step.from],
          ['to', step.to],
        ] as const)
  for (const [end, participantId] of ends)
    if (!participantIds.has(participantId))
      issues.push({
        path: ['steps', index, end],
        message: `${fieldPath}.steps[${index}] (${step.id}) names participant "${participantId}", which ${fieldPath}.participants does not declare.`,
      })
  return issues
}

/**
 * Finds an observed or source-derived step that has no reference; called by {@link stepIssues} for each step.
 * @param step - The step.
 * @param index - The step's place among the steps.
 * @param fieldPath - The name of the tool argument that holds the summary.
 * @param referenceAdvice - What a step without a reference is given, in the reference kind of the caller's profile.
 * @returns The one issue, or none for a step labelled unknown and for a step with a reference.
 * @example
 * missingReferenceIssues({ id: 's1', from: 'ui', to: 'ui', evidence: 'observed' }, 0, 'learningSummary', 'Label it unknown.')
 * // => [{ path: ['steps', 0, 'reference'], message: 'learningSummary.steps[0] (s1) is observed and has no reference. Label it unknown.' }]
 */
function missingReferenceIssues(
  step: LearningSummaryGraph['steps'][number],
  index: number,
  fieldPath: string,
  referenceAdvice: string,
): LearningSummaryIssue[] {
  if (step.evidence !== 'unknown' && !step.reference)
    return [
      {
        path: ['steps', index, 'reference'],
        message: `${fieldPath}.steps[${index}] (${step.id}) is ${step.evidence} and has no reference. ${referenceAdvice}`,
      },
    ]
  return []
}

/**
 * Checks the rules of the steps: unique ids, declared ends and a reference for what is not labelled unknown; called by {@link learningSummaryIssues} after the participants' rule.
 * @param summary - The summary's participants and steps.
 * @param fieldPath - The name of the tool argument that holds the summary.
 * @param referenceAdvice - What a step without a reference is given.
 * @returns Every broken rule in the order of the steps; for one step its repeated id first, then its ends, then its reference.
 * @example
 * stepIssues({ participants: [{ id: 'ui' }], steps: [{ id: 's1', from: 'ui', to: 'ui', evidence: 'unknown' }] }, 'learningSummary', 'Label it unknown.') // => []
 */
function stepIssues(
  summary: LearningSummaryGraph,
  fieldPath: string,
  referenceAdvice: string,
): LearningSummaryIssue[] {
  const issues: LearningSummaryIssue[] = [],
    participantIds = new Set(
      summary.participants.map((participant) => participant.id),
    ),
    stepIds = new Set<string>()
  for (const [index, step] of summary.steps.entries()) {
    if (stepIds.has(step.id))
      issues.push({
        path: ['steps', index, 'id'],
        message: `${fieldPath}.steps[${index}].id "${step.id}" is used twice; step ids are unique.`,
      })
    stepIds.add(step.id)
    issues.push(
      ...undeclaredEndIssues(step, index, fieldPath, participantIds),
      ...missingReferenceIssues(step, index, fieldPath, referenceAdvice),
    )
  }
  return issues
}

/**
 * Checks the four consistency rules of a learning summary and answers each broken rule as its own issue, with the path of the offending element and what it needs; called by the refinements of {@link learningSummarySchema} and {@link nodeTestLearningMaterialContentSchema}, whose refusal an agent reads through `codebook_explain` and `codebook_explain_node_history`.
 * The rules: participant ids are unique, step ids are unique, a step's `from` and `to` name declared participants, and an observed or source-derived step has a reference.
 * @param summary - The summary's participants and steps.
 * @param fieldPath - The name of the tool argument that holds the summary (`learningSummary`, or `content` for Node test learning material), with which every sentence starts.
 * @param referenceAdvice - What a step without a reference is given, in the reference kind of the caller's profile.
 * @returns Every broken rule in the order of the elements; an empty list for a consistent summary.
 * @example
 * learningSummaryIssues({ participants: [{ id: 'ui' }], steps: [{ id: 's1', from: 'ui', to: 'ui', evidence: 'source-derived' }] }, 'learningSummary', 'Give it the reference {snapshotUri, sourceHash} of a committed observation of this run, or label it unknown.')
 * // => [{ path: ['steps', 0, 'reference'], message: 'learningSummary.steps[0] (s1) is source-derived and has no reference. Give it the reference {snapshotUri, sourceHash} of a committed observation of this run, or label it unknown.' }]
 */
export function learningSummaryIssues(
  summary: LearningSummaryGraph,
  fieldPath: string,
  referenceAdvice: string,
): LearningSummaryIssue[] {
  return [
    ...repeatedParticipantIdIssues(summary.participants, fieldPath),
    ...stepIssues(summary, fieldPath, referenceAdvice),
  ]
}
