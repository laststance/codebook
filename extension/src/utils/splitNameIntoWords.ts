/**
 * Splits an identifier into lowercase words at camelCase humps, `_`, `-`, `.` and spaces.
 * Why: the redaction name rule matches whole words, never substrings; called by {@link isSecretName}.
 * @param name - A variable, property or header name.
 * @returns The words in order, lowercase; empty for a name with no letters or digits.
 * @example
 * splitNameIntoWords('accessToken') // => ['access', 'token']
 * splitNameIntoWords('HTTP_API_KEY') // => ['http', 'api', 'key']
 */
export function splitNameIntoWords(name: string): string[] {
  return (
    name
      // A hump between a lowercase letter or digit and an uppercase letter: `accessToken`.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // The end of an acronym before a word: `APIKey` -> `API Key`.
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase())
  )
}
