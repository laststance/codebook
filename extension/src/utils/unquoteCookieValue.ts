/**
 * Removes the surrounding double quotes of a quoted cookie value.
 *
 * Why it exists: a server may quote a cookie value (`sid="abc"`) and echo it with or without the quotes; {@link cookieMaskValues} masks both.
 * @param value - The cookie value as the server set it.
 * @returns The value without one pair of surrounding double quotes; the value itself when it is not quoted.
 * @example
 * unquoteCookieValue('"abc"') // => 'abc'
 * unquoteCookieValue('abc') // => 'abc'
 */
export function unquoteCookieValue(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}
