import { UNICODE_LAST_CODE_POINT } from '../constants'

/** The attributes a browser follows as an address: the ones the publisher holds to its schemes (`ADDRESS_ATTRIBUTES` of `render-wiki-diagrams.mjs`). */
const ADDRESS_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'srcset',
])
/** The schemes an address may name for any place, as the publisher accepts them (`ADDRESS_SCHEMES` of `render-wiki-diagrams.mjs`): the web's and mail's. */
const ADDRESS_SCHEMES = new Set(['http', 'https', 'mailto'])
/** The starts of Codebook's own addresses, in lower case: the publisher compares a scheme and an authority without case, as a browser does (`CODEBOOK_ADDRESS_STARTS` of `render-wiki-diagrams.mjs`). */
const CODEBOOK_ADDRESS_STARTS = [
  'vscode://laststance.codebook/',
  'cursor://laststance.codebook/',
]
/** Every `<` before a letter: where a browser may start a tag. */
const TAG_START = /<[A-Za-z]/g
/** The rest of a tag's name after its first letter, tried where that letter ends: up to white space, a slash or `>`, as a browser reads it. */
const TAG_NAME_REST = /[^\t\n\f\r />]*/y
/** One attribute of a start tag as a browser's tokenizer reads it, tried where the last one ended: the separators before it (white space or a slash; none after a quoted value), its name (which may start with `=`), and, when `=` follows, its value in double quotes, in single quotes or bare. A quote that never ends takes the rest of the page, as a browser's does. */
const ATTRIBUTE =
  /([\t\n\f\r /]*)([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"?|'([^']*)'?|([^\t\n\f\r >]*)))?/y
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
  const read = address
    .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
    .replace(/[\t\n\r]/g, '')
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
 * Whether one attribute, as {@link ATTRIBUTE} matched it, has to lose its effect: an address attribute ({@link ADDRESS_ATTRIBUTES}) that holds an address the publisher refuses today ({@link isAcceptedAddress}), or an `http-equiv` of `refresh`, by which a page moves the browser to another address by itself. Called by {@link refusedNamesOfTagAt}.
 * @param attribute - The match: the separators, the name, and the value in one of three forms.
 * @returns Whether the attribute is renamed.
 * @example
 * isRefusedAttribute(ATTRIBUTE.exec(' HREF=javascript:run()')) // => true
 */
function isRefusedAttribute(attribute: RegExpExecArray): boolean {
  const name = (attribute[2] ?? '').toLowerCase()
  const text = attributeText(attribute[3] ?? attribute[4] ?? attribute[5] ?? '')
  if (name === 'http-equiv') return text.trim().toLowerCase() === 'refresh'
  return (
    ADDRESS_ATTRIBUTES.has(name) &&
    !addressesOf(name, text).every(isAcceptedAddress)
  )
}

/**
 * Finds where the names of the attributes of {@link isRefusedAttribute} stand in a tag that may start at one `<`, reading its attributes as a browser's tokenizer does up to the `>` that ends it. Called by {@link withoutRefusedAddresses} for every `<` before a letter.
 * @param html - The page.
 * @param tagStart - Where the `<` stands.
 * @returns The start and the end of each such name.
 * @example
 * refusedNamesOfTagAt('<a href="javascript:run()">x</a>', 0) // => [[3, 7]]
 */
function refusedNamesOfTagAt(
  html: string,
  tagStart: number,
): Array<[number, number]> {
  TAG_NAME_REST.lastIndex = tagStart + 2
  TAG_NAME_REST.exec(html)
  ATTRIBUTE.lastIndex = TAG_NAME_REST.lastIndex
  const names: Array<[number, number]> = []
  // Each attribute in turn, up to the `>` that ends the tag or the end of the page.
  for (
    let attribute = ATTRIBUTE.exec(html);
    attribute;
    attribute = ATTRIBUTE.exec(html)
  ) {
    const nameStart = attribute.index + (attribute[1] ?? '').length
    if (isRefusedAttribute(attribute))
      names.push([nameStart, nameStart + (attribute[2] ?? '').length])
  }
  return names
}

/**
 * Keeps in a served page only the addresses the publisher accepts today, and takes the effect from every other one while its text stays: an address of another scheme (`javascript:`, `data:`, `file:`, `vscode-insiders:`, an editor address that is not Codebook's own …) and a refresh (`<meta http-equiv="refresh">`). The attribute's name becomes `data-codebook-unlinked`, so the element and its value stay and a browser follows nothing.
 *
 * Why: the reader serves pages of any age. A Wiki published before the publisher refused such addresses, or a page written straight into the Wiki folder, may carry one. In the editor's browser an editor address opens a file or runs another extension, often without a question once the learner allowed the editor's scheme for Codebook's own links; a refresh moves the page to such an address without a click, and the page's policy does not stop it. The rule is the publisher's (`isAcceptedAddress` of `render-wiki-diagrams.mjs`), so a page reads alike published today and served. Codebook's own addresses stay, for {@link rebindDeepWikiEditorLinks} to bind to the serving editor.
 * How: every `<` before a letter is read as a tag start, also inside a comment or another tag's quoted value, where a browser reads text: a link a browser can follow is never left out, and text loses no more than the name of such an attribute. Only a name is replaced, by letters and hyphens, so no quote or `>` moves and the page is read as before.
 * Called by {@link rebindDeepWikiEditorLinks} first, for every page the reader serves.
 *
 * @param html - The page as the Wiki folder holds it.
 * @returns The page with each such attribute renamed.
 * @example
 * withoutRefusedAddresses('<a href="vscode://file/etc/hosts">hosts</a><meta http-equiv="refresh" content="0;url=x">')
 * // => '<a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a><meta data-codebook-unlinked="refresh" content="0;url=x">'
 */
export function withoutRefusedAddresses(html: string): string {
  const names = [...html.matchAll(TAG_START)]
    .flatMap((tag) => refusedNamesOfTagAt(html, tag.index))
    .sort(([start], [otherStart]) => start - otherStart)
  let served = ''
  let from = 0
  // Each name in page order; a name read from two tag starts is replaced once.
  for (const [start, end] of names) {
    if (start < from) continue
    served += `${html.slice(from, start)}${UNLINKED_NAME}`
    from = end
  }
  return served + html.slice(from)
}
