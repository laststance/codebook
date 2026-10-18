import { browserAttributeText } from './browserAttributeText'
import { trimMatchingEnds } from './trimMatchingEnds'

/**
 * Reads the address an attribute value holds as a browser follows it: its references read as a browser's tokenizer reads them ({@link browserAttributeText}), then without the spaces and control characters at its ends and without any tab or line break in it, as the URL parser drops them.
 *
 * Why: the Wiki reader rebinds a Codebook address to the serving editor and reads the file and line of the rail's entry from the address a browser opens, whatever form the page writes it in (`vs&#99;ode:`, a leading space, a tab inside the scheme).
 * Called by {@link withServedAddresses} for every link it may rebind, and by {@link rebindDeepWikiEditorLinks} for the entry's link.
 *
 * @param written - The value as the page writes it, without its quotes.
 * @returns The address a browser follows.
 * @example
 * addressAsBrowserReads(' vs&#99;o\tde://laststance.codebook/source?a=1&amp;b=2') // => 'vscode://laststance.codebook/source?a=1&b=2'
 */
export function addressAsBrowserReads(written: string): string {
  return trimMatchingEnds(browserAttributeText(written), /[\x00-\x20]/).replace(
    /[\t\n\r]/g,
    '',
  )
}
