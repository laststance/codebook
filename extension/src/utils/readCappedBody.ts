/**
 * Reads a response body whole as UTF-8, ending the read as soon as it passes the byte cap, so a server cannot make Codebook hold more than the cap.
 *
 * Called by {@link readViteServedModule} for a served Vite module and by {@link nextServedChunkFetcher} for a Next chunk the owned server serves.
 * @param response - The response whose body is read.
 * @param limit - The most bytes the body may have.
 * @returns The text, or `undefined` when the body passes the cap (the read is cancelled then).
 * @throws When the bytes are not valid UTF-8.
 * @example
 * await readCappedBody(response, 1_024) // => 'export const theme = "dark"'
 */
export async function readCappedBody(
  response: Response,
  limit: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}
