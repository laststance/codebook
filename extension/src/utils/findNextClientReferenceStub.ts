import { isNextClientReferenceStub } from './isNextClientReferenceStub'
import { sameScriptUrl } from './sameScriptUrl'

/**
 * Finds the client reference stub the `(rsc)` layer holds for one script address.
 *
 * Why it exists: a file with `'use client'` has an `(rsc)` module that is only a stub, so a server stop in it can never run on the server. Called by {@link readDevelopmentBundle} after the `(action-browser)` layer did not hold the file.
 * @param moduleTexts - The decoded modules of the entry route's server chunk.
 * @param rscScriptUrl - The `webpack-internal:///(rsc)/./<path>` address of the stop's file.
 * @returns `true` when a module with that address is a client reference stub.
 * @example
 * findNextClientReferenceStub(texts, 'webpack-internal:///(rsc)/./app/ui/search.tsx') // => true for a 'use client' file
 */
export function findNextClientReferenceStub(
  moduleTexts: readonly string[],
  rscScriptUrl: string,
): boolean {
  return moduleTexts.some((moduleText) => {
    const urls = [...moduleText.matchAll(/^\/\/# sourceURL=(.+)$/gm)]
    return (
      urls.length > 0 &&
      sameScriptUrl(rscScriptUrl, urls.at(-1)![1]!) &&
      isNextClientReferenceStub(moduleText)
    )
  })
}
