import { rebindDeepWikiEditorLinks } from './rebindDeepWikiEditorLinks'

/** The start of a script element in a page as the publisher printed it: `<script` before the space, slash or bracket that ends the tag's name. */
const SCRIPT_START = /<script(?=[\t\n\f\r />])/gi

/**
 * Prints a published page as the Wiki reader serves it: with Codebook's addresses bound to the serving editor ({@link rebindDeepWikiEditorLinks}), the response's nonce on the scripts the reader trusts, and the reader's own script before the end of the body.
 *
 * Why: the reader serves every page with a Content-Security-Policy that lets a script run only with this response's nonce, so script that a page's content carries (an event attribute, a `javascript:` address, also in a Wiki published before the publisher refused them) does not run on the reader's origin, whose page may ask the editor's model. The scripts the reader trusts are its own and, on a page the publisher rendered from its shell, the shell's: the publisher has refused `<script` anywhere in a page's content since its first build (0.2.12.0), in a comment and an attribute value too, so every script element of such a page is the shell's. A file of the Wiki that is no page of its manifest (an asset that ends in `.html`) was never rendered from the shell, so none of its own scripts gets the nonce.
 * Called by the Wiki reader for every HTML file it serves.
 *
 * @param html - The file as the Wiki folder holds it.
 * @param options.editorScheme - The scheme registered by the editor serving this request.
 * @param options.nonce - This response's nonce, named by its Content-Security-Policy.
 * @param options.isShellPage - Whether the file is a page of the manifest, which the publisher rendered from its shell.
 * @param options.clientAddress - Where the reader serves its own script (`codebook-qa.js` under the reader's path).
 * @param options.publication - The publication the page is served from, which the reader's script compares with the one on disk; `undefined` when none could be read.
 * @returns The page as served.
 * @example
 * servedWikiPageHtml('<body><script>theme()</script></body>', { editorScheme: 'vscode', nonce: 'n1', isShellPage: true, clientAddress: '/w/t/codebook-qa.js', publication: undefined })
 * // => '<body><script nonce="n1">theme()</script><script nonce="n1" src="/w/t/codebook-qa.js"></script></body>'
 */
export function servedWikiPageHtml(
  html: string,
  options: {
    editorScheme: 'vscode' | 'cursor'
    nonce: string
    isShellPage: boolean
    clientAddress: string
    publication: string | undefined
  },
): string {
  const { editorScheme, nonce, isShellPage, clientAddress, publication } =
    options
  const boundPage = rebindDeepWikiEditorLinks(html, editorScheme)
  // Only a page rendered from the shell has scripts the reader trusts.
  const trustedPage = isShellPage
    ? boundPage.replace(SCRIPT_START, `<script nonce="${nonce}"`)
    : boundPage
  // The page carries the publication it was served from, so it can tell when newer pages are on disk.
  const publicationAttribute = publication
    ? ` data-codebook-publication="${publication}"`
    : ''
  return trustedPage.replace(
    '</body>',
    `<script nonce="${nonce}" src="${clientAddress}"${publicationAttribute}></script></body>`,
  )
}
