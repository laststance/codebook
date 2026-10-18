import { UNICODE_LAST_CODE_POINT } from '../constants'

/** A character reference in an attribute value as a browser's tokenizer finds it: a decimal or hexadecimal number with or without its semicolon, or a run of letters and digits after `&`, with its semicolon if one follows. */
const CHARACTER_REFERENCE =
  /&(?:#([xX][0-9a-fA-F]+|[0-9]+);?|([A-Za-z][A-Za-z0-9]*;?))/g
/** The named references whose character is ASCII, with their semicolon, and the five whose name a browser also reads without it (`amp`, `lt`, `gt`, `quot` in either case). Every other name a browser knows stands for a character outside ASCII, which can be no letter, digit, colon, slash or white space of an address, a scheme or a keyword; such a reference is left as written, which judges alike. */
const ASCII_NAMED_REFERENCES: Readonly<Record<string, string>> = {
  'Tab;': '\t',
  'NewLine;': '\n',
  'excl;': '!',
  'quot;': '"',
  'QUOT;': '"',
  'num;': '#',
  'dollar;': '$',
  'percnt;': '%',
  'amp;': '&',
  'AMP;': '&',
  'apos;': "'",
  'lpar;': '(',
  'rpar;': ')',
  'ast;': '*',
  'midast;': '*',
  'plus;': '+',
  'comma;': ',',
  'period;': '.',
  'sol;': '/',
  'colon;': ':',
  'semi;': ';',
  'lt;': '<',
  'LT;': '<',
  'equals;': '=',
  'gt;': '>',
  'GT;': '>',
  'quest;': '?',
  'commat;': '@',
  'lsqb;': '[',
  'lbrack;': '[',
  'bsol;': '\\',
  'rsqb;': ']',
  'rbrack;': ']',
  'Hat;': '^',
  'lowbar;': '_',
  'UnderBar;': '_',
  'grave;': '`',
  'DiacriticalGrave;': '`',
  'lcub;': '{',
  'lbrace;': '{',
  'verbar;': '|',
  'vert;': '|',
  'VerticalLine;': '|',
  'rcub;': '}',
  'rbrace;': '}',
  'fjlig;': 'fj',
}
/** The named references with an ASCII character that a browser reads without their semicolon, longest first. */
const LEGACY_ASCII_NAMES = [
  'QUOT',
  'quot',
  'AMP',
  'amp',
  'LT',
  'lt',
  'GT',
  'gt',
]
/** The character of each of {@link LEGACY_ASCII_NAMES}. */
const LEGACY_ASCII_CHARACTERS: Readonly<Record<string, string>> = {
  QUOT: '"',
  quot: '"',
  AMP: '&',
  amp: '&',
  LT: '<',
  lt: '<',
  GT: '>',
  gt: '>',
}

/**
 * The character a numeric reference names, as a browser reads it: the replacement character for 0, a surrogate, a number past the last code point, and the C1 range, which a browser maps to characters outside ASCII; called by {@link browserAttributeText}.
 * @param digits - The digits, after `x` or `X` for a hexadecimal number.
 * @returns The character.
 * @example
 * numericCharacter('114') // => 'r'
 * numericCharacter('x3a') // => ':'
 */
function numericCharacter(digits: string): string {
  const isHexadecimal = digits.startsWith('x') || digits.startsWith('X')
  const significant = (isHexadecimal ? digits.slice(1) : digits).replace(
    /^0+/,
    '',
  )
  // A number with more than eight significant digits lies past the last code point in either base.
  const codePoint =
    significant.length > 8
      ? Number.POSITIVE_INFINITY
      : Number.parseInt(significant || '0', isHexadecimal ? 16 : 10)
  const isNamed =
    codePoint > 0 &&
    codePoint <= UNICODE_LAST_CODE_POINT &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
    !(codePoint >= 0x80 && codePoint <= 0x9f)
  return isNamed ? String.fromCodePoint(codePoint) : '�'
}

/**
 * The character of a named reference in an attribute value, as a browser reads it: the reference with its semicolon, or a name of {@link LEGACY_ASCII_NAMES} without it, unless `=`, a letter or a digit follows that name, where a browser leaves it as written; called by {@link browserAttributeText}.
 * @param run - The letters and digits after `&`, with the semicolon after them if there is one.
 * @param next - The character after the run.
 * @returns The characters it stands for, or `undefined` to leave the reference as written.
 * @example
 * namedCharacters('colon;', 'j') // => ':'
 * namedCharacters('ampx', ';')   // => undefined
 */
function namedCharacters(
  run: string,
  next: string | undefined,
): string | undefined {
  const named = ASCII_NAMED_REFERENCES[run]
  if (named !== undefined) return named
  const legacy = LEGACY_ASCII_NAMES.find((name) => run.startsWith(name))
  if (legacy === undefined) return undefined
  // Without its semicolon a name counts only before a character that can continue no name.
  const after = run.length > legacy.length ? run[legacy.length] : next
  return after !== undefined && /[=A-Za-z0-9]/.test(after)
    ? undefined
    : `${LEGACY_ASCII_CHARACTERS[legacy] ?? ''}${run.slice(legacy.length)}`
}

/**
 * Reads an attribute value as a browser's tokenizer reads it: a numeric reference with or without its semicolon ({@link numericCharacter}), and a named reference a browser reads there ({@link namedCharacters}), become their characters.
 *
 * Why: the Wiki reader judges a served page's attributes by the text a browser acts on. `&#114efresh` is `refresh`, and `/&sol;host/x` is `//host/x`, for a browser; a reading that knows fewer references would let them through.
 * Called by the reader's filter ({@link withoutRefusedAddresses}) for every attribute it judges.
 *
 * @param written - The value as the page writes it, without its quotes.
 * @returns The value's text, each reference read once.
 * @example
 * browserAttributeText('&#114efresh')     // => 'refresh'
 * browserAttributeText('/&sol;host/x')    // => '//host/x'
 * browserAttributeText('a&ampx=1&amp;b')  // => 'a&ampx=1&b'
 */
export function browserAttributeText(written: string): string {
  return written.replace(
    CHARACTER_REFERENCE,
    (
      reference: string,
      digits: string | undefined,
      run: string | undefined,
      offset: number,
    ) =>
      digits === undefined
        ? (namedCharacters(run ?? '', written[offset + reference.length]) ??
          reference)
        : numericCharacter(digits),
  )
}
