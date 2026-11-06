import { EXPO_WEB_BUNDLER_LINE_MAX_CHARS } from '../constants'

import type { SingleBundleErrorResponse } from './readSingleServedBundle'

/**
 * Picks the one line of Metro's error response that a refusal quotes: its JSON `message`, else the first non-empty line of the body, else the status; masked, on one line and capped.
 *
 * Why it exists: Metro answers a bundle it cannot build with an error response, and the chat must be told why without receiving a page of project text, a secret the message holds, or text it could read as instruction (the refusal quotes it as data). Called by {@link awaitExpoWebBundle}.
 * @param response - What the server answered instead of the bundle or map.
 * @param mask - The run's mask for values and secret shapes in text it keeps.
 * @returns The line, at most {@link EXPO_WEB_BUNDLER_LINE_MAX_CHARS} characters.
 * @example expoWebBundlerLineOf({ status: 500, body: '{"message":"Unable to resolve ./x"}' }, (text) => text) // => 'Unable to resolve ./x'
 */
export function expoWebBundlerLineOf(
  response: SingleBundleErrorResponse,
  mask: (text: string) => string,
): string {
  let message: string | undefined
  try {
    const parsed: unknown = JSON.parse(response.body ?? '')
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed)
      message = typeof parsed.message === 'string' ? parsed.message : undefined
  } catch {
    // Not JSON: the first line of the text below.
  }
  const firstLine = (message ?? response.body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return mask(firstLine ?? `Metro answered status ${response.status}`)
    .replaceAll(/\s+/g, ' ')
    .slice(0, EXPO_WEB_BUNDLER_LINE_MAX_CHARS)
}
