import type { z } from 'zod'

/**
 * Builds the error of a Next manifest that could not be read, naming the manifest file and the reason, never the manifest's content.
 * Called by {@link parseNextManifest} and by the Pages readers ({@link readNextRouteManifests}, {@link readPagesDevelopmentBundle}) for a failed read.
 * @param file - The manifest's workspace-relative path, e.g. `.next/dev/server/pages-manifest.json`.
 * @param reason - Why it could not be read; never text quoted from the manifest.
 * @returns The error, for the run to report as an unexpected manifest failure.
 * @example
 * nextManifestError('.next/dev/build-manifest.json', 'it is not valid JSON').message
 * // => 'Next route manifest .next/dev/build-manifest.json could not be read: it is not valid JSON'
 */
export function nextManifestError(file: string, reason: string): Error {
  return new Error(`Next route manifest ${file} could not be read: ${reason}`)
}

/**
 * Parses one manifest the Next dev server wrote, which is untrusted repository data, against the shape Codebook reads from it.
 * Called by {@link readNextRouteManifests} (routes, App and Pages manifests) and {@link readPagesDevelopmentBundle} (the build manifest). The error never quotes the text: V8's JSON errors quote it, and `routes-manifest.json` holds redirect and rewrite sources.
 * @param file - The manifest's workspace-relative path, named in the error.
 * @param text - The manifest's text.
 * @param schema - The fields Codebook reads; other fields are ignored.
 * @returns The parsed fields.
 * @throws {@link nextManifestError} when the text is not JSON or lacks the fields' shape.
 * @example
 * parseNextManifest('.next/dev/server/pages-manifest.json', '{"/":"pages/index.js"}', z.record(z.string(), z.string()))
 * // => { '/': 'pages/index.js' }
 */
export function parseNextManifest<Schema extends z.ZodType>(
  file: string,
  text: string,
  schema: Schema,
): z.infer<Schema> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw nextManifestError(file, 'it is not valid JSON')
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw nextManifestError(
      file,
      'its content does not have the expected shape',
    )
  return parsed.data
}
