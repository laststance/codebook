/**
 * Reads the first bytes of a server's error response as text and ends the read at the cap, keeping the head of a longer body instead of dropping it.
 *
 * Why it exists: an adapter that quotes the server's own error (Metro's bundle failure) needs the start of a body even when the body is longer than the cap. Called by {@link readServedText} and {@link findSingleBundleUrl} when the profile opts in to quoting.
 * @param response - The non-success response whose body is read.
 * @param limit - The most bytes kept.
 * @returns The first `limit` bytes decoded leniently (a cut multi-byte character becomes U+FFFD); `undefined` when the body cannot be read.
 * @example await readErrorBodyHead(response, 65_536) // => '{"message":"Unable to resolve ./x"}'
 */
export async function readErrorBodyHead(
  response: Response,
  limit: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader()
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    while (reader && total < limit) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value.subarray(0, limit - total))
      total += value.byteLength
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks))
  } catch {
    return undefined
  } finally {
    // A body past the cap (or a stalled one) is cut, not read to its end.
    await reader?.cancel().catch(() => undefined)
  }
}
