import { maskLearnerSecretData } from './maskLearnerSecretData'
import { maskLearnerSecretText } from './maskLearnerSecretText'

/**
 * Masks the learner's secrets in a text that may be a serialized JSON object or array, keeping it parseable.
 *
 * Why it exists: masking the serialized text replaces a secret equal to a JSON token (`true`) or to part of an identifier inside the syntax itself, so the answer no longer parses or its `runUri` stops working. Called by {@link maskToolResult} for a tool answer's text and by the MCP resource read for a JSON resource.
 * A text that is no JSON object or array is masked as text ({@link maskLearnerSecretText}). A JSON text with no secret in it is returned byte for byte.
 * @param text - A tool or resource text.
 * @param secrets - The learner's secrets of every live run.
 * @returns The masked text; JSON text is produced from the masked structure, indented like the original (two spaces when it spans lines).
 * @example
 * maskLearnerSecretJsonText('{"ok":true}', new Set(['true'])) // => '{"ok":true}'
 */
export function maskLearnerSecretJsonText(
  text: string,
  secrets: ReadonlySet<string>,
): string {
  if (secrets.size === 0) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return maskLearnerSecretText(text, secrets)
  }
  // A bare string, number or literal is text a source file may hold; only a structure is masked as data.
  if (parsed === null || typeof parsed !== 'object')
    return maskLearnerSecretText(text, secrets)
  const masked = maskLearnerSecretData(parsed, secrets)
  if (JSON.stringify(masked) === JSON.stringify(parsed)) return text
  return JSON.stringify(masked, null, text.includes('\n') ? 2 : undefined)
}
