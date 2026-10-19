import { escapeHtml } from './escapeHtml'
import { rebindDeepWikiEditorLinks } from './rebindDeepWikiEditorLinks'

/**
 * Prints a published page as the Wiki reader serves it: with Codebook's addresses bound to the serving editor ({@link rebindDeepWikiEditorLinks}), and the reader's own script file at the end of the body.
 *
 * The address filter puts the tag in by its own pass, at the `</body>` the parser took as the body's end, as a browser reads the page ({@link withServedAddresses}): a `</body>` in a comment, a quoted value or a script's text stays text, and one written `</BODY>` is the body's end, so the script loads and shows the update state and the notice of newer pages. A page without such an end gets the tag at its end, and the filter reads the page with the tag in it, so the page served is always the filter's output. Where svg or MathML content is open at the tag's place, a meta that leaves it goes in first, so the tag is an HTML script there too and not an svg or MathML element, which would load nothing.
 *
 * Why: the reader serves every page with a Content-Security-Policy that lets a script run only from a file of the reader's own origin (`'self'`) or as the shell's own inline script, by its hash ({@link WIKI_SHELL_SCRIPT_HASHES}). The one file of that origin served as script is the reader's own (`codebook-qa.js`): every response says `nosniff`, and a file of the Wiki folder is never served as script. So script that a page's content carries (an event attribute, a `javascript:` address, also in a Wiki published before the publisher refused them), a script written straight into a page file, a script tag that points at a file of the Wiki folder, and a script of an asset that ends in `.html` run nowhere on the reader's origin, whose page may ask the editor's model. The reader's tag carries no secret a tag left open before it could take over.
 * Both values are printed escaped ({@link escapeHtml}), and the tag is put in as it is, so no text of theirs ends an attribute or is read as a replacement pattern (`$&`).
 * Called by the Wiki reader for every HTML file it serves.
 *
 * @param html - The file as the Wiki folder holds it.
 * @param options.editorScheme - The scheme registered by the editor serving this request.
 * @param options.clientAddress - Where the reader serves its own script (`codebook-qa.js` under the reader's path).
 * @param options.publication - The publication the page is served from, which the reader's script compares with the one on disk; `undefined` when none could be read.
 * @returns The page as served.
 * @example
 * servedWikiPageHtml('<body><script>theme()</script></body>', { editorScheme: 'vscode', clientAddress: '/w/t/codebook-qa.js', publication: undefined })
 * // => '<body><script>theme()</script><script src="/w/t/codebook-qa.js"></script></body>'
 */
export function servedWikiPageHtml(
  html: string,
  options: {
    editorScheme: 'vscode' | 'cursor'
    clientAddress: string
    publication: string | undefined
  },
): string {
  const { editorScheme, clientAddress, publication } = options
  // The page carries the publication it was served from, so it can tell when newer pages are on disk.
  const publicationAttribute = publication
    ? ` data-codebook-publication="${escapeHtml(publication)}"`
    : ''
  const clientTag = `<script src="${escapeHtml(clientAddress)}"${publicationAttribute}></script>`
  // The filter puts the tag in at the body's end after the rail's edits, as it is: no text of the tag is read as a pattern.
  return rebindDeepWikiEditorLinks(html, editorScheme, clientTag)
}
