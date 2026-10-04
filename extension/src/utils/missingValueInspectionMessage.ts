import type { RepositoryInspection } from '../repositoryConfigSchemas'

/**
 * Words why a declared stop breaks the rule that every stop needs one required value inspection, for the refinements of {@link repositoryConfigSchema}, {@link crossRuntimeRepositoryConfigSchema} and {@link nodeTestConfigSchema}; the text reaches an agent as the refusal of `codebook_start`.
 * It names the stop by its configuration path, what the stop declares and what to add, without knowledge of the repository under study.
 * @param inspections - The stop's declared inspections.
 * @param configurationPath - Where the configuration holds them: `configuration.inspections` for the first stop, `configuration.additionalStops[<i>].inspections` for a later one.
 * @returns
 * - `undefined` when the stop declares a required value inspection
 * - The sentence that lists the stop's type inspections when every inspection it declares is of mode `type`
 * - The general sentence otherwise (a value inspection is declared, but none is required)
 * @example
 * missingValueInspectionMessage([{ path: 'form', mode: 'type', required: true }], 'configuration.inspections')
 * // => 'configuration.inspections: this stop declares only type inspections (type:form). Add one required value inspection of a primitive the stop can read, for example a member of one of these objects; type inspections may stay beside it.'
 * missingValueInspectionMessage([{ path: 'count', mode: 'value', required: false }], 'configuration.inspections')
 * // => 'At least one required value inspection is needed.'
 */
export function missingValueInspectionMessage(
  inspections: readonly RepositoryInspection[],
  configurationPath: string,
): string | undefined {
  if (
    inspections.some(
      (inspection) => inspection.required && inspection.mode === 'value',
    )
  )
    return undefined
  // A stop that declares value inspections, none of them required, keeps the general sentence.
  if (inspections.some((inspection) => inspection.mode === 'value'))
    return 'At least one required value inspection is needed.'
  const declared = inspections
    .map((inspection) => `type:${inspection.path}`)
    .join(', ')
  return `${configurationPath}: this stop declares only type inspections (${declared}). Add one required value inspection of a primitive the stop can read, for example a member of one of these objects; type inspections may stay beside it.`
}
