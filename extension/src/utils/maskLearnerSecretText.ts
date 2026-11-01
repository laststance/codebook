import { maskRunSecrets } from './maskRunSecrets'

/**
 * Masks the learner's run secrets in a sentence, also where a JSON string escaped them.
 *
 * Why it exists: an error sentence, an Output line or a JSON resource body may quote a secret that holds a quote, a backslash or a line break in its escaped form, which an exact match of the raw secret would miss (ENG-4). Called by {@link ConfiguredBrowserRun} for its failures and Output lines, by {@link StudyService} for the causes it words and the lines it writes, and by the MCP protocol for resource text.
 * @param text - Any text that may hold a copy of a secret.
 * @param secrets - The learner's secrets of one run or of every live run; empty strings are ignored.
 * @returns The text with every secret, raw or JSON-escaped, replaced by the redaction mask; the text itself when there is no secret.
 * @example
 * maskLearnerSecretText('failed for "p\\"w"', new Set(['p"w'])) // => 'failed for "[masked]"'
 */
export function maskLearnerSecretText(
  text: string,
  secrets: ReadonlySet<string>,
): string {
  if (secrets.size === 0) return text
  const withEscapes = new Set(secrets)
  for (const secret of secrets)
    if (secret.length > 0) withEscapes.add(JSON.stringify(secret).slice(1, -1))
  return maskRunSecrets(text, withEscapes)
}
