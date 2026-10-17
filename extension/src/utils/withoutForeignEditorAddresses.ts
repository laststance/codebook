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
/** The schemes of the two editors a reader serves: an address of either opens the editor, which hands it to the extension or the file it names. */
const EDITOR_SCHEMES = new Set(['vscode', 'cursor'])
/** The starts of Codebook's own addresses, in lower case: a browser compares a scheme and an authority without case. */
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
/** The character references a browser reads in an attribute value that can spell a scheme: a number, with or without its semicolon, and the five names the publisher writes. */
const CHARACTER_REFERENCE =
  /&#(?:[xX]([0-9a-fA-F]+)|(\d+));?|&(amp|lt|gt|quot|apos);/g
/** The characters of the five names of {@link CHARACTER_REFERENCE}. */
const NAMED_CHARACTERS: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}
/** A reference left before the first slash, question mark or number sign of an address, which {@link CHARACTER_REFERENCE} does not read: a browser may read it as a letter or a colon of the scheme (`&colon;`). */
const UNREAD_REFERENCE_IN_SCHEME = /^[^/?#]*&(?:#|[A-Za-z][A-Za-z0-9]*;)/
/** The scheme at the start of an address: a letter, then letters, digits, `+`, `-` or `.`, up to a colon. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/

/**
 * The character one reference of {@link CHARACTER_REFERENCE} names, as a browser reads it; called by {@link readAddress} for each.
 * @param reference - The reference as written.
 * @param hexadecimal - The digits of a hexadecimal number, when it is one.
 * @param decimal - The digits of a decimal number, when it is one.
 * @param name - The name, when it is one of {@link NAMED_CHARACTERS}.
 * @returns The character; a number past the last code point names the last one.
 * @example
 * referencedCharacter('&#99;', undefined, '99', undefined) // => 'c'
 * referencedCharacter('&amp;', undefined, undefined, 'amp') // => '&'
 */
function referencedCharacter(
  reference: string,
  hexadecimal?: string,
  decimal?: string,
  name?: string,
): string {
  if (name !== undefined) return NAMED_CHARACTERS[name] ?? reference
  const codePoint = hexadecimal
    ? Number.parseInt(hexadecimal, 16)
    : Number.parseInt(decimal ?? '', 10)
  return String.fromCodePoint(Math.min(codePoint, UNICODE_LAST_CODE_POINT))
}

/**
 * Reads an attribute value as a browser reads an address in it: its character references as characters ({@link referencedCharacter}), without the spaces and control characters at its ends and without any tab or line break in it. Called by {@link addressesOf}.
 * @param value - The value as the page writes it.
 * @returns The address a browser follows.
 * @example
 * readAddress(' vs&#99;ode://file/a\t.ts') // => 'vscode://file/a.ts'
 */
function readAddress(value: string): string {
  return value
    .replace(CHARACTER_REFERENCE, referencedCharacter)
    .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
    .replace(/[\t\n\r]/g, '')
}

/**
 * The addresses one attribute value holds, as a browser reads them ({@link readAddress}): for `srcset` the address of each candidate, split at every comma; the whole value otherwise. Called by {@link isForeignEditorAttribute}.
 * @param name - The attribute's name in lower case.
 * @param value - The value as the page writes it.
 * @returns The addresses.
 * @example
 * addressesOf('srcset', 'a.png 1x, vscode://file/b.png 2x') // => ['a.png', 'vscode://file/b.png']
 */
function addressesOf(name: string, value: string): string[] {
  return name === 'srcset'
    ? value
        .split(',')
        .map((candidate) =>
          readAddress(candidate.trim().split(/[\t\n\f\r ]/)[0] ?? ''),
        )
    : [readAddress(value)]
}

/**
 * Whether an address opens an editor for something other than Codebook: its scheme is one of {@link EDITOR_SCHEMES} and it does not start with one of {@link CODEBOOK_ADDRESS_STARTS}, or a reference that a browser may read as a letter or a colon of its scheme is left in it ({@link UNREAD_REFERENCE_IN_SCHEME}). Called by {@link isForeignEditorAttribute}.
 * @param address - The address as {@link readAddress} read it.
 * @returns `true` for `vscode://file/…` and `cursor://other.extension/…`; `false` for a Codebook address, a web or mail address and a relative path.
 * @example
 * isForeignEditorAddress('VSCode://file/etc/hosts') // => true
 * isForeignEditorAddress('cursor://laststance.codebook/source?path=a.ts') // => false
 */
function isForeignEditorAddress(address: string): boolean {
  const scheme = SCHEME.exec(address)?.[1]?.toLowerCase() ?? ''
  const lowered = address.toLowerCase()
  return (
    (EDITOR_SCHEMES.has(scheme) &&
      !CODEBOOK_ADDRESS_STARTS.some((start) => lowered.startsWith(start))) ||
    UNREAD_REFERENCE_IN_SCHEME.test(address)
  )
}

/**
 * Whether one attribute, as {@link ATTRIBUTE} matched it, is an address attribute ({@link ADDRESS_ATTRIBUTES}) that holds an editor address other than Codebook's ({@link isForeignEditorAddress}). Called by {@link foreignAddressNamesOfTagAt}.
 * @param attribute - The match: the separators, the name, and the value in one of three forms.
 * @returns Whether the attribute's link has to go.
 * @example
 * isForeignEditorAttribute(ATTRIBUTE.exec(' HREF=vscode://file/x')) // => true
 */
function isForeignEditorAttribute(attribute: RegExpExecArray): boolean {
  const name = (attribute[2] ?? '').toLowerCase()
  const value = attribute[3] ?? attribute[4] ?? attribute[5] ?? ''
  return (
    ADDRESS_ATTRIBUTES.has(name) &&
    addressesOf(name, value).some(isForeignEditorAddress)
  )
}

/**
 * Finds where the names of the attributes of {@link isForeignEditorAttribute} stand in a tag that may start at one `<`, reading its attributes as a browser's tokenizer does up to the `>` that ends it. Called by {@link withoutForeignEditorAddresses} for every `<` before a letter.
 * @param html - The page.
 * @param tagStart - Where the `<` stands.
 * @returns The start and the end of each such name.
 * @example
 * foreignAddressNamesOfTagAt('<a href="vscode://file/x">x</a>', 0) // => [[3, 7]]
 */
function foreignAddressNamesOfTagAt(
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
    if (isForeignEditorAttribute(attribute))
      names.push([nameStart, nameStart + (attribute[2] ?? '').length])
  }
  return names
}

