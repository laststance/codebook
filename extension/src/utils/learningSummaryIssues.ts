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
  const issues: LearningSummaryIssue[] = [],
    participantIds = new Set<string>(),
    stepIds = new Set<string>()
  for (const [index, participant] of summary.participants.entries()) {
    // The second and every later use of an id is the offending element.
    if (participantIds.has(participant.id))
      issues.push({
        path: ['participants', index, 'id'],
        message: `${fieldPath}.participants[${index}].id "${participant.id}" is used twice; participant ids are unique.`,
      })
    participantIds.add(participant.id)
  }
  for (const [index, step] of summary.steps.entries()) {
    const stepPath = `${fieldPath}.steps[${index}]`
    if (stepIds.has(step.id))
      issues.push({
        path: ['steps', index, 'id'],
        message: `${stepPath}.id "${step.id}" is used twice; step ids are unique.`,
      })
    stepIds.add(step.id)
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
          message: `${stepPath} (${step.id}) names participant "${participantId}", which ${fieldPath}.participants does not declare.`,
        })
    if (step.evidence !== 'unknown' && !step.reference)
      issues.push({
        path: ['steps', index, 'reference'],
        message: `${stepPath} (${step.id}) is ${step.evidence} and has no reference. ${referenceAdvice}`,
      })
  }
  return issues
}
