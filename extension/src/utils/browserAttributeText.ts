import type * as EntitiesDecode from 'entities/decode' with {
  'resolution-mode': 'import',
}

// Node24 can load this ESM package synchronously; the VSIX build bundles it as CJS.
const {
  decodeHTMLAttribute,
}: typeof EntitiesDecode = require('entities/decode')

/**
 * Reads an attribute value as a browser's tokenizer reads it, by the HTML standard's rules for a character reference in an attribute (`decodeHTMLAttribute` of the `entities` package, the copy the pinned parse5 reads pages with): a numeric reference with or without its semicolon, the replacement character for 0, a surrogate or a number past the last code point, and the Windows-1252 character for a number of the C1 range; every named reference with its semicolon, and a name a browser also reads without it, unless `=`, a letter or a digit follows that name, where the standard leaves it as written.
 *
 * Chrome 151 departs from the standard in one case: such a name without its semicolon, before a letter, a digit or `=`, is read when a semicolon follows later in the value (`&ampx;` is `&x;`, `&notit;` is `¬it;`). Only the names a browser reads without a semicolon do this, and each stands for `&`, `<`, `>`, `"` or a character outside ASCII, never a letter, a digit, a colon, a slash or white space, so an address, a scheme or a keyword judges alike in either reading.
 *
 * Why: the Wiki reader judges a served page's attributes by the text a browser acts on. `&#114efresh` is `refresh`, and `/&sol;host/x` is `//host/x`, for a browser; a reading that knows fewer references would let them through.
 * Called by the reader's filter ({@link withServedAddresses}) for every attribute it judges, by {@link addressAsBrowserReads}, and by {@link rebindDeepWikiEditorLinks} for the ids of a page.
 *
 * @param written - The value as the page writes it, without its quotes.
 * @returns The value's text, each reference read once.
 * @example
 * browserAttributeText('&#114efresh')     // => 'refresh'
 * browserAttributeText('/&sol;host/x')    // => '//host/x'
 * browserAttributeText('&#128;')          // => '€'
 * browserAttributeText('a&ampx=1&amp;b')  // => 'a&ampx=1&b'
 */
export function browserAttributeText(written: string): string {
  return decodeHTMLAttribute(written)
}
