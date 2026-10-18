import { escapeHtml } from './escapeHtml'
import { rebindDeepWikiEditorLinks } from './rebindDeepWikiEditorLinks'

/**
 * Prints a published page as the Wiki reader serves it: with Codebook's addresses bound to the serving editor ({@link rebindDeepWikiEditorLinks}), and the reader's own script file before the end of the body.
 *
 * The tag goes in before the address filter's last pass, so the page served is the filter's output. The tag stands at the page's first `</body>` as raw text, and that `</body>` can sit inside a quoted value or a script's text: the tag's own quote or `</script>` then ends the value or the script early, and page text that was value or script text becomes markup; the filter reads the page with the tag in it, so it judges that markup too. On such a page the reader's script does not load, as the browser reads its tag as text.
 *
 * Why: the reader serves every page with a Content-Security-Policy that lets a script run only from a file of the reader's own origin (`'self'`) or as the shell's own inline script, by its hash ({@link WIKI_SHELL_SCRIPT_HASHES}). The one file of that origin served as script is the reader's own (`codebook-qa.js`): every response says `nosniff`, and a file of the Wiki folder is never served as script. So script that a page's content carries (an event attribute, a `javascript:` address, also in a Wiki published before the publisher refused them), a script written straight into a page file, a script tag that points at a file of the Wiki folder, and a script of an asset that ends in `.html` run nowhere on the reader's origin, whose page may ask the editor's model. The reader's tag carries no secret a tag left open before it could take over.
 * Both values are printed escaped ({@link escapeHtml}), and the tag is put in by a function, so no text of theirs ends an attribute or is read as a replacement pattern (`$&`).
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
  // The tag goes in after the rail's edits and before the filter reads the page. A function puts it in as it is: a replacement text would read `$&`, `$\`` and `$'` in it as patterns.
  return rebindDeepWikiEditorLinks(html, editorScheme, (editedPage) =>
    editedPage.replace('</body>', (bodyEnd) => `${clientTag}${bodyEnd}`),
  )
}
