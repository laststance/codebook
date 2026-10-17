import { rebindDeepWikiEditorLinks } from './rebindDeepWikiEditorLinks'

/**
 * Prints a published page as the Wiki reader serves it: with Codebook's addresses bound to the serving editor ({@link rebindDeepWikiEditorLinks}), and the reader's own script, which alone carries the response's nonce, before the end of the body.
 *
 * Why: the reader serves every page with a Content-Security-Policy that lets a script run only with this response's nonce or as the shell's own script, by its hash ({@link WIKI_SHELL_SCRIPT_HASHES}). So script that a page's content carries (an event attribute, a `javascript:` address, also in a Wiki published before the publisher refused them), a script written straight into a page file of the Wiki folder, and a script of an asset that ends in `.html` run nowhere on the reader's origin, whose page may ask the editor's model. No script of the file gets the nonce: the reader cannot tell from the file who wrote it.
 * Called by the Wiki reader for every HTML file it serves.
 *
 * @param html - The file as the Wiki folder holds it.
 * @param options.editorScheme - The scheme registered by the editor serving this request.
 * @param options.nonce - This response's nonce, named by its Content-Security-Policy.
 * @param options.clientAddress - Where the reader serves its own script (`codebook-qa.js` under the reader's path).
 * @param options.publication - The publication the page is served from, which the reader's script compares with the one on disk; `undefined` when none could be read.
 * @returns The page as served.
 * @example
 * servedWikiPageHtml('<body><script>theme()</script></body>', { editorScheme: 'vscode', nonce: 'n1', clientAddress: '/w/t/codebook-qa.js', publication: undefined })
 * // => '<body><script>theme()</script><script nonce="n1" src="/w/t/codebook-qa.js"></script></body>'
 */
export function servedWikiPageHtml(
  html: string,
  options: {
    editorScheme: 'vscode' | 'cursor'
    nonce: string
    clientAddress: string
    publication: string | undefined
  },
): string {
  const { editorScheme, nonce, clientAddress, publication } = options
  // The page carries the publication it was served from, so it can tell when newer pages are on disk.
  const publicationAttribute = publication
    ? ` data-codebook-publication="${publication}"`
    : ''
  return rebindDeepWikiEditorLinks(html, editorScheme).replace(
    '</body>',
    `<script nonce="${nonce}" src="${clientAddress}"${publicationAttribute}></script></body>`,
  )
}
