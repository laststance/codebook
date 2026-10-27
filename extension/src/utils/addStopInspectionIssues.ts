import type { z } from 'zod'

import type { RepositoryInspection } from '../repositoryConfigSchemas'

import { missingValueInspectionMessage } from './missingValueInspectionMessage'

/** The part of a Node profile's declaration whose stops this check reads: the first stop's inspections and those of each additional stop. */
type DeclaredStopInspections = {
  inspections: readonly RepositoryInspection[]
  additionalStops?: readonly { inspections: readonly RepositoryInspection[] }[]
}

/**
 * Refuses every declared stop that has no required value inspection, one issue per stop at its own field, since a stop of type inspections only cannot prove the runtime state it is declared for.
 * Called by the refinements of {@link nodeTestConfigSchema} and {@link nodeServerConfigSchema}; the issue's text is {@link missingValueInspectionMessage}'s and reaches the agent as the refusal of `codebook_start`.
 * @param configuration - The declaration's first stop inspections and its additional stops.
 * @param context - The refinement context the issues are added to.
 * @returns Nothing; each stop without a required value inspection adds one `custom` issue at `inspections` or `additionalStops.<i>.inspections`.
 * @example
 * addStopInspectionIssues({ inspections: [{ path: 'form', mode: 'type', required: true }] }, context)
 * // adds { path: ['inspections'], message: 'configuration.inspections: this stop declares only type inspections (type:form). …' }
 */
export function addStopInspectionIssues(
  configuration: DeclaredStopInspections,
  context: z.RefinementCtx,
): void {
  // The first stop is the declaration's own `inspections`; each additional stop follows it in order.
  for (const [index, inspections] of [
    configuration.inspections,
    ...(configuration.additionalStops ?? []).map((stop) => stop.inspections),
  ].entries()) {
    const missingValueInspection = missingValueInspectionMessage(
      inspections,
      index
        ? `configuration.additionalStops[${index - 1}].inspections`
        : 'configuration.inspections',
    )
    if (!missingValueInspection) continue
    context.addIssue({
      code: 'custom',
      path: index
        ? ['additionalStops', index - 1, 'inspections']
        : ['inspections'],
      message: missingValueInspection,
    })
  }
}
