import { UNICODE_LAST_CODE_POINT } from '../constants'

import { addressAsBrowserReads } from './addressAsBrowserReads'
import { browserAttributeText } from './browserAttributeText'
import { escapeHtml } from './escapeHtml'
import { type HtmlAttribute, readHtmlStartTags } from './readHtmlStartTags'
import { trimMatchingEnds } from './trimMatchingEnds'

/** The attributes whose value is an address: the ones the publisher holds to its schemes (`ADDRESS_ATTRIBUTES` of `render-wiki-diagrams.mjs`), `cite`, the source of a quote, among them. A test holds the two sets alike. */
const ADDRESS_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'srcset',
  'cite',
])
/** The schemes an address may name for any place, as the publisher accepts them (`ADDRESS_SCHEMES` of `render-wiki-diagrams.mjs`): the web's and mail's. */
const ADDRESS_SCHEMES = new Set(['http', 'https', 'mailto'])
/** The starts of Codebook's own addresses, in lower case: the publisher compares a scheme and an authority without case, as a browser does (`CODEBOOK_ADDRESS_STARTS` of `render-wiki-diagrams.mjs`). */
const CODEBOOK_ADDRESS_STARTS = [
  'vscode://laststance.codebook/',
  'cursor://laststance.codebook/',
]
/** The character references the publisher reads in an attribute value (`CHARACTER_REFERENCE` of `render-wiki-diagrams.mjs`): a decimal or hexadecimal number and the five names it writes, each with its semicolon. */
const CHARACTER_REFERENCE =
  /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g
/** The characters of the five names of {@link CHARACTER_REFERENCE}. */
const NAMED_CHARACTERS: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}
/** What no address may hold, as the publisher refuses it (`REFUSED_IN_ANY_ADDRESS` of `render-wiki-diagrams.mjs`): a number reference left after the ones read, which a browser reads as a colon wherever it stands, or two slashes or backslashes in any mix at the start, which a page opened from disk on Windows reads as a network path. */
const REFUSED_IN_ANY_ADDRESS = /&#|^[/\\]{2}/
/** A named reference with its semicolon before the first slash, question mark or number sign of an address without a scheme, which a browser may read as a colon or a tab (`&colon;`, `&Tab;`). */
const UNREAD_NAMED_REFERENCE = /&[A-Za-z][A-Za-z0-9]*;/
/** The values of an svg animation's `attributeName` that change the address of the element it animates, so the animation would give a link an address the filter never saw. */
const ANIMATED_ADDRESSES = new Set(['href', 'xlink:href'])
/** The attributes by which a browser navigates, where a Codebook address is bound to the serving editor: a link's, an svg link's, a form's and a button's form action. */
const REBOUND_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'action',
  'formaction',
])
/** The start of a value that writes Codebook's address plainly, in any case: the scheme the rebinding replaces in place. */
const CODEBOOK_ADDRESS_AS_WRITTEN =
  /^(?:vscode|cursor)(?=:\/\/laststance\.codebook\/)/i
/** The rename of an attribute that loses its effect: a data attribute, which no browser follows or acts on. */
const UNLINKED_NAME = 'data-codebook-unlinked'

/**
 * The character a reference of {@link CHARACTER_REFERENCE} names, as the publisher reads it; called by {@link attributeText} for each.
 * @param _reference - The reference as written.
 * @param decimal - The digits of a decimal number, when it is one.
 * @param hexadecimal - The digits of a hexadecimal number, when it is one.
 * @param name - The name, when it is one of {@link NAMED_CHARACTERS}.
 * @returns The character; the replacement character for a number that names none.
 * @example
 * referencedCharacter('&#99;', '99', undefined, undefined) // => 'c'
 * referencedCharacter('&amp;', undefined, undefined, 'amp') // => '&'
 */
function referencedCharacter(
  _reference: string,
  decimal?: string,
  hexadecimal?: string,
  name?: string,
): string {
  if (name !== undefined) return NAMED_CHARACTERS[name] ?? ''
  const codePoint =
    decimal === undefined
      ? Number.parseInt(hexadecimal ?? '', 16)
      : Number.parseInt(decimal, 10)
  return codePoint > 0 && codePoint <= UNICODE_LAST_CODE_POINT
    ? String.fromCodePoint(codePoint)
    : '�'
}

/**
 * Reads an attribute value as the publisher reads it (`attributeText` of `render-wiki-diagrams.mjs`): every character reference of {@link CHARACTER_REFERENCE} becomes its character. Called by {@link isRefusedAttribute}.
 * @param value - The value as the page writes it.
 * @returns The value's text.
 * @example
 * attributeText('vs&#99;ode://file/a') // => 'vscode://file/a'
 */
function attributeText(value: string): string {
  return value.replace(CHARACTER_REFERENCE, referencedCharacter)
}

/**
 * The addresses one attribute value holds, as the publisher splits them (`addressesOf` of `render-wiki-diagrams.mjs`): for `srcset` the address of each candidate, split at every comma; the whole value otherwise. Called by {@link isRefusedAttribute}.
 * @param name - The attribute's name in lower case.
 * @param text - The value's text, its references read ({@link attributeText}).
 * @returns The addresses.
 * @example
 * addressesOf('srcset', 'a.png 1x, data:image/png,x 2x') // => ['a.png', 'data:image/png', 'x']
 */
