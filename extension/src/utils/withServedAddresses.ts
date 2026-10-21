import { UNICODE_LAST_CODE_POINT } from '../constants'

import { addressAsBrowserReads } from './addressAsBrowserReads'
import { browserAttributeText } from './browserAttributeText'
import { escapeHtml } from './escapeHtml'
import {
  type HtmlAttribute,
  type HtmlReading,
  readHtmlPage,
  readHtmlStartTags,
} from './readHtmlStartTags'
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
/** The value of a meta element's `name` by which a page sets the referrer policy of the whole page (compared without case, as a browser does), which overrides the reader's `Referrer-Policy: no-referrer` header. */
const REFERRER_META_NAME = 'referrer'
/** The attribute by which one element sets its own referrer policy (a link, an area, an image, a frame, a link element, a script), which overrides the reader's `Referrer-Policy: no-referrer` header for what that element fetches or opens. */
const REFERRER_POLICY_ATTRIBUTE = 'referrerpolicy'
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
/** A select start tag in any case: only a select element takes the select rules, so a page without one reads alike under those of 2025 and those before. */
const SELECT_START = /<select/i
/** A noscript start tag in any case: only a noscript element takes the scripting flag, so a page without one reads alike with scripting on and off. */
const NOSCRIPT_START = /<noscript/i
/** An svg or a math start tag in any case: only such an element opens svg or MathML content, so where none comes before a place no reading has such content open there. */
const FOREIGN_CONTENT_START = /<(?:svg|math)/i
/** A start tag that leaves svg and MathML content and adds nothing a page shows: in such content every browser closes its elements at a meta and puts in the meta by the head's rules, which close it at once. The reader's script tag follows it where a reading the filter judges the page under leaves such content open at the tag's place ({@link isForeignContentOpenInAnyReading}), as a script tag there would be an svg or MathML element in that reading, which loads nothing. */
const FOREIGN_CONTENT_EXIT = '<meta>'

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
 * Reads an attribute value as the publisher reads it (`attributeText` of `render-wiki-diagrams.mjs`): every character reference of {@link CHARACTER_REFERENCE} becomes its character. Called by {@link isRefusedAddress}.
 * @param value - The value as the page writes it.
 * @returns The value's text.
 * @example
 * attributeText('vs&#99;ode://file/a') // => 'vscode://file/a'
 */
function attributeText(value: string): string {
  return value.replace(CHARACTER_REFERENCE, referencedCharacter)
}

/**
 * The addresses one attribute value holds, as the publisher splits them (`addressesOf` of `render-wiki-diagrams.mjs`): for `srcset` the address of each candidate, split at every comma; the whole value otherwise. Called by {@link isRefusedAddress}.
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
 * Whether the publisher's renderer accepts one address today (this file's copy of its private `isAcceptedAddress` of `render-wiki-diagrams.mjs`), read as a browser reads it: without the spaces and control characters at its ends and without any tab or line break in it. Accepted are a relative path and a `#fragment` (no colon before the first slash, question mark or number sign, and no named reference there), an `http`, `https` or `mailto` address, and Codebook's own editor address ({@link CODEBOOK_ADDRESS_STARTS}); never one of {@link REFUSED_IN_ANY_ADDRESS}. Called by {@link isRefusedAddress}.
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
 * - an svg animation's `attributeName` of `href` or `xlink:href` ({@link ANIMATED_ADDRESSES}), which gives a link the address of its `to`, `from`, `by` or `values`;
 * - a `referrerpolicy` ({@link REFERRER_POLICY_ATTRIBUTE}) and the `name` of a meta element that is `referrer` ({@link REFERRER_META_NAME}): each overrides the reader's `Referrer-Policy: no-referrer` header, so a page could send its own address, which holds the reader's private path token, to another site.
 * Called by {@link editOf} and {@link renamesUnder}.
 * @param attribute - The attribute: its name in lower case and its value as written.
 * @param tagName - The name in lower case of the start tag that holds the attribute.
 * @returns Whether the attribute is renamed.
 * @example
 * isRefusedAttribute({ name: 'http-equiv', written: '&#114efresh', … }, 'meta') // => true
 * isRefusedAttribute({ name: 'name', written: 'Referrer', … }, 'meta')          // => true
 * isRefusedAttribute({ name: 'name', written: 'referrer', … }, 'input')         // => false
 */
