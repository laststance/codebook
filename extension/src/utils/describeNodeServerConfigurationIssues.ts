import type { z } from 'zod'

/**
 * Formats a configuration field path as an agent copies it: `configuration.request.path`, `configuration.additionalStops[0].inspections`.
 * @param path - The issue's path inside the configuration.
 * @returns The dotted path under `configuration`, array indices in brackets.
 * @example fieldPath(['additionalStops', 0, 'inspections']) // => 'configuration.additionalStops[0].inspections'
 */
function fieldPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (written, segment) =>
      typeof segment === 'number'
        ? `${written}[${segment}]`
        : `${written}.${String(segment)}`,
    'configuration',
  )
}

/**
 * Words every violation of a refused node-server declaration, each with its field path and the expected value or range, and names the profile's help, so that one `INVALID_CONFIGURATION` answer lets the agent fix all of them before its next start.
 * Called by the node-server start when {@link nodeServerConfigSchema} refuses a declaration.
 * @param issues - The schema's issues for the declaration.
 * @returns One sentence per distinct violation (`configuration.<field>: <expectation>`), in the schema's order, then `See codebook://help/node-server.`
 * @example
 * describeNodeServerConfigurationIssues(nodeServerConfigSchema.safeParse({ ...declaration, port: 80 }).error.issues)
 * // => "configuration.port: expected an integer from 1024 to 65535, the port the server's own code listens on. See codebook://help/node-server."
 */
export function describeNodeServerConfigurationIssues(
  issues: readonly z.core.$ZodIssue[],
): string {
  const sentences = issues.map((issue) => {
    const field = fieldPath(issue.path)
    // A message that already names its field (the stop inspection rule's) is not prefixed twice.
    const message = issue.message.startsWith(`${field}: `)
      ? issue.message.slice(field.length + 2)
      : issue.message
    return `${field}: ${/[.!?]$/.test(message) ? message : `${message}.`}`
  })
  return [...new Set(sentences), 'See codebook://help/node-server.'].join(' ')
}
