import { REDACTION_MASK } from '../constants'

/** Lists the non-empty secrets, longest first, so a secret inside another leaves no fragment. */
function orderedSecrets(secrets: ReadonlySet<string>): string[] {
  return [...secrets]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
}

/**
 * Replaces every exact occurrence of each run secret in a text by the redaction mask.
 *
 * Why it exists: a value the learner typed through ask-learner has no recognizable shape, so a copy of it in a preview, an error message or a log can only be hidden by its value (ENG-4). Called by every serialization of a run (inspection values, debugger previews, errors, MCP results, saved studies) through {@link maskRunSecretsDeep}.
 * @param text - Any text that may hold a copy of a secret.
 * @param secrets - The run-scoped secret values; empty strings are ignored.
 * @returns The text with each secret replaced; the longest secret is replaced first.
 * @example
 * maskRunSecrets('failed for hunter2', new Set(['hunter2'])) // => 'failed for [masked]'
 */
export function maskRunSecrets(
  text: string,
  secrets: ReadonlySet<string>,
): string {
  let masked = text
  for (const secret of orderedSecrets(secrets))
    masked = masked.split(secret).join(REDACTION_MASK)
  return masked
}

/**
 * Masks the run secrets in every string of a JSON-like value.
 *
 * Why it exists: results, snapshots and saved records are nested objects and arrays; this walks them once. Keys are left alone, except that a key that equals a secret is masked too, because the key is itself a copy of the secret.
 * @param value - A JSON-like value: string, number, boolean, null, array or plain object.
 * @param secrets - The run-scoped secret values; empty strings are ignored.
 * @returns A copy with each string value masked; non-string leaves are returned as they are.
 * @example
 * maskRunSecretsDeep({ items: ['a hunter2 b'] }, new Set(['hunter2'])) // => { items: ['a [masked] b'] }
 */
export function maskRunSecretsDeep<T>(
  value: T,
  secrets: ReadonlySet<string>,
): T {
  return maskValue(value, secrets, orderedSecrets(secrets)) as T
}

function maskValue(
  value: unknown,
  secrets: ReadonlySet<string>,
  ordered: readonly string[],
): unknown {
  if (typeof value === 'string')
    return ordered.length ? maskRunSecrets(value, secrets) : value
  if (Array.isArray(value))
    return value.map((entry) => maskValue(entry, secrets, ordered))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        // A key equal to a secret is a copy of it; any other key stays readable.
        secrets.has(key) && key.length > 0 ? REDACTION_MASK : key,
        maskValue(entry, secrets, ordered),
      ]),
    )
  return value
}