function isRefusedAttribute(
  attribute: HtmlAttribute,
  tagName: string,
): boolean {
  const { name } = attribute
  const written = attribute.written ?? ''
  const keyword = browserAttributeText(written).trim().toLowerCase()
  if (name === 'srcdoc' || name === REFERRER_POLICY_ATTRIBUTE) return true
  if (name === 'http-equiv') return keyword === 'refresh'
  if (name === 'attributename') return ANIMATED_ADDRESSES.has(keyword)
  if (name === 'name')
    return tagName === 'meta' && keyword === REFERRER_META_NAME
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
 * @param tagName - The name in lower case of the start tag that holds the attribute.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The attribute's edits, none for an attribute served as written.
 * @example
 * editOf({ name: 'href', written: 'javascript:run()', nameStart: 3, nameEnd: 7, … }, 'a', 'vscode') // => [{ start: 3, end: 7, text: 'data-codebook-unlinked' }]
 */
function editOf(
  attribute: HtmlAttribute,
  tagName: string,
  editorScheme: 'vscode' | 'cursor',
): Edit[] {
  if (isRefusedAttribute(attribute, tagName))
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
 * Prints a page with its edits put in, each at its span, and the text between copied as it stands; called by {@link withServedAddresses} for each pass over a page.
 * @param page - The page.
 * @param edits - Edits in page order whose spans do not overlap.
 * @returns The page with every edit put in.
 * @example
 * withEdits('<a href=x>', [{ start: 3, end: 7, text: 'data-codebook-unlinked' }]) // => '<a data-codebook-unlinked=x>'
 */
function withEdits(page: string, edits: Iterable<Edit>): string {
  const pieces: string[] = []
  let from = 0
  // Each edit in page order; the text between is copied as it stands.
  for (const edit of edits) {
    pieces.push(page.slice(from, edit.start), edit.text)
    from = edit.end
  }
  pieces.push(page.slice(from))
  return pieces.join('')
}

/**
 * The readings ({@link HtmlReading}) of a page that a browser may take and the filter judges it under: Chrome 151's with scripting first, then, for a page that holds a select or a noscript start tag, each combination of the select rules before 2025 and scripting off by which it may read otherwise; called by {@link withNoLinkAnyReadingRefuses} for each round and by {@link isForeignContentOpenInAnyReading} for the place of the reader's script tag.
 * A page without a select start tag reads alike under both select rules, and one without a noscript start tag reads alike with scripting on and off ({@link SELECT_START}, {@link NOSCRIPT_START}), so such a page takes no reading beside Chrome's.
 * @param page - The page.
 * @returns The readings, Chrome's with scripting first.
 * @example
 * readingsOf('<p>x</p>') // => [{ selectRules: 'current', scriptingEnabled: true }]
 * readingsOf('<select></select>') // => [{ selectRules: 'current', scriptingEnabled: true }, { selectRules: 'before-2025', scriptingEnabled: true }]
 */
function readingsOf(page: string): HtmlReading[] {
  const selectRules: HtmlReading['selectRules'][] = SELECT_START.test(page)
    ? ['current', 'before-2025']
    : ['current']
  const scriptingFlags = NOSCRIPT_START.test(page) ? [true, false] : [true]
  return selectRules.flatMap((rules) =>
    scriptingFlags.map((scriptingEnabled) => ({
      selectRules: rules,
      scriptingEnabled,
    })),
  )
}

/**
 * The renames that take the effect from every attribute that one of the readings of a page refuses ({@link isRefusedAttribute}), whatever the others make of its text; called by {@link withNoLinkAnyReadingRefuses}.
 * A refused name is written in letters, colons and hyphens only, and the character before it and after it is none of these; so the names two readings refuse stand at the same span or apart, and each span is renamed once.
 * @param page - The page.
 * @param readings - The readings to judge it under.
 * @returns The renames in page order, one per span.
 * @example
 * renamesUnder(page, readingsOf(page)) // => one rename of `href` for each link a reading of the page refuses
 */
function renamesUnder(page: string, readings: readonly HtmlReading[]): Edit[] {
  const renames = new Map<number, Edit>()
  // Every reading's start tags; a name two readings refuse is renamed once.
  for (const reading of readings)
    for (const { name: tagName, attributes } of readHtmlStartTags(
      page,
      reading,
    ))
      for (const attribute of attributes)
        if (isRefusedAttribute(attribute, tagName))
          renames.set(attribute.nameStart, {
            start: attribute.nameStart,
            end: attribute.nameEnd,
            text: UNLINKED_NAME,
          })
  return [...renames.values()].sort(
    (first, second) => first.start - second.start,
  )
}

/**
 * Whether a reading the filter judges a page under ({@link readingsOf}) leaves svg or MathML content open at a place of the page, so that a script tag put in there would be an svg or MathML element in that reading, which loads nothing; called by {@link withServedAddresses} for the place of the reader's script tag, before it puts the tag in.
 * Chrome's reading answers by the reading of the whole page the caller made. Each other reading reads the page up to the place, and its answer is whether a start tag put in at that end would take the rules of svg or MathML content ({@link readHtmlPage}): the tokens before the place build the stack a tag there meets. Where that reading reads the place inside a text, a comment or a tag, a tag put in there is no tag in it, and the answer only decides whether a meta, which adds nothing a page shows, goes in too. Without an svg or a math start tag before the place no reading is asked ({@link FOREIGN_CONTENT_START}), and a page without a select or a noscript start tag before it takes no reading beside Chrome's.
 * @param page - The page as the Wiki folder holds it.
 * @param place - Where the tag would go: the start of the `</body>` Chrome's reading took as the body's end, or the page's end.
 * @param openInChromeReading - Whether Chrome's reading leaves such content open there.
 * @returns Whether any reading leaves such content open at the place.
 * @example
 * isForeignContentOpenInAnyReading('<body><select><keygen><svg><g></select></body>', 39, false) // => true: by the select rules before 2025 the keygen closes the select, so the svg stays open
 */
function isForeignContentOpenInAnyReading(
  page: string,
  place: number,
  openInChromeReading: boolean,
): boolean {
  if (openInChromeReading) return true
  const beforePlace = page.slice(0, place)
  if (!FOREIGN_CONTENT_START.test(beforePlace)) return false
  // Chrome's reading answered; each other reading reads the page up to the place.
  return readingsOf(beforePlace)
    .slice(1)
    .some(
      (reading) => readHtmlPage(beforePlace, reading).pageEndInForeignContent,
    )
}

/**
 * Takes the effect from every attribute that a reading of a page other than Chrome's refuses ({@link readingsOf}), until no reading finds one; called by {@link withServedAddresses} on the page Chrome's reading served.
 * Chrome's reading finds nothing more to take away on the page its own edits made: a rename or a rebound value changes only its own tag, and the reader's script tag stands between two tags of Chrome's reading ({@link withServedAddresses}). Another reading may find an attribute in what Chrome reads as the text of a style, an xmp, an iframe, a title, a plaintext, a CDATA section or a noscript. A rename in one reading can change another reading's end tags (a page may name an element like an attribute and end it: where the older select rules read a link, Chrome may read the end of an element named `href` that closes an svg in it, and once renamed that end closes nothing, so a script after it is an svg script whose text Chrome reads as tags), so after a round of renames every reading reads the page again. Each round renames at least one name, never one renamed before, so the rounds end; a page built to need many meets the worker's deadline ({@link servedWikiPageOffThread}).
 * @param servedByChrome - The page as Chrome's reading served it.
 * @returns The page with no attribute any reading refuses.
 * @example
 * withNoLinkAnyReadingRefuses(servedByChrome) // => the same page, each name a reading beside Chrome's refuses renamed `data-codebook-unlinked`
 */
function withNoLinkAnyReadingRefuses(servedByChrome: string): string {
  let served = servedByChrome
  // The first round leaves out Chrome's own reading, which the page already passed.
  let readings = readingsOf(served).slice(1)
  // Until a round finds nothing to rename; a page without a select or a noscript ends at once.
  for (;;) {
    const renames = renamesUnder(served, readings)
    if (renames.length === 0) return served
    served = withEdits(served, renames)
    readings = readingsOf(served)
  }
}

/**
 * Serves a page's addresses as the reader may serve them, in one pass over the page: it keeps only the addresses the publisher accepts today and takes the effect from every other one while its text stays, and it binds every Codebook address to the editor that serves the page.
 *
 * Refused are an address of another scheme (`javascript:`, `data:`, `file:`, `vscode-insiders:`, an editor address that is not Codebook's own …), a refresh (`<meta http-equiv="refresh">`), a frame's own page (`srcdoc`), an svg animation of an address, and a `referrerpolicy` or a meta `name="referrer"` (which would let a page send its own address, with the reader's private path token, to another site), each read as a browser reads its value ({@link isRefusedAttribute}). The attribute's name becomes `data-codebook-unlinked`, so the element and its value stay and a browser follows nothing. A Codebook address in a link, a form's action or a button's form action gets the serving editor's scheme, in whatever form a browser reads it ({@link reboundAddressOf}).
 *
 * Why: the reader serves pages of any age. A Wiki published before the publisher refused such addresses, or a page written straight into the Wiki folder, may carry one. In the editor's browser an editor address opens a file or runs another extension, often without a question once the learner allowed the editor's scheme for Codebook's own links; a refresh moves the page to such an address without a click, and the page's policy does not stop it. The rule is a copy in this file of the one the publisher's renderer applies (`isAcceptedAddress`, private to `render-wiki-diagrams.mjs` and reached through its exported `scriptingClauseOf`, which `render-wiki.mjs` calls for every page), not code the two share; the test 'the reader keeps exactly the addresses the shipped publisher accepts in a page’s content' holds the two alike, so a page reads alike published today and served. One published site works in both editors, as each binds Codebook's addresses to itself.
 * How: the page is read as Chrome 151 reads it ({@link readHtmlStartTags}): the attributes of its start tags are judged, and a comment, a script's or a style's text and any other text are served as published. A refused attribute's name is replaced by letters and hyphens, and a rebound value keeps its place, so the page is read as before. The reader opens in the system's default browser, which may read a select by the rules before 2025 or run without scripting; so a page with a select or a noscript is then read under each of those readings too, and an attribute any of them refuses loses its effect as well, also where Chrome reads it as text ({@link withNoLinkAnyReadingRefuses}); Codebook's addresses are rebound by Chrome's reading alone. On an ordinary page the time grows with the page's size. A page with a select and a noscript is read under all four readings: Chrome's, then the three others, and again under all four after each round that renamed an attribute, until a round renames nothing ({@link withNoLinkAnyReadingRefuses}); where an svg or a math start tag comes before the reader's script tag and Chrome's reading leaves no such content open there, up to three more readings of the page up to the tag ({@link isForeignContentOpenInAnyReading}); and where the tag goes at the page's end, or after a meta that leaves such content, Chrome's reading of the whole page once more, with them in it, before the rounds. A page built for it can make the HTML parser's own rules take time that grows with the square of its nesting (13 s to minutes for 1 MB), which no reading of the tags avoids; so the Wiki reader runs this function only on a worker thread, which it stops after {@link WIKI_PAGE_SERVE_DEADLINE_MS} ({@link servedWikiPageOffThread}).
 * The reader's own script tag, when the caller hands one, goes in by the same pass, at the start of the `</body>` Chrome's reading took as the body's end ({@link readHtmlPage}): there Chrome reads between two tags, so the tag starts and ends a script element of its own and changes no other tag; a `</body>` in a comment, a value or a script's text, or written in capitals, is read as a browser reads it. A page without such an end, or whose body no `<body>` tag opened (the parser records no end for a body it adds by itself), gets the tag at its end, and the filter reads the page with the tag in it, as the tag may close a tag the page leaves open; a page that ends inside a comment, an open tag or a raw-text element then takes the tag into that text, where it loads nothing (a hand-edited page only: the publisher opens every page's body with a tag). So does a page with a `<template>` left open: the parser ignores every `</body>` inside the template, so the page has no body end it takes, and the tag at the page's end becomes part of the template's content, which a browser keeps inert, so the page runs without the reader's script (a hand-edited page only: the renderer refuses a `template` tag in a page's content). Where svg or MathML content is open at the tag's place in Chrome's reading or in another reading the filter judges the page under, by the select rules before 2025 or without scripting (an element of it other than an integration point is the current node there), a script tag would be an svg or MathML element in that reading, which loads nothing; so a meta that leaves that content goes in before the tag ({@link FOREIGN_CONTENT_EXIT}, {@link isForeignContentOpenInAnyReading}), and the filter reads the page with both in it, as that reading then reads what follows outside that content.
 * Called by {@link rebindDeepWikiEditorLinks} last, for every page the reader serves, so the page served is this function's output.
 *
 * @param html - The page as the Wiki folder holds it.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @param tagAtBodyEnd - The reader's script tag, escaped, to put at the body's end; nothing is put in when omitted.
 * @returns The page with each refused attribute renamed, each Codebook address bound to the serving editor, and the tag at its body's end.
 * @example
 * withServedAddresses('<a href="vscode://file/etc/hosts">hosts</a><a href="vscode://laststance.codebook/update?root=%2Fr">Update</a>', 'cursor')
 * // => '<a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a><a href="cursor://laststance.codebook/update?root=%2Fr">Update</a>'
 * withServedAddresses('<body><p>x</p></BODY>', 'vscode', '<script src="/w/t/codebook-qa.js"></script>')
 * // => '<body><p>x</p><script src="/w/t/codebook-qa.js"></script></BODY>'
 */
export function withServedAddresses(
  html: string,
  editorScheme: 'vscode' | 'cursor',
  tagAtBodyEnd?: string,
): string {
  const {
    startTags,
    bodyEndTagStart,
    bodyEndInForeignContent,
    pageEndInForeignContent,
  } = readHtmlPage(html)
  if (tagAtBodyEnd !== undefined) {
    // Without a body end the tag goes at the page's end.
    const place = bodyEndTagStart ?? html.length
    const isForeignContentOpen = isForeignContentOpenInAnyReading(
      html,
      place,
      bodyEndTagStart === undefined
        ? pageEndInForeignContent
        : bodyEndInForeignContent,
    )
    // At the page's end the tag may close a tag the page leaves open, and where a reading leaves svg or MathML content open at the place, the tag follows a tag that leaves that content, which changes how that reading reads the rest of the page: the filter reads the page with them in it.
    if (bodyEndTagStart === undefined || isForeignContentOpen)
      return withServedAddresses(
        html.slice(0, place) +
          (isForeignContentOpen ? FOREIGN_CONTENT_EXIT : '') +
          tagAtBodyEnd +
          html.slice(place),
        editorScheme,
      )
  }
  const edits = startTags.flatMap(({ name: tagName, attributes }) =>
    attributes.flatMap((attribute) => editOf(attribute, tagName, editorScheme)),
  )
  // The body's end tag starts between two tags, so the insertion stands apart from every attribute's edit.
  if (tagAtBodyEnd !== undefined && bodyEndTagStart !== undefined) {
    const place = edits.findIndex((edit) => edit.start > bodyEndTagStart)
    edits.splice(place === -1 ? edits.length : place, 0, {
      start: bodyEndTagStart,
      end: bodyEndTagStart,
      text: tagAtBodyEnd,
    })
  }
  return withNoLinkAnyReadingRefuses(withEdits(html, edits))
}
