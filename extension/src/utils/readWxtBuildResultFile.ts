import { readFile } from 'node:fs/promises'

import { z } from 'zod'

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), wxtVersion: z.string() }),
  z.object({ ok: z.literal(false), message: z.string() }),
])

/** What the build script wrote to its result file. */
export type WxtBuildResultFile = z.infer<typeof resultSchema>

/**
 * Reads the JSON result file the WXT build script writes.
 * Called by {@link buildWxtExtension} after the build's tree ended.
 * @param resultFile - The result file's path.
 * @returns The parsed result, or `undefined` when the file is missing or does not parse (the script crashed).
 * @example
 * await readWxtBuildResultFile('/tmp/run/wxt-build-result.json') // => { ok: true, wxtVersion: '0.21.4' }
 */
export async function readWxtBuildResultFile(
  resultFile: string,
): Promise<WxtBuildResultFile | undefined> {
  try {
    return resultSchema.parse(JSON.parse(await readFile(resultFile, 'utf8')))
  } catch {
    return undefined
  }
}