function addressesOf(name: string, text: string): string[] {
  return name === 'srcset'
    ? text
        .split(',')
        .map((candidate) => candidate.trim().split(/[\t\n\f\r ]/)[0] ?? '')
    : [text]
}

/**
 * Whether the publisher accepts one address today (`isAcceptedAddress` of `render-wiki-diagrams.mjs`), read as a browser reads it: without the spaces and control characters at its ends and without any tab or line break in it. Accepted are a relative path and a `#fragment` (no colon before the first slash, question mark or number sign, and no named reference there), an `http`, `https` or `mailto` address, and Codebook's own editor address ({@link CODEBOOK_ADDRESS_STARTS}); never one of {@link REFUSED_IN_ANY_ADDRESS}. Called by {@link isRefusedAttribute}.
 * @param address - One address, its references read.
 * @returns Whether a page may keep it as a link.
 * @example
 * isAcceptedAddress('pages/a.html#start')                       // => true
 * isAcceptedAddress('VSCode://LastStance.Codebook/source?a=1')  // => true
 * isAcceptedAddress('vscode-insiders://file/etc/hosts')         // => false
 * isAcceptedAddress('\\\\host\\share\\x.png')                   // => false
 */
function isAcceptedAddress(address: string): boolean {
  const read = trimMatchingEnds(address, /[\x00-\x20]/).replace(/[\t\n\r]/g, '')
  const [head = ''] = read.split(/[/?#]/)
  const schemeEnd = head.indexOf(':')
  if (REFUSED_IN_ANY_ADDRESS.test(read)) return false
  // Without a colon in its first part the address is a path or a fragment.
  if (schemeEnd === -1) return !UNREAD_NAMED_REFERENCE.test(head)
  const lowered = read.toLowerCase()
  return (
    ADDRESS_SCHEMES.has(head.slice(0, schemeEnd).toLowerCase()) ||
    CODEBOOK_ADDRESS_STARTS.some((start) => lowered.startsWith(start))
  )
}

/**
 * Whether an address attribute holds an address that the publisher refuses today, read either as the publisher reads it ({@link attributeText}) or as a browser does ({@link browserAttributeText}); called by {@link isRefusedAttribute}.
 * @param name - The attribute's name in lower case, one of {@link ADDRESS_ATTRIBUTES}.
 * @param written - The value as the page writes it.
 * @returns Whether one of its addresses is refused by either reading.
 * @example
 * isRefusedAddress('src', '/&sol;host/x') // => true: a browser reads `//host/x`
 */
function isRefusedAddress(name: string, written: string): boolean {
  return [attributeText(written), browserAttributeText(written)].some(
    (text) => !addressesOf(name, text).every(isAcceptedAddress),
  )
}

/**
 * Whether one attribute, as a browser reads it ({@link readHtmlStartTags}), has to lose its effect, its value read as a browser reads it ({@link browserAttributeText}):
 * - an address attribute ({@link ADDRESS_ATTRIBUTES}) that holds an address the publisher refuses today ({@link isRefusedAddress});
 * - an `http-equiv` of `refresh`, by which a page moves the browser to another address by itself;
 * - a `srcdoc`, whose value is a whole page of its own that the filter does not read;
 * - an svg animation's `attributeName` of `href` or `xlink:href` ({@link ANIMATED_ADDRESSES}), which gives a link the address of its `to`, `from`, `by` or `values`.
 * Called by {@link editOf}.
 * @param attribute - The attribute: its name in lower case and its value as written.
 * @returns Whether the attribute is renamed.
 * @example
 * isRefusedAttribute({ name: 'http-equiv', written: '&#114efresh', … }) // => true
 */
function isRefusedAttribute(attribute: HtmlAttribute): boolean {
  const { name } = attribute
  const written = attribute.written ?? ''
  const keyword = browserAttributeText(written).trim().toLowerCase()
  if (name === 'srcdoc') return true
  if (name === 'http-equiv') return keyword === 'refresh'
  if (name === 'attributename') return ANIMATED_ADDRESSES.has(keyword)
  return ADDRESS_ATTRIBUTES.has(name) && isRefusedAddress(name, written)
}

/** An edit of a served page: the span it replaces and the text it puts there. */
type Edit = { start: number; end: number; text: string }

/**
 * Binds a Codebook address to the editor that serves the page, as a browser reads it ({@link addressAsBrowserReads}), in an attribute a browser navigates with ({@link REBOUND_ATTRIBUTES}); called by {@link editOf} for an attribute it keeps.
 *
 * A value that starts with Codebook's address as written gets the serving editor's scheme in place, so its authority, route and case stay as written. Any other form a browser reads as such an address (`vs&#99;ode:`, a leading space or control character, a tab inside the scheme) is written anew, quoted and escaped, as the address a browser reads with the serving editor's scheme.
 *
 * @param attribute - The attribute, as {@link readHtmlStartTags} read it.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The edit; `undefined` for an attribute that holds no Codebook address.
 * @example
 * reboundAddressOf({ name: 'href', written: 'vs&#99;ode://laststance.codebook/update?root=%2Fr', valueStart: 8, valueEnd: 59, … }, 'cursor')
 * // => { start: 8, end: 59, text: '"cursor://laststance.codebook/update?root=%2Fr"' }
 */
function reboundAddressOf(
  attribute: HtmlAttribute,
  editorScheme: 'vscode' | 'cursor',
): Edit | undefined {
  const { written } = attribute
  if (written === undefined || !REBOUND_ATTRIBUTES.has(attribute.name))
    return undefined
  const address = addressAsBrowserReads(written)
  const lowered = address.toLowerCase()
  if (!CODEBOOK_ADDRESS_STARTS.some((start) => lowered.startsWith(start)))
    return undefined
  // A value with its quotes is two characters longer than the value as written.
  const valueAt =
    attribute.valueStart +
    (attribute.valueEnd - attribute.valueStart > written.length ? 1 : 0)
  return CODEBOOK_ADDRESS_AS_WRITTEN.test(written)
    ? { start: valueAt, end: valueAt + editorScheme.length, text: editorScheme }
    : {
        start: attribute.valueStart,
        end: attribute.valueEnd,
        text: `"${escapeHtml(editorScheme + address.slice(editorScheme.length))}"`,
      }
}

/**
 * The edit one attribute of a served page gets: a refused one loses its effect by its name ({@link isRefusedAttribute}), and a kept one that holds a Codebook address is bound to the serving editor ({@link reboundAddressOf}); called by {@link withServedAddresses}.
 * @param attribute - The attribute.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The attribute's edits, none for an attribute served as written.
 * @example
 * editOf({ name: 'href', written: 'javascript:run()', nameStart: 3, nameEnd: 7, … }, 'vscode') // => [{ start: 3, end: 7, text: 'data-codebook-unlinked' }]
 */
function editOf(
  attribute: HtmlAttribute,
  editorScheme: 'vscode' | 'cursor',
): Edit[] {
  if (isRefusedAttribute(attribute))
    return [
      {
        start: attribute.nameStart,
        end: attribute.nameEnd,
        text: UNLINKED_NAME,
      },
    ]
  const rebound = reboundAddressOf(attribute, editorScheme)
  return rebound ? [rebound] : []
}

/**
 * Serves a page's addresses as the reader may serve them, in one pass over the page: it keeps only the addresses the publisher accepts today and takes the effect from every other one while its text stays, and it binds every Codebook address to the editor that serves the page.
 *
 * Refused are an address of another scheme (`javascript:`, `data:`, `file:`, `vscode-insiders:`, an editor address that is not Codebook's own …), a refresh (`<meta http-equiv="refresh">`), a frame's own page (`srcdoc`) and an svg animation of an address, each read as a browser reads its value ({@link isRefusedAttribute}). The attribute's name becomes `data-codebook-unlinked`, so the element and its value stay and a browser follows nothing. A Codebook address in a link, a form's action or a button's form action gets the serving editor's scheme, in whatever form a browser reads it ({@link reboundAddressOf}).
 *
 * Why: the reader serves pages of any age. A Wiki published before the publisher refused such addresses, or a page written straight into the Wiki folder, may carry one. In the editor's browser an editor address opens a file or runs another extension, often without a question once the learner allowed the editor's scheme for Codebook's own links; a refresh moves the page to such an address without a click, and the page's policy does not stop it. The rule is the publisher's (`isAcceptedAddress` of `render-wiki-diagrams.mjs`), so a page reads alike published today and served. One published site works in both editors, as each binds Codebook's addresses to itself.
 * How: the page is read once, as a browser reads it ({@link readHtmlStartTags}): the attributes of its start tags are judged, and a comment, a script's or a style's text and any other text are served as published. A refused attribute's name is replaced by letters and hyphens, and a rebound value keeps its place, so the page is read as before. The time grows with the page's size alone.
 * Called by {@link rebindDeepWikiEditorLinks} last, for every page the reader serves, so the page served is this function's output.
 *
 * @param html - The page as the Wiki folder holds it.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with each refused attribute renamed and each Codebook address bound to the serving editor.
 * @example
 * withServedAddresses('<a href="vscode://file/etc/hosts">hosts</a><a href="vscode://laststance.codebook/update?root=%2Fr">Update</a>', 'cursor')
 * // => '<a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a><a href="cursor://laststance.codebook/update?root=%2Fr">Update</a>'
 */
export function withServedAddresses(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  const pieces: string[] = []
  let from = 0
  // Each edit in page order; the text between is copied as it stands.
  for (const { attributes } of readHtmlStartTags(html))
    for (const edit of attributes.flatMap((attribute) =>
      editOf(attribute, editorScheme),
    )) {
      pieces.push(html.slice(from, edit.start), edit.text)
      from = edit.end
    }
  pieces.push(html.slice(from))
  return pieces.join('')
}
