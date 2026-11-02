import { z } from 'zod'

/**
 * The marker of the module a Next webpack server compile emits for a `'use client'` file in its `(rsc)` layer.
 *
 * Fixed from the spike's real chunks of Next 16.1.4 and 16.3.4 (Issue 179, version 2.1 comment, C5): the module text calls `registerClientReference` (emitted as `(0,x.registerClientReference)(`), and its inline source map names the single source `…/__nextjs-internal-proxy.mjs` instead of the original file.
 */
const NEXT_CLIENT_REFERENCE_STUB_MARKER = {
  registerCall: /registerClientReference\)?\(/,
  mapSourceSuffix: '/__nextjs-internal-proxy.mjs',
} as const

const inlineMapPattern =
  /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z\d+/=]+)$/gm

const mapSourcesSchema = z.object({ sources: z.array(z.string()) })

/**
 * Tells whether an evaluated `(rsc)` module is only a client reference stub: the server holds a reference to a `'use client'` file, never its code.
 *
 * Why it exists: such a stub carries the file's script address but not its original, so sealing it as a server stop would fail with a misleading mapping error; {@link readDevelopmentBundle} refuses it with the client-component reason instead. Called by {@link findNextClientReferenceStub} for each module of the entry route's server chunk.
 * @param moduleText - One decoded module text ({@link evaluatedModuleTexts}).
 * @returns `true` when the text calls `registerClientReference` and every source of an inline map ends with the proxy suffix.
 * @example
 * isNextClientReferenceStub(stubText) // => true
 * isNextClientReferenceStub(serverComponentText) // => false
 */
export function isNextClientReferenceStub(moduleText: string): boolean {
  if (!NEXT_CLIENT_REFERENCE_STUB_MARKER.registerCall.test(moduleText))
    return false
  for (const match of moduleText.matchAll(inlineMapPattern)) {
    let parsedMap: unknown
    try {
      parsedMap = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8'))
    } catch {
      continue
    }
    const parsed = mapSourcesSchema.safeParse(parsedMap)
    if (
      parsed.success &&
      parsed.data.sources.length > 0 &&
      parsed.data.sources.every((source) =>
        source.endsWith(NEXT_CLIENT_REFERENCE_STUB_MARKER.mapSourceSuffix),
      )
    )
      return true
  }
  return false
}