/**
 * Takes the link from every address of a served page that opens an editor for something other than Codebook (`vscode://file/…`, `cursor://another.extension/…`), and keeps the text: the attribute's name becomes `data-codebook-unlinked`, so the element and its value stay and a browser follows nothing.
 *
 * Why: such an address opens a file or runs another extension in the editor, often without a question once the learner allowed the editor's scheme for Codebook's own links. The publisher refuses it in a page's content (SC4), but a Wiki published before, or a page written straight into the Wiki folder, may carry it. Codebook's own addresses stay, for {@link rebindDeepWikiEditorLinks} to bind to the serving editor.
 * How: every `<` before a letter is read as a tag start, also inside a comment or another tag's quoted value, where a browser reads text: a link a browser can follow is never left out, and text loses no more than the name of such an attribute. Only a name is replaced, by letters and hyphens, so no quote or `>` moves and the page is read as before.
 * Called by {@link rebindDeepWikiEditorLinks} first, for every page the reader serves.
 *
 * @param html - The page as the Wiki folder holds it.
 * @returns The page with each such attribute renamed.
 * @example
 * withoutForeignEditorAddresses('<a href="vscode://file/etc/hosts">hosts</a>')
 * // => '<a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a>'
 */
export function withoutForeignEditorAddresses(html: string): string {
  const names = [...html.matchAll(TAG_START)]
    .flatMap((tag) => foreignAddressNamesOfTagAt(html, tag.index))
    .sort(([start], [otherStart]) => start - otherStart)
  let served = ''
  let from = 0
  // Each name in page order; a name read from two tag starts is replaced once.
  for (const [start, end] of names) {
    if (start < from) continue
    served += `${html.slice(from, start)}data-codebook-unlinked`
    from = end
  }
  return served + html.slice(from)
}
