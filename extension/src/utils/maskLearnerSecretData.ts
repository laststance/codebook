import { sha256 } from '../runtimeSupport/utils/sha256'

import { expandLearnerSecretForms } from './expandLearnerSecretForms'
import { maskRunSecretsDeep } from './maskRunSecrets'

/** Whether a record is a sealed source: its `hash` is the SHA-256 of its string `text`, so masking it would break the seal. */
function isSealedSourceRecord(record: object): boolean {
  const candidate = record as { text?: unknown; hash?: unknown }
  return (
    typeof candidate.text === 'string' &&
    typeof candidate.hash === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.hash) &&
    sha256(candidate.text) === candidate.hash
  )
}

/**
 * Masks the learner's run secrets in every string of a JSON-like value that a run stores or serves.
 *
 * Why it exists: the evidence journal, `runtime.json`, the saved study and every MCP answer hold nested run data; a value the learner typed has no recognizable shape, so it can only be hidden by its value (ENG-4). Called by {@link Evidence} for each event and saved file, by {@link ConfiguredBrowserRun} for the data it serves, by {@link captureStudy} and by the MCP protocol for each answer.
 * A sealed source (a record with a string `text` and a string `hash`) is kept as it is: the code is bound by its hash and holds no run data.
 * @param value - A JSON-like value; a class instance, a `Date` or `undefined` is returned unchanged only when there is no secret.
 * @param secrets - The learner's secrets of one run or of every live run.
 * @returns A masked copy; the value itself when there is no secret.
 * @example
 * maskLearnerSecretData({ message: 'login failed for hunter2' }, new Set(['hunter2'])) // => { message: 'login failed for [masked]' }
 */
export function maskLearnerSecretData<T>(
  value: T,
  secrets: ReadonlySet<string>,
): T {
  if (secrets.size === 0 || value === undefined) return value
  // Round-trip first so a value with a method such as `toJSON` is masked in the form it is written.
  const plain = JSON.parse(JSON.stringify(value)) as T
  // URL-encoded and HTML-escaped copies (a page URL, a location fact) are masked like the raw value.
  return maskRunSecretsDeep(
    plain,
    expandLearnerSecretForms(secrets, false),
    isSealedSourceRecord,
  )
}
