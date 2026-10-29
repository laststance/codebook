import type { z } from 'zod'

/**
 * Formats a configuration field path as an agent copies it: `configuration.clicks[0].title`.
 * @param path - The issue's path inside the configuration.
 * @returns The dotted path under `configuration`, array indices in brackets.
 * @example fieldPath(['stops', 0, 'line']) // => 'configuration.stops[0].line'
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

/** Adds a closing full stop when the message has no end punctuation. */
function sentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`
}

/**
 * Words every violation of a refused chrome-extension declaration, each with its field path, so one `INVALID_CONFIGURATION` or `SEED_INVALID` answer lets the agent fix them all.
 * Called by {@link parseChromeExtensionConfiguration} when {@link chromeExtensionConfigSchema} refuses a declaration.
 * @param issues - The schema's issues.
 * @returns One sentence per distinct violation, in the schema's order, then `See codebook://help/chrome-extension.`; a seed sentence is followed by the field to change.
 * @example
 * describeChromeExtensionConfigurationIssues(issues)
 * // => "configuration.clicks[0].title: … See codebook://help/chrome-extension."
 */
export function describeChromeExtensionConfigurationIssues(
  issues: readonly z.core.$ZodIssue[],
): string {
  const sentences = issues.map((issue) => {
    const field = fieldPath(issue.path)
    // A seed edge already names its node; only the field to change is added.
    if (issue.code === 'custom' && issue.path[0] === 'seed')
      return `${issue.message} Change ${field}.`
    return `${field}: ${sentence(issue.message)}`
  })
  return [...new Set(sentences), 'See codebook://help/chrome-extension.'].join(
    ' ',
  )
}
