/**
 * Masks the strings of a JSON source map and serializes it again, so the masked map stays valid JSON.
 *
 * Why it exists: masking the serialized text could cut a JSON escape or a string apart; masking the parsed strings cannot. Called by the run's kept-module copy (`configuredBrowserRun.ts`) for a Vite module's source map.
 *
 * @param text - The map's JSON text.
 * @param maskString - Masks one string value.
 * @returns The original text when no string changed (its bytes stay as served); the re-serialized map otherwise; the masked raw text when the text is not JSON.
 * @example
 * maskSourceMapText('{"names":["secret99"]}', (value) => value.replace('secret99', '[masked]')) // => '{"names":["[masked]"]}'
 */
export function maskSourceMapText(
  text: string,
  maskString: (value: string) => string,
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return maskString(text)
  }
  const masked = JSON.stringify(parsed, (_key, value: unknown) =>
    typeof value === 'string' ? maskString(value) : value,
  )
  return masked === JSON.stringify(parsed) ? text : masked
}
